//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Whether an indexer error means "the substate does not exist". An error that carries a numeric HTTP status
 * is classified by that status alone, so a 500 whose body happens to mention "404" or "not found" (for
 * example a hex id such as `component_…a404…`) is not mistaken for a missing substate. Errors without a
 * status fall back to a "not found" message.
 */
export function isNotFoundError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "status" in err && typeof err.status === "number") {
    return err.status === 404;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /not found/i.test(message);
}
