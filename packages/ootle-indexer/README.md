# @tari-project/ootle-indexer

Indexer REST `Provider` for the Tari Ootle network — reads chain state, submits
transactions, and watches for finality via SSE.

## Runtime support

| Package                       | Browser | Node ≥ 22 | Notes                        |
| ----------------------------- | ------- | --------- | ---------------------------- |
| `@tari-project/ootle-indexer` | ✓       | ✓         | `fetch` + SSE native in both |

This package has no DOM-specific code. `fetch` and SSE
(`response.body.getReader()` + `TextDecoder`) are native in both browsers and
Node ≥ 22, so the same artifact runs in either environment.

> **Node note:** Node ≥ 22 currently requires
> `NODE_OPTIONS=--experimental-wasm-modules` when running under `tsx` or plain
> `node` because `@tari-project/ootle` (a peer in the SDK) loads
> `@tari-project/ootle-wasm` as an ES module. See
> [`examples/node/README.md`](../../examples/node/README.md) for the rationale
> and forward plan.

## Install

```sh
pnpm add @tari-project/ootle-indexer
```

## Hello world

Connect to the Esmeralda testnet and read a substate:

```ts
import { ProviderBuilder, Network } from "@tari-project/ootle-indexer";

const provider = await ProviderBuilder.new().withNetwork(Network.Esmeralda).connect();

const substate = await provider.getSubstate("component_0x…");
console.log(substate);
```

For LocalNet, pass `Network.LocalNet`; the builder falls back to
`defaultIndexerUrl(Network.LocalNet)` (`http://localhost:12500`) when no URL is
configured.

## Deep dive

For `ProviderBuilder`, `IndexerProvider`, `TransactionWatcher` /
`PendingTransaction`, and the lazy `WantInput` / `resolveWantInputs` flow, see
the [root README's "`@tari-project/ootle-indexer`" section](../../README.md#tari-projectootle-indexer).

## Examples

Runnable browser apps and Node scripts live under
[`examples/`](../../examples/README.md) — the
[`indexer-explorer/`](../../examples/indexer-explorer/) React app browses
substates, transactions, and templates via this provider, and
[`examples/node/`](../../examples/node/README.md) drives it from headless
TypeScript.
