//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only fake `Provider` implementation. Every method is a `vi.fn()` with
// sensible defaults: `network()` returns `TEST_NETWORK`, `resolveInputs` echoes
// the inputs back with `version: 0` for any unversioned entry.
//
// Not re-exported from the package root; tests import via relative subpath.

import { vi } from "vitest";
import type { SubstateRequirement } from "@tari-project/ootle-ts-bindings";
import type { Provider } from "../provider";
import { TEST_MAX_EPOCH, TEST_NETWORK } from "./fixtures";

/**
 * Construct a {@link Provider} test double. Every method is a `vi.fn()`;
 * pass `overrides` to vary behaviour per test.
 *
 * Defaults: `network()` returns `TEST_NETWORK`, `resolveInputs` echoes the
 * inputs back with `version: 0` filled in, `getSubstate` returns a vault-less
 * Component (so `StealthTransfer.prepare`'s vault walker has a sane no-op
 * fallback on the revealed-source path). All other methods are bare `vi.fn()`
 * and throw if invoked without an override.
 */
export function fakeProvider(overrides: Partial<Provider> = {}): Provider {
  const base: Provider = {
    network: () => TEST_NETWORK,
    getCurrentEpoch: vi.fn(async () => TEST_MAX_EPOCH - 10),
    resolveInputs: vi.fn(async (inputs: SubstateRequirement[]) =>
      inputs.map((i) => ({ ...i, version: i.version ?? 0 })),
    ),
    getSubstate: vi.fn(async () => ({
      address: "",
      version: 0,
      substate: { Component: { body: { state: {} } } },
      created_by_transaction: "",
    })),
    getStealthUtxo: vi.fn(),
    fetchSubstates: vi.fn(),
    getTemplateDefinition: vi.fn(),
    submitTransaction: vi.fn(),
    getTransactionResult: vi.fn(),
    listRecentTransactions: vi.fn(),
  } as unknown as Provider;
  return { ...base, ...overrides };
}
