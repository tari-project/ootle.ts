//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { generateKeypair, generateOotleAddress, schnorrSign } from "@tari-project/ootle-wasm";
import { describe, expect, it } from "vitest";
import { SignerError } from "./errors";
import { ExternalKeySigner } from "./external-signer";
import type { ExternalSignFn } from "./external-signer";
import { toHexStr } from "./helpers/hex";
import { Network } from "./network";
import { generateSealKeypair, sealTransaction, signTransaction } from "./transaction";
import { TEST_NETWORK } from "./test/fixtures";
import { trivialUnsignedTx } from "./test/tx-builders";

/** Stands in for an HSM: signs with a key the SDK never sees and returns the raw `R ‖ s` bytes. */
function vault(secretKey: Uint8Array): ExternalSignFn {
  return async (message) => {
    const { public_nonce, signature } = schnorrSign(secretKey, message);
    return Promise.resolve(new Uint8Array([...public_nonce, ...signature]));
  };
}

function externalSigner(signWith?: Uint8Array): { signer: ExternalKeySigner; publicKey: Uint8Array } {
  const key = generateKeypair();
  const signer = new ExternalKeySigner({
    publicKey: key.public_key,
    viewPublicKey: generateKeypair().public_key,
    network: TEST_NETWORK,
    sign: vault(signWith ?? key.secret_key),
  });
  return { signer, publicKey: key.public_key };
}

describe("ExternalKeySigner (WASM)", () => {
  it("authorizes a transaction sealed with a local seal keypair", async () => {
    const { signer, publicKey } = externalSigner();

    const signed = await signTransaction([signer], trivialUnsignedTx(), generateSealKeypair());

    expect(signed.transaction.V1.body.signatures.map((s) => s.public_key)).toEqual([toHexStr(publicKey)]);
    expect(sealTransaction(signed).length).toBeGreaterThan(0);
  });

  it("rejects a signature made with a different key", async () => {
    const { signer } = externalSigner(generateKeypair().secret_key);

    await expect(signTransaction([signer], trivialUnsignedTx())).rejects.toThrow(SignerError);
  });

  it("rejects a signature of the wrong length", async () => {
    const key = generateKeypair();
    const signer = new ExternalKeySigner({
      publicKey: key.public_key,
      viewPublicKey: generateKeypair().public_key,
      network: TEST_NETWORK,
      sign: async (message) => (await vault(key.secret_key)(message)).subarray(0, 63),
    });

    await expect(signTransaction([signer], trivialUnsignedTx())).rejects.toThrow(/expected 64, got 63/);
  });

  it("derives the Ootle address from the owner and view public keys", async () => {
    const key = generateKeypair();
    const view = generateKeypair();
    const signer = new ExternalKeySigner({
      publicKey: key.public_key,
      viewPublicKey: view.public_key,
      network: Network.LocalNet,
      sign: vault(key.secret_key),
    });

    expect(await signer.getAddress()).toBe(generateOotleAddress(key.public_key, view.public_key, Network.LocalNet));
    expect(await signer.getPublicKey()).toEqual(key.public_key);
  });
});
