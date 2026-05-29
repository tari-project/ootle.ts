---
title: Spending stealth UTXOs
description: Spend a confidential UTXO you already own by registering it with `spendStealthInput`; the authorizer recovers its mask via the view secret.
---

To spend a confidential UTXO you already own, register it with `spendStealthInput(ownerAddress, commitment)`. The input's value is carried by its blinding **mask** — the authorizer recovers it by fetching and unblinding the UTXO, so you only supply the commitment, not the amount. See [Stealth overview](./overview) for the broader four-step flow.

```ts
const spec = await new StealthTransfer(provider, resourceAddress)
  .spendStealthInput(ownerAddress, ownedCommitment)
  .toStealthOutput(createOutput({ destination: recipientAddress, amount: 1_000_000n, resourceAddress }))
  .prepare();

const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { viewSecret });
const tx = await authorizer.prepare(provider); // fetches + unblinds the input to recover its mask
const envelope = await tx.seal();
```

Spending requires the owner's view secret to unblind the input. Pass it explicitly via `fromSpec(wallet, spec, { viewSecret })`, or register the owning `SecretKeyWallet` (which carries its view key) as the wallet's default signer — the authorizer falls back to its `getViewSecret()`.

For each stealth input the authorizer produces a **one-time spend-key authorization**: a Schnorr signature by the input's derived one-time spend key, routed through the signer's `addStealthSignature` so the secret never leaves the signer. These are included automatically at `seal()` — do not feed them to `addSignature()`.

## Runnable example

[`examples/node/src/stealth/spend-stealth-utxo.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/stealth/spend-stealth-utxo.ts) is the headline spend demo: faucet stealth deposit → discover → `decryptInputData` → `spendStealthInput` → mask aggregation → balance proof → spend. Run it with:

```sh
pnpm --filter @tari-project/ootle-examples-node run stealth:spend
```

Requires a running LocalNet — see [Prerequisites](../getting-started/prerequisites).
