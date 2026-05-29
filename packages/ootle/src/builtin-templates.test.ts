//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Smoke tests for `AccountInvokeBuilder` and `FaucetInvokeBuilder`. Both wrap a
// `TransactionBuilder` and emit a tiny, deterministic instruction sequence
// against a known component address; the test asserts that sequence stays
// byte-stable against the documented API.

import { describe, expect, it } from "vitest";
import { AccountInvokeBuilder, FaucetInvokeBuilder } from "./builtin-templates";
import { resourceAddressLiteral } from "./helpers/cbor-literal";
import { TEST_ACCOUNT_ADDRESS, TEST_NETWORK, XTR_FAUCET_COMPONENT_ADDRESS, XTR_RESOURCE } from "./test/fixtures";

const DESTINATION_ADDRESS = "component_" + "cc".repeat(32);

describe("AccountInvokeBuilder", () => {
  it("publicTransfer emits a withdraw + saveVar + deposit instruction sequence", () => {
    const tx = new AccountInvokeBuilder(TEST_NETWORK)
      .publicTransfer(TEST_ACCOUNT_ADDRESS, XTR_RESOURCE, 500n, DESTINATION_ADDRESS)
      .build();
    // 500 = 0x01f4 → CBOR uint16 (0x19 0x01 0xf4), hi = 0 → array `[lo, hi]` = 8219 01f4 00.
    expect(tx.instructions).toEqual([
      {
        CallMethod: {
          call: { Address: TEST_ACCOUNT_ADDRESS },
          method: "withdraw",
          args: [resourceAddressLiteral(XTR_RESOURCE), { Literal: "821901f400" }],
        },
      },
      { PutLastInstructionOutputOnWorkspace: { key: 0 } },
      {
        CallMethod: {
          call: { Address: DESTINATION_ADDRESS },
          method: "deposit",
          args: [{ Workspace: { id: 0, offset: null } }],
        },
      },
    ]);
  });

  it("publishTemplate emits a PublishTemplate instruction backed by a blob (not a method call)", () => {
    const tx = new AccountInvokeBuilder(TEST_NETWORK)
      .feeTransactionPayFromComponent(TEST_ACCOUNT_ADDRESS, 1000n)
      .publishTemplate(TEST_ACCOUNT_ADDRESS, "QUJD")
      .build();
    expect(tx.blobs).toEqual(["QUJD"]);
    expect(tx.instructions).toEqual([{ PublishTemplate: { binary: 0, metadata_hash: null } }]);
  });
});

describe("FaucetInvokeBuilder", () => {
  it("takeFaucetFunds emits a take_free_coins + saveVar + deposit instruction sequence", () => {
    const tx = new FaucetInvokeBuilder(TEST_NETWORK, XTR_FAUCET_COMPONENT_ADDRESS)
      .takeFaucetFunds(TEST_ACCOUNT_ADDRESS, 10_000n)
      .build();
    // 10_000 = 0x2710 → CBOR uint16 (0x19 0x27 0x10), hi = 0 → array `[lo, hi]` = 8219 2710 00.
    expect(tx.instructions).toEqual([
      {
        CallMethod: {
          call: { Address: XTR_FAUCET_COMPONENT_ADDRESS },
          method: "take_free_coins",
          args: [{ Literal: "8219271000" }],
        },
      },
      { PutLastInstructionOutputOnWorkspace: { key: 0 } },
      {
        CallMethod: {
          call: { Address: TEST_ACCOUNT_ADDRESS },
          method: "deposit",
          args: [{ Workspace: { id: 0, offset: null } }],
        },
      },
    ]);
  });
});
