//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit tests for `resolveWantInputs`. Each case stubs the `IndexerClient` shape
// `want-input.ts` actually consumes (`substatesGet` for `SpecificSubstate`,
// `getTransport().sendGet` for `VaultForResource`), no real network.

import type { IndexerClient } from "@tari-project/indexer-client";
import { describe, expect, it, vi } from "vitest";
import { WalletError } from "@tari-project/ootle";
import { resolveWantInputs } from "./want-input";
import { TEST_RESOURCE_ADDRESS } from "./test/fixtures";

function makeClient(opts: {
  substatesGet?: ReturnType<typeof vi.fn>;
  sendGet?: ReturnType<typeof vi.fn>;
}): IndexerClient {
  return {
    substatesGet: opts.substatesGet ?? vi.fn(),
    getTransport: () => ({ sendGet: opts.sendGet ?? vi.fn() }),
  } as unknown as IndexerClient;
}

describe("resolveWantInputs — VaultForResource", () => {
  it("returns the SubstateRequirement of the matched vault component", async () => {
    // `template_address` is typed as `Hash32 | null` on the binding; the test feeds a
    // fixture string matching whatever the resolver compares against, which is what
    // the production code reads at runtime.
    const match = {
      substate_id: "vault_aaaa",
      template_address: TEST_RESOURCE_ADDRESS,
      version: 9,
      module_name: null,
      timestamp: "0",
    };
    const sendGet = vi.fn().mockResolvedValue({ substates: [match] });
    const client = makeClient({ sendGet });

    const result = await resolveWantInputs(client, [
      { type: "VaultForResource", resourceAddress: TEST_RESOURCE_ADDRESS },
    ]);

    expect(result).toEqual([{ substate_id: "vault_aaaa", version: 9 }]);
    expect(sendGet).toHaveBeenCalledWith("substates", {
      filter_by_template: TEST_RESOURCE_ADDRESS,
      filter_by_type: "Vault",
      limit: 1,
    });
  });

  it("throws WalletError when no vault matches the resource address", async () => {
    const sendGet = vi.fn().mockResolvedValue({ substates: [] });
    const client = makeClient({ sendGet });

    await expect(
      resolveWantInputs(client, [{ type: "VaultForResource", resourceAddress: TEST_RESOURCE_ADDRESS }]),
    ).rejects.toThrow(WalletError);
    await expect(
      resolveWantInputs(client, [{ type: "VaultForResource", resourceAddress: TEST_RESOURCE_ADDRESS }]),
    ).rejects.toThrow(`Could not find a vault for resource address: ${TEST_RESOURCE_ADDRESS}`);
  });
});

describe("resolveWantInputs — SpecificSubstate", () => {
  it("returns an already-versioned input without calling substatesGet", async () => {
    const substatesGet = vi.fn();
    const client = makeClient({ substatesGet });

    const result = await resolveWantInputs(client, [
      { type: "SpecificSubstate", substateId: "component_xxx", version: 3 },
    ]);

    expect(result).toEqual([{ substate_id: "component_xxx", version: 3 }]);
    expect(substatesGet).not.toHaveBeenCalled();
  });

  it("calls substatesGet to fill in the version when none is provided", async () => {
    const substatesGet = vi
      .fn()
      .mockResolvedValue({ version: 4, substate: { Utxo: { output: null, is_frozen: false } } });
    const client = makeClient({ substatesGet });

    const result = await resolveWantInputs(client, [{ type: "SpecificSubstate", substateId: "component_yyy" }]);

    expect(result).toEqual([{ substate_id: "component_yyy", version: 4 }]);
    expect(substatesGet).toHaveBeenCalledWith("component_yyy", { version: null, local_search_only: false });
  });
});
