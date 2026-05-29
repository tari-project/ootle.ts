//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only helpers for assembling minimal `UnsignedTransactionV1` shapes.
// Not re-exported from the package root; tests import via relative subpath.

import type { UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { TransactionBuilder } from "../builder";
import type { Network } from "../network";
import { TEST_NETWORK } from "./fixtures";

/**
 * The smallest valid `UnsignedTransactionV1` — a single `DropAllProofsInWorkspace`
 * instruction. Useful when a test only cares about the sign/seal flow, not the
 * instruction set itself.
 */
export function trivialUnsignedTx(network: Network = TEST_NETWORK): UnsignedTransactionV1 {
  return TransactionBuilder.new(network).dropAllProofsInWorkspace().buildUnsignedTransaction();
}
