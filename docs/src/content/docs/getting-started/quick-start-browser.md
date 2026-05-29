---
title: Quick start — browser
description: Build and submit your first Tari Ootle transaction from a browser dApp (Vite + React, `WalletDaemonSigner` or `SecretKeyWallet`).
---

This guide is for **browser / dApp users** (Vite + React, bundled builds). For headless Node ≥ 22 scripts and servers, see [Quick start — Node](./quick-start-node).

It walks through three common workflows: reading chain state, submitting a transaction with a wallet daemon, and local signing for testing.

## 1. Read a substate

```ts
import { Network } from "@tari-project/ootle";
import { ProviderBuilder } from "@tari-project/ootle-indexer";

const provider = await ProviderBuilder.new().withNetwork(Network.Esmeralda).connect();

const substate = await provider.getSubstate("component_0x…");
console.log(substate);
```

`ProviderBuilder` falls back to the default public indexer URL for the chosen network when no URL is supplied.

## 2. Submit a transaction (wallet daemon)

```ts
import { TransactionBuilder, sendTransaction, Network } from "@tari-project/ootle";
import { ProviderBuilder } from "@tari-project/ootle-indexer";
import { WalletDaemonSigner } from "@tari-project/ootle-wallet-daemon-signer";

const provider = await ProviderBuilder.new().withNetwork(Network.LocalNet).connect();

const signer = await WalletDaemonSigner.connect({
  url: "http://localhost:18103",
  authToken: "your-auth-token",
});

const accountAddress = await signer.getAddress();

const unsignedTx = TransactionBuilder.new(Network.LocalNet)
  .feeTransactionPayFromComponent(accountAddress, 1000n)
  .callMethod({ componentAddress: accountAddress, methodName: "withdraw" }, [
    { Literal: resourceAddress },
    { Literal: "500" },
  ])
  .saveVar("bucket")
  .callMethod({ componentAddress: recipientAddress, methodName: "deposit" }, [{ Workspace: "bucket" }])
  .buildUnsignedTransaction();

const result = await sendTransaction(provider, signer, unsignedTx);
```

`sendTransaction` resolves substate versions, signs, seals (BOR-encodes), submits, and watches for finalization — all in one call.

## 3. Local signing (testing)

```ts
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { Network } from "@tari-project/ootle";

// Generate a fresh wallet with a view-only key (for stealth output scanning)
const wallet = SecretKeyWallet.randomWithViewKey(Network.Esmeralda);

// Or restore from an existing secret key
const wallet = SecretKeyWallet.fromSecretKey(ownerSecretKey, Network.Esmeralda);

const signatures = await wallet.signTransaction(unsignedTx);
```

:::caution
`SecretKeyWallet` holds the secret key unencrypted in memory. Use `WalletDaemonSigner` in production so the key never touches JavaScript.
:::
