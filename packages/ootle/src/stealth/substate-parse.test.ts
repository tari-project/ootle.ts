//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { IndexerGetSubstateResponse, OutputBody, SubstateValue, Utxo } from "@tari-project/ootle-ts-bindings";
import { describe, expect, it } from "vitest";
import { toHexStr } from "../helpers/hex";
import { commitmentOf, parseSubstateUtxo } from "./substate-parse";

// 64 hex chars = 32 bytes.
const RESOURCE_HEX = "a".repeat(64);
const COMMITMENT_HEX = "0123456789abcdef".repeat(4); // 64 chars
const UTXO_ID = `utxo_${RESOURCE_HEX}_${COMMITMENT_HEX}`;

function outputBody(overrides: Partial<OutputBody> = {}): OutputBody {
  return {
    public_nonce: "bb".repeat(32),
    encrypted_data: "cc".repeat(40),
    minimum_value_promise: 0,
    viewable_balance: null,
    ...overrides,
  };
}

function utxoSubstate(utxo: Utxo): IndexerGetSubstateResponse {
  const substate: SubstateValue = { Utxo: utxo };
  return { version: 0, substate, verified: true };
}

describe("commitmentOf", () => {
  it("returns the 32-byte trailing segment of a UTXO id", () => {
    const commitment = commitmentOf(UTXO_ID);
    if (commitment === null) {
      throw new Error("expected a commitment");
    }
    expect(commitment).toHaveLength(32);
    expect(toHexStr(commitment)).toBe(COMMITMENT_HEX);
  });

  it("returns null for a non-UTXO id (component)", () => {
    expect(commitmentOf(`component_${RESOURCE_HEX}`)).toBeNull();
  });

  it("returns null for a vault id", () => {
    expect(commitmentOf(`vault_${RESOURCE_HEX}_${COMMITMENT_HEX}`)).toBeNull();
  });

  it("returns null for a malformed id (trailing segment not 32 bytes)", () => {
    expect(commitmentOf(`utxo_${RESOURCE_HEX}_deadbeef`)).toBeNull();
  });

  it("returns null for a UTXO id with a non-hex trailing segment", () => {
    expect(commitmentOf(`utxo_${RESOURCE_HEX}_${"z".repeat(64)}`)).toBeNull();
  });

  it("returns null for an id with too few segments", () => {
    expect(commitmentOf(`utxo_${COMMITMENT_HEX}`)).toBeNull();
  });
});

describe("parseSubstateUtxo", () => {
  it("returns { commitment, body } for a live UTXO substate", () => {
    const body = outputBody();
    const substate = utxoSubstate({
      output: { output: body, auth: {} as never, tag: 0 as never },
      is_frozen: false,
    });

    const parsed = parseSubstateUtxo(substate, UTXO_ID);
    if (parsed === null) {
      throw new Error("expected a parsed UTXO");
    }
    expect(toHexStr(parsed.commitment)).toBe(COMMITMENT_HEX);
    expect(parsed.body).toBe(body);
    expect(parsed.body.public_nonce).toBe(body.public_nonce);
  });

  it("returns null for a spent UTXO (output: null)", () => {
    const substate = utxoSubstate({ output: null, is_frozen: false });
    expect(parseSubstateUtxo(substate, UTXO_ID)).toBeNull();
  });

  it("returns null for a frozen UTXO (is_frozen: true)", () => {
    const substate = utxoSubstate({
      output: { output: outputBody(), auth: {} as never, tag: 0 as never },
      is_frozen: true,
    });
    expect(parseSubstateUtxo(substate, UTXO_ID)).toBeNull();
  });

  it("returns null for a non-Utxo substate arm (Component)", () => {
    const substate: IndexerGetSubstateResponse = {
      version: 0,
      substate: { Component: {} as never },
      verified: true,
    };
    expect(parseSubstateUtxo(substate, UTXO_ID)).toBeNull();
  });

  it("returns null when the substate id yields no valid commitment", () => {
    const substate = utxoSubstate({
      output: { output: outputBody(), auth: {} as never, tag: 0 as never },
      is_frozen: false,
    });
    expect(parseSubstateUtxo(substate, `component_${RESOURCE_HEX}`)).toBeNull();
  });
});
