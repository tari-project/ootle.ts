//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Cutover smoke test: proves the stealth API is wired into the package's public entry
// point (`./index.ts`) — external consumers get it from `@tari-project/ootle`. Also
// asserts that the test-only fakes are NOT surfaced from the root (they stay private,
// importable only via subpath).

import { describe, expect, it } from "vitest";
import * as Ootle from "./index";

describe("public stealth surface (cutover)", () => {
  it("re-exports the runtime stealth API from the package entry", () => {
    // Send + spend
    expect(Ootle.StealthTransfer).toBeDefined();
    expect(Ootle.WalletStealthAuthorizer).toBeDefined();
    expect(Ootle.patchStealthStatement).toBeDefined();
    // Crypto seam
    expect(Ootle.WasmStealthCrypto).toBeDefined();
    expect(Ootle.signBalanceProof).toBeDefined();
    // Domain types / helpers
    expect(Ootle.Mask).toBeDefined();
    expect(Ootle.EncryptedData).toBeDefined();
    expect(Ootle.createOutput).toBeDefined();
    expect(Ootle.StealthInput).toBeDefined();
    expect(Ootle.BalanceProofSignature).toBeDefined();
    expect(Ootle.StealthInputsStatement).toBeDefined();
    expect(Ootle.StealthOutputsStatement).toBeDefined();
    expect(Ootle.StealthTransferStatement).toBeDefined();
    // Receive + provider helpers
    expect(Ootle.decryptOwnedUtxo).toBeDefined();
    expect(Ootle.decryptInputData).toBeDefined();
    expect(Ootle.generateOutputsStatement).toBeDefined();
    expect(Ootle.parseSubstateUtxo).toBeDefined();
    expect(Ootle.commitmentOf).toBeDefined();
    expect(Ootle.stealthUtxoSubstateId).toBeDefined();
  });

  it("does NOT surface test-only fakes from the package root", () => {
    const surface = Ootle as Record<string, unknown>;
    expect(surface.FakeStealthCrypto).toBeUndefined();
    expect(surface.sealFakeOutput).toBeUndefined();
    // Step 02 added a `src/test/` directory with reusable fixtures and fakes.
    // Those modules MUST stay test-internal — they are never imported from
    // `index.ts` and must never appear on the public surface.
    expect(surface.InlineEphemeralSigner).toBeUndefined();
    expect(surface.FixedKeySigner).toBeUndefined();
    expect(surface.fakeProvider).toBeUndefined();
    expect(surface.trivialUnsignedTx).toBeUndefined();
    expect(surface.ALICE_SECRET).toBeUndefined();
    expect(surface.ALICE_PUBLIC).toBeUndefined();
    expect(surface.BOB_SECRET).toBeUndefined();
    expect(surface.BOB_PUBLIC).toBeUndefined();
    expect(surface.SEAL_SECRET).toBeUndefined();
    expect(surface.SEAL_PUBLIC).toBeUndefined();
    expect(surface.TEST_NETWORK).toBeUndefined();
    expect(surface.XTR_RESOURCE).toBeUndefined();
    expect(surface.TEST_ACCOUNT_ADDRESS).toBeUndefined();
    expect(surface.TEST_DESTINATION_ADDRESS).toBeUndefined();
  });

  it("does NOT surface the deleted legacy stub symbols", () => {
    const surface = Ootle as Record<string, unknown>;
    // These were exported by the (now-deleted) stub files.
    expect(surface.StealthOutputStatementFactory).toBeUndefined();
    expect(surface.InputDecryptor).toBeUndefined();
    expect(surface.StealthSigner).toBeUndefined();
    expect(surface.OutputMaskProvider).toBeUndefined();
    expect(surface.DiffieHellmanKdfKeyProvider).toBeUndefined();
    expect(surface.WalletKeyProvider).toBeUndefined();
  });
});
