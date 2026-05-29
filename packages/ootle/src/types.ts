//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { FinalizeOutcome } from "@tari-project/ootle-ts-bindings";

export type {
  Amount,
  UnsignedTransactionV1,
  Transaction,
  TransactionV1,
  UnsealedTransactionV1,
  TransactionSignature,
  Instruction,
  InstructionArg,
  SubstateRequirement,
  SubstateId,
  TransactionEnvelope,
  IndexerSubmitTransactionRequest,
  IndexerSubmitTransactionResponse,
  IndexerGetSubstateRequest,
  IndexerGetSubstateResponse,
  IndexerGetTransactionResultResponse,
  IndexerTransactionFinalizedResult,
  GetSubstatesRequest,
  GetSubstatesResponse,
  GetTemplateDefinitionResponse,
  Decision,
  ExecuteResult,
  FinalizeResult,
  FinalizeOutcome,
} from "@tari-project/ootle-ts-bindings";

/**
 * The classified result of a finalized transaction.
 *
 * - `"Commit"` — all instructions committed successfully.
 * - `"FeeIntentCommit"` — fee instructions committed but execution was aborted
 *   (the network accepted the fee intent but rejected the rest).
 * - `"Reject"` — the entire transaction was rejected.
 */
export interface TransactionOutcome {
  outcome: FinalizeOutcome | "Reject";
  reason?: string;
}

/**
 * The only outcome a `PendingTransaction.watch()` can resolve to: a successful
 * commit. Every non-commit verdict (Reject, FeeIntentCommit, timeout, cancel)
 * throws instead, so the return type is narrowed to this rather than the full
 * {@link TransactionOutcome} union.
 */
export interface CommitOutcome {
  outcome: "Commit";
}

export interface WatchOptions {
  /** How often to poll for the transaction result, in milliseconds. Defaults to 500ms. */
  pollIntervalMs?: number;
  /** Maximum time to wait before throwing a timeout error, in milliseconds. Defaults to 60000ms. */
  timeoutMs?: number;
}

/**
 * Implemented by types that can produce a component address string.
 * Mirrors the `ToAccountAddress` trait from ootle-rs.
 */
export interface ToAccountAddress {
  toAccountAddress(): string;
}
