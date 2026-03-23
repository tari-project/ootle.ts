---
title: Provider and Signer
description: Understand the two core abstractions in ootle.ts.
---

ootle.ts separates concerns into two interfaces: **Provider** (reads) and **Signer** (writes). This separation lets you swap implementations without changing application code.

## Provider — reads chain state

A `Provider` gives read-only access to the Ootle network:

```ts
interface Provider {
  getSubstate(id: string): Promise<IndexerGetSubstateResponse>;
  fetchSubstates(ids: string[]): Promise<GetSubstatesResponse>;
  listRecentTransactions(params: ListRecentTransactionsRequest): Promise<ListRecentTransactionsResponse>;
  getTemplateDefinition(address: string): Promise<GetTemplateDefinitionResponse>;
  submitTransaction(envelope: TransactionEnvelope): Promise<IndexerSubmitTransactionResponse>;
  getTransactionResult(txId: string): Promise<IndexerGetTransactionResultResponse>;
}
```

The SDK ships one implementation: `IndexerProvider` (in `@tari-project/ootle-indexer`), which wraps the indexer REST API.

## Signer — produces signatures

A `Signer` holds or delegates access to a secret key:

```ts
interface Signer {
  getAddress(): Promise<string>;
  getPublicKey(): Promise<Uint8Array>;
  signTransaction(unsignedTx: UnsignedTransactionV1): Promise<TransactionSignature[]>;
}
```

Two implementations are provided:

| Class | Package | Key location |
|---|---|---|
| `WalletDaemonSigner` | `ootle-wallet-daemon-signer` | On a separate daemon process |
| `SecretKeyWallet` | `ootle-secret-key-wallet` | In JavaScript memory (testing only) |

## How they work together

```
                  ┌─────────────┐
                  │  Your App   │
                  └──────┬──────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   TransactionBuilder  Provider      Signer
   (build instructions) (read state)  (sign tx)
          │              │              │
          └──────────────┼──────────────┘
                         │
                         ▼
                sendTransaction(provider, signer, unsignedTx)
```

The `sendTransaction` helper chains resolve → sign → submit → watch into a single call. You can also call each step individually for more control.
