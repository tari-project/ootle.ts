//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// The runtime's `InstructionArg::Literal` variant carries a hex string whose
// bytes are a `tari_bor::encode(value)` payload (CBOR with deterministic
// length-encoded integers). The SDK exposes the wrapped `{ Literal: hex }` shape
// via `amountLiteral` / `resourceAddressLiteral`; the examples keep the bare-hex
// variants because several call sites embed the hex into a hand-rolled
// `InstructionArg` object next to a `Workspace` argument.

import type { Amount, ResourceAddress } from "@tari-project/ootle-ts-bindings";

const U64_MASK = (1n << 64n) - 1n;

function appendCborUint(out: number[], n: bigint): void {
  if (n < 0n) throw new Error(`appendCborUint: expected non-negative, got ${n}`);
  if (n < 24n) {
    out.push(Number(n));
  } else if (n < 1n << 8n) {
    out.push(0x18, Number(n));
  } else if (n < 1n << 16n) {
    out.push(0x19, Number((n >> 8n) & 0xffn), Number(n & 0xffn));
  } else if (n < 1n << 32n) {
    out.push(
      0x1a,
      Number((n >> 24n) & 0xffn),
      Number((n >> 16n) & 0xffn),
      Number((n >> 8n) & 0xffn),
      Number(n & 0xffn),
    );
  } else if (n < 1n << 64n) {
    out.push(
      0x1b,
      Number((n >> 56n) & 0xffn),
      Number((n >> 48n) & 0xffn),
      Number((n >> 40n) & 0xffn),
      Number((n >> 32n) & 0xffn),
      Number((n >> 24n) & 0xffn),
      Number((n >> 16n) & 0xffn),
      Number((n >> 8n) & 0xffn),
      Number(n & 0xffn),
    );
  } else {
    throw new Error(`appendCborUint: u64 overflow (${n})`);
  }
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * CBOR-encode an `Amount` (u128) the way the runtime's `minicbor` codec does: a plain
 * CBOR unsigned integer up to `u64::MAX`, and an RFC 8949 tag-2 unsigned bignum
 * (minimal-length big-endian bytes) above it. Returns the hex form for
 * `InstructionArg::Literal`.
 */
export function amountLiteralHex(value: Amount | bigint | number): string {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) throw new Error(`amount must be non-negative, got ${n}`);
  if (n >> 128n !== 0n) throw new Error(`amount overflows u128: ${n}`);
  const out: number[] = [];
  if (n <= U64_MASK) {
    appendCborUint(out, n);
    return bytesToHex(out);
  }
  const be: number[] = [];
  let rest = n;
  while (rest > 0n) {
    be.unshift(Number(rest & 0xffn));
    rest >>= 8n;
  }
  // Tag(2), then a byte string of `be.length` bytes. The length is 9..16 here, i.e.
  // below 24, so it rides in the head byte itself (0x40 | len) — 2^64 encodes as
  // `c249 01 00×8`, matching the runtime.
  out.push(0xc2, 0x40 | be.length, ...be);
  return bytesToHex(out);
}

/**
 * CBOR-encode a `ResourceAddress` as `Tag(131, bytes(32))` (the
 * `BinaryTag::ResourceAddress` shape). Returns the hex form for
 * `InstructionArg::Literal`.
 */
export function resourceAddressLiteralHex(address: ResourceAddress): string {
  const hex = address.startsWith("resource_") ? address.slice("resource_".length) : address;
  if (hex.length !== 64) {
    throw new Error(`resource address must be 32 bytes (64 hex chars), got ${hex.length}`);
  }
  const out: number[] = [0xd8, 0x83, 0x58, 0x20];
  for (let i = 0; i < 64; i += 2) {
    out.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return bytesToHex(out);
}
