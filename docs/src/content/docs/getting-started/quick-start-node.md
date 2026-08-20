---
title: Quick start — Node
description: Build and submit your first Tari Ootle transaction from a headless Node ≥ 22 script via `tsx` — no bundler, no React.
---

This guide is for **headless Node ≥ 22 users** (scripts, servers, bots). It uses [`tsx`](https://tsx.is) to run TypeScript directly, with no bundler. For browser / dApp use, see [Quick start — browser](./quick-start-browser).

Every snippet on this page is a stripped-down version of a working script in [`examples/node/`](https://github.com/tari-project/ootle.ts/tree/main/examples/node) — clone the repo and run them end-to-end against LocalNet.

## Prerequisites

- **Node ≥ 22** (pin via `.nvmrc` or `engines` in your `package.json`).
- **[`tsx`](https://tsx.is)** as a project devDep (`pnpm add -D tsx`), or use `npx tsx` ad hoc.
- A reachable indexer URL. The SDK helper `defaultIndexerUrl(Network.LocalNet)` returns `http://localhost:12500`; set `OOTLE_INDEXER_URL` to override.
- **`NODE_OPTIONS=--experimental-wasm-modules`** — the one Node platform quirk. Today's Node still gates `.wasm` ESM imports behind this flag, and the SDK loads `@tari-project/ootle-wasm` as an ES module. Every script invocation uses the canonical pattern:

  ```sh
  NODE_OPTIONS=--experimental-wasm-modules tsx my-script.ts
  ```

  See [`examples/node/README.md`](https://github.com/tari-project/ootle.ts/tree/main/examples/node#wasm-in-node-runtime-story) for the rationale and forward plan. Every script in `examples/node/package.json` wires the flag into its `pnpm` invocation so most users never set it manually.

## 1. Read chain state

The smallest possible script — connect to the public Esmeralda testnet and read a substate. No LocalNet required.

```ts
// my-script.ts
import { Network } from "@tari-project/ootle";
import { ProviderBuilder } from "@tari-project/ootle-indexer";

const provider = await ProviderBuilder.new().withNetwork(Network.Esmeralda).connect();

const substate = await provider.getSubstate("component_0x…");
console.log(substate);
```

Run it:

```sh
NODE_OPTIONS=--experimental-wasm-modules tsx my-script.ts
```

`ProviderBuilder` falls back to the default public indexer URL for the chosen network when no URL is supplied. For LocalNet, point it at `defaultIndexerUrl(Network.LocalNet)` (or your `OOTLE_INDEXER_URL` env var).

The runnable version of this snippet lives in [`examples/node/src/balance-query.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/balance-query.ts).

## 2. Build and submit a transfer

The full end-to-end story under Node: generate a fresh wallet with a view-only key, faucet TARI into a new account, build and submit a transfer — all without a bundler or a wallet daemon.

```ts
// transfer.ts — a self-contained Node script that creates a fresh wallet,
// faucets TARI into a new account, and transfers some to a fresh recipient.
//
// Run with:
//   OOTLE_INDEXER_URL=http://localhost:12500 \
//     NODE_OPTIONS=--experimental-wasm-modules tsx transfer.ts
//
// Requires a running LocalNet — see Prerequisites & presets.

import {
  AccountInvokeBuilder,
  FaucetInvokeBuilder,
  Network,
  TARI_RESOURCE_ADDRESS,
  XTR_FAUCET_COMPONENT_ADDRESS,
  defaultIndexerUrl,
  resolveMaxEpoch,
  sendTransaction,
} from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import { EphemeralKeySigner, SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";

const url = process.env.OOTLE_INDEXER_URL ?? defaultIndexerUrl(Network.LocalNet);
const provider = await IndexerProvider.connect({ url, network: Network.LocalNet });

// 1. Generate sender (stealth-capable) and recipient (ephemeral) wallets.
const sender = SecretKeyWallet.randomWithViewKey(Network.LocalNet);
const recipient = EphemeralKeySigner.generate(Network.LocalNet);
const senderAddress = await sender.getAddress();
const recipientAddress = await recipient.getAddress();
// Every transaction needs a `max_epoch`; this reads the chain tip and adds the default window.
const maxEpoch = await resolveMaxEpoch(provider);
console.log(`Sender:    ${senderAddress}`);
console.log(`Recipient: ${recipientAddress}`);

// 2. Faucet 10 TARI into the sender's freshly-created account.
const faucetTx = new FaucetInvokeBuilder(Network.LocalNet, maxEpoch, XTR_FAUCET_COMPONENT_ADDRESS)
  .feeTransactionPayFromComponent(senderAddress, 1000n)
  .takeFaucetFunds(senderAddress, 10_000_000n) // 10 TARI in µTari
  .build();
const faucetReceipt = await sendTransaction(provider, sender, faucetTx);
console.log(`Faucet committed: ${faucetReceipt.transaction_id}`);

// 3. Public-transfer 2 TARI to the recipient. `publicTransfer` emits a
//    `withdraw` from the sender + `deposit` to the recipient; the engine
//    creates the recipient's account inline if it doesn't exist yet.
const transferTx = new AccountInvokeBuilder(Network.LocalNet, maxEpoch)
  .feeTransactionPayFromComponent(senderAddress, 1000n)
  .publicTransfer(senderAddress, TARI_RESOURCE_ADDRESS, 2_000_000n, recipientAddress)
  .build();
const transferReceipt = await sendTransaction(provider, sender, transferTx);
console.log(`Transfer committed: ${transferReceipt.transaction_id}`);

provider.stopWatcher();
```

Run it:

```sh
OOTLE_INDEXER_URL=http://localhost:12500 \
  NODE_OPTIONS=--experimental-wasm-modules tsx transfer.ts
```

This is the **honest minimum** — public SDK helpers only, no `_common.ts` reach-ins, no multi-signer registration, no dry-run. For the production-grade pattern (multi-signer co-authorisation, dry-run with fee estimation, receipt-diff parsing to surface the recipient's fresh account address, balance assertions) see [`examples/node/src/fungible-transfer.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/fungible-transfer.ts).

Why `SecretKeyWallet` and not `WalletDaemonSigner`? In Node, `SecretKeyWallet` is the first-class signer for local development. See the daemon-from-Node note below for the wallet-daemon path.

`SecretKeyWallet.randomWithViewKey` is the canonical factory when you want a stealth-capable wallet — the view-only secret is required for the stealth scan/spend path in section 3. See [`packages/ootle-secret-key-wallet/README.md`](https://github.com/tari-project/ootle.ts/blob/main/packages/ootle-secret-key-wallet/README.md) for the full factory matrix.

### Using `WalletDaemonSigner` from Node

The daemon's WebAuthn passkey flow is **browser-only**. If you call `WalletDaemonSigner.connect({ url })` from Node against a daemon configured for `method: "webauthn"`, the SDK throws the canonical actionable error:

```text
WebAuthn is browser-only. Run in a browser, or pass `authToken` explicitly to `WalletDaemonSigner.connect({ url, authToken })` from Node.
```

Pre-fetch an `authToken` out-of-band (or use `method: "none"` if you control the daemon config) and pass it explicitly:

```ts
import { WalletDaemonSigner } from "@tari-project/ootle-wallet-daemon-signer";

const signer = await WalletDaemonSigner.connect({
  url: "http://localhost:18103",
  authToken: process.env.OOTLE_DAEMON_AUTH_TOKEN,
});
```

See [`packages/ootle-wallet-daemon-signer/README.md`](https://github.com/tari-project/ootle.ts/blob/main/packages/ootle-wallet-daemon-signer/README.md) for the canonical Node snippet and the WebAuthn-vs-`authToken` decision matrix.

## 3. Receive a stealth output

The minimum-viable stealth-receive demo — given a stealth UTXO id, decrypt the confidential `(value, mask)` using the wallet's view-only secret. `decryptOwnedUtxo` returns `null` if the UTXO isn't ours.

```ts
// stealth-receive.ts
import { Network, WasmStealthCrypto, decryptOwnedUtxo } from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";

const provider = await IndexerProvider.connect({
  url: process.env.OOTLE_INDEXER_URL ?? "http://localhost:12500",
  network: Network.LocalNet,
});

// `randomWithViewKey` is required for stealth scan/spend; a wallet built
// without a view key throws when `decryptOwnedUtxo` is called.
const wallet = SecretKeyWallet.randomWithViewKey(Network.LocalNet);
const viewSecret = wallet.getViewOnlySecret();
if (viewSecret === null) throw new Error("wallet has no view-only secret");

const utxoId = "utxo_…"; // a UTXO the sender minted for this wallet
const substate = await provider.getSubstate(utxoId);

const crypto = new WasmStealthCrypto(Network.LocalNet);
const decrypted = await decryptOwnedUtxo(crypto, viewSecret, substate, utxoId);
console.log(decrypted ? `Owned: ${decrypted.value} µTari` : "Not ours");

provider.stopWatcher();
```

For the full sender + recipient demo (faucet → stealth deposit → recipient decrypts), see [`examples/node/src/stealth/faucet-deposit.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/stealth/faucet-deposit.ts).

## Next steps

The [`examples/node/`](https://github.com/tari-project/ootle.ts/tree/main/examples/node) workspace ships ready-to-run scripts for every flow in this guide — `balance-query`, `faucet-claim`, `fungible-transfer`, `dry-run`, `watch-events`, plus the four stealth scripts (`stealth:faucet-deposit`, `stealth:to-revealed`, `stealth:to-stealth`, `stealth:spend`). See [`examples/node/README.md`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/README.md) for the full catalogue and the WASM-in-Node runtime story.
