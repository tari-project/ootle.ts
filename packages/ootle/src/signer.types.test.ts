//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Type-level / smoke test guarding the non-breaking contract of the stealth additions to
// `Signer`: the two new members (`getViewSecret`, `addStealthSignature`) MUST stay optional,
// so an implementation that provides only the three original required members still
// satisfies `Signer`. If either new member were made required, this file would fail to
// compile — which is exactly the regression we want to catch.

import { describe, expect, it } from "vitest";
import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import type { Signer, SignerStealthCrypto } from "./signer";
import { WasmStealthCrypto } from "./stealth/wasm-crypto";

// A minimal signer with only the three required members — the optional stealth members are
// absent. This assignment is the actual test: it only type-checks if they remain optional.
const minimalSigner: Signer = {
  getAddress: (): Promise<string> => Promise.resolve("component_0000"),
  getPublicKey: (): Promise<Uint8Array> => Promise.resolve(new Uint8Array(32)),
  signTransaction: (_transaction: UnsignedTransactionV1, _sealPk: Uint8Array): Promise<TransactionSignature[]> =>
    Promise.resolve([]),
};

describe("Signer optional stealth members", () => {
  it("accepts an implementation that omits getViewSecret / addStealthSignature", () => {
    // The optional members are absent on a conforming signer.
    expect(minimalSigner.getViewSecret).toBeUndefined();
    expect(minimalSigner.addStealthSignature).toBeUndefined();
  });

  it("still exposes the three required members", async () => {
    expect(typeof minimalSigner.getAddress).toBe("function");
    expect(typeof minimalSigner.getPublicKey).toBe("function");
    expect(typeof minimalSigner.signTransaction).toBe("function");
    await expect(minimalSigner.signTransaction({} as UnsignedTransactionV1, new Uint8Array(32))).resolves.toEqual([]);
  });

  // The full `StealthCryptoProvider` (implemented by `WasmStealthCrypto`) is structurally a
  // supertype of the narrow `SignerStealthCrypto` — the assignment below only compiles while
  // that subtyping holds. If `SignerStealthCrypto` ever drifts from the wider interface, this
  // file will fail to compile, catching the regression at build time.
  it("SignerStealthCrypto is structurally a subset of the full stealth crypto provider", () => {
    const wasm: SignerStealthCrypto = new WasmStealthCrypto();
    expect(typeof wasm.stealthDhSecret).toBe("function");
  });
});
