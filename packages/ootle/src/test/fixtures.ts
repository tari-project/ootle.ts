//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only deterministic fixtures. All values are explicit hex constants —
// never randomised — so any test asserting a derived public key, signature,
// or hash re-runs identically.
//
// Not re-exported from the package root; tests import via relative subpath.

import { fromHexStr } from "../helpers/hex";
import { Network } from "../network";

/**
 * A fixed 32-byte scalar — useful as a "secret key" or "view key" in tests where
 * the actual key material does not matter.
 */
export const ALICE_SECRET = fromHexStr("a1".repeat(32));
export const ALICE_PUBLIC = fromHexStr("a2".repeat(32));
export const BOB_SECRET = fromHexStr("b1".repeat(32));
export const BOB_PUBLIC = fromHexStr("b2".repeat(32));

/**
 * A fixed 32-byte seal keypair — useful when a test wants the same seal public
 * key flowing through multiple signatures (the stealth-spend authorizer tests
 * already need this).
 */
export const SEAL_SECRET = fromHexStr("0e".repeat(32));
export const SEAL_PUBLIC = fromHexStr("0f".repeat(32));

/** The network byte every test uses unless it explicitly varies it. */
export const TEST_NETWORK = Network.LocalNet;

/**
 * The `max_epoch` every test uses unless it explicitly varies it. `max_epoch` is
 * mandatory on `UnsignedTransactionV1`, so every builder needs one; the value only
 * matters to tests that assert on the validity window itself.
 */
export const TEST_MAX_EPOCH = 100;

/**
 * A syntactically-valid resource address (the canonical XTR/TARI resource), and
 * the LocalNet faucet component address. Re-exported here so a single import
 * line in a test file covers both keys and on-chain addresses.
 */
export { TARI_RESOURCE_ADDRESS as XTR_RESOURCE, XTR_FAUCET_COMPONENT_ADDRESS } from "../helpers/constants";

/** A syntactically-valid component address suitable as a `from`/`to` account in tests. */
export const TEST_ACCOUNT_ADDRESS = "component_" + "b".repeat(64);

/** A syntactically-valid destination account address for stealth-transfer tests. */
export const TEST_DESTINATION_ADDRESS = "account_dest_address";
