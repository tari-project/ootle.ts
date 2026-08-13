//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit tests for the send-side wallet helper `generateOutputsStatement` — the
// one-shot "build a complete transfer statement from output specs" entry point
// exported from the package root.
//
// It is a thin composition, but the composition is the contract: a stealth-output-only
// transfer has NO stealth inputs, so the helper must build a revealed-only inputs
// statement with a ZERO revealed-input amount and sign the balance proof against a
// ZERO input mask. Getting either wrong produces a statement that fails validation
// on-chain, so both are asserted here rather than assumed.
//
// Uses the fake crypto seam (no WASM): what is under test is the wiring, and the
// fake makes the mask/amount arguments observable.

import { describe, expect, it, vi } from "vitest";
import { generateOutputsStatement } from "./wallet-helpers";
import { createOutput, Mask } from "./primitives";
import { StealthTransferStatement } from "./statements";
import { FakeStealthCrypto } from "../test/fake-crypto";
import { InvalidArgumentError } from "../errors";
import { TEST_ACCOUNT_ADDRESS, XTR_RESOURCE } from "../test/fixtures";

function outputSpec(amount: bigint) {
  return createOutput({ destination: TEST_ACCOUNT_ADDRESS, amount, resourceAddress: XTR_RESOURCE });
}

describe("generateOutputsStatement", () => {
  it("returns a complete statement carrying a balance proof", async () => {
    const crypto = new FakeStealthCrypto();

    const statement = await generateOutputsStatement(crypto, [outputSpec(1_000n)], 0n);

    expect(statement).toBeInstanceOf(StealthTransferStatement);
    expect(statement.balanceProof).toBeDefined();
    // A complete statement must serialise to the signed wire form without throwing.
    expect(() => statement.toCompactJson()).not.toThrow();
  });

  it("builds a revealed-only inputs statement with zero revealed input amount", async () => {
    const crypto = new FakeStealthCrypto();
    const buildInputsStatement = vi.spyOn(crypto, "buildInputsStatement");

    const statement = await generateOutputsStatement(crypto, [outputSpec(1_000n)], 250n);

    // No stealth inputs, and the revealed INPUT amount is 0 — the 250n passed by the
    // caller is the revealed OUTPUT amount and must not leak onto the inputs side.
    expect(buildInputsStatement).toHaveBeenCalledExactlyOnceWith([], 0n);
    expect(statement.inputsStatement.inputs).toEqual([]);
    expect(statement.inputsStatement.revealedAmount).toBe(0n);
  });

  it("threads the revealed output amount to the outputs statement", async () => {
    const crypto = new FakeStealthCrypto();
    const generate = vi.spyOn(crypto, "generateOutputsStatement");
    const specs = [outputSpec(1_000n), outputSpec(2_000n)];

    await generateOutputsStatement(crypto, specs, 250n);

    expect(generate).toHaveBeenCalledExactlyOnceWith(specs, 250n);
  });

  it("signs the balance proof against a ZERO input mask", async () => {
    const crypto = new FakeStealthCrypto();
    const sign = vi.spyOn(crypto, "generateBalanceProofSignature");

    await generateOutputsStatement(crypto, [outputSpec(1_000n)], 0n);

    expect(sign).toHaveBeenCalledTimes(1);
    const [inputMask] = sign.mock.calls[0];
    expect(inputMask.toHex()).toBe(Mask.zero().toHex());
  });

  it("throws InvalidArgumentError when no outputs are supplied", async () => {
    const crypto = new FakeStealthCrypto();

    await expect(generateOutputsStatement(crypto, [], 0n)).rejects.toThrow(InvalidArgumentError);
    await expect(generateOutputsStatement(crypto, [], 0n)).rejects.toThrow(
      /at least one stealth output is required/,
    );
  });

  it("does not call into the crypto seam at all when the spec list is empty", async () => {
    const crypto = new FakeStealthCrypto();
    const generate = vi.spyOn(crypto, "generateOutputsStatement");

    await expect(generateOutputsStatement(crypto, [], 0n)).rejects.toThrow(InvalidArgumentError);

    expect(generate).not.toHaveBeenCalled();
  });
});
