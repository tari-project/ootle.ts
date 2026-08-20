//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// The runtime's `InstructionArg::Literal` variant carries a hex string whose
// bytes are a `tari_bor::encode(value)` payload (CBOR via `ciborium`). The WASM
// signer + engine reject decimal-string Literals: `hashUnsignedTransaction`
// throws `"Odd number of digits"` for odd-length decimals and silently
// re-interprets even-length ones as hex. Every literal must therefore be
// CBOR-encoded by type before being placed in a `Literal`.

import type {
  ClaimedOutputTombstoneAddress,
  ComponentAddress,
  InstructionArg,
  NonFungibleAddress,
  NonFungibleId,
  PublishedTemplateAddress,
  ResourceAddress,
  RistrettoPublicKeyBytes,
  UtxoAddress,
  ValidatorFeePoolAddress,
  VaultId,
} from "@tari-project/ootle-ts-bindings";
import { InvalidArgumentError } from "../errors";
import { assertByteLength } from "./bytes";
import { fromHexStr, toHexStr } from "./hex";

const U64_MASK = (1n << 64n) - 1n;
// RFC 8949 tag 2: unsigned bignum, the form `minicbor` uses above the CBOR integer range.
const BIGNUM_TAG_UNSIGNED = 2n;
const OBJECT_KEY_LEN = 32;
const OBJECT_KEY_HEX_LEN = OBJECT_KEY_LEN * 2;
// A compressed Ristretto point is a bare 32-byte CBOR byte string (untagged).
const PUBLIC_KEY_LEN = 32;

// `tari_template_lib_types::substates::binary_tag` values (the bindings'
// `TariTypeTag` enum). Mirrored locally because the bindings package is CJS and
// its runtime enum value cannot be imported under Node ESM — only its types.
const TAG_COMPONENT_ADDRESS = 128;
const TAG_METADATA = 129;
const TAG_NON_FUNGIBLE_ADDRESS = 130;
const TAG_RESOURCE_ADDRESS = 131;
const TAG_VAULT_ID = 132;
const TAG_CLAIMED_OUTPUT_TOMBSTONE_ADDRESS = 136;
const TAG_TEMPLATE_ADDRESS = 137;
const TAG_VALIDATOR_FEE_POOL = 138;
const TAG_UTXO = 141;

// CBOR major types (RFC 8949), pre-shifted into the high 3 bits of the head byte.
const MAJOR_UINT = 0x00;
const MAJOR_NINT = 0x20;
const MAJOR_BYTES = 0x40;
const MAJOR_TEXT = 0x60;
const MAJOR_ARRAY = 0x80;
const MAJOR_MAP = 0xa0;
const MAJOR_TAG = 0xc0;

/**
 * CBOR-encode a value into an `InstructionArg::Literal` by its JavaScript type:
 * `bigint` → `Amount`, `string` → CBOR text, `boolean` → CBOR bool,
 * `Uint8Array` → CBOR byte string. For tagged on-chain addresses use
 * {@link resourceAddressLiteral} / {@link componentAddressLiteral} instead — a
 * raw address string would be encoded as plain text, not a tagged object key.
 *
 * @throws {InvalidArgumentError} if `value` is not one of the supported types.
 */
export function literalArg(value: bigint | string | boolean | Uint8Array): InstructionArg {
  switch (typeof value) {
    case "bigint":
      return amountLiteral(value);
    case "string":
      return stringLiteral(value);
    case "boolean":
      return boolLiteral(value);
    default:
      if (value instanceof Uint8Array) {
        return bytesLiteral(value);
      }
      throw new InvalidArgumentError(`literalArg: cannot CBOR-encode value of type ${typeof value}`);
  }
}

/**
 * CBOR-encode an `Amount` (u128) the way the runtime's `minicbor` codec does:
 * a plain CBOR unsigned integer while the value fits the CBOR integer range
 * (`0..=u64::MAX`), and an RFC 8949 tag-2 unsigned bignum (minimal-length
 * big-endian byte string) above it.
 *
 * Wire-breaking against the pre-0.39 `[lo_u64, hi_u64]` digit-array form —
 * templates built against an older `tari_template_lib` cannot decode this.
 *
 * @throws {InvalidArgumentError} if `value` is negative or overflows u128.
 */
export function amountLiteral(value: bigint): InstructionArg {
  if (value < 0n) {
    throw new InvalidArgumentError(`amountLiteral: amount must be non-negative, got ${value}`);
  }
  if (value >> 128n !== 0n) {
    throw new InvalidArgumentError(`amountLiteral: amount overflows u128: ${value}`);
  }
  const out: number[] = [];
  if (value <= U64_MASK) {
    appendHead(out, MAJOR_UINT, value);
  } else {
    appendBignum(out, value);
  }
  return literal(out);
}

/**
 * Append an RFC 8949 unsigned bignum: `Tag(2, bytes(<minimal big-endian>))`.
 * `minicbor` emits the shortest byte string that represents the value, so a
 * `u64::MAX + 1` is nine bytes, not a zero-padded sixteen.
 */
function appendBignum(out: number[], value: bigint): void {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0n) {
    bytes.unshift(Number(rest & 0xffn));
    rest >>= 8n;
  }
  appendHead(out, MAJOR_TAG, BIGNUM_TAG_UNSIGNED);
  appendHead(out, MAJOR_BYTES, BigInt(bytes.length));
  appendBytes(out, bytes);
}

/**
 * CBOR-encode a plain integer (Rust `u8`…`u128` / `i8`…`i128`) as a bare CBOR
 * integer. Distinct from {@link amountLiteral} only above the CBOR integer
 * range, where an `Amount` becomes a tag-2 bignum and this throws instead.
 *
 * @throws {InvalidArgumentError} if the magnitude exceeds the 64-bit CBOR
 *   integer range (128-bit bignum encoding is not supported).
 */
export function intLiteral(value: bigint): InstructionArg {
  const out: number[] = [];
  if (value >= 0n) {
    if (value > U64_MASK) {
      throw new InvalidArgumentError(`intLiteral: value exceeds the 64-bit CBOR integer range: ${value}`);
    }
    appendHead(out, MAJOR_UINT, value);
  } else {
    const encoded = -1n - value;
    if (encoded > U64_MASK) {
      throw new InvalidArgumentError(`intLiteral: value exceeds the 64-bit CBOR integer range: ${value}`);
    }
    appendHead(out, MAJOR_NINT, encoded);
  }
  return literal(out);
}

/** CBOR-encode a `String` as a CBOR text string. */
export function stringLiteral(value: string): InstructionArg {
  const out: number[] = [];
  appendText(out, value);
  return literal(out);
}

/** CBOR-encode a `Vec<u8>` as a CBOR byte string. */
export function bytesLiteral(value: Uint8Array): InstructionArg {
  const out: number[] = [];
  appendHead(out, MAJOR_BYTES, BigInt(value.length));
  appendBytes(out, value);
  return literal(out);
}

/** CBOR-encode a `bool` as a CBOR boolean primitive. */
export function boolLiteral(value: boolean): InstructionArg {
  return { Literal: value ? "f5" : "f4" };
}

/**
 * CBOR-encode a `ResourceAddress` as `Tag(131, bytes(32))`. Accepts either the
 * `resource_<hex>` form or the bare 64-hex-char tail.
 *
 * @throws {InvalidArgumentError} if the address body is not 32 bytes (64 hex chars).
 */
export function resourceAddressLiteral(address: ResourceAddress): InstructionArg {
  return objectKeyLiteral(TAG_RESOURCE_ADDRESS, address, "resource_");
}

/**
 * CBOR-encode a `ComponentAddress` as `Tag(128, bytes(32))`. Accepts either the
 * `component_<hex>` form or the bare 64-hex-char tail.
 *
 * @throws {InvalidArgumentError} if the address body is not 32 bytes (64 hex chars).
 */
export function componentAddressLiteral(address: ComponentAddress): InstructionArg {
  return objectKeyLiteral(TAG_COMPONENT_ADDRESS, address, "component_");
}

/**
 * CBOR-encode a `Metadata` map as `Tag(129, Map<text, text>)`. Keys are emitted
 * sorted to match the runtime's `BTreeMap` ordering.
 */
export function metadataLiteral(entries: Record<string, string> | Map<string, string>): InstructionArg {
  const map = entries instanceof Map ? entries : new Map(Object.entries(entries));
  // Sort by UTF-8 byte (= code-point) order to match Rust `BTreeMap<String>`, which the
  // runtime hashes. UTF-16 code-unit order (the default JS string comparison) diverges for
  // astral keys (U+10000+ vs U+E000–U+FFFF), which would reorder the map and change the hash.
  const enc = new TextEncoder();
  const sorted = [...map.entries()].sort(([a], [b]) => compareUtf8(enc.encode(a), enc.encode(b)));
  const out: number[] = [];
  appendHead(out, MAJOR_TAG, BigInt(TAG_METADATA));
  appendHead(out, MAJOR_MAP, BigInt(sorted.length));
  for (const [key, value] of sorted) {
    appendText(out, key);
    appendText(out, value);
  }
  return literal(out);
}

/**
 * CBOR-encode a `VaultId` as `Tag(132, bytes(32))`. Accepts either the
 * `vault_<hex>` form or the bare 64-hex-char tail.
 *
 * @throws {InvalidArgumentError} if the address body is not 32 bytes (64 hex chars).
 */
export function vaultIdLiteral(address: VaultId): InstructionArg {
  return objectKeyLiteral(TAG_VAULT_ID, address, "vault_");
}

/**
 * CBOR-encode a `PublishedTemplateAddress` as `Tag(137, bytes(32))`. Accepts
 * either the `template_<hex>` form or the bare 64-hex-char tail.
 *
 * @throws {InvalidArgumentError} if the address body is not 32 bytes (64 hex chars).
 */
export function templateAddressLiteral(address: PublishedTemplateAddress): InstructionArg {
  return objectKeyLiteral(TAG_TEMPLATE_ADDRESS, address, "template_");
}

/**
 * CBOR-encode a `ClaimedOutputTombstoneAddress` as `Tag(136, bytes(32))`.
 * Accepts either the `tombstone_<hex>` form or the bare 64-hex-char tail.
 *
 * @throws {InvalidArgumentError} if the address body is not 32 bytes (64 hex chars).
 */
export function claimedOutputTombstoneAddressLiteral(address: ClaimedOutputTombstoneAddress): InstructionArg {
  return objectKeyLiteral(TAG_CLAIMED_OUTPUT_TOMBSTONE_ADDRESS, address, "tombstone_");
}

/**
 * CBOR-encode a `ValidatorFeePoolAddress` as `Tag(138, bytes(32))`. Accepts
 * either the `vnfp_<hex>` form or the bare 64-hex-char tail.
 *
 * @throws {InvalidArgumentError} if the address body is not 32 bytes (64 hex chars).
 */
export function validatorFeePoolAddressLiteral(address: ValidatorFeePoolAddress): InstructionArg {
  return objectKeyLiteral(TAG_VALIDATOR_FEE_POOL, address, "vnfp_");
}

/**
 * CBOR-encode a `RistrettoPublicKeyBytes` as a 32-byte CBOR byte string. A
 * compressed Ristretto point is *not* a tagged value — it is a bare byte string,
 * the same shape {@link bytesLiteral} produces. Accepts a 64-hex-char string or
 * a 32-byte `Uint8Array`; this wrapper exists so the public-key intent and the
 * length check are explicit at the call site.
 *
 * @throws {InvalidArgumentError} if the key is not exactly 32 bytes.
 */
export function publicKeyLiteral(value: RistrettoPublicKeyBytes | Uint8Array): InstructionArg {
  const bytes = typeof value === "string" ? fromHexStr(value) : value;
  assertByteLength(bytes, PUBLIC_KEY_LEN, "publicKeyLiteral");
  return bytesLiteral(bytes);
}

/**
 * CBOR-encode a `NonFungibleAddress` as `Tag(130, [ResourceAddress, NonFungibleId])`.
 * The inner pair is minicbor's struct-as-array layout; the `NonFungibleId` enum
 * is its two-element `[variant_index, [field]]` form.
 *
 * @throws {InvalidArgumentError} if the resource address or id payload is malformed.
 */
export function nonFungibleAddressLiteral(address: NonFungibleAddress): InstructionArg {
  const out: number[] = [];
  appendHead(out, MAJOR_TAG, BigInt(TAG_NON_FUNGIBLE_ADDRESS));
  appendHead(out, MAJOR_ARRAY, 2n);
  appendObjectKey(out, TAG_RESOURCE_ADDRESS, address.resource_address, "resource_");
  appendNonFungibleId(out, address.id);
  return literal(out);
}

/**
 * CBOR-encode a `UtxoAddress` as `Tag(141, [ResourceAddress, UtxoId])`, where the
 * `UtxoId` is the 32-byte commitment byte string.
 *
 * @throws {InvalidArgumentError} if the resource address or id is not 32 bytes.
 */
export function utxoAddressLiteral(address: UtxoAddress): InstructionArg {
  const out: number[] = [];
  appendHead(out, MAJOR_TAG, BigInt(TAG_UTXO));
  appendHead(out, MAJOR_ARRAY, 2n);
  appendObjectKey(out, TAG_RESOURCE_ADDRESS, address.resource_address, "resource_");
  const id = fromHexStr(address.id);
  assertByteLength(id, OBJECT_KEY_LEN, "utxoAddressLiteral: id");
  appendHead(out, MAJOR_BYTES, BigInt(OBJECT_KEY_LEN));
  appendBytes(out, id);
  return literal(out);
}

function objectKeyLiteral(tag: number, address: string, prefix: string): InstructionArg {
  const out: number[] = [];
  appendObjectKey(out, tag, address, prefix);
  return literal(out);
}

/** Append `Tag(tag, bytes(32))` for a bech32-style 32-byte `ObjectKey` address. */
function appendObjectKey(out: number[], tag: number, address: string, prefix: string): void {
  const hex = address.startsWith(prefix) ? address.slice(prefix.length) : address;
  if (hex.length !== OBJECT_KEY_HEX_LEN) {
    throw new InvalidArgumentError(
      `${prefix}address must be 32 bytes (${OBJECT_KEY_HEX_LEN} hex chars), got ${hex.length}`,
    );
  }
  appendHead(out, MAJOR_TAG, BigInt(tag));
  appendHead(out, MAJOR_BYTES, BigInt(OBJECT_KEY_LEN));
  appendBytes(out, fromHexStr(hex));
}

/**
 * Append a `NonFungibleId` in minicbor's default enum form: a two-element array
 * `[variant_index, [field]]` (the field itself wrapped in a single-element
 * struct-as-array). Variant indices match the Rust `enum NonFungibleId`:
 * `U256` = 0, `String` = 1, `Uint32` = 2, `Uint64` = 3.
 */
function appendNonFungibleId(out: number[], id: NonFungibleId): void {
  appendHead(out, MAJOR_ARRAY, 2n);
  if ("U256" in id) {
    appendHead(out, MAJOR_UINT, 0n);
    appendHead(out, MAJOR_ARRAY, 1n);
    const bytes = fromHexStr(id.U256);
    assertByteLength(bytes, OBJECT_KEY_LEN, "NonFungibleId.U256");
    appendHead(out, MAJOR_BYTES, BigInt(OBJECT_KEY_LEN));
    appendBytes(out, bytes);
  } else if ("String" in id) {
    appendHead(out, MAJOR_UINT, 1n);
    appendHead(out, MAJOR_ARRAY, 1n);
    appendText(out, id.String);
  } else if ("Uint32" in id) {
    appendHead(out, MAJOR_UINT, 2n);
    appendHead(out, MAJOR_ARRAY, 1n);
    appendUint(out, id.Uint32, "NonFungibleId.Uint32", (1n << 32n) - 1n);
  } else if ("Uint64" in id) {
    appendHead(out, MAJOR_UINT, 3n);
    appendHead(out, MAJOR_ARRAY, 1n);
    appendUint(out, id.Uint64, "NonFungibleId.Uint64", U64_MASK);
  } else {
    throw new InvalidArgumentError(
      `nonFungibleAddressLiteral: unrecognised NonFungibleId variant: ${JSON.stringify(id)}`,
    );
  }
}

function appendUint(out: number[], value: number, name: string, max: bigint): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidArgumentError(`${name} must be a non-negative integer, got ${value}`);
  }
  // The MAX_SAFE_INTEGER guard only applies to widths whose maximum exceeds 2^53 (Uint64):
  // the binding types the id as a JS number, so a value above MAX_SAFE_INTEGER has already
  // lost precision and a U256/String id is the right fix. For a narrower width (Uint32, max
  // 2^32-1) the accurate bound is the per-width maximum below — checking MAX_SAFE_INTEGER
  // first would wrongly tell a caller with an out-of-range Uint32 to use a U256/String id.
  if (max > BigInt(Number.MAX_SAFE_INTEGER) && value > Number.MAX_SAFE_INTEGER) {
    throw new InvalidArgumentError(
      `${name} value ${value} exceeds Number.MAX_SAFE_INTEGER (2^53-1) and cannot be encoded ` +
        `without precision loss — the binding types this id as a JS number. Use a U256/String id for large values.`,
    );
  }
  const n = BigInt(value);
  if (n > max) {
    throw new InvalidArgumentError(`${name} value ${value} exceeds its maximum of ${max}`);
  }
  appendHead(out, MAJOR_UINT, n);
}

function appendText(out: number[], value: string): void {
  const utf8 = new TextEncoder().encode(value);
  appendHead(out, MAJOR_TEXT, BigInt(utf8.length));
  appendBytes(out, utf8);
}

/**
 * Append a byte sequence to the accumulator without the `push(...spread)`
 * argument-count limit, which overflows the stack at ~100k+ elements.
 *
 * Pre-grows `out` to its final length in one step so large appends don't pay
 * for repeated dynamic resizing under the hood, then fills by index.
 */
function appendBytes(out: number[], bytes: ArrayLike<number>): void {
  const base = out.length;
  out.length = base + bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    out[base + i] = bytes[i];
  }
}

/** Lexicographically compare two byte arrays (shorter-is-less on a common prefix). */
function compareUtf8(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return a.length - b.length;
}

/** Append a CBOR head: the `major`-typed initial byte plus minimal-length argument `n`. */
function appendHead(out: number[], major: number, n: bigint): void {
  if (n < 24n) {
    out.push(major | Number(n));
  } else if (n < 1n << 8n) {
    out.push(major | 24, Number(n));
  } else if (n < 1n << 16n) {
    out.push(major | 25, Number((n >> 8n) & 0xffn), Number(n & 0xffn));
  } else if (n < 1n << 32n) {
    out.push(
      major | 26,
      Number((n >> 24n) & 0xffn),
      Number((n >> 16n) & 0xffn),
      Number((n >> 8n) & 0xffn),
      Number(n & 0xffn),
    );
  } else {
    out.push(
      major | 27,
      Number((n >> 56n) & 0xffn),
      Number((n >> 48n) & 0xffn),
      Number((n >> 40n) & 0xffn),
      Number((n >> 32n) & 0xffn),
      Number((n >> 24n) & 0xffn),
      Number((n >> 16n) & 0xffn),
      Number((n >> 8n) & 0xffn),
      Number(n & 0xffn),
    );
  }
}

function literal(bytes: number[]): InstructionArg {
  return { Literal: toHexStr(Uint8Array.from(bytes)) };
}
