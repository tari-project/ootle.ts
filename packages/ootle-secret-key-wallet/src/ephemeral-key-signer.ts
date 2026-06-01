//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { addTransactionSigner, generateKeypair, generateOotleAddress } from "@tari-project/ootle-wasm";
import { Network, Signer, assertByteLength, serializeUnsignedTx } from "@tari-project/ootle";

/**
 * A one-shot signer that generates a fresh throwaway keypair, signs once,
 * and exposes no way to reuse the key. Used for privacy-preserving transactions
 * where the sender wants no link between the transaction and their identity.
 *
 * **No stealth spending support by design.** This signer holds no view key, so it
 * deliberately does **not** implement the optional `Signer.getViewSecret`/
 * `Signer.addStealthSignature` members. Stealth scanning and one-time spend-key signing
 * require a view secret + owner secret pair — use {@link SecretKeyWallet} for that.
 *
 * @example
 * ```ts
 * const signer = EphemeralKeySigner.generate();
 * const signed = await signTransaction([signer], unsignedTx);
 * ```
 */
export class EphemeralKeySigner implements Signer {
  private readonly secretKey: Uint8Array;
  private readonly publicKey: Uint8Array;
  public readonly address: string;

  private constructor(secretKey: Uint8Array, publicKey: Uint8Array, network: Network) {
    this.secretKey = secretKey;
    this.publicKey = publicKey;
    const randomKeypair = generateKeypair();
    this.address = generateOotleAddress(publicKey, randomKeypair.public_key, network);
  }

  /**
   * Generates a fresh ephemeral keypair. The secret key exists only for the
   * lifetime of this object and is never persisted.
   *
   * The WASM `generateKeypair` already returns 32-byte halves; the explicit
   * assertion is defence-in-depth so an upstream WASM regression surfaces here
   * rather than silently mis-signing further down the line.
   */
  public static generate(network = Network.Esmeralda): EphemeralKeySigner {
    const keypair = generateKeypair();
    assertByteLength(keypair.secret_key, 32, "EphemeralKeySigner secret_key");
    assertByteLength(keypair.public_key, 32, "EphemeralKeySigner public_key");
    return new EphemeralKeySigner(keypair.secret_key, keypair.public_key, network);
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
    assertByteLength(sealPublicKey, 32, "EphemeralKeySigner.signTransaction sealPublicKey");
    const signedJson = addTransactionSigner(serializeUnsignedTx(unsignedTx), this.secretKey, sealPublicKey);
    const parsed = JSON.parse(signedJson) as { signatures: TransactionSignature[] };
    return Promise.resolve(parsed.signatures);
  }
}
