//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Sanity check that the package's public exports map resolves the surface a
// downstream consumer expects. The conditional `exports` map in `package.json`
// routes `types` first, then `browser`/`node`/`import`/`default` — this test
// imports through the published path the same way an external SDK user would,
// so a rename-but-forgot-to-re-export regression fails the suite.
//
// Intentionally minimal: it asserts presence (`typeof`) and class identity
// (`name`), not behaviour — every class has its own dedicated test file.

import { describe, expect, it } from "vitest";
import {
  // encoding / wire helpers
  microTariLiteral,
  microTariString,
  assertByteLength,
  // error hierarchy
  OotleError,
  IndexerClientError,
  TransactionRejectedError,
  TransactionTimeoutError,
  WalletError,
  KeyProviderNotFoundError,
  DefaultSignerNotSetError,
  SignerError,
  CryptoBridgeError,
  InvalidArgumentError,
  // existing public surface
  TransactionBuilder,
  MAX_TRANSACTION_VALIDITY_EPOCHS,
  DEFAULT_TRANSACTION_VALIDITY_EPOCHS,
  resolveMaxEpoch,
  OotleWallet,
  Network,
  toHexStr,
  fromHexStr,
} from "./index";

describe("@tari-project/ootle exports map resolution", () => {
  it("resolves the step-05/06 helpers", () => {
    expect(typeof microTariLiteral).toBe("function");
    expect(typeof microTariString).toBe("function");
    expect(typeof assertByteLength).toBe("function");
  });

  it("resolves the epoch-window surface a builder needs", () => {
    expect(typeof resolveMaxEpoch).toBe("function");
    expect(MAX_TRANSACTION_VALIDITY_EPOCHS).toBe(2160);
    expect(DEFAULT_TRANSACTION_VALIDITY_EPOCHS).toBeLessThan(MAX_TRANSACTION_VALIDITY_EPOCHS);
  });

  it("resolves the typed error hierarchy", () => {
    // `OotleError` is abstract — assert presence as a constructor reference,
    // not instantiability. Every concrete subclass extends it.
    expect(typeof OotleError).toBe("function");
    expect(OotleError.name).toBe("OotleError");
    expect(typeof IndexerClientError).toBe("function");
    expect(typeof TransactionRejectedError).toBe("function");
    expect(typeof TransactionTimeoutError).toBe("function");
    expect(typeof WalletError).toBe("function");
    expect(typeof KeyProviderNotFoundError).toBe("function");
    expect(typeof DefaultSignerNotSetError).toBe("function");
    expect(typeof SignerError).toBe("function");
    expect(typeof CryptoBridgeError).toBe("function");
    expect(typeof InvalidArgumentError).toBe("function");

    // Every concrete subclass extends the abstract base.
    expect(new IndexerClientError("x")).toBeInstanceOf(OotleError);
    expect(new TransactionRejectedError("x", { txId: "t", reason: "r" })).toBeInstanceOf(OotleError);
    expect(new TransactionTimeoutError("x", { txId: "t" })).toBeInstanceOf(OotleError);
    expect(new WalletError("x")).toBeInstanceOf(OotleError);
    expect(new KeyProviderNotFoundError("x", { address: null })).toBeInstanceOf(WalletError);
    expect(new DefaultSignerNotSetError("x")).toBeInstanceOf(WalletError);
    expect(new SignerError("x")).toBeInstanceOf(OotleError);
    expect(new CryptoBridgeError("x")).toBeInstanceOf(OotleError);
    expect(new InvalidArgumentError("x")).toBeInstanceOf(OotleError);
  });

  it("resolves the pre-existing public surface", () => {
    expect(typeof TransactionBuilder).toBe("function");
    expect(typeof OotleWallet).toBe("function");
    expect(typeof Network).toBe("object"); // enum-like
    expect(typeof toHexStr).toBe("function");
    expect(typeof fromHexStr).toBe("function");
  });
});
