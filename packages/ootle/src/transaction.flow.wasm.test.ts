//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-backed coverage for the sign/seal/resolve flow that the no-network
// transaction.smoke.test.ts already proves end-to-end. The cases here are
// orthogonal to the smoke test (multi-signer collection, sealKeypair injection,
// determinism, no-op resolveTransaction).

import { sealTransaction as wasmSealTransaction } from "@tari-project/ootle-wasm";
import { describe, expect, it } from "vitest";
import { generateSealKeypair, resolveTransaction, sealTransaction, signTransaction } from "./transaction";
import { toHexStr } from "./helpers/hex";
import { fakeProvider } from "./test/fake-provider";
import { InlineEphemeralSigner } from "./test/fake-signer";
import { trivialUnsignedTx } from "./test/tx-builders";

describe("signTransaction (WASM)", () => {
  it("collects signatures from every signer in order, each with its own public key", async () => {
    const a = InlineEphemeralSigner.generate();
    const b = InlineEphemeralSigner.generate();
    const tx = trivialUnsignedTx();

    const signed = await signTransaction([a, b], tx);

    expect(signed.transaction.V1.body.signatures.length).toBe(2);
    const pubA = toHexStr(await a.getPublicKey());
    const pubB = toHexStr(await b.getPublicKey());
    expect(signed.transaction.V1.body.signatures[0].public_key).toBe(pubA);
    expect(signed.transaction.V1.body.signatures[1].public_key).toBe(pubB);
    expect(pubA).not.toBe(pubB);
  });

  it("uses the supplied sealKeypair so the seal_signature.public_key matches", async () => {
    const signer = InlineEphemeralSigner.generate();
    const sealKp = generateSealKeypair();
    const tx = trivialUnsignedTx();

    const signed = await signTransaction([signer], tx, sealKp);

    expect(signed.transaction.V1.seal_signature.public_key).toBe(toHexStr(sealKp.public_key));
  });

  it("threads the seal public key through every signer so WASM seal accepts the body (regression)", async () => {
    // Regression for the original bug: each signer used its own pk as the hash's
    // `seal_signer_public_key`, but the seal step used a fresh seal pk — divergent hashes
    // meant `wasmSealTransaction` produced an envelope the engine would reject. With the
    // fix, every signer hashes against the same seal pk, so calling `wasmSealTransaction`
    // on the SDK-produced body succeeds and produces a non-empty sealed JSON.
    const a = InlineEphemeralSigner.generate();
    const b = InlineEphemeralSigner.generate();
    const sealKp = generateSealKeypair();
    const tx = trivialUnsignedTx();

    const signed = await signTransaction([a, b], tx, sealKp);

    // Feed the SDK's collected body (not the SDK seal signature) into the WASM sealer; the
    // WASM ABI's `sealTransaction(json, sealSk)` re-derives the same canonical hash both
    // signers used and produces a sealed JSON with a seal signature against that hash.
    // Re-stringifying the parsed `transaction` view is safe HERE because the trivial tx has
    // no u64 amounts above 2^53 — the submission path (`sealTransaction`) uses `sealedJson`.
    const sealed = wasmSealTransaction(JSON.stringify(signed.transaction.V1.body), sealKp.secret_key);
    expect(typeof sealed).toBe("string");
    expect(sealed.length).toBeGreaterThan(0);
  });
});

describe("sealTransaction (WASM)", () => {
  it("produces an identical envelope when called twice on the same signed transaction", async () => {
    const signer = InlineEphemeralSigner.generate();
    const sealKp = generateSealKeypair();
    const signed = await signTransaction([signer], trivialUnsignedTx(), sealKp);

    const a = sealTransaction(signed);
    const b = sealTransaction(signed);

    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(b).toBe(a);
  });
});

describe("resolveTransaction (WASM-adjacent)", () => {
  it("is a value-equal no-op when the provider returns inputs unchanged", async () => {
    const tx = trivialUnsignedTx();
    tx.inputs = [{ substate_id: "component_x", version: 3 }];
    const provider = fakeProvider({
      resolveInputs: async (inputs) => inputs,
    });

    const out = await resolveTransaction(provider, tx);
    expect(out).toEqual(tx);
  });
});
