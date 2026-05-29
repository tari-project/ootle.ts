# connect-button

A minimal React app that connects to a Tari Wallet Daemon and displays your account address and public key. This is the **"hello world" of Ootle dApp development** — the equivalent of a MetaMask connect button, but for Tari.

---

## What is this?

Tari Ootle is a smart contract platform where contracts ("templates") are written in Rust, compiled to WebAssembly, and run on the Tari network. To interact with the network from a web app, you need two things:

- A **wallet daemon** — a local program that holds your private key and signs transactions on your behalf. The key never leaves your machine.
- A **provider** (indexer) — a service that reads and writes state to the network.

This example covers the first step: connecting your web app to the wallet daemon and verifying the connection by displaying your account details.

---

## What you'll learn

- How to connect to a wallet daemon over JSON-RPC from a browser app
- How to display an account address and public key
- How to handle loading and error states cleanly
- The `useWalletDaemon` React hook pattern used across all Ootle dApp examples

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

### Download and run the Tari Wallet Daemon

The wallet daemon is a program that runs on your computer and manages your wallet. Your private key stays on your machine — it never touches the browser.

**Step 1 — Download the daemon**

Go to the [tari-ootle releases page](https://github.com/tari-project/tari-ootle/releases) and download the binary for your operating system:

| OS | File to download |
|----|-----------------|
| macOS (Apple Silicon) | `tari_ootle_walletd-...-macos-arm64` |
| macOS (Intel) | `tari_ootle_walletd-...-macos-x86_64` |
| Linux (64-bit) | `tari_ootle_walletd-...-linux-x86_64` |
| Windows | `tari_ootle_walletd-...-windows-x64.exe` |

**Step 2 — Make it executable** *(macOS and Linux only)*

```bash
chmod +x tari_ootle_walletd-*
```

**Step 3 — Start the daemon**

```bash
./tari_ootle_walletd --network esme
```

On Windows:
```
tari_ootle_walletd-...-windows-x64.exe --network esme
```

The first time you run it, the daemon will:
1. Create a new wallet and generate your keys
2. Start syncing with the Esmeralda testnet (this may take a minute)
3. Open a JSON-RPC server on port 9000
4. Open a web UI at [http://localhost:5100](http://localhost:5100)

> **Tip:** Leave the daemon running in this terminal window. Open a new terminal for the next steps.

**Step 4 — Fund your account with test tokens**

Open [http://localhost:5100](http://localhost:5100) in your browser. This is the wallet's own web UI. Use the **faucet** button to request free testnet TARI (tTARI) — these are worthless test tokens, not real money.

---

## Run the example

In a new terminal window, from this directory:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

The daemon URL is pre-filled (`http://127.0.0.1:9000/json_rpc`). Leave the auth token blank unless you started the daemon with `--auth webauthn`. Click **Connect Wallet**.

You should see your account address and public key appear.

---

## What you'll see

**Before connecting:** A form with the daemon URL and an optional auth token field, plus a numbered checklist reminding you what you need running.

**After connecting:** Your account address and public key, truncated for readability with a copy button on each. A coloured avatar is generated deterministically from your address so you can visually identify your account.

---

## Troubleshooting

**"Connection failed" or "ECONNREFUSED"**
The daemon is not running, or is running on a different port. Make sure you started it with `./tari_ootle_walletd --network esme` and that you see "JSON-RPC server listening" in its output.

**"HTTP 401" or auth errors**
You started the daemon with `--auth webauthn`. Either restart without that flag, or obtain a bearer token from the wallet UI and paste it into the auth token field.

**"CORS error" in browser console**
Your browser is blocking the request to `127.0.0.1:9000`. This can happen with some browser security settings. Try a different browser, or disable CORS enforcement for localhost (search for your browser's dev-mode flags).

**The daemon syncs slowly**
This is normal on first run. Wait until the daemon logs show it has synced before trying to connect.

---

## Project structure

```
connect-button/
├── src/
│   ├── hooks/
│   │   └── useWalletDaemon.ts   # Connection state machine (disconnected → connecting → connected)
│   ├── App.tsx                  # UI: connect form + connected account view
│   ├── App.css                  # Styles
│   ├── index.css                # CSS variables and reset
│   └── main.tsx                 # React entry point
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Learn more

- [Ootle documentation](https://ootle.tari.com)
- [Wallet setup guide](https://ootle.tari.com/guides/setup-a-wallet/)
- [CLI reference](https://ootle.tari.com/guides/cli/)
- [ootle.ts SDK reference](https://tari-project.github.io/ootle.ts)
- [`@tari-project/ootle-wallet-daemon-signer`](../../packages/ootle-wallet-daemon-signer/) — the package this example uses
