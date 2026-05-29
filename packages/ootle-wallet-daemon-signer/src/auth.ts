//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { JrpcPermission } from "@tari-project/ootle-ts-bindings";
import type { WalletDaemonClient } from "@tari-project/wallet_jrpc_client";
import { SignerError } from "@tari-project/ootle";

const DEFAULT_APP_NAME = "tari-wallet-sdk";
const DEFAULT_PERMISSIONS: JrpcPermission[] = ["Admin"];

// `atob` is a cross-runtime built-in (browser, Node ≥ 16, Workers), so decoding
// via `Uint8Array.from` sidesteps the `buffer` polyfill the WebAuthn code
// previously pulled in. webauthn-rs sends URL-safe, unpadded base64 (RFC 4648 §5,
// `Base64UrlSafeData`), so normalise `-`/`_` → `+`/`/` and re-pad to a multiple of
// 4 before decoding — `atob` is strict about both the alphabet and the padding.
// The explicit `ArrayBuffer` parameterisation keeps the result assignable to
// WebAuthn's `BufferSource` (which excludes `SharedArrayBuffer`).
export function base64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Shape of the challenge object returned by `webauthn.auth_start`. */
interface WebAuthnAuthChallenge {
  publicKey: {
    challenge: string;
    allowCredentials?: { id: string; type: PublicKeyCredentialType }[];
  };
}

/** Shape of the public_key object returned by `webauthn.reg_start`. */
interface WebAuthnPublicKeyOptions {
  challenge: string;
  rp?: { name?: string; id?: string };
  pubKeyCredParams?: PublicKeyCredentialParameters[];
}

export interface AuthOptions {
  /** Permissions to request from the wallet daemon. Defaults to `["Admin"]`. */
  permissions?: JrpcPermission[];
  /** Application name used as the WebAuthn username/identifier. Defaults to `"tari-wallet-sdk"`. */
  appName?: string;
}

/**
 * Authenticate with the wallet daemon, automatically handling the configured
 * auth method ("none" or "webauthn").
 *
 * For "none", a token is requested directly. Works in both browsers and Node.
 * For "webauthn", the browser's WebAuthn API is used to register or login,
 * then the resulting credential is exchanged for a token. **Browser-only** —
 * in Node, pass `authToken` to `WalletDaemonSigner.connect({ url, authToken })`
 * instead of calling this flow.
 *
 * @returns The JWT auth token.
 * @throws {SignerError} if the daemon advertises an unsupported auth method, the
 *   WebAuthn flow is invoked outside a browser, the WebAuthn challenge is malformed,
 *   or the user cancels the WebAuthn prompt.
 */
export async function authenticate(client: WalletDaemonClient, options?: AuthOptions): Promise<string> {
  const permissions = options?.permissions ?? DEFAULT_PERMISSIONS;
  const appName = options?.appName ?? DEFAULT_APP_NAME;

  const { method } = await client.authGetMethod();

  switch (method) {
    case "none":
      return client.authRequest(permissions, "None");
    case "webauthn":
      return authenticateWebAuthn(client, appName, permissions);
    default:
      throw new SignerError(
        `Unsupported wallet daemon auth method: ${method}. ` +
          `Configure the daemon for one of: "none" or "webauthn", and pass that value to WalletDaemonSigner.connect.`,
      );
  }
}

async function authenticateWebAuthn(
  client: WalletDaemonClient,
  appName: string,
  permissions: JrpcPermission[],
): Promise<string> {
  // Feature-detect the browser WebAuthn API up front. `globalThis.navigator` is the
  // universally-safe form: a bare `navigator` reference throws `ReferenceError` in Node,
  // whereas the `globalThis.navigator` access returns `undefined`. The matching error
  // wording is contract — it is also quoted in the daemon-signer README and the Node
  // quickstart; do not drift the message without updating those sources.
  if (typeof globalThis.navigator === "undefined" || !globalThis.navigator.credentials) {
    throw new SignerError(
      "WebAuthn is browser-only. Run in a browser, or pass `authToken` explicitly to " +
        "`WalletDaemonSigner.connect({ url, authToken })` from Node.",
    );
  }

  const { registered } = await client.webauthnAlreadyRegistered({ username: appName });

  if (registered) {
    return webauthnLogin(client, appName, permissions);
  } else {
    return webauthnRegister(client, appName, permissions);
  }
}

async function webauthnLogin(
  client: WalletDaemonClient,
  appName: string,
  permissions: JrpcPermission[],
): Promise<string> {
  const startResponse = await client.webauthnAuthStart({ username: appName });

  if (!startResponse.challenge) {
    throw new SignerError("WebAuthn auth start: missing challenge");
  }

  const challengeResponse = startResponse.challenge as WebAuthnAuthChallenge;
  if (!challengeResponse.publicKey?.challenge) {
    throw new SignerError("WebAuthn auth start: malformed challenge response");
  }
  const { publicKey } = challengeResponse;

  const challenge = base64ToBytes(publicKey.challenge);
  const allowCredentials = (publicKey.allowCredentials ?? []).map((cred) => ({
    id: base64ToBytes(cred.id),
    type: cred.type,
  }));

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials,
      timeout: 60000,
      userVerification: "required",
    },
  });

  if (!credential) {
    throw new SignerError("WebAuthn authentication was cancelled");
  }

  return client.authRequest(permissions, {
    WebAuthN: {
      session_id: startResponse.session_id,
      credential,
    },
  });
}

async function webauthnRegister(
  client: WalletDaemonClient,
  appName: string,
  permissions: JrpcPermission[],
): Promise<string> {
  const startResponse = await client.webauthnStartRegistration({ username: appName });

  if (!startResponse.public_key) {
    throw new SignerError("WebAuthn registration start: missing public_key");
  }

  const serverOptions = startResponse.public_key as WebAuthnPublicKeyOptions;
  if (!serverOptions.challenge) {
    throw new SignerError("WebAuthn registration start: malformed public_key response");
  }
  const challenge = base64ToBytes(serverOptions.challenge);

  const credential = await navigator.credentials.create({
    publicKey: {
      rp: {
        name: serverOptions.rp?.name ?? "Tari Wallet",
        id: serverOptions.rp?.id ?? globalThis.location?.hostname,
      },
      user: {
        id: Uint8Array.from(appName, (c) => c.charCodeAt(0)),
        name: appName,
        displayName: appName,
      },
      challenge,
      pubKeyCredParams: serverOptions.pubKeyCredParams ?? [
        { type: "public-key", alg: -8 }, // Ed25519
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      timeout: 60000,
      excludeCredentials: [],
      attestation: "none",
      authenticatorSelection: {
        userVerification: "required",
      },
    },
  });

  if (!credential) {
    throw new SignerError("WebAuthn registration was cancelled");
  }

  const { token } = await client.webauthnFinishRegistration({
    session_id: startResponse.session_id,
    credential,
    requested_permissions: permissions,
  });

  return token;
}
