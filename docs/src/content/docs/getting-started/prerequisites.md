---
title: Prerequisites & presets
description: What services need to be running, the env-var presets the SDK consumes, and which option (LocalNet, public testnet, wallet daemon) fits your use case.
---

The SDK packages talk to **services** (an indexer, optionally a wallet
daemon, and a faucet for testing). This page is the canonical reference
for what you need running. For npm-install and bundler requirements see
[Installation](./installation).

## Choose a service profile

Pick the row that matches what you are building.

| Profile                                   | What to run                                                                                      | When                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Public Esmeralda testnet (read-only)**  | Nothing — the SDK falls back to `defaultIndexerUrl(Network.Esmeralda)`.                          | Browsing chain state from a browser dApp or a Node script. No write transactions.                                                                                                                                  |
| **LocalNet (full read/write)**            | A LocalNet indexer + faucet ([setup guide](https://github.com/tari-project/tari-ootle)).         | Local development of write paths (transfers, stealth, custom templates). The default for the example scripts.                                                                                                      |
| **Wallet daemon (production write path)** | A `tari_ootle_walletd` process configured for `webauthn` (browser) or `none`/`authToken` (Node). | Production. The secret key never enters JS. See the [wallet-daemon signer README](https://github.com/tari-project/ootle.ts/blob/main/packages/ootle-wallet-daemon-signer/README.md) for the full auth-mode matrix. |

## Env-var presets

The SDK and the [`examples/node/`](https://github.com/tari-project/ootle.ts/tree/main/examples/node) workspace consume exactly two env vars. Both have sensible defaults via [`defaultIndexerUrl(Network.LocalNet)`](../api/ootle/src/functions/defaultindexerurl/) and the well-known LocalNet faucet component, so you only set them when overriding.

| Env var                | Default                                                          | Purpose                                                                                   |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `OOTLE_INDEXER_URL`    | `defaultIndexerUrl(Network.LocalNet)` → `http://localhost:12500` | Indexer URL for any script or app that does not pass `withUrl(...)` to `ProviderBuilder`. |
| `OOTLE_FAUCET_ADDRESS` | LocalNet well-known faucet component                             | Override only if your LocalNet faucet uses a non-default component address.               |

The canonical fallback pattern (from
[`examples/node/src/_common.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/_common.ts)) is:

```ts
import { Network, defaultIndexerUrl } from "@tari-project/ootle";

const url = process.env.OOTLE_INDEXER_URL ?? defaultIndexerUrl(Network.LocalNet);
```

Use the same shape in your own scripts.

## LocalNet quickstart

The default `OOTLE_INDEXER_URL` (`http://localhost:12500`) matches what the [Tari Ootle repo's LocalNet guide](https://github.com/tari-project/tari-ootle) configures. Start LocalNet there, then return here — every example in this docs site assumes that URL.

For one-off scripts you can copy `examples/node/.env.example` to `.env` (in your project, **not** committed) and `source .env` (or use [`direnv`](https://direnv.net)):

```sh
cp path/to/ootle.ts/examples/node/.env.example .env
# edit if your indexer is on a non-default port
source .env
NODE_OPTIONS=--experimental-wasm-modules tsx my-script.ts
```

The SDK does **not** load `.env` automatically — there is no `dotenv` dependency. The `.env.example` is a template only.

## Public Esmeralda testnet

Nothing to run. The SDK falls back to the well-known public indexer when you pick `Network.Esmeralda`:

```ts
import { Network } from "@tari-project/ootle";
import { ProviderBuilder } from "@tari-project/ootle-indexer";

const provider = await ProviderBuilder.new().withNetwork(Network.Esmeralda).connect();
```

You can read substates, browse transactions, and inspect templates against testnet from a fresh checkout — see [Quick start — Node §1](./quick-start-node#1-read-chain-state) for the smallest read script. Write transactions require a funded testnet account; for hands-on write paths use LocalNet.

## Wallet daemon

The wallet daemon (`tari_ootle_walletd`) is the production signing path — the secret key stays in the daemon process. Two auth modes:

- **Browser:** the daemon's default `method: "webauthn"` triggers a passkey flow on `WalletDaemonSigner.connect({ url })`. See [Quick start — browser §2](./quick-start-browser#2-submit-a-transaction-wallet-daemon).
- **Node:** WebAuthn is browser-only. Pass `authToken` explicitly to `WalletDaemonSigner.connect({ url, authToken })`, or configure the daemon for `method: "none"` if you control its config. See [Quick start — Node §2 "Using `WalletDaemonSigner` from Node"](./quick-start-node#using-walletdaemonsigner-from-node) and the [wallet-daemon signer README](https://github.com/tari-project/ootle.ts/blob/main/packages/ootle-wallet-daemon-signer/README.md).

## Next steps

- [Provider and Signer concepts](./provider-and-signer)
- [Quick start — browser](./quick-start-browser)
- [Quick start — Node](./quick-start-node)
