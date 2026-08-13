//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only stub for `IndexerClient`.
//
// Every test that constructs an `IndexerProvider` has to intercept the same seam:
// `IndexerProvider.connect` obtains its client from the static
// `IndexerClient.usingFetchTransport` factory, so tests stub that factory rather than
// the network. This was independently reimplemented in three test files; it lives here
// now so the stub shape stays in one place.
//
// This module is TEST-ONLY: it is deliberately NOT re-exported from the package root,
// so it never reaches external consumers. Test files import it by relative subpath
// (`import { installStubClient } from "./test/client-stub"`).

import { vi } from "vitest";
import { IndexerClient } from "@tari-project/indexer-client";

/**
 * The subset of `IndexerClient` the provider tests drive. Every method is a `vi.fn()`;
 * only `identityGet` has a default (it is what `connect` calls to verify connectivity).
 */
export interface StubClient {
  identityGet: ReturnType<typeof vi.fn>;
  substatesGet: ReturnType<typeof vi.fn>;
  getTransport: ReturnType<typeof vi.fn>;
  getTransactionResult: ReturnType<typeof vi.fn>;
  templatesListCached: ReturnType<typeof vi.fn>;
}

/** Build a {@link StubClient}; `overrides` replace individual methods. */
export function stubClient(overrides: Partial<StubClient> = {}): StubClient {
  return {
    identityGet: vi.fn().mockResolvedValue({}),
    substatesGet: vi.fn(),
    getTransport: vi.fn(),
    getTransactionResult: vi.fn(),
    templatesListCached: vi.fn(),
    ...overrides,
  };
}

/**
 * Point `IndexerClient.usingFetchTransport` at `client` for the duration of the test.
 *
 * Returns the spy so callers can assert on the URL the factory was handed — the only
 * observable output of `ProviderBuilder`'s URL-resolution logic.
 *
 * Callers are responsible for `vi.restoreAllMocks()` in an `afterEach`.
 */
export function installStubClient(client: StubClient = stubClient()) {
  return vi.spyOn(IndexerClient, "usingFetchTransport").mockReturnValue(client as unknown as IndexerClient);
}
