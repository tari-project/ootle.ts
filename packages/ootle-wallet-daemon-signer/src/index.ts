//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

export { WalletDaemonSigner } from "./wallet-daemon-signer";
export type { WalletDaemonSignerOptions } from "./wallet-daemon-signer";
export { authenticate } from "./auth";
export type { AuthOptions } from "./auth";
export { DaemonStealthFactory } from "./daemon-stealth-factory";
export type { DaemonStealthFactoryOptions } from "./daemon-stealth-factory";

// Re-export from @tari-project/wallet_jrpc_client so consumers don't need a direct dependency
export { WalletDaemonClient } from "@tari-project/wallet_jrpc_client";

// Re-export commonly used stealth types from bindings for convenience
export type {
  StealthTransferRequest,
  StealthTransferResponse,
  StealthUtxosListRequest,
  StealthUtxosListResponse,
  StealthUtxosDecryptValueRequest,
  StealthUtxosDecryptValueResponse,
  AccountsAssociateStealthResourceRequest,
  AccountsAssociateStealthResourceResponse,
  AccountsCreateStealthTransferStatementRequest,
  AccountsCreateStealthTransferStatementResponse,
} from "@tari-project/ootle-ts-bindings";
