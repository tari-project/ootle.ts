# Changelog

All notable changes to `@tari-project/ootle-indexer` are documented here.

## Unreleased

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

- `restPollUntilFinal` no longer swallows transport errors. A 5xx / auth /
  network / parse failure during polling is remembered and surfaced as the
  `TransactionTimeoutError`'s `cause`, instead of masquerading as "still pending".
- The pure SSE-timeout path now polls a short dedicated grace window so a
  transaction that commits just after the SSE timeout is still caught, rather than
  spuriously timing out after a single poll.
