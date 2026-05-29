# Changelog

All notable changes to `@tari-project/ootle` are documented here.

## Unreleased

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
