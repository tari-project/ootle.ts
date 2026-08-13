---
title: Epoch Bounds
description: Limit the time window during which a transaction is valid.
---

Epoch bounds constrain when a transaction can be executed. This is useful for time-sensitive operations where a stale transaction should not be processed.

## withMinEpoch

The transaction is only valid starting from this epoch:

```ts
builder.withMinEpoch(100);
```

## withMaxEpoch

The transaction is only valid until this epoch:

```ts
builder.withMaxEpoch(200);
```

## Combining both

```ts
const unsignedTx = TransactionBuilder.new(Network.Esmeralda)
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
