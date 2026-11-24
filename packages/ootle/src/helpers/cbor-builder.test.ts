//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Each expected value is `tari_bor::encode` output for a `minicbor`-derived Rust type, named
// in the comment beside it.

import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "../errors";
import { AccessRuleBuilder } from "./access-rule-builder";
import { CborBuilder, cborLiteral } from "./cbor-builder";
import { resourceAddressLiteral } from "./cbor-literal";

describe("CborBuilder.struct", () => {
  // struct Cfg { #[n(0)] max: Option<u64> }
  it("encodes a struct with its only field unset as an empty array", () => {
    expect(CborBuilder.struct().finish()).toEqual({ Literal: "80" });
    expect(CborBuilder.struct().field(0, 5).finish()).toEqual({ Literal: "8105" });
  });

  // struct Gap { #[n(0)] a: u8, #[n(3)] b: Option<u8>, #[n(5)] c: Option<u8> }
  it("fills index gaps with null and drops trailing unset fields", () => {
    expect(CborBuilder.struct().field(0, 1).finish()).toEqual({ Literal: "8101" });
    expect(CborBuilder.struct().field(0, 1).field(3, 2).finish()).toEqual({ Literal: "8401f6f602" });
    expect(CborBuilder.struct().field(5, 7).field(0, 1).finish()).toEqual({ Literal: "8601f6f6f6f607" });
  });

  // struct Nested { #[n(0)] name: String, #[n(1)] items: Vec<u64>, #[n(2)] inner: Cfg,
  //                 #[n(3)] flag: bool, #[n(4)] data: Vec<String> }
  it("nests builders and plain arrays without finishing them", () => {
    const value = CborBuilder.struct()
      .field(0, "x")
      .field(1, CborBuilder.array([1, 2, 3]))
      .field(2, CborBuilder.struct().field(0, 9))
      .field(3, true)
      .field(4, ["a", "b", "c"])
      .finish();
    expect(value).toEqual({ Literal: "856178830102038109f583616161626163" });
  });

  it("accepts a finished value and an existing literal as a field", () => {
    const resource = "resource_" + "bb".repeat(32);
    const inner = CborBuilder.array([1]).finish();
    expect(CborBuilder.struct().field(0, inner).field(1, resourceAddressLiteral(resource)).finish()).toEqual({
      Literal: `828101d8835820${"bb".repeat(32)}`,
    });
  });

  it("rejects a repeated or out-of-range field index", () => {
    expect(() => CborBuilder.struct().field(0, 1).field(0, 2)).toThrow(/already set/);
    expect(() => CborBuilder.struct().field(-1, 1)).toThrow(InvalidArgumentError);
    expect(() => CborBuilder.struct().field(1.5, 1)).toThrow(InvalidArgumentError);
    expect(() => CborBuilder.struct().field(256, 1)).toThrow(InvalidArgumentError);
  });

  // The stable coin template's `RoleConfig`: `#[n(0)] governor`, `#[n(1)] minter` ..
  // `#[n(4)] compliance` and `#[n(6)] pauser`, all but the governor `Option<AccessRule>`.
  it("takes an AccessRuleBuilder as a field", () => {
    const rule = (byte: string) =>
      `820281820081820081820181d88282d883582001${"00".repeat(31)}8200815820${byte.repeat(32)}`;
    const roles = CborBuilder.struct()
      .field(0, AccessRuleBuilder.publicKey("aa".repeat(32)))
      .field(1, AccessRuleBuilder.publicKey("bb".repeat(32)))
      .field(6, AccessRuleBuilder.publicKey("cc".repeat(32)))
      .finish();
    expect(roles).toEqual({ Literal: `87${rule("aa")}${rule("bb")}f6f6f6f6${rule("cc")}` });
  });
});

// enum E { #[n(0)] Unit, #[n(1)] Tuple(#[n(0)] u8, #[n(1)] String),
//          #[n(2)] Named { #[n(0)] a: u8, #[n(2)] b: Option<bool> } }
describe("CborBuilder.variant", () => {
  it("encodes a unit variant", () => {
    expect(CborBuilder.variant(0).finish()).toEqual({ Literal: "820080" });
  });

  it("encodes a tuple variant", () => {
    expect(CborBuilder.variant(1).field(0, 4).field(1, "hi").finish()).toEqual({ Literal: "82018204626869" });
  });

  it("encodes a variant with named fields, laid out like a struct", () => {
    expect(CborBuilder.variant(2).field(0, 3).finish()).toEqual({ Literal: "82028103" });
    expect(CborBuilder.variant(2).field(0, 3).field(2, true).finish()).toEqual({ Literal: "82028303f6f5" });
  });

  it("rejects an invalid variant index", () => {
    expect(() => CborBuilder.variant(-1)).toThrow(InvalidArgumentError);
    expect(() => CborBuilder.variant(0.5)).toThrow(InvalidArgumentError);
  });
});

describe("CborBuilder.array", () => {
  it("builds from initial items, add and addAll", () => {
    expect(CborBuilder.array().finish()).toEqual({ Literal: "80" });
    expect(CborBuilder.array([1]).add(2).addAll([3]).finish()).toEqual({ Literal: "83010203" });
  });

  it("nests arrays", () => {
    expect(CborBuilder.array([[1, 2], CborBuilder.array([3])]).finish()).toEqual({ Literal: "828201028103" });
  });
});

describe("cborLiteral", () => {
  it("writes null and undefined as None", () => {
    expect(cborLiteral(null)).toEqual({ Literal: "f6" });
    expect(cborLiteral(undefined)).toEqual({ Literal: "f6" });
  });

  it("writes integers from numbers and bigints", () => {
    expect(cborLiteral(-5)).toEqual({ Literal: "24" }); // -5i64
    expect(cborLiteral(-5n)).toEqual({ Literal: "24" });
    expect(cborLiteral(42n)).toEqual({ Literal: "182a" });
    // u128::MAX
    expect(cborLiteral((1n << 128n) - 1n)).toEqual({ Literal: "c250" + "ff".repeat(16) });
  });

  it("writes text, booleans and bytes", () => {
    expect(cborLiteral("hi")).toEqual({ Literal: "626869" });
    expect(cborLiteral(false)).toEqual({ Literal: "f4" });
    expect(cborLiteral(Uint8Array.from([0xde, 0xad]))).toEqual({ Literal: "42dead" });
  });

  it("rejects what it cannot encode", () => {
    expect(() => cborLiteral(1.5)).toThrow(/not a safe integer/);
    expect(() => cborLiteral(2 ** 60)).toThrow(/not a safe integer/);
    expect(() => cborLiteral({ Workspace: { id: 0, offset: null } })).toThrow(InvalidArgumentError);
    expect(() => cborLiteral({ name: "x" } as never)).toThrow(InvalidArgumentError);
  });
});
