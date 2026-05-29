//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Shared scaffolding for the runnable ootle Node examples.
 *
 * Every helper targets a fresh LocalNet identity, so the examples are
 * self-contained: point them at a reachable indexer and run, no
 * pre-existing wallets or accounts required.
 */

export {
  DEFAULT_FAUCET_FEE,
  FAUCET_COMPONENT_ADDRESS,
  NETWORK,
  TARI_RESOURCE,
  amountLiteralHex,
  firstNewSubstate,
  resourceAddressLiteralHex,
  tari,
  wait,
} from "@tari-project/example-common";
export { faucetComponentAddress, indexerUrl } from "./env.js";
export type { NewRecipient, NewWallet } from "./wallet.js";
export { newRecipient, newWallet } from "./wallet.js";
export { appendPublicTransferToNew } from "./builder.js";
export type { DryRunResult } from "./submission.js";
export { classifyDryRun, dryRun, runScript, signAndSubmit } from "./submission.js";
export { getAccountBalance, getAccountBalances } from "./account.js";
export type { FaucetAndWaitResult, FaucetOptions } from "./faucet.js";
export { faucet, faucetAndWait } from "./faucet.js";
