//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { attachTransactionSignature, generateOotleAddress, hashUnsignedTransaction } from "@tari-project/ootle-wasm";
import { SignerError } from "./errors";
import { assertByteLength } from "./helpers/bytes";
import type { Network } from "./network";
import type { Signer } from "./signer";
import { serializeUnsignedTx } from "./transaction";

/**
 * Signs a 64-byte transaction hash with a key held outside this process (an HSM, an MPC vault, a
 * hardware wallet) and returns the raw 64-byte signature `R ‖ s`.
 *
 * The signature must be Ristretto255 Schnorr as produced by `tari_crypto`'s `RistrettoSchnorr`:
 * `R = k·G`, `s = k + e·x`, where `e` is the 64-byte Blake2b digest of the chain
 * `"com.tari.schnorr_signature.v1.challenge" ‖ R ‖ P ‖ message` (each item prefixed with its length
 * as a little-endian u64), reduced mod ℓ. `R` is a compressed Ristretto point and `s` a canonical
 * little-endian scalar.
 */
export type ExternalSignFn = (message: Uint8Array) => Promise<Uint8Array>;

export interface ExternalKeySignerOptions {
  /** The 32-byte public key of the external key. */
  publicKey: Uint8Array;
  /** The 32-byte view-only public key; with `publicKey` it forms the Ootle address. */
  viewPublicKey: Uint8Array;
  network: Network;
  /** Signs the authorization hash (`hashUnsignedTransaction`). */
  sign: ExternalSignFn;
}

/**
 * A {@link Signer} whose key is held externally. Each `signTransaction` hashes the transaction
 * against the supplied seal public key, asks `sign` for a signature over the hash, and verifies it
 * before returning, so a wrong key or scheme fails here with a {@link SignerError}.
 *
 * @example
 * ```ts
 * const signer = new ExternalKeySigner({
 *   publicKey,
 *   viewPublicKey,
 *   network: Network.Esmeralda,
 *   sign: (hash) => vault.sign(keyId, hash),
 * });
 * const signed = await signTransaction([signer], unsignedTx);
 * ```
 */
export class ExternalKeySigner implements Signer {
  private readonly publicKey: Uint8Array;
  private readonly sign: ExternalSignFn;
  public readonly address: string;

  public constructor(options: ExternalKeySignerOptions) {
    this.publicKey = assertByteLength(options.publicKey, 32, "ExternalKeySigner publicKey");
    assertByteLength(options.viewPublicKey, 32, "ExternalKeySigner viewPublicKey");
    this.sign = options.sign;
    this.address = generateOotleAddress(this.publicKey, options.viewPublicKey, options.network);
  }

  public async getAddress(): Promise<string> {
    return Promise.resolve(this.address);
  }

  public async getPublicKey(): Promise<Uint8Array> {
    return Promise.resolve(this.publicKey);
  }

  public async signTransaction(
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    assertByteLength(sealPublicKey, 32, "ExternalKeySigner.signTransaction sealPublicKey");
    const unsignedJson = serializeUnsignedTx(unsignedTx);
    const signature = await this.sign(hashUnsignedTransaction(unsignedJson, sealPublicKey));
    let unsealedJson: string;
    try {
      unsealedJson = attachTransactionSignature(unsignedJson, this.publicKey, signature, sealPublicKey);
    } catch (e) {
      throw new SignerError(`External signature rejected: ${errorMessage(e)}`, { cause: e });
    }
    const parsed = JSON.parse(unsealedJson) as { signatures: TransactionSignature[] };
    return parsed.signatures;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
