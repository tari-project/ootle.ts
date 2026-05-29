//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-backed round-trip tests for the crypto seam. The vitest harness inlines
// `@tari-project/ootle-wasm`, so these exercise the actual 0.32 crypto, not a fake.
// Pure-logic / fake-provider tests live in ../test/fake-crypto.test.ts (no WASM needed).

import { describe, expect, it } from "vitest";
import { generateOotleSecretKey, ootlePublicKeyFromSecretKey, generateOotleAddress } from "@tari-project/ootle-wasm";
import { fromHexStr } from "../helpers/hex";
import { Network } from "../network";
import { WasmStealthCrypto } from "./wasm-crypto";
import { signBalanceProof, statementJsonFor } from "./balance-proof";
import { Mask, SCALAR_LENGTH, createOutput, type Output } from "./primitives";
import { StealthInputsStatement, StealthOutputsStatement, StealthTransferStatement } from "./statements";

const RESOURCE_ADDRESS = "resource_0000000000000000000000000000000000000000000000000000000000000000";

/** A throwaway recipient: secret key + the Ootle address derived from it. */
function makeRecipient(): { viewSecret: Uint8Array; ownerSecret: Uint8Array; address: string } {
  const secrets = generateOotleSecretKey();
  const pub = ootlePublicKeyFromSecretKey(secrets.owner_key, secrets.view_key);
  const address = generateOotleAddress(pub.owner_key, pub.view_key, Network.LocalNet);
  return { viewSecret: secrets.view_key, ownerSecret: secrets.owner_key, address };
}

/** A single 1000 µTari output to a fresh recipient. */
function makeOutput(address: string, amount = 1000n): Output {
  return createOutput({ destination: address, amount, resourceAddress: RESOURCE_ADDRESS });
}

describe("WasmStealthCrypto.generateOutputsStatement", () => {
  it("round-trips a single output to a non-empty statement + 32-byte mask", async () => {
    const crypto = new WasmStealthCrypto(Network.LocalNet);
    const { address } = makeRecipient();

    const { statement, outputMask } = await crypto.generateOutputsStatement([makeOutput(address)], 0n);

    expect(outputMask.toBytes().length).toBe(SCALAR_LENGTH);
    expect(statement.statementJson.length).toBeGreaterThan(0);
    // The carried wire JSON is parseable.
    expect(() => statement.parsed()).not.toThrow();
    const parsed = statement.parsed() as { outputs: unknown[] };
    expect(Array.isArray(parsed.outputs)).toBe(true);
    expect(parsed.outputs.length).toBe(1);
  });
});

describe("WasmStealthCrypto.aggregateInputMasks", () => {
  it("is deterministic and 32 bytes for a 2-mask aggregate", async () => {
    const crypto = new WasmStealthCrypto();
    const a = Mask.fromBytes(new Uint8Array(SCALAR_LENGTH).fill(3));
    const b = Mask.fromBytes(new Uint8Array(SCALAR_LENGTH).fill(7));

    const agg1 = await crypto.aggregateInputMasks([a, b]);
    const agg2 = await crypto.aggregateInputMasks([a, b]);

    expect(agg1.toBytes().length).toBe(SCALAR_LENGTH);
    expect(agg1.toHex()).toBe(agg2.toHex());
    // A non-trivial aggregate of two non-zero masks must not be all-zero.
    expect(agg1.toHex()).not.toBe(Mask.zero().toHex());
  });
});

describe("WasmStealthCrypto balance proof + validateTransfer (no stealth input)", () => {
  it("signs, validates the signature, and validateTransfer does not throw", async () => {
    const crypto = new WasmStealthCrypto(Network.LocalNet);
    const { address } = makeRecipient();
    const amount = 1000n;

    // All confidential output of `amount`, balanced by an equal *revealed* input amount
    // and a zero input mask (the no-stealth-input / revealed-only send path).
    const { statement: outputsStatement, outputMask } = await crypto.generateOutputsStatement(
      [makeOutput(address, amount)],
      0n,
    );
    const inputsStatement = await crypto.buildInputsStatement([], amount);

    const proof = await signBalanceProof(crypto, Mask.zero(), outputMask, inputsStatement, outputsStatement);
    expect(proof.publicNonce.length).toBe(SCALAR_LENGTH);
    expect(proof.signature.length).toBe(SCALAR_LENGTH);

    const inputsJson = statementJsonFor(inputsStatement);
    const outputsJson = statementJsonFor(outputsStatement);
    expect(await crypto.validateBalanceProofSignature(proof, inputsJson, outputsJson)).toBe(true);

    const transfer = new StealthTransferStatement(inputsStatement, outputsStatement, proof);
    await expect(crypto.validateTransfer(transfer)).resolves.toBeUndefined();
  });
});

describe("WasmStealthCrypto receive round-trip (deriveAeadKey + unblindOutput)", () => {
  it("recovers value + 32-byte mask, and throws on a wrong AEAD key", async () => {
    const crypto = new WasmStealthCrypto(Network.LocalNet);
    const recipient = makeRecipient();
    const amount = 1234n;

    const { statement } = await crypto.generateOutputsStatement([makeOutput(recipient.address, amount)], 0n);
    // Pull the on-wire output (commitment, sender nonce, ciphertext) from the statement.
    const parsed = statement.parsed() as {
      outputs: { output: { commitment: string; sender_public_nonce: string; encrypted_data: string } }[];
    };
    const out = parsed.outputs[0].output;
    const commitment = fromHexStr(out.commitment);
    const senderNonce = fromHexStr(out.sender_public_nonce);
    const encryptedData = fromHexStr(out.encrypted_data);

    // Receiver derives the AEAD key from (viewSecret, sender_public_nonce).
    const aeadKey = await crypto.deriveAeadKey(recipient.viewSecret, senderNonce);
    const decrypted = await crypto.unblindOutput(commitment, encryptedData, aeadKey, false);

    expect(decrypted.value).toBe(amount);
    expect(decrypted.mask.toBytes().length).toBe(SCALAR_LENGTH);

    // A wrong AEAD key must throw — the "not owned" signal the receive helper relies on.
    const wrongKey = new Uint8Array(SCALAR_LENGTH).fill(9);
    await expect(crypto.unblindOutput(commitment, encryptedData, wrongKey, false)).rejects.toThrow();
  });
});

describe("WasmStealthCrypto.stealthDhSecret", () => {
  it("is deterministic and 32 bytes", async () => {
    const crypto = new WasmStealthCrypto(Network.LocalNet);
    const recipient = makeRecipient();
    const { statement } = await crypto.generateOutputsStatement([makeOutput(recipient.address)], 0n);
    const parsed = statement.parsed() as { outputs: { output: { sender_public_nonce: string } }[] };
    const nonce = fromHexStr(parsed.outputs[0].output.sender_public_nonce);

    const s1 = await crypto.stealthDhSecret(Network.LocalNet, recipient.ownerSecret, nonce);
    const s2 = await crypto.stealthDhSecret(Network.LocalNet, recipient.ownerSecret, nonce);

    expect(s1.length).toBe(SCALAR_LENGTH);
    expect(Array.from(s1)).toEqual(Array.from(s2));
  });
});

describe("statementJsonFor", () => {
  it("returns the WASM-produced inputs JSON byte-exact", async () => {
    const crypto = new WasmStealthCrypto();
    const inputsStatement = await crypto.buildInputsStatement([], 500n);
    expect(statementJsonFor(inputsStatement)).toBe(inputsStatement.statementJson);
  });

  it("refuses to re-derive a confidential inputs statement that lacks WASM bytes", () => {
    // A non-empty inputs statement with no cached WASM string must not be re-derived
    // structurally (silent signature mismatch). Construct one directly to assert the guard.
    const fakeCommitment = new Uint8Array(SCALAR_LENGTH).fill(1);
    const statement = new StealthInputsStatement(
      [{ commitment: fakeCommitment, toJSON: () => ({ commitment: "" }) } as never],
      0n,
    );
    expect(() => statementJsonFor(statement)).toThrow(/buildInputsStatement/);
  });

  it("returns the outputs statement JSON byte-exact", () => {
    const wire = '{"outputs":[],"revealed_output_amount":"0"}';
    const outputs = StealthOutputsStatement.fromJSON(wire);
    expect(statementJsonFor(outputs)).toBe(wire);
  });
});
