//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { IndexerGetTransactionResultResponse, SubstateId } from "@tari-project/ootle-ts-bindings";
import type { TransactionOutcome } from "@tari-project/ootle";
import type { PendingTransaction } from "@tari-project/ootle-indexer";

/**
 * Await finality and log the verdict. Throws on non-Commit / timeout, with the
 * full indexer receipt attached so script logs surface the engine-side detail.
 */
export async function wait(label: string, pending: PendingTransaction): Promise<TransactionOutcome> {
  console.log(`  pending ${label}…`);
  try {
    const outcome = await pending.watch();
    console.log(`  finalized ${label}: Commit`);
    return outcome;
  } catch (err) {
    const debugReceipt = await pending.getReceipt().catch(() => null);
    const detail = debugReceipt ? `\n  full receipt:\n${JSON.stringify(debugReceipt, null, 2)}` : "";
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  finalized ${label}: ${message}`);
    throw new Error(`${label}: ${message}${detail}`, { cause: err });
  }
}

/**
 * Returns the first up-substate id in `receipt`'s execution result whose
 * string form starts with `prefix` (e.g. `"component_"`, `"vault_"`, `"utxo_"`).
 *
 * Handles both `Accept` and `AcceptFeeRejectRest` arms of the underlying
 * `TransactionResult` (the latter still carries a diff). Returns `null` for
 * `Reject` and for `Pending` receipts.
 *
 * Optional `exclude` filters out ids the caller already knows about — useful
 * when scanning for a new component while ignoring the freshly-created account.
 */
export function firstNewSubstate(
  receipt: IndexerGetTransactionResultResponse,
  prefix: string,
  options: { exclude?: ReadonlySet<string> } = {},
): SubstateId | null {
  const excluded = options.exclude;
  const result = receipt.result;
  if (result === "Pending") return null;
  if (!("Finalized" in result)) return null;

  const executionResult = result.Finalized.execution_result;
  if (!executionResult) return null;

  const txResult = executionResult.finalize.result;
  let diff;
  if (typeof txResult === "object" && "Accept" in txResult) {
    diff = txResult.Accept;
  } else if (typeof txResult === "object" && "AcceptFeeRejectRest" in txResult) {
    diff = txResult.AcceptFeeRejectRest[0];
  } else {
    return null;
  }

  for (const [substateId] of diff.up_substates) {
    if (substateId.startsWith(prefix) && !(excluded && excluded.has(substateId))) {
      return substateId;
    }
  }
  return null;
}
