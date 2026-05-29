//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { describe, expect, test } from "vitest";
import { amountLiteral, resourceAddressLiteral } from "@tari-project/ootle";
import { amountLiteralHex, resourceAddressLiteralHex } from "./literal.ts";

describe("amountLiteralHex / resourceAddressLiteralHex stay in sync with the SDK encoders", () => {
  test("amountLiteralHex matches amountLiteral for representative u128 values", () => {
    for (const v of [0n, 1n, 1_000_000n, 2n ** 63n, 2n ** 64n - 1n, 2n ** 64n, 2n ** 127n, 2n ** 128n - 1n]) {
      expect(amountLiteralHex(v)).toBe(amountLiteral(v).Literal);
    }
  });

  test("resourceAddressLiteralHex matches resourceAddressLiteral for both address forms", () => {
    const tail = "ab".repeat(32);
    expect(resourceAddressLiteralHex(tail)).toBe(resourceAddressLiteral(tail).Literal);
    expect(resourceAddressLiteralHex(`resource_${tail}`)).toBe(resourceAddressLiteral(`resource_${tail}`).Literal);
  });
});
