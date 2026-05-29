# @tari-project/ootle

Core SDK for the Tari Ootle network — transaction builder, `Provider` / `Signer`
interfaces, transaction flow helpers, builtin templates, and the stealth
(confidential transfer) API.

## Runtime support

| Package               | Browser | Node ≥ 22 | Notes                                            |
| --------------------- | ------- | --------- | ------------------------------------------------ |
| `@tari-project/ootle` | ✓       | ✓         | Core; WASM crypto via `@tari-project/ootle-wasm` |

> **Node note:** Node ≥ 22 currently requires
> `NODE_OPTIONS=--experimental-wasm-modules` when running under `tsx` or plain
> `node` (the WASM ESM gating in Node will be lifted in a future release). See
> [`examples/node/README.md`](../../examples/node/README.md) for the rationale
> and forward plan; every script in `examples/node/` wires the flag into its
> `pnpm` invocation so most users never set it manually.

## Install

```sh
pnpm add @tari-project/ootle
```

Also pair it with a `Provider` (e.g. `@tari-project/ootle-indexer`) and a
`Signer` (e.g. `@tari-project/ootle-wallet-daemon-signer` or
`@tari-project/ootle-secret-key-wallet`).

## Hello world

Build, sign, and submit a transaction end-to-end:

```ts
import { TransactionBuilder, sendTransaction, Network } from "@tari-project/ootle";
import { ProviderBuilder } from "@tari-project/ootle-indexer";
import { WalletDaemonSigner } from "@tari-project/ootle-wallet-daemon-signer";

const provider = await ProviderBuilder.new().withNetwork(Network.LocalNet).connect();
const signer = await WalletDaemonSigner.connect({
  url: "http://localhost:18103",
  authToken: process.env.OOTLE_DAEMON_AUTH_TOKEN,
});

const unsignedTx = TransactionBuilder.new(Network.LocalNet)
  .feeTransactionPayFromComponent(await signer.getAddress(), 1000n)
  .callMethod({ componentAddress: senderAddress, methodName: "withdraw" }, [
    { Literal: resourceAddress },
    { Literal: "500" },
  ])
  .saveVar("bucket")
  .callMethod({ componentAddress: recipientAddress, methodName: "deposit" }, [{ Workspace: "bucket" }])
  .buildUnsignedTransaction();

const receipt = await sendTransaction(provider, signer, unsignedTx);
```

## Deep dive

For the full API surface — `TransactionBuilder` methods, the transaction flow
helpers (`resolveTransaction`, `signTransaction`, `sealTransaction`,
`submitTransaction`, `watchTransaction`, `sendTransaction`, `sendDryRun`,
`classifyOutcome`), `OotleWallet`, the stealth API (`StealthTransfer`,
`WalletStealthAuthorizer`, `decryptOwnedUtxo`), and the builtin template
helpers (`AccountInvokeBuilder`, `FaucetInvokeBuilder`) — see the
[root README's "`@tari-project/ootle`" section](../../README.md#tari-projectootle).

## Examples

Runnable browser apps and Node scripts live under
[`examples/`](../../examples/README.md). The Node tier
([`examples/node/`](../../examples/node/README.md)) is the canonical reference
for using this package from plain `tsx` / `node`.
