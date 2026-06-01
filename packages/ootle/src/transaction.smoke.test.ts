//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// No-network smoke test for the existing (non-stealth) transaction flow on
// `@tari-project/ootle-wasm@0.32.0`. It builds a tiny UnsignedTransactionV1, signs it,
// and seals it — proving `generateKeypair` + `hashUnsignedTransaction` + `schnorrSign`
// + `borEncodeTransaction` still work after the bump, with no regression.
//
// The signer is the shared `InlineEphemeralSigner` from `./test/fake-signer`. We
// cannot import the real `EphemeralKeySigner` / `SecretKeyWallet` here: they live in
// `@tari-project/ootle-secret-key-wallet`, which depends on `@tari-project/ootle` —
// importing it back would be a circular dependency. The shared fake uses the exact
// same WASM crypto path (`generateKeypair` → `hashUnsignedTransaction` → `schnorrSign`).
import { describe, expect, it } from "vitest";
import { Network } from "./network";
import { sealTransaction, signTransaction } from "./transaction";
import { InlineEphemeralSigner } from "./test/fake-signer";
import { trivialUnsignedTx } from "./test/tx-builders";

describe("transaction sign + seal smoke test (no network)", () => {
  it("signs and seals a minimal transaction after the 0.32 bump", async () => {
    const signer = InlineEphemeralSigner.generate();

    const unsignedTx = trivialUnsignedTx(Network.LocalNet);

    const signed = await signTransaction([signer], unsignedTx);
    expect(signed.transaction, "signTransaction must return a V1 transaction").toHaveProperty("V1");
    expect(signed.transaction.V1.body.signatures.length, "the signer's signature must be collected").toBe(1);
    expect(signed.transaction.V1.seal_signature.public_key, "a seal signature must be assembled").toBeTruthy();

    const envelope = sealTransaction(signed);
    expect(typeof envelope, "sealTransaction must return a base64 TransactionEnvelope string").toBe("string");
    expect(envelope.length, "the sealed envelope must be non-empty").toBeGreaterThan(0);
  });
});
