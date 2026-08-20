//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Smoke tests for `AccountInvokeBuilder` and `FaucetInvokeBuilder`. Both wrap a
// `TransactionBuilder` and emit a tiny, deterministic instruction sequence
// against a known component address; the test asserts that sequence stays
// byte-stable against the documented API.

import { describe, expect, it } from "vitest";
import { AccountInvokeBuilder, FaucetInvokeBuilder } from "./builtin-templates";
import { resourceAddressLiteral } from "./helpers/cbor-literal";
import {
  TEST_ACCOUNT_ADDRESS,
  TEST_MAX_EPOCH,
  TEST_NETWORK,
  XTR_FAUCET_COMPONENT_ADDRESS,
  XTR_RESOURCE,
} from "./test/fixtures";

const DESTINATION_ADDRESS = "component_" + "cc".repeat(32);

describe("AccountInvokeBuilder", () => {
  it("publicTransfer emits a withdraw + saveVar + deposit instruction sequence", () => {
    const tx = new AccountInvokeBuilder(TEST_NETWORK, TEST_MAX_EPOCH)
      .publicTransfer(TEST_ACCOUNT_ADDRESS, XTR_RESOURCE, 500n, DESTINATION_ADDRESS)
      .build();
    // 500 = 0x01f4 → CBOR uint16 (0x19 0x01 0xf4), hi = 0 → array `[lo, hi]` = 8219 01f4 00.
    expect(tx.instructions).toEqual([
      {
        CallMethod: {
          call: { Address: TEST_ACCOUNT_ADDRESS },
          method: "withdraw",
          args: [resourceAddressLiteral(XTR_RESOURCE), { Literal: "1901f4" }],
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
    const tx = new AccountInvokeBuilder(TEST_NETWORK, TEST_MAX_EPOCH)
      .feeTransactionPayFromComponent(TEST_ACCOUNT_ADDRESS, 1000n)
      .publishTemplate(TEST_ACCOUNT_ADDRESS, "QUJD")
      .build();
    expect(tx.blobs).toEqual(["QUJD"]);
    expect(tx.instructions).toEqual([{ PublishTemplate: { binary: 0, metadata_hash: null } }]);
  });
});

describe("AccountInvokeBuilder fee instructions", () => {
  it("feeTransactionPayFromComponent emits a pay_fee fee instruction", () => {
    const tx = new AccountInvokeBuilder(TEST_NETWORK, TEST_MAX_EPOCH)
      .feeTransactionPayFromComponent(TEST_ACCOUNT_ADDRESS, 1_000n)
      .publicTransfer(TEST_ACCOUNT_ADDRESS, XTR_RESOURCE, 1n, DESTINATION_ADDRESS)
      .build();
    expect(tx.fee_instructions).toEqual([
      {
        CallMethod: {
          call: { Address: TEST_ACCOUNT_ADDRESS },
          method: "pay_fee",
          args: [{ Literal: "1903e8" }],
        },
      },
    ]);
  });
});

describe("FaucetInvokeBuilder", () => {
  it("takeFaucetFunds emits a take_free_coins + saveVar + deposit instruction sequence", () => {
    const tx = new FaucetInvokeBuilder(TEST_NETWORK, TEST_MAX_EPOCH, XTR_FAUCET_COMPONENT_ADDRESS)
      .takeFaucetFunds(TEST_ACCOUNT_ADDRESS, 10_000n)
      .build();
    // 10_000 = 0x2710 → CBOR uint16: 0x19 0x27 0x10.
    expect(tx.instructions).toEqual([
      {
        CallMethod: {
          call: { Address: XTR_FAUCET_COMPONENT_ADDRESS },
          method: "take_free_coins",
          args: [{ Literal: "192710" }],
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

  it("takeMaxFaucetFunds emits take_max_free_coins with no amount arg", () => {
    const tx = new FaucetInvokeBuilder(TEST_NETWORK, TEST_MAX_EPOCH, XTR_FAUCET_COMPONENT_ADDRESS)
      .takeMaxFaucetFunds(TEST_ACCOUNT_ADDRESS)
      .build();
    // Distinguished from takeFaucetFunds by the method name and the EMPTY arg list —
    // "take the max" carries no amount literal.
    expect(tx.instructions).toEqual([
      {
        CallMethod: {
          call: { Address: XTR_FAUCET_COMPONENT_ADDRESS },
          method: "take_max_free_coins",
          args: [],
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

  it("publishTemplate calls `new` on the template and saves it under the default bucket", () => {
    const templateAddress = "template_" + "ab".repeat(32);
    const tx = new FaucetInvokeBuilder(TEST_NETWORK, TEST_MAX_EPOCH, XTR_FAUCET_COMPONENT_ADDRESS)
      .publishTemplate(templateAddress)
      .build();
    // The faucet variant is a CallFunction on the template (unlike the Account
    // builder's PublishTemplate + blob), and the `template_` prefix is stripped to
    // the bare Hash32 the instruction expects.
    expect(tx.instructions).toEqual([
      { CallFunction: { address: "ab".repeat(32), function: "new", args: [] } },
      { PutLastInstructionOutputOnWorkspace: { key: 0 } },
    ]);
  });

  it("feeTransactionPayFromComponent adds a pay_fee FEE instruction, not a normal one", () => {
    const tx = new FaucetInvokeBuilder(TEST_NETWORK, TEST_MAX_EPOCH, XTR_FAUCET_COMPONENT_ADDRESS)
      .feeTransactionPayFromComponent(TEST_ACCOUNT_ADDRESS, 1_000n)
      .takeMaxFaucetFunds(TEST_ACCOUNT_ADDRESS)
      .build();
    // 1000 = 0x03e8 → CBOR uint16 (0x19 0x03 0xe8), hi = 0 → `[lo, hi]` = 8219 03e8 00.
    expect(tx.fee_instructions).toEqual([
      {
        CallMethod: {
          call: { Address: TEST_ACCOUNT_ADDRESS },
          method: "pay_fee",
          args: [{ Literal: "1903e8" }],
        },
      },
    ]);
    // The fee instruction must NOT leak into the main instruction list.
    expect(tx.instructions).toHaveLength(3);
  });
});
