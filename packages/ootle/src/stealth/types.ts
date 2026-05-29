//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Stealth domain types — pure data layer (no WASM, no network).
//
// Split for cohesion: `primitives.ts` holds the leaf value types (Mask,
// EncryptedData, DecryptedData, Output); `statements.ts` holds the statement
// carriers and the TS-assembled transfer envelope. This file re-exports both so
// callers/tests have a single `./stealth/types.js` import point, mirroring the
// design doc's `types.ts`.

export {
  Mask,
  EncryptedData,
  createOutput,
  SCALAR_LENGTH,
  DEFAULT_PAY_TO,
  type DecryptedData,
  type Output,
  type OutputInit,
} from "./primitives";

export {
  StealthInput,
  BalanceProofSignature,
  StealthInputsStatement,
  StealthOutputsStatement,
  StealthTransferStatement,
  type StealthInputJson,
  type BalanceProofSignatureJson,
  type StealthTransferStatementJson,
} from "./statements";
