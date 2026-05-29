//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import { SignerError } from "@tari-project/ootle";
import { authenticate } from "./auth";
import { mockWalletDaemonClient } from "./test/fixtures";

describe("authenticate (Node / no navigator)", () => {
  it("returns a token under method=none without touching navigator", async () => {
    // Node ≥ 22 exposes `globalThis.navigator` but does not expose `navigator.credentials` —
    // the latter is the actual WebAuthn entry. Either condition firing in the auth.ts guard
    // (no navigator, or no navigator.credentials) is enough to gate the browser-only branch.
    expect(globalThis.navigator?.credentials).toBeUndefined();

    const token = await authenticate(
      mockWalletDaemonClient({
        authGetMethod: async () => ({ method: "none" }),
        authRequest: async () => "node-token",
      }),
    );
    expect(token).toBe("node-token");
  });

  it("throws the canonical actionable error under method=webauthn", async () => {
    const client = mockWalletDaemonClient({
      authGetMethod: async () => ({ method: "webauthn" }),
    });

    await expect(authenticate(client)).rejects.toThrow(SignerError);
    await expect(authenticate(client)).rejects.toThrow(/WebAuthn is browser-only/);
    await expect(authenticate(client)).rejects.toThrow(
      /pass `authToken` explicitly to `WalletDaemonSigner\.connect\(\{ url, authToken \}\)`/,
    );
  });

  it("throws SignerError 'Unsupported wallet daemon auth method' for an unknown method", async () => {
    const client = mockWalletDaemonClient({
      // The daemon's auth-method enum is `"none" | "webauthn"`; anything else flows through
      // the switch default in `auth.ts` (line ~60). Cast to `never` to satisfy the typed mock.
      authGetMethod: async () => ({ method: "future-method" as never }),
    });

    await expect(authenticate(client)).rejects.toThrow(SignerError);
    await expect(authenticate(client)).rejects.toThrow(/Unsupported wallet daemon auth method: future-method/);
  });
});

// follow-up: the six "missing/malformed" daemon-response validations
// (`auth.ts` lines 98, 103, 122, 142, 146, 177 — minus the two cancellation
// paths we DO cover below) are deliberately skipped here. They guard a daemon
// response shape that is still in flux, and adding tests now would mean
// rewriting them when the daemon's API evolves. Cover them when the shape
// stabilises.
describe("authenticate WebAuthn cancellation flows", () => {
  // Tracking the original so `afterEach` can restore it cleanly. Without this the
  // installed navigator stub leaks into other test files (anything reading
  // `navigator.userAgent` is sensitive).
  const origNavigator = globalThis.navigator;
  let credentialsCreate: ReturnType<typeof vi.fn>;
  let credentialsGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    credentialsCreate = vi.fn();
    credentialsGet = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: {
        credentials: {
          create: credentialsCreate,
          get: credentialsGet,
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: origNavigator,
      configurable: true,
      writable: true,
    });
  });

  it("throws 'WebAuthn registration was cancelled' when navigator.credentials.create resolves to null", async () => {
    credentialsCreate.mockResolvedValue(null);

    const client = mockWalletDaemonClient({
      authGetMethod: async () => ({ method: "webauthn" }),
      webauthnAlreadyRegistered: async () => ({ registered: false }),
      webauthnStartRegistration: async () => ({
        session_id: "reg-session",
        public_key: { challenge: Buffer.from("hello").toString("base64") },
      }),
    });

    await expect(authenticate(client)).rejects.toThrow(/WebAuthn registration was cancelled/);
    expect(credentialsCreate).toHaveBeenCalledTimes(1);
  });

  it("throws 'WebAuthn authentication was cancelled' when navigator.credentials.get resolves to null", async () => {
    credentialsGet.mockResolvedValue(null);

    const client = mockWalletDaemonClient({
      authGetMethod: async () => ({ method: "webauthn" }),
      webauthnAlreadyRegistered: async () => ({ registered: true }),
      webauthnAuthStart: async () => ({
        session_id: "auth-session",
        challenge: { publicKey: { challenge: Buffer.from("c").toString("base64"), allowCredentials: [] } },
      }),
    });

    await expect(authenticate(client)).rejects.toThrow(/WebAuthn authentication was cancelled/);
    expect(credentialsGet).toHaveBeenCalledTimes(1);
  });
});
