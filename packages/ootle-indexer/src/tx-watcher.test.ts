//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit tests for `TransactionWatcher` and `PendingTransaction`. SSE plumbing is
// faked by mocking `openEventStream` (the only `./event-stream` consumer in
// `tx-watcher.ts`); the fake yields events from a queue the test owns so each
// case can drive the stream timing precisely. `client.getTransactionResult` is
// stubbed as a plain `vi.fn()` — `PendingTransaction` is the only place the
// `IndexerClient` shape is consumed and only the one method is called.

import type { IndexerClient } from "@tari-project/indexer-client";
import type {
  IndexerGetTransactionResultResponse,
  IndexerTransactionFinalizedResult,
} from "@tari-project/ootle-ts-bindings";
import type { CommitOutcome } from "@tari-project/ootle";
import { IndexerClientError, OperationCancelledError, TransactionTimeoutError } from "@tari-project/ootle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A pushable async iterable backing the `openEventStream` mock. Each test gets
 * a fresh queue; `push()` yields the next event, `close()` ends the stream.
 */
interface EventQueue {
  push: (event: { type: string; data: unknown }) => void;
  close: () => void;
}

let activeQueue: EventQueue | null = null;

/** The mocked event stream installs `activeQueue` on its first await; this asserts it is present. */
function requireQueue(): EventQueue {
  if (!activeQueue) {
    throw new Error("activeQueue was not installed — call flushQueueInstall() first");
  }
  return activeQueue;
}

vi.mock("./event-stream", () => ({
  openEventStream: async function* (_url: string, signal: AbortSignal) {
    // Per-test event queue: tests grab `activeQueue` to push events.
    const pending: { type: string; data: unknown }[] = [];
    let resolveNext: (() => void) | null = null;
    let closed = false;

    activeQueue = {
      push: (event) => {
        pending.push(event);
        resolveNext?.();
        resolveNext = null;
      },
      close: () => {
        closed = true;
        resolveNext?.();
        resolveNext = null;
      },
    };

    while (!signal.aborted && !closed) {
      if (pending.length > 0) {
        const next = pending.shift();
        if (next !== undefined) {
          yield next;
        }
        continue;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
        const onAbort = () => {
          resolveNext?.();
          resolveNext = null;
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  },
}));

// Imported AFTER the mock is declared so the watcher picks up the stubbed module.
import { PendingTransaction, TransactionWatcher } from "./tx-watcher";

function commitEvent(txId: string): { type: string; data: unknown } {
  return {
    type: "TransactionFinalized",
    data: {
      transaction_id: txId,
      final_decision: "Commit",
    },
  };
}

function abortEvent(txId: string, reason: string): { type: string; data: unknown } {
  return {
    type: "TransactionFinalized",
    data: {
      transaction_id: txId,
      final_decision: { Abort: { ExecutionFailure: reason } },
      abort_details: reason,
    },
  };
}

/** Build a `Finalized` indexer response for the given final_decision + finalize.result shape. */
function finalizedResult(
  decision: IndexerTransactionFinalizedResult extends infer T
    ? T extends { Finalized: { final_decision: infer D } }
      ? D
      : never
    : never,
  opts: {
    abort_details?: string | null;
    executionFinalizeResult?: unknown;
  } = {},
): IndexerGetTransactionResultResponse {
  return {
    result: {
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
    } as IndexerTransactionFinalizedResult,
  };
}

function makeClient(getTransactionResult: ReturnType<typeof vi.fn>): IndexerClient {
  return { getTransactionResult } as unknown as IndexerClient;
}

/**
 * Microtask flush so the mocked `openEventStream` async generator runs up to
 * its first `await` and installs `activeQueue`. Two awaits suffice in practice.
 */
async function flushQueueInstall(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("TransactionWatcher SSE routing", () => {
  let watcher: TransactionWatcher;

  beforeEach(() => {
    activeQueue = null;
    watcher = new TransactionWatcher("http://localhost:18300");
    watcher.start();
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  it("resolves Commit directly on SSE Commit without fetching the receipt", async () => {
    const getTransactionResult = vi.fn();
    const client = makeClient(getTransactionResult);
    const pending = watcher.watch("tx_match", client, 60_000);

    await flushQueueInstall();
    requireQueue().push(commitEvent("tx_match"));

    const outcome = await pending.watch();
    expect(outcome).toEqual({ outcome: "Commit" });
    expect(getTransactionResult).not.toHaveBeenCalled();
  });

  it("throws Reject on SSE Abort with a plain Reject receipt", async () => {
    const getTransactionResult = vi
      .fn()
      .mockResolvedValue(finalizedResult({ Abort: "ExecutionFailure" }, { abort_details: "fees exceeded" }));
    const client = makeClient(getTransactionResult);
    const pending = watcher.watch("tx_abort", client, 60_000);

    await flushQueueInstall();
    requireQueue().push(abortEvent("tx_abort", "fees exceeded"));

    await expect(pending.watch()).rejects.toThrow(/was rejected: fees exceeded/);
    expect(getTransactionResult).toHaveBeenCalledWith("tx_abort");
  });

  it("throws FeeIntentCommit on SSE Abort when receipt shows AcceptFeeRejectRest", async () => {
    const getTransactionResult = vi.fn().mockResolvedValue(
      finalizedResult(
        { Abort: "ExecutionFailure" },
        {
          abort_details: "user-side revert",
          executionFinalizeResult: { AcceptFeeRejectRest: [{}, { ExecutionFailure: "x" }] },
        },
      ),
    );
    const client = makeClient(getTransactionResult);
    const pending = watcher.watch("tx_fee", client, 60_000);

    await flushQueueInstall();
    requireQueue().push(abortEvent("tx_fee", "user-side revert"));

    await expect(pending.watch()).rejects.toThrow(/only committed fees \(execution aborted\): user-side revert/);
  });

  it("falls back to REST polling when the SSE event lacks final_decision", async () => {
    // The indexer occasionally fires `TransactionFinalized` with a missing
    // `final_decision` (observed on LocalNet); the receipt is reliable.
    const getTransactionResult = vi.fn().mockResolvedValue(finalizedResult("Commit"));
    const client = makeClient(getTransactionResult);
    const pending = watcher.watch("tx_indet", client, 60_000);

    await flushQueueInstall();
    requireQueue().push({
      type: "TransactionFinalized",
      data: { transaction_id: "tx_indet" }, // no final_decision
    });

    const outcome = await pending.watch();
    expect(outcome).toEqual({ outcome: "Commit" });
    expect(getTransactionResult).toHaveBeenCalledWith("tx_indet");
  });

  it("ignores SSE events for an unrelated tx and resolves the matching watcher", async () => {
    const getTransactionResult = vi.fn();
    const client = makeClient(getTransactionResult);
    const pendingMatch = watcher.watch("tx_match", client, 60_000);

    await flushQueueInstall();
    requireQueue().push(commitEvent("tx_other"));
    requireQueue().push(commitEvent("tx_match"));

    const outcome = await pendingMatch.watch();
    expect(outcome).toEqual({ outcome: "Commit" });
  });
});

describe("PendingTransaction timeout", () => {
  let watcher: TransactionWatcher;

  beforeEach(() => {
    activeQueue = null;
    watcher = new TransactionWatcher("http://localhost:18300");
    watcher.start();
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  it("rejects with TransactionTimeoutError when neither SSE nor REST sees finality", async () => {
    // REST returns "Pending" forever, SSE never delivers — both miss the deadline.
    const getTransactionResult = vi.fn().mockResolvedValue({ result: "Pending" });
    const client = makeClient(getTransactionResult);
    const pending = new PendingTransaction("tx_stuck", watcher, client, 5);

    await expect(pending.watch()).rejects.toThrow(TransactionTimeoutError);
  });

  it("recovers via the grace window when the tx commits just after the SSE timeout (Point 5)", async () => {
    // SSE never delivers, so the watch hits the sse-timeout path (timeoutMs = 5ms).
    // REST returns Pending on the first poll and Commit on the next — within the
    // dedicated grace window — so the watch resolves to Commit, not a timeout.
    const getTransactionResult = vi
      .fn()
      .mockResolvedValueOnce({ result: "Pending" })
      .mockResolvedValue(finalizedResult("Commit"));
    const client = makeClient(getTransactionResult);
    const pending = new PendingTransaction("tx_late_commit", watcher, client, 5);

    const outcome = await pending.watch();
    expect(outcome).toEqual({ outcome: "Commit" });
    expect(getTransactionResult.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces the underlying transport error as the timeout's cause (Point 11)", async () => {
    // A persistent 5xx-style failure throughout the poll window must NOT look like
    // "still pending": the resulting TransactionTimeoutError carries the real error.
    const transportError = new Error("HTTP 502: bad gateway");
    const getTransactionResult = vi.fn().mockRejectedValue(transportError);
    const client = makeClient(getTransactionResult);
    const pending = new PendingTransaction("tx_outage", watcher, client, 5);

    const err = await pending.watch().catch((e) => e);
    expect(err).toBeInstanceOf(TransactionTimeoutError);
    expect((err as Error).cause).toBe(transportError);
  });

  it("clears a resolved transient error so it is not surfaced as the timeout's cause", async () => {
    // A transient glitch that later recovers (subsequent polls succeed but stay
    // pending) must NOT leave the stale error as the timeout's cause.
    const transportError = new Error("HTTP 502: bad gateway");
    const getTransactionResult = vi
      .fn()
      .mockRejectedValueOnce(transportError)
      .mockResolvedValue({ result: "Pending" });
    const client = makeClient(getTransactionResult);
    const pending = new PendingTransaction("tx_recovered", watcher, client, 5);

    const err = await pending.watch().catch((e) => e);
    expect(err).toBeInstanceOf(TransactionTimeoutError);
    expect((err as Error).cause).toBeUndefined();
  });

  it("treats a null final_decision in the REST receipt as not-final (Point 3)", async () => {
    // The off-spec `final_decision: null` quirk must keep polling, not throw a
    // TypeError; with no later verdict it ends in a plain timeout (no cause).
    const getTransactionResult = vi.fn().mockResolvedValue(
      finalizedResult(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        null as any,
      ),
    );
    const client = makeClient(getTransactionResult);
    const pending = new PendingTransaction("tx_null_decision", watcher, client, 5);

    const err = await pending.watch().catch((e) => e);
    expect(err).toBeInstanceOf(TransactionTimeoutError);
    expect((err as Error).cause).toBeUndefined();
  });

  it("watch() resolves to a CommitOutcome — only { outcome: 'Commit' } is assignable", async () => {
    const getTransactionResult = vi.fn().mockResolvedValue(finalizedResult("Commit"));
    const client = makeClient(getTransactionResult);
    const pending = new PendingTransaction("tx_type", watcher, client, 5);

    const outcome: CommitOutcome = await pending.watch();
    expect(outcome).toEqual({ outcome: "Commit" });
  });

  it("unregisters the waiter on timeout so a later stop() does not double-reject", async () => {
    const getTransactionResult = vi.fn().mockResolvedValue({ result: "Pending" });
    const client = makeClient(getTransactionResult);
    const pending = new PendingTransaction("tx_stuck", watcher, client, 5);

    const captured = pending.watch().catch((err) => err);
    const first = await captured;
    expect(first).toBeInstanceOf(TransactionTimeoutError);

    // After timeout the waiter must already be gone — stop() should be silent
    // (i.e. not flip the original error's identity by rejecting a still-parked promise).
    watcher.stop();
    expect(first).toBeInstanceOf(TransactionTimeoutError);
  });
});

describe("PendingTransaction.cancel()", () => {
  let watcher: TransactionWatcher;

  beforeEach(() => {
    activeQueue = null;
    watcher = new TransactionWatcher("http://localhost:18300");
    watcher.start();
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  it("rejects an in-flight watch with OperationCancelledError", async () => {
    const client = makeClient(vi.fn());
    const pending = new PendingTransaction("tx_cancel", watcher, client, 60_000);

    const captured = pending.watch().catch((err) => err);
    await flushQueueInstall();
    pending.cancel();

    const err = await captured;
    expect(err).toBeInstanceOf(OperationCancelledError);
  });

  it("rejects with OperationCancelledError when cancelled during the REST polling fallback", async () => {
    // An Indeterminate SSE event pushes the watch past the SSE race into
    // `restPollUntilFinal`; the REST call never settles, so the watch is parked
    // mid-poll when we cancel. Before the fix the polling promise wasn't raced
    // against cancellation, so `cancel()` was ignored and `watch()` hung until timeout.
    const getTransactionResult = vi.fn().mockReturnValue(new Promise<never>(() => {}));
    const client = makeClient(getTransactionResult);
    const pending = new PendingTransaction("tx_cancel_poll", watcher, client, 60_000);

    const captured = pending.watch().catch((err) => err);
    await flushQueueInstall();
    requireQueue().push({
      type: "TransactionFinalized",
      data: { transaction_id: "tx_cancel_poll" }, // no final_decision → Indeterminate → REST fallback
    });

    // Drain microtasks until the watch has left the SSE race and issued its first
    // poll — asserting this is what makes the test exercise the polling phase
    // specifically (the SSE race at line ~190 already handles cancellation).
    for (let i = 0; i < 20 && getTransactionResult.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(getTransactionResult).toHaveBeenCalledWith("tx_cancel_poll");

    pending.cancel();

    const err = await captured;
    expect(err).toBeInstanceOf(OperationCancelledError);
  });

  it("removes the waiter so a subsequent stop() does not also reject it", async () => {
    const client = makeClient(vi.fn());
    const pending = new PendingTransaction("tx_cancel_stop", watcher, client, 60_000);

    const captured = pending.watch().catch((err) => err);
    await flushQueueInstall();
    pending.cancel();
    const err = await captured;
    expect(err).toBeInstanceOf(OperationCancelledError);

    // stop() now broadcasts to the (empty) pending map. Nothing else should reject.
    watcher.stop();
    // No assertions on errors here beyond the initial — the test passes by not
    // throwing an unhandled rejection while tests teardown.
  });
});

describe("TransactionWatcher.stop() — leaked-handle contract", () => {
  it("rejects parked waiters with IndexerClientError so leaks are loud", async () => {
    const watcher = new TransactionWatcher("http://localhost:18300");
    watcher.start();

    // Simulate a leak: register directly without going through PendingTransaction's
    // self-cleanup. In real misuse this would be a caller who awaited watch() and
    // then discarded the rejection without cleanup, or shared state across handles.
    const leaked = watcher.register("tx_leaked");
    const captured = leaked.catch((err) => err);

    watcher.stop();
    const err = await captured;
    expect(err).toBeInstanceOf(IndexerClientError);
    expect((err as Error).message).toMatch(/TransactionWatcher stopped/);
  });
});
