//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { FeeReceipt } from "@tari-project/ootle-ts-bindings";

/**
 * µTari a dry-run fee estimate carries on top of what the dry run was charged.
 *
 * Mirrors `tari_engine_types::fees::FEE_ESTIMATE_ALLOWANCE`: the most a real run of the same
 * transaction can cost over its dry run when built at a different fee.
 */
export const FEE_ESTIMATE_ALLOWANCE = 12n;

/**
 * The fee a receipt was charged (µTari): the sum of its cost breakdown, as the engine's
 * `FeeReceipt::total_fees_charged` computes it.
 *
 * For a dry run this is what the run cost, not a fee to submit at: use {@link estimatedFee} for that.
 */
export function feesCharged(receipt: Pick<FeeReceipt, "cost_breakdown">): bigint {
  let total = 0n;
  for (const value of Object.values(receipt.cost_breakdown.breakdown)) {
    // Receipts decoded from JSON carry numbers despite the bindings' `bigint` type.
    if (value !== undefined) total += BigInt(value);
  }
  return total;
}

/**
 * The fee (µTari) to submit a dry-run transaction at: {@link feesCharged} plus
 * {@link FEE_ESTIMATE_ALLOWANCE}, matching the engine's `FeeReceipt::required_fees`.
 *
 * The fee is itself an input to what a transaction is charged, so the real run of a transaction
 * built at a different fee than its dry run meters slightly differently; the allowance covers that
 * drift. It does not cover a different transaction: re-estimate after changing the inputs or
 * outputs.
 */
export function estimatedFee(receipt: Pick<FeeReceipt, "cost_breakdown">): bigint {
  return feesCharged(receipt) + FEE_ESTIMATE_ALLOWANCE;
}
