//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Whether an indexer error means "the substate does not exist": a 404 status, or a message that says
 * "not found" or contains a standalone 404 (so a hex id such as `component_…a404…` does not match).
 */
export function isNotFoundError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "status" in err && (err as { status?: unknown }).status === 404) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /not found/i.test(message) || /\b404\b/.test(message);
}
