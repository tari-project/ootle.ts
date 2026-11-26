# Changelog

All notable changes to `@tari-project/ootle-indexer` are documented here.

## 0.22.0

### BREAKING — `IndexerProvider.getSubstate` throws `SubstateNotFoundError` on a 404

`IndexerProvider.getSubstate` throws `SubstateNotFoundError` (from `@tari-project/ootle`) when the indexer
answers 404. It used to throw the `indexer-client` `HttpError`, which is now available as the error's `cause`.
Code that checked `err.status === 404` should test `err instanceof SubstateNotFoundError` instead. Other
errors, such as a 503 from an indexer that is still syncing, are thrown unchanged.

### Fixed

- `isNotFoundError` classifies an error with an HTTP status by that status alone, so `getStealthUtxo` and
  `resolveInputs` no longer treat a 5xx, or a connection error to port 4040, as "not found" because the
  message contains `404`.
- `PendingTransaction.watch()` throws `TransactionRejectedError` when the REST fallback returns `Rejected`,
  instead of timing out.
- `TransactionWatcher` now tracks pending waiters per transaction ID with a `Set`,
  so concurrent `watch()` calls or multiple `PendingTransaction` handles for the
  same `txId` resolve on the same SSE event and cancelling or settling one handle
  no longer drops other handles' waiters.
- `TransactionWatcher` ignores a `TransactionFinalized` SSE event with a null payload instead of crashing.
- `resolveInputs` resolves an input whose `version` is `undefined`, and `resolveWantInputs` wraps lookup
  errors in `IndexerClientError`.
- `IndexerProvider.connect`, `ProviderBuilder.withUrl` and `ProviderBuilder.withTransactionTimeoutMs` reject
  an empty URL and a timeout that is not a positive finite number.
- The SSE parser follows the spec: bare `\r` line endings, one leading space stripped from a field, field-only
  `data`/`event` lines, and an empty event type dispatched as `message`. Line length is checked before
  multi-chunk lines are joined, and the retry back-off removes its abort listener.

## 0.21.0 and earlier

### BREAKING — Tari Ootle 0.49 indexer

Requires a Tari Ootle 0.49 indexer. `IndexerProvider` passes the indexer's responses through, so substate
values (`getSubstate`, `getStealthUtxo`, `fetchSubstates`) and a finalized result's `execution_result` are
now CBOR-encoded strings. Decode them with `upSubstateValue` / `decodeSubstateValue` /
`decodeExecuteResult` from `@tari-project/ootle`.

### BREAKING — `PendingTransaction.watch()` return type narrowed

`PendingTransaction.watch()` now returns `Promise<CommitOutcome>`
(`{ outcome: "Commit" }`) instead of `Promise<TransactionOutcome>`. It only ever
resolves on a successful commit; every other verdict throws —
`TransactionRejectedError` (Reject or FeeIntentCommit), `TransactionTimeoutError`,
or `OperationCancelledError`.

Callers that pattern-matched on the resolved value (e.g.
`if (outcome.outcome === "Reject")`) must move that handling into a `try/catch`
on `TransactionRejectedError`; those return-based branches are now dead.

### Fixed

- `openEventStream` (used by `TransactionWatcher`) no longer buffers an
  unterminated SSE event without limit or re-parses the whole buffer on every
  chunk. It now scans each chunk once and fails the stream (falling into the
  existing reconnect back-off) when a line exceeds `MAX_SSE_LINE_LENGTH` or one
  event's data exceeds `MAX_SSE_EVENT_DATA_LENGTH` (both 1 MiB), so a hostile
  indexer can no longer exhaust client memory or CPU.
  ([GHSA-j9gh-gmgx-hhp3](https://github.com/tari-project/tari-ootle/security/advisories/GHSA-j9gh-gmgx-hhp3))
- `parseSseChunk` is deprecated; it keeps the unbounded carry-forward behaviour.
- `restPollUntilFinal` no longer swallows transport errors. A 5xx / auth /
  network / parse failure during polling is remembered and surfaced as the
  `TransactionTimeoutError`'s `cause`, instead of masquerading as "still pending".
- The pure SSE-timeout path now polls a short dedicated grace window so a
  transaction that commits just after the SSE timeout is still caught, rather than
  spuriously timing out after a single poll.
