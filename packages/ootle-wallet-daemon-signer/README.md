# @tari-project/ootle-wallet-daemon-signer

Remote `Signer` for the Tari Ootle SDK — delegates signing to a running
`tari_ootle_walletd` process via JRPC. The secret key never enters JavaScript
memory.

## Runtime support

| Package                                    | Browser | Node ≥ 22            | Notes                              |
| ------------------------------------------ | ------- | -------------------- | ---------------------------------- |
| `@tari-project/ootle-wallet-daemon-signer` | ✓       | ✓ (with `authToken`) | WebAuthn passkeys are browser-only |

> **Node note:** Node ≥ 22 currently requires
> `NODE_OPTIONS=--experimental-wasm-modules` when running under `tsx` or plain
> `node` because the SDK loads `@tari-project/ootle-wasm` as an ES module. See
> [`examples/node/README.md`](../../examples/node/README.md) for the rationale
> and forward plan.

## Browser vs Node

The daemon's auth method is configured server-side and decides the runtime
profile of this signer.

### Browser

The daemon's auth method is typically `"webauthn"` — passkeys via
`navigator.credentials`. Pass just the URL and `WalletDaemonSigner.connect`
runs the WebAuthn flow automatically:

```ts
import { WalletDaemonSigner } from "@tari-project/ootle-wallet-daemon-signer";

const signer = await WalletDaemonSigner.connect({ url: "http://localhost:18103" });
```

### Node

WebAuthn is browser-only. If the daemon is configured for `method: "webauthn"`
and you call `connect({ url })` from Node, the SDK throws the canonical
actionable error:

```text
WebAuthn is browser-only. Run in a browser, or pass `authToken` explicitly to `WalletDaemonSigner.connect({ url, authToken })` from Node.
```

The Node answer is to **pre-fetch the auth token via your own flow** (or use
the daemon's `method: "none"` if you control its config) and pass it
explicitly to `connect`:

```ts
import { WalletDaemonSigner } from "@tari-project/ootle-wallet-daemon-signer";

const signer = await WalletDaemonSigner.connect({
  url: "http://localhost:18103",
  authToken: process.env.OOTLE_DAEMON_AUTH_TOKEN, // pre-fetched out-of-band
});
```

When `authToken` is supplied, the signer bypasses the WebAuthn challenge
entirely and presents the token directly to the daemon.

## Install

```sh
pnpm add @tari-project/ootle-wallet-daemon-signer
```

## Hello world

Connect, read the account address, and sign a transaction:

```ts
import { WalletDaemonSigner } from "@tari-project/ootle-wallet-daemon-signer";

const signer = await WalletDaemonSigner.connect({
  url: "http://localhost:18103",
  authToken: process.env.OOTLE_DAEMON_AUTH_TOKEN,
});

const address = await signer.getAddress();
const publicKey = await signer.getPublicKey();

const signatures = await signer.signTransaction(unsignedTx);
```

For the in-browser passkey flow end-to-end, see the
[`connect-button/`](../../examples/connect-button/) example app.

## Deep dive

For the full `WalletDaemonSignerOptions` surface and the daemon-side
`tari_ootle_walletd` invocation, see the
[root README's "`@tari-project/ootle-wallet-daemon-signer`" section](../../README.md#tari-projectootle-wallet-daemon-signer).

## Examples

Runnable browser apps and Node scripts live under
[`examples/`](../../examples/README.md). The
[`connect-button/`](../../examples/connect-button/) React app demonstrates the
browser passkey flow; for headless Node usage see
[`examples/node/README.md`](../../examples/node/README.md) and pass an
`authToken` as shown above.
