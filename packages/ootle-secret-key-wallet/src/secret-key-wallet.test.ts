//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit tests for the non-stealth half of `SecretKeyWallet`. The stealth-side
// methods (`addStealthSignature`, `getViewSecret` happy paths) live in
// `secret-key-wallet.stealth.test.ts` — keep the file split intentional.

import { describe, expect, it } from "vitest";
import { InvalidArgumentError, TransactionBuilder, WalletError, fromHexStr, toHexStr } from "@tari-project/ootle";
import {
  generateKeypair,
  generateOotleAddress,
  generateOotleSecretKey,
  hashUnsignedTransaction,
  ootlePublicKeyFromSecretKey,
  publicKeyFromSecretKey,
} from "@tari-project/ootle-wasm";
import { SecretKeyWallet } from "./secret-key-wallet";
import { TEST_NETWORK } from "./test/fixtures";

const HEX_64 = /^[0-9a-f]{64}$/;

function trivialUnsignedTx() {
  return TransactionBuilder.new(TEST_NETWORK).dropAllProofsInWorkspace().buildUnsignedTransaction();
}

describe("SecretKeyWallet.randomWithViewKey", () => {
  it("creates a wallet that exposes an address, a public key, and a view-only secret", async () => {
    const wallet = SecretKeyWallet.randomWithViewKey(TEST_NETWORK);

    const address = await wallet.getAddress();
    const publicKey = await wallet.getPublicKey();
    const viewSecret = wallet.getViewOnlySecret();

    expect(typeof address).toBe("string");
    expect(address.length).toBeGreaterThan(0);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(32);
    expect(viewSecret).toBeInstanceOf(Uint8Array);
    expect((viewSecret as Uint8Array).length).toBe(32);
  });

  it("produces fresh distinct keys across calls", () => {
    const a = SecretKeyWallet.randomWithViewKey(TEST_NETWORK);
    const b = SecretKeyWallet.randomWithViewKey(TEST_NETWORK);
    expect(toHexStr(a.getViewOnlySecret() as Uint8Array)).not.toBe(toHexStr(b.getViewOnlySecret() as Uint8Array));
  });
});

describe("SecretKeyWallet.fromSecretKey", () => {
  it("derives the public key from the secret via the WASM bridge", async () => {
    const { owner_key } = generateOotleSecretKey();
    const expectedPub = publicKeyFromSecretKey(owner_key);
    const wallet = SecretKeyWallet.fromSecretKey(owner_key, TEST_NETWORK);

    const actualPub = await wallet.getPublicKey();
    expect(Array.from(actualPub)).toEqual(Array.from(expectedPub));
  });

  it("rejects getAddress / getViewSecret with WalletError when no view key is set", async () => {
    const { owner_key } = generateOotleSecretKey();
    const wallet = SecretKeyWallet.fromSecretKey(owner_key, TEST_NETWORK);

    expect(wallet.getViewOnlySecret()).toBeNull();
    await expect(wallet.getAddress()).rejects.toThrow(WalletError);
    await expect(wallet.getAddress()).rejects.toThrow(/View-only key not set/);
    await expect(wallet.getViewSecret()).rejects.toThrow(WalletError);
    await expect(wallet.getViewSecret()).rejects.toThrow(/view-only secret/i);
  });

  it("rejects a non-32-byte secret with InvalidArgumentError carrying `must be 32 bytes`", () => {
    expect(() => SecretKeyWallet.fromSecretKey(new Uint8Array(31), TEST_NETWORK)).toThrow(InvalidArgumentError);
    expect(() => SecretKeyWallet.fromSecretKey(new Uint8Array(31), TEST_NETWORK)).toThrow(/must be 32 bytes, got 31/);
  });

  it("derives a valid address when a view secret is supplied", async () => {
    const { owner_key, view_key } = generateOotleSecretKey();
    const wallet = SecretKeyWallet.fromSecretKey(owner_key, TEST_NETWORK, view_key);

    const address = await wallet.getAddress();
    expect(typeof address).toBe("string");
    expect(address.length).toBeGreaterThan(0);
    expect(wallet.getViewOnlySecret()).toBeInstanceOf(Uint8Array);
  });

  it("derives the same address as the direct WASM derivation (view-key derivation matches)", async () => {
    const { owner_key, view_key } = generateOotleSecretKey();
    const pubKeys = ootlePublicKeyFromSecretKey(owner_key, view_key);
    const expected = generateOotleAddress(pubKeys.owner_key, pubKeys.view_key, TEST_NETWORK);

    const wallet = SecretKeyWallet.fromSecretKey(owner_key, TEST_NETWORK, view_key);
    expect(await wallet.getAddress()).toBe(expected);
  });
});

describe("SecretKeyWallet.fromKeypair", () => {
  it("uses the supplied public key as-is rather than re-deriving it from the secret", async () => {
    const { owner_key } = generateOotleSecretKey();
    // A deliberately-wrong public key: not the WASM-derived value. Verifies the
    // constructor doesn't silently re-derive it.
    const bogusPublicKey = new Uint8Array(32).fill(0xff);
    const wallet = SecretKeyWallet.fromKeypair(owner_key, bogusPublicKey, TEST_NETWORK);

    const pub = await wallet.getPublicKey();
    expect(Array.from(pub)).toEqual(Array.from(bogusPublicKey));
    expect(Array.from(pub)).not.toEqual(Array.from(publicKeyFromSecretKey(owner_key)));
  });

  it("derives a valid address when a view secret is supplied", async () => {
    const { owner_key, view_key } = generateOotleSecretKey();
    const ownerPub = publicKeyFromSecretKey(owner_key);
    const wallet = SecretKeyWallet.fromKeypair(owner_key, ownerPub, TEST_NETWORK, view_key);

    const expected = generateOotleAddress(
      ownerPub,
      ootlePublicKeyFromSecretKey(owner_key, view_key).view_key,
      TEST_NETWORK,
    );
    expect(await wallet.getAddress()).toBe(expected);
  });

  it("rejects getAddress with WalletError when no view key is set", async () => {
    const { owner_key } = generateOotleSecretKey();
    const ownerPub = publicKeyFromSecretKey(owner_key);
    const wallet = SecretKeyWallet.fromKeypair(owner_key, ownerPub, TEST_NETWORK);

    await expect(wallet.getAddress()).rejects.toThrow(WalletError);
    await expect(wallet.getAddress()).rejects.toThrow(/View-only key not set/);
  });
});

describe("SecretKeyWallet.signTransaction", () => {
  it("returns a single signature whose public_key matches the owner public key", async () => {
    const wallet = SecretKeyWallet.randomWithViewKey(TEST_NETWORK);
    const ownerPub = await wallet.getPublicKey();
    const sealPub = generateKeypair().public_key;
    const tx = trivialUnsignedTx();

    const sigs = await wallet.signTransaction(tx, sealPub);

    expect(sigs).toHaveLength(1);
    const [sig] = sigs;
    expect(sig.public_key).toBe(toHexStr(ownerPub));
    expect(sig.signature.public_nonce).toMatch(HEX_64);
    expect(sig.signature.signature).toMatch(HEX_64);
  });

  it("hashes the transaction under the supplied seal public key (WASM-confirmed shape)", async () => {
    const wallet = SecretKeyWallet.randomWithViewKey(TEST_NETWORK);
    const sealPub = generateKeypair().public_key;
    const tx = trivialUnsignedTx();

    // Pull the hash via the same path the production code takes — this is a
    // round-trip sanity check on the bound shape, not an assertion against the
    // signature bytes themselves (Schnorr nonces are random).
    const hash = hashUnsignedTransaction(JSON.stringify(tx), sealPub);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBeGreaterThan(0);

    const [sig] = await wallet.signTransaction(tx, sealPub);
    expect(fromHexStr(sig.signature.signature).length).toBe(32);
    expect(fromHexStr(sig.signature.public_nonce).length).toBe(32);
  });

  it("rejects a non-32-byte seal public key", async () => {
    const wallet = SecretKeyWallet.randomWithViewKey(TEST_NETWORK);
    const tx = trivialUnsignedTx();
    await expect(wallet.signTransaction(tx, new Uint8Array(31))).rejects.toThrow(InvalidArgumentError);
  });
});
