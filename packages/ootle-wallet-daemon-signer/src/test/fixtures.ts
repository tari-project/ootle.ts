//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only fixtures for `@tari-project/ootle-wallet-daemon-signer` unit tests.
//
// Promotes the inline `mockClient(...)` helper from `auth.test.ts` so later
// daemon-signer tests share a single source of truth for the minimal
// `WalletDaemonClient` shape `authenticate()` and friends consume.
//
// This module is TEST-ONLY: it is deliberately NOT re-exported from the
// package root (`packages/ootle-wallet-daemon-signer/src/index.ts`), so it
// never reaches external consumers. Test files import it by relative subpath
// (`import { mockWalletDaemonClient } from "./test/fixtures"`).

import type { WalletDaemonClient } from "@tari-project/wallet_jrpc_client";

/**
 * Minimal `WalletDaemonClient` subset our tests invoke. Originally just the two
 * auth methods (`authGetMethod`, `authRequest`); broadened with optional
 * WebAuthn / accounts / sendRequest entries so daemon-signer tests can stub the
 * shape they need without having to widen the cast at every call site.
 */
export type AuthClientMock = Partial<
  Pick<
    WalletDaemonClient,
    | "authGetMethod"
    | "authRequest"
    | "webauthnAlreadyRegistered"
    | "webauthnAuthStart"
    | "webauthnStartRegistration"
    | "webauthnFinishRegistration"
    | "accountsGetDefault"
    | "setToken"
    | "setReauthenticationEnabled"
    | "sendRequest"
  >
>;

/**
 * Build a `WalletDaemonClient` test double from a partial override set. Sensible
 * defaults: `authGetMethod` returns `{ method: "none" }` and `authRequest`
 * returns the literal token `"test-token"`. Pass `overrides` to vary either, or
 * to stub any of the WebAuthn / accounts methods listed in {@link AuthClientMock}.
 */
export function mockWalletDaemonClient(overrides: AuthClientMock = {}): WalletDaemonClient {
  return {
    authGetMethod: async () => ({ method: "none" }),
    authRequest: async () => "test-token",
    ...overrides,
  } as unknown as WalletDaemonClient;
}
