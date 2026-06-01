//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

export { Network } from "./network";
export type { Signer, SignerStealthCrypto } from "./signer";
export type { Provider } from "./provider";
export { TransactionBuilder } from "./builder";
export type { TariFunctionDefinition, TariMethodDefinition, NamedArg, UnsignedTransactionWithBlobs } from "./builder";
export {
  buildTransactionSignature,
  generateSealKeypair,
  resolveTransaction,
  serializeUnsignedTx,
  signTransaction,
  sealTransaction,
  submitTransaction,
  watchTransaction,
  sendTransaction,
  sendDryRun,
  classifyOutcome,
} from "./transaction";
export type { SealKeypair, SignedTransaction } from "./transaction";
export type {
  Amount,
  WatchOptions,
  TransactionOutcome,
  CommitOutcome,
  ToAccountAddress,
  UnsignedTransactionV1,
  Transaction,
  TransactionV1,
  UnsealedTransactionV1,
  TransactionSignature,
  Instruction,
  InstructionArg,
  SubstateRequirement,
  SubstateId,
  TransactionEnvelope,
  IndexerSubmitTransactionRequest,
  IndexerSubmitTransactionResponse,
  IndexerGetSubstateRequest,
  IndexerGetSubstateResponse,
  IndexerGetTransactionResultResponse,
  IndexerTransactionFinalizedResult,
  GetSubstatesRequest,
  GetSubstatesResponse,
  GetTemplateDefinitionResponse,
  Decision,
  ExecuteResult,
  FinalizeResult,
  FinalizeOutcome,
} from "./types";
export * from "./helpers";
export { AccountInvokeBuilder, FaucetInvokeBuilder } from "./builtin-templates";
export { OotleWallet } from "./wallet";
export type { TransactionAuthorization } from "./wallet";

// Stealth (confidential) transfers — public surface of the internal `./stealth`
// module. Curated named re-exports keep test-only fakes and the on-chain
// instruction-encoding seam private.

// Send + spend: the transfer builder, the spend authorizer, statement patching.
export { StealthTransfer } from "./stealth/transfer";
export type { StealthTransferSpec, StealthTransferState } from "./stealth/transfer";
export { WalletStealthAuthorizer, AuthorizedTransfer, patchStealthStatement } from "./stealth/authorizer";
export type { WalletStealthAuthorizerOptions } from "./stealth/authorizer";
export { stealthTransferInstruction, isStealthTransferInstruction, statementAsWire } from "./stealth/instruction";
export type { StealthTransferInstruction, StealthTransferInstructionInit } from "./stealth/instruction";

// Crypto seam: the WASM-hiding interface, its real implementation, the balance-proof signer.
export type { StealthCryptoProvider } from "./stealth/crypto-provider";
export { WasmStealthCrypto } from "./stealth/wasm-crypto";
export { signBalanceProof } from "./stealth/balance-proof";

// Domain types (pure data layer).
export {
  Mask,
  EncryptedData,
  createOutput,
  StealthInput,
  BalanceProofSignature,
  StealthInputsStatement,
  StealthOutputsStatement,
  StealthTransferStatement,
} from "./stealth/types";
export type { DecryptedData, Output, OutputInit } from "./stealth/types";

// Receive + provider helpers: decrypt owned UTXOs, build statements, parse substates.
export { decryptOwnedUtxo, decryptInputData, generateOutputsStatement } from "./stealth/wallet-helpers";
export type { DecryptInputOptions } from "./stealth/wallet-helpers";
export { parseSubstateUtxo, commitmentOf, stealthUtxoSubstateId } from "./stealth/substate-parse";
export type { ParsedUtxo } from "./stealth/substate-parse";

// Typed error hierarchy. Every throw site in the SDK uses one of these classes;
// callers can `try/catch` on a structured type rather than parsing message strings.
export {
  OotleError,
  IndexerClientError,
  TransactionRejectedError,
  TransactionTimeoutError,
  WalletError,
  KeyProviderNotFoundError,
  DefaultSignerNotSetError,
  SignerError,
  CryptoBridgeError,
  InvalidArgumentError,
  OperationCancelledError,
  assertUnreachable,
} from "./errors";
