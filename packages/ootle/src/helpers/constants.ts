//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Well-known on-chain addresses for the Tari Ootle network.
 *
 * These are public, network-protocol-level identifiers (not credentials) — the
 * canonical TARI/XTR token resource and the LocalNet faucet component.
 */

/**
 * Native TARI (XTR) token resource address (object key `[1u8; 32]`). Used for
 * all native-token transfers and stealth confidential outputs.
 */
export const TARI_RESOURCE_ADDRESS = "resource_0101010101010101010101010101010101010101010101010101010101010101";

/**
 * On-chain XTR faucet component address (object key `[1, 2, 3, 0, …, 0]`).
 * LocalNet scripts call this via `FaucetInvokeBuilder` to claim revealed TARI funds.
 */
export const XTR_FAUCET_COMPONENT_ADDRESS =
  "component_0102030000000000000000000000000000000000000000000000000000000000";

/** Vault held by the XTR faucet (object key `[1, 2, 3, 0, …, 0, 1]`). */
export const XTR_FAUCET_VAULT_ADDRESS = "vault_0102030000000000000000000000000000000000000000000000000000000001";

/** Claim resource held by the XTR faucet (object key `[1, 2, 3, 0, …, 0, 2]`). */
export const XTR_FAUCET_CLAIM_RESOURCE_ADDRESS =
  "resource_0102030000000000000000000000000000000000000000000000000000000002";
