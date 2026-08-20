//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-free tests for the SPEND side of the stealth transfer builder.
//
// Covers `spendStealthInput` (multi-input, dedupe, repeatable) and that `prepare()` builds
// an inputs statement containing the spent commitments and registers each input's UTXO as a
// tx input. Uses the deterministic fake crypto + a minimal stubbed Provider.

import type { SubstateRequirement } from "@tari-project/ootle-ts-bindings";
import { describe, expect, it, vi } from "vitest";
import { Network } from "../network";
import type { Provider } from "../provider";
import { FakeStealthCrypto } from "../test/fake-crypto";
import { createOutput } from "./primitives";
import { isStealthTransferInstruction } from "./instruction";
import { StealthTransfer } from "./transfer";
import { stealthUtxoSubstateId } from "./substate-parse";
import { fromHexStr, toHexStr } from "../helpers/hex";

const RESOURCE = "resource_" + "a".repeat(64);
const ACCOUNT = "component_" + "b".repeat(64);
const OWNER = "component_" + "c".repeat(64);
const DESTINATION = "account_dest_address";

const COMMITMENT_A = fromHexStr("11".repeat(32));
const COMMITMENT_B = fromHexStr("22".repeat(32));

function stubProvider(overrides: Partial<Provider> = {}): Provider {
  const base: Provider = {
    network: () => Network.LocalNet,
    getCurrentEpoch: vi.fn(async () => 90),
    resolveInputs: vi.fn(async (inputs: SubstateRequirement[]) =>
      inputs.map((i) => ({ ...i, version: i.version ?? 0 })),
    ),
    // Default to a vault-less Component so prepare()'s vault walker doesn't NPE on the
    // revealed-source path; tests that need vault refs override per-call.
    getSubstate: vi.fn(async () => ({
      address: "",
      version: 0,
      substate: { Component: { body: { state: {} } } },
      created_by_transaction: "",
    })),
    getStealthUtxo: vi.fn(),
    fetchSubstates: vi.fn(),
    getTemplateDefinition: vi.fn(),
    submitTransaction: vi.fn(),
    getTransactionResult: vi.fn(),
    listRecentTransactions: vi.fn(),
  } as unknown as Provider;
  return { ...base, ...overrides };
}

describe("StealthTransfer.spendStealthInput", () => {
  /**
   * Helper: drive the builder through `prepare()` and project `spec.inputs` into a plain
   * commitment-hex → owner map for assertion convenience. Builders also need a stealth
   * output to satisfy `validate()`; the destination is constant.
   */
  async function ownersByCommitment(transfer: StealthTransfer): Promise<Map<string, string>> {
    const spec = await transfer
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1n, resourceAddress: RESOURCE }))
      .prepare();
    return new Map(spec.inputs.map(({ input, owner }) => [toHexStr(input.commitment), owner]));
  }

  it("adds a stealth input keyed by commitment hex alone, recording the owner", async () => {
    const transfer = new StealthTransfer(stubProvider(), RESOURCE, new FakeStealthCrypto()).spendStealthInput(
      OWNER,
      COMMITMENT_A,
    );

    const owners = await ownersByCommitment(transfer);
    expect(owners.size).toBe(1);
    expect(owners.get(toHexStr(COMMITMENT_A))).toBe(OWNER);
  });

  it("is repeatable across distinct inputs (insertion order preserved)", async () => {
    const transfer = new StealthTransfer(stubProvider(), RESOURCE, new FakeStealthCrypto())
      .spendStealthInput(OWNER, COMMITMENT_A)
      .spendStealthInput(OWNER, COMMITMENT_B);

    const spec = await transfer
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1n, resourceAddress: RESOURCE }))
      .prepare();
    const commitments = spec.inputs.map(({ input }) => toHexStr(input.commitment));
    expect(commitments).toEqual([toHexStr(COMMITMENT_A), toHexStr(COMMITMENT_B)]);
  });

  it("rejects a duplicate commitment under the same owner", () => {
    const transfer = new StealthTransfer(stubProvider(), RESOURCE, new FakeStealthCrypto()).spendStealthInput(
      OWNER,
      COMMITMENT_A,
    );
    expect(() => transfer.spendStealthInput(OWNER, COMMITMENT_A)).toThrow(/duplicate commitment/);
  });

  it("rejects the same commitment under a DIFFERENT owner (a commitment is one UTXO)", async () => {
    // A commitment uniquely identifies a UTXO within the resource and a UTXO has exactly one
    // owner — re-adding it under a different owner label would self-double-spend, so it must
    // throw regardless of the owner.
    const otherOwner = "component_" + "d".repeat(64);
    const transfer = new StealthTransfer(stubProvider(), RESOURCE, new FakeStealthCrypto()).spendStealthInput(
      OWNER,
      COMMITMENT_A,
    );
    expect(() => transfer.spendStealthInput(otherOwner, COMMITMENT_A)).toThrow(/duplicate commitment/);
    // The original input (and its owner) is unchanged.
    const owners = await ownersByCommitment(transfer);
    expect(owners.size).toBe(1);
    expect(owners.get(toHexStr(COMMITMENT_A))).toBe(OWNER);
  });

  it("rejects a commitment that is not 32 bytes", () => {
    const transfer = new StealthTransfer(stubProvider(), RESOURCE, new FakeStealthCrypto());
    expect(() => transfer.spendStealthInput(OWNER, fromHexStr("abcd"))).toThrow(/32 bytes/);
  });
});

describe("StealthTransfer.prepare (with stealth inputs)", () => {
  it("builds an inputs statement containing the spent commitments", async () => {
    const crypto = new FakeStealthCrypto();
    const buildSpy = vi.spyOn(crypto, "buildInputsStatement");

    const spec = await new StealthTransfer(stubProvider(), RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 1000n)
      .spendStealthInput(OWNER, COMMITMENT_A)
      .spendStealthInput(OWNER, COMMITMENT_B)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1000n, resourceAddress: RESOURCE }))
      .prepare();

    // The inputs statement carries both commitments in insertion order.
    expect(buildSpy).toHaveBeenCalledTimes(1);
    const [inputs, revealedAmount] = buildSpy.mock.calls[0];
    expect(inputs.map((i) => toHexStr(i.commitment))).toEqual([toHexStr(COMMITMENT_A), toHexStr(COMMITMENT_B)]);
    expect(revealedAmount).toBe(1000n);

    const inputsJson = spec.statement.inputsStatement.statementJson ?? "";
    expect(inputsJson).toContain(toHexStr(COMMITMENT_A));
    expect(inputsJson).toContain(toHexStr(COMMITMENT_B));
  });

  it("registers each stealth input's UTXO substate id as a tx input", async () => {
    const crypto = new FakeStealthCrypto();
    const spec = await new StealthTransfer(stubProvider(), RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 1000n)
      .spendStealthInput(OWNER, COMMITMENT_A)
      .spendStealthInput(OWNER, COMMITMENT_B)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1000n, resourceAddress: RESOURCE }))
      .prepare();

    const inputIds = spec.unsignedTx.inputs.map((i) => i.substate_id);
    expect(inputIds).toContain(stealthUtxoSubstateId(RESOURCE, COMMITMENT_A));
    expect(inputIds).toContain(stealthUtxoSubstateId(RESOURCE, COMMITMENT_B));
  });

  it("lists the revealed source then each stealth owner in requiredSigners (deduped)", async () => {
    const otherOwner = "component_" + "e".repeat(64);
    const crypto = new FakeStealthCrypto();
    const spec = await new StealthTransfer(stubProvider(), RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 500n)
      .spendStealthInput(OWNER, COMMITMENT_A)
      .spendStealthInput(otherOwner, COMMITMENT_B)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 500n, resourceAddress: RESOURCE }))
      .prepare();

    expect(spec.requiredSigners).toEqual([ACCOUNT, OWNER, otherOwner]);
  });

  it("supports a stealth-input-only transfer (no revealed withdraw, null revealed bucket)", async () => {
    const crypto = new FakeStealthCrypto();
    const spec = await new StealthTransfer(stubProvider(), RESOURCE, crypto)
      .spendStealthInput(OWNER, COMMITMENT_A)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 700n, resourceAddress: RESOURCE }))
      .prepare();

    // No withdraw / saveVar — just the StealthTransfer instruction.
    const stealth = spec.unsignedTx.instructions.find(isStealthTransferInstruction);
    if (stealth === undefined) throw new Error("expected a StealthTransfer instruction");
    expect(stealth.StealthTransfer.revealed_input_bucket).toBeNull();
    // The withdraw CallMethod is absent (stealth-input-only).
    const hasWithdraw = spec.unsignedTx.instructions.some(
      (i) => typeof i === "object" && i !== null && "CallMethod" in i && i.CallMethod.method === "withdraw",
    );
    expect(hasWithdraw).toBe(false);
    // Required signers is just the stealth owner (no revealed source).
    expect(spec.requiredSigners).toEqual([OWNER]);
  });
});
