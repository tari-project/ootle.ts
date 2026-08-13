//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit tests for `ProviderBuilder` — the fluent front door to `IndexerProvider`.
//
// The builder's whole job is turning accumulated setter state into one
// `IndexerProviderOptions` object, so the assertions here are about what reaches
// `IndexerClient.usingFetchTransport` (the URL) and what lands on the constructed
// provider (network, timeout). The interesting case is the URL fallback: with no
// `withUrl`, the builder must derive the URL from `defaultIndexerUrl(network)` —
// and it must do so using the network set at `connect()` time, not construction time.
//
// Uses the shared `test/client-stub` helper, which intercepts the
// `IndexerClient.usingFetchTransport` factory that `IndexerProvider.connect` calls.

import { Network, defaultIndexerUrl } from "@tari-project/ootle";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderBuilder } from "./provider-builder";
import { installStubClient, stubClient } from "./test/client-stub";

describe("ProviderBuilder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to LocalNet with its default indexer URL and a 60s transaction timeout", async () => {
    const factory = installStubClient();

    const provider = await ProviderBuilder.new().connect();

    expect(factory).toHaveBeenCalledExactlyOnceWith(defaultIndexerUrl(Network.LocalNet));
    expect(provider.network()).toBe(Network.LocalNet);
    expect(provider.defaultTransactionTimeoutMs).toBe(60_000);
  });

  it("derives the URL from the configured network when no URL is set", async () => {
    const factory = installStubClient();

    const provider = await ProviderBuilder.new().withNetwork(Network.Esmeralda).connect();

    expect(factory).toHaveBeenCalledExactlyOnceWith(defaultIndexerUrl(Network.Esmeralda));
    expect(defaultIndexerUrl(Network.Esmeralda)).not.toBe(defaultIndexerUrl(Network.LocalNet));
    expect(provider.network()).toBe(Network.Esmeralda);
  });

  it("prefers an explicit URL over the network default", async () => {
    const factory = installStubClient();

    const provider = await ProviderBuilder.new()
      .withNetwork(Network.Esmeralda)
      .withUrl("http://indexer.internal:18300")
      .connect();

    expect(factory).toHaveBeenCalledExactlyOnceWith("http://indexer.internal:18300");
    // The network is still threaded through even though it no longer drives the URL.
    expect(provider.network()).toBe(Network.Esmeralda);
  });

  it("threads withTransactionTimeoutMs onto the provider", async () => {
    installStubClient();

    const provider = await ProviderBuilder.new().withTransactionTimeoutMs(1_234).connect();

    expect(provider.defaultTransactionTimeoutMs).toBe(1_234);
  });

  it("applies the network set last, so ordering of setters does not matter", async () => {
    const factory = installStubClient();

    await ProviderBuilder.new().withNetwork(Network.Esmeralda).withNetwork(Network.LocalNet).connect();

    expect(factory).toHaveBeenCalledExactlyOnceWith(defaultIndexerUrl(Network.LocalNet));
  });

  it("returns `this` from every setter so calls chain", () => {
    const builder = ProviderBuilder.new();

    expect(builder.withNetwork(Network.LocalNet)).toBe(builder);
    expect(builder.withUrl("http://x")).toBe(builder);
    expect(builder.withTransactionTimeoutMs(1)).toBe(builder);
  });

  it("propagates a connectivity failure from IndexerProvider.connect", async () => {
    installStubClient(stubClient({ identityGet: vi.fn().mockRejectedValue(new Error("no route to host")) }));

    await expect(ProviderBuilder.new().connect()).rejects.toThrow();
  });
});
