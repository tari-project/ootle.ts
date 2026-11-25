//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-free tests for the receive helpers. Uses the deterministic fake crypto:
// `sealFakeOutput` produces an `(encryptedData, aeadKey)` pair that the fake's
// `unblindOutput` recovers, and `deriveAeadKey` is keyed off `(viewSecret, public_nonce)`.

import type { IndexerGetSubstateResponse, OutputBody, SubstateValue, Utxo } from "@tari-project/ootle-ts-bindings";
import { describe, expect, it, vi } from "vitest";
import { InvalidArgumentError } from "../errors";
import { fromHexStr, toHexStr } from "../helpers/hex";
import { FakeStealthCrypto, sealFakeOutput } from "../test/fake-crypto";
import { Mask } from "./primitives";
import { decryptInputData, decryptOwnedUtxo } from "./wallet-helpers";
import { encodeForTest } from "../test/encoded";

const RESOURCE_HEX = "a".repeat(64);
const COMMITMENT_HEX = "0123456789abcdef".repeat(4); // 64 chars
const UTXO_ID = `utxo_${RESOURCE_HEX}_${COMMITMENT_HEX}`;
const PUBLIC_NONCE_HEX = "bb".repeat(32);

// A deterministic view secret (32 bytes) for the recipient.
const VIEW_SECRET = fromHexStr("11".repeat(32));

const VALUE = 4242n;
const MASK = Mask.fromHex("22".repeat(32));

/**
 * Build a UTXO substate whose `encrypted_data` is sealed to the AEAD key the fake derives
 * from `(viewSecret, public_nonce)` — i.e. an output the recipient owns.
 */
async function ownedUtxoSubstate(crypto: FakeStealthCrypto): Promise<IndexerGetSubstateResponse> {
  const publicNonce = fromHexStr(PUBLIC_NONCE_HEX);
  const aeadKey = await crypto.deriveAeadKey(VIEW_SECRET, publicNonce);
  const { encryptedData } = sealFakeOutput(VALUE, MASK, aeadKey, "the-memo");
  const body: OutputBody = {
    public_nonce: PUBLIC_NONCE_HEX,
    encrypted_data: toHexStr(encryptedData),
    minimum_value_promise: 0,
    viewable_balance: null,
  };
  const utxo: Utxo = {
    output: { output: body, auth: {} as never, tag: 0 as never },
    is_frozen: false,
  };
  const substate: SubstateValue = { Utxo: utxo };
  return { version: 0, state: { up: { substate: encodeForTest(substate) } }, verified: true };
}

describe("decryptOwnedUtxo", () => {
  it("returns the DecryptedData for an owned UTXO", async () => {
    const crypto = new FakeStealthCrypto();
    const substate = await ownedUtxoSubstate(crypto);

    const result = await decryptOwnedUtxo(crypto, VIEW_SECRET, substate, UTXO_ID);
    if (result === null) {
      throw new Error("expected the owned UTXO to decrypt");
    }
    expect(result.value).toBe(VALUE);
    expect(result.mask.toHex()).toBe(MASK.toHex());
    expect(result.memo).toBe("the-memo");
  });

  it("derives the AEAD key from (viewSecret, public_nonce bytes) and unblinds with commitment + encrypted-data bytes", async () => {
    const crypto = new FakeStealthCrypto();
    const substate = await ownedUtxoSubstate(crypto);

    const deriveSpy = vi.spyOn(crypto, "deriveAeadKey");
    const unblindSpy = vi.spyOn(crypto, "unblindOutput");

    await decryptOwnedUtxo(crypto, VIEW_SECRET, substate, UTXO_ID);

    // deriveAeadKey(viewSecret, public_nonce_bytes)
    expect(deriveSpy).toHaveBeenCalledTimes(1);
    const [derivePriv, derivePub] = deriveSpy.mock.calls[0];
    expect(toHexStr(derivePriv)).toBe(toHexStr(VIEW_SECRET));
    expect(toHexStr(derivePub)).toBe(PUBLIC_NONCE_HEX);

    // unblindOutput(commitment_bytes, encrypted_data_bytes, aeadKey, skipMemo=false)
    expect(unblindSpy).toHaveBeenCalledTimes(1);
    const [commitment, encryptedData, aeadKey, skipMemo] = unblindSpy.mock.calls[0];
    expect(toHexStr(commitment)).toBe(COMMITMENT_HEX);
    // Encrypted data is raw bytes (a Uint8Array), not a JSON string.
    expect(encryptedData).toBeInstanceOf(Uint8Array);
    const expectedAead = await crypto.deriveAeadKey(VIEW_SECRET, fromHexStr(PUBLIC_NONCE_HEX));
    expect(toHexStr(aeadKey)).toBe(toHexStr(expectedAead));
    expect(skipMemo).toBe(false);
  });

  it("returns null for a non-UTXO substate (does not throw)", async () => {
    const crypto = new FakeStealthCrypto();
    const substate: IndexerGetSubstateResponse = {
      version: 0,
      state: { up: { substate: encodeForTest({ Component: {} }) } },
      verified: true,
    };
    await expect(decryptOwnedUtxo(crypto, VIEW_SECRET, substate, UTXO_ID)).resolves.toBeNull();
  });

  it("returns null (does not throw) when unblindOutput throws — the not-owned signal", async () => {
    const crypto = new FakeStealthCrypto();
    const substate = await ownedUtxoSubstate(crypto);

    // A different view secret derives a different AEAD key, so the fake's unblindOutput
    // throws "not owned" — decryptOwnedUtxo must swallow it and return null.
    const wrongViewSecret = fromHexStr("99".repeat(32));
    await expect(decryptOwnedUtxo(crypto, wrongViewSecret, substate, UTXO_ID)).resolves.toBeNull();
  });

  it("throws InvalidArgumentError (does not swallow) when viewSecret is not 32 bytes", async () => {
    const crypto = new FakeStealthCrypto();
    const substate = await ownedUtxoSubstate(crypto);
    await expect(decryptOwnedUtxo(crypto, new Uint8Array(31), substate, UTXO_ID)).rejects.toThrow(InvalidArgumentError);
  });

  it("returns null (does not throw) when a malformed UTXO public_nonce causes deriveAeadKey to throw InvalidArgumentError", async () => {
    const crypto = new FakeStealthCrypto();
    const body: OutputBody = {
      public_nonce: "bb".repeat(31),
      encrypted_data: "00".repeat(16),
      minimum_value_promise: 0,
      viewable_balance: null,
    };
    const substate: IndexerGetSubstateResponse = {
      version: 0,
      state: {
        up: {
          substate: encodeForTest({
            Utxo: { output: { output: body, auth: {} as never, tag: 0 as never }, is_frozen: false },
          }),
        },
      },
      verified: true,
    };
    vi.spyOn(crypto, "deriveAeadKey").mockRejectedValueOnce(
      new InvalidArgumentError("deriveAeadKey publicKey: expected 32 bytes, got 31"),
    );

    await expect(decryptOwnedUtxo(crypto, VIEW_SECRET, substate, UTXO_ID)).resolves.toBeNull();
  });
});

describe("decryptInputData", () => {
  it("forwards skipMemo and passes the derived aeadKey to unblindOutput", async () => {
    const crypto = new FakeStealthCrypto();
    const publicNonce = fromHexStr(PUBLIC_NONCE_HEX);
    const aeadKey = await crypto.deriveAeadKey(VIEW_SECRET, publicNonce);
    const { encryptedData } = sealFakeOutput(VALUE, MASK, aeadKey, "the-memo");
    const commitment = fromHexStr(COMMITMENT_HEX);

    const deriveSpy = vi.spyOn(crypto, "deriveAeadKey");
    const unblindSpy = vi.spyOn(crypto, "unblindOutput");

    const result = await decryptInputData(crypto, commitment, encryptedData, {
      senderPublicNonce: publicNonce,
      viewSecret: VIEW_SECRET,
      skipMemo: true,
    });

    expect(result.value).toBe(VALUE);
    // skipMemo: true means the fake drops the memo.
    expect(result.memo).toBeUndefined();

    // deriveAeadKey called with (viewSecret, senderPublicNonce).
    const [derivePriv, derivePub] = deriveSpy.mock.calls[0];
    expect(toHexStr(derivePriv)).toBe(toHexStr(VIEW_SECRET));
    expect(toHexStr(derivePub)).toBe(PUBLIC_NONCE_HEX);

    // unblindOutput receives the derived aeadKey and skipMemo=true.
    const [, , passedAead, skipMemo] = unblindSpy.mock.calls[0];
    expect(toHexStr(passedAead)).toBe(toHexStr(aeadKey));
    expect(skipMemo).toBe(true);
  });

  it("propagates the unblindOutput throw (no try/catch here, unlike decryptOwnedUtxo)", async () => {
    const crypto = new FakeStealthCrypto();
    const publicNonce = fromHexStr(PUBLIC_NONCE_HEX);
    const aeadKey = await crypto.deriveAeadKey(VIEW_SECRET, publicNonce);
    const { encryptedData } = sealFakeOutput(VALUE, MASK, aeadKey);
    const commitment = fromHexStr(COMMITMENT_HEX);

    // Wrong view secret → wrong AEAD key → fake throws; decryptInputData does not catch.
    await expect(
      decryptInputData(crypto, commitment, encryptedData, {
        senderPublicNonce: publicNonce,
        viewSecret: fromHexStr("99".repeat(32)),
        skipMemo: false,
      }),
    ).rejects.toThrow();
  });
});
