//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { IndexerClient } from "@tari-project/indexer-client";
import type { IndexerGetTransactionResultResponse } from "@tari-project/ootle-ts-bindings";
import type { TransactionOutcome } from "@tari-project/ootle";
import {
  classifyOutcome,
  IndexerClientError,
  OperationCancelledError,
  TransactionRejectedError,
  TransactionTimeoutError,
} from "@tari-project/ootle";
import { openEventStream } from "./event-stream";

/** Shape of a `TransactionFinalized` SSE event payload from the indexer. */
interface TransactionFinalizedPayload {
  transaction_id: string;
  final_decision: "Commit" | { Abort: unknown };
  fee_decision?: "Commit" | { Abort: unknown };
  abort_details?: string | null;
}

/**
 * SSE-side decision before `PendingTransaction` maps it to a `TransactionOutcome`.
 * `Indeterminate` covers the LocalNet quirk where a `TransactionFinalized` event
 * arrives without `final_decision` — the REST receipt has the verdict.
 */
type SseFinalizedDecision =
  | { decision: "Commit" }
  | { decision: "Reject"; reason: string }
  | { decision: "Indeterminate" };

interface PendingWaiter {
  resolve: (decision: SseFinalizedDecision) => void;
  reject: (err: Error) => void;
}

/**
 * Subscribes to the indexer's SSE `/events` stream and routes
 * `TransactionFinalized` events to waiting callers.
 *
 * The stream is paused (abort + reconnect deferred) when no transactions are
 * being watched, and resumed on the first new `watch()` call.
 * Mirrors `TransactionWatcher` from the Rust ootle-rs crate.
 *
 * Lifecycle: call `start()` once (idempotent), then obtain
 * `PendingTransaction` handles via `watch()`. Call `stop()` to shut down.
 */
export class TransactionWatcher {
  private readonly baseUrl: string;
  private pending = new Map<string, PendingWaiter>();
  private abortController: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(baseUrl: string) {
    // Normalise: strip trailing slash so we can append /events consistently.
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  }

  /**
   * Starts the background SSE loop (idempotent — safe to call multiple times).
   */
  public start(): void {
    if (this.abortController && !this.abortController.signal.aborted) return;
    this.abortController = new AbortController();
    this.loopPromise = this.run(this.abortController.signal);
  }

  /**
   * Stops the background loop and rejects any still-parked waiters with
   * `IndexerClientError("TransactionWatcher stopped")`. In normal use
   * `PendingTransaction` self-unregisters, so a hit here means a leaked handle.
   */
  public stop(): void {
    this.abortController?.abort();
    const err = new IndexerClientError("TransactionWatcher stopped", { url: this.baseUrl });
    for (const waiter of this.pending.values()) {
      waiter.reject(err);
    }
    this.pending.clear();
  }

  /**
   * Returns a `PendingTransaction` that resolves when the network finalises
   * the given transaction ID, throwing on Reject / FeeIntentCommit / timeout.
   *
   * Automatically starts the watcher loop if it isn't running yet.
   */
  public watch(txId: string, client: IndexerClient, timeoutMs = 32_000): PendingTransaction {
    this.start();
    return new PendingTransaction(txId, this, client, timeoutMs);
  }

  /** Internal: register a waiter for a transaction ID. */
  public register(txId: string): Promise<SseFinalizedDecision> {
    return new Promise<SseFinalizedDecision>((resolve, reject) => {
      this.pending.set(txId, { resolve, reject });
    });
  }

  /** Internal: remove a pending waiter. */
  public unregister(txId: string): void {
    this.pending.delete(txId);
  }

  private async run(signal: AbortSignal): Promise<void> {
    const url = `${this.baseUrl}/events`;

    for await (const event of openEventStream(url, signal)) {
      if (event.type !== "TransactionFinalized") continue;

      const payload = event.data as TransactionFinalizedPayload;
      const waiter = this.pending.get(payload.transaction_id);
      if (!waiter) continue;

      this.pending.delete(payload.transaction_id);

      const decision = payload.final_decision;
      if (decision === "Commit") {
        waiter.resolve({ decision: "Commit" });
      } else if (typeof decision === "object" && decision !== null && "Abort" in decision) {
        const reason = payload.abort_details ?? JSON.stringify(decision.Abort);
        waiter.resolve({ decision: "Reject", reason });
      } else {
        // Missing `final_decision` — let PendingTransaction fall back to REST.
        waiter.resolve({ decision: "Indeterminate" });
      }
    }
  }
}

/**
 * A handle for a submitted transaction.
 *
 * Mirrors `PendingTransaction` from the Rust ootle-rs crate.
 *
 * @example
 * ```ts
 * const pending = watcher.watch(txId, client);
 * try {
 *   await pending.watch();              // SSE-driven, throws on non-Commit / timeout
 * } catch (err) {
 *   if (err instanceof TransactionRejectedError) { ... }
 * }
 * const receipt = await pending.getReceipt(); // full receipt if needed
 * ```
 */
export class PendingTransaction {
  private readonly txId: string;
  private readonly watcher: TransactionWatcher;
  private readonly client: IndexerClient;
  private readonly timeoutMs: number;
  private cancellation: { promise: Promise<never>; reject: (err: Error) => void } | null = null;

  constructor(txId: string, watcher: TransactionWatcher, client: IndexerClient, timeoutMs: number) {
    this.txId = txId;
    this.watcher = watcher;
    this.client = client;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Waits for the transaction to finalise via SSE, with REST as the verdict
   * source when SSE is ambiguous. `Commit` resolves directly; `Abort` fetches
   * the receipt once to distinguish `Reject` from `FeeIntentCommit`;
   * `Indeterminate` or SSE silence falls back to REST polling within `timeoutMs`.
   *
   * @throws {TransactionRejectedError} on Reject or FeeIntentCommit (FIC's
   *   `.reason` is prefixed `"FeeIntentCommit: "`).
   * @throws {TransactionTimeoutError} when neither SSE nor REST sees finality in time.
   * @throws {OperationCancelledError} when `cancel()` was called.
   */
  public async watch(): Promise<TransactionOutcome> {
    const ssePromise = this.watcher.register(this.txId);
    const deadline = Date.now() + this.timeoutMs;

    let sseTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const sseTimeout = new Promise<"sse-timeout">((resolve) => {
      sseTimeoutHandle = setTimeout(() => resolve("sse-timeout"), this.timeoutMs);
    });

    let cancellationReject: (err: Error) => void = () => {};
    const cancellationPromise = new Promise<never>((_, reject) => {
      cancellationReject = reject;
    });
    this.cancellation = { promise: cancellationPromise, reject: cancellationReject };

    try {
      const result = await Promise.race([ssePromise, sseTimeout, this.cancellation.promise]);
      if (sseTimeoutHandle !== null) clearTimeout(sseTimeoutHandle);

      if (result === "sse-timeout" || result.decision === "Indeterminate") {
        return await this.restPollUntilFinal(deadline);
      }
      if (result.decision === "Commit") {
        return { outcome: "Commit" };
      }
      // Abort: REST receipt distinguishes Reject from FeeIntentCommit.
      const receipt = await this.client.getTransactionResult(this.txId);
      this.throwFromReceipt(receipt, result.reason);
    } finally {
      this.watcher.unregister(this.txId);
      if (sseTimeoutHandle !== null) clearTimeout(sseTimeoutHandle);
      this.cancellation = null;
    }
    // Unreachable — throwFromReceipt always throws on the Abort branch.
    throw new TransactionRejectedError(`Transaction ${this.txId} was rejected`, {
      txId: this.txId,
      reason: "",
    });
  }

  private throwFromReceipt(receipt: IndexerGetTransactionResultResponse, fallbackReason: string): never {
    const classified = classifyOutcome(receipt.result);
    if (classified?.outcome === "FeeIntentCommit") {
      throw new TransactionRejectedError(
        `Transaction ${this.txId} only committed fees (execution aborted): ${classified.reason ?? fallbackReason}`,
        { txId: this.txId, reason: `FeeIntentCommit: ${classified.reason ?? fallbackReason}` },
      );
    }
    const reason = classified?.reason ?? fallbackReason;
    throw new TransactionRejectedError(`Transaction ${this.txId} was rejected: ${reason}`, {
      txId: this.txId,
      reason,
    });
  }

  private async restPollUntilFinal(deadline: number): Promise<TransactionOutcome> {
    const POLL_INTERVAL_MS = 500;
    // At least one attempt even if the budget is already spent — an SSE event
    // told us finality happened, so the receipt is usually ready now.
    do {
      const receipt = await this.client.getTransactionResult(this.txId).catch(() => null);
      if (receipt) {
        const classified = classifyOutcome(receipt.result);
        if (classified) {
          if (classified.outcome === "Commit") return { outcome: "Commit" };
          this.throwFromReceipt(receipt, classified.reason ?? "");
        }
      }
      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    } while (Date.now() < deadline);
    throw new TransactionTimeoutError(`Transaction ${this.txId} did not finalise within ${this.timeoutMs}ms`, {
      txId: this.txId,
    });
  }

  /**
   * Cancels an in-flight `watch()`. The watch promise rejects with
   * `OperationCancelledError`. Idempotent; a no-op when no watch is active.
   */
  public cancel(): void {
    this.watcher.unregister(this.txId);
    this.cancellation?.reject(new OperationCancelledError(`Wait for transaction ${this.txId} was cancelled`));
  }

  /**
   * Polls the indexer once for the current transaction result and returns
   * the raw response. Useful for fetching full receipt data after `watch()`.
   */
  public async getReceipt(): Promise<IndexerGetTransactionResultResponse> {
    return this.client.getTransactionResult(this.txId);
  }
}
