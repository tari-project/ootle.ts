//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import * as sr25519 from "@scure/sr25519";
import { generateKeypair, generateOotleAddress } from "@tari-project/ootle-wasm";
import { describe, expect, it } from "vitest";
import { SignerError } from "./errors";
import { ExternalKeySigner } from "./external-signer";
import type { ExternalSignFn } from "./external-signer";
import { toHexStr } from "./helpers/hex";
import { Network } from "./network";
import { generateSealKeypair, sealTransaction, signTransaction } from "./transaction";
import { TEST_NETWORK } from "./test/fixtures";
import { trivialUnsignedTx } from "./test/tx-builders";

/** An sr25519 key held outside the SDK, as an HSM or MPC vault would hold it. */
function vaultKey(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const secretKey = sr25519.secretFromSeed(crypto.getRandomValues(new Uint8Array(32)));
  return { secretKey, publicKey: sr25519.getPublicKey(secretKey) };
}

/** Stands in for the vault's raw-signing API: a standard `substrate`-context sr25519 signature. */
function vault(secretKey: Uint8Array): ExternalSignFn {
  return async (message) => Promise.resolve(sr25519.sign(secretKey, message));
}

function externalSigner(signWith?: Uint8Array): { signer: ExternalKeySigner; publicKey: Uint8Array } {
  const key = vaultKey();
  const signer = new ExternalKeySigner({
    publicKey: key.publicKey,
    viewPublicKey: generateKeypair().public_key,
    network: TEST_NETWORK,
    sign: vault(signWith ?? key.secretKey),
  });
  return { signer, publicKey: key.publicKey };
}

describe("ExternalKeySigner (WASM)", () => {
  it("authorizes a transaction sealed with a local seal keypair", async () => {
    const { signer, publicKey } = externalSigner();

    const signed = await signTransaction([signer], trivialUnsignedTx(), generateSealKeypair());

    expect(signed.transaction.V1.body.signatures.map((s) => s.public_key)).toEqual([toHexStr(publicKey)]);
    expect(sealTransaction(signed).length).toBeGreaterThan(0);
  });

  it("makes the external key the main signer when the transaction declares none", async () => {
    const { signer, publicKey } = externalSigner();

    const signed = await signTransaction([signer], trivialUnsignedTx());

    expect(signed.transaction.V1.body.transaction.main_signer).toEqual({ Authorizer: toHexStr(publicKey) });
  });

  it("rejects a signature made with a different key", async () => {
    const { signer } = externalSigner(vaultKey().secretKey);

    await expect(signTransaction([signer], trivialUnsignedTx())).rejects.toThrow(SignerError);
  });

  it("rejects a signature of the wrong length", async () => {
    const key = vaultKey();
    const signer = new ExternalKeySigner({
      publicKey: key.publicKey,
      viewPublicKey: generateKeypair().public_key,
      network: TEST_NETWORK,
      sign: async (message) => (await vault(key.secretKey)(message)).subarray(0, 63),
    });

    await expect(signTransaction([signer], trivialUnsignedTx())).rejects.toThrow(/expected 64, got 63/);
  });

  it("derives the Ootle address from the owner and view public keys", async () => {
    const key = vaultKey();
    const view = generateKeypair();
    const signer = new ExternalKeySigner({
      publicKey: key.publicKey,
      viewPublicKey: view.public_key,
      network: Network.LocalNet,
      sign: vault(key.secretKey),
    });

    expect(await signer.getAddress()).toBe(generateOotleAddress(key.publicKey, view.public_key, Network.LocalNet));
    expect(await signer.getPublicKey()).toEqual(key.publicKey);
  });
});
