# Changelog

All notable changes to `@tari-project/ootle` are documented here.

## 0.19.1

### Fixed

- `@tari-project/ootle` loads in Node again. 0.19.0 failed on import with "does not provide an export
  named 'transactionBody'" (or `ERR_MODULE_NOT_FOUND`), because it re-exported `transactionBody` and
  `transactionSchemaVersion` from `@tari-project/ootle-ts-bindings`, which Node cannot load as an ES
  module. Both helpers are now defined in this package, with the same signatures. Bundled (browser)
  builds were not affected.

## 0.19.0

### BREAKING — Tari Ootle 0.55 (transaction schema V2)

Targets Tari Ootle 0.55.0 (`ootle-ts-bindings` 1.66, `ootle-wasm` 0.55.0, `ootle-wasm-bor` 0.55.0,
`indexer-client` 1.14, `wallet_jrpc_client` 1.29). Signed transactions are now schema V2: every
authorization commits to the whole authorizer set (the public key of every authorizer), and the
mempool rejects authorizations that are not in ascending key order.

- `Signer.signTransaction(tx, sealPublicKey, authorizers)` takes the full authorizer set, and
  `Signer.addStealthSignature`'s `ctx` carries it as `authorizers`. Custom signers must pass it
  to the WASM functions (`encodeAuthorizerSet(authorizers)`).
- New optional `Signer.getAuthorizerPublicKeys()` for a signer that authorizes with keys other than
  `getPublicKey()`.
- `signTransaction(signers, tx)` collects the set from every signer before any of them signs, and
  seals the signatures in ascending key order. It throws `SignerError` when the signatures are not
  exactly one per authorizer key.
- `OotleWallet.authorizeTransaction` takes the authorizer set; `authorizeTransactionAll` defaults it
  to every registered provider's key.
- `signTransaction` now returns a `{ V2: ... }` transaction. Read it with `transactionBody` (now
  re-exported, with `transactionSchemaVersion`) instead of `.V1`.
- Stealth: the authorizer reads each input's one-time spend public key from the UTXO's spend
  authorization (`ParsedUtxo.auth`). An external co-signer of a stealth transfer must be declared
  with `AuthorizedTransfer.addAuthorizer(publicKey)` before signing; `getAuthorizerPublicKeys()`
  returns the set it signs over.
- `WalletDaemonSigner.signTransaction` forwards the set as `authorizers`.

### Added

- New exports `canonicalAuthorizers`, `encodeAuthorizerSet` and `collectAuthorizers`.
- `TransactionBuilder.setComponentAccessRules` and `setComponentOwnerRule` for the new
  `SetComponentAccessRules` / `SetComponentOwnerRule` instructions (0.55).

## 0.18.0

### Added

- `estimatedFee(receipt)` returns the fee to submit a dry-run transaction at: the dry run's charge
  plus `FEE_ESTIMATE_ALLOWANCE` (12 µTari), matching the engine's `FeeReceipt::required_fees` and the
  Rust, Go and wallet-daemon clients. Submitting at the raw charge leaves no margin for the metering
  drift a different fee causes, and an underpaid transaction is rejected outright.
- `feesCharged(receipt)` returns the raw charge (the sum of the cost breakdown).

## 0.17.0

### Changed

- Targets Tari Ootle 0.53.5 (`ootle-wasm` 0.53.5, `ootle-wasm-bor` 0.53.5), which picks up upstream
  CBOR decoding fixes (max decode depth, enum/type deserialization). No API changes.

## 0.16.0

### Changed

- Targets Tari Ootle 0.53.3 (`ootle-wasm` 0.53.3, `ootle-wasm-bor` 0.53.3), whose `FeeBreakdown`
  decoding keeps rows in wire order instead of rejecting receipts with out-of-order fee sources.

## 0.15.0

### BREAKING — Tari Ootle 0.53

Targets Tari Ootle 0.53.0 (`ootle-ts-bindings` 1.65, `ootle-wasm` 0.53.0, `ootle-wasm-bor` 0.53.0).
A pre-0.53 SDK cannot decode definitions of templates built with `tari_template_lib` 0.40.

- `TransactionBuilder.claimBurn(claim)` drops its `outputData` argument; `ClaimBurnOutputData` is
  gone from the bindings (0.52).
- Template definition `Type` gains `WellKnown` (`WellKnownType`) for `tari_template_lib` types such as
  `Bucket` and `Amount` (0.53).

## 0.14.0

### BREAKING — Tari Ootle 0.50 (protocol V1)

Targets Tari Ootle 0.50.0 (`ootle-ts-bindings` 1.63, `ootle-wasm` 0.50.0, `ootle-wasm-bor` 0.50.0).

- Template definitions are now `TemplateDef.V2` (`TemplateDefV2`). Each function carries a `kind`
  (`"Function"`, `{ Method: "Ref" | "RefMut" }` or `{ Migration: { from } }`) in place of `is_mut` /
  `is_migration`.
- `AbortReason` gains `InputLoadTooLarge`.

## 0.13.0

### Added

- `ExternalKeySigner`: a `Signer` for a key held outside JavaScript (an HSM, an MPC vault, a hardware
  wallet). The caller's `sign(hash)` returns a 64-byte sr25519 signature, which the SDK verifies with
  `attachTransactionSignature` before using it; a bad signature, or an error from `sign`
  itself, throws `SignerError`.

## 0.12.0

### BREAKING — Tari Ootle 0.49 (testnet reset)

Targets Tari Ootle 0.49.1 (`ootle-ts-bindings` 1.62, `ootle-wasm` 0.49.1, `indexer-client` 1.13,
`wallet_jrpc_client` 1.28). Transactions from earlier SDKs are not accepted by a 0.49 network, nor the
reverse.

- **sr25519 signatures.** `TransactionSignature.signature` is a 64-byte sr25519 signature (hex), not a
  `{ public_nonce, signature }` Schnorr pair. `buildTransactionSignature(publicKey, signature)` takes the
  64 bytes.
- **Main signer.** `UnsignedTransactionV1.is_seal_signer_authorized` is replaced by `main_signer`.
  `TransactionBuilder` defaults it to `"None"` and gains `withMainSigner`. `signTransaction` replaces
  `"None"` with the first signer's key via the new `resolveMainSigner`, which is what the engine used to do.
  Every signature covers the main signer, so a co-signer must sign after it is settled.
- **The indexer serves values CBOR-encoded.** `upSubstateValue` decodes, and the new `decodeSubstateValue`,
  `decodeExecuteResult`, `decodeTransactionReceipt`, `decodeEvent`, `decodeResource` and `decodeUtxo`
  (backed by the new `@tari-project/ootle-wasm-bor` dependency) decode the rest, e.g. a
  `fetchSubstates` entry's `value` or a finalized result's `execution_result`. `classifyOutcome` decodes
  `execution_result` itself.
- **Stealth spend keys derive from the view key** (`c = H(network || v·R)`).
  `StealthCryptoProvider.stealthDhSecret` / `SignerStealthCrypto.stealthDhSecret` take the view secret, and
  `Signer.addStealthSignature` receives it as `ctx.viewSecret`.

### Added

- `TransactionBuilder.authorizeProof`, `dropProofAuthorization` and `withAuthorizedProof`: a proof now
  authorizes only inside a window the caller opens, and the window lends one hop.

### BREAKING — stealth API replaced

The placeholder stealth API has been **replaced** with a real, WASM-backed
confidential-transfer implementation. This is the single breaking change in the
stealth port and is acceptable at `0.1.0`: the previous stub API never produced a
valid on-chain transfer (it emitted a non-existent `deposit_stealth` `CallMethod`
with hand-stringified JSON), so no working code depended on it.

**Removed** (deleted stub interfaces/types — they had no functioning implementation):

- `StealthOutput`, `StealthOutputStatementFactory`, `InputDecryptor`, `StealthSigner`
- `OutputMaskProvider`, `DiffieHellmanKdfKeyProvider`, `WalletKeyProvider`
- the old `StealthTransfer` builder shape (`.from().to().build()`) and its
  `StealthTransferSpec` / `StealthTransferStatement` shapes

`OotleWallet.registerKeyProvider` / `getKeyProvider` now constrain providers to
`Signer` (the real requirement) instead of `WalletKeyProvider & Signer`. Stealth
capabilities are optional methods on `Signer` (`getViewSecret`, `addStealthSignature`).

**Added** (the new public stealth surface, exported from the package root):

- Builder + authorizer: `StealthTransfer`, `WalletStealthAuthorizer`,
  `patchStealthStatement`, `StealthTransferSpec`, `StealthTransferState`,
  `WalletStealthAuthorizerOptions`
- Crypto seam: `StealthCryptoProvider`, `WasmStealthCrypto`, `signBalanceProof`
- Domain types: `Mask`, `EncryptedData`, `createOutput`, `Output`, `OutputInit`,
  `DecryptedData`, `StealthInput`, `BalanceProofSignature`, `StealthInputsStatement`,
  `StealthOutputsStatement`, `StealthTransferStatement`, `compactJson`
- Receive / provider helpers: `decryptOwnedUtxo`, `decryptInputData`,
  `generateOutputsStatement`, `parseSubstateUtxo`, `commitmentOf`,
  `stealthUtxoSubstateId`, `ParsedUtxo`, `DecryptInputOptions`

The new send flow is **build → prepare → authorize/sign → seal + watch**; see the
[Stealth Transfers guide](../../docs/src/content/docs/advanced/stealth-transfers.md).
