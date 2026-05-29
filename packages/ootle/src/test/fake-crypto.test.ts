//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-free tests for the deterministic fake crypto provider. Proves the fake
// satisfies `StealthCryptoProvider` and offers the round-trips the receive helpers,
// transfer builder, and spend authorizer rely on.

import { describe, expect, it } from "vitest";
import type { StealthCryptoProvider } from "../stealth/crypto-provider";
import { FakeStealthCrypto, sealFakeOutput } from "./fake-crypto";
import { signBalanceProof, statementJsonFor } from "../stealth/balance-proof";
import { Mask, SCALAR_LENGTH, createOutput } from "../stealth/primitives";
import {
  StealthInput,
  StealthInputsStatement,
  StealthOutputsStatement,
  StealthTransferStatement,
} from "../stealth/statements";

const RESOURCE_ADDRESS = "resource_0000000000000000000000000000000000000000000000000000000000000000";

describe("FakeStealthCrypto", () => {
  // Assigning to a typed binding proves the fake structurally satisfies the interface
  // (incl. the optional validateBalanceProofSignature, present here).
  const crypto: StealthCryptoProvider = new FakeStealthCrypto();

  it("satisfies the StealthCryptoProvider interface (assignment compiles)", () => {
    expect(typeof crypto.generateOutputsStatement).toBe("function");
    expect(typeof crypto.buildInputsStatement).toBe("function");
    expect(typeof crypto.generateBalanceProofSignature).toBe("function");
    expect(typeof crypto.validateBalanceProofSignature).toBe("function");
    expect(typeof crypto.deriveAeadKey).toBe("function");
    expect(typeof crypto.unblindOutput).toBe("function");
    expect(typeof crypto.aggregateInputMasks).toBe("function");
    expect(typeof crypto.stealthDhSecret).toBe("function");
    expect(typeof crypto.validateTransfer).toBe("function");
  });

  it("aggregateInputMasks is stable and non-zero for a non-empty list", async () => {
    const a = Mask.fromBytes(new Uint8Array(SCALAR_LENGTH).fill(3));
    const b = Mask.fromBytes(new Uint8Array(SCALAR_LENGTH).fill(7));
    const agg1 = await crypto.aggregateInputMasks([a, b]);
    const agg2 = await crypto.aggregateInputMasks([a, b]);
    expect(agg1.toHex()).toBe(agg2.toHex());
    expect(agg1.toHex()).not.toBe(Mask.zero().toHex());
  });

  it("produces a parseable outputs statement + 32-byte mask", async () => {
    const out = createOutput({ destination: "acc_dest", amount: 1000n, resourceAddress: RESOURCE_ADDRESS });
    const { statement, outputMask } = await crypto.generateOutputsStatement([out], 0n);
    expect(outputMask.toBytes().length).toBe(SCALAR_LENGTH);
    expect(() => statement.parsed()).not.toThrow();
  });

  it("signs a 32+32 balance proof that validates, and validateTransfer does not throw", async () => {
    const out = createOutput({ destination: "acc_dest", amount: 1000n, resourceAddress: RESOURCE_ADDRESS });
    const { statement: outputsStatement, outputMask } = await crypto.generateOutputsStatement([out], 0n);
    const inputsStatement = await crypto.buildInputsStatement([], 1000n);

    const proof = await signBalanceProof(crypto, Mask.zero(), outputMask, inputsStatement, outputsStatement);
    expect(proof.publicNonce.length).toBe(SCALAR_LENGTH);
    expect(proof.signature.length).toBe(SCALAR_LENGTH);

    expect(
      await crypto.validateBalanceProofSignature?.(
        proof,
        statementJsonFor(inputsStatement),
        statementJsonFor(outputsStatement),
      ),
    ).toBe(true);

    const transfer = new StealthTransferStatement(inputsStatement, outputsStatement, proof);
    await expect(crypto.validateTransfer(transfer)).resolves.toBeUndefined();
  });

  it("receive round-trip: sealFakeOutput + unblindOutput recovers value + mask", async () => {
    const value = 4242n;
    const mask = Mask.fromBytes(new Uint8Array(SCALAR_LENGTH).fill(5));
    const aeadKey = await crypto.deriveAeadKey(
      new Uint8Array(SCALAR_LENGTH).fill(1),
      new Uint8Array(SCALAR_LENGTH).fill(2),
    );

    const sealed = sealFakeOutput(value, mask, aeadKey, '{"Message":"hi"}');
    const commitment = new Uint8Array(SCALAR_LENGTH).fill(9);

    const decrypted = await crypto.unblindOutput(commitment, sealed.encryptedData, aeadKey, false);
    expect(decrypted.value).toBe(value);
    expect(decrypted.mask.toHex()).toBe(mask.toHex());
    expect(decrypted.memo).toBe('{"Message":"hi"}');

    // skipMemo drops the memo.
    const noMemo = await crypto.unblindOutput(commitment, sealed.encryptedData, aeadKey, true);
    expect(noMemo.memo).toBeUndefined();

    // A wrong AEAD key throws (the "not owned" signal).
    const wrongKey = new Uint8Array(SCALAR_LENGTH).fill(0xaa);
    await expect(crypto.unblindOutput(commitment, sealed.encryptedData, wrongKey, false)).rejects.toThrow();
  });

  it("buildInputsStatement carries inputs + revealedAmount with a wire JSON", async () => {
    const input = new StealthInput(new Uint8Array(SCALAR_LENGTH).fill(4));
    const statement = await crypto.buildInputsStatement([input], 7n);
    expect(statement).toBeInstanceOf(StealthInputsStatement);
    expect(statement.revealedAmount).toBe(7n);
    const wire = statement.statementJson;
    expect(wire).toBeDefined();
    expect(() => JSON.parse(wire ?? "")).not.toThrow();
  });

  it("stealthDhSecret is deterministic and 32 bytes", async () => {
    const owner = new Uint8Array(SCALAR_LENGTH).fill(1);
    const nonce = new Uint8Array(SCALAR_LENGTH).fill(2);
    const s1 = await crypto.stealthDhSecret(0x10, owner, nonce);
    const s2 = await crypto.stealthDhSecret(0x10, owner, nonce);
    expect(s1.length).toBe(SCALAR_LENGTH);
    expect(Array.from(s1)).toEqual(Array.from(s2));
  });

  it("outputs statement carrier is a StealthOutputsStatement", async () => {
    const out = createOutput({ destination: "x", amount: 1n, resourceAddress: RESOURCE_ADDRESS });
    const { statement } = await crypto.generateOutputsStatement([out], 0n);
    expect(statement).toBeInstanceOf(StealthOutputsStatement);
  });
});
