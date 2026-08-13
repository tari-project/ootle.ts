//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Tests for `TransactionBuilder.withUnsignedTransaction` — the "adopt an existing
// transaction and keep building" path.
//
// Two invariants are pinned here, both of which the adopt path used to break while
// `buildUnsignedTransaction` upheld them a few lines away:
//
//  1. COPY-ON-ADOPT. The builder must not alias the caller's arrays. The documented
//     manual co-signing flow ships `JSON.stringify(unsigned)` across a process
//     boundary; if a later builder call mutates the object the caller already
//     serialized or signed, the two sides disagree and submission fails with the
//     opaque engine error "Transaction has one or more invalid signature(s)".
//
//  2. NON-COLLIDING WORKSPACE SLOTS. Workspace ids are positional slots in the
//     engine's workspace, not names. Adopting a transaction whose instructions
//     already occupy slots and then restarting allocation at 0 hands out a live
//     slot again: the second write clobbers it, and the pre-existing instruction
//     reading that slot silently consumes the wrong bucket.

import { describe, expect, it } from "vitest";
import type { Instruction, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { TransactionBuilder } from "./builder";
import { FaucetInvokeBuilder } from "./builtin-templates";
import { TEST_ACCOUNT_ADDRESS, TEST_NETWORK, XTR_FAUCET_COMPONENT_ADDRESS } from "./test/fixtures";

const TEMPLATE_ADDRESS = "template_" + "ab".repeat(32);

/** Every workspace slot written by `instructions` (`saveVar` / `allocateAddress` targets). */
function writtenSlots(tx: UnsignedTransactionV1): number[] {
  const slots: number[] = [];
  for (const instruction of [...tx.fee_instructions, ...tx.instructions] as Instruction[]) {
    if (typeof instruction !== "object" || instruction === null) continue;
    if ("PutLastInstructionOutputOnWorkspace" in instruction) {
      slots.push(instruction.PutLastInstructionOutputOnWorkspace.key);
    } else if ("AllocateAddress" in instruction) {
      slots.push(instruction.AllocateAddress.workspace_id);
    }
  }
  return slots;
}

describe("withUnsignedTransaction — copy on adopt", () => {
  it("does not mutate the adopted transaction's instructions", () => {
    const adopted = TransactionBuilder.new(TEST_NETWORK)
      .callFunction({ templateAddress: TEMPLATE_ADDRESS, functionName: "new" }, [])
      .buildUnsignedTransaction();
    const before = [...adopted.instructions];

    TransactionBuilder.new(TEST_NETWORK).withUnsignedTransaction(adopted).dropAllProofsInWorkspace();

    expect(adopted.instructions).toEqual(before);
  });

  it("does not mutate the adopted transaction's blobs", () => {
    const adopted = TransactionBuilder.new(TEST_NETWORK).buildUnsignedTransaction();
    expect(adopted.blobs).toEqual([]);

    TransactionBuilder.new(TEST_NETWORK).withUnsignedTransaction(adopted).publishTemplate("QUJD");

    expect(adopted.blobs).toEqual([]);
  });

  it("does not mutate the adopted transaction's fee_instructions", () => {
    const adopted = TransactionBuilder.new(TEST_NETWORK).buildUnsignedTransaction();
    const before = [...adopted.fee_instructions];

    TransactionBuilder.new(TEST_NETWORK)
      .withUnsignedTransaction(adopted)
      .feeTransactionPayFromComponent(TEST_ACCOUNT_ADDRESS, 1_000n);

    expect(adopted.fee_instructions).toEqual(before);
  });

  it("does not mutate the adopted transaction's inputs", () => {
    const adopted = TransactionBuilder.new(TEST_NETWORK).buildUnsignedTransaction();
    const before = [...adopted.inputs];

    TransactionBuilder.new(TEST_NETWORK)
      .withUnsignedTransaction(adopted)
      .withInputs([{ substate_id: TEST_ACCOUNT_ADDRESS, version: null }]);

    expect(adopted.inputs).toEqual(before);
  });

  it("keeps a serialized snapshot of the adopted transaction valid (the co-signing flow)", () => {
    // The failure this guards: a co-signer serializes `adopted`, the local builder keeps
    // building, and the two sides now hash different transactions.
    const adopted = TransactionBuilder.new(TEST_NETWORK)
      .callFunction({ templateAddress: TEMPLATE_ADDRESS, functionName: "new" }, [])
      .buildUnsignedTransaction();
    const snapshot = JSON.stringify(adopted);

    TransactionBuilder.new(TEST_NETWORK)
      .withUnsignedTransaction(adopted)
      .saveVar("bucket")
      .publishTemplate("QUJD")
      .buildUnsignedTransaction();

    expect(JSON.stringify(adopted)).toBe(snapshot);
  });
});

describe("withUnsignedTransaction — workspace slot allocation", () => {
  it("does not re-issue a workspace slot the adopted transaction already occupies", () => {
    // The faucet builder emits `PutLastInstructionOutputOnWorkspace { key: 0 }`.
    const adopted = new FaucetInvokeBuilder(TEST_NETWORK, XTR_FAUCET_COMPONENT_ADDRESS)
      .takeMaxFaucetFunds(TEST_ACCOUNT_ADDRESS)
      .build();
    expect(writtenSlots(adopted)).toEqual([0]);

    const out = TransactionBuilder.new(TEST_NETWORK)
      .withUnsignedTransaction(adopted)
      .callMethod({ componentAddress: TEST_ACCOUNT_ADDRESS, methodName: "noop" }, [])
      .saveVar("bucket")
      .buildUnsignedTransaction();

    const slots = writtenSlots(out);
    expect(new Set(slots).size, `duplicate workspace slots: ${slots.join(", ")}`).toBe(slots.length);
  });

  it("resumes allocation past the highest occupied slot, including fee instructions", () => {
    // Hand-build a transaction occupying slots 0 and 5, one of them in fee_instructions,
    // so the seed cannot be derived from `instructions` alone or from a simple count.
    const adopted: UnsignedTransactionV1 = {
      ...TransactionBuilder.new(TEST_NETWORK).buildUnsignedTransaction(),
      fee_instructions: [{ PutLastInstructionOutputOnWorkspace: { key: 5 } }],
      instructions: [{ PutLastInstructionOutputOnWorkspace: { key: 0 } }],
    };

    const out = TransactionBuilder.new(TEST_NETWORK)
      .withUnsignedTransaction(adopted)
      .saveVar("next")
      .buildUnsignedTransaction();

    expect(writtenSlots(out)).toEqual([5, 0, 6]);
  });

  it("counts AllocateAddress workspace ids as occupied", () => {
    const adopted = TransactionBuilder.new(TEST_NETWORK)
      .allocateAddress("Component", "addr")
      .buildUnsignedTransaction();
    expect(writtenSlots(adopted)).toEqual([0]);

    const out = TransactionBuilder.new(TEST_NETWORK)
      .withUnsignedTransaction(adopted)
      .saveVar("bucket")
      .buildUnsignedTransaction();

    expect(writtenSlots(out)).toEqual([0, 1]);
  });

  it("still starts at 0 when the adopted transaction occupies no slots", () => {
    const adopted = TransactionBuilder.new(TEST_NETWORK)
      .callFunction({ templateAddress: TEMPLATE_ADDRESS, functionName: "new" }, [])
      .buildUnsignedTransaction();

    const out = TransactionBuilder.new(TEST_NETWORK)
      .withUnsignedTransaction(adopted)
      .saveVar("bucket")
      .buildUnsignedTransaction();

    expect(writtenSlots(out)).toEqual([0]);
  });

  it("still clears the name→id mapping, so adopted names are not resolvable", () => {
    // Unchanged behaviour: names are not recoverable from the wire form, only slots are.
    const builder = TransactionBuilder.new(TEST_NETWORK)
      .callFunction({ templateAddress: TEMPLATE_ADDRESS, functionName: "new" }, [])
      .saveVar("a");
    builder.withUnsignedTransaction(TransactionBuilder.new(TEST_NETWORK).buildUnsignedTransaction());

    expect(() => builder.resolveWorkspaceOffsetId("a")).toThrow('No workspace variable named "a" has been defined');
  });
});
