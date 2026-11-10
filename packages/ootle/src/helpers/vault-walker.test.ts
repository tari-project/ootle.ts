//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Vault-walker tests. The walker handles the JSON-rendered `tari_bor::Value` the
// indexer emits for a component's state — `{"@cbor": "tag", tag, value}` for
// tagged values, `{"@cbor": "map", entries}` for non-string-keyed maps, and
// `{"@cbor": "bytes", hex}` for byte payloads. Plain text-keyed maps and arrays
// are walked recursively.

import { describe, expect, it, vi } from "vitest";
import { Network } from "../network";
import type { Provider } from "../provider";
import { getVaultIdsForAccount, iterVaultIdsInState } from "./vault-walker";
import { encodeForTest } from "../test/encoded";

const VAULT_ID_TAG = 132;
const NON_VAULT_TAG = 131;
const VAULT_A_HEX = "aa".repeat(32);
const VAULT_B_HEX = "bb".repeat(32);

function taggedBytes(tag: number, hex: string) {
  return { "@cbor": "tag", tag, value: { "@cbor": "bytes", hex } };
}

function stubProvider(overrides: Partial<Provider> = {}): Provider {
  const base: Provider = {
    network: () => Network.LocalNet,
    getCurrentEpoch: vi.fn(async () => 90),
    resolveInputs: vi.fn(),
    getSubstate: vi.fn(),
    getStealthUtxo: vi.fn(),
    fetchSubstates: vi.fn(),
    getTemplateDefinition: vi.fn(),
    submitTransaction: vi.fn(),
    getTransactionResult: vi.fn(),
    listRecentTransactions: vi.fn(),
  } as unknown as Provider;
  return { ...base, ...overrides };
}

describe("iterVaultIdsInState", () => {
  it("yields a vault id for a Tag(132, Bytes(32)) leaf", () => {
    const value = taggedBytes(VAULT_ID_TAG, VAULT_A_HEX);
    expect(Array.from(iterVaultIdsInState(value))).toEqual([`vault_${VAULT_A_HEX}`]);
  });

  it("walks plain text-keyed maps and arrays recursively", () => {
    const value = {
      vaults: [taggedBytes(VAULT_ID_TAG, VAULT_A_HEX), taggedBytes(VAULT_ID_TAG, VAULT_B_HEX)],
      metadata: { name: "foo" },
    };
    expect(Array.from(iterVaultIdsInState(value))).toEqual([`vault_${VAULT_A_HEX}`, `vault_${VAULT_B_HEX}`]);
  });

  it("walks @cbor:map entries (non-string-keyed maps)", () => {
    const value = {
      "@cbor": "map",
      entries: [
        ["resource_x", taggedBytes(VAULT_ID_TAG, VAULT_A_HEX)],
        ["resource_y", taggedBytes(VAULT_ID_TAG, VAULT_B_HEX)],
      ],
    };
    expect(Array.from(iterVaultIdsInState(value))).toEqual([`vault_${VAULT_A_HEX}`, `vault_${VAULT_B_HEX}`]);
  });

  it("deduplicates the same vault id seen via different paths", () => {
    const value = [taggedBytes(VAULT_ID_TAG, VAULT_A_HEX), { other: taggedBytes(VAULT_ID_TAG, VAULT_A_HEX) }];
    expect(Array.from(iterVaultIdsInState(value))).toEqual([`vault_${VAULT_A_HEX}`]);
  });

  it("does not yield tagged bytes with a non-VAULT_ID tag", () => {
    const value = taggedBytes(NON_VAULT_TAG, VAULT_A_HEX);
    expect(Array.from(iterVaultIdsInState(value))).toEqual([]);
  });

  it("does not yield a bytes sentinel that is not wrapped in a VAULT_ID tag", () => {
    // A bare `bytes` sentinel is a leaf — only a Tag(VAULT_ID, Bytes) yields.
    const value = { "@cbor": "bytes", hex: VAULT_A_HEX };
    expect(Array.from(iterVaultIdsInState(value))).toEqual([]);
  });

  it("ignores tagged bytes whose payload is not 32 bytes", () => {
    const value = taggedBytes(VAULT_ID_TAG, "ab".repeat(16));
    expect(Array.from(iterVaultIdsInState(value))).toEqual([]);
  });

  it("ignores 64-char tagged bytes that contain non-hex characters", () => {
    const value = taggedBytes(VAULT_ID_TAG, "zz".repeat(32));
    expect(Array.from(iterVaultIdsInState(value))).toEqual([]);
  });

  it("normalizes uppercase hex to lowercase and deduplicates mixed-case vault ids", () => {
    const upperA = VAULT_A_HEX.toUpperCase();
    const value = [taggedBytes(VAULT_ID_TAG, upperA), taggedBytes(VAULT_ID_TAG, VAULT_A_HEX)];
    expect(Array.from(iterVaultIdsInState(value))).toEqual([`vault_${VAULT_A_HEX}`]);
  });

  it("preserves depth-first order (first-seen wins)", () => {
    // Walking [A, B, A] yields [A, B]; the second A is deduped.
    const value = [
      taggedBytes(VAULT_ID_TAG, VAULT_A_HEX),
      taggedBytes(VAULT_ID_TAG, VAULT_B_HEX),
      taggedBytes(VAULT_ID_TAG, VAULT_A_HEX),
    ];
    expect(Array.from(iterVaultIdsInState(value))).toEqual([`vault_${VAULT_A_HEX}`, `vault_${VAULT_B_HEX}`]);
  });

  it("yields nothing for non-object scalars", () => {
    expect(Array.from(iterVaultIdsInState(null))).toEqual([]);
    expect(Array.from(iterVaultIdsInState(42))).toEqual([]);
    expect(Array.from(iterVaultIdsInState("hello"))).toEqual([]);
    expect(Array.from(iterVaultIdsInState(undefined))).toEqual([]);
  });
});

describe("getVaultIdsForAccount", () => {
  const ACCOUNT = "component_" + "ab".repeat(32);

  it("returns the vault ids referenced by a Component substate", async () => {
    const componentState = {
      vaults: [taggedBytes(VAULT_ID_TAG, VAULT_A_HEX), taggedBytes(VAULT_ID_TAG, VAULT_B_HEX)],
    };
    const provider = stubProvider({
      getSubstate: vi.fn(async () => ({
        address: ACCOUNT,
        version: 0,
        state: { up: { substate: encodeForTest({ Component: { body: { state: componentState } } }) } },
        created_by_transaction: "",
      })) as unknown as Provider["getSubstate"],
    });
    expect(await getVaultIdsForAccount(provider, ACCOUNT)).toEqual([`vault_${VAULT_A_HEX}`, `vault_${VAULT_B_HEX}`]);
  });

  it("returns an empty array if the substate is not a Component", async () => {
    const provider = stubProvider({
      getSubstate: vi.fn(async () => ({
        address: ACCOUNT,
        version: 0,
        state: { up: { substate: encodeForTest({ Vault: { resource_container: {} } }) } },
        created_by_transaction: "",
      })) as unknown as Provider["getSubstate"],
    });
    expect(await getVaultIdsForAccount(provider, ACCOUNT)).toEqual([]);
  });

  it("returns an empty array when the component does not exist (not-found / 404)", async () => {
    const notFoundProvider = stubProvider({
      getSubstate: vi.fn(async () => {
        throw new Error("Substate not found");
      }),
    });
    expect(await getVaultIdsForAccount(notFoundProvider, ACCOUNT)).toEqual([]);

    const status404Provider = stubProvider({
      getSubstate: vi.fn(async () => {
        throw Object.assign(new Error("HTTP error"), { status: 404 });
      }),
    });
    expect(await getVaultIdsForAccount(status404Provider, ACCOUNT)).toEqual([]);
  });

  it("re-throws non-404 provider errors", async () => {
    const provider = stubProvider({
      getSubstate: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });
    await expect(getVaultIdsForAccount(provider, ACCOUNT)).rejects.toThrow("connection refused");
  });
});
