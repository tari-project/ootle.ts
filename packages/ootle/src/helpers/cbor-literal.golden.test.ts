//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Cross-SDK golden vectors. Each `expected` value is copied verbatim from the core's
// `crates/ootle_sdk_core/fixtures/arg_dsl/<name>.json` (`expected.encoded_arg_bytes`),
// which the Rust encoders, ootle-go and ootle-py are all pinned to. When the core
// regenerates a vector, update it here too so the TypeScript helpers cannot drift.
// Vectors with no TypeScript helper (txreceipt) are not mirrored.

import type { AccessRule, InstructionArg, NonFungibleId } from "@tari-project/ootle-ts-bindings";
import { describe, expect, it } from "vitest";
import {
  accessRuleLiteral,
  amountLiteral,
  boolLiteral,
  bytesLiteral,
  claimedOutputTombstoneAddressLiteral,
  componentAddressLiteral,
  intLiteral,
  listLiteral,
  metadataLiteral,
  nonFungibleAddressLiteral,
  noneLiteral,
  publicKeyAccessRule,
  resourceAddressLiteral,
  stringLiteral,
  templateAddressLiteral,
  utxoAddressLiteral,
  validatorFeePoolAddressLiteral,
  vaultIdLiteral,
} from "./cbor-literal";
import { fromHexStr } from "./hex";

const resourceC = "resource_" + "cc".repeat(32);
// `nonFungibleAddressLiteral` prefix: Tag(130), array(2), Tag(131) bytes(32) resource.
const NFT_PREFIX = "d88282d8835820" + "cc".repeat(32);

/** The bare `NonFungibleId` bytes, for the core's standalone `nfid_*` vectors. */
function nfidLiteral(id: NonFungibleId): InstructionArg {
  const { Literal } = nonFungibleAddressLiteral({ resource_address: resourceC, id }) as { Literal: string };
  expect(Literal.startsWith(NFT_PREFIX)).toBe(true);
  return { Literal: Literal.slice(NFT_PREFIX.length) };
}

const vectors: [name: string, actual: () => InstructionArg, expected: string][] = [
  [
    "address_component",
    () => componentAddressLiteral("component_" + "aa".repeat(32)),
    "d8805820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ],
  [
    "address_non_fungible",
    () => nonFungibleAddressLiteral({ resource_address: resourceC, id: { String: "nft-1" } }),
    "d88282d8835820cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc820181656e66742d31",
  ],
  [
    "address_resource",
    () => resourceAddressLiteral("resource_" + "bb".repeat(32)),
    "d8835820bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ],
  [
    "address_template",
    () => templateAddressLiteral("template_" + "12".repeat(32)),
    "58201212121212121212121212121212121212121212121212121212121212121212",
  ],
  [
    "address_tombstone",
    () => claimedOutputTombstoneAddressLiteral("tombstone_" + "78".repeat(32)),
    "d88858207878787878787878787878787878787878787878787878787878787878787878",
  ],
  [
    "address_utxo",
    () => utxoAddressLiteral({ resource_address: resourceC, id: "56".repeat(32) }),
    "d88d82d8835820cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc58205656565656565656565656565656565656565656565656565656565656565656",
  ],
  [
    "address_validator_fee_pool",
    () => validatorFeePoolAddressLiteral("vnfp_" + "34".repeat(32)),
    "d88a58203434343434343434343434343434343434343434343434343434343434343434",
  ],
  [
    "address_vault",
    () => vaultIdLiteral("vault_" + "dd".repeat(32)),
    "d8845820dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  ],
  ["amount_above_2_pow_33", () => amountLiteral(17179869191n), "1b0000000400000007"],
  ["amount", () => amountLiteral(1000000n), "1a000f4240"],
  ["bool_false", () => boolLiteral(false), "f4"],
  ["bool_true", () => boolLiteral(true), "f5"],
  ["bytes", () => bytesLiteral(fromHexStr("deadbeef")), "44deadbeef"],
  ["list_empty", () => listLiteral([]), "80"],
  [
    "list_nested",
    () => listLiteral([listLiteral([intLiteral(1n), intLiteral(2n)]), listLiteral([intLiteral(3n)])]),
    "828201028103",
  ],
  [
    "list_of_addresses",
    () =>
      listLiteral([
        componentAddressLiteral("component_" + "aa".repeat(32)),
        resourceAddressLiteral("resource_" + "bb".repeat(32)),
      ]),
    "82d8805820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad8835820bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ],
  ["optional_none", () => noneLiteral(), "f6"],
  ["i64_min", () => intLiteral(-9223372036854775808n), "3b7fffffffffffffff"],
  ["i64_negative", () => intLiteral(-42n), "3829"],
  ["i64_positive", () => intLiteral(42n), "182a"],
  [
    "metadata",
    () => metadataLiteral({ provider_name: "OotleExample", website: "example.test" }),
    "d881a26d70726f76696465725f6e616d656c4f6f746c654578616d706c6567776562736974656c6578616d706c652e74657374",
  ],
  ["nfid_str", () => nfidLiteral({ String: "special-nft" }), "8201816b7370656369616c2d6e6674"],
  ["nfid_u32", () => nfidLiteral({ Uint32: 7 }), "82028107"],
  ["nfid_u64", () => nfidLiteral({ Uint64: 17179869189 }), "8203811b0000000400000005"],
  [
    "nfid_uuid",
    () => nfidLiteral({ U256: "5a".repeat(32) }),
    "82008158205a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a",
  ],
  ["string", () => stringLiteral("withdraw"), "687769746864726177"],
  ["u64_above_2_pow_33", () => intLiteral(17179869283n), "1b0000000400000063"],
  ["u64", () => intLiteral(42n), "182a"],
];

describe("core arg_dsl golden vectors", () => {
  it.each(vectors)("%s", (_name, actual, expected) => {
    expect(actual()).toEqual({ Literal: expected });
  });
});

// `AccessRule` vectors. Each `expected` value is `tari_bor::encode(&rule)` from
// `tari_template_lib_types` 0.39.3, for the rule whose serde JSON is the input here.
// `rule!(any_of(..))` and `rule!(all_of(..))` write each requirement as a rule of its own (the
// `*_rule_macro` vectors); `RequireRule::AnyOf`/`AllOf` hold bare requirements (`require_*`).
const KEY = "resource_01" + "00".repeat(31);
const C = "cc".repeat(32);
const A = "aa".repeat(32);
const T = "12".repeat(32);
const keyBadge = (byte: string) => ({ NonFungibleAddress: { resource_address: KEY, id: { U256: byte.repeat(32) } } });
const resourceRequirement = { Resource: resourceC };
const nftRequirement = { NonFungibleAddress: { resource_address: resourceC, id: { String: "nft-1" } } };
// The encoded forms of the requirements above.
const KEY_BADGE = (byte: string) => `820181d88282d883582001${"00".repeat(31)}8200815820${byte.repeat(32)}`;
const RESOURCE = `820081d8835820${C}`;
const NFT = `820181d88282d8835820${C}820181656e66742d31`;
const requireRule = (requirement: string) => `820281820081820081${requirement}`;

const accessRuleVectors: [name: string, rule: AccessRule, expected: string][] = [
  ["allow_all", "AllowAll", "820080"],
  ["deny_all", "DenyAll", "820180"],
  ["public_key", publicKeyAccessRule(A), requireRule(KEY_BADGE("aa"))],
  ["resource", { Restricted: { Require: { Require: resourceRequirement } } }, requireRule(RESOURCE)],
  ["non_fungible", { Restricted: { Require: { Require: nftRequirement } } }, requireRule(NFT)],
  [
    "scoped_to_component",
    { Restricted: { Require: { Require: { ScopedToComponent: "component_" + A } } } },
    requireRule(`820281d8805820${A}`),
  ],
  [
    "scoped_to_template",
    { Restricted: { Require: { Require: { ScopedToTemplate: T } } } },
    requireRule(`8203815820${T}`),
  ],
  [
    "caller_component",
    { Restricted: { Require: { Require: { CallerComponent: "component_" + A } } } },
    requireRule(`820481d8805820${A}`),
  ],
  [
    "direct_caller_template",
    { Restricted: { Require: { Require: { DirectCallerTemplate: T } } } },
    requireRule(`8205815820${T}`),
  ],
  [
    "any_of_rule_macro",
    {
      Restricted: { AnyOf: [{ Require: { Require: keyBadge("01") } }, { Require: { Require: resourceRequirement } }] },
    },
    `82028182018182820081820081${KEY_BADGE("01")}820081820081${RESOURCE}`,
  ],
  [
    "all_of_rule_macro",
    {
      Restricted: { AllOf: [{ Require: { Require: keyBadge("01") } }, { Require: { Require: resourceRequirement } }] },
    },
    `82028182028182820081820081${KEY_BADGE("01")}820081820081${RESOURCE}`,
  ],
  [
    "require_any_of",
    { Restricted: { Require: { AnyOf: [keyBadge("01"), resourceRequirement] } } },
    `82028182008182018182${KEY_BADGE("01")}${RESOURCE}`,
  ],
  [
    "require_all_of",
    { Restricted: { Require: { AllOf: [keyBadge("01"), resourceRequirement] } } },
    `82028182008182028182${KEY_BADGE("01")}${RESOURCE}`,
  ],
  [
    "m_of_n",
    { Restricted: { Require: { MOfN: [2, [keyBadge("01"), keyBadge("02"), keyBadge("03")]] } } },
    `8202818200818203820283${KEY_BADGE("01")}${KEY_BADGE("02")}${KEY_BADGE("03")}`,
  ],
  [
    "nested_any_of_all_of",
    {
      Restricted: {
        AnyOf: [
          { Require: { Require: resourceRequirement } },
          { AllOf: [{ Require: { Require: resourceRequirement } }, { Require: { Require: nftRequirement } }] },
        ],
      },
    },
    `82028182018182820081820081${RESOURCE}82028182820081820081${RESOURCE}820081820081${NFT}`,
  ],
];

describe("AccessRule golden vectors", () => {
  it.each(accessRuleVectors)("%s", (_name, rule, expected) => {
    expect(accessRuleLiteral(rule)).toEqual({ Literal: expected });
  });

  it("encodes an MOfN count above u8 as a 16-bit integer", () => {
    // 256 of 256 distinct keys: the count is `19 0100` and the array head `99 0100`.
    const key = (i: number) => i.toString(16).padStart(4, "0") + "00".repeat(30);
    const keys = Array.from({ length: 256 }, (_, i) => key(i));
    const rule: AccessRule = {
      Restricted: {
        Require: { MOfN: [256, keys.map((k) => ({ NonFungibleAddress: { resource_address: KEY, id: { U256: k } } }))] },
      },
    };
    const badges = keys.map((k) => `820181d88282d883582001${"00".repeat(31)}8200815820${k}`).join("");
    expect(accessRuleLiteral(rule)).toEqual({ Literal: `820281820081820382190100990100${badges}` });
  });

  it("encodes a struct of rules as the array of its fields", () => {
    // `tari_bor::encode` of the stable coin template's `RoleConfig`, whose fields are
    // `#[n(0)] governor`, `#[n(1)] minter` .. `#[n(4)] compliance` and `#[n(6)] pauser`:
    // unset fields and the skipped index 5 are null, and trailing unset fields are dropped.
    const governor = accessRuleLiteral(publicKeyAccessRule("aa".repeat(32)));
    const minter = accessRuleLiteral(publicKeyAccessRule("bb".repeat(32)));
    const pauser = accessRuleLiteral(publicKeyAccessRule("cc".repeat(32)));
    const none = noneLiteral();
    expect(listLiteral([governor])).toEqual({ Literal: `81${requireRule(KEY_BADGE("aa"))}` });
    expect(listLiteral([governor, minter, none, none, none, none, pauser])).toEqual({
      Literal: `87${requireRule(KEY_BADGE("aa"))}${requireRule(KEY_BADGE("bb"))}f6f6f6f6${requireRule(KEY_BADGE("cc"))}`,
    });
  });
});
