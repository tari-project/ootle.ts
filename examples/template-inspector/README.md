# template-inspector

Browse deployed Ootle smart contracts (called **templates**) and inspect their function ABIs — the list of functions a contract exposes, their argument names, types, and return values. Connects to the public Esmeralda testnet. No wallet or signing required.

---

## What is this?

In Tari Ootle, smart contracts are called **templates**. A template is a Rust program compiled to WebAssembly and deployed on the network. Once deployed, anyone can call its functions by submitting a transaction.

Before you can call a template's functions, you need to know what those functions are — their names, what arguments they take, and what they return. This information is called the **ABI** (Application Binary Interface). This example fetches and displays the ABI for any template on the network.

Think of it like reading the documentation for a smart contract — directly from the chain.

---

## What you'll learn

- How to use `IndexerClient` directly (lower-level than `IndexerProvider`)
- How to list cached templates from the indexer
- How to fetch a template's full ABI
- How to render structured on-chain type information in a React UI

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

No wallet daemon or local services needed — the example talks directly to the public testnet.

---

## Run the example

In a terminal, from this directory:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

The public Esmeralda testnet indexer is pre-configured. The app loads automatically and shows all known templates.

---

## What you'll see

**Top bar** — Shows the current indexer URL and a template count badge (e.g. "12 templates · Esmeralda testnet"). You can edit the URL and press Enter to reconnect to a different indexer.

**Template list (left panel)** — A scrollable list of all templates cached by the indexer, each showing its name (if set) and a truncated address. Use the **Filter** box to search by name or address.

**ABI viewer (right panel)** — Click any template in the list to load and display its ABI. Each function is shown as a collapsible card with:
- The function name
- Its argument names and types
- Its return type
- A `new` badge if the function is a constructor

If the ABI has an unfamiliar shape, the raw JSON is shown as a fallback.

---

## Network information

| Service | URL |
|---------|-----|
| Esmeralda testnet indexer | `https://ootle-indexer-a.tari.com` |

To point at a local indexer instead, edit the URL in the top bar and press Enter.

---

## Troubleshooting

**No templates appear / "Connection error"**
The public indexer may be temporarily unavailable. Wait a moment and click **Refresh**. If the error persists, check your network connection.

**CORS error in browser console**
Some browser configurations block cross-origin requests. Try a different browser, or run a local indexer at `http://localhost:12500` and enter that URL in the top bar.

**Template list loads but ABI shows raw JSON**
The ABI for that template may use a type shape not yet handled by the viewer. The raw JSON view is the fallback — all the information is there, just not pretty-printed. This is expected for unusual template types.

**I want to deploy my own template**
See the [Ootle template overview](https://ootle.tari.com/guides/template-overview/) and the [CLI reference](https://ootle.tari.com/guides/cli/). You'll need the Tari CLI and a funded wallet.

---

## Project structure

```
template-inspector/
├── src/
│   ├── hooks/
│   │   └── useTemplates.ts   # Fetches template list and individual template ABIs
│   ├── App.tsx               # Template list, search filter, ABI viewer
│   ├── App.css               # Styles
│   ├── index.css             # CSS variables and reset
│   └── main.tsx              # React entry point
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Learn more

- [Ootle documentation](https://ootle.tari.com)
- [Ootle template overview](https://ootle.tari.com/guides/template-overview/)
- [CLI reference](https://ootle.tari.com/guides/cli/)
- [ootle.ts SDK reference](https://tari-project.github.io/tari.js)
- [`@tari-project/ootle-indexer`](../../packages/ootle-indexer/) — the package this example uses
