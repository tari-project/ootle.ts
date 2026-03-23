# indexer-explorer

Browse on-chain state using the Ootle indexer. No wallet, no signing, no local services — this is a pure **read** example that connects to the public Esmeralda testnet out of the box.

---

## What is this?

Tari Ootle is a smart contract platform. Every piece of on-chain state (accounts, vaults, component instances, resources) is stored as a **substate** — a key/value entry identified by a unique ID.

The **indexer** is a service that watches the network and indexes those substates so web apps can query them over HTTP. This example shows you how to:

- Connect to an indexer using the `IndexerProvider` from `@tari-project/ootle-indexer`
- Look up a specific substate by ID
- List recent transactions and browse their substate inputs

Think of the indexer like a blockchain explorer (e.g. Etherscan) — read-only, no wallet required.

---

## What you'll learn

- How to connect to the Ootle indexer from a React app
- How to query a substate by ID
- How to list recent transactions and inspect their inputs
- The `useIndexer` React hook pattern used across Ootle dApp examples

---

## Before you start

### Install Node.js

You need **Node.js 22 or newer**. Check if you have it:

```bash
node --version
```

If not, download it from [nodejs.org](https://nodejs.org) (choose the LTS version).

### Install pnpm

This project uses [pnpm](https://pnpm.io) instead of npm. Install it via:

```bash
npm install -g pnpm
```

That's it — no local daemon or wallet required for this example.

---

## Run the example

In a terminal, from this directory:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

The public Esmeralda testnet indexer URL is pre-filled. Click **Connect to Indexer** — you should immediately start seeing recent transactions.

---

## What you'll see

**Connect panel** — Shows the indexer URL and a "Esmeralda testnet · live" badge once connected. You can change the URL to point at a local indexer if you're running one.

**Substate lookup** — Enter any substate ID (e.g. `component_...` or `resource_...`) and click **Look up** to fetch and display it as formatted JSON.

**Recent transactions** — A list of the latest transactions, each showing its transaction ID, timestamp, and substate inputs. Click any substate input to copy its ID into the lookup panel.

---

## Network information

| Network | Indexer URL |
|---------|------------|
| Esmeralda testnet (public) | `https://ootle-indexer-a.tari.com` |
| Local dev | `http://localhost:12500` |

To run a local indexer, see the [tari-ootle releases](https://github.com/tari-project/tari-ootle/releases).

---

## Troubleshooting

**"Connection failed" or network error**
The public indexer may be temporarily unavailable. Try refreshing after a moment. If you are behind a strict firewall or corporate VPN, the request to `ootle-indexer-a.tari.com` may be blocked.

**CORS error in browser console**
Some browser configurations block cross-origin requests. Try a different browser, or run a local indexer at `http://localhost:12500` instead.

**Empty transaction list**
The indexer may have just restarted and is catching up. Wait a moment and click **Connect** again.

**Substate lookup returns "not found"**
Substate IDs are case-sensitive and must be complete (no partial IDs). Double-check the ID you entered. You can find valid IDs by looking at the recent substates list or in the [Ootle explorer](https://ootle.tari.com).

---

## Project structure

```
indexer-explorer/
├── src/
│   ├── hooks/
│   │   └── useIndexer.ts    # Wraps IndexerProvider; exposes getSubstate, getRecentTransactions
│   ├── App.tsx              # Connect form, substate lookup panel, recent transactions list
│   ├── App.css              # Styles
│   ├── index.css            # CSS variables and reset
│   └── main.tsx             # React entry point
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Learn more

- [Ootle documentation](https://ootle.tari.com)
- [Indexer API reference](https://ootle.tari.com/indexer/indexer-api.html)
- [ootle.ts SDK reference](https://tari-project.github.io/tari.js)
- [`@tari-project/ootle`](../../packages/ootle/) — core SDK package
- [`@tari-project/ootle-indexer`](../../packages/ootle-indexer/) — indexer provider package
