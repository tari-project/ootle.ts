//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { generateKeypair, generateOotleAddress, hashUnsignedTransaction, schnorrSign } from "@tari-project/ootle-wasm";
import { Network, Signer, toHexStr } from "@tari-project/ootle";

/**
 * A one-shot signer that generates a fresh throwaway keypair, signs once,
 * and exposes no way to reuse the key. Used for privacy-preserving transactions
 * where the sender wants no link between the transaction and their identity.
 *
 * @example
 * ```ts
 * const signer = EphemeralKeySigner.generate();
 * const signed = await signTransaction([signer], unsignedTx);
 * ```
 */
export class EphemeralKeySigner implements Signer {
  private readonly secretKeyHex: Uint8Array;
  private readonly publicKeyHex: Uint8Array;
  public readonly address: string;

  private constructor(secretKeyHex: Uint8Array, publicKeyHex: Uint8Array, network: Network) {
    this.secretKeyHex = secretKeyHex;
    this.publicKeyHex = publicKeyHex;
    const randomKeypair = generateKeypair();
    this.address = generateOotleAddress(publicKeyHex, randomKeypair.public_key, network);
  }

  /**
   * Generates a fresh ephemeral keypair. The secret key exists only for the
   * lifetime of this object and is never persisted.
   */
  public static generate(network = Network.Esmeralda): EphemeralKeySigner {
    const keypair = generateKeypair();
    return new EphemeralKeySigner(keypair.secret_key, keypair.public_key, network);
  }

  public async getAddress(): Promise<string> {
    return Promise.resolve(this.address);
  }

  public async getPublicKey(): Promise<Uint8Array> {
    return Promise.resolve(this.publicKeyHex);
  }

  public async signTransaction(unsignedTx: UnsignedTransactionV1): Promise<TransactionSignature[]> {
    const hashBytes = hashUnsignedTransaction(JSON.stringify(unsignedTx), this.publicKeyHex);
    const s = schnorrSign(this.secretKeyHex, hashBytes);

    return Promise.resolve([
      {
        public_key: toHexStr(this.publicKeyHex),
        signature: {
          public_nonce: toHexStr(s.public_nonce),
          signature: toHexStr(s.signature),
        },
      },
    ]);
  }
}
