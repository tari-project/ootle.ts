//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Stubs `IndexerClient` to verify `IndexerProvider.getStealthUtxo` composes
// the correct `utxo_{resourceHex}_{commitmentHex}` substate id and maps a
// not-found error to `null`.

import type { IndexerGetSubstateResponse } from "@tari-project/ootle-ts-bindings";
import { IndexerClient } from "@tari-project/indexer-client";
import { Network } from "@tari-project/ootle";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexerProvider } from "./indexer-provider";
import {
  TEST_COMMITMENT as COMMITMENT,
  TEST_EXPECTED_STEALTH_UTXO_ID as EXPECTED_ID,
  TEST_RESOURCE_ADDRESS as RESOURCE_ADDRESS,
  TEST_RESOURCE_HEX as RESOURCE_HEX,
} from "./test/fixtures";

interface StubClient {
  identityGet: ReturnType<typeof vi.fn>;
  substatesGet: ReturnType<typeof vi.fn>;
}

/**
 * Install a stub `IndexerClient` (via the `usingFetchTransport` factory `connect` calls)
 * and return a connected `IndexerProvider` plus the stub for assertions.
 */
async function connectWithStub(substatesGet: StubClient["substatesGet"]): Promise<{
  provider: IndexerProvider;
  client: StubClient;
}> {
  const client: StubClient = {
    identityGet: vi.fn().mockResolvedValue({}),
    substatesGet,
  };
  vi.spyOn(IndexerClient, "usingFetchTransport").mockReturnValue(client as unknown as IndexerClient);
  const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });
  return { provider, client };
}

describe("IndexerProvider.getStealthUtxo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("composes the right substate id from resource address + commitment", async () => {
    const response: IndexerGetSubstateResponse = {
      version: 3,
      substate: { Utxo: { output: null, is_frozen: false } },
      verified: true,
    };
    const substatesGet = vi.fn().mockResolvedValue(response);
    const { provider, client } = await connectWithStub(substatesGet);

    const result = await provider.getStealthUtxo(RESOURCE_ADDRESS, COMMITMENT);

    expect(result).toBe(response);
    expect(client.substatesGet).toHaveBeenCalledTimes(1);
    expect(client.substatesGet).toHaveBeenCalledWith(EXPECTED_ID, { version: null, local_search_only: false });
  });

  it("accepts a bare resource hex (no resource_ prefix)", async () => {
    const substatesGet = vi
      .fn()
      .mockResolvedValue({ version: 0, substate: { Utxo: { output: null, is_frozen: false } } });
    const { provider, client } = await connectWithStub(substatesGet);

    await provider.getStealthUtxo(RESOURCE_HEX, COMMITMENT);

    expect(client.substatesGet).toHaveBeenCalledWith(EXPECTED_ID, { version: null, local_search_only: false });
  });

  it("maps a not-found error to null", async () => {
    const substatesGet = vi.fn().mockRejectedValue(new Error("Substate not found"));
    const { provider } = await connectWithStub(substatesGet);

    await expect(provider.getStealthUtxo(RESOURCE_ADDRESS, COMMITMENT)).resolves.toBeNull();
  });

  it("maps a 404 error to null", async () => {
    const substatesGet = vi.fn().mockRejectedValue(new Error("request failed with status 404"));
    const { provider } = await connectWithStub(substatesGet);

    await expect(provider.getStealthUtxo(RESOURCE_ADDRESS, COMMITMENT)).resolves.toBeNull();
  });

  it("re-throws non-not-found errors", async () => {
    const substatesGet = vi.fn().mockRejectedValue(new Error("connection refused"));
    const { provider } = await connectWithStub(substatesGet);

    await expect(provider.getStealthUtxo(RESOURCE_ADDRESS, COMMITMENT)).rejects.toThrow("connection refused");
  });
});
