# Stealth Node examples

Runnable, end-to-end Node examples for the TypeScript SDK's stealth
(confidential transfer) surface.

Stealth crypto — bulletproofs, ElGamal viewable balances, balance-proof
signatures, input-mask aggregation — runs entirely on the vendored
[`@tari-project/ootle-wasm`](https://www.npmjs.com/package/@tari-project/ootle-wasm)
blob (the default crypto provider, fronted by `WasmStealthCrypto`). No wallet
daemon is required.

## Prerequisites

- A reachable LocalNet **indexer** with a faucet. Point the examples at
  it with `OOTLE_INDEXER_URL` (defaults to
  `defaultIndexerUrl(Network.LocalNet)` from `@tari-project/ootle` otherwise):

  ```bash
  export OOTLE_INDEXER_URL=http://localhost:12500
  ```

- Run any example from the repo root:

  ```bash
  pnpm --filter @tari-project/ootle-examples-node run stealth:<name>
  ```

Each example generates fresh keys (sender + recipient) and faucets its own
funds, so they are self-contained — just run them.

## What each example shows

| File                                                 | Stealth features demonstrated                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`faucet-deposit.ts`](./faucet-deposit.ts)           | `generateOutputsStatement`-style mint via the native `StealthTransfer` instruction, recipient-side AEAD owner-read via `decryptOwnedUtxo` |
| [`stealth-to-revealed.ts`](./stealth-to-revealed.ts) | `spendRevealedInput` → `toRevealedOutput` (revealed-change-dominant transfer), `payFeeFromRevealed`                                       |
| [`stealth-to-stealth.ts`](./stealth-to-stealth.ts)   | `toStealthOutput` + `toRevealedOutput` (mixed confidential output + revealed change)                                                      |
| [`spend-stealth-utxo.ts`](./spend-stealth-utxo.ts)   | **headline:** deposit → discover → `decryptInputData` → `spendStealthInput` → mask aggregation → balance proof                            |

Shared scaffolding (`faucetStealth`, `faucetRevealed`, `makeTransfer`,
`sendStealth`, `readUtxoBody`, `stealthUtxoSubstate`, `commitmentOf`, …)
lives in [`_common.ts`](./_common.ts) and builds on the base
[`../_common.ts`](../_common.ts) (`newWallet`, `wait`, `tari`,
`firstNewSubstate`, `signAndSubmit`).

## Canonical flow (every stealth example follows this)

```ts
import { StealthTransfer, WalletStealthAuthorizer, WasmStealthCrypto } from "@tari-project/ootle";

// 1. build — assemble the transfer via the SDK builder (or
//    generateOutputsStatement for faucet-only flows).
const transfer = new StealthTransfer(provider, TARI_RESOURCE, new WasmStealthCrypto(NETWORK))
  .spendRevealedInput(account, 4n * TARI)
  .toStealthOutput({ destination: recipient, amount: 1n * TARI, resourceAddress: TARI_RESOURCE })
  .toRevealedOutput(2n * TARI)
  .payFeeFromRevealed(1n * TARI);

// 2. prepare — emits the on-chain StealthTransfer instruction, resolves
//    substate versions, and produces the StealthTransferSpec.
const spec = await transfer.prepare();

// 3. authorize/sign — hydrates the balance proof (decrypting any stealth
//    inputs with the view secret) and signs each spent stealth input with
//    its one-time spend key.
const authorizer = await WalletStealthAuthorizer.fromSpec(spec, viewSecret);
const hydrated = await authorizer.prepare();

// 4. seal + watch — submit the sealed envelope and watch for finality.
const pending = await sendTransaction(provider, [signer], hydrated.unsignedTx);
const outcome = await pending.watch();
```

The receive-side `faucet-deposit.ts` is the **shortest** version of this
flow: no stealth inputs, no builder needed — just
`generateOutputsStatement`-equivalent statement assembly fed into the
native `StealthTransfer` instruction, then `decryptOwnedUtxo` on the
produced UTXO.

## Notes & limitations

- **Owned stealth UTXOs are read with the AEAD owner-read.**
  [`decryptOwnedUtxo`](../../../../packages/ootle/src/stealth/wallet-helpers.ts)
  recovers `(value, mask)` from the output's `encrypted_data` with the
  recipient's view secret — the way a recipient reads their own inbound
  UTXO, viewable resource or not. (The ElGamal viewable-balance audit
  read, for a third party holding only the view key, is not part of this
  client.)
- **Receipt-diff polling.** The indexer's SSE "committed" event can arrive
  a beat before the receipt diff is queryable, so `stealthUtxoSubstate`
  polls the receipt up to 6 times with 500 ms backoff.
- **Sender + recipient wallets need view secrets.**
  `newWallet()` (in `../_common.ts`) builds via
  `SecretKeyWallet.fromKeypair(...)` with an explicit view key, so every
  wallet is stealth-ready. Don't swap to `.random(...)` — that variant
  has no view key and `getViewOnlySecret()` returns `null`.
