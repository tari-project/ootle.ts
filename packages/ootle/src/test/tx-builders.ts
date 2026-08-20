//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only helpers for assembling minimal `UnsignedTransactionV1` shapes.
// Not re-exported from the package root; tests import via relative subpath.

import type {
  IndexerGetTransactionResultResponse,
  IndexerTransactionFinalizedResult,
  UnsignedTransactionV1,
} from "@tari-project/ootle-ts-bindings";
import { TransactionBuilder } from "../builder";
import type { Network } from "../network";
import { TEST_MAX_EPOCH, TEST_NETWORK } from "./fixtures";

/**
 * The smallest valid `UnsignedTransactionV1` — a single `DropAllProofsInWorkspace`
 * instruction. Useful when a test only cares about the sign/seal flow, not the
 * instruction set itself.
 */
export function trivialUnsignedTx(
  network: Network = TEST_NETWORK,
  maxEpoch: number = TEST_MAX_EPOCH,
): UnsignedTransactionV1 {
  return TransactionBuilder.new(network, maxEpoch).dropAllProofsInWorkspace().buildUnsignedTransaction();
}

/** The `final_decision` union of a `Finalized` transaction result. */
type FinalDecision = IndexerTransactionFinalizedResult extends infer T
  ? T extends { Finalized: { final_decision: infer D } }
    ? D
    : never
  : never;

/**
 * A `Finalized` transaction result carrying `decision`.
 *
 * The single source of this shape for the package — note `finalized_time` is a
 * STRING and `execution_time` is `{ secs, nanos }`; hand-rolled copies of this
 * fixture have got that backwards behind an `as unknown as` cast, which then hides
 * a genuine wire-shape drift the next time the binding changes.
 */
export function finalized(
  decision: FinalDecision,
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

/** The full provider response wrapping a finalized `Commit` — the terminal state `watchTransaction` accepts. */
export function committedResult(): IndexerGetTransactionResultResponse {
  return { result: finalized("Commit") } as IndexerGetTransactionResultResponse;
}
