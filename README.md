# ootle.ts

> TypeScript SDK for building on the [Tari Ootle](https://github.com/tari-project/tari-ootle) network.

[![License](https://img.shields.io/badge/license-BSD%203--Clause-blue.svg)](LICENSE)

ootle.ts is a modular, strongly-typed SDK that lets you connect to wallets, query chain state, build transactions, and submit them to the Tari Ootle network — all from TypeScript or JavaScript.

---

## Packages

The SDK is split into four focused packages — each will be published to npm under the `@tari-project` scope. Install only what you need.

| Package                                                                               | Description                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`@tari-project/ootle`](#tari-projectootle)                                           | Core interfaces, transaction builder, and flow helpers           |
| [`@tari-project/ootle-indexer`](#tari-projectootle-indexer)                           | Indexer REST provider — read chain state and submit transactions |
| [`@tari-project/ootle-secret-key-wallet`](#tari-projectootle-secret-key-wallet)       | Local in-memory signer backed by WASM crypto                     |
| [`@tari-project/ootle-wallet-daemon-signer`](#tari-projectootle-wallet-daemon-signer) | Remote signer — delegates signing to a running wallet daemon     |

Cryptographic operations (key generation, Schnorr signing, BOR encoding) are provided by [`@tari-project/ootle-wasm`](https://www.npmjs.com/package/@tari-project/ootle-wasm), an external dependency used internally by `ootle` and `ootle-secret-key-wallet`.

---

## Quick start

### 1. Connect to the Esmeralda testnet and read a substate

```ts
import { ProviderBuilder, Network } from "@tari-project/ootle-indexer";

const provider = await ProviderBuilder.new().withNetwork(Network.Esmeralda).connect(); // uses the default public indexer URL

const substate = await provider.getSubstate("component_0x…");
console.log(substate);
```

### 2. Build and submit a transaction (wallet daemon)

```ts
import { TransactionBuilder, sendTransaction, Network } from "@tari-project/ootle";
import { ProviderBuilder } from "@tari-project/ootle-indexer";
import { WalletDaemonSigner } from "@tari-project/ootle-wallet-daemon-signer";

const provider = await ProviderBuilder.new().withNetwork(Network.LocalNet).connect();
const signer = await WalletDaemonSigner.connect({ url: "http://localhost:18103", authToken: "…" });

const unsignedTx = TransactionBuilder.new(Network.LocalNet)
  .feeTransactionPayFromComponent(await signer.getAddress(), 1000n)
  .callMethod({ componentAddress: accountAddress, methodName: "withdraw" }, [
    { Literal: resourceAddress },
    { Literal: "500" },
  ])
  .saveVar("bucket")
  .callMethod({ componentAddress: recipientAddress, methodName: "deposit" }, [{ Workspace: "bucket" }])
  .buildUnsignedTransaction();

const result = await sendTransaction(provider, signer, unsignedTx);
```

### 3. Local signing (testing / scripting)

```ts
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";

// Generate a fresh wallet with a view-only key (for stealth output scanning)
const wallet = SecretKeyWallet.randomWithViewKey(Network.Esmeralda);

// Or restore from an existing key (Uint8Array)
const wallet = SecretKeyWallet.fromSecretKey(ownerSecretKey, Network.Esmeralda);
```

---

## Architecture

ootle.ts uses two core abstractions:

### `Provider` — reads chain state

Implemented by `IndexerProvider`. Provides:

- `getSubstate(id)` / `fetchSubstates(ids)`
- `resolveInputs(inputs)` — fills in missing versions before signing
- `submitTransaction(envelope)`
- `getTransactionResult(txId)`
- `listRecentTransactions(params)` / `getTemplateDefinition(address)`

### `Signer` — produces signatures

Implemented by `SecretKeyWallet`, `WalletDaemonSigner`, and `EphemeralKeySigner`. Provides:

- `getAddress()` / `getPublicKey()`
- `signTransaction(unsignedTx)`

### Transaction flow

```
unsignedTx
  → resolveTransaction(provider, …)   // fill in substate versions
  → signTransaction(signers, …)        // generate seal keypair, collect Schnorr signatures
  → sealTransaction(signed)            // BOR-encode into a TransactionEnvelope
  → submitTransaction(provider, …)     // submit the envelope to the network
  → watchTransaction(provider, txId)   // wait for finalization
```

Or use the `sendTransaction` / `sendDryRun` convenience helpers which chain all steps.

> **Note:** WASM crypto operations (hashing, signing, encoding) are handled internally by `signTransaction`, `sealTransaction`, and `sendTransaction`. You do not need to manage a WASM module or encoder — `@tari-project/ootle-wasm` is a dependency of the core package.

---

## Package Reference

### `@tari-project/ootle`

Core package. Everything else depends on it.

```ts
import {
  Network,
  TransactionBuilder,
  literalArg,
  resolveTransaction,
  signTransaction,
  sealTransaction,
  submitTransaction,
  watchTransaction,
  sendTransaction,
  sendDryRun,
  classifyOutcome,
  OotleWallet,
  WalletStealthAuthorizer,
  StealthTransfer,
  AccountInvokeBuilder,
  FaucetInvokeBuilder,
  defaultIndexerUrl,
} from "@tari-project/ootle";
```

#### `Network`

```ts
enum Network {
  MainNet = 0x00,
  StageNet = 0x01,
  NextNet = 0x02,
  LocalNet = 0x10,
  Igor = 0x24,
  Esmeralda = 0x26,
}
```

#### `TransactionBuilder`

Fluent builder for `UnsignedTransactionV1`.

```ts
const unsignedTx = TransactionBuilder.new(Network.Esmeralda)
  .feeTransactionPayFromComponent(accountAddress, 1000n)
  .callFunction({ templateAddress, functionName: "new" }, [literalArg("hello")])
  .saveVar("component")
  .callMethod({ componentAddress, methodName: "do_something" }, [{ Workspace: "component" }])
  .withMinEpoch(10)
  .addInput({ substate_id: vaultId, version: 3 })
  .buildUnsignedTransaction();
```

Key methods:

| Method                                                    | Description                                    |
| --------------------------------------------------------- | ---------------------------------------------- |
| `callFunction(func, args)`                                | Call a template function                       |
| `callMethod(method, args)`                                | Call a component method                        |
| `createAccount(ownerPublicKey)`                           | Create a new account component                 |
| `saveVar(name)`                                           | Save last output to a named workspace variable |
| `feeTransactionPayFromComponent(addr, amount)`            | Add fee instruction                            |
| `feeTransactionPayFromComponentConfidential(addr, proof)` | Confidential fee                               |
| `claimBurn(claim, output_data)`                           | Claim a Minotari burn                          |
| `allocateAddress(type, name)`                             | Pre-allocate an address                        |
| `addInput(req)` / `withInputs(reqs)`                      | Add substate inputs                            |
| `withMinEpoch(n)` / `withMaxEpoch(n)`                     | Set epoch bounds                               |
| `buildUnsignedTransaction()`                              | Return the finished `UnsignedTransactionV1`    |

#### Transaction flow functions

```ts
// Individual steps
const resolved = await resolveTransaction(provider, unsignedTx);
const signed = await signTransaction([signer], resolved);       // returns a signed Transaction
const envelope = sealTransaction(signed);                        // BOR-encode into TransactionEnvelope
const txId = await submitTransaction(provider, envelope);        // submit to network
const receipt = await watchTransaction(provider, txId, { timeoutMs: 30_000 });

// All-in-one
const receipt = await sendTransaction(provider, signer, unsignedTx);

// Dry-run (simulates without committing)
const result = await sendDryRun(provider, signer, unsignedTx);

// Inspect the outcome
const outcome = classifyOutcome(receipt.result);
// outcome: { outcome: "Commit" }
//        | { outcome: "FeeIntentCommit", reason: string }
//        | { outcome: "Reject", reason: string }
```

#### `OotleWallet`

Multi-signer wallet that manages multiple key providers — one per address. Useful when a transaction requires authorizations from several components.

```ts
import { OotleWallet } from "@tari-project/ootle";

const wallet = new OotleWallet();
wallet.registerKeyProvider(address, secretKeyWallet);
wallet.setDefaultSigner(address);

// Sign on behalf of any registered signer
const auth = await wallet.authorizeTransaction(address, unsignedTx);

// Sign with the default signer
const signatures = await wallet.signTransaction(unsignedTx);
```

#### Builtin template helpers

Pre-built builders for the standard account and faucet templates.

```ts
import { AccountInvokeBuilder, FaucetInvokeBuilder } from "@tari-project/ootle";

// Withdraw from account
const tx = new AccountInvokeBuilder(Network.Esmeralda, accountAddress)
  .feeTransactionPayFromComponent(accountAddress, 1000n)
  .publicTransfer(accountAddress, resourceAddress, 500n, recipientAddress)
  .build();

// Take faucet funds
const tx = new FaucetInvokeBuilder(Network.Esmeralda, faucetAddress)
  .feeTransactionPayFromComponent(accountAddress, 1000n)
  .takeFaucetFunds(accountAddress, 10_000n)
  .build();
```

#### `defaultIndexerUrl(network)`

Returns the well-known indexer URL for a network. Currently returns URLs for `LocalNet` and `Esmeralda`; throws for others.

```ts
import { defaultIndexerUrl, Network } from "@tari-project/ootle";

const url = defaultIndexerUrl(Network.Esmeralda);
// "https://ootle-indexer-a.tari.com"
```

---

### `@tari-project/ootle-indexer`

Provider implementation backed by the indexer REST API. Wraps [`@tari-project/indexer-client`](https://www.npmjs.com/package/@tari-project/indexer-client) with the SDK's `Provider` interface and adds SSE-based transaction watching.

```ts
import {
  IndexerProvider,
  ProviderBuilder,
  IndexerClient,
  TransactionWatcher,
  PendingTransaction,
  resolveWantInputs,
} from "@tari-project/ootle-indexer";
import type { WantInput, TransactionEntry, TemplateMetadata } from "@tari-project/ootle-indexer";
```

#### `ProviderBuilder`

Fluent factory for `IndexerProvider`. Falls back to `defaultIndexerUrl` when no URL is set.

```ts
const provider = await ProviderBuilder.new()
  .withNetwork(Network.Esmeralda)
  .withUrl("http://my-indexer:18300") // optional — defaults to known URL
  .withTransactionTimeoutMs(60_000)
  .connect();
```

#### `IndexerProvider`

```ts
// Connect
const provider = await IndexerProvider.connect({ url, network });

// Read chain state
const substate = await provider.getSubstate("component_0x…");
const substates = await provider.fetchSubstates([id1, id2]);
const template = await provider.getTemplateDefinition(templateAddress);
const list = await provider.listRecentTransactions({ limit: 5, last_id: null });

// Submit
const { transaction_id } = await provider.submitTransaction(envelope);

// Watch for finalization via SSE (falls back to polling on timeout)
const outcome = await provider.watchTransactionSSE(transaction_id).watch();

// Full receipt (after watching)
const receipt = await provider.watchTransactionSSE(transaction_id).getReceipt();

// Stop the SSE watcher when done
provider.stopWatcher();
```

#### `TransactionWatcher` and `PendingTransaction`

The `TransactionWatcher` maintains a persistent SSE connection to the indexer's `/events` endpoint and routes `TransactionFinalized` events to registered waiters. It starts lazily on the first `watch()` call and can be shared across many transactions.

```ts
import { TransactionWatcher } from "@tari-project/ootle-indexer";

const watcher = new TransactionWatcher("http://localhost:18300");
watcher.start();

// Submit your transaction, then:
const pending = watcher.watch(txId, client, 32_000);
const outcome = await pending.watch(); // SSE-first, poll fallback
const receipt = await pending.getReceipt(); // raw indexer response

watcher.stop();
```

`PendingTransaction.watch()` returns a `TransactionOutcome` and does **not** throw on `FeeIntentCommit` or `Reject` — the caller decides how to handle each outcome.

#### `WantInput` and `resolveWantInputs`

Lazily resolve inputs by querying the indexer rather than supplying exact versions upfront.

```ts
import { resolveWantInputs } from "@tari-project/ootle-indexer";
import type { WantInput } from "@tari-project/ootle-indexer";

const wants: WantInput[] = [
  { type: "SpecificSubstate", substateId: "component_0x…" },
  { type: "VaultForResource", resourceAddress: "resource_0x…" },
];

const inputs = await resolveWantInputs(provider.getClient(), wants);
// inputs: SubstateRequirement[] with versions filled in
```

---

### `@tari-project/ootle-secret-key-wallet`

Local signer that holds secret key material in JavaScript memory and uses `@tari-project/ootle-wasm` for all cryptographic operations.

> **Warning:** The secret key lives unencrypted in memory. For production use, prefer `WalletDaemonSigner` so the key never touches JavaScript.

```ts
import { SecretKeyWallet, EphemeralKeySigner } from "@tari-project/ootle-secret-key-wallet";
```

#### `SecretKeyWallet`

Implements `Signer`. Holds an account secret key and an optional view-only key (required for stealth output scanning).

```ts
// Generate a new random wallet with a view-only key (for stealth support)
const wallet = SecretKeyWallet.randomWithViewKey(Network.Esmeralda);

// Restore from a stored secret key (Uint8Array)
const wallet = SecretKeyWallet.fromSecretKey(ownerSecretKey, Network.Esmeralda);

// Restore with both account key and view-only key
const wallet = SecretKeyWallet.fromSecretKey(ownerSecretKey, Network.Esmeralda, viewOnlySecretKey);

// Restore from both secret and public keys (e.g. from a keystore)
const wallet = SecretKeyWallet.fromKeypair(ownerSecretKey, publicKey, Network.Esmeralda);

// With view-only key for stealth
const wallet = SecretKeyWallet.fromKeypair(ownerSecretKey, publicKey, Network.Esmeralda, viewOnlySecretKey);

// Sign a transaction
const signatures = await wallet.signTransaction(unsignedTx);

// Access view-only key (for scanning stealth outputs)
const viewKey = wallet.getViewOnlySecret();
```

#### `EphemeralKeySigner`

Generates a one-time throwaway keypair. Used in privacy-preserving transactions where no link to the sender's identity should exist. The key is discarded when the object is garbage-collected.

```ts
const signer = EphemeralKeySigner.generate(); // defaults to Esmeralda
const signed = await signTransaction([signer], unsignedTx);
```

---

### `@tari-project/ootle-wallet-daemon-signer`

Delegates signing to a running `tari_ootle_walletd` process via [`@tari-project/wallet_jrpc_client`](https://www.npmjs.com/package/@tari-project/wallet_jrpc_client). The secret key never enters JavaScript memory.

```ts
import { WalletDaemonSigner } from "@tari-project/ootle-wallet-daemon-signer";
import type { WalletDaemonSignerOptions } from "@tari-project/ootle-wallet-daemon-signer";
```

```ts
const options: WalletDaemonSignerOptions = {
  url: "http://localhost:18103",
  authToken: "your-auth-token",
};

// Connect and cache account info
const signer = await WalletDaemonSigner.connect(options);

const address = await signer.getAddress();
const publicKey = await signer.getPublicKey();

// Sign a transaction — the daemon returns signatures, the key stays on the daemon
const signatures = await signer.signTransaction(unsignedTx);
```

To start the wallet daemon:

```sh
./tari_ootle_walletd --network esme
```

---

## Stealth transfers

ootle.ts includes support for stealth (privacy-preserving) transfers, mirroring the `stealth` module in the Rust `ootle-rs` crate.

Stealth transfers produce outputs with one-time public keys — only the recipient (who holds the matching view-only key) can scan and spend them.

```ts
import {
  StealthTransfer,
  WalletStealthAuthorizer,
  OotleWallet,
  signTransaction,
  sealTransaction,
  resolveTransaction,
  submitTransaction,
} from "@tari-project/ootle";

// 1. Build the stealth transfer
const spec = await new StealthTransfer(Network.Esmeralda, factory)
  .from(sourceAccount, resourceAddress)
  .to(recipientPublicKeyHex, 1_000_000n)
  .feeFrom(feeAccount, 1000n)
  .build();

// 2. Create the authorizer (signs with the account key)
const wallet = new OotleWallet();
wallet.registerKeyProvider(senderAddress, secretKeyWallet);
wallet.setDefaultSigner(senderAddress);

const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec);

// 3. Sign, seal, and submit
const resolved = await resolveTransaction(provider, spec.unsignedTx);
const signed = await signTransaction([authorizer], resolved);
const envelope = sealTransaction(signed);
const txId = await submitTransaction(provider, envelope);
```

**Interfaces for implementing your own stealth providers:**

- `StealthOutputStatementFactory` — generates output statements (proofs + encrypted data)
- `InputDecryptor` — decrypts stealth inputs owned by your key
- `OutputMaskProvider` — provides fresh output masks (blinding factors)
- `DiffieHellmanKdfKeyProvider` — derives shared secrets for output encryption

---

## Examples

Three React + Vite example apps are included under `examples/`.

### connect-button

Minimal wallet connection UI. Connects to a running wallet daemon and displays the account address and public key.

```sh
cd examples/connect-button
pnpm dev
```

Requires `tari_ootle_walletd` running locally. Default endpoint: `http://127.0.0.1:9000/json_rpc`.

### indexer-explorer

Browse on-chain state. Look up substates by ID, or browse recent transactions from the indexer.

```sh
cd examples/indexer-explorer
pnpm dev
```

Pre-configured to connect to the public Esmeralda testnet indexer. No local setup required.

### template-inspector

Browse published template ABIs. Lists all templates cached by the indexer and renders their function definitions, argument types, and return values.

```sh
cd examples/template-inspector
pnpm dev
```

---

## Development

This repo uses [pnpm](https://pnpm.io/) workspaces. You'll need **Node.js 22+** and **pnpm 10+**.

### Setup

```sh
# Clone and install
git clone https://github.com/tari-project/tari.js.git
cd tari.js
pnpm install
```

### Build

```sh
# Build all SDK packages
pnpm -r build

# Build a specific package
pnpm --filter @tari-project/ootle build
```

### Test

```sh
# Run all package tests
pnpm -r test

# Run a single package's tests
pnpm --filter @tari-project/ootle run test

# Watch mode (from a package directory)
cd packages/ootle && pnpm vitest
```

### Lint and format

```sh
# ESLint + Prettier across all packages
pnpm lint

# Check for unused exports and dependencies
pnpm knip
```

### Documentation

The documentation site uses [Starlight](https://starlight.astro.build/) (Astro) with auto-generated API reference via [TypeDoc](https://typedoc.org/).

```sh
# Build the docs site (outputs to docs/dist/)
pnpm docs

# Run the docs dev server with hot reload
pnpm docs:dev
```

The API reference is generated from the TypeScript source of all four SDK packages using a dedicated [`tsconfig.typedoc.json`](tsconfig.typedoc.json). Hand-written guides live in [`docs/src/content/docs/`](docs/src/content/docs/).

### Run an example

```sh
cd examples/connect-button   # or indexer-explorer, template-inspector
pnpm install
pnpm dev
```

See each example's own README for prerequisites (e.g. running a wallet daemon).

### Clean everything

```sh
./scripts/clean_everything.sh
```

---

## Repository structure

```
tari.js/
├── packages/
│   ├── ootle/                        Core SDK (builder, types, transaction flow)
│   ├── ootle-indexer/                Indexer REST provider
│   ├── ootle-secret-key-wallet/      Local in-memory signer (testing)
│   └── ootle-wallet-daemon-signer/   Remote wallet daemon signer
├── examples/
│   ├── connect-button/               Wallet connection demo
│   ├── indexer-explorer/             Read-only transaction/substate browser
│   └── template-inspector/           Template ABI viewer
├── docs/                             Starlight documentation site
├── scripts/                          CI and utility scripts
└── .github/workflows/                CI, docs deploy, npm publish
```

---

## Contributing

Contributions are welcome! Here's how to get involved.

### Workflow

1. Fork the repo and create a branch from `main`
2. `pnpm install && pnpm -r build` — make sure the baseline builds
3. Make your changes
4. `pnpm lint` — fix any lint errors
5. `pnpm -r test` — ensure all tests pass
6. `pnpm knip` — check for unused exports or dependencies
7. Open a pull request against `main`

### CI checks

Every PR runs these GitHub Actions automatically:

| Workflow | What it does |
|---|---|
| **CI** | Builds all packages |
| **Lint** | Runs ESLint + Prettier |
| **Docs test** | Verifies the documentation site builds |
| **PR title** | Enforces [Conventional Commits](https://www.conventionalcommits.org/) format |
| **Signed commits** | Verifies commits are signed |

### Conventions

- **TypeScript strict mode** — all packages use `"strict": true`
- **ESLint flat config** — shared root config extended by each package
- **Prettier** — 120-char lines, double quotes, trailing commas
- **Commit messages** — follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by CI)
- **No default exports** — use named exports everywhere

### Deployment

- **npm**: packages are auto-published to npm on push to `main` when their version number changes
- **Docs**: the documentation site auto-deploys to GitHub Pages on push to `main`

---

## License

BSD 3-Clause — see [LICENSE](LICENSE).

---

<div align="center">
Built with the <a href="https://tari.com">Tari Project</a>
</div>
