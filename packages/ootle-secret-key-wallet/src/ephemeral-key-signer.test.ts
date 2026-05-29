//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit tests for the `EphemeralKeySigner`. The production class generates a
// fresh keypair on each `.generate()` and signs once via the same WASM path as
// `SecretKeyWallet.signTransaction` — these tests assert that contract end-to-
// end with real WASM in the loop.

import { describe, expect, it } from "vitest";
import { InvalidArgumentError, TransactionBuilder, fromHexStr, toHexStr } from "@tari-project/ootle";
import { generateKeypair } from "@tari-project/ootle-wasm";
import { EphemeralKeySigner } from "./ephemeral-key-signer";
import { TEST_NETWORK } from "./test/fixtures";

const HEX_64 = /^[0-9a-f]{64}$/;

function trivialUnsignedTx() {
  return TransactionBuilder.new(TEST_NETWORK).dropAllProofsInWorkspace().buildUnsignedTransaction();
}

describe("EphemeralKeySigner.generate", () => {
  it("returns a usable signer with a 32-byte public key and a non-empty address", async () => {
    const signer = EphemeralKeySigner.generate(TEST_NETWORK);
    const pub = await signer.getPublicKey();
    const address = await signer.getAddress();

    expect(pub).toBeInstanceOf(Uint8Array);
    expect(pub.length).toBe(32);
    expect(typeof address).toBe("string");
    expect(address.length).toBeGreaterThan(0);
  });

  it("produces distinct keypairs across calls", async () => {
    const a = EphemeralKeySigner.generate(TEST_NETWORK);
    const b = EphemeralKeySigner.generate(TEST_NETWORK);
    expect(toHexStr(await a.getPublicKey())).not.toBe(toHexStr(await b.getPublicKey()));
  });
});

describe("EphemeralKeySigner.signTransaction", () => {
  it("returns one signature whose public_key matches the signer's public key", async () => {
    const signer = EphemeralKeySigner.generate(TEST_NETWORK);
    const sealPub = generateKeypair().public_key;
    const tx = trivialUnsignedTx();

    const sigs = await signer.signTransaction(tx, sealPub);

    expect(sigs).toHaveLength(1);
    const [sig] = sigs;
    expect(sig.public_key).toBe(toHexStr(await signer.getPublicKey()));
    expect(sig.signature.public_nonce).toMatch(HEX_64);
    expect(sig.signature.signature).toMatch(HEX_64);
    expect(fromHexStr(sig.signature.signature).length).toBe(32);
  });

  it("rejects a non-32-byte seal public key", async () => {
    const signer = EphemeralKeySigner.generate(TEST_NETWORK);
    const tx = trivialUnsignedTx();
    await expect(signer.signTransaction(tx, new Uint8Array(31))).rejects.toThrow(InvalidArgumentError);
  });
});
