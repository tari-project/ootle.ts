//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Pure-logic coverage for `transaction.ts`: `classifyOutcome`, `resolveTransaction`,
// and `watchTransaction`. WASM-backed sign/seal flow lives in
// `transaction.flow.wasm.test.ts` so this file can run with `pollIntervalMs: 1`
// (real timers) and stay fast — no `vi.useFakeTimers()` machinery to coordinate.

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  IndexerGetTransactionResultResponse,
  IndexerTransactionFinalizedResult,
  SubstateRequirement,
} from "@tari-project/ootle-ts-bindings";
import {
  buildTransactionSignature,
  classifyOutcome,
  resolveTransaction,
  serializeUnsignedTx,
  watchTransaction,
} from "./transaction";
import { fromHexStr } from "./helpers";
import { InvalidArgumentError, TransactionRejectedError, TransactionTimeoutError } from "./errors";
import { RAW_JSON_FRAGMENT } from "./stealth/instruction";
import { fakeProvider } from "./test/fake-provider";
import { trivialUnsignedTx } from "./test/tx-builders";

/** Build a `Finalized` indexer response for the given final_decision + finalize.result shape. */
function finalized(
  decision: IndexerTransactionFinalizedResult extends infer T
    ? T extends { Finalized: { final_decision: infer D } }
      ? D
      : never
    : never,
  opts: {
    abort_details?: string | null;
    executionFinalizeResult?: unknown;
  } = {},
): IndexerTransactionFinalizedResult {
  return {
    Finalized: {
      final_decision: decision,
      execution_result:
        opts.executionFinalizeResult === undefined
          ? null
          : ({
              finalize: { result: opts.executionFinalizeResult },
            } as unknown as IndexerTransactionFinalizedResult extends { Finalized: { execution_result: infer E } }
              ? E
              : never),
      execution_time: { secs: 0, nanos: 0 },
      finalized_time: "1970-01-01T00:00:00Z",
      abort_details: opts.abort_details ?? null,
    },
  } as IndexerTransactionFinalizedResult;
}

describe("classifyOutcome", () => {
  it("returns null when the result is still Pending", () => {
    expect(classifyOutcome("Pending")).toBeNull();
  });

  it("returns Commit when the final decision is Commit", () => {
    expect(classifyOutcome(finalized("Commit"))).toEqual({ outcome: "Commit" });
  });

  it("returns Reject with abort_details as the reason when the final decision is Abort", () => {
    const result = classifyOutcome(
      finalized({ Abort: "ExecutionFailure" }, { abort_details: "instruction 0 panicked" }),
    );
    expect(result).toEqual({ outcome: "Reject", reason: "instruction 0 panicked" });
  });

  it("falls back to the stringified Abort reason when abort_details is missing", () => {
    const result = classifyOutcome(finalized({ Abort: "ExecutionFailure" }));
    expect(result).toEqual({ outcome: "Reject", reason: '"ExecutionFailure"' });
  });

  it("returns FeeIntentCommit when Abort coexists with an AcceptFeeRejectRest execution result", () => {
    // The non-obvious branch at transaction.ts:127-133: Abort decision but the
    // finalize.result is AcceptFeeRejectRest, meaning fees were paid even though
    // the rest of the transaction was rejected.
    const result = classifyOutcome(
      finalized(
        { Abort: "ExecutionFailure" },
        {
          abort_details: "user-side revert",
          executionFinalizeResult: { AcceptFeeRejectRest: [{}, { ExecutionFailure: "x" }] },
        },
      ),
    );
    expect(result).toEqual({ outcome: "FeeIntentCommit", reason: "user-side revert" });
  });

  it("returns null (not-yet-final) when final_decision is an explicit null", () => {
    // Off-spec REST quirk: an explicit `null` final_decision must not throw a raw
    // TypeError on `"Abort" in null`; treat it as still-pending so callers keep polling.
    const result = {
      Finalized: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        final_decision: null as any,
        execution_result: null,
        execution_time: { secs: 0, nanos: 0 },
        finalized_time: "1970-01-01T00:00:00Z",
        abort_details: null,
      },
    } as unknown as IndexerTransactionFinalizedResult;
    expect(classifyOutcome(result)).toBeNull();
  });

  it("throws when the final_decision is an unexpected variant", () => {
    const malformed = {
      Finalized: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        final_decision: { Unknown: "x" } as any,
        execution_result: null,
        execution_time: { secs: 0, nanos: 0 },
        finalized_time: "1970-01-01T00:00:00Z",
        abort_details: null,
      },
    } as unknown as IndexerTransactionFinalizedResult;
    expect(() => classifyOutcome(malformed)).toThrow(InvalidArgumentError);
    expect(() => classifyOutcome(malformed)).toThrow(/Unexpected final_decision variant/);
  });
});

describe("buildTransactionSignature", () => {
  const publicKey = new Uint8Array(32).fill(0x11);
  const publicNonce = new Uint8Array(32).fill(0x22);
  const signature = new Uint8Array(32).fill(0x33);

  it("returns the expected hex-encoded shape for valid 32-byte inputs", () => {
    const out = buildTransactionSignature(publicKey, { public_nonce: publicNonce, signature });

    expect(out.public_key).toBe("11".repeat(32));
    expect(out.signature.public_nonce).toBe("22".repeat(32));
    expect(out.signature.signature).toBe("33".repeat(32));
    expect(Array.from(fromHexStr(out.public_key))).toEqual(Array.from(publicKey));
    expect(Array.from(fromHexStr(out.signature.public_nonce))).toEqual(Array.from(publicNonce));
    expect(Array.from(fromHexStr(out.signature.signature))).toEqual(Array.from(signature));
  });

  it("throws InvalidArgumentError for a 31-byte publicKey", () => {
    expect(() =>
      buildTransactionSignature(new Uint8Array(31), { public_nonce: publicNonce, signature }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      buildTransactionSignature(new Uint8Array(31), { public_nonce: publicNonce, signature }),
    ).toThrow(/publicKey must be 32 bytes, got 31/);
  });

  it("throws InvalidArgumentError for a 31-byte public_nonce", () => {
    expect(() =>
      buildTransactionSignature(publicKey, { public_nonce: new Uint8Array(31), signature }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      buildTransactionSignature(publicKey, { public_nonce: new Uint8Array(31), signature }),
    ).toThrow(/schnorr\.public_nonce must be 32 bytes, got 31/);
  });

  it("throws InvalidArgumentError for a 33-byte signature", () => {
    expect(() =>
      buildTransactionSignature(publicKey, { public_nonce: publicNonce, signature: new Uint8Array(33) }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      buildTransactionSignature(publicKey, { public_nonce: publicNonce, signature: new Uint8Array(33) }),
    ).toThrow(/schnorr\.signature must be 32 bytes, got 33/);
  });
});

describe("serializeUnsignedTx", () => {
  it("is byte-identical to JSON.stringify for a fragment-free transaction", () => {
    const tx = trivialUnsignedTx();
    expect(serializeUnsignedTx(tx)).toBe(JSON.stringify(tx));
  });

  it("splices a raw-JSON fragment verbatim, preserving a > 2^53 bare-number u64", () => {
    // u64 max exceeds Number.MAX_SAFE_INTEGER (2^53 - 1); a JSON.parse round-trip would
    // round it. The fragment must survive byte-for-byte through serialization.
    const bigU64 = "18446744073709551615";
    const fragment = `{"inputs_statement":{"revealed_amount":${bigU64}},"outputs_statement":{"outputs":[{"amount":${bigU64}}]}}`;
    const tx = trivialUnsignedTx();
    tx.instructions = [
      {
        StealthTransfer: {
          resource_address_ref: { Address: "resource_" + "a".repeat(64) },
          statement: { [RAW_JSON_FRAGMENT]: fragment } as never,
          revealed_input_bucket: null,
        },
      },
    ];

    const serialized = serializeUnsignedTx(tx);

    expect(serialized).toContain(`"statement":${fragment}`);
    expect(serialized).toContain(`"amount":${bigU64}`);
    // The carrier key never leaks into the output, and no placeholder remains.
    expect(serialized).not.toContain(RAW_JSON_FRAGMENT);
    expect(serialized).not.toContain("ootleRawJson");
    // Sanity: a naive JSON.parse round-trip WOULD have corrupted the u64.
    expect(String(JSON.parse(serialized).instructions[0].StealthTransfer.statement.outputs_statement.outputs[0].amount))
      .not.toBe(bigU64);
  });

  it("splices multiple raw-JSON fragments independently", () => {
    const fragA = `{"a":18446744073709551615}`;
    const fragB = `{"b":18446744073709551614}`;
    const tx = trivialUnsignedTx();
    const mk = (frag: string) => ({
      StealthTransfer: {
        resource_address_ref: { Address: "resource_" + "a".repeat(64) },
        statement: { [RAW_JSON_FRAGMENT]: frag } as never,
        revealed_input_bucket: null,
      },
    });
    tx.instructions = [mk(fragA), mk(fragB)];

    const serialized = serializeUnsignedTx(tx);

    expect(serialized).toContain(`"statement":${fragA}`);
    expect(serialized).toContain(`"statement":${fragB}`);
    expect(serialized).not.toContain("ootleRawJson");
  });
});

describe("resolveTransaction", () => {
  it("delegates input resolution to the provider and returns a new tx with the resolved inputs", async () => {
    const resolved: SubstateRequirement[] = [{ substate_id: "component_x", version: 7 }];
    const resolveInputs = vi.fn().mockResolvedValue(resolved);
    const provider = fakeProvider({ resolveInputs });

    const tx = trivialUnsignedTx();
    tx.inputs = [{ substate_id: "component_x", version: null }];

    const out = await resolveTransaction(provider, tx);

    expect(resolveInputs).toHaveBeenCalledTimes(1);
    expect(resolveInputs).toHaveBeenCalledWith(tx.inputs);
    expect(out).toEqual({ ...tx, inputs: resolved });
  });
});

describe("watchTransaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves with the final response after Pending → Pending → Commit", async () => {
    const responses: IndexerGetTransactionResultResponse[] = [
      { result: "Pending" },
      { result: "Pending" },
      { result: finalized("Commit") },
    ];
    let i = 0;
    const getTransactionResult = vi.fn(async () => responses[i++]);
    const provider = fakeProvider({ getTransactionResult });

    const out = await watchTransaction(provider, "tx_abc", { pollIntervalMs: 1, timeoutMs: 5_000 });

    expect(out).toBe(responses[2]);
    expect(getTransactionResult).toHaveBeenCalledTimes(3);
    expect(getTransactionResult).toHaveBeenLastCalledWith("tx_abc");
  });

  it("rejects with a Reject message when the transaction is finalized with Abort + execution Reject", async () => {
    const getTransactionResult = vi.fn(async () => ({
      result: finalized(
        { Abort: "ExecutionFailure" },
        { abort_details: "boom", executionFinalizeResult: { Reject: { ExecutionFailure: "boom" } } },
      ),
    }));
    const provider = fakeProvider({ getTransactionResult });

    await expect(watchTransaction(provider, "tx_xyz", { pollIntervalMs: 1 })).rejects.toThrow(TransactionRejectedError);
    await expect(watchTransaction(provider, "tx_xyz", { pollIntervalMs: 1 })).rejects.toThrow(
      "Transaction tx_xyz was rejected: boom",
    );
  });

  it("rejects with a FeeIntentCommit-specific message when only fees were committed", async () => {
    const getTransactionResult = vi.fn(async () => ({
      result: finalized(
        { Abort: "ExecutionFailure" },
        {
          abort_details: "fee-only",
          executionFinalizeResult: { AcceptFeeRejectRest: [{}, { ExecutionFailure: "x" }] },
        },
      ),
    }));
    const provider = fakeProvider({ getTransactionResult });

    await expect(watchTransaction(provider, "tx_fee", { pollIntervalMs: 1 })).rejects.toThrow(TransactionRejectedError);
    await expect(watchTransaction(provider, "tx_fee", { pollIntervalMs: 1 })).rejects.toThrow(
      "Transaction tx_fee only committed fees (execution aborted): fee-only",
    );
  });

  it("rejects with a timeout message when the result stays Pending past the deadline", async () => {
    const getTransactionResult = vi.fn(async () => ({ result: "Pending" as const }));
    const provider = fakeProvider({ getTransactionResult });

    await expect(watchTransaction(provider, "tx_slow", { pollIntervalMs: 1, timeoutMs: 20 })).rejects.toThrow(
      TransactionTimeoutError,
    );
    await expect(watchTransaction(provider, "tx_slow", { pollIntervalMs: 1, timeoutMs: 20 })).rejects.toThrow(
      /Transaction tx_slow did not finalize within 20ms/,
    );
  });
});
