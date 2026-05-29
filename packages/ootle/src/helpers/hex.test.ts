//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit coverage for the bytes <-> lowercase-hex helpers. Lowercase output is
// part of the on-wire contract: every JSON value that crosses into the indexer
// or gets hashed normalises hex via `toHexStr`, so a casing regression would
// silently break signature verification.

import { describe, expect, it } from "vitest";
import { fromHexStr, toHexStr } from "./hex";

describe("toHexStr", () => {
  it("encodes a short byte sequence as lowercase hex", () => {
    expect(toHexStr(new Uint8Array([0x01, 0x23]))).toBe("0123");
  });

  it("encodes 32 zero bytes as 64 zero characters", () => {
    expect(toHexStr(new Uint8Array(32))).toBe("00".repeat(32));
  });

  it("emits lowercase hex digits even for high-bit bytes", () => {
    expect(toHexStr(new Uint8Array([0xab, 0xcd, 0xef]))).toBe("abcdef");
  });
});

describe("fromHexStr", () => {
  it("decodes a short hex string back to bytes", () => {
    expect(fromHexStr("0123")).toEqual(new Uint8Array([0x01, 0x23]));
  });

  it("decodes the empty string to an empty Uint8Array", () => {
    expect(fromHexStr("")).toEqual(new Uint8Array(0));
  });

  it("throws on non-hex characters (no silent NaN→0 coercion)", () => {
    expect(() => fromHexStr("zz")).toThrow(/non-hex/);
  });

  it("throws on odd-length input", () => {
    expect(() => fromHexStr("abc")).toThrow(/even length/);
  });
});

describe("fromHexStr ∘ toHexStr round-trip", () => {
  for (const length of [1, 32, 64, 130]) {
    it(`round-trips ${length} arbitrary bytes`, () => {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 13) & 0xff;
      expect(fromHexStr(toHexStr(bytes))).toEqual(bytes);
    });
  }
});
