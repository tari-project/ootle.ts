# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Test all packages
pnpm -r test

# Test a single package (from repo root)
pnpm --filter @tari-project/ootle run test

# Run vitest in watch mode for a package
cd packages/ootle && pnpm vitest

# Lint all packages
pnpm lint

# Check for unused dependencies
pnpm knip

# Build documentation site (Starlight + TypeDoc API reference)
pnpm docs

# Run docs dev server
pnpm docs:dev

# Clean everything
./scripts/clean_everything.sh
```

## Architecture

This is a pnpm monorepo. The SDK targets the Tari Ootle network (a UTXO + smart contract L2).

### Package dependency graph

```
External npm packages (not in this repo):
  @tari-project/ootle-ts-bindings    Rust FFI type definitions
  @tari-project/ootle-wasm           WASM crypto functions
  @tari-project/indexer-client       Indexer REST API client
  @tari-project/wallet_jrpc_client   Wallet daemon JRPC client

         ↑ (all used as dependencies)

@tari-project/ootle               core: builder, transaction types, provider/signer interfaces, OotleWallet
    ↑               ↑                  ↑
ootle-indexer   ootle-secret-key-wallet   ootle-wallet-daemon-signer
(wraps           (in-memory signer,         (wraps
 indexer-client)  for testing)               wallet_jrpc_client)
```

### Key abstractions in `packages/ootle`

- **Provider** (`provider.ts`) — read-only chain access (substates, templates, fees). Implemented by `ootle-indexer`.
- **Signer** (`signer.ts`) — signs transactions, derives public keys. Implemented by the two wallet packages.
- **TransactionBuilder** (`builder.ts`) — fluent API for constructing Tari transactions (mutable `this`-returning pattern).
- **OotleWallet** (`wallet.ts`) — multi-signer wallet that manages multiple key providers (one per address); coordinates signing across several components.
- **Stealth transfers** (`stealth*.ts`) — privacy-preserving output helpers.
- **Builtin templates** (`builtin-templates.ts`) — typed helpers for Account and Faucet.

### Signers

| Package                      | Class                | Use case                                               |
| ---------------------------- | -------------------- | ------------------------------------------------------ |
| `ootle-secret-key-wallet`    | `SecretKeyWallet`    | Holds raw secret key in JS memory — testing only       |
| `ootle-secret-key-wallet`    | `EphemeralKeySigner` | One-shot throwaway key                                 |
| `ootle-wallet-daemon-signer` | `WalletDaemonSigner` | Delegates to `tari_ootle_walletd` process — production |

### WASM crypto

`@tari-project/ootle-wasm` is an external npm package that provides WASM-backed crypto functions: `generateKeypair`, `publicKeyFromSecretKey`, `schnorrSign`, `hashUnsignedTransaction`, `borEncodeTransaction`. These are called internally by `signTransaction` (in `ootle/src/transaction.ts`) and by the `SecretKeyWallet` / `EphemeralKeySigner` classes. Users do not need to manage a WASM module — the functions are imported directly.

`@tari-project/ootle-ts-bindings` provides Rust FFI type definitions (e.g. `UnsignedTransactionV1`, `TransactionSignature`, `Instruction`) used throughout the SDK for type safety.

### Transaction flow

1. Build instruction set via `TransactionBuilder` → `UnsignedTransactionV1`
2. `resolveTransaction` fills in substate versions via the provider
3. `signTransaction` generates a seal keypair, collects Schnorr signatures from all signers, and assembles a full `Transaction`
4. `sealTransaction` BOR-encodes the signed transaction into a `TransactionEnvelope`
5. `submitTransaction` submits the sealed envelope to the network
6. `watchTransaction` polls/streams for finality via `TransactionWatcher`

`sendTransaction` chains all of steps 2–6 in one call.

### Examples and docs

- `examples/` — React 19 + Vite demo apps (connect-button, indexer-explorer, template-inspector)
- `docs/` — Starlight documentation site with auto-generated TypeDoc API reference

## Toolchain

- Node ≥ 22, pnpm 10
- TypeScript strict mode, ES2022 target, ESNext modules, `"moduleResolution": "bundler"`
- ESLint flat config (`eslint.config.mjs`), Prettier (120-col, double quotes, trailing commas)
- Vitest for all package tests
