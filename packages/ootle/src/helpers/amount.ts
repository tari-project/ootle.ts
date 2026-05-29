//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { InstructionArg } from "@tari-project/ootle-ts-bindings";
import { InvalidArgumentError } from "../errors";
import { amountLiteral } from "./cbor-literal";

/**
 * Encodes a µTari amount as a BOR-CBOR-encoded hex `Literal` instruction argument.
 *
 * Delegates to {@link amountLiteral}: the runtime's `InstructionArg::Literal` carries
 * a hex string whose bytes are a `tari_bor::encode(value)` CBOR payload, **not** the
 * decimal-string form. Keeping the public type as `bigint` preserves precision for
 * values above `Number.MAX_SAFE_INTEGER`.
 *
 * @throws {InvalidArgumentError} if `amount` is negative or overflows u128.
 */
export function microTariLiteral(amount: bigint): InstructionArg {
  return amountLiteral(amount);
}

/**
 * Canonical µTari → decimal-string encoding used wherever the bindings expect a
 * string-encoded amount on the wire (e.g. structural `toJSON()` views of stealth
 * statements). **Not** the BOR-CBOR `Literal` form — use {@link microTariLiteral}
 * / {@link amountLiteral} for instruction arguments.
 *
 * @throws {InvalidArgumentError} if `amount` is negative.
 */
export function microTariString(amount: bigint): string {
  if (amount < 0n) {
    throw new InvalidArgumentError(`microTariString: amount must be non-negative, got ${amount}`);
  }
  return amount.toString();
}
