//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "./errors";
import { toHexStr } from "./helpers/hex";
import { canonicalAuthorizers, collectAuthorizers, encodeAuthorizerSet } from "./transaction";
import type { Signer } from "./signer";

const key = (byte: number): Uint8Array => new Uint8Array(32).fill(byte);

describe("canonicalAuthorizers", () => {
  it("sorts ascending by bytes and drops repeats", () => {
    const keys = canonicalAuthorizers([key(0x30), key(0x10), key(0x20), key(0x10)]);
    expect(keys.map(toHexStr)).toEqual([key(0x10), key(0x20), key(0x30)].map(toHexStr));
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => canonicalAuthorizers([new Uint8Array(31)])).toThrow(InvalidArgumentError);
  });
});

describe("encodeAuthorizerSet", () => {
  it("concatenates the canonical keys", () => {
    const encoded = encodeAuthorizerSet([key(0x02), key(0x01)]);
    expect(toHexStr(encoded)).toBe(toHexStr(key(0x01)) + toHexStr(key(0x02)));
  });

  it("encodes an empty set as no bytes", () => {
    expect(encodeAuthorizerSet([])).toHaveLength(0);
  });
});

describe("collectAuthorizers", () => {
  const signer = (publicKey: Uint8Array, authorizers?: Uint8Array[]): Signer => ({
    getAddress: () => Promise.resolve("addr"),
    getPublicKey: () => Promise.resolve(publicKey),
    signTransaction: () => Promise.resolve([]),
    ...(authorizers === undefined ? {} : { getAuthorizerPublicKeys: () => Promise.resolve(authorizers) }),
  });

  it("uses getPublicKey by default and getAuthorizerPublicKeys when a signer has it", async () => {
    const keys = await collectAuthorizers([signer(key(0x03)), signer(key(0xff), [key(0x01), key(0x02)])]);
    expect(keys.map(toHexStr)).toEqual([key(0x01), key(0x02), key(0x03)].map(toHexStr));
  });
});
