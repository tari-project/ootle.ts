//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Stubs `IndexerClient` to verify `IndexerProvider.getStealthUtxo` composes
// the correct `utxo_{resourceHex}_{commitmentHex}` substate id and maps a
// not-found error to `null`.

import type { IndexerGetSubstateResponse, SubstateId } from "@tari-project/ootle-ts-bindings";
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
      // An opaque stand-in for the CBOR value the indexer serves; these tests only pass it through.
      state: { up: { substate: "AAEC" } },
      verified: true,
    };
    const substatesGet = vi.fn().mockResolvedValue(response);
    const { provider, client } = await connectWithStub(substatesGet);

    const result = await provider.getStealthUtxo(RESOURCE_ADDRESS, COMMITMENT);

    expect(result).toBe(response);
    expect(client.substatesGet).toHaveBeenCalledTimes(1);
    expect(client.substatesGet).toHaveBeenCalledWith(EXPECTED_ID, {
      version: null,
      local_search_only: false,
      include_proof: false,
    });
  });

  it("accepts a bare resource hex (no resource_ prefix)", async () => {
    const substatesGet = vi
      .fn()
      .mockResolvedValue({ version: 0, state: { up: { substate: { Utxo: { output: null, is_frozen: false } } } } });
    const { provider, client } = await connectWithStub(substatesGet);

    await provider.getStealthUtxo(RESOURCE_HEX, COMMITMENT);

    expect(client.substatesGet).toHaveBeenCalledWith(EXPECTED_ID, {
      version: null,
      local_search_only: false,
      include_proof: false,
    });
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

describe("IndexerProvider.getCurrentEpoch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the epoch manager's current epoch", async () => {
    const epochManagerStats = vi.fn().mockResolvedValue({ current_epoch: 1234 });
    const client = {
      identityGet: vi.fn().mockResolvedValue({}),
      epochManagerStats,
    };
    vi.spyOn(IndexerClient, "usingFetchTransport").mockReturnValue(client as unknown as IndexerClient);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    await expect(provider.getCurrentEpoch()).resolves.toBe(1234);
    expect(epochManagerStats).toHaveBeenCalledOnce();
  });
});

describe("IndexerProvider.fetchSubstates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty maps without calling the client when requests is empty", async () => {
    const fetchSubstates = vi.fn();
    const client = {
      identityGet: vi.fn().mockResolvedValue({}),
      fetchSubstates,
    };
    vi.spyOn(IndexerClient, "usingFetchTransport").mockReturnValue(client as unknown as IndexerClient);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    await expect(provider.fetchSubstates([])).resolves.toEqual({
      substates: {},
      proofs: {},
      commit_proofs: {},
    });
    expect(fetchSubstates).not.toHaveBeenCalled();
  });

  it("chunks requests above MAX_SUBSTATES_PER_FETCH (20) and merges responses", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `component_${String(i).padStart(64, "0")}` as SubstateId);
    const fetchSubstates = vi.fn().mockImplementation(async ({ requests }: { requests: SubstateId[] }) => {
      const substates: Record<string, unknown> = {};
      const proofs: Record<string, unknown> = {};
      for (const id of requests) {
        substates[id] = { version: 0, value: {} };
        proofs[id] = { block_id: `block_${requests.length}` };
      }
      return {
        substates,
        proofs,
        commit_proofs: { [`block_${requests.length}`]: `proof_${requests.length}` },
      };
    });
    const client = {
      identityGet: vi.fn().mockResolvedValue({}),
      fetchSubstates,
    };
    vi.spyOn(IndexerClient, "usingFetchTransport").mockReturnValue(client as unknown as IndexerClient);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    const res = await provider.fetchSubstates(ids);
    expect(fetchSubstates).toHaveBeenCalledTimes(3);
    expect(fetchSubstates.mock.calls.map((c) => c[0].requests)).toEqual([
      ids.slice(0, 20),
      ids.slice(20, 40),
      ids.slice(40),
    ]);
    expect(Object.keys(res.substates)).toHaveLength(45);
    expect(Object.keys(res.proofs)).toHaveLength(45);
    expect(res.commit_proofs).toEqual({
      block_20: "proof_20",
      block_5: "proof_5",
    });
  });
});
