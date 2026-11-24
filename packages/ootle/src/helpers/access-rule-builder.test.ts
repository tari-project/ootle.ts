//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { AccessRule } from "@tari-project/ootle-ts-bindings";
import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "../errors";
import { AccessRuleBuilder, requirement } from "./access-rule-builder";
import { publicKeyAccessRule } from "./cbor-literal";

const KEY = "resource_01" + "00".repeat(31);
const resourceC = "resource_" + "cc".repeat(32);
const C = "cc".repeat(32);
const key = (byte: string) => byte.repeat(32);
// The encoded forms, as in the `AccessRule` golden vectors.
const KEY_BADGE = (byte: string) => `820181d88282d883582001${"00".repeat(31)}8200815820${byte.repeat(32)}`;
const RESOURCE = `820081d8835820${C}`;

describe("requirement", () => {
  it("builds each kind", () => {
    const component = "component_" + "aa".repeat(32);
    const nft = { resource_address: resourceC, id: { String: "nft-1" } };
    expect(requirement.publicKey(key("ab"))).toEqual({
      NonFungibleAddress: { resource_address: KEY, id: { U256: key("ab") } },
    });
    expect(requirement.resource(resourceC)).toEqual({ Resource: resourceC });
    expect(requirement.nonFungible(nft)).toEqual({ NonFungibleAddress: nft });
    expect(requirement.scopedToComponent(component)).toEqual({ ScopedToComponent: component });
    expect(requirement.callerComponent(component)).toEqual({ CallerComponent: component });
  });

  it("strips the template prefix, which the rule's JSON form does not carry", () => {
    const hash = "12".repeat(32);
    expect(requirement.scopedToTemplate("template_" + hash)).toEqual({ ScopedToTemplate: hash });
    expect(requirement.directCallerTemplate(hash)).toEqual({ DirectCallerTemplate: hash });
  });
});

describe("AccessRuleBuilder", () => {
  it("builds the simple rules", () => {
    expect(AccessRuleBuilder.allowAll().build()).toBe("AllowAll");
    expect(AccessRuleBuilder.denyAll().build()).toBe("DenyAll");
    expect(AccessRuleBuilder.publicKey(key("aa")).build()).toEqual(publicKeyAccessRule(key("aa")));
    expect(AccessRuleBuilder.resource(resourceC).build()).toEqual({
      Restricted: { Require: { Require: { Resource: resourceC } } },
    });
  });

  // The expected bytes are `tari_bor::encode` of `rule!(any_of(public_key(k), resource(r)))`,
  // `rule!(all_of(..))` and `rule!(m_of_n(2, ..))`.
  it("builds the same rule as the Rust rule! macro", () => {
    const requirements = [requirement.publicKey(key("01")), requirement.resource(resourceC)];
    const single = (encoded: string) => `820081820081${encoded}`;
    expect(AccessRuleBuilder.anyOf(...requirements).toLiteral()).toEqual({
      Literal: `82028182018182${single(KEY_BADGE("01"))}${single(RESOURCE)}`,
    });
    expect(AccessRuleBuilder.allOf(...requirements).toLiteral()).toEqual({
      Literal: `82028182028182${single(KEY_BADGE("01"))}${single(RESOURCE)}`,
    });
    expect(AccessRuleBuilder.anyOf(...requirements).build()).toEqual({
      Restricted: { AnyOf: requirements.map((r) => ({ Require: { Require: r } })) },
    });
    const keys = ["01", "02", "03"].map((byte) => requirement.publicKey(key(byte)));
    expect(AccessRuleBuilder.mOfN(2, ...keys).toLiteral()).toEqual({
      Literal: `8202818200818203820283${KEY_BADGE("01")}${KEY_BADGE("02")}${KEY_BADGE("03")}`,
    });
  });

  it("nests rules inside anyOf and allOf", () => {
    const resource = requirement.resource(resourceC);
    const signer = requirement.publicKey(key("01"));
    const rule = AccessRuleBuilder.anyOf(resource, AccessRuleBuilder.allOf(resource, signer));
    expect(rule.build()).toEqual({
      Restricted: {
        AnyOf: [
          { Require: { Require: resource } },
          { AllOf: [{ Require: { Require: resource } }, { Require: { Require: signer } }] },
        ],
      },
    });
  });

  it("combines rules with or and and", () => {
    const a = AccessRuleBuilder.publicKey(key("aa"));
    const b = requirement.resource(resourceC);
    const restricted = (rule: AccessRule) => (rule as { Restricted: unknown }).Restricted;
    expect(a.or(b).build()).toEqual({
      Restricted: { AnyOf: [restricted(a.build()), { Require: { Require: b } }] },
    });
    expect(a.and(b).build()).toEqual({
      Restricted: { AllOf: [restricted(a.build()), { Require: { Require: b } }] },
    });
  });

  it("simplifies or and and with allowAll and denyAll as Rust does", () => {
    const a = AccessRuleBuilder.publicKey(key("aa"));
    const allow = AccessRuleBuilder.allowAll();
    const deny = AccessRuleBuilder.denyAll();
    expect(a.or(allow).build()).toBe("AllowAll");
    expect(allow.or(a).build()).toBe("AllowAll");
    expect(a.or(deny).build()).toEqual(a.build());
    expect(deny.or(a).build()).toEqual(a.build());
    expect(deny.or(deny).build()).toBe("DenyAll");
    expect(a.and(deny).build()).toBe("DenyAll");
    expect(deny.and(a).build()).toBe("DenyAll");
    expect(a.and(allow).build()).toEqual(a.build());
    expect(allow.and(a).build()).toEqual(a.build());
    expect(allow.and(allow).build()).toBe("AllowAll");
  });

  it("continues from an existing rule", () => {
    const existing = publicKeyAccessRule(key("aa"));
    expect(AccessRuleBuilder.from(existing).build()).toEqual(existing);
  });

  it("rejects a rule the engine refuses to store, in build and in toLiteral", () => {
    const k = requirement.publicKey(key("aa"));
    for (const rule of [AccessRuleBuilder.anyOf(), AccessRuleBuilder.mOfN(0, k), AccessRuleBuilder.mOfN(1, k, k)]) {
      expect(() => rule.build()).toThrow(InvalidArgumentError);
      expect(() => rule.toLiteral()).toThrow(InvalidArgumentError);
    }
  });

  it("refuses to nest allowAll or denyAll in a list", () => {
    expect(() => AccessRuleBuilder.anyOf(AccessRuleBuilder.allowAll())).toThrow(/cannot be nested/);
    expect(() => AccessRuleBuilder.allOf(requirement.resource(resourceC), AccessRuleBuilder.denyAll())).toThrow(
      /cannot be nested/,
    );
  });
});
