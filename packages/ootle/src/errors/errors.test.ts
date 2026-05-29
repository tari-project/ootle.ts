//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { describe, expect, it } from "vitest";
import {
  CryptoBridgeError,
  DefaultSignerNotSetError,
  IndexerClientError,
  InvalidArgumentError,
  KeyProviderNotFoundError,
  OotleError,
  SignerError,
  TransactionRejectedError,
  TransactionTimeoutError,
  WalletError,
  assertUnreachable,
} from "./index";

describe("OotleError hierarchy — name, instanceof chain, message", () => {
  it("every subclass sets `name` to its constructor name", () => {
    const cases: [string, OotleError][] = [
      ["IndexerClientError", new IndexerClientError("x")],
      ["TransactionRejectedError", new TransactionRejectedError("x", { txId: "t", reason: "r" })],
      ["TransactionTimeoutError", new TransactionTimeoutError("x", { txId: "t" })],
      ["WalletError", new WalletError("x")],
      ["KeyProviderNotFoundError", new KeyProviderNotFoundError("x", { address: "a" })],
      ["DefaultSignerNotSetError", new DefaultSignerNotSetError("x")],
      ["SignerError", new SignerError("x")],
      ["CryptoBridgeError", new CryptoBridgeError("x")],
      ["InvalidArgumentError", new InvalidArgumentError("x")],
    ];
    for (const [name, err] of cases) {
      expect(err.name).toBe(name);
      expect(err.message).toBe("x");
      expect(err).toBeInstanceOf(OotleError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("WalletError sub-tree shares an `instanceof WalletError`", () => {
    const kp = new KeyProviderNotFoundError("x", { address: "a" });
    const ds = new DefaultSignerNotSetError("x");
    expect(kp).toBeInstanceOf(WalletError);
    expect(ds).toBeInstanceOf(WalletError);
    expect(kp).toBeInstanceOf(OotleError);
    expect(ds).toBeInstanceOf(OotleError);
  });

  it("subclass discrimination is exact — a plain WalletError is NOT a KeyProviderNotFoundError", () => {
    const w = new WalletError("x");
    expect(w).not.toBeInstanceOf(KeyProviderNotFoundError);
    expect(w).not.toBeInstanceOf(DefaultSignerNotSetError);
  });

  it("`OotleError` is not assignable to unrelated subclasses", () => {
    const sig = new SignerError("x");
    expect(sig).not.toBeInstanceOf(WalletError);
    expect(sig).not.toBeInstanceOf(IndexerClientError);
    expect(sig).not.toBeInstanceOf(CryptoBridgeError);
  });
});

describe("structured fields are populated", () => {
  it("IndexerClientError carries status / body / url", () => {
    const e = new IndexerClientError("indexer down", { status: 503, body: "boom", url: "http://idx" });
    expect(e.status).toBe(503);
    expect(e.body).toBe("boom");
    expect(e.url).toBe("http://idx");
  });

  it("IndexerClientError omits optional fields when not supplied", () => {
    const e = new IndexerClientError("idx");
    expect(e.status).toBeUndefined();
    expect(e.body).toBeUndefined();
    expect(e.url).toBeUndefined();
  });

  it("TransactionRejectedError carries txId / reason / rejectReason", () => {
    const reject = { ExecutionFailure: "panic" } as const;
    const e = new TransactionRejectedError("rejected", {
      txId: "tx_123",
      reason: "panic",
      rejectReason: reject,
    });
    expect(e.txId).toBe("tx_123");
    expect(e.reason).toBe("panic");
    expect(e.rejectReason).toBe(reject);
  });

  it("TransactionTimeoutError carries txId", () => {
    const e = new TransactionTimeoutError("timed out", { txId: "tx_late" });
    expect(e.txId).toBe("tx_late");
  });

  it("KeyProviderNotFoundError carries address (typed `unknown`)", () => {
    const e = new KeyProviderNotFoundError("no provider", { address: "component_abc" });
    expect(e.address).toBe("component_abc");
  });

  it("CryptoBridgeError carries optional context label", () => {
    expect(new CryptoBridgeError("boom").context).toBeUndefined();
    expect(new CryptoBridgeError("boom", { context: "unblindOutput" }).context).toBe("unblindOutput");
  });
});

describe("cause-chaining (Node 20+ standard Error.cause)", () => {
  it("InvalidArgumentError preserves a caught cause", () => {
    const inner = new Error("inner");
    const outer = new InvalidArgumentError("outer", { cause: inner });
    expect(outer.cause).toBe(inner);
  });

  it("CryptoBridgeError preserves a caught cause alongside context", () => {
    const inner = new Error("aead failure");
    const outer = new CryptoBridgeError("decryption failed", { context: "unblindOutput", cause: inner });
    expect(outer.cause).toBe(inner);
    expect(outer.context).toBe("unblindOutput");
  });

  it("IndexerClientError preserves a caught cause alongside status / url", () => {
    const inner = new Error("network");
    const outer = new IndexerClientError("Failed to resolve", { status: 500, url: "http://x", cause: inner });
    expect(outer.cause).toBe(inner);
    expect(outer.status).toBe(500);
    expect(outer.url).toBe("http://x");
  });

  it("TransactionRejectedError preserves a caught cause alongside structured fields", () => {
    const inner = new Error("indexer parse");
    const outer = new TransactionRejectedError("rejected", { txId: "t", reason: "r", cause: inner });
    expect(outer.cause).toBe(inner);
    expect(outer.txId).toBe("t");
    expect(outer.reason).toBe("r");
  });
});

describe("assertUnreachable", () => {
  it("throws InvalidArgumentError including the offending value (and optional hint)", () => {
    expect(() => assertUnreachable("oops" as never)).toThrow(InvalidArgumentError);
    expect(() => assertUnreachable("oops" as never, "while-narrowing")).toThrow(/while-narrowing.*"oops"/);
  });
});
