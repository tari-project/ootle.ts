//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// ABI probe — executable documentation of the `@tari-project/ootle-wasm@0.38.0`
// contract the stealth module builds on.
//
// This test pins the 9 stealth exports + the existing transaction/key exports and
// round-trips one `createStealthOutputWitness` so a future `ootle-wasm` patch that
// changes a signature is caught here, not downstream in the stealth module. The probe
// lives at the package root (not under `stealth/`) because it is intentionally
// independent of the stealth module's own surface.
import { describe, expect, it } from "vitest";
import * as wasm from "@tari-project/ootle-wasm";
import { Network } from "./network";

// The 9 stealth-specific exports the rest of the stealth module depends on.
const STEALTH_EXPORTS = [
  "createStealthOutputWitness",
  "generateStealthOutputsStatement",
  "buildStealthInputsStatement",
  "unblindOutput",
  "encryptedDataDhKdfAead",
  "aggregateInputMasks",
  "stealthDhSecret",
  "generateStealthBalanceProofSignature",
  "validateStealthTransfer",
] as const;

// The existing callers' exports (transaction.ts + the two secret-key wallets) that
// must remain present and unchanged after the 0.38 bump.
const EXISTING_EXPORTS = [
  "borEncodeTransaction",
  "generateKeypair",
  "hashUnsignedTransaction",
  "schnorrSign",
  "generateOotleSecretKey",
  "ootlePublicKeyFromSecretKey",
  "generateOotleAddress",
  "publicKeyFromSecretKey",
] as const;

// Treat the namespace as an indexable record of functions for presence/arity probing.
const wasmExports = wasm as unknown as Record<string, unknown>;

/** Witness JSON shape from `createStealthOutputWitness`. */
interface StealthOutputWitnessEnvelope {
  witness?: {
    amount?: number | string;
    mask?: string;
    sender_public_nonce?: string;
    minimum_value_promise?: number | string;
    encrypted_data?: string;
    resource_view_key?: string | null;
  };
  auth?: unknown;
  tag?: number;
}

describe("ootle-wasm@0.38.0 ABI probe", () => {
  it("exposes all 9 stealth exports as functions", () => {
    for (const name of STEALTH_EXPORTS) {
      const value = wasmExports[name];
      expect(typeof value, `stealth export "${name}" is missing or not a function`).toBe(
        "function",
      );
    }
  });

  it("still exposes the existing transaction/key exports as functions", () => {
    for (const name of EXISTING_EXPORTS) {
      const value = wasmExports[name];
      expect(typeof value, `existing export "${name}" disappeared after the 0.38 bump`).toBe("function");
    }
  });

  it("pins the createStealthOutputWitness arity (9 args)", () => {
    // Arity is the canary for a signature change. The pinned signature is:
    //   createStealthOutputWitness(network, ownerPk, viewPk, amount, resourceAddress,
    //     resource_view_key, memo_json, pay_to_json, minimum_value_promise)
    expect(
      wasm.createStealthOutputWitness.length,
      "createStealthOutputWitness arity changed (expected 9 args)",
    ).toBe(9);
  });

  it("round-trips createStealthOutputWitness and pins the witness JSON shape", () => {
    const secrets = wasm.generateOotleSecretKey();
    const pubKeys = wasm.ootlePublicKeyFromSecretKey(secrets.owner_key, secrets.view_key);

    const resourceAddress = "resource_0000000000000000000000000000000000000000000000000000000000000000";
    const amount = 1000n;

    const witnessJson = wasm.createStealthOutputWitness(
      Network.LocalNet, // 0x10
      pubKeys.owner_key,
      pubKeys.view_key,
      amount,
      resourceAddress,
      null, // resource_view_key
      null, // memo_json
      null, // pay_to_json
      0n, // minimum_value_promise
    );

    expect(typeof witnessJson, "createStealthOutputWitness must return a JSON string").toBe("string");

    const parsed = JSON.parse(witnessJson) as StealthOutputWitnessEnvelope;
    expect(parsed).toBeTypeOf("object");

    const witness = parsed.witness;
    if (!witness) {
      throw new Error("createStealthOutputWitness envelope is missing the `witness` object");
    }
    expect(witness, "witness must carry `amount`").toHaveProperty("amount");
    expect(witness, "witness must carry `mask`").toHaveProperty("mask");
    expect(witness, "witness must carry `sender_public_nonce`").toHaveProperty("sender_public_nonce");
    expect(witness, "witness must carry `encrypted_data`").toHaveProperty("encrypted_data");

    // Envelope-level keys, asserted at RUNTIME on purpose. These are consumed by
    // `generateStealthOutputsStatement` and travel to the engine as part of the signed
    // statement, so a rename here silently produces transactions the network rejects with
    // a generic untagged-enum error. Exactly that happened between 0.32 and 0.37, when
    // `spend_condition` became `auth`, and this probe did not catch it because the key was
    // only an optional field on a TS-side interface. Keep these as real assertions.
    expect(parsed, "witness envelope must carry `auth` (was `spend_condition` before 0.37)").toHaveProperty("auth");
    expect(parsed, "witness envelope must carry `tag`").toHaveProperty("tag");
    expect(parsed, "witness envelope must NOT carry the pre-0.37 `spend_condition`").not.toHaveProperty(
      "spend_condition",
    );
  });

  it("pins the StealthOutputsResult snake_case field names that the crypto seam depends on", () => {
    const secrets = wasm.generateOotleSecretKey();
    const pubKeys = wasm.ootlePublicKeyFromSecretKey(secrets.owner_key, secrets.view_key);
    const resourceAddress = "resource_0000000000000000000000000000000000000000000000000000000000000000";

    const witnessJson = wasm.createStealthOutputWitness(
      Network.LocalNet,
      pubKeys.owner_key,
      pubKeys.view_key,
      1000n,
      resourceAddress,
      null,
      null,
      null,
      0n,
    );

    // Feed the single witness (as a JSON array) into the outputs statement generator.
    // revealed = 0n: the full amount is confidential.
    const result = wasm.generateStealthOutputsStatement(`[${witnessJson}]`, 0n);

    expect(
      result.aggregated_output_mask,
      "StealthOutputsResult.aggregated_output_mask must be 32 bytes",
    ).toBeInstanceOf(Uint8Array);
    expect(result.aggregated_output_mask.length).toBe(32);
    expect(typeof result.statement_json, "StealthOutputsResult.statement_json must be a JSON string").toBe("string");

    // SchnorrSignatureResult shape (also used for balance proofs) — pins public_nonce + signature.
    const sig = wasm.schnorrSign(secrets.owner_key, new Uint8Array(64));
    expect(sig.public_nonce, "SchnorrSignatureResult.public_nonce must be 32 bytes").toBeInstanceOf(Uint8Array);
    expect(sig.public_nonce.length).toBe(32);
    expect(sig.signature, "SchnorrSignatureResult.signature must be 32 bytes").toBeInstanceOf(Uint8Array);
    expect(sig.signature.length).toBe(32);
  });
});
