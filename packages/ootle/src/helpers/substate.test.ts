//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { describe, expect, it } from "vitest";
import { upSubstateValue } from "./substate";
import { CryptoBridgeError } from "../errors";
import { SERVED_COMPONENT, SERVED_VAULT, encodeForTest } from "../test/encoded";
import { iterVaultIdsInState } from "./vault-walker";

describe("upSubstateValue", () => {
  it("decodes the value of an up substate", () => {
    const substate = { Utxo: { output: null, is_frozen: false } };
    expect(
      upSubstateValue({ version: 1, state: { up: { substate: encodeForTest(substate) } }, verified: false }),
    ).toEqual(substate);
  });

  it("decodes a served CBOR vault", () => {
    const value = upSubstateValue({ version: 1, state: { up: { substate: SERVED_VAULT } }, verified: false });
    expect(value).toEqual({
      Vault: {
        resource_container: {
          Fungible: {
            address: "resource_2222222222222222222222222222222222222222222222222222222222222222",
            amount: "9577588913",
            locked_amount: "0",
          },
        },
        freeze_flags: 0,
      },
    });
  });

  it("decodes a served CBOR component whose state the vault walker reads", () => {
    const value = upSubstateValue({ version: 0, state: { up: { substate: SERVED_COMPONENT } }, verified: false });
    if (value === null || !("Component" in value)) throw new Error("expected a component");
    expect(value.Component.header.upgrade_rule).toBe("Locked");
    expect([...iterVaultIdsInState(value.Component.body.state)]).toEqual([
      "vault_1111111111111111111111111111111111111111111111111111111111111111",
      "vault_1212121212121212121212121212121212121212121212121212121212121212",
    ]);
  });

  it("throws a CryptoBridgeError when the value does not decode", () => {
    expect(() => upSubstateValue({ version: 1, state: { up: { substate: "AAAA" } }, verified: false })).toThrow(
      CryptoBridgeError,
    );
  });

  it("returns null for a down substate", () => {
    expect(upSubstateValue({ version: 1, state: { down: {} }, verified: true })).toBeNull();
  });
});
