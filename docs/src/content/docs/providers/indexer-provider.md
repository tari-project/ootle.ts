---
title: Indexer Provider
description: Read chain state and submit transactions via the indexer REST API.
---

`IndexerProvider` implements the `Provider` interface by wrapping [`@tari-project/indexer-client`](https://www.npmjs.com/package/@tari-project/indexer-client). It provides read access to substates, templates, and transaction results, plus SSE-based transaction watching with a polling fallback.

## Connect with ProviderBuilder

```ts
import { Network } from "@tari-project/ootle";
import { ProviderBuilder } from "@tari-project/ootle-indexer";

const provider = await ProviderBuilder.new()
  .withNetwork(Network.Esmeralda)
  .withUrl("http://my-indexer:18300") // optional — defaults to known URL
  .withTransactionTimeoutMs(60_000)
  .connect();
```

When no URL is set, `ProviderBuilder` falls back to `defaultIndexerUrl(network)` — currently available for `LocalNet` and `Esmeralda`.

## Connect directly

```ts
import { IndexerProvider } from "@tari-project/ootle-indexer";
import { Network } from "@tari-project/ootle";

const provider = await IndexerProvider.connect({
  url: "http://localhost:18300",
  network: Network.LocalNet,
});
```

## Read chain state

```ts
// Single substate
const substate = await provider.getSubstate("component_0x…");

// Multiple substates
const substates = await provider.fetchSubstates([id1, id2]);

// List recent transactions
const list = await provider.listRecentTransactions({ limit: 5, last_id: null });

// Template definition (ABI)
const template = await provider.getTemplateDefinition(templateAddress);
```

## Submit and watch transactions

```ts
// Submit a signed transaction envelope
const { transaction_id } = await provider.submitTransaction(envelope);

// Watch for finalization via SSE (falls back to polling on timeout)
const outcome = await provider.watchTransactionSSE(transaction_id).watch();

// Get the full receipt
const receipt = await provider.watchTransactionSSE(transaction_id).getReceipt();

// Stop the SSE watcher when done
provider.stopWatcher();
```

## TransactionWatcher

For fine-grained control over SSE event handling, use `TransactionWatcher` directly:

```ts
import { TransactionWatcher } from "@tari-project/ootle-indexer";

const watcher = new TransactionWatcher("http://localhost:18300");
watcher.start();

const pending = watcher.watch(txId, client, 32_000);
const outcome = await pending.watch();
const receipt = await pending.getReceipt();

watcher.stop();
```

`PendingTransaction.watch()` returns a `TransactionOutcome` and does not throw on `FeeIntentCommit` or `Reject` — the caller decides how to handle each outcome.
