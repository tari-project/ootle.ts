//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import {
  addTransactionSigner,
  generateOotleAddress,
  generateOotleSecretKey,
  ootlePublicKeyFromSecretKey,
  publicKeyFromSecretKey,
} from "@tari-project/ootle-wasm";
import { Network, Signer, WalletError, assertByteLength } from "@tari-project/ootle";

/**
 * The injected-crypto argument of {@link Signer.addStealthSignature}, derived from the
 * interface so this package never imports the internal `stealth/` module directly.
 */
type AddStealthSignatureCtx = Parameters<NonNullable<Signer["addStealthSignature"]>>[3];

/**
 * A local signer that holds a secret key (and optional view-only key) in memory,
 * using the WASM module for transaction hashing and Schnorr signing.
 *
 * For production use, prefer `WalletDaemonSigner` so the secret key never lives
 * in JavaScript memory.
 *
 * Prefer {@link SecretKeyWallet.getViewSecret} for view-secret access;
 * {@link SecretKeyWallet.getViewOnlySecret} is retained for back-compat.
 */
export class SecretKeyWallet implements Signer {
  private readonly ownerSecretKey: Uint8Array;
  private readonly ownerPublicKey: Uint8Array;
  private readonly viewOnlySecret: Uint8Array | null;
  private readonly viewOnlyPublicKey: Uint8Array | null;
  public readonly network: Network;

  private constructor(
    ownerSecretKey: Uint8Array,
    ownerPublicKey: Uint8Array,
    network: Network,
    viewOnlySecret?: Uint8Array | null,
    viewOnlyPublicKey?: Uint8Array | null,
  ) {
    this.ownerSecretKey = ownerSecretKey;
    this.ownerPublicKey = ownerPublicKey;
    this.viewOnlySecret = viewOnlySecret ?? null;
    this.viewOnlyPublicKey = viewOnlyPublicKey ?? null;
    this.network = network;
  }

  /**
   * Generates a fresh random account keypair and a separate random view-only key.
   * The view-only key is used for stealth/confidential output scanning.
   * Mirrors `OotleSecretKey { account_secret, view_only_secret }` from ootle-rs.
   */
  public static randomWithViewKey(network: Network): SecretKeyWallet {
    const secretKeys = generateOotleSecretKey();
    const pubKeys = ootlePublicKeyFromSecretKey(secretKeys.owner_key, secretKeys.view_key);
    return new SecretKeyWallet(secretKeys.owner_key, pubKeys.owner_key, network, secretKeys.view_key, pubKeys.view_key);
  }

  /**
   * Creates a wallet from an existing hex-encoded account secret key.
   * The public key is derived via `wasm.derivePublicKey`.
   *
   * @throws {InvalidArgumentError} if `ownerSecretKey` (or `viewOnlySecret`, when
   *   supplied) is not exactly 32 bytes.
   */
  public static fromSecretKey(
    ownerSecretKey: Uint8Array,
    network: Network,
    viewOnlySecret?: Uint8Array,
  ): SecretKeyWallet {
    assertByteLength(ownerSecretKey, 32, "SecretKeyWallet.fromSecretKey ownerSecretKey");
    if (viewOnlySecret !== undefined) {
      assertByteLength(viewOnlySecret, 32, "SecretKeyWallet.fromSecretKey viewOnlySecret");
    }
    const ownerPublicKey = publicKeyFromSecretKey(ownerSecretKey);
    return new SecretKeyWallet(ownerSecretKey, ownerPublicKey, network, viewOnlySecret ?? null);
  }

  /**
   * Creates a wallet directly from a secret key and its corresponding public key.
   * Use this overload if you already have both keys (e.g. from key storage).
   *
   * @throws {InvalidArgumentError} if `ownerSecretKey`, `ownerPublicKey`, or
   *   `viewOnlySecret` (when supplied) is not exactly 32 bytes.
   */
  public static fromKeypair(
    ownerSecretKey: Uint8Array,
    ownerPublicKey: Uint8Array,
    network: Network,
    viewOnlySecret?: Uint8Array,
  ): SecretKeyWallet {
    assertByteLength(ownerSecretKey, 32, "SecretKeyWallet.fromKeypair ownerSecretKey");
    assertByteLength(ownerPublicKey, 32, "SecretKeyWallet.fromKeypair ownerPublicKey");
    if (viewOnlySecret !== undefined) {
      assertByteLength(viewOnlySecret, 32, "SecretKeyWallet.fromKeypair viewOnlySecret");
    }
    return new SecretKeyWallet(ownerSecretKey, ownerPublicKey, network, viewOnlySecret ?? null);
  }

  /**
   * @throws {WalletError} when the view-only key has not been set on this wallet.
   */
  public async getAddress(): Promise<string> {
    if (!this.viewOnlyPublicKey) {
      throw new WalletError(
        "View-only key not set. Construct the wallet via SecretKeyWallet.randomWithViewKey(), " +
          "or pass a `viewOnlySecret` to SecretKeyWallet.fromKeypair() / SecretKeyWallet.fromSecretKey().",
      );
    }
    const address = generateOotleAddress(this.ownerPublicKey, this.viewOnlyPublicKey, this.network);
    return Promise.resolve(address);
  }

  public async getPublicKey(): Promise<Uint8Array> {
    return Promise.resolve(this.ownerPublicKey);
  }

  /**
   * Returns the view-only secret key, if one was set.
   * Used for stealth/confidential output scanning.
   *
   * @deprecated Use {@link getViewSecret} instead. This method signals a missing
   *   view key via a `null` return; `getViewSecret` throws a `WalletError` with
   *   an actionable message.
   */
  public getViewOnlySecret(): Uint8Array | null {
    return this.viewOnlySecret;
  }

  /**
   * Returns the view-only secret for stealth scanning/spending ({@link Signer.getViewSecret}).
   *
   * Intentionally duplicates {@link getViewOnlySecret} (the pre-existing synchronous public
   * accessor): this async method conforms to the `Signer` interface, while the original is
   * kept unchanged to avoid a breaking API change.
   *
   * @throws {WalletError} when no view-only secret is set on this wallet (e.g. a wallet
   *   built via {@link fromSecretKey}/{@link fromKeypair} without a view secret).
   */
  public async getViewSecret(): Promise<Uint8Array> {
    const viewSecret = this.getViewOnlySecret();
    if (!viewSecret) {
      throw new WalletError(
        "No view-only secret set on this wallet. Create it via SecretKeyWallet.randomWithViewKey(), " +
          "or pass a view secret to fromSecretKey()/fromKeypair().",
      );
    }
    return viewSecret;
  }

  /**
   * Produces a one-time spend-key signature for a stealth input ({@link Signer.addStealthSignature}).
   *
   * Derives the one-time spend scalar (`c + k`) for the owned stealth UTXO via
   * `stealthDhSecret(network, ownerSecret, publicNonce)`, then signs via the WASM
   * `addTransactionSigner` (same path as {@link signTransaction}).
   *
   * The returned {@link TransactionSignature} carries the one-time spend public key (not the
   * wallet's owner public key) — it authorizes the specific stealth UTXO being spent.
   */
  public async addStealthSignature(
    unsignedJson: string,
    publicNonce: Uint8Array,
    sealPublicKey: Uint8Array,
    ctx: AddStealthSignatureCtx,
  ): Promise<TransactionSignature> {
    const oneTimeSpendKey = await ctx.crypto.stealthDhSecret(this.network, this.ownerSecretKey, publicNonce);
    const signedJson = addTransactionSigner(unsignedJson, oneTimeSpendKey, sealPublicKey);
    const parsed = JSON.parse(signedJson) as { signatures: TransactionSignature[] };
    return parsed.signatures[parsed.signatures.length - 1];
  }

  public async signTransaction(
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    assertByteLength(sealPublicKey, 32, "SecretKeyWallet.signTransaction sealPublicKey");
    const signedJson = addTransactionSigner(JSON.stringify(unsignedTx), this.ownerSecretKey, sealPublicKey);
    const parsed = JSON.parse(signedJson) as { signatures: TransactionSignature[] };
    return parsed.signatures;
  }
}
