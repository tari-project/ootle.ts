//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";

/**
 * A Signer is responsible only for signing. It has no read or submit capability.
 * Implementations include SecretKeyWallet (local WASM signing) and WalletDaemonSigner (remote daemon).
 */
export interface Signer {
  /** Returns the component address derived from this signer's public key. */
  getAddress(): Promise<string>;

  /** Returns the raw public key bytes for this signer. */
  getPublicKey(): Promise<Uint8Array>;

  /**
   * Signs the given unsigned transaction and returns the collected signatures.
   *
   * `sealPublicKey` is mixed into the transaction hash
   * (`hashUnsignedTransaction(JSON.stringify(tx), sealPublicKey)`) so every signature in the
   * final envelope verifies against the SAME hash — the engine's seal verification enforces
   * this. Implementations MUST hash with the supplied `sealPublicKey`, not their own.
   */
  signTransaction(transaction: UnsignedTransactionV1, sealPublicKey: Uint8Array): Promise<TransactionSignature[]>;

  /**
   * Returns the view-only secret for stealth scanning/spending, if this signer holds one.
   *
   * **Optional** — a signer may not hold a view secret (e.g. `EphemeralKeySigner` has no
   * view key; `WalletDaemonSigner` keeps it server-side). The spend authorizer treats this
   * as a fallback: it takes the view secret explicitly from the transfer spec and only
   * calls this when the spec does not carry one.
   */
  getViewSecret?(): Promise<Uint8Array>;

  /**
   * Produces a one-time spend-key signature for a stealth input.
   *
   * The signer derives the one-time spend scalar (`c + k`) for the owned stealth UTXO via
   * `ctx.crypto.stealthDhSecret(...)` and signs the transaction hash with it.
   *
   * **Optional** — only signers that hold the owner secret (e.g. `SecretKeyWallet`) can
   * implement this. Daemon-delegated stealth is server-side and out of scope here.
   *
   * @param unsignedJson - The (compact) JSON of the unsigned transaction to hash + sign.
   * @param publicNonce - The stealth output's sender public nonce (the DH counterparty).
   * @param sealPublicKey - The seal signer's public key, mixed into the transaction hash
   *   (mirrors the `hashUnsignedTransaction` arg used by {@link Signer.signTransaction}).
   * @param ctx - Injected crypto seam, so the signer never imports WASM directly.
   */
  addStealthSignature?(
    unsignedJson: string,
    publicNonce: Uint8Array,
    sealPublicKey: Uint8Array,
    ctx: { crypto: SignerStealthCrypto },
  ): Promise<TransactionSignature>;
}

/**
 * The exact subset of `StealthCryptoProvider` that {@link Signer.addStealthSignature} needs.
 *
 * Defined here alongside `Signer` so the stealth-agnostic core never depends on the stealth
 * module's full surface. The wider `StealthCryptoProvider` is structurally a supertype, so
 * `WasmStealthCrypto` and `FakeStealthCrypto` flow through as-is.
 */
export interface SignerStealthCrypto {
  stealthDhSecret(networkByte: number, ownerSecret: Uint8Array, publicNonce: Uint8Array): Promise<Uint8Array>;
}
