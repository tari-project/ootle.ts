//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit coverage for `OotleWallet`. The wallet routes (does not aggregate) — its
// `signTransaction` delegates to the *default* signer only. The
// `authorizeTransactionAll` path is what collects from every registered signer.
// These tests pin both behaviours so the routing contract stays explicit.
//
// Where a test exercises the real WASM signing path (i.e. `signTransaction` or
// `authorizeTransaction`), the signers are constructed from a freshly-generated
// real Ristretto keypair — `ALICE_PUBLIC` from `fixtures.ts` is a synthetic
// `a2`-repeated byte string that the WASM `hashUnsignedTransaction` correctly
// rejects as an invalid compressed Ristretto point.

import { describe, expect, it } from "vitest";
import { generateKeypair } from "@tari-project/ootle-wasm";
import { OotleWallet } from "./wallet";
import { DefaultSignerNotSetError, KeyProviderNotFoundError } from "./errors";
import { TEST_ACCOUNT_ADDRESS } from "./test/fixtures";
import { FixedKeySigner, InlineEphemeralSigner } from "./test/fake-signer";
import { trivialUnsignedTx } from "./test/tx-builders";
import { toHexStr } from "./helpers/hex";

const ALICE_ADDRESS = TEST_ACCOUNT_ADDRESS;
const BOB_ADDRESS = "component_" + "cd".repeat(32);

/** Produce a real Ristretto keypair for tests that touch the WASM signing path. */
function realKeypair(): { secret: Uint8Array; public: Uint8Array } {
  const kp = generateKeypair();
  return { secret: kp.secret_key, public: kp.public_key };
}

/** Shared seal pk for tests that don't care about its value (any 32 valid bytes work). */
const SEAL_PK = generateKeypair().public_key;

describe("OotleWallet", () => {
  it("signs a transaction using the registered default signer", async () => {
    const aliceKp = realKeypair();
    const alice = new FixedKeySigner(aliceKp.secret, aliceKp.public);
    const wallet = new OotleWallet().registerKeyProvider(ALICE_ADDRESS, alice).setDefaultSigner(ALICE_ADDRESS);

    const sigs = await wallet.signTransaction(trivialUnsignedTx(), SEAL_PK);
    expect(sigs.length).toBe(1);
    expect(sigs[0].public_key).toBe(toHexStr(aliceKp.public));
  });

  it("setDefaultSigner throws KeyProviderNotFoundError when the address has no registered provider", () => {
    const wallet = new OotleWallet();
    expect(() => wallet.setDefaultSigner(ALICE_ADDRESS)).toThrow(KeyProviderNotFoundError);
    expect(() => wallet.setDefaultSigner(ALICE_ADDRESS)).toThrow(
      `No key provider registered for address: ${ALICE_ADDRESS}`,
    );
  });

  it("getAddress throws DefaultSignerNotSetError when no default signer has been set", async () => {
    const aliceKp = realKeypair();
    const wallet = new OotleWallet().registerKeyProvider(
      ALICE_ADDRESS,
      new FixedKeySigner(aliceKp.secret, aliceKp.public),
    );
    await expect(wallet.getAddress()).rejects.toThrow(DefaultSignerNotSetError);
    await expect(wallet.getAddress()).rejects.toThrow("No default signer address set. Call setDefaultSigner() first.");
  });

  it("signTransaction throws DefaultSignerNotSetError when no default signer has been set", async () => {
    const aliceKp = realKeypair();
    const wallet = new OotleWallet().registerKeyProvider(
      ALICE_ADDRESS,
      new FixedKeySigner(aliceKp.secret, aliceKp.public),
    );
    await expect(wallet.signTransaction(trivialUnsignedTx(), SEAL_PK)).rejects.toThrow(DefaultSignerNotSetError);
    await expect(wallet.signTransaction(trivialUnsignedTx(), SEAL_PK)).rejects.toThrow(
      "No default signer address set. Call setDefaultSigner() first.",
    );
  });

  it("routes signTransaction to the default signer only (does not aggregate across signers)", async () => {
    const aliceKp = realKeypair();
    const bobKp = realKeypair();
    const wallet = new OotleWallet()
      .registerKeyProvider(ALICE_ADDRESS, new FixedKeySigner(aliceKp.secret, aliceKp.public))
      .registerKeyProvider(BOB_ADDRESS, new FixedKeySigner(bobKp.secret, bobKp.public))
      .setDefaultSigner(BOB_ADDRESS);

    const sigs = await wallet.signTransaction(trivialUnsignedTx(), SEAL_PK);

    expect(sigs.length).toBe(1);
    expect(sigs[0].public_key).toBe(toHexStr(bobKp.public));
  });

  it("authorizeTransaction signs as the named signer regardless of default", async () => {
    const aliceKp = realKeypair();
    const bobKp = realKeypair();
    const wallet = new OotleWallet()
      .registerKeyProvider(ALICE_ADDRESS, new FixedKeySigner(aliceKp.secret, aliceKp.public))
      .registerKeyProvider(BOB_ADDRESS, new FixedKeySigner(bobKp.secret, bobKp.public))
      .setDefaultSigner(ALICE_ADDRESS);

    const auth = await wallet.authorizeTransaction(BOB_ADDRESS, trivialUnsignedTx(), SEAL_PK);
    expect(auth.signerAddress).toBe(BOB_ADDRESS);
    expect(auth.signatures[0].public_key).toBe(toHexStr(bobKp.public));
  });

  it("authorizeTransaction throws KeyProviderNotFoundError when the signer address is not registered", async () => {
    const wallet = new OotleWallet();
    await expect(wallet.authorizeTransaction(ALICE_ADDRESS, trivialUnsignedTx(), SEAL_PK)).rejects.toThrow(
      KeyProviderNotFoundError,
    );
    await expect(wallet.authorizeTransaction(ALICE_ADDRESS, trivialUnsignedTx(), SEAL_PK)).rejects.toThrow(
      `No key provider registered for address: ${ALICE_ADDRESS}`,
    );
  });

  it("authorizeTransactionAll collects one authorization per registered signer", async () => {
    const aliceKp = realKeypair();
    const alice = new FixedKeySigner(aliceKp.secret, aliceKp.public);
    const bob = InlineEphemeralSigner.generate();
    const wallet = new OotleWallet().registerKeyProvider(ALICE_ADDRESS, alice).registerKeyProvider(BOB_ADDRESS, bob);

    const auths = await wallet.authorizeTransactionAll(trivialUnsignedTx(), SEAL_PK);
    expect(auths.length).toBe(2);
    const addresses = auths.map((a) => a.signerAddress).sort();
    expect(addresses).toEqual([ALICE_ADDRESS, BOB_ADDRESS].sort());
  });

  it("getKeyProvider and getSignerAddresses report the registered providers", () => {
    const aliceKp = realKeypair();
    const alice = new FixedKeySigner(aliceKp.secret, aliceKp.public);
    const wallet = new OotleWallet().registerKeyProvider(ALICE_ADDRESS, alice);
    expect(wallet.getKeyProvider(ALICE_ADDRESS)).toBe(alice);
    expect(wallet.getKeyProvider(BOB_ADDRESS)).toBeUndefined();
    expect(wallet.getSignerAddresses()).toEqual([ALICE_ADDRESS]);
  });
});
