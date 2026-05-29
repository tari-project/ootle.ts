# Stealth Wallet

A browser demo of the Tari Ootle TypeScript SDK's stealth (confidential
transfer) surface. Uses `SecretKeyWallet.randomWithViewKey(Network.LocalNet)`
to keep keys in JS memory — no wallet daemon required.

Three cards walk through the full stealth API:

1. **Setup** — generate a fresh stealth-ready identity and connect to a
   LocalNet indexer.
2. **Receive** — faucet a confidential 2 TARI deposit into the wallet's own
   address; decrypt the produced UTXO with the view secret.
3. **Send** — split the revealed bucket left by the faucet into a stealth
   output for a recipient plus a revealed-change bucket, paying the fee from
   the same account.

## Demo only — do not use with real funds

The secret key lives in browser memory for the lifetime of the page. Refresh
and it is gone. The disclaimer is part of the UI.

## Prerequisites

A reachable LocalNet **indexer** with a faucet. The app's URL field defaults
to `defaultIndexerUrl(Network.LocalNet)` (`http://localhost:12500`) — point
it elsewhere if your indexer is on a different host.

The wallet daemon path is intentionally **not** supported here — the daemon
does not expose the view secret needed for stealth decrypt, so this demo
uses the in-memory `SecretKeyWallet` instead. See `examples/connect-button/`
for the daemon-signer auth flow.

## Run

From the repo root:

```bash
pnpm --filter ootle-example-stealth-wallet run dev
```

Then open the printed `http://localhost:5173` (or whichever port Vite
chose) in a browser.

To produce a production build:

```bash
pnpm --filter ootle-example-stealth-wallet run build
```

## Headless equivalents

For a CI-friendly, no-browser version of every interaction this app
exposes, see the Node tier under
[`examples/node/src/stealth/`](../node/src/stealth/):

- [`faucet-deposit.ts`](../node/src/stealth/faucet-deposit.ts) — same
  faucet → confidential deposit flow.
- [`stealth-to-revealed.ts`](../node/src/stealth/stealth-to-revealed.ts) —
  send with revealed change.
- [`stealth-to-stealth.ts`](../node/src/stealth/stealth-to-stealth.ts) —
  send to a fresh recipient.
- [`spend-stealth-utxo.ts`](../node/src/stealth/spend-stealth-utxo.ts) —
  the headline confidential-input spend flow.

## Architecture

```text
src/
  main.tsx                 — React entrypoint
  App.tsx                  — orchestration: Setup / Receive / Send cards
  App.css                  — card-based dark theme
  index.css                — root tokens
  components/
    SetupCard.tsx          — indexer-URL + wallet-create form
    ReceiveCard.tsx        — faucet deposit + rescan
    SendCard.tsx           — stealth + revealed transfer form
    Field.tsx              — labelled mono value + copy button
    StatusBadge.tsx        — coloured "Ready / Not connected" dot
    TariLogo.tsx           — header SVG
    CopyIcon.tsx           — inline SVG
    CheckIcon.tsx          — inline SVG
  hooks/
    useStealthWallet.ts    — in-memory identity state machine
    useIndexer.ts          — IndexerProvider state machine
    useStealthOps.ts       — faucetDeposit / scanOwned / sendTransfer
    useAsyncAction.ts      — generic loading/error/result trio
  lib/
    identity.ts            — createIdentity() — fresh stealth wallet
    stealth.ts             — faucetStealth, sendStealth, stealthUtxoSubstate
    crypto.ts              — lazy `WasmStealthCrypto` singleton
    format.ts              — `truncate` and `formatTari` display helpers
```

Shared runtime-agnostic helpers (`NETWORK`, `TARI_RESOURCE`, `tari()`,
literal encoders, `wait`, `firstNewSubstate`) live in
`@tari-project/example-common` and are imported here. Browser-specific
plumbing (the `SecretKeyWallet`-flavoured stealth flow, identity
construction, the React hooks and components) stays local.

## Known limitations

- No automated browser E2E test ships with this demo — matching the other
  three React+Vite apps in this folder. Use it manually against a
  LocalNet indexer to confirm a full round-trip.
- No persistence. Refresh discards the wallet. This is by design —
  storing a secret key in `localStorage` or `IndexedDB` without proper
  encryption is worse than what we have today.
