//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { ComponentAddress } from "@tari-project/ootle-ts-bindings";
import { defaultIndexerUrl } from "@tari-project/ootle";
import { FAUCET_COMPONENT_ADDRESS, NETWORK } from "@tari-project/example-common";

/**
 * Indexer URL from `OOTLE_INDEXER_URL` or the {@link NETWORK} default
 * (`http://localhost:12500` for LocalNet).
 */
export function indexerUrl(): string {
  return process.env.OOTLE_INDEXER_URL || defaultIndexerUrl(NETWORK);
}

/**
 * Optional override for the LocalNet faucet component address. Falls back to the
 * well-known {@link FAUCET_COMPONENT_ADDRESS}.
 */
export function faucetComponentAddress(): ComponentAddress {
  return process.env.OOTLE_FAUCET_ADDRESS || FAUCET_COMPONENT_ADDRESS;
}
