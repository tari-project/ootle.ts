//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only fake `Signer` implementations. `InlineEphemeralSigner` avoids
// importing the real `EphemeralKeySigner` (which lives in
// `@tari-project/ootle-secret-key-wallet`, a dependent package).
// `FixedKeySigner` is the fixed-key variant for deterministic tests.
//
// Not re-exported from the package root; tests import via relative subpath.

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { generateKeypair, hashUnsignedTransaction, schnorrSign } from "@tari-project/ootle-wasm";
import { toHexStr } from "../helpers/hex";
import { serializeUnsignedTx } from "../transaction";
import type { Signer } from "../signer";

/**
 * Minimal in-test signer mirroring `EphemeralKeySigner` (no cross-package import).
 *
 * Generates a fresh random keypair on construction; signs by hashing the
 * transaction's `serializeUnsignedTx` form against the supplied seal public key via
 * `hashUnsignedTransaction`, then `schnorrSign` — the exact same path as the
 * production `EphemeralKeySigner` (`serializeUnsignedTx`, not `JSON.stringify`, so a
 * stealth statement carried as a raw-JSON fragment hashes identically to the real seal).
 */
export class InlineEphemeralSigner implements Signer {
  private readonly secretKey: Uint8Array;
  private readonly publicKey: Uint8Array;

  private constructor(secretKey: Uint8Array, publicKey: Uint8Array) {
    this.secretKey = secretKey;
    this.publicKey = publicKey;
  }

  public static generate(): InlineEphemeralSigner {
    const kp = generateKeypair();
    return new InlineEphemeralSigner(kp.secret_key, kp.public_key);
  }

  public async getAddress(): Promise<string> {
    return Promise.resolve(toHexStr(this.publicKey));
  }

  public async getPublicKey(): Promise<Uint8Array> {
    return Promise.resolve(this.publicKey);
  }

  public async signTransaction(
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    const hash = hashUnsignedTransaction(serializeUnsignedTx(unsignedTx), sealPublicKey);
    const sig = schnorrSign(this.secretKey, hash);
    return Promise.resolve([
      {
        public_key: toHexStr(this.publicKey),
        signature: {
          public_nonce: toHexStr(sig.public_nonce),
          signature: toHexStr(sig.signature),
        },
      },
    ]);
  }
}

/**
 * Like {@link InlineEphemeralSigner} but with caller-supplied fixed keys (from
 * `fixtures.ts`). Use this when a test needs the same public key on both ends
 * of an assertion (e.g. "the signer's public key flowed into the seal hash").
 *
 * Both keys are taken as raw bytes — pass `ALICE_SECRET` / `ALICE_PUBLIC` (or
 * any matching pair) from `./fixtures`. The signature itself is still derived
 * via real WASM `schnorrSign` so it round-trips through the real verifier.
 */
export class FixedKeySigner implements Signer {
  public constructor(
    private readonly secretKey: Uint8Array,
    private readonly publicKey: Uint8Array,
  ) {}

  public async getAddress(): Promise<string> {
    return Promise.resolve(toHexStr(this.publicKey));
  }

  public async getPublicKey(): Promise<Uint8Array> {
    return Promise.resolve(this.publicKey);
  }

  public async signTransaction(
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    const hash = hashUnsignedTransaction(serializeUnsignedTx(unsignedTx), sealPublicKey);
    const sig = schnorrSign(this.secretKey, hash);
    return Promise.resolve([
      {
        public_key: toHexStr(this.publicKey),
        signature: {
          public_nonce: toHexStr(sig.public_nonce),
          signature: toHexStr(sig.signature),
        },
      },
    ]);
  }
}
