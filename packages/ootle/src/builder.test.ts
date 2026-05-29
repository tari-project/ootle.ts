//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit coverage for `TransactionBuilder`. Each test focuses on a single observable
// shape: the structure of the produced `UnsignedTransactionV1` (or a specific
// instruction inside it). Workspace-state behaviour is exercised via the public
// surface (`saveVar` + `callMethod({ fromWorkspace })` + `resolveWorkspaceOffsetId`)
// — the `private` helpers are never reached for directly.

import { describe, expect, it } from "vitest";
import type { ConfidentialWithdrawProof, Instruction } from "@tari-project/ootle-ts-bindings";
import { TransactionBuilder } from "./builder";
import { resourceAddressLiteral } from "./helpers/cbor-literal";
import { Network } from "./network";
import { TEST_ACCOUNT_ADDRESS, TEST_NETWORK, XTR_RESOURCE } from "./test/fixtures";

const TEMPLATE_ADDRESS = "template_" + "11".repeat(32);
const OWNER_PUBLIC_KEY = "aa".repeat(32);

describe("TransactionBuilder.buildUnsignedTransaction", () => {
  it("returns the canonical empty shape for a fresh builder", () => {
    const tx = TransactionBuilder.new(Network.LocalNet).buildUnsignedTransaction();
    expect(tx).toEqual({
      network: Network.LocalNet,
      fee_instructions: [],
      instructions: [],
      inputs: [],
      min_epoch: null,
      max_epoch: null,
      dry_run: false,
      is_seal_signer_authorized: false,
      blobs: [],
    });
  });

  it("returns fresh arrays on each call so callers can mutate without leaking back", () => {
    const builder = TransactionBuilder.new(TEST_NETWORK).dropAllProofsInWorkspace();
    const first = builder.buildUnsignedTransaction();
    first.instructions.push("DropAllProofsInWorkspace");
    const second = builder.buildUnsignedTransaction();
    expect(second.instructions.length).toBe(1);
  });
});

describe("TransactionBuilder.publishTemplate", () => {
  it("stores the binary as a blob and references it by index (not inline)", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK).publishTemplate("QUJD").buildUnsignedTransaction();
    expect(tx.blobs).toEqual(["QUJD"]);
    expect(tx.instructions).toEqual([{ PublishTemplate: { binary: 0, metadata_hash: null } }]);
  });

  it("assigns sequential blob indices and threads the optional metadata hash", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .publishTemplate("Zmlyc3Q=")
      .publishTemplate("c2Vjb25k", "0x1234")
      .buildUnsignedTransaction();
    expect(tx.blobs).toEqual(["Zmlyc3Q=", "c2Vjb25k"]);
    expect(tx.instructions).toEqual([
      { PublishTemplate: { binary: 0, metadata_hash: null } },
      { PublishTemplate: { binary: 1, metadata_hash: "0x1234" } },
    ]);
  });
});

describe("TransactionBuilder.callFunction", () => {
  it("emits a CallFunction instruction with the bare Hash32 address, function, and resolved args", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .callFunction({ templateAddress: TEMPLATE_ADDRESS, functionName: "new" }, [{ Literal: "42" }])
      .buildUnsignedTransaction();
    expect(tx.instructions).toEqual([
      {
        CallFunction: {
          address: "11".repeat(32),
          function: "new",
          args: [{ Literal: "42" }],
        },
      },
    ]);
  });
});

describe("TransactionBuilder.callMethod", () => {
  it("emits a CallMethod with an Address call when componentAddress is given", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .callMethod({ componentAddress: TEST_ACCOUNT_ADDRESS, methodName: "withdraw" }, [{ Literal: XTR_RESOURCE }])
      .buildUnsignedTransaction();
    expect(tx.instructions).toEqual([
      {
        CallMethod: {
          call: { Address: TEST_ACCOUNT_ADDRESS },
          method: "withdraw",
          args: [{ Literal: XTR_RESOURCE }],
        },
      },
    ]);
  });

  it("emits a CallMethod with a Workspace call when fromWorkspace is given", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .callFunction({ templateAddress: TEMPLATE_ADDRESS, functionName: "new" }, [])
      .saveVar("acct")
      .callMethod({ fromWorkspace: "acct", methodName: "deposit" }, [])
      .buildUnsignedTransaction();
    const lastCall = tx.instructions.at(-1) as { CallMethod: { call: unknown } };
    expect(lastCall.CallMethod.call).toEqual({ Workspace: 0 });
  });

  it("throws when neither componentAddress nor fromWorkspace is supplied", () => {
    const builder = TransactionBuilder.new(TEST_NETWORK);
    expect(() => builder.callMethod({ methodName: "withdraw" } as { methodName: string }, [])).toThrow(
      /callMethod requires either `componentAddress` or `fromWorkspace`/,
    );
  });
});

describe("TransactionBuilder workspace state machine", () => {
  it("resolves a Workspace-arg by name after saveVar", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .callFunction({ templateAddress: TEMPLATE_ADDRESS, functionName: "new" }, [])
      .saveVar("bucket")
      .callMethod({ componentAddress: TEST_ACCOUNT_ADDRESS, methodName: "deposit" }, [{ Workspace: "bucket" }])
      .buildUnsignedTransaction();
    const depositArgs = (tx.instructions.at(-1) as { CallMethod: { args: unknown[] } }).CallMethod.args;
    expect(depositArgs).toEqual([{ Workspace: { id: 0, offset: null } }]);
  });

  it("throws when a Workspace arg references an undefined name", () => {
    expect(() =>
      TransactionBuilder.new(TEST_NETWORK).callMethod(
        { componentAddress: TEST_ACCOUNT_ADDRESS, methodName: "deposit" },
        [{ Workspace: "ghost" }],
      ),
    ).toThrow('No workspace variable named "ghost" has been defined');
  });

  it("throws when callMethod fromWorkspace references an undefined name", () => {
    expect(() =>
      TransactionBuilder.new(TEST_NETWORK).callMethod({ fromWorkspace: "ghost", methodName: "deposit" }, []),
    ).toThrow('No workspace variable named "ghost" has been defined');
  });

  it("resolveWorkspaceOffsetId returns id + offset for dot-notation keys", () => {
    const builder = TransactionBuilder.new(TEST_NETWORK)
      .callFunction({ templateAddress: TEMPLATE_ADDRESS, functionName: "new" }, [])
      .saveVar("bucket");
    expect(builder.resolveWorkspaceOffsetId("bucket")).toEqual({ id: 0, offset: null });
    expect(builder.resolveWorkspaceOffsetId("bucket.2")).toEqual({ id: 0, offset: 2 });
  });

  it("resolveWorkspaceOffsetId throws when the name was never saved", () => {
    expect(() => TransactionBuilder.new(TEST_NETWORK).resolveWorkspaceOffsetId("ghost")).toThrow(
      'No workspace variable named "ghost" has been defined',
    );
  });

  it("withUnsignedTransaction resets the workspace state", () => {
    const builder = TransactionBuilder.new(TEST_NETWORK)
      .callFunction({ templateAddress: TEMPLATE_ADDRESS, functionName: "new" }, [])
      .saveVar("a");
    // Re-import the empty UnsignedTransactionV1 — this should clear named ids.
    const empty = TransactionBuilder.new(TEST_NETWORK).buildUnsignedTransaction();
    builder.withUnsignedTransaction(empty);
    expect(() => builder.resolveWorkspaceOffsetId("a")).toThrow('No workspace variable named "a" has been defined');
  });
});

describe("TransactionBuilder fee instructions", () => {
  it("feeTransactionPayFromComponent emits a pay_fee CallMethod with a BOR-CBOR hex Literal max-fee", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .feeTransactionPayFromComponent(TEST_ACCOUNT_ADDRESS, 1234n)
      .buildUnsignedTransaction();
    expect(tx.fee_instructions).toEqual([
      {
        CallMethod: {
          call: { Address: TEST_ACCOUNT_ADDRESS },
          method: "pay_fee",
          args: [{ Literal: "821904d200" }],
        },
      },
    ]);
  });

  it("feeTransactionPayFromComponent routes µTari through amountLiteral (CBOR [lo_u64, hi_u64])", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .feeTransactionPayFromComponent(TEST_ACCOUNT_ADDRESS, 1234n)
      .buildUnsignedTransaction();
    const arg = (tx.fee_instructions[0] as { CallMethod: { args: unknown[] } }).CallMethod.args[0];
    expect(arg).toEqual({ Literal: "821904d200" });
  });

  it("feeTransactionPayFromComponentConfidential throws (proof BOR encoding is unimplemented)", () => {
    const proof = {} as unknown as ConfidentialWithdrawProof;
    expect(() =>
      TransactionBuilder.new(TEST_NETWORK).feeTransactionPayFromComponentConfidential(TEST_ACCOUNT_ADDRESS, proof),
    ).toThrow(/not implemented/);
  });
});

describe("TransactionBuilder bulk operations and metadata", () => {
  it("withInstructions appends to instructions in order", () => {
    const a: Instruction = "DropAllProofsInWorkspace";
    const b: Instruction = "DropAllProofsInWorkspace";
    const tx = TransactionBuilder.new(TEST_NETWORK).withInstructions([a, b]).buildUnsignedTransaction();
    expect(tx.instructions).toEqual([a, b]);
  });

  it("withFeeInstructions appends to fee_instructions in order", () => {
    const fee: Instruction = {
      CallMethod: {
        call: { Address: TEST_ACCOUNT_ADDRESS },
        method: "pay_fee",
        args: [{ Literal: "1" }],
      },
    };
    const tx = TransactionBuilder.new(TEST_NETWORK).withFeeInstructions([fee, fee]).buildUnsignedTransaction();
    expect(tx.fee_instructions).toEqual([fee, fee]);
  });

  it("withFeeInstructionsBuilder copies the inner builder's instructions into fee_instructions", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .withFeeInstructionsBuilder((b) =>
        b.callMethod({ componentAddress: TEST_ACCOUNT_ADDRESS, methodName: "pay_fee" }, [{ Literal: "100" }]),
      )
      .buildUnsignedTransaction();
    expect(tx.instructions).toEqual([]);
    expect(tx.fee_instructions).toEqual([
      {
        CallMethod: {
          call: { Address: TEST_ACCOUNT_ADDRESS },
          method: "pay_fee",
          args: [{ Literal: "100" }],
        },
      },
    ]);
  });

  it("withInputs / withMinEpoch / withMaxEpoch set the corresponding fields", () => {
    const inputs = [{ substate_id: "component_x", version: 1 }];
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .withInputs(inputs)
      .withMinEpoch(10)
      .withMaxEpoch(20)
      .buildUnsignedTransaction();
    expect(tx.inputs).toEqual(inputs);
    expect(tx.min_epoch).toBe(10);
    expect(tx.max_epoch).toBe(20);
  });

  it("dropAllProofsInWorkspace emits the bare-string instruction (not an object)", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK).dropAllProofsInWorkspace().buildUnsignedTransaction();
    expect(tx.instructions).toEqual(["DropAllProofsInWorkspace"]);
  });

  it("createAccount emits a CreateAccount instruction with the supplied owner public key", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK).createAccount(OWNER_PUBLIC_KEY).buildUnsignedTransaction();
    expect(tx.instructions).toEqual([
      {
        CreateAccount: {
          owner_public_key: OWNER_PUBLIC_KEY,
          owner_rule: null,
          access_rules: null,
          bucket_workspace_id: null,
        },
      },
    ]);
  });

  it("createProof emits a create_proof_for_resource CallMethod", () => {
    const tx = TransactionBuilder.new(TEST_NETWORK)
      .createProof(TEST_ACCOUNT_ADDRESS, XTR_RESOURCE)
      .buildUnsignedTransaction();
    expect(tx.instructions).toEqual([
      {
        CallMethod: {
          call: { Address: TEST_ACCOUNT_ADDRESS },
          method: "create_proof_for_resource",
          args: [resourceAddressLiteral(XTR_RESOURCE)],
        },
      },
    ]);
  });

  it("allocateAddress emits an AllocateAddress and reserves the workspace id", () => {
    const builder = TransactionBuilder.new(TEST_NETWORK).allocateAddress("Component", "alloc");
    const tx = builder.buildUnsignedTransaction();
    expect(tx.instructions).toEqual([
      {
        AllocateAddress: { allocatable_type: "Component", workspace_id: 0 },
      },
    ]);
    // The name is reachable via resolveWorkspaceOffsetId, proving the id was reserved.
    expect(builder.resolveWorkspaceOffsetId("alloc")).toEqual({ id: 0, offset: null });
  });
});
