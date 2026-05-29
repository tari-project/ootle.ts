//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { InvalidArgumentError } from "../errors";

/**
 * A parsed workspace key string into an object with name and optional offset.
 *
 * Examples:
 *   "bucket"   -> { name: "bucket", offset: null }
 *   "bucket.0" -> { name: "bucket", offset: 0 }
 */
export interface ParsedWorkspaceKey {
  name: string;
  offset: number | null;
}

/**
 * Parses a workspace key string, supporting dot-notation offsets.
 *
 * @example
 *   parseWorkspaceStringKey("bucket")   // { name: "bucket", offset: null }
 *   parseWorkspaceStringKey("bucket.0") // { name: "bucket", offset: 0 }
 *   parseWorkspaceStringKey("bucket.1") // { name: "bucket", offset: 1 }
 *
 * @throws {InvalidArgumentError} if the key contains more than one dot, or if the
 *   suffix after the dot is empty / non-numeric / negative.
 */
export function parseWorkspaceStringKey(key: string): ParsedWorkspaceKey {
  const parts = key.split(".");
  if (parts.length > 2) {
    throw new InvalidArgumentError("Invalid workspace key format. Only one dot is allowed.");
  }
  const name = parts[0];
  if (parts[1] === undefined) {
    return { name, offset: null };
  }
  const offset = Number.parseInt(parts[1], 10);
  if (Number.isNaN(offset) || offset < 0 || String(offset) !== parts[1]) {
    throw new InvalidArgumentError(`Invalid workspace key offset: "${parts[1]}"`);
  }
  return { name, offset };
}
