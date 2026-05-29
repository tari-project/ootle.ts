//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { ComponentAddress } from "@tari-project/ootle-ts-bindings";
import { Network, TARI_RESOURCE_ADDRESS, XTR_FAUCET_COMPONENT_ADDRESS } from "@tari-project/ootle";

/** The network the example tier targets. LocalNet keeps the examples self-contained. */
export const NETWORK = Network.LocalNet;

/** Native TARI resource address. */
export const TARI_RESOURCE = TARI_RESOURCE_ADDRESS;

/** Default LocalNet faucet component address (well-known constant; not a credential). */
export const FAUCET_COMPONENT_ADDRESS: ComponentAddress = XTR_FAUCET_COMPONENT_ADDRESS;

/** Default max fee (µTari) for a faucet claim. */
export const DEFAULT_FAUCET_FEE = 500n;

/**
 * Default max fee (µTari) the faucet's stealth deposit pays out of the revealed
 * bucket. Higher than {@link DEFAULT_FAUCET_FEE} because stealth txs are a hair
 * more expensive at fee-estimation time and would otherwise reject with
 * `MaxFeeExceeded`.
 */
export const DEFAULT_STEALTH_FAUCET_FEE = 1_000n;

/** `amount` TARI expressed in µTari (1 TARI = 1_000_000 µTari). Always returns `bigint`. */
export function tari(amount: number | bigint): bigint {
  return BigInt(amount) * 1_000_000n;
}
