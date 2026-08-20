---
title: Epoch Bounds
description: Limit the time window during which a transaction is valid.
---

Every transaction carries a **mandatory** `max_epoch`: the last epoch in which it may be sequenced. A transaction's death is therefore deterministic — an attempt that aborts cannot be retried indefinitely, and a stuck transaction stops being a resubmittable intent once its window closes.

## maxEpoch is a constructor argument

`TransactionBuilder.new(network, maxEpoch)` takes it up front:

```ts
import { TransactionBuilder, resolveMaxEpoch } from "@tari-project/ootle";

const builder = TransactionBuilder.new(provider.network(), await resolveMaxEpoch(provider));
```

`resolveMaxEpoch(provider, leadEpochs?)` reads the chain tip via `provider.getCurrentEpoch()` and returns `currentEpoch + leadEpochs`, defaulting to `DEFAULT_TRANSACTION_VALIDITY_EPOCHS` (10). Pass an explicit number when you want a different window:

```ts
const maxEpoch = await resolveMaxEpoch(provider, 50);
```

The network caps the window at `MAX_TRANSACTION_VALIDITY_EPOCHS` (2160 epochs, roughly 30 days) past the current epoch. A transaction reaching further ahead is aborted with `ValidityWindowTooLong`.

## withMinEpoch

The transaction is only valid starting from this epoch. Unlike `max_epoch`, it is optional and defaults to unset:

```ts
builder.withMinEpoch(100);
```

## withMaxEpoch

Overrides the window set at construction:

```ts
builder.withMaxEpoch(200);
```

## Combining both

```ts
const unsignedTx = TransactionBuilder.new(Network.Esmeralda, await resolveMaxEpoch(provider))
  .feeTransactionPayFromComponent(accountAddress, 1000n)
  .callMethod({ componentAddress: accountAddress, methodName: "withdraw" }, [
    { Literal: resourceAddress },
    { Literal: "100" },
  ])
  .saveVar("bucket")
  .callMethod({ componentAddress: recipientAddress, methodName: "deposit" }, [{ Workspace: "bucket" }])
  .withMinEpoch(100)
  .withMaxEpoch(200)
  .buildUnsignedTransaction();
```

If the network's current epoch is outside the specified range, the transaction will be rejected.

## Nonce

The transaction id excludes the seal signature's witness data, so two identical bodies sealed by the same key are the _same_ transaction — submitting both executes once. When each submission must execute independently, stamp a distinct nonce per intent:

```ts
builder.withNonce(1);
```

It defaults to `0`.
