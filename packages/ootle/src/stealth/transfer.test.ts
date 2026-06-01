//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-free tests for the send-side stealth transfer builder. Uses the deterministic
// fake crypto and a minimal stubbed Provider. Asserts the emitted instructions match
// the VERIFIED native `StealthTransfer` instruction shape (NOT the legacy
// `deposit_stealth` CallMethod stub), that the statement is carried as byte-exact
// compact JSON, and that inputs resolve through the stub provider.

import type { SubstateRequirement } from "@tari-project/ootle-ts-bindings";
import { describe, expect, it, vi } from "vitest";
import { Network } from "../network";
import type { Provider } from "../provider";
import { FakeStealthCrypto } from "../test/fake-crypto";
import { createOutput } from "./primitives";
import { isStealthTransferInstruction, RAW_JSON_FRAGMENT } from "./instruction";
import { StealthTransfer } from "./transfer";
import { fromHexStr as fromHexStrLocal } from "../helpers/hex";

const RESOURCE = "resource_" + "a".repeat(64);
const ACCOUNT = "component_" + "b".repeat(64);
// A valid Ootle address string is not parsed by the fake crypto, so any string works.
const DESTINATION = "account_dest_address";

/** A minimal Provider that only implements what the builder/authorizer call. */
function stubProvider(overrides: Partial<Provider> = {}): Provider {
  const base: Provider = {
    network: () => Network.LocalNet,
    // `resolveInputs` echoes inputs back with version filled in (the only path prepare hits).
    resolveInputs: vi.fn(async (inputs: SubstateRequirement[]) =>
      inputs.map((i) => ({ ...i, version: i.version ?? 0 })),
    ),
    // `getSubstate` is called by the SDK's vault walker when prepare() has a revealed source.
    // Default to a vault-less Component so tests that don't care about vault inputs pass through.
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

describe("StealthTransfer.prepare", () => {
  it("emits the native StealthTransfer instruction (not deposit_stealth) carrying the statement as compact JSON", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();

    const transfer = new StealthTransfer(provider, RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 1000n)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1000n, resourceAddress: RESOURCE }))
      .payFeeFromRevealed(50n);

    const spec = await transfer.prepare();

    const instrs = spec.unsignedTx.instructions;
    // withdraw -> saveVar -> StealthTransfer (no revealed change deposit here).
    expect(instrs.length).toBe(3);

    // 1. revealed withdraw is a CallMethod "withdraw" with BOR-CBOR Literal args:
    //    resource address as Tag(131, bytes(32)), amount as [lo_u64, hi_u64].
    //    RESOURCE = "resource_" + "a".repeat(64); 1000 = 0x03e8 → uint16 (0x19 0x03 0xe8).
    const withdraw = instrs[0];
    expect(withdraw).toHaveProperty("CallMethod");
    if (typeof withdraw !== "object" || !("CallMethod" in withdraw)) throw new Error("expected CallMethod");
    expect(withdraw.CallMethod.method).toBe("withdraw");
    expect(withdraw.CallMethod.args).toEqual([
      { Literal: "d8835820" + "a".repeat(64) },
      { Literal: "821903e800" },
    ]);

    // 2. saveVar (PutLastInstructionOutputOnWorkspace).
    expect(instrs[1]).toHaveProperty("PutLastInstructionOutputOnWorkspace");

    // 3. the native StealthTransfer instruction — NOT a CallMethod / deposit_stealth.
    const stealth = instrs[2];
    expect(isStealthTransferInstruction(stealth)).toBe(true);
    if (!isStealthTransferInstruction(stealth)) throw new Error("expected StealthTransfer instruction");
    expect(stealth).not.toHaveProperty("CallMethod");
    // resource_address_ref is { Address: <resource> }.
    expect(stealth.StealthTransfer.resource_address_ref).toEqual({ Address: RESOURCE });
    // revealed_input_bucket is a WorkspaceOffsetId pointing at the withdraw bucket.
    expect(stealth.StealthTransfer.revealed_input_bucket).toEqual({ id: 0, offset: null });

    // The statement is carried as the byte-exact canonical compact JSON fragment (NOT
    // deposit_stealth's JSON.stringify), spliced into the serialized tx by serializeUnsignedTx.
    const fragment = (stealth.StealthTransfer.statement as unknown as { [RAW_JSON_FRAGMENT]: string })[
      RAW_JSON_FRAGMENT
    ];
    expect(fragment).toBe(spec.statement.toCompactJson());
    // The incomplete statement has the inputs/outputs envelope keys and no balance proof
    // yet (the authorizer fills it). `balance_proof` is omitted from the compact JSON.
    expect(fragment).not.toContain("balance_proof");
    expect(fragment).toContain("inputs_statement");
    expect(fragment).toContain("outputs_statement");
  });

  it("resolves inputs through the provider", async () => {
    const crypto = new FakeStealthCrypto();
    const resolveInputs = vi.fn(async (inputs: SubstateRequirement[]) => inputs.map((i) => ({ ...i, version: 7 })));
    const provider = stubProvider({ resolveInputs });

    await new StealthTransfer(provider, RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 500n)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 500n, resourceAddress: RESOURCE }))
      .prepare();

    expect(resolveInputs).toHaveBeenCalledTimes(1);
  });

  it("supports multiple stealth outputs (toStealthOutput is repeatable)", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();

    const spec = await new StealthTransfer(provider, RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 900n)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 400n, resourceAddress: RESOURCE }))
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 500n, resourceAddress: RESOURCE }))
      .prepare();

    expect(spec.state.outputs.length).toBe(2);
    // Still exactly one stealth instruction regardless of output count.
    const stealthInstrs = spec.unsignedTx.instructions.filter(isStealthTransferInstruction);
    expect(stealthInstrs.length).toBe(1);
  });

  it("emits a revealed-change deposit when toRevealedOutput is used", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();

    const spec = await new StealthTransfer(provider, RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 1000n)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 600n, resourceAddress: RESOURCE }))
      .toRevealedOutput(400n)
      .prepare();

    // withdraw -> saveVar -> StealthTransfer -> saveVar -> deposit (change).
    const instrs = spec.unsignedTx.instructions;
    expect(instrs.length).toBe(5);
    const deposit = instrs[4];
    expect(deposit).toHaveProperty("CallMethod");
    if (typeof deposit !== "object" || !("CallMethod" in deposit)) throw new Error("expected CallMethod");
    expect(deposit.CallMethod.method).toBe("deposit");
  });

  it("throws when there are no inputs", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();
    const transfer = new StealthTransfer(provider, RESOURCE, crypto).toStealthOutput(
      createOutput({ destination: DESTINATION, amount: 100n, resourceAddress: RESOURCE }),
    );
    await expect(transfer.prepare()).rejects.toThrow(/no inputs/);
  });

  it("throws when there are no outputs", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();
    const transfer = new StealthTransfer(provider, RESOURCE, crypto).spendRevealedInput(ACCOUNT, 100n);
    await expect(transfer.prepare()).rejects.toThrow(/no outputs/);
  });

  it("throws when the balance equation does not hold", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();
    const transfer = new StealthTransfer(provider, RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 1000n)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 700n, resourceAddress: RESOURCE }));
    // 1000 in != 700 out.
    await expect(transfer.prepare()).rejects.toThrow(/unbalanced/);
  });

  it("rejects spendRevealedInput from two different accounts", () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();
    const transfer = new StealthTransfer(provider, RESOURCE, crypto).spendRevealedInput(ACCOUNT, 100n);
    expect(() => transfer.spendRevealedInput("component_" + "c".repeat(64), 100n)).toThrow(/one account/);
  });

  it("throws a reachable error when revealed change is requested without a revealed source", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();
    const transfer = new StealthTransfer(provider, RESOURCE, crypto)
      .spendStealthInput(ACCOUNT, fromHexStrLocal("aa".repeat(32)))
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1n, resourceAddress: RESOURCE }))
      .toRevealedOutput(500n);
    // No spendRevealedInput call — the revealed change has nowhere to land. The type system
    // no longer rules this out (the source is part of the optional `revealedInput` tag), but
    // it is a real user error and `validate()` catches it with a guiding message.
    await expect(transfer.prepare()).rejects.toThrow(/revealed change requires a revealed source/);
  });

  it("adds the revealed source account and every vault it touches to tx.inputs", async () => {
    const crypto = new FakeStealthCrypto();
    const vaultA = "vault_" + "11".repeat(32);
    const vaultB = "vault_" + "22".repeat(32);
    const componentState = {
      vaults: [
        { "@cbor": "tag", tag: 132, value: { "@cbor": "bytes", hex: "11".repeat(32) } },
        { "@cbor": "tag", tag: 132, value: { "@cbor": "bytes", hex: "22".repeat(32) } },
      ],
    };
    const provider = stubProvider({
      getSubstate: vi.fn(async () => ({
        address: ACCOUNT,
        version: 0,
        substate: { Component: { body: { state: componentState } } },
        created_by_transaction: "",
      })) as unknown as Provider["getSubstate"],
    });

    const spec = await new StealthTransfer(provider, RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 1000n)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1000n, resourceAddress: RESOURCE }))
      .prepare();

    const inputIds = spec.unsignedTx.inputs.map((i) => i.substate_id);
    expect(inputIds).toContain(ACCOUNT);
    expect(inputIds).toContain(vaultA);
    expect(inputIds).toContain(vaultB);
  });

  it("does not query getSubstate when there is no revealed input (stealth-input-only)", async () => {
    const crypto = new FakeStealthCrypto();
    const getSubstate = vi.fn();
    const provider = stubProvider({ getSubstate });

    await new StealthTransfer(provider, RESOURCE, crypto)
      .spendStealthInput(ACCOUNT, fromHexStrLocal("aa".repeat(32)))
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1n, resourceAddress: RESOURCE }))
      .prepare();

    expect(getSubstate).not.toHaveBeenCalled();
  });

  it("throws on a second prepare() (does not re-emit instructions into the same builder)", async () => {
    const crypto = new FakeStealthCrypto();
    const provider = stubProvider();
    const transfer = new StealthTransfer(provider, RESOURCE, crypto)
      .spendRevealedInput(ACCOUNT, 1000n)
      .toStealthOutput(createOutput({ destination: DESTINATION, amount: 1000n, resourceAddress: RESOURCE }));

    await transfer.prepare();
    await expect(transfer.prepare()).rejects.toThrow(/already prepared/);
  });
});
