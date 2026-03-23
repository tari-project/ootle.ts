---
title: Secret Key Wallet
description: Local in-memory signer for testing and scripting.
---

`SecretKeyWallet` implements the `Signer` interface by holding a secret key directly in JavaScript memory and using `@tari-project/ootle-wasm` for all cryptographic operations.

:::caution
The secret key lives unencrypted in memory. For production use, prefer [`WalletDaemonSigner`](/tari.js/signers/wallet-daemon/) so the key never touches JavaScript.
:::

## Create a wallet

```ts
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { Network } from "@tari-project/ootle";

// Generate a new random wallet with a view-only key (for stealth support)
const wallet = SecretKeyWallet.randomWithViewKey(Network.Esmeralda);

// Restore from an existing secret key
const wallet = SecretKeyWallet.fromSecretKey(ownerSecretKey, Network.Esmeralda);

// Restore with both account key and view-only key
const wallet = SecretKeyWallet.fromSecretKey(ownerSecretKey, Network.Esmeralda, viewOnlySecretKey);

// Restore from both secret and public keys (e.g. from a keystore)
const wallet = SecretKeyWallet.fromKeypair(ownerSecretKey, publicKey, Network.Esmeralda);
```

## Sign a transaction

```ts
const signatures = await wallet.signTransaction(unsignedTx);
```

## Access keys

```ts
const address = await wallet.getAddress();
const publicKey = await wallet.getPublicKey();

// View-only key for stealth output scanning
const viewKey = wallet.getViewOnlySecret();
```

## EphemeralKeySigner

For privacy-preserving transactions where no link to the sender should exist, use `EphemeralKeySigner`. It generates a one-time throwaway keypair that is discarded when the object is garbage-collected.

```ts
import { EphemeralKeySigner } from "@tari-project/ootle-secret-key-wallet";
import { signTransaction } from "@tari-project/ootle";

const signer = EphemeralKeySigner.generate(); // defaults to Esmeralda
const signed = await signTransaction([signer], unsignedTx);
```
