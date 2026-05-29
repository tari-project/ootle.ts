---
title: Installation
description: Install the ootle.ts SDK packages.
---

> Installing the packages? You are in the right place. For the **services**
> you need running (LocalNet indexer, public testnet, wallet daemon) see
> [Prerequisites & presets](./prerequisites).

ootle.ts is split into focused packages published under the `@tari-project` scope. Install only what you need.

## Core package

Every application needs the core package:

```bash
pnpm add @tari-project/ootle
```

## Add a provider

The provider reads chain state and submits transactions. Currently, the only provider implementation is the indexer:

```bash
pnpm add @tari-project/ootle-indexer
```

## Add a signer

Choose the signer that fits your use case:

### Wallet daemon (production)

Delegates signing to a running `tari_ootle_walletd` process. The secret key never enters JavaScript memory.

```bash
pnpm add @tari-project/ootle-wallet-daemon-signer
```

### Secret key wallet (testing / scripting)

Holds the secret key in JavaScript memory and uses WASM crypto for signing. Not recommended for production.

```bash
pnpm add @tari-project/ootle-secret-key-wallet
```

## Requirements

### Browser / dApp

- **Node.js 22 or later** (build / dev tooling).
- **A bundler that supports ESM** — Vite (recommended; what the example apps use), esbuild, or webpack 5+.
- The bundler must handle WASM imports from `@tari-project/ootle-wasm`. With Vite, add [`vite-plugin-wasm`](https://www.npmjs.com/package/vite-plugin-wasm) and [`vite-plugin-top-level-await`](https://www.npmjs.com/package/vite-plugin-top-level-await).

### Node ≥ 22 (scripts, servers, bots)

- **Node ≥ 22.**
- **`NODE_OPTIONS=--experimental-wasm-modules`** when running under [`tsx`](https://tsx.is) or plain `node` — Node still gates `.wasm` ESM imports behind this flag. See [`examples/node/README.md`](https://github.com/tari-project/ootle.ts/tree/main/examples/node#wasm-in-node-runtime-story) for the rationale and forward plan.
- No bundler required.
