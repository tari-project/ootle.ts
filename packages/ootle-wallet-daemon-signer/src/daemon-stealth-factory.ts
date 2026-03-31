//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type {
  AccountsCreateStealthTransferStatementResponse,
  ComponentAddressOrName,
  OotleAddress,
  ResourceAddress,
  StealthTransferStatement as BindingsStealthTransferStatement,
  TransferOutput,
} from "@tari-project/ootle-ts-bindings";
import type { WalletDaemonClient } from "@tari-project/wallet_jrpc_client";
import type { StealthOutputStatementFactory, StealthTransferStatement } from "@tari-project/ootle";

export interface DaemonStealthFactoryOptions {
  /** The wallet daemon JRPC client (obtain via `WalletDaemonSigner.getClient()`). */
  client: WalletDaemonClient;
  /** The sender account that owns the stealth UTXOs to spend. */
  senderAccount: ComponentAddressOrName;
  /** The resource to transfer (e.g. the Tari token). */
  resourceAddress: ResourceAddress;
  /** The recipient's full Ootle address (bech32m-encoded, includes both owner and view key). */
  recipientAddress: OotleAddress;
}

/**
 * A `StealthOutputStatementFactory` backed by a wallet daemon's
 * `accounts.create_stealth_transfer_statement` JRPC endpoint.
 *
 * The wallet daemon handles all cryptographic operations (DH-KDF, Pedersen
 * commitments, range proofs, balance proofs) server-side. No WASM crypto
 * is required on the client.
 *
 * ## Usage
 *
 * ```ts
 * const signer = await WalletDaemonSigner.connect({ url: "http://localhost:18103" });
 * const factory = new DaemonStealthFactory({
 *   client: signer.getClient(),
 *   senderAccount: { Name: "default" },
 *   resourceAddress: TARI_TOKEN,
 *   recipientAddress: "ootle1...",
 * });
 *
 * const spec = await new StealthTransfer(network, factory)
 *   .from(sourceAccount, resourceAddress)
 *   .to(recipientPublicKeyHex, 1_000_000n)
 *   .feeFrom(feeAccount, 1000n)
 *   .build();
 * ```
 *
 * ## Type mapping
 *
 * The wallet daemon returns statements in the canonical bindings format
 * (`@tari-project/ootle-ts-bindings` `StealthTransferStatement`), which uses
 * `inputs_statement` / `outputs_statement` / `balance_proof`.
 *
 * The `@tari-project/ootle` package currently defines a simplified
 * `StealthTransferStatement` with `outputs` / `balanceProof`. These types
 * are structurally incompatible. This factory returns the **bindings format**
 * (cast to satisfy the interface) because that is the format the on-chain
 * `deposit_stealth` method expects when deserializing the JSON payload.
 *
 * A follow-up PR should align the `@tari-project/ootle` types with the
 * bindings to eliminate this cast.
 */
export class DaemonStealthFactory implements StealthOutputStatementFactory {
  private readonly client: WalletDaemonClient;
  private readonly senderAccount: ComponentAddressOrName;
  private readonly resourceAddress: ResourceAddress;
  private readonly recipientAddress: OotleAddress;

  constructor(options: DaemonStealthFactoryOptions) {
    this.client = options.client;
    this.senderAccount = options.senderAccount;
    this.resourceAddress = options.resourceAddress;
    this.recipientAddress = options.recipientAddress;
  }

  /**
   * Generates a stealth transfer statement by delegating to the wallet daemon.
   *
   * @param _recipientPublicKeyHex - Ignored in the daemon flow. The recipient is
   *   identified by the `recipientAddress` provided at construction time (which
   *   embeds the public key). This parameter is accepted to satisfy the
   *   `StealthOutputStatementFactory` interface.
   * @param amounts - Amount(s) to send in each stealth output.
   */
  public async generateOutputsStatement(
    _recipientPublicKeyHex: string,
    amounts: bigint[],
  ): Promise<StealthTransferStatement> {
    const outputs: TransferOutput[] = amounts.map((amount) => ({
      address: this.recipientAddress,
      revealed_amount: 0,
      blinded_amount: amount,
      memo: null,
      pay_to: "StealthPublicKey" as const,
    }));

    const response =
      await this.client.sendRequest<AccountsCreateStealthTransferStatementResponse>(
        "accounts.create_stealth_transfer_statement",
        {
          requests: [
            {
              sender_account: this.senderAccount,
              resource_address: this.resourceAddress,
              input_selection: { Selection: "PreferConfidential" },
              outputs,
            },
          ],
        },
      );

    if (!response.statements || response.statements.length === 0) {
      throw new Error("Wallet daemon returned no stealth transfer statements");
    }

    // The daemon returns the canonical bindings format. We cast to the tari.js
    // StealthTransferStatement type. See class-level JSDoc for the type mismatch
    // discussion — the bindings format is what deposit_stealth actually expects.
    return response.statements[0] as unknown as StealthTransferStatement;
  }
}
