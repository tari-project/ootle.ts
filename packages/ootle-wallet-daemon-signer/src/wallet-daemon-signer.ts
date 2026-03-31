//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type {
  TransactionSignature,
  UnsignedTransactionV1,
  AccountsAssociateStealthResourceRequest,
  AccountsAssociateStealthResourceResponse,
  AccountsCreateStealthTransferStatementRequest,
  AccountsCreateStealthTransferStatementResponse,
  StealthTransferRequest,
  StealthTransferResponse,
  StealthUtxosListRequest,
  StealthUtxosListResponse,
  StealthUtxosDecryptValueRequest,
  StealthUtxosDecryptValueResponse,
} from "@tari-project/ootle-ts-bindings";
import { WalletDaemonClient } from "@tari-project/wallet_jrpc_client";
import { type Signer, fromHexStr } from "@tari-project/ootle";
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
    if (!this._address) {
      await this.fetchAccountInfo();
    }
    return this._address as string;
  }

  public async getPublicKey(): Promise<Uint8Array> {
    if (!this._publicKey) {
      await this.fetchAccountInfo();
    }
    return this._publicKey as Uint8Array;
  }

  public async signTransaction(unsignedTx: UnsignedTransactionV1): Promise<TransactionSignature[]> {
    // The WalletDaemonClient has no typed wrapper for `transactions.sign`.
    // Use the generic sendRequest to call the JRPC method directly.
    const response = await this.client.sendRequest<{ signatures: TransactionSignature[] }>("transactions.sign", {
      transaction: unsignedTx,
    });
    return response.signatures;
  }

  public async fetchAccountInfo(): Promise<void> {
    if (!this.client) {
      throw new Error("Wallet daemon client not initialized");
    }
    const response = await this.client.accountsGetDefault({});
    if (!response.account?.owner_public_key || !response.address) {
      throw new Error("Wallet daemon response missing public_key or address");
    }
    this._publicKey = fromHexStr(response.account.owner_public_key);
    this._address = response.address;
  }

  /**
   * Returns the underlying `WalletDaemonClient` for advanced JRPC operations
   * not covered by the signer's high-level API.
   */
  public getClient(): WalletDaemonClient {
    return this.client;
  }

  // ---------------------------------------------------------------------------
  // Stealth transfer operations
  // ---------------------------------------------------------------------------

  /**
   * Performs a stealth transfer in one call. The wallet daemon handles statement
   * generation, transaction building, signing, and submission internally.
   *
   * This is the simplest path to a working stealth transfer when a wallet daemon
   * is available.
   */
  public async stealthTransfer(
    params: StealthTransferRequest,
  ): Promise<StealthTransferResponse> {
    return this.client.stealthTransfer(params);
  }

  /**
   * Generates a stealth transfer statement without building or submitting the
   * transaction. The returned statement can be used with `TransactionBuilder`
   * or `StealthTransfer` for custom transaction construction.
   *
   * Note: The `WalletDaemonClient` does not yet expose a typed method for this
   * endpoint, so we use `sendRequest` directly.
   */
  public async createStealthTransferStatement(
    params: AccountsCreateStealthTransferStatementRequest,
  ): Promise<AccountsCreateStealthTransferStatementResponse> {
    return this.client.sendRequest<AccountsCreateStealthTransferStatementResponse>(
      "accounts.create_stealth_transfer_statement",
      params,
    );
  }

  /**
   * Associates a resource address with stealth tracking for an account.
   * Must be called before the wallet daemon can list or manage stealth UTXOs
   * for the given resource.
   */
  public async associateStealthResource(
    params: AccountsAssociateStealthResourceRequest,
  ): Promise<AccountsAssociateStealthResourceResponse> {
    return this.client.accountsAssociateStealthResource(params);
  }

  /**
   * Lists stealth UTXOs known to the wallet daemon, optionally filtered
   * by account and output status.
   */
  public async stealthUtxosList(
    params: StealthUtxosListRequest,
  ): Promise<StealthUtxosListResponse> {
    return this.client.stealthUtxosList(params);
  }

  /**
   * Decrypts the blinded value of stealth UTXOs using the wallet daemon's
   * view key. Returns the decrypted value for each requested UTXO.
   */
  public async stealthUtxosDecryptValue(
    params: StealthUtxosDecryptValueRequest,
  ): Promise<StealthUtxosDecryptValueResponse> {
    return this.client.stealthUtxosDecryptValue(params);
  }
}
