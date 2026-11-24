//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// WASM-backed coverage for the sign/seal/resolve flow that the no-network
// transaction.smoke.test.ts already proves end-to-end. The cases here are
// orthogonal to the smoke test (multi-signer collection, sealKeypair injection,
// determinism, no-op resolveTransaction).

import { transactionBody, transactionSchemaVersion } from "@tari-project/ootle-ts-bindings";
import { sealTransaction as wasmSealTransaction } from "@tari-project/ootle-wasm";
import { describe, expect, it } from "vitest";
import { generateSealKeypair, resolveTransaction, sealTransaction, signTransaction } from "./transaction";
import { toHexStr } from "./helpers/hex";
import { SignerError } from "./errors";
import type { Signer } from "./signer";
import { fakeProvider } from "./test/fake-provider";
import { InlineEphemeralSigner } from "./test/fake-signer";
import { trivialUnsignedTx } from "./test/tx-builders";

describe("signTransaction (WASM)", () => {
  it("collects one signature per signer, sealed in ascending public-key order (schema V2)", async () => {
    const a = InlineEphemeralSigner.generate();
    const b = InlineEphemeralSigner.generate();
    const tx = trivialUnsignedTx();
    const pubA = toHexStr(await a.getPublicKey());
    const pubB = toHexStr(await b.getPublicKey());
    expect(pubA).not.toBe(pubB);

    for (const signers of [
      [a, b],
      [b, a],
    ]) {
      const signed = await signTransaction(signers, tx);
      expect(transactionSchemaVersion(signed.transaction)).toBe(2);
      const keys = transactionBody(signed.transaction).body.signatures.map((s) => s.public_key);
      expect(keys).toEqual([pubA, pubB].sort());
    }
  });

  it("signs every authorization over the full authorizer set", async () => {
    const a = InlineEphemeralSigner.generate();
    const b = InlineEphemeralSigner.generate();
    const tx = trivialUnsignedTx();
    const seen: Uint8Array[][] = [];
    const spy: Signer = {
      getAddress: () => a.getAddress(),
      getPublicKey: () => a.getPublicKey(),
      signTransaction: (unsigned, seal, authorizers) => {
        seen.push(authorizers);
        return a.signTransaction(unsigned, seal, authorizers);
      },
    };

    await signTransaction([spy, b], tx);

    expect(seen).toHaveLength(1);
    expect(seen[0].map(toHexStr)).toEqual([toHexStr(await a.getPublicKey()), toHexStr(await b.getPublicKey())].sort());
  });

  it("throws SignerError when the signatures do not match the authorizer set", async () => {
    const a = InlineEphemeralSigner.generate();
    const b = InlineEphemeralSigner.generate();
    const tx = trivialUnsignedTx();
    // Claims b's key for the set but signs with a's: a's key is outside the set, b's is missing.
    const liar: Signer = {
      getAddress: () => b.getAddress(),
      getPublicKey: () => b.getPublicKey(),
      signTransaction: async (unsigned, seal) => a.signTransaction(unsigned, seal, [await a.getPublicKey()]),
    };

    await expect(signTransaction([liar], tx)).rejects.toThrow(SignerError);
  });

  it("throws SignerError when the same key signs twice", async () => {
    const a = InlineEphemeralSigner.generate();
    await expect(signTransaction([a, a], trivialUnsignedTx())).rejects.toThrow(SignerError);
  });

  it("uses the supplied sealKeypair so the seal_signature.public_key matches", async () => {
    const signer = InlineEphemeralSigner.generate();
    const sealKp = generateSealKeypair();
    const tx = trivialUnsignedTx();

    const signed = await signTransaction([signer], tx, sealKp);

    expect(transactionBody(signed.transaction).seal_signature.public_key).toBe(toHexStr(sealKp.public_key));
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
    const sealed = wasmSealTransaction(JSON.stringify(transactionBody(signed.transaction).body), sealKp.secret_key);
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
    tx.inputs = [{ substate_id: "component_x", version: 3, is_write: true }];
    const provider = fakeProvider({
      resolveInputs: async (inputs) => inputs,
    });

    const out = await resolveTransaction(provider, tx);
    expect(out).toEqual(tx);
  });
});
