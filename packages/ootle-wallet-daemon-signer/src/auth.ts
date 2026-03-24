//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { JrpcPermission } from "@tari-project/ootle-ts-bindings";
import type { WalletDaemonClient } from "@tari-project/wallet_jrpc_client";
import { Buffer } from "buffer";

const DEFAULT_APP_NAME = "tari-wallet-sdk";
const DEFAULT_PERMISSIONS: JrpcPermission[] = ["Admin"];

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
 * For "none", a token is requested directly.
 * For "webauthn", the browser's WebAuthn API is used to register or login,
 * then the resulting credential is exchanged for a token.
 *
 * @returns The JWT auth token.
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
      throw new Error(`Unsupported wallet daemon auth method: ${method}`);
  }
}

async function authenticateWebAuthn(
  client: WalletDaemonClient,
  appName: string,
  permissions: JrpcPermission[],
): Promise<string> {
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
    throw new Error("WebAuthn auth start: missing challenge");
  }

  const challengeResponse = startResponse.challenge as WebAuthnAuthChallenge;
  if (!challengeResponse.publicKey?.challenge) {
    throw new Error("WebAuthn auth start: malformed challenge response");
  }
  const { publicKey } = challengeResponse;

  const challenge = Buffer.from(publicKey.challenge, "base64");
  const allowCredentials = (publicKey.allowCredentials ?? []).map((cred) => ({
    id: Buffer.from(cred.id, "base64"),
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
    throw new Error("WebAuthn authentication was cancelled");
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
    throw new Error("WebAuthn registration start: missing public_key");
  }

  const serverOptions = startResponse.public_key as WebAuthnPublicKeyOptions;
  if (!serverOptions.challenge) {
    throw new Error("WebAuthn registration start: malformed public_key response");
  }
  const challenge = Buffer.from(serverOptions.challenge, "base64");

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
    throw new Error("WebAuthn registration was cancelled");
  }

  const { token } = await client.webauthnFinishRegistration({
    session_id: startResponse.session_id,
    credential,
    requested_permissions: permissions,
  });

  return token;
}
