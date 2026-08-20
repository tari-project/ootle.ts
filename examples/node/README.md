# `@tari-project/ootle-examples-node`

Headless TypeScript scripts that exercise the Tari Ootle SDK from plain Node
(no bundler, no browser). They double as integration tests against LocalNet.

> This workspace is the **Node tier** of the examples folder. For the React +
> Vite browser apps see [`../README.md`](../README.md).

## Running a script

```bash
pnpm install
OOTLE_INDEXER_URL=http://localhost:12500 \
  pnpm --filter @tari-project/ootle-examples-node run <script-name>
```

Currently shipping:

| Script       | Demonstrates                                                 |
| ------------ | ------------------------------------------------------------ |
| `wasm-probe` | `@tari-project/ootle-wasm` initializes under plain Node ESM. |

### Core scripts

Each script generates fresh keys, faucets its own funds, exercises one feature,
asserts the on-chain outcome, and exits 0 on success (non-zero throw otherwise).

| Script              | Purpose                                                                                                                                                               | Command                                                                 | Env vars                                                                                                                                                                                       | Exit behaviour                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `faucet-claim`      | Smoke-test that LocalNet is reachable: faucet 10 TARI into a fresh wallet, read the balance.                                                                          | `pnpm --filter @tari-project/ootle-examples-node run faucet-claim`      | `OOTLE_INDEXER_URL`                                                                                                                                                                            | Exits 0 on positive balance; throws otherwise.                                            |
| `balance-query`     | Faucet + single-resource balance read + sweep of every vault on the account.                                                                                          | `pnpm --filter @tari-project/ootle-examples-node run balance-query`     | `OOTLE_INDEXER_URL`                                                                                                                                                                            | Exits 0 on positive TARI balance; throws otherwise.                                       |
| `counter-deploy`    | Instantiate a template (`new()`) and chain `increase()` in one atomic tx; print the new component's state.                                                            | `pnpm --filter @tari-project/ootle-examples-node run counter-deploy`    | `OOTLE_INDEXER_URL`, `OOTLE_COUNTER_TEMPLATE` **(required)**                                                                                                                                   | Exits 0 when a new `component_…` substate appears and resolves; throws otherwise.         |
| `fungible-transfer` | Multi-signer co-auth registration → dry-run estimate → 2 + 1 TARI public transfer.                                                                                    | `pnpm --filter @tari-project/ootle-examples-node run fungible-transfer` | `OOTLE_INDEXER_URL`                                                                                                                                                                            | Exits 0 when recipient balances match the expected post-transfer values.                  |
| `manual-co-signing` | Orchestrator wallet A fixes the seal keypair; remote wallet B independently produces a signature blob; A combines and submits.                                        | `pnpm --filter @tari-project/ootle-examples-node run manual-co-signing` | `OOTLE_INDEXER_URL`                                                                                                                                                                            | Exits 0 when the co-signed transfer commits.                                              |
| `dry-run`           | Two `sendDryRun` calls (expected-commit + expected-reject). **Sends no transaction.**                                                                                 | `pnpm --filter @tari-project/ootle-examples-node run dry-run`           | `OOTLE_INDEXER_URL`                                                                                                                                                                            | Exits 0 when the commit case commits and the overspend rejects.                           |
| `publish-template`  | Faucet → read a compiled `.wasm` from disk → dry-run + publish → print template id.                                                                                   | `pnpm --filter @tari-project/ootle-examples-node run publish-template`  | `OOTLE_INDEXER_URL`, `OOTLE_TEMPLATE_WASM` **(required)**                                                                                                                                      | Exits 0 when a `template_…` substate appears in the receipt diff.                         |
| `template-invoke`   | Instantiate a template (constructor returns a bucket → deposited inline) **or** reuse an existing component; call an AllowAll-gated read method and print the result. | `pnpm --filter @tari-project/ootle-examples-node run template-invoke`   | `OOTLE_INDEXER_URL`, one of `OOTLE_TEMPLATE_INSTANTIATE` or `OOTLE_TEMPLATE_COMPONENT` **(required)**, optional `OOTLE_TEMPLATE_FUNCTION`, `OOTLE_TEMPLATE_ARGS`, `OOTLE_TEMPLATE_READ_METHOD` | Exits 0 when the read method's transaction commits.                                       |
| `watch-events`      | Long-running SSE event watcher with client-side component/topic filtering.                                                                                            | `pnpm --filter @tari-project/ootle-examples-node run watch-events`      | `OOTLE_INDEXER_URL`, `OOTLE_COMPONENT_ADDRESS` (required), `OOTLE_EVENT_TOPIC`, `OOTLE_WATCH_LIMIT`                                                                                            | Runs until SIGINT (Ctrl-C) by default; exits 0 after `OOTLE_WATCH_LIMIT` events when set. |
| `workspace-chain`   | One tx → three accounts touched: withdraw, stash bucket, deposit into existing recipient, create a fresh extra account. Prints events.                                | `pnpm --filter @tari-project/ootle-examples-node run workspace-chain`   | `OOTLE_INDEXER_URL`                                                                                                                                                                            | Exits 0 when all three account balances reflect the chain's effects.                      |

### Stealth scripts

End-to-end stealth (confidential transfer) examples. See
[`src/stealth/README.md`](./src/stealth/README.md) for the feature table and
the canonical four-step flow.

| Script                   | Purpose                                                                                                                                                | Command                                                                      | Env vars            | Exit behaviour                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| `stealth:faucet-deposit` | Faucet → confidential deposit into a fresh recipient, then recipient-side `decryptOwnedUtxo` (AEAD owner-read) over the produced UTXO.                 | `pnpm --filter @tari-project/ootle-examples-node run stealth:faucet-deposit` | `OOTLE_INDEXER_URL` | Exits 0 when the decrypted value matches the deposited amount; throws otherwise. |
| `stealth:to-revealed`    | Revealed-change-dominant transfer via `StealthTransfer.spendRevealedInput` + `toRevealedOutput`, sealed via `WalletStealthAuthorizer`.                 | `pnpm --filter @tari-project/ootle-examples-node run stealth:to-revealed`    | `OOTLE_INDEXER_URL` | Exits 0 when the transfer commits; throws otherwise.                             |
| `stealth:to-stealth`     | Mixed `toStealthOutput` + `toRevealedOutput` shape (a confidential output to a fresh recipient + revealed change to the sender).                       | `pnpm --filter @tari-project/ootle-examples-node run stealth:to-stealth`     | `OOTLE_INDEXER_URL` | Exits 0 when the transfer commits; throws otherwise.                             |
| `stealth:spend`          | **Headline.** Faucet stealth deposit to self → `decryptInputData` sanity check → `spendStealthInput` → mask aggregation → balance proof → spend round. | `pnpm --filter @tari-project/ootle-examples-node run stealth:spend`          | `OOTLE_INDEXER_URL` | Exits 0 when the spend commits; throws on a reject (incl. balance-proof flakes). |

## Prerequisites

| Env var                | Default                             | Purpose                                            |
| ---------------------- | ----------------------------------- | -------------------------------------------------- |
| `OOTLE_INDEXER_URL`    | `http://localhost:12500` (LocalNet) | The indexer the scripts connect to.                |
| `OOTLE_FAUCET_ADDRESS` | `component_010203…0000` (LocalNet)  | Override the well-known LocalNet faucet component. |

The default `OOTLE_INDEXER_URL` matches `defaultIndexerUrl(Network.LocalNet)`
exported from `@tari-project/ootle`. You need a reachable LocalNet indexer +
faucet for anything beyond `wasm-probe`.

### Print-format contract (do not break)

`faucet-claim.ts` prints exactly one line of the form
`Created account: component_<hex>` on success. The CI job greps that out
(`grep -oE 'component_[0-9a-f]+'`) to seed `OOTLE_COMPONENT_ADDRESS` for
`watch-events`. If you change that line's format, update the workflow's
parsing step in the same PR.

The `wasm-probe` script needs nothing on-chain — it only verifies the local
WASM runtime story.

## Runner

Every script is a `*.ts` file executed via [`tsx`](https://tsx.is) (zero-config
TypeScript on Node, ESM-native, handles top-level await). Each script gets a
`scripts:` entry in this package's `package.json` so you never invoke `node`
directly and never think about TS loaders or `--experimental-*` flags.

## WASM-in-Node runtime story

`@tari-project/ootle-wasm@0.39.0` ships wasm-bindgen glue that self-initializes
on first import. `tsx` runs the file as a plain Node ESM module — there is **no
Vite transform**, unlike the Vitest test runtime (which inlines WASM through
`vite-plugin-wasm`). The `wasm-probe` script is the canonical verification of
the runtime path every Node consumer (script, server, bot) will use.

**Verified outcome: (b) — needs `--experimental-wasm-modules`.** On Node ≥ 22,
importing a `.wasm` file as an ES module is still gated behind that flag
(without it, `tsx` surfaces a `ERR_UNKNOWN_FILE_EXTENSION ".wasm"` from
Node's loader). No shim or wasm-bindgen init call is required — the flag
alone is enough.

The flag is wired into the `scripts:` block via `NODE_OPTIONS`:

```json
"scripts": {
  "wasm-probe": "NODE_OPTIONS=--experimental-wasm-modules tsx src/wasm-probe.ts"
}
```

so users only ever run `pnpm --filter @tari-project/ootle-examples-node run
wasm-probe` and never think about the flag. Every script that touches the
SDK's WASM helpers (which is effectively all of them — `signTransaction`,
`sealTransaction`, `SecretKeyWallet`, …) must keep the same `NODE_OPTIONS=`
prefix.

A successful run prints one line (plus Node's `ExperimentalWarning`):

```
WASM ok: pubkey 6cc1deccbceaa4db…
```

If a future Node release stabilizes WASM ESM (outcome **(a)** — "works out of
the box"), drop the `NODE_OPTIONS=` prefixes and re-record the outcome here.
If outcome **(c)** ever applies (the wasm-bindgen glue stops self-initializing
and needs an explicit loader shim), wrap the init in a tiny
`examples/node/src/wasm-init.ts` and have `_common.ts` re-export an
`ensureWasmReady()` that every script calls before its first crypto call —
again, document the change here in the same PR.

## Conventions

- **Workspace name:** `@tari-project/ootle-examples-node` (matches the
  `@tari-project/...` scope used by `packages/`).
- **Imports come from package roots only:** `@tari-project/ootle`,
  `@tari-project/ootle-indexer`, `@tari-project/ootle-secret-key-wallet`. Do
  not reach into `dist/...` or subpaths — public exports are curated.
- **Self-contained:** each script generates fresh keys via
  `SecretKeyWallet.randomWithViewKey(Network.LocalNet)` and faucets its own
  funds; no script depends on another's output.
- **Assertion-shaped:** scripts throw on unexpected on-chain state (missing
  UTXO in receipt, wrong outcome, …). The thrown stack trace is the CI signal.
  Do not wrap LocalNet calls in `try/catch` to print prettier errors.
- **`bigint` for amounts:** every µTari value is a `bigint`. The `tari(n)`
  helper from `_common.ts` converts a TARI count to µTari.

## Files

- `src/_common.ts` — shared scaffolding (constants, `newWallet`, `faucet`,
  `firstNewSubstate`, `wait`, `tari`, `getAccountBalance(s)`, …).
- `src/wasm-probe.ts` — the WASM-in-Node verification script.
- `src/balance-query.ts`, `src/faucet-claim.ts`, `src/fungible-transfer.ts`,
  `src/dry-run.ts`, `src/watch-events.ts` — the five core scripts (see table
  above).
- `src/stealth/` — stealth (confidential transfer) scripts with their own
  `_common.ts` extension (see [`src/stealth/README.md`](./src/stealth/README.md)).
