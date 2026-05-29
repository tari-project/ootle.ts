//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only deterministic fixtures for `@tari-project/ootle-indexer` unit tests.
//
// All values are explicit hex constants — never `Math.random()`. Promoted from
// the inline constants in `indexer-provider.test.ts` so subsequent indexer
// tests share a single source of truth for the resource/commitment shapes the
// substate-id composer expects.
//
// This module is TEST-ONLY: it is deliberately NOT re-exported from the
// package root (`packages/ootle-indexer/src/index.ts`), so it never reaches
// external consumers. Test files import these constants by relative subpath
// (`import { TEST_RESOURCE_ADDRESS } from "./test/fixtures"`).

import { fromHexStr } from "@tari-project/ootle";

/** A fixed 64-char hex blob standing in as a resource id payload. */
export const TEST_RESOURCE_HEX = "a".repeat(64);
/** The full `resource_<hex>` address — what callers actually pass into the provider. */
export const TEST_RESOURCE_ADDRESS = `resource_${TEST_RESOURCE_HEX}`;

/** A fixed 64-char hex commitment (32 bytes when decoded). */
export const TEST_COMMITMENT_HEX = "0123456789abcdef".repeat(4);
/** Raw 32 bytes of {@link TEST_COMMITMENT_HEX}. */
export const TEST_COMMITMENT = fromHexStr(TEST_COMMITMENT_HEX);

/** The substate id `getStealthUtxo` is expected to compose from the constants above. */
export const TEST_EXPECTED_STEALTH_UTXO_ID = `utxo_${TEST_RESOURCE_HEX}_${TEST_COMMITMENT_HEX}`;
