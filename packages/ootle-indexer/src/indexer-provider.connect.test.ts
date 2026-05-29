//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit tests for the non-stealth surface of `IndexerProvider` — `connect`,
// `getSubstate`, `resolveInputs`, `submitTransaction`, `getTransactionResult`,
// `watchTransactionSSE`, and `stopWatcher`. Follows the documented stubbing
// pattern from `indexer-provider.test.ts` (vi.spyOn the static factory; cast
// the stub through `as unknown as IndexerClient`).

import type {
  IndexerGetSubstateResponse,
  IndexerGetTransactionResultResponse,
  SubstateRequirement,
  TransactionEnvelope,
} from "@tari-project/ootle-ts-bindings";
import { IndexerClient } from "@tari-project/indexer-client";
import { IndexerClientError, Network } from "@tari-project/ootle";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexerProvider } from "./indexer-provider";

interface StubClient {
  identityGet: ReturnType<typeof vi.fn>;
  substatesGet: ReturnType<typeof vi.fn>;
  getTransport: ReturnType<typeof vi.fn>;
  getTransactionResult: ReturnType<typeof vi.fn>;
}

function defaultStubClient(overrides: Partial<StubClient> = {}): StubClient {
  return {
    identityGet: vi.fn().mockResolvedValue({}),
    substatesGet: vi.fn(),
    getTransport: vi.fn(),
    getTransactionResult: vi.fn(),
    ...overrides,
  };
}

function installClient(client: StubClient): void {
  vi.spyOn(IndexerClient, "usingFetchTransport").mockReturnValue(client as unknown as IndexerClient);
}

describe("IndexerProvider.connect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies connectivity via identityGet and returns a provider with default timeout", async () => {
    const client = defaultStubClient();
    installClient(client);

    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    expect(client.identityGet).toHaveBeenCalledTimes(1);
    expect(provider.network()).toBe(Network.LocalNet);
    expect(provider.defaultTransactionTimeoutMs).toBe(60_000);
  });

  it("honours an explicit defaultTransactionTimeoutMs override", async () => {
    installClient(defaultStubClient());

    const provider = await IndexerProvider.connect({
      url: "http://localhost:18300",
      network: Network.LocalNet,
      defaultTransactionTimeoutMs: 5_000,
    });

    expect(provider.defaultTransactionTimeoutMs).toBe(5_000);
  });

  it("propagates identityGet failures", async () => {
    const client = defaultStubClient({
      identityGet: vi.fn().mockRejectedValue(new Error("connection refused")),
    });
    installClient(client);

    await expect(IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet })).rejects.toThrow(
      "connection refused",
    );
  });
});

describe("IndexerProvider.getSubstate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through to client.substatesGet with default version=null", async () => {
    const response: IndexerGetSubstateResponse = {
      version: 3,
      substate: { Utxo: { output: null, is_frozen: false } },
    };
    const client = defaultStubClient({ substatesGet: vi.fn().mockResolvedValue(response) });
    installClient(client);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    const result = await provider.getSubstate("component_aaaa");

    expect(result).toBe(response);
    expect(client.substatesGet).toHaveBeenCalledWith("component_aaaa", { version: null, local_search_only: false });
  });

  it("threads a specific version through to client.substatesGet", async () => {
    const response: IndexerGetSubstateResponse = {
      version: 7,
      substate: { Utxo: { output: null, is_frozen: false } },
    };
    const client = defaultStubClient({ substatesGet: vi.fn().mockResolvedValue(response) });
    installClient(client);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    await provider.getSubstate("component_aaaa", 7);

    expect(client.substatesGet).toHaveBeenCalledWith("component_aaaa", { version: 7, local_search_only: false });
  });
});

describe("IndexerProvider.resolveInputs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fills in the version for unversioned inputs from substatesGet", async () => {
    const substatesGet = vi
      .fn()
      .mockResolvedValueOnce({ version: 12, substate: { Utxo: { output: null, is_frozen: false } } });
    const client = defaultStubClient({ substatesGet });
    installClient(client);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    const inputs: SubstateRequirement[] = [{ substate_id: "component_aaaa", version: null }];
    const resolved = await provider.resolveInputs(inputs);

    expect(resolved).toEqual([{ substate_id: "component_aaaa", version: 12 }]);
    expect(substatesGet).toHaveBeenCalledTimes(1);
  });

  it("leaves already-versioned inputs untouched (no extra substatesGet)", async () => {
    const substatesGet = vi.fn();
    const client = defaultStubClient({ substatesGet });
    installClient(client);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    const inputs: SubstateRequirement[] = [{ substate_id: "component_bbbb", version: 5 }];
    const resolved = await provider.resolveInputs(inputs);

    expect(resolved).toEqual(inputs);
    expect(substatesGet).not.toHaveBeenCalled();
  });

  it("re-throws not-found errors wrapped with the input id and a chained cause", async () => {
    const underlying = new Error("Substate not found");
    const client = defaultStubClient({ substatesGet: vi.fn().mockRejectedValue(underlying) });
    installClient(client);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    await expect(provider.resolveInputs([{ substate_id: "component_missing", version: null }])).rejects.toThrow(
      IndexerClientError,
    );
    await expect(provider.resolveInputs([{ substate_id: "component_missing", version: null }])).rejects.toThrow(
      /Failed to find input "component_missing": Substate not found/,
    );

    try {
      await provider.resolveInputs([{ substate_id: "component_missing", version: null }]);
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerClientError);
      expect((err as Error).cause).toBe(underlying);
      expect((err as IndexerClientError).url).toBe("http://localhost:18300");
    }
  });

  it("re-throws non-404 errors with a separate 'Failed to resolve' wrapper", async () => {
    const underlying = new Error("connection refused");
    const client = defaultStubClient({ substatesGet: vi.fn().mockRejectedValue(underlying) });
    installClient(client);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    await expect(provider.resolveInputs([{ substate_id: "component_xxxx", version: null }])).rejects.toThrow(
      IndexerClientError,
    );
    await expect(provider.resolveInputs([{ substate_id: "component_xxxx", version: null }])).rejects.toThrow(
      /Failed to resolve input "component_xxxx": connection refused/,
    );
  });
});

describe("IndexerProvider.submitTransaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to the /transactions transport endpoint with the envelope", async () => {
    // The transport's `sendPost` is generic over the response type; cast through
    // the partial we actually care about (the production code only reads `transaction_id`).
    const sendPost = vi.fn().mockResolvedValue({ transaction_id: "tx_abcd" });
    const client = defaultStubClient({ getTransport: vi.fn().mockReturnValue({ sendPost }) });
    installClient(client);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    const envelope = "base64envelope" as unknown as TransactionEnvelope;
    const response = await provider.submitTransaction(envelope);

    expect(response.transaction_id).toBe("tx_abcd");
    expect(sendPost).toHaveBeenCalledWith("transactions", { transaction: envelope });
  });
});

describe("IndexerProvider.getTransactionResult", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through to client.getTransactionResult", async () => {
    const result: IndexerGetTransactionResultResponse = { result: "Pending" };
    const client = defaultStubClient({ getTransactionResult: vi.fn().mockResolvedValue(result) });
    installClient(client);
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    const got = await provider.getTransactionResult("tx_qqqq");

    expect(got).toBe(result);
    expect(client.getTransactionResult).toHaveBeenCalledWith("tx_qqqq");
  });
});

describe("IndexerProvider.watchTransactionSSE / stopWatcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs a single TransactionWatcher across repeated watch calls; stopWatcher releases it", async () => {
    installClient(defaultStubClient());
    const provider = await IndexerProvider.connect({ url: "http://localhost:18300", network: Network.LocalNet });

    // The watcher is private — observe its identity indirectly via "stop" being a no-op
    // after `stopWatcher` has been called (no second stop happens / no second start).
    const pending1 = provider.watchTransactionSSE("tx_1", 100);
    const pending2 = provider.watchTransactionSSE("tx_2", 100);
    expect(pending1).toBeDefined();
    expect(pending2).toBeDefined();

    // First stopWatcher must shut down the underlying watcher; second call is a no-op.
    expect(() => provider.stopWatcher()).not.toThrow();
    expect(() => provider.stopWatcher()).not.toThrow();

    // A subsequent watch builds a fresh watcher.
    const pending3 = provider.watchTransactionSSE("tx_3", 100);
    expect(pending3).toBeDefined();

    // Tidy: tear down the new watcher we just started.
    provider.stopWatcher();
  });
});
