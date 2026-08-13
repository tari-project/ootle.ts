---
title: Transaction Flow
description: How transactions move from construction to finalization.
---

A transaction in ootle.ts goes through five stages: **build**, **resolve**, **sign**, **seal**, and **submit**. The SDK provides both individual functions for each stage and an all-in-one convenience helper.

## The pipeline

```
TransactionBuilder.buildUnsignedTransaction()
  → resolveTransaction(provider, unsignedTx)     // fill in substate versions
  → signTransaction([signer], resolvedTx)         // seal keypair + Schnorr signatures
  → sealTransaction(signed)                       // BOR-encode into TransactionEnvelope
  → submitTransaction(provider, envelope)          // submit to network
  → watchTransaction(provider, txId)              // wait for finalization
```

## Individual steps

```ts
import {
  resolveTransaction,
  signTransaction,
  sealTransaction,
  submitTransaction,
  watchTransaction,
  classifyOutcome,
} from "@tari-project/ootle";

// 1. Resolve — fills in missing substate versions
const resolved = await resolveTransaction(provider, unsignedTx);

// 2. Sign — generates a seal keypair, collects Schnorr signatures
const signed = await signTransaction([signer], resolved);

// 3. Seal — BOR-encodes the signed transaction into a TransactionEnvelope
const envelope = sealTransaction(signed);

// 4. Submit — sends the envelope to the network
const txId = await submitTransaction(provider, envelope);

// 5. Watch — waits for finalization (SSE + polling fallback)
const receipt = await watchTransaction(provider, txId, { timeoutMs: 30_000 });

// 6. Inspect the outcome
const outcome = classifyOutcome(receipt.result);
// { outcome: "Commit" }
// | { outcome: "FeeIntentCommit", reason: string }
// | { outcome: "Reject", reason: string }
```

## All-in-one helpers

```ts
import { sendTransaction, sendDryRun } from "@tari-project/ootle";

// Resolve → sign → seal → submit → watch in a single call
const receipt = await sendTransaction(provider, signer, unsignedTx);

// Dry-run: simulates without committing state
const result = await sendDryRun(provider, signer, unsignedTx);
```

`sendTransaction` accepts either a single `Signer` or an array of signers. All signatures are collected before sealing and submitting.

## Transaction outcomes

`classifyOutcome` returns one of three outcomes:

| Outcome           | Meaning                            |
| ----------------- | ---------------------------------- |
| `Commit`          | Transaction fully committed        |
| `FeeIntentCommit` | Fee deducted but execution aborted |
| `Reject`          | Transaction rejected entirely      |

`watchTransaction` throws on both `Reject` and `FeeIntentCommit` outcomes. Use `classifyOutcome` directly on the raw `IndexerGetTransactionResultResponse` for non-throwing outcome inspection. `PendingTransaction.watch()` (from `ootle-indexer`) does **not** throw — the caller decides how to handle each outcome.
