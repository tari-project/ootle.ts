//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Shared scaffolding for the runnable ootle examples (Node + browser).
 *
 * Runtime-agnostic helpers only — no `process.env`, no DOM, no React. Both
 * the Node scripts (`examples/node/`) and the browser demo
 * (`examples/stealth-wallet/`) import from here.
 */

export {
  DEFAULT_FAUCET_FEE,
  DEFAULT_STEALTH_FAUCET_FEE,
  FAUCET_COMPONENT_ADDRESS,
  NETWORK,
  TARI_RESOURCE,
  tari,
} from "./constants.ts";
export { amountLiteralHex, resourceAddressLiteralHex } from "./literal.ts";
export { firstNewSubstate, wait } from "./wait.ts";
