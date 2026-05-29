//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { sealTransaction, signTransaction } from "@tari-project/ootle";
import type { Signer, TransactionOutcome } from "@tari-project/ootle";
import { IndexerProvider, PendingTransaction } from "@tari-project/ootle-indexer";
import { indexerUrl } from "./env.js";

/**
 * Sign `unsigned` with each `signers` and submit the sealed envelope to `provider`.
 * Returns the pending handle.
 *
 * Thin wrapper around the SDK's `signTransaction` → `sealTransaction` → submit pipeline;
 * the example calls into it for the script-level "I just want a pending handle I can
 * `await pending.watch()` on" ergonomics.
 */
export async function signAndSubmit(
  provider: IndexerProvider,
  unsigned: UnsignedTransactionV1,
  signers: Signer[],
): Promise<PendingTransaction> {
  const signed = await signTransaction(signers, unsigned);
  const envelope = sealTransaction(signed);
  const { transaction_id } = await provider.submitTransaction(envelope);
  return provider.watchTransactionSSE(transaction_id);
}

/**
 * Result of a {@link dryRun} call: the indexer's synchronous execute response.
 *
 * Note that this is **not** the same shape as
 * `IndexerGetTransactionResultResponse`: the `/transactions/dry-run` endpoint
 * returns the raw `ExecuteResult` (`{ finalize, execution_time, execute_epoch }`),
 * with no `Finalized` wrapper and no `final_decision`. {@link classifyDryRun}
 * reduces it to the same `TransactionOutcome` shape `classifyOutcome` returns
 * for committed transactions.
 */
export interface DryRunResult {
  transaction_id: string;
  result: {
    finalize: {
      transaction_hash: string;
      result:
        | { Accept: unknown }
        | { AcceptFeeRejectRest: [unknown, unknown] }
        | { Reject: Record<string, unknown> | string };
      fee_receipt?: { total_fee_payment: number; total_fees_paid: number; total_fee_overcharge: number };
      events?: unknown[];
      logs?: unknown[];
    };
    execution_time?: { secs: number; nanos: number };
    execute_epoch?: number;
  };
}

/**
 * Reduce a {@link DryRunResult} to a `{ outcome, reason }` pair shaped like
 * `classifyOutcome` — so callers can branch on the same `"Commit" | "Reject"`
 * verdict regardless of whether the receipt came from a dry-run or a real
 * submission.
 */
export function classifyDryRun(result: DryRunResult): TransactionOutcome {
  const inner = result.result.finalize.result;
  if (typeof inner === "object" && inner !== null && "Accept" in inner) {
    return { outcome: "Commit" };
  }
  if (typeof inner === "object" && inner !== null && "AcceptFeeRejectRest" in inner) {
    return { outcome: "FeeIntentCommit", reason: JSON.stringify(inner.AcceptFeeRejectRest[1]) };
  }
  if (typeof inner === "object" && inner !== null && "Reject" in inner) {
    return {
      outcome: "Reject",
      reason: typeof inner.Reject === "string" ? inner.Reject : JSON.stringify(inner.Reject),
    };
  }
  return { outcome: "Reject", reason: JSON.stringify(inner) };
}

/**
 * Submit `unsigned` as a **dry run** to the indexer's `/transactions/dry-run`
 * endpoint and return the synchronous execution result. The dry-run endpoint
 * executes the transaction in-process and returns the receipt directly — no
 * SSE/poll loop is needed.
 *
 * Replaces the package's `sendDryRun` for the examples because the package version
 * submits to `/transactions` instead of `/transactions/dry-run`, which the indexer
 * rejects with `"Dry-run transactions must be submitted to the /transactions/dry-run endpoint"`.
 */
export async function dryRun(unsigned: UnsignedTransactionV1, signers: Signer[]): Promise<DryRunResult> {
  const dryUnsigned: UnsignedTransactionV1 = { ...unsigned, dry_run: true };
  const signed = await signTransaction(signers, dryUnsigned);
  const envelope = sealTransaction(signed);
  const url = `${indexerUrl().replace(/\/$/, "")}/transactions/dry-run`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: envelope }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "<no body>");
    throw new Error(`dryRun: HTTP ${response.status} ${response.statusText}: ${body}`);
  }
  return (await response.json()) as DryRunResult;
}

/**
 * Top-level wrapper for example scripts: registers an `AbortError`-swallowing
 * unhandled-rejection hook, runs `fn`, and always calls `provider.stopWatcher()`
 * in a `finally` block so the SSE watcher is torn down on both success and
 * error paths.
 *
 * `TransactionWatcher.stop()` aborts the SSE loop, rejecting its `for await`
 * promise with an `AbortError`; Node otherwise surfaces that as an unhandled
 * rejection and exits 1. Swallowing aborts preserves the exit-0 signal.
 *
 * Scripts that don't construct an `IndexerProvider` (e.g. SSE-only watchers
 * built on `openEventStream`) may return `{}` — the wrapper then handles only
 * the unhandled-rejection hook.
 */
export async function runScript(fn: () => Promise<{ provider?: IndexerProvider }>): Promise<void> {
  process.on("unhandledRejection", (reason) => {
    if (reason && typeof reason === "object" && (reason as { name?: string }).name === "AbortError") return;
    console.error("Unhandled rejection:", reason);
    process.exit(1);
  });
  let provider: IndexerProvider | undefined;
  try {
    const out = await fn();
    provider = out.provider;
  } catch (err) {
    if (err && typeof err === "object" && (err as { name?: string }).name === "AbortError") {
      // Aborts are intentional teardown (SIGINT closing an SSE stream, etc.), not failures.
    } else {
      console.error(err);
      process.exitCode = 1;
    }
  } finally {
    provider?.stopWatcher();
  }
}
