---
title: Sending stealth outputs
description: Build a confidential transfer with the `StealthTransfer` builder and seal it with `WalletStealthAuthorizer`.
---

Build a confidential transfer (revealed → stealth, or mixed) using the `StealthTransfer` builder, then authorize, sign, seal, and watch it with `WalletStealthAuthorizer`. The flow is **build → prepare → authorize/sign → seal + watch**; see [Stealth overview](./overview) for the broader four-step flow.

```ts
import {
  StealthTransfer,
  WalletStealthAuthorizer,
  OotleWallet,
  createOutput,
  submitTransaction,
  watchTransaction,
  Network,
} from "@tari-project/ootle";

// 1. Build: withdraw revealed funds and emit a confidential output (+ optional revealed change).
const spec = await new StealthTransfer(provider, resourceAddress)
  .spendRevealedInput(sourceAccount, 5_000_000n)
  .toStealthOutput(createOutput({ destination: recipientAddress, amount: 3_000_000n, resourceAddress }))
  .toRevealedOutput(2_000_000n) // revealed change back to sourceAccount
  .payFeeFromRevealed(1_000n)
  .prepare();

// 2. Authorize: a multi-signer wallet supplies the account-key signature.
const wallet = new OotleWallet();
wallet.registerKeyProvider(senderAddress, secretKeyWallet);
wallet.setDefaultSigner(senderAddress);

const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec);

// 3. Prepare hydrates the balance proof + patches the statement into the tx, returning
//    an AuthorizedTransfer handle that can seal.
const tx = await authorizer.prepare(provider);

// 4. Seal produces the signed envelope; submit + watch for finality.
const envelope = await tx.seal();
const txId = await submitTransaction(provider, envelope);
await watchTransaction(provider, txId);
```

A revealed-only transfer (no confidential inputs) needs no view secret. The output mask is non-zero (there is at least one stealth output), so a real balance proof is always signed.

## Runnable examples

Two send-side scripts cover the common shapes:

| Script                                                                                                                          | Shape                                                      | Command                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`stealth-to-revealed.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/stealth/stealth-to-revealed.ts) | Revealed input → revealed change (no confidential output). | `pnpm --filter @tari-project/ootle-examples-node run stealth:to-revealed` |
| [`stealth-to-stealth.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/stealth/stealth-to-stealth.ts)   | Mixed: stealth output + revealed change.                   | `pnpm --filter @tari-project/ootle-examples-node run stealth:to-stealth`  |

Both require a running LocalNet — see [Prerequisites](../getting-started/prerequisites).
