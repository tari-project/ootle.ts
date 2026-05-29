---
title: Stealth overview
description: Privacy-preserving (confidential) transfers — the four-step flow (build → prepare → authorize/sign → seal+watch), the view-secret concept, and the per-page guide map.
---

Stealth transfers move value confidentially: amounts are hidden in Pedersen commitments and each output carries an encrypted payload that only the recipient — who holds the matching **view-only key** — can scan and unblind.

All stealth crypto is hidden behind the `StealthCryptoProvider` interface. The default implementation, `WasmStealthCrypto`, calls `@tari-project/ootle-wasm`; tests can inject a fake. You normally never construct it yourself — the builder and authorizer default to it.

:::note
Client-side stealth scan / spend requires a `SecretKeyWallet` created with a view key (`SecretKeyWallet.randomWithViewKey(network)`). An `EphemeralKeySigner` has no view key, and `WalletDaemonSigner` keeps the view secret server-side (use the daemon's own stealth JRPC for that path).
:::

## The four-step flow

1. **Build.** Compose the transfer via `StealthTransfer` (or `generateOutputsStatement` for receive-only flows).
2. **Prepare.** Resolve substate versions, emit the on-chain `StealthTransfer` instruction, produce a `StealthTransferSpec`.
3. **Authorize / sign.** `WalletStealthAuthorizer.fromSpec` hydrates the balance proof and signs each spent stealth input with its one-time spend key (view secret needed only when spending).
4. **Seal + watch.** Submit the sealed envelope and watch for finality.

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
const authorizer = WalletStealthAuthorizer.fromSpec(wallet, spec, { viewSecret });
const tx = await authorizer.prepare(provider);

// 4. seal + watch — submit the sealed envelope and watch for finality.
const envelope = await tx.seal();
const txId = await submitTransaction(provider, envelope);
const outcome = await watchTransaction(provider, txId);
```

## Per-page guide

| Page                     | What it covers                                         | Runnable example                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Receiving](./receiving) | `decryptOwnedUtxo`, scanning for owned UTXOs.          | [`examples/node/src/stealth/faucet-deposit.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/stealth/faucet-deposit.ts)                                                                                                                                          |
| [Sending](./sending)     | `StealthTransfer` builder, revealed vs stealth in/out. | [`examples/node/src/stealth/stealth-to-revealed.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/stealth/stealth-to-revealed.ts) + [`stealth-to-stealth.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/stealth/stealth-to-stealth.ts) |
| [Spending](./spending)   | Spending a stealth UTXO end-to-end.                    | [`examples/node/src/stealth/spend-stealth-utxo.ts`](https://github.com/tari-project/ootle.ts/blob/main/examples/node/src/stealth/spend-stealth-utxo.ts)                                                                                                                                  |

Prefer a browser-side demo? The [`stealth-wallet`](https://github.com/tari-project/ootle.ts/tree/main/examples/stealth-wallet) React app walks through setup → receive → send in three cards.

## API reference

| Symbol                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Role                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`StealthTransfer`](../api/ootle/src/classes/StealthTransfer/)                                                                                                                                                                                                                                                                                                                                                                                                                             | Fluent builder for a confidential transfer (`spendRevealedInput` / `spendStealthInput` / `toStealthOutput` / `toRevealedOutput` / `payFeeFromRevealed` / `prepare`) |
| [`WalletStealthAuthorizer`](../api/ootle/src/classes/WalletStealthAuthorizer/)                                                                                                                                                                                                                                                                                                                                                                                                             | Hydrates the balance proof, signs, and seals a `StealthTransferSpec`                                                                                                |
| [`createOutput`](../api/ootle/src/functions/createOutput/)                                                                                                                                                                                                                                                                                                                                                                                                                                 | Construct an `Output` with conventional defaults (`payTo = { StealthPublicKey: {} }`, `minimumValuePromise = 0n`)                                                   |
| [`decryptOwnedUtxo`](../api/ootle/src/functions/decryptOwnedUtxo/)                                                                                                                                                                                                                                                                                                                                                                                                                         | Receive-side owner read: decrypt a fetched UTXO, or `null` if not owned                                                                                             |
| [`decryptInputData`](../api/ootle/src/functions/decryptInputData/)                                                                                                                                                                                                                                                                                                                                                                                                                         | Lower-level decrypt of raw commitment + ciphertext bytes                                                                                                            |
| [`generateOutputsStatement`](../api/ootle/src/functions/generateOutputsStatement/)                                                                                                                                                                                                                                                                                                                                                                                                         | One-shot complete transfer statement (no stealth inputs — e.g. a faucet)                                                                                            |
| [`parseSubstateUtxo`](../api/ootle/src/functions/parseSubstateUtxo/) / [`commitmentOf`](../api/ootle/src/functions/commitmentOf/) / [`stealthUtxoSubstateId`](../api/ootle/src/functions/stealthUtxoSubstateId/)                                                                                                                                                                                                                                                                           | Provider-agnostic substate / id helpers                                                                                                                             |
| [`WasmStealthCrypto`](../api/ootle/src/classes/WasmStealthCrypto/) / [`StealthCryptoProvider`](../api/ootle/src/interfaces/StealthCryptoProvider/)                                                                                                                                                                                                                                                                                                                                         | The crypto seam (real WASM impl + the interface)                                                                                                                    |
| [`Mask`](../api/ootle/src/classes/Mask/), [`EncryptedData`](../api/ootle/src/classes/EncryptedData/), [`StealthInput`](../api/ootle/src/classes/StealthInput/), [`BalanceProofSignature`](../api/ootle/src/classes/BalanceProofSignature/), [`StealthInputsStatement`](../api/ootle/src/classes/StealthInputsStatement/), [`StealthOutputsStatement`](../api/ootle/src/classes/StealthOutputsStatement/), [`StealthTransferStatement`](../api/ootle/src/classes/StealthTransferStatement/) | Domain types                                                                                                                                                        |

## View-only keys

`SecretKeyWallet` holds an optional view-only key, required for scanning and spending stealth outputs:

```ts
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";

const wallet = SecretKeyWallet.randomWithViewKey(Network.Esmeralda);
const viewSecret = wallet.getViewOnlySecret(); // Uint8Array | null
```

For ready-to-run end-to-end examples, see [`examples/node/src/stealth/`](https://github.com/tari-project/ootle.ts/tree/main/examples/node/src/stealth) — the canonical reference for the Node-side stealth flow.
