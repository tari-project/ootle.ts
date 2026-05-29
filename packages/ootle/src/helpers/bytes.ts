//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { InvalidArgumentError } from "../errors";

/**
 * Asserts that `bytes` has exactly `length` bytes; otherwise throws with a
 * descriptive message. Returns `bytes` so the assertion can be used inline in a
 * property initialiser or destructuring expression.
 *
 * Message format deliberately mirrors the existing stealth-side inline checks
 * (e.g. `Mask must be 32 bytes, got 31`).
 *
 * @throws {InvalidArgumentError} when the length does not match.
 */
export function assertByteLength(bytes: Uint8Array, length: number, name: string): Uint8Array {
  if (bytes.length !== length) {
    throw new InvalidArgumentError(`${name} must be ${length} bytes, got ${bytes.length}`);
  }
  return bytes;
}
