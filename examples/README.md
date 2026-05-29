# Examples

Runnable examples for the Tari Ootle TypeScript SDK. Two tiers:

## Browser apps (React + Vite)

| App                                            | Purpose                                                         |
| ---------------------------------------------- | --------------------------------------------------------------- |
| [`connect-button/`](./connect-button/)         | Wallet-daemon (passkey) connect flow with `WalletDaemonSigner`. |
| [`indexer-explorer/`](./indexer-explorer/)     | Browse recent transactions, substates, and templates.           |
| [`stealth-wallet/`](./stealth-wallet/)         | Stealth receive/decrypt/send demo backed by `SecretKeyWallet`.  |
| [`template-inspector/`](./template-inspector/) | Inspect a published template's ABI and metadata.                |

Each app has its own `README.md`. They are bundled with Vite — the
`vite-plugin-wasm` and `vite-plugin-top-level-await` plugins handle WASM init.

## Node scripts (headless TypeScript)

[`node/`](./node/) — a single workspace
(`@tari-project/ootle-examples-node`) of `*.ts` scripts run via
[`tsx`](https://tsx.is). Self-contained against LocalNet: each script
generates fresh keys, faucets its own funds, and asserts on-chain effects.

## Shared library

[`_common/`](./_common/) — the `@tari-project/example-common` workspace
that owns the runtime-agnostic helpers shared between `node/` and
`stealth-wallet/` (literal encoders, pending-transaction wait helpers,
network constants). Not user-facing; consumed via `workspace:*`.

Five core scripts (`balance-query`, `faucet-claim`, `fungible-transfer`,
`dry-run`, `watch-events`) plus the WASM probe. See
[`node/README.md`](./node/README.md) for the per-script purpose, command,
env-var matrix, and the full set of conventions and prerequisites.

Stealth scripts live under [`node/src/stealth/`](./node/src/stealth/) with
their own [`README.md`](./node/src/stealth/README.md): receive
(`stealth:faucet-deposit`), send-only (`stealth:to-revealed`,
`stealth:to-stealth`), and spend (`stealth:spend`) — see
[`node/src/stealth/`](./node/src/stealth/) for the canonical four-step
flow and feature table.

## LocalNet prerequisite

The Node scripts target a running LocalNet indexer. Configure it once:

```bash
export OOTLE_INDEXER_URL=http://localhost:12500   # the default
```

The default URL is what `defaultIndexerUrl(Network.LocalNet)` returns from
`@tari-project/ootle`. The `wasm-probe` script does NOT need LocalNet —
it only verifies the local WASM runtime.

## Runtime support

Every package in this repo works in **both** browsers and Node ≥ 22. The two
example tiers carry that duality visibly: the React + Vite apps prove the
browser story, and `node/` proves the Node story (no bundler in the runtime
path).
