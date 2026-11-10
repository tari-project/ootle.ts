# Changelog

All notable changes to `@tari-project/ootle` are documented here.

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
