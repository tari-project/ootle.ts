---
title: Builtin Template Helpers
description: Pre-built builders for standard account and faucet operations.
---

The SDK includes typed builder classes for the two standard builtin templates: **Account** and **Faucet**. These wrap common patterns so you don't have to construct raw `callMethod` instructions manually.

Both take the transaction's mandatory `maxEpoch` as their second argument — see [Epoch Bounds](/transactions/epoch-bounds/).

## AccountInvokeBuilder

Build transactions that operate on account components.

```ts
import { AccountInvokeBuilder, Network, resolveMaxEpoch } from "@tari-project/ootle";

const tx = new AccountInvokeBuilder(Network.Esmeralda, await resolveMaxEpoch(provider))
  .feeTransactionPayFromComponent(accountAddress, 1000n)
  .publicTransfer(accountAddress, resourceAddress, 500n, recipientAddress)
  .build();
```

## FaucetInvokeBuilder

Build transactions that interact with faucet components (for testnet token distribution).

```ts
import { FaucetInvokeBuilder, Network, resolveMaxEpoch } from "@tari-project/ootle";

const tx = new FaucetInvokeBuilder(Network.Esmeralda, await resolveMaxEpoch(provider), faucetAddress)
  .feeTransactionPayFromComponent(accountAddress, 1000n)
  .takeFaucetFunds(accountAddress, 10_000n)
  .build();
```

## When to use builtin helpers vs TransactionBuilder

Use the builtin helpers when:

- You're doing standard account operations (transfers, deposits)
- You want type-safe method calls without remembering argument shapes

Use `TransactionBuilder` directly when:

- You're calling custom template methods
- You need to compose multiple instructions in a single transaction
- You need fine-grained control over the instruction sequence
