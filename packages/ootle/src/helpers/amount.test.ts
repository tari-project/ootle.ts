//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit coverage for the µTari literal seam (`microTariLiteral` /
// `microTariString`). `microTariLiteral` delegates to the BOR-CBOR
// `amountLiteral` encoder (see `cbor-literal.test.ts` for the byte-vector
// coverage); `microTariString` stays a plain decimal string for the structural
// `toJSON()` views of stealth statements.

import { describe, expect, it } from "vitest";
import { microTariLiteral, microTariString } from "./amount";
import { amountLiteral } from "./cbor-literal";

describe("microTariLiteral", () => {
  it("delegates to amountLiteral (BOR-CBOR hex Literal, not decimal)", () => {
    expect(microTariLiteral(1234n)).toEqual(amountLiteral(1234n));
  });

  it("encodes 0n as the canonical [0, 0] CBOR array", () => {
    expect(microTariLiteral(0n)).toEqual({ Literal: "820000" });
  });

  it("encodes 2^64 - 1 without precision loss (above Number.MAX_SAFE_INTEGER)", () => {
    expect(microTariLiteral(2n ** 64n - 1n)).toEqual({ Literal: "821bffffffffffffffff00" });
  });

  it("throws on a negative amount", () => {
    expect(() => microTariLiteral(-1n)).toThrow("amountLiteral: amount must be non-negative, got -1");
  });
});

describe("microTariString", () => {
  it('encodes 0n as "0"', () => {
    expect(microTariString(0n)).toBe("0");
  });

  it("encodes a small positive amount", () => {
    expect(microTariString(1234n)).toBe("1234");
  });

  it("encodes 2^64 - 1 without precision loss", () => {
    expect(microTariString(2n ** 64n - 1n)).toBe("18446744073709551615");
  });

  it("throws on a negative amount", () => {
    expect(() => microTariString(-1n)).toThrow("microTariString: amount must be non-negative, got -1");
  });
});
