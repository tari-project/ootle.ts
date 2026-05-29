//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Self-test for the shared fixture constants. Catches the embarrassing class of
// "someone deleted or accidentally mutated a fixture constant" regression: any
// test asserting derived public keys, hashes, or signatures depends on these
// bytes being byte-stable across the lifetime of the repo. Re-baselining is a
// deliberate, reviewed action — never a side effect of an unrelated edit.

import { describe, expect, it } from "vitest";
import { Network } from "../network";
import { toHexStr } from "../helpers/hex";
import {
  ALICE_PUBLIC,
  ALICE_SECRET,
  BOB_PUBLIC,
  BOB_SECRET,
  SEAL_PUBLIC,
  SEAL_SECRET,
  TEST_NETWORK,
  XTR_FAUCET_COMPONENT_ADDRESS,
  XTR_RESOURCE,
} from "./fixtures";

describe("test/fixtures", () => {
  it("has stable 32-byte hex constants for the canonical keypairs", () => {
    expect(toHexStr(ALICE_SECRET)).toBe("a1".repeat(32));
    expect(toHexStr(ALICE_PUBLIC)).toBe("a2".repeat(32));
    expect(toHexStr(BOB_SECRET)).toBe("b1".repeat(32));
    expect(toHexStr(BOB_PUBLIC)).toBe("b2".repeat(32));
    expect(toHexStr(SEAL_SECRET)).toBe("0e".repeat(32));
    expect(toHexStr(SEAL_PUBLIC)).toBe("0f".repeat(32));
  });

  it("uses LocalNet as the default test network", () => {
    expect(TEST_NETWORK).toBe(Network.LocalNet);
  });

  it("re-exports the canonical XTR resource and faucet addresses", () => {
    expect(XTR_RESOURCE).toMatch(/^resource_/);
    expect(XTR_FAUCET_COMPONENT_ADDRESS).toMatch(/^component_/);
  });
});
