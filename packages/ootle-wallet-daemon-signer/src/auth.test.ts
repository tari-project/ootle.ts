//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import { SignerError } from "@tari-project/ootle";
import { authenticate, base64ToBytes } from "./auth";
import { mockWalletDaemonClient } from "./test/fixtures";

describe("base64ToBytes", () => {
  it("decodes unpadded base64url containing `-` and `_`", () => {
    // Random bytes whose standard-base64 form contains both `+`/`/` so the
    // url-safe form contains both `-`/`_`, and whose length is not a multiple of
    // 3 so the url-safe NO_PAD form is unpadded — the exact shape webauthn-rs sends.
    const original = Uint8Array.from([0xfb, 0xff, 0xbf, 0x00, 0x10, 0x83, 0xfe]);
    const b64url = Buffer.from(original).toString("base64url");
    expect(b64url).toMatch(/[-_]/);
    expect(b64url).not.toContain("=");

    expect(base64ToBytes(b64url)).toEqual(original);
  });

  it("still decodes standard padded base64 (normalisation is a superset)", () => {
    const original = Uint8Array.from(Buffer.from("hello"));
    expect(base64ToBytes(Buffer.from(original).toString("base64"))).toEqual(original);
  });
});

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

// follow-up: the "missing/malformed" daemon-response validations are deliberately
// skipped here. They guard a daemon response shape that is still in flux, and
// adding tests now would mean rewriting them when the daemon's API evolves. Cover
// them when the shape stabilises. The base64url challenge/credential-id decoding
// and the two cancellation paths ARE covered below.
describe("authenticate WebAuthn flows", () => {
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

  it("decodes the base64url registration challenge before calling navigator.credentials.create", async () => {
    credentialsCreate.mockResolvedValue(null);

    const challengeBytes = Uint8Array.from([0xfb, 0xff, 0xbf, 0x00, 0x10, 0x83, 0xfe]);
    const challengeB64Url = Buffer.from(challengeBytes).toString("base64url");
    expect(challengeB64Url).toMatch(/[-_]/);

    const client = mockWalletDaemonClient({
      authGetMethod: async () => ({ method: "webauthn" }),
      webauthnAlreadyRegistered: async () => ({ registered: false }),
      webauthnStartRegistration: async () => ({
        session_id: "reg-session",
        public_key: { challenge: challengeB64Url },
      }),
    });

    await expect(authenticate(client)).rejects.toThrow(/WebAuthn registration was cancelled/);
    expect(credentialsCreate).toHaveBeenCalledTimes(1);
    expect(credentialsCreate.mock.calls[0][0].publicKey.challenge).toEqual(challengeBytes);
  });

  it("decodes the base64url auth challenge and credential ids before calling navigator.credentials.get", async () => {
    credentialsGet.mockResolvedValue(null);

    const challengeBytes = Uint8Array.from([0xfb, 0xff, 0xbf, 0x00, 0x10, 0x83, 0xfe]);
    const credIdBytes = Uint8Array.from([0xff, 0xee, 0xdd, 0x3f, 0xbe]);
    const challengeB64Url = Buffer.from(challengeBytes).toString("base64url");
    const credIdB64Url = Buffer.from(credIdBytes).toString("base64url");
    expect(challengeB64Url).toMatch(/[-_]/);
    expect(credIdB64Url).toMatch(/[-_]/);

    const client = mockWalletDaemonClient({
      authGetMethod: async () => ({ method: "webauthn" }),
      webauthnAlreadyRegistered: async () => ({ registered: true }),
      webauthnAuthStart: async () => ({
        session_id: "auth-session",
        challenge: {
          publicKey: {
            challenge: challengeB64Url,
            allowCredentials: [{ id: credIdB64Url, type: "public-key" }],
          },
        },
      }),
    });

    await expect(authenticate(client)).rejects.toThrow(/WebAuthn authentication was cancelled/);
    expect(credentialsGet).toHaveBeenCalledTimes(1);
    const requestedPublicKey = credentialsGet.mock.calls[0][0].publicKey;
    expect(requestedPublicKey.challenge).toEqual(challengeBytes);
    expect(requestedPublicKey.allowCredentials[0].id).toEqual(credIdBytes);
  });
});
