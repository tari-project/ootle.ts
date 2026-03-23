//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import {
  generateOotleAddress,
  generateOotleSecretKey,
  hashUnsignedTransaction,
  ootlePublicKeyFromSecretKey,
  publicKeyFromSecretKey,
  schnorrSign,
} from "@tari-project/ootle-wasm";
import { Network, Signer, toHexStr } from "@tari-project/ootle";

/**
 * A local signer that holds a secret key (and optional view-only key) in memory,
 * using the WASM module for transaction hashing and Schnorr signing.
 *
 * For production use, prefer `WalletDaemonSigner` so the secret key never lives
 * in JavaScript memory.
 */
export class SecretKeyWallet implements Signer {
  private readonly ownerSecretKey: Uint8Array;
  private readonly ownerPublicKey: Uint8Array;
  private readonly viewOnlySecretHex: Uint8Array | null;
  private readonly viewOnlyPublicKey: Uint8Array | null;
  public readonly network: Network;

  private constructor(
    ownerSecretKey: Uint8Array,
    ownerPublicKey: Uint8Array,
    network: Network,
    viewOnlySecretHex?: Uint8Array | null,
    viewOnlyPublicKey?: Uint8Array | null,
  ) {
    this.ownerSecretKey = ownerSecretKey;
    this.ownerPublicKey = ownerPublicKey;
    this.viewOnlySecretHex = viewOnlySecretHex ?? null;
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
   */
  public static fromSecretKey(
    ownerSecretKey: Uint8Array,
    network: Network,
    viewOnlySecretHex?: Uint8Array,
  ): SecretKeyWallet {
    const ownerPublicKey = publicKeyFromSecretKey(ownerSecretKey);
    return new SecretKeyWallet(ownerSecretKey, ownerPublicKey, network, viewOnlySecretHex ?? null);
  }

  /**
   * Creates a wallet directly from a secret key and its corresponding public key.
   * Use this overload if you already have both keys (e.g. from key storage).
   */
  public static fromKeypair(
    ownerSecretKey: Uint8Array,
    ownerPublicKey: Uint8Array,
    network: Network,
    viewOnlySecretHex?: Uint8Array,
  ): SecretKeyWallet {
    return new SecretKeyWallet(ownerSecretKey, ownerPublicKey, network, viewOnlySecretHex ?? null);
  }

  public async getAddress(): Promise<string> {
    if (!this.viewOnlyPublicKey) {
      throw new Error("View-only key not set. Call SecretKeyWallet.randomWithViewKey() first.");
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
   */
  public getViewOnlySecret(): Uint8Array | null {
    return this.viewOnlySecretHex;
  }

  public async signTransaction(unsignedTx: UnsignedTransactionV1): Promise<TransactionSignature[]> {
    const hashBytes = hashUnsignedTransaction(JSON.stringify(unsignedTx), this.ownerPublicKey);
    const sig = schnorrSign(this.ownerSecretKey, hashBytes);
    return Promise.resolve([
      {
        public_key: toHexStr(this.ownerPublicKey),
        signature: {
          public_nonce: toHexStr(sig.public_nonce),
          signature: toHexStr(sig.signature),
        },
      },
    ]);
  }
}
