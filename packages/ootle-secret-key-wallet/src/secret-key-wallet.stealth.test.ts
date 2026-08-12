//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-backed tests for the stealth capability on `SecretKeyWallet`. The vitest
// config inlines `@tari-project/ootle-wasm` so the real 0.38 crypto runs here.
// `addStealthSignature` takes an injected crypto provider; this test wraps the
// WASM `stealthDhSecret` in a minimal stub (the only method it calls).

import { describe, expect, it } from "vitest";
import {
  generateKeypair,
  generateOotleSecretKey,
  ootlePublicKeyFromSecretKey,
  stealthDhSecret as wasmStealthDhSecret,
} from "@tari-project/ootle-wasm";
import { TransactionBuilder } from "@tari-project/ootle";
import { SecretKeyWallet } from "./secret-key-wallet";
import { TEST_NETWORK } from "./test/fixtures";

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * A fixed, valid 32-byte sender public nonce (a real compressed Ristretto point — a
 * random byte string is rejected by `stealthDhSecret`). Generated once from a throwaway
 * keypair so the DH derivation is reproducible across the cases below.
 */
const PUBLIC_NONCE = generateKeypair().public_key;

/**
 * Minimal `StealthCryptoProvider`-shaped stub: `SecretKeyWallet.addStealthSignature` only
 * uses `stealthDhSecret`, so only that method is implemented (backed by real WASM).
 */
const cryptoCtx = {
  crypto: {
    stealthDhSecret: (network: number, ownerSecret: Uint8Array, publicNonce: Uint8Array): Promise<Uint8Array> =>
      Promise.resolve(wasmStealthDhSecret(network, ownerSecret, publicNonce)),
  },
} as Parameters<NonNullable<SecretKeyWallet["addStealthSignature"]>>[3];

/**
 * A minimal, schema-valid unsigned transaction. Built via `TransactionBuilder` (rather than
 * a hand-written literal) so its JSON carries every field `hashUnsignedTransaction` requires.
 */
function makeUnsignedJson(): string {
  const unsignedTx = TransactionBuilder.new(TEST_NETWORK).dropAllProofsInWorkspace().buildUnsignedTransaction();
  return JSON.stringify(unsignedTx);
}

describe("SecretKeyWallet.getViewSecret", () => {
  it("resolves to the same bytes as getViewOnlySecret() when a view key is set", async () => {
    const wallet = SecretKeyWallet.randomWithViewKey(TEST_NETWORK);
    const fromAccessor = wallet.getViewOnlySecret();
    const fromSigner = await wallet.getViewSecret();

    expect(fromAccessor).not.toBeNull();
    expect(Array.from(fromSigner)).toEqual(Array.from(fromAccessor as Uint8Array));
  });

  it("rejects with a clear error when no view key is set", async () => {
    const { owner_key } = generateOotleSecretKey();
    const wallet = SecretKeyWallet.fromSecretKey(owner_key, TEST_NETWORK);

    expect(wallet.getViewOnlySecret()).toBeNull();
    await expect(wallet.getViewSecret()).rejects.toThrow(/view-only secret/i);
  });
});

describe("SecretKeyWallet.addStealthSignature", () => {
  it("returns a well-formed TransactionSignature with all hex fields populated", async () => {
    const wallet = SecretKeyWallet.randomWithViewKey(TEST_NETWORK);
    const unsignedJson = makeUnsignedJson();
    const sealPublicKey = await wallet.getPublicKey();

    const sig = await wallet.addStealthSignature(unsignedJson, PUBLIC_NONCE, sealPublicKey, cryptoCtx);

    expect(sig.public_key).toMatch(HEX_64);
    expect(sig.signature.public_nonce).toMatch(HEX_64);
    expect(sig.signature.signature).toMatch(HEX_64);
  });

  it("uses the one-time spend public key, not the wallet's owner public key", async () => {
    const wallet = SecretKeyWallet.randomWithViewKey(TEST_NETWORK);
    const unsignedJson = makeUnsignedJson();
    const ownerPublicKey = await wallet.getPublicKey();

    const sig = await wallet.addStealthSignature(unsignedJson, PUBLIC_NONCE, ownerPublicKey, cryptoCtx);

    // The one-time spend key is derived from the DH secret, so its public key differs from
    // the wallet's owner public key (it authorizes the specific stealth UTXO).
    expect(sig.public_key).not.toBe(Buffer.from(ownerPublicKey).toString("hex"));
  });

  it("derives a deterministic one-time spend key for fixed inputs", async () => {
    // Fixed owner secret + view secret so the spend-key derivation is reproducible. The
    // one-time spend key (and thus the signature's `public_key`) is a pure function of
    // (network, ownerSecret, publicNonce) via `stealthDhSecret`, so it reproduces exactly.
    const secrets = generateOotleSecretKey();
    const pub = ootlePublicKeyFromSecretKey(secrets.owner_key, secrets.view_key);
    const wallet = SecretKeyWallet.fromKeypair(secrets.owner_key, pub.owner_key, TEST_NETWORK, secrets.view_key);
    const unsignedJson = makeUnsignedJson();
    const sealPublicKey = pub.owner_key;

    const sig1 = await wallet.addStealthSignature(unsignedJson, PUBLIC_NONCE, sealPublicKey, cryptoCtx);
    const sig2 = await wallet.addStealthSignature(unsignedJson, PUBLIC_NONCE, sealPublicKey, cryptoCtx);

    expect(sig1.public_key).toBe(sig2.public_key);
    // NOTE: `schnorrSign` uses a fresh random nonce per call, so the signature pair
    // (`public_nonce`/`signature`) intentionally differs between runs — both must still
    // validate against the same `public_key`. We assert the deterministic spend-key
    // derivation, not the per-call random Schnorr nonce.
    expect(sig1.signature.public_nonce).not.toBe(sig2.signature.public_nonce);
  });
});
