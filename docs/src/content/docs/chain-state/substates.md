---
title: Substates
description: Query on-chain substates via the provider.
---

Substates are the fundamental storage units on the Ootle network — components, vaults, resources, and more. The `Provider` interface exposes methods to read them.

## Get a single substate

```ts
const substate = await provider.getSubstate("component_0x…");
console.log(substate);
```

Returns an `IndexerGetSubstateResponse` with the substate version and its `state`. The indexer serves the value CBOR-encoded (base64); `upSubstateValue` decodes it:

```ts
import { upSubstateValue } from "@tari-project/ootle";

const value = upSubstateValue(substate); // SubstateValue, or null if the version is down
```

## Fetch multiple substates

```ts
import { decodeSubstateValue } from "@tari-project/ootle";

const { substates } = await provider.fetchSubstates(["component_0x…", "vault_0x…"]);
for (const [id, substate] of Object.entries(substates)) {
  if (substate) console.log(id, substate.version, decodeSubstateValue(substate.value));
}
```

The SDK exports a decoder for each CBOR value the indexer serves: `decodeSubstateValue`, `decodeExecuteResult` (a finalized transaction's `execution_result`), `decodeTransactionReceipt`, `decodeEvent`, `decodeResource` and `decodeUtxo`.

## List recent transactions

Query recent transactions from the indexer:

```ts
const result = await provider.listRecentTransactions({ limit: 5, last_id: null });

for (const tx of result.transactions) {
  console.log(tx.transaction_id, tx.created_at);
}
```

## Get a transaction result

After submitting a transaction, you can poll for its result:

```ts
const result = await provider.getTransactionResult(transactionId);
```

This is used internally by `watchTransaction`, but you can call it directly for custom polling logic.
