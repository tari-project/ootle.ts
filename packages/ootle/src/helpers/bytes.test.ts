//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit coverage for the 32-byte invariant seam (`assertByteLength`). This
// helper is the entry-time check for every non-stealth `Uint8Array(32)` value
// (`SealKeypair`, schnorr signature halves, parsed daemon public keys), so its
// exact error-message shape is the contract callers depend on.

import { describe, expect, it } from "vitest";
import { assertByteLength } from "./bytes";

describe("assertByteLength", () => {
  it("returns the same array reference when the length matches", () => {
    const bytes = new Uint8Array(32);
    expect(assertByteLength(bytes, 32, "foo")).toBe(bytes);
  });

  it("throws with the canonical `<name> must be <length> bytes, got <actual>` message", () => {
    expect(() => assertByteLength(new Uint8Array(31), 32, "foo")).toThrow("foo must be 32 bytes, got 31");
  });

  it("accepts a zero-length array when the expected length is 0", () => {
    const empty = new Uint8Array(0);
    expect(assertByteLength(empty, 0, "empty")).toBe(empty);
  });

  it("does not mutate the input bytes", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    assertByteLength(bytes, 4, "abcd");
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });
});
