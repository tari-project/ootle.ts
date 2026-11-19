---
title: Multi-Signer Wallet
description: Manage multiple key providers with OotleWallet.
---

`OotleWallet` is a multi-signer wallet that manages multiple key providers — one per address. This is useful when a transaction requires authorizations from several components.

## Setup

```ts
import { OotleWallet } from "@tari-project/ootle";

const wallet = new OotleWallet();
wallet.registerKeyProvider(addressA, signerA);
wallet.registerKeyProvider(addressB, signerB);
wallet.setDefaultSigner(addressA);
```

## Sign with the default signer

`wallet.signTransaction` is the lower-level per-signer call: it hashes `unsignedTx` with the seal signer's public key and the transaction's authorizer set (the public key of every authorizer), so each signature matches the final seal hash.

```ts
const authorizers = [publicKeyA, publicKeyB]; // every authorizer, this signer included
const signatures = await wallet.signTransaction(unsignedTx, sealPublicKey, authorizers);
```

For an end-to-end flow, prefer the free `signTransaction(signers, unsignedTx)` / `sendTransaction(...)` helpers in `@tari-project/ootle`, which generate the seal keypair, collect the authorizer set from the signers before any of them signs, and seal the signatures in the ascending key order the network requires.

## Authorize for a specific address

```ts
const auth = await wallet.authorizeTransaction(addressB, unsignedTx, sealPublicKey, authorizers);

// Or one authorization per registered provider; the set defaults to all their keys.
const auths = await wallet.authorizeTransactionAll(unsignedTx, sealPublicKey);
```

## Use with stealth transfers

`OotleWallet` integrates with `WalletStealthAuthorizer` for stealth transfers:

```ts
import { WalletStealthAuthorizer } from "@tari-project/ootle";

const authorizer = WalletStealthAuthorizer.fromSpec(wallet, stealthSpec, { viewSecret });
const authorized = await authorizer.prepare(provider); // hydrates the balance proof, signs each spent input
const envelope = await authorized.seal(); // collects account + one-time signatures, seals the envelope
// submit `envelope` via your provider
```

The authorizer uses the wallet's registered key providers to sign on behalf of each input owner, threading a single shared seal keypair and authorizer set through every signature.

To add an external co-signer, declare its key with `authorized.addAuthorizer(publicKey)` before the set is fixed (the first `getAuthorizerPublicKeys()`, `createAuthorizations()` or `seal()` call). The co-signer signs over `authorized.getSealPublicKey()` and `await authorized.getAuthorizerPublicKeys()`, and you hand its signature back with `authorized.addSignature(signature)`.
