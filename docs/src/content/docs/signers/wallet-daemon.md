---
title: Wallet Daemon Signer
description: Delegate signing to a running tari_ootle_walletd process.
---

`WalletDaemonSigner` implements the `Signer` interface by delegating all cryptographic operations to a running `tari_ootle_walletd` process via [`@tari-project/wallet_jrpc_client`](https://www.npmjs.com/package/@tari-project/wallet_jrpc_client). The secret key never enters JavaScript memory.

## Setup

Start the wallet daemon:

```sh
./tari_ootle_walletd --network esme
```

## Connect

```ts
import { WalletDaemonSigner } from "@tari-project/ootle-wallet-daemon-signer";

const signer = await WalletDaemonSigner.connect({
  url: "http://localhost:18103",
  authToken: "your-auth-token",
});
```

`connect()` reaches out to the daemon, fetches the default account's public key and address, and caches them.

## Use

```ts
// Cached — no network call
const address = await signer.getAddress();
const publicKey = await signer.getPublicKey();

// Signs via the daemon — the key stays on the daemon
const signatures = await signer.signTransaction(unsignedTx);
```

## Full example

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
    { Literal: "10" },
  ])
  .saveVar("bucket")
  .callMethod({ componentAddress: accountAddress, methodName: "deposit" }, [{ Workspace: "bucket" }])
  .buildUnsignedTransaction();

const result = await sendTransaction(provider, signer, unsignedTx);
```
