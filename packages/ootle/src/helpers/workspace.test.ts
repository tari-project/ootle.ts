//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit coverage for `parseWorkspaceStringKey` — the helper the
// `TransactionBuilder` workspace machinery uses to interpret keys like
// "bucket.0". Every change to this parser must be backed by a test here first.

import { describe, expect, it } from "vitest";
import { parseWorkspaceStringKey } from "./workspace";

describe("parseWorkspaceStringKey", () => {
  it("returns { name, offset: null } for a bare name", () => {
    expect(parseWorkspaceStringKey("bucket")).toEqual({ name: "bucket", offset: null });
  });

  it("parses dot-notation offset 0 as a numeric offset", () => {
    expect(parseWorkspaceStringKey("bucket.0")).toEqual({ name: "bucket", offset: 0 });
  });

  it("parses multi-digit dot-notation offsets", () => {
    expect(parseWorkspaceStringKey("bucket.5")).toEqual({ name: "bucket", offset: 5 });
  });

  it("throws when more than one dot is present", () => {
    expect(() => parseWorkspaceStringKey("a.b.c")).toThrow("Invalid workspace key format. Only one dot is allowed.");
  });

  it('throws on an empty offset (e.g. "bucket.")', () => {
    expect(() => parseWorkspaceStringKey("bucket.")).toThrow(/Invalid workspace key offset/);
  });

  it('throws on a non-numeric offset (e.g. "bucket.abc")', () => {
    expect(() => parseWorkspaceStringKey("bucket.abc")).toThrow(/Invalid workspace key offset/);
  });
});
