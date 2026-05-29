# @tari-project/ootle-secret-key-wallet

Local in-memory `Signer` for the Tari Ootle SDK, backed by WASM crypto.
**Testing / scripting use only** — the secret key lives unencrypted in JS
memory. For production, prefer
[`@tari-project/ootle-wallet-daemon-signer`](../ootle-wallet-daemon-signer/README.md)
so the key never enters JavaScript.

## Runtime support

| Package                                 | Browser | Node ≥ 22 | Notes                                                 |
| --------------------------------------- | ------- | --------- | ----------------------------------------------------- |
| `@tari-project/ootle-secret-key-wallet` | ✓       | ✓         | Stealth scan/spend needs `randomWithViewKey(network)` |

> **Node note:** Node ≥ 22 currently requires
> `NODE_OPTIONS=--experimental-wasm-modules` when running under `tsx` or plain
> `node` because this package loads `@tari-project/ootle-wasm` as an ES module.
> See [`examples/node/README.md`](../../examples/node/README.md) for the
> rationale and forward plan; every script in `examples/node/` wires the flag
> into its `pnpm` invocation.

> **Stealth note:** Client-side stealth scan / spend requires a `SecretKeyWallet`
> created with a view key — use `SecretKeyWallet.randomWithViewKey(network)` or
> `SecretKeyWallet.fromSecretKey(ownerKey, network, viewOnlyKey)`. The stealth
> API in `@tari-project/ootle` (`decryptOwnedUtxo`, `WalletStealthAuthorizer`)
> will throw if the wallet was created without a view key. See the canonical
> usage in [`examples/node/`](../../examples/node/README.md) — the stealth
> scripts (`stealth:faucet-deposit`, `stealth:to-revealed`, `stealth:to-stealth`,
> `stealth:spend`) all build their wallets via
> `SecretKeyWallet.randomWithViewKey(Network.LocalNet)`.

## Install

```sh
pnpm add @tari-project/ootle-secret-key-wallet
```

## Hello world

Generate a fresh wallet with a view-only key and sign a transaction:

```ts
import { Network } from "@tari-project/ootle";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";

// Generate a random wallet with a view-only key (needed for stealth scan/spend).
const wallet = SecretKeyWallet.randomWithViewKey(Network.LocalNet);

console.log(await wallet.getAddress());

// Sign a previously-built unsigned transaction:
const signatures = await wallet.signTransaction(unsignedTx);
```

For a fully-typed account-key restore (no view key needed) use
`SecretKeyWallet.fromSecretKey(ownerSecretKey, network)`; pair it with a
`viewOnlySecretKey` to enable stealth.

## Deep dive

For the `SecretKeyWallet` factory matrix
(`randomWithViewKey` / `fromSecretKey` / `fromKeypair`) and the
`EphemeralKeySigner` (one-shot throwaway keys), see the
[root README's "`@tari-project/ootle-secret-key-wallet`" section](../../README.md#tari-projectootle-secret-key-wallet).

## Examples

Runnable browser apps and Node scripts live under
[`examples/`](../../examples/README.md). The
[`stealth-wallet/`](../../examples/stealth-wallet/) React app and the stealth
script set under
[`examples/node/src/stealth/`](../../examples/node/src/stealth/) are the
canonical references for using this signer with the stealth API.
