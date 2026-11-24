//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Builders for template arguments that are Rust structs, enums and lists. They write the
// layout `minicbor`'s derive macros use, which is what a template decodes its arguments with:
//
// - a struct is the array of its fields, each at its `#[n(i)]` index;
// - an enum value is `[variant_index, [fields]]`, the fields laid out like a struct's;
// - a `Vec` or tuple is an array; `Option::None` is null and `Some(x)` is `x` itself;
// - a map is a CBOR map, a `BTreeMap` in key order.
//
// The indices are not in a template's ABI, so the caller takes them from the Rust type.

import type { InstructionArg } from "@tari-project/ootle-ts-bindings";
import { InvalidArgumentError } from "../errors";
import { fromHexStr } from "./hex";
import {
  amountLiteral,
  boolLiteral,
  bytesLiteral,
  intLiteral,
  listLiteral,
  mapLiteral,
  noneLiteral,
  stringLiteral,
} from "./cbor-literal";

/** Something that encodes itself as a template argument, such as one of the builders here. */
export interface CborEncodable {
  toLiteral(): InstructionArg;
}

/**
 * A value a builder accepts:
 *
 * - an already-encoded `Literal` (e.g. from `resourceAddressLiteral`) or a builder;
 * - `string` → CBOR text, `boolean`, `Uint8Array` → CBOR bytes;
 * - `number` (an integer) or `bigint` → a CBOR integer, which is also how an `Amount` is written;
 * - `null`/`undefined` → `Option::None`;
 * - an array → a `Vec` of its encoded elements.
 *
 * A string is always text: an address must go through its own literal helper, which writes
 * the tagged form a template expects.
 */
export type CborValue =
  | InstructionArg
  | CborEncodable
  | string
  | number
  | bigint
  | boolean
  | Uint8Array
  | null
  | undefined
  | CborValue[];

/**
 * Encodes `value` as a template argument. See {@link CborValue} for how each type is written.
 *
 * @throws {InvalidArgumentError} if `value` is a non-integer number, a workspace or blob
 *   reference, or an object that is none of the accepted kinds.
 */
export function cborLiteral(value: CborValue): InstructionArg {
  if (value === null || value === undefined) {
    return noneLiteral();
  }
  switch (typeof value) {
    case "string":
      return stringLiteral(value);
    case "boolean":
      return boolLiteral(value);
    case "bigint":
      // `amountLiteral` writes a plain integer up to `u64::MAX` and a bignum above it, as
      // `minicbor` does for `u128`.
      return value >= 0n ? amountLiteral(value) : intLiteral(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new InvalidArgumentError(`cborLiteral: ${value} is not a safe integer; pass a bigint for large values`);
      }
      return intLiteral(BigInt(value));
    case "object":
      if (Array.isArray(value)) {
        return listLiteral(value.map(cborLiteral));
      }
      if (value instanceof Uint8Array) {
        return bytesLiteral(value);
      }
      if ("toLiteral" in value && typeof value.toLiteral === "function") {
        return value.toLiteral();
      }
      if ("Literal" in value) {
        return value;
      }
  }
  throw new InvalidArgumentError(`cborLiteral: cannot encode ${JSON.stringify(value)}`);
}

// A field index is a `#[n(i)]` attribute. The bound only stops a mistyped index from
// allocating a huge array of nulls.
const MAX_FIELD_INDEX = 255;

/** Fields placed by index: unset indices below the highest one are null. */
class IndexedFields {
  private readonly fields = new Map<number, CborValue>();

  public set(index: number, value: CborValue, owner: string): void {
    if (!Number.isInteger(index) || index < 0 || index > MAX_FIELD_INDEX) {
      throw new InvalidArgumentError(
        `${owner}: field index must be an integer from 0 to ${MAX_FIELD_INDEX}, got ${index}`,
      );
    }
    if (this.fields.has(index)) {
      throw new InvalidArgumentError(`${owner}: field ${index} is already set`);
    }
    this.fields.set(index, value);
  }

  public toLiteral(): InstructionArg {
    const length = this.fields.size === 0 ? 0 : Math.max(...this.fields.keys()) + 1;
    return listLiteral(Array.from({ length }, (_, index) => cborLiteral(this.fields.get(index))));
  }
}

/** Builds a Rust struct argument. Create one with {@link CborBuilder.struct}. */
export class CborStructBuilder implements CborEncodable {
  private readonly fields = new IndexedFields();

  /**
   * Sets the field whose Rust attribute is `#[n(index)]`. Leave an `Option` field that is
   * `None` unset: unset fields below the highest index become null, and trailing ones are
   * dropped, as the Rust encoder does.
   *
   * @throws {InvalidArgumentError} if `index` is out of range or already set.
   */
  public field(index: number, value: CborValue): this {
    this.fields.set(index, value, "CborStructBuilder");
    return this;
  }

  /** Encodes the struct. A builder nested in another does not need this: its parent calls it. */
  public finish(): InstructionArg {
    return this.fields.toLiteral();
  }

  public toLiteral(): InstructionArg {
    return this.finish();
  }
}

/** Builds a `Vec` or tuple argument. Create one with {@link CborBuilder.array}. */
export class CborArrayBuilder implements CborEncodable {
  private readonly items: CborValue[];

  public constructor(items: CborValue[] = []) {
    this.items = [...items];
  }

  public add(value: CborValue): this {
    this.items.push(value);
    return this;
  }

  public addAll(values: CborValue[]): this {
    this.items.push(...values);
    return this;
  }

  /** Encodes the array. A builder nested in another does not need this: its parent calls it. */
  public finish(): InstructionArg {
    return cborLiteral(this.items);
  }

  public toLiteral(): InstructionArg {
    return this.finish();
  }
}

/** A map key, sorted the way Rust orders the key type. */
type MapKey =
  | { kind: "text"; bytes: Uint8Array }
  | { kind: "integer"; value: bigint }
  | { kind: "encoded"; bytes: Uint8Array };

function mapKey(key: CborValue): MapKey {
  if (typeof key === "string") {
    return { kind: "text", bytes: new TextEncoder().encode(key) };
  }
  if (typeof key === "bigint" || typeof key === "number") {
    // `cborLiteral` rejects a non-integer number before this is used.
    return { kind: "integer", value: typeof key === "bigint" ? key : BigInt(Math.trunc(key)) };
  }
  if (key instanceof Uint8Array || (typeof key === "object" && key !== null && !Array.isArray(key))) {
    const literal = cborLiteral(key);
    if ("Literal" in literal) {
      return { kind: "encoded", bytes: fromHexStr(literal.Literal) };
    }
  }
  throw new InvalidArgumentError(`CborMapBuilder: a key must be a string, an integer, bytes or a literal`);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

function compareKeys(a: MapKey, b: MapKey): number {
  if (a.kind === "integer" && b.kind === "integer") {
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  }
  if (a.kind === "integer" || b.kind === "integer") {
    throw new InvalidArgumentError("CborMapBuilder: keys must all be of one kind");
  }
  return compareBytes(a.bytes, b.bytes);
}

/** Builds a Rust `BTreeMap` (or `HashMap`) argument. Create one with {@link CborBuilder.map}. */
export class CborMapBuilder implements CborEncodable {
  private readonly entries: { key: CborValue; value: CborValue }[] = [];

  /**
   * Adds an entry. Keys must all be of one kind: strings, integers, or fixed-size encoded
   * values such as addresses, public keys and hashes (a literal or a `Uint8Array`).
   */
  public entry(key: CborValue, value: CborValue): this {
    this.entries.push({ key, value });
    return this;
  }

  /**
   * Encodes the map with its entries in key order, as Rust writes a `BTreeMap`: strings by
   * their UTF-8 bytes, integers by value, and encoded keys by their bytes. A builder nested in
   * another does not need this: its parent calls it.
   *
   * @throws {InvalidArgumentError} if the keys are of mixed kinds, a key is repeated, or
   *   encoded keys differ in length (their Rust order is then not their byte order).
   */
  public finish(): InstructionArg {
    const keyed = this.entries.map(({ key, value }) => ({ sort: mapKey(key), key: cborLiteral(key), value }));
    const kinds = new Set(keyed.map((entry) => entry.sort.kind));
    if (kinds.size > 1) {
      throw new InvalidArgumentError("CborMapBuilder: keys must all be of one kind");
    }
    if (
      kinds.has("encoded") &&
      new Set(keyed.map((e) => (e.sort.kind === "encoded" ? e.sort.bytes.length : 0))).size > 1
    ) {
      throw new InvalidArgumentError("CborMapBuilder: encoded keys must all have the same length");
    }
    keyed.sort((a, b) => compareKeys(a.sort, b.sort));
    keyed.forEach((entry, i) => {
      if (i > 0 && compareKeys(keyed[i - 1].sort, entry.sort) === 0) {
        throw new InvalidArgumentError(`CborMapBuilder: a key is set more than once`);
      }
    });
    return mapLiteral(keyed.map((entry) => [entry.key, cborLiteral(entry.value)]));
  }

  public toLiteral(): InstructionArg {
    return this.finish();
  }
}

/** Builds a Rust enum argument. Create one with {@link CborBuilder.variant}. */
export class CborVariantBuilder implements CborEncodable {
  private readonly fields = new IndexedFields();

  public constructor(private readonly index: number) {
    if (!Number.isInteger(index) || index < 0) {
      throw new InvalidArgumentError(`CborVariantBuilder: variant index must be a non-negative integer, got ${index}`);
    }
  }

  /**
   * Sets the variant's field whose Rust attribute is `#[n(index)]`. A tuple variant's fields
   * are numbered the same way. A unit variant has no fields.
   *
   * @throws {InvalidArgumentError} if `index` is out of range or already set.
   */
  public field(index: number, value: CborValue): this {
    this.fields.set(index, value, "CborVariantBuilder");
    return this;
  }

  /** Encodes the variant. A builder nested in another does not need this: its parent calls it. */
  public finish(): InstructionArg {
    return listLiteral([intLiteral(BigInt(this.index)), this.fields.toLiteral()]);
  }

  public toLiteral(): InstructionArg {
    return this.finish();
  }
}

/**
 * Entry point for building struct, enum, list and map arguments. Builders nest: pass one to
 * another's `field`/`add`, and call `finish()` on the outermost only.
 *
 * ```ts
 * const arg = CborBuilder.struct()
 *   .field(0, "name")
 *   .field(1, CborBuilder.array([1, 2, 3]))
 *   .field(2, CborBuilder.variant(1).field(0, true))
 *   .finish();
 * ```
 */
export const CborBuilder = {
  /** A Rust struct: fields are set by their `#[n(i)]` index. */
  struct: (): CborStructBuilder => new CborStructBuilder(),
  /** A `Vec` or tuple. */
  array: (items: CborValue[] = []): CborArrayBuilder => new CborArrayBuilder(items),
  /**
   * A Rust enum value: `index` is the variant's `#[n(i)]`. An enum marked
   * `#[cbor(index_only)]` is written as the bare index instead: pass the number itself.
   */
  variant: (index: number): CborVariantBuilder => new CborVariantBuilder(index),
  /** A `BTreeMap` or `HashMap`. Entries are written in key order, whatever order they were added in. */
  map: (): CborMapBuilder => new CborMapBuilder(),
} as const;
