//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Golden-vector coverage for the BOR/CBOR `Literal` encoders. Hand-computed
// against the CBOR spec (RFC 8949 major-type-0 ints + tag 131 + bytes(32)) so
// a regression in the minimal-length encoding surfaces here, not in a runtime
// `"Odd number of digits"` failure deep in the WASM signer.

import { describe, expect, it } from "vitest";
import {
  amountLiteral,
  boolLiteral,
  bytesLiteral,
  claimedOutputTombstoneAddressLiteral,
  componentAddressLiteral,
  intLiteral,
  literalArg,
  metadataLiteral,
  nonFungibleAddressLiteral,
  publicKeyLiteral,
  resourceAddressLiteral,
  stringLiteral,
  templateAddressLiteral,
  utxoAddressLiteral,
  validatorFeePoolAddressLiteral,
  vaultIdLiteral,
} from "./cbor-literal";

describe("amountLiteral", () => {
  it("encodes 0n as the two-element [0, 0] CBOR array", () => {
    expect(amountLiteral(0n)).toEqual({ Literal: "820000" });
  });

  it("encodes 1n as [1, 0] (lo_u64=1, hi_u64=0)", () => {
    expect(amountLiteral(1n)).toEqual({ Literal: "820100" });
  });

  it("encodes a 16-bit amount with the 0x19 length tag", () => {
    // 1234 = 0x04d2 → 0x19 0x04 0xd2, hi = 0.
    expect(amountLiteral(1234n)).toEqual({ Literal: "821904d200" });
  });

  it("encodes a 32-bit amount (1_000_000) with the 0x1a length tag", () => {
    // 1_000_000 = 0x000f4240 → 0x1a 0x00 0x0f 0x42 0x40, hi = 0.
    expect(amountLiteral(1_000_000n)).toEqual({ Literal: "821a000f424000" });
  });

  it("encodes the largest u64 (2^64 - 1) lo with hi = 0", () => {
    expect(amountLiteral(2n ** 64n - 1n)).toEqual({ Literal: "821bffffffffffffffff00" });
  });

  it("encodes 2^64 as lo = 0, hi = 1", () => {
    expect(amountLiteral(2n ** 64n)).toEqual({ Literal: "820001" });
  });

  it("encodes 2^127 as lo = 0, hi = 2^63 (high bit set)", () => {
    expect(amountLiteral(2n ** 127n)).toEqual({ Literal: "82001b8000000000000000" });
  });

  it("throws on a negative amount", () => {
    expect(() => amountLiteral(-1n)).toThrow("amountLiteral: amount must be non-negative, got -1");
  });

  it("throws on an amount overflowing u128", () => {
    expect(() => amountLiteral(2n ** 128n)).toThrow(/overflows u128/);
  });
});

describe("resourceAddressLiteral", () => {
  it("encodes a bech32-style `resource_<hex>` as Tag(131, bytes(32))", () => {
    const address = "resource_" + "ab".repeat(32);
    expect(resourceAddressLiteral(address)).toEqual({ Literal: "d8835820" + "ab".repeat(32) });
  });

  it("accepts the bare 64-hex-char tail (no `resource_` prefix)", () => {
    const tail = "cd".repeat(32);
    expect(resourceAddressLiteral(tail)).toEqual({ Literal: "d8835820" + tail });
  });

  it("throws when the address body is not 32 bytes", () => {
    expect(() => resourceAddressLiteral("resource_abcd")).toThrow(/32 bytes/);
  });
});

describe("intLiteral", () => {
  it("encodes small uints inline (0..23)", () => {
    expect(intLiteral(0n)).toEqual({ Literal: "00" });
    expect(intLiteral(23n)).toEqual({ Literal: "17" });
  });

  it("encodes uints with the appropriate length tag", () => {
    expect(intLiteral(24n)).toEqual({ Literal: "1818" });
    expect(intLiteral(1000n)).toEqual({ Literal: "1903e8" });
    expect(intLiteral(2n ** 64n - 1n)).toEqual({ Literal: "1bffffffffffffffff" });
  });

  it("encodes negative ints as CBOR major type 1 (-1 - n)", () => {
    expect(intLiteral(-1n)).toEqual({ Literal: "20" });
    expect(intLiteral(-24n)).toEqual({ Literal: "37" });
    expect(intLiteral(-256n)).toEqual({ Literal: "38ff" });
  });

  it("throws when the magnitude exceeds the 64-bit CBOR integer range", () => {
    expect(() => intLiteral(2n ** 64n)).toThrow(/64-bit CBOR integer range/);
    expect(() => intLiteral(-(2n ** 64n) - 1n)).toThrow(/64-bit CBOR integer range/);
  });
});

describe("componentAddressLiteral", () => {
  it("encodes a `component_<hex>` as Tag(128, bytes(32))", () => {
    const address = "component_" + "ab".repeat(32);
    expect(componentAddressLiteral(address)).toEqual({ Literal: "d8805820" + "ab".repeat(32) });
  });

  it("throws when the address body is not 32 bytes", () => {
    expect(() => componentAddressLiteral("component_abcd")).toThrow(/32 bytes/);
  });
});

describe("stringLiteral", () => {
  it('encodes "hello" as a CBOR text string', () => {
    expect(stringLiteral("hello")).toEqual({ Literal: "6568656c6c6f" });
  });

  it("encodes the empty string as a zero-length text string", () => {
    expect(stringLiteral("")).toEqual({ Literal: "60" });
  });

  it("encodes a large string without a stack overflow (Point 9)", () => {
    const arg = stringLiteral("a".repeat(200_000)) as { Literal: string };
    // head: text(200_000) = 0x7a 0x00030d40, then 200_000 "a" bytes (0x61).
    expect(arg.Literal.slice(0, 10)).toBe("7a00030d40");
    expect(arg.Literal.length).toBe(10 + 200_000 * 2);
  });
});

describe("bytesLiteral", () => {
  it("encodes a byte array as a CBOR byte string", () => {
    expect(bytesLiteral(Uint8Array.from([1, 2, 3]))).toEqual({ Literal: "43010203" });
  });

  it("encodes a large byte array without a stack overflow (Point 9)", () => {
    const value = new Uint8Array(200_000);
    const arg = bytesLiteral(value) as { Literal: string };
    // head: bytes(200_000) = 0x5a 0x00030d40, then 200_000 zero bytes.
    expect(arg.Literal.slice(0, 10)).toBe("5a00030d40");
    expect(arg.Literal.length).toBe(10 + 200_000 * 2);
  });
});

describe("boolLiteral", () => {
  it("encodes true as 0xf5 and false as 0xf4", () => {
    expect(boolLiteral(true)).toEqual({ Literal: "f5" });
    expect(boolLiteral(false)).toEqual({ Literal: "f4" });
  });
});

describe("metadataLiteral", () => {
  it("encodes a single-entry map as Tag(129, Map<text, text>)", () => {
    // tag 129 = d881, map(1) = a1, "symbol" = 66+73796d626f6c, "AB" = 62+4142.
    expect(metadataLiteral({ symbol: "AB" })).toEqual({ Literal: "d881a16673796d626f6c624142" });
  });

  it("sorts ASCII keys to match the runtime's BTreeMap ordering", () => {
    expect(metadataLiteral({ b: "2", a: "1" })).toEqual(metadataLiteral({ a: "1", b: "2" }));
  });

  it("sorts an astral key after a BMP key by UTF-8 bytes, not UTF-16 (Point 12)", () => {
    // UTF-16 would sort "\u{10000}" (lead unit 0xD800) before ""; UTF-8/code-point
    // order puts the astral key (f0 90 80 80) after the BMP key (ee 80 80).
    const astral = "\u{10000}";
    const bmp = "";
    const arg = metadataLiteral(
      new Map([
        [astral, "x"],
        [bmp, "y"],
      ]),
    ) as { Literal: string };
    // tag 129 = d881, map(2) = a2, then bmp key+value, then astral key+value.
    const bmpEntry = "63ee8080" + "6179"; // text(3) ee8080, text(1) "y"
    const astralEntry = "64f0908080" + "6178"; // text(4) f0908080, text(1) "x"
    expect(arg.Literal).toBe("d881a2" + bmpEntry + astralEntry);
  });
});

describe("object-key address literals (Tag(N, bytes(32)))", () => {
  const body = "ab".repeat(32);

  it("encodes a VaultId as Tag(132, bytes(32))", () => {
    // tag 132 = 0xd8 0x84, bytes(32) = 0x58 0x20.
    expect(vaultIdLiteral("vault_" + body)).toEqual({ Literal: "d8845820" + body });
    expect(vaultIdLiteral(body)).toEqual({ Literal: "d8845820" + body });
  });

  it("encodes a TemplateAddress as Tag(137, bytes(32))", () => {
    // tag 137 = 0xd8 0x89.
    expect(templateAddressLiteral("template_" + body)).toEqual({ Literal: "d8895820" + body });
    expect(templateAddressLiteral(body)).toEqual({ Literal: "d8895820" + body });
  });

  it("encodes a ClaimedOutputTombstoneAddress as Tag(136, bytes(32))", () => {
    // tag 136 = 0xd8 0x88.
    expect(claimedOutputTombstoneAddressLiteral("tombstone_" + body)).toEqual({ Literal: "d8885820" + body });
    expect(claimedOutputTombstoneAddressLiteral(body)).toEqual({ Literal: "d8885820" + body });
  });

  it("encodes a ValidatorFeePoolAddress as Tag(138, bytes(32))", () => {
    // tag 138 = 0xd8 0x8a.
    expect(validatorFeePoolAddressLiteral("vnfp_" + body)).toEqual({ Literal: "d88a5820" + body });
    expect(validatorFeePoolAddressLiteral(body)).toEqual({ Literal: "d88a5820" + body });
  });

  it("throws when the address body is not 32 bytes", () => {
    expect(() => vaultIdLiteral("vault_abcd")).toThrow(/32 bytes/);
    expect(() => templateAddressLiteral("template_abcd")).toThrow(/32 bytes/);
    expect(() => claimedOutputTombstoneAddressLiteral("tombstone_abcd")).toThrow(/32 bytes/);
    expect(() => validatorFeePoolAddressLiteral("vnfp_abcd")).toThrow(/32 bytes/);
  });

  it("throws when a 64-char body contains non-hex characters", () => {
    expect(() => vaultIdLiteral("vault_" + "zz".repeat(32))).toThrow(/non-hex/);
  });
});

describe("publicKeyLiteral", () => {
  it("encodes a 32-byte hex string as a bare CBOR byte string (untagged)", () => {
    const body = "ab".repeat(32);
    expect(publicKeyLiteral(body)).toEqual({ Literal: "5820" + body });
  });

  it("encodes a 32-byte Uint8Array identically to the hex form", () => {
    const bytes = Uint8Array.from({ length: 32 }, () => 0xab);
    expect(publicKeyLiteral(bytes)).toEqual({ Literal: "5820" + "ab".repeat(32) });
  });

  it("throws when the key is not exactly 32 bytes", () => {
    expect(() => publicKeyLiteral("ab".repeat(31))).toThrow(/must be 32 bytes/);
    expect(() => publicKeyLiteral(Uint8Array.from([1, 2, 3]))).toThrow(/must be 32 bytes/);
  });
});

describe("nonFungibleAddressLiteral", () => {
  const resource = "ab".repeat(32);
  // tag 130 = 0xd8 0x82, then array(2) = 0x82, then the resource address Tag(131, bytes(32)).
  const prefix = "d88282" + "d8835820" + resource;

  it("encodes a U256 id as [resource, [0, [bytes(32)]]]", () => {
    // id: array(2)=82, index 0=00, array(1)=81, bytes(32)=5820.
    const id = "cd".repeat(32);
    expect(nonFungibleAddressLiteral({ resource_address: "resource_" + resource, id: { U256: id } })).toEqual({
      Literal: prefix + "8200815820" + id,
    });
  });

  it("encodes a String id as [resource, [1, ['AB']]]", () => {
    // id: array(2)=82, index 1=01, array(1)=81, text(2)="AB"=62 4142.
    expect(nonFungibleAddressLiteral({ resource_address: resource, id: { String: "AB" } })).toEqual({
      Literal: prefix + "820181624142",
    });
  });

  it("encodes a Uint32 id as [resource, [2, [5]]]", () => {
    // id: array(2)=82, index 2=02, array(1)=81, uint 5=05.
    expect(nonFungibleAddressLiteral({ resource_address: resource, id: { Uint32: 5 } })).toEqual({
      Literal: prefix + "82028105",
    });
  });

  it("encodes a Uint64 id as [resource, [3, [1000]]]", () => {
    // id: array(2)=82, index 3=03, array(1)=81, uint 1000 = 0x19 03e8.
    expect(nonFungibleAddressLiteral({ resource_address: resource, id: { Uint64: 1000 } })).toEqual({
      Literal: prefix + "820381" + "1903e8",
    });
  });

  it("throws when the U256 id is not 32 bytes", () => {
    expect(() => nonFungibleAddressLiteral({ resource_address: resource, id: { U256: "abcd" } })).toThrow(
      /NonFungibleId.U256 must be 32 bytes/,
    );
  });

  it("throws when a Uint32 id exceeds the u32 range", () => {
    expect(() => nonFungibleAddressLiteral({ resource_address: resource, id: { Uint32: 2 ** 32 } })).toThrow(
      /NonFungibleId.Uint32 value .* exceeds its maximum/,
    );
  });

  it("reports the u32 maximum (not MAX_SAFE_INTEGER) for a Uint32 id above 2^53", () => {
    // A wildly out-of-range Uint32 (> MAX_SAFE_INTEGER) must point the caller at the real u32
    // bound (4294967295), not the U256/String guidance that only applies to the Uint64 width.
    const tooBig = () => nonFungibleAddressLiteral({ resource_address: resource, id: { Uint32: 2 ** 54 } });
    expect(tooBig).toThrow(/exceeds its maximum of 4294967295/);
    expect(tooBig).not.toThrow(/MAX_SAFE_INTEGER/);
  });

  it("encodes the largest safe-integer Uint64 id (2^53 - 1)", () => {
    // 2^53 - 1 = 0x1fffffffffffff → uint head 0x1b + 8 bytes.
    expect(
      nonFungibleAddressLiteral({ resource_address: resource, id: { Uint64: 2 ** 53 - 1 } }),
    ).toEqual({ Literal: prefix + "820381" + "1b001fffffffffffff" });
  });

  it("throws on a Uint64 id above MAX_SAFE_INTEGER instead of silently corrupting it (Point 13)", () => {
    expect(() => nonFungibleAddressLiteral({ resource_address: resource, id: { Uint64: 2 ** 53 + 1 } })).toThrow(
      /exceeds Number.MAX_SAFE_INTEGER/,
    );
  });
});

describe("utxoAddressLiteral", () => {
  it("encodes a UtxoAddress as Tag(141, [resource, bytes(32)])", () => {
    // tag 141 = 0xd8 0x8d, array(2) = 0x82, resource Tag(131, bytes(32)), then UtxoId bytes(32).
    const resource = "ab".repeat(32);
    const id = "cd".repeat(32);
    expect(utxoAddressLiteral({ resource_address: "resource_" + resource, id })).toEqual({
      Literal: "d88d82" + "d8835820" + resource + "5820" + id,
    });
  });

  it("throws when the id is not 32 bytes", () => {
    expect(() => utxoAddressLiteral({ resource_address: "ab".repeat(32), id: "abcd" })).toThrow(/must be 32 bytes/);
  });
});

describe("literalArg", () => {
  it("dispatches a bigint to amountLiteral", () => {
    expect(literalArg(1234n)).toEqual(amountLiteral(1234n));
  });

  it("dispatches a string to stringLiteral", () => {
    expect(literalArg("hello")).toEqual(stringLiteral("hello"));
  });

  it("dispatches a boolean to boolLiteral", () => {
    expect(literalArg(true)).toEqual(boolLiteral(true));
  });

  it("dispatches a Uint8Array to bytesLiteral", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    expect(literalArg(bytes)).toEqual(bytesLiteral(bytes));
  });
});
