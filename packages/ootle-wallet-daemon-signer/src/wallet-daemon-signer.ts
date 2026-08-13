//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { TransactionSignature, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { WalletDaemonClient } from "@tari-project/wallet_jrpc_client";
import { type Signer, SignerError, assertByteLength, fromHexStr, toHexStr } from "@tari-project/ootle";
import { authenticate, type AuthOptions } from "./auth";

export interface WalletDaemonSignerOptions {
  /** Base URL of the wallet daemon HTTP endpoint, e.g. "http://localhost:18103" */
  url: string;
  /**
   * Token used to authenticate JRPC calls to the wallet daemon.
   * If omitted, {@link WalletDaemonSigner.connect} will automatically authenticate
   * using the daemon's configured auth method (none or WebAuthn).
   */
  authToken?: string;
}

/**
 * A Signer that delegates signing to a running wallet daemon over its JRPC interface,
 * using `@tari-project/wallet_jrpc_client` for all communication.
 *
 * The wallet daemon holds the secret key and returns signatures, so the key never
 * lives in JavaScript memory. This signer is suitable for server-side or trusted
 * environment usage where the wallet daemon is reachable.
 *
 * **Stealth boundary (intentionally not implemented).** Client-side stealth spending and
 * scanning need the raw view secret, which the daemon never exports — it keeps the key and
 * exposes its own *server-side* stealth JRPC instead (`stealthTransfer`, `stealthUtxosList`,
 * `stealthUtxosDecryptValue`, `accountsAssociateStealthResource`, `viewVaultBalance` on
 * `@tari-project/wallet_jrpc_client`). This signer therefore does **not** implement
 * `Signer.addStealthSignature` and its {@link getViewSecret} throws. For client-side stealth
 * spend, use {@link SecretKeyWallet}; for daemon-managed stealth, call the daemon's stealth
 * JRPC methods directly. Daemon-delegated stealth wiring is future work.
 */
export class WalletDaemonSigner implements Signer {
  private readonly client: WalletDaemonClient;
  private _publicKey: Uint8Array | null = null;
  private _address: string | null = null;

  private constructor(client: WalletDaemonClient) {
    this.client = client;
  }

  /**
   * Creates a new signer with the given auth token, without verifying connectivity.
   * Prefer `connect()` for eager validation and automatic authentication.
   */
  public static new(options: WalletDaemonSignerOptions & { authToken: string }): WalletDaemonSigner {
    const client = WalletDaemonClient.usingFetchTransport(options.url);
    client.setToken(options.authToken);
    return new WalletDaemonSigner(client);
  }

  /**
   * Connect to the daemon and cache the public key / address.
   *
   * If no `authToken` is provided, automatically authenticates using the daemon's
   * configured auth method. For WebAuthn, this triggers the browser's passkey
   * registration or login flow.
   */
  public static async connect(options: WalletDaemonSignerOptions & AuthOptions): Promise<WalletDaemonSigner> {
    const client = WalletDaemonClient.usingFetchTransport(options.url);

    if (options.authToken) {
      client.setToken(options.authToken);
    } else {
      const token = await authenticate(client, options);
      client.setToken(token);
    }

    client.setReauthenticationEnabled(true);

    const signer = new WalletDaemonSigner(client);
    await signer.fetchAccountInfo();
    return signer;
  }

  public async getAddress(): Promise<string> {
    return (await this.ensureAccountInfo()).address;
  }

  public async getPublicKey(): Promise<Uint8Array> {
    return (await this.ensureAccountInfo()).publicKey;
  }

  /**
   * Signs `unsignedTx` via the daemon's `transactions.sign` JRPC. `sealPublicKey` is
   * forwarded as hex so the daemon hashes the transaction with the SAME seal public key the
   * SDK's seal step uses — otherwise the per-signer hash and the seal hash diverge and the
   * engine rejects the envelope.
   *
   * TODO(daemon): the `transactions.sign` JRPC's acceptance of `seal_public_key` is unverified
   * against a running `tari_ootle_walletd`, and the daemon advertises no capability signal for
   * it. (`walletGetInfo` returns a daemon `version` string, but nothing maps a version to
   * "honours `seal_public_key`", so it cannot answer this question.) This call therefore cannot
   * fail fast the way {@link getViewSecret} does. If the daemon ignores the
   * parameter and hashes with its own pk, the per-signer signatures will not verify and the
   * failure surfaces only LATE — at submit time — as the opaque engine error
   * `"Transaction has one or more invalid signature(s)"`, not here. An unconditional throw is
   * deliberately NOT added: it would break a daemon build that *does* honour `seal_public_key`.
   * Until a daemon-side capability signal lands (tracked by this TODO), use
   * {@link SecretKeyWallet} for client-side signing — it is the supported signer for sealed
   * transactions.
   */
  public async signTransaction(
    unsignedTx: UnsignedTransactionV1,
    sealPublicKey: Uint8Array,
  ): Promise<TransactionSignature[]> {
    assertByteLength(sealPublicKey, 32, "WalletDaemonSigner.signTransaction sealPublicKey");
    const response = await this.client.sendRequest<{ signatures: TransactionSignature[] }>("transactions.sign", {
      transaction: unsignedTx,
      seal_public_key: toHexStr(sealPublicKey),
    });
    return response.signatures;
  }

  /**
   * The daemon never exports its view secret, so client-side stealth scanning/spending is
   * unsupported via this signer. Always throws — see the class doc for the server-side
   * stealth JRPC alternative. {@link Signer.addStealthSignature} is likewise not implemented.
   *
   * @throws {SignerError} always — the daemon never exports its view secret.
   */
  public getViewSecret(): Promise<Uint8Array> {
    return Promise.reject(
      new SignerError(
        "WalletDaemonSigner cannot export a view secret: daemon stealth is server-side. " +
          "Use the daemon's stealth JRPC methods (e.g. stealthTransfer, stealthUtxosList), " +
          "or use SecretKeyWallet for client-side stealth spending.",
      ),
    );
  }

  /**
   * Fetches the default account info from the daemon and caches it on this signer.
   * Re-calls are idempotent — once cached, subsequent calls do not re-fetch.
   *
   * @throws {SignerError} if the daemon's `accounts.get_default` response is missing the
   *   public key or address.
   */
  public async fetchAccountInfo(): Promise<void> {
    await this.ensureAccountInfo();
  }

  private async ensureAccountInfo(): Promise<{ publicKey: Uint8Array; address: string }> {
    if (this._publicKey !== null && this._address !== null) {
      return { publicKey: this._publicKey, address: this._address };
    }
    const response = await this.client.accountsGetDefault({});
    if (!response.account?.owner_public_key || !response.address) {
      throw new SignerError("Wallet daemon response missing public_key or address");
    }
    const publicKey = assertByteLength(fromHexStr(response.account.owner_public_key), 32, "daemon publicKey");
    const address = response.address;
    this._publicKey = publicKey;
    this._address = address;
    return { publicKey, address };
  }
}
