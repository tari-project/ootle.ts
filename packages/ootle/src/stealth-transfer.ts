//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { ComponentAddress, ResourceAddress, Amount, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import type { StealthOutputStatementFactory, StealthTransferStatement } from "./stealth";
import { TransactionBuilder } from "./transaction/builder";
import type { Network } from "./network";

/**
 * The result of building a `StealthTransfer`: the unsigned transaction and
 * the generated stealth output statement.
 * Mirrors `StealthTransferSpec` from the Rust ootle-rs crate.
 */
export interface StealthTransferSpec {
  unsignedTx: UnsignedTransactionV1;
  statement: StealthTransferStatement;
}

/**
 * Fluent builder for constructing stealth transfer transactions.
 * Mirrors `StealthTransfer` from the Rust ootle-rs crate.
 *
 * Stealth transfers produce outputs with one-time public keys so only the
 * recipient (who holds the view-only key) can scan and spend them.
 *
 * @example
 * ```ts
 * const spec = await new StealthTransfer(network, factory)
 *   .from(sourceAccount, resourceAddress)
 *   .to(recipientPublicKeyHex, 1_000_000n)
 *   .feeFrom(feeAccount, 1000n)
 *   .build();
 * ```
 */
export class StealthTransfer {
  private txBuilder: TransactionBuilder;
  private readonly factory: StealthOutputStatementFactory;
  private recipientPublicKeyHex: string | null = null;
  private amounts: bigint[] = [];
  private sourceAccount: ComponentAddress | null = null;
  private resourceAddress: ResourceAddress | null = null;

  constructor(network: Network | number, factory: StealthOutputStatementFactory) {
    this.txBuilder = TransactionBuilder.new(network);
    this.factory = factory;
  }

  /**
   * Specifies which account and resource to spend from.
   */
  public from(sourceAccount: ComponentAddress, resourceAddress: ResourceAddress): this {
    this.sourceAccount = sourceAccount;
    this.resourceAddress = resourceAddress;
    return this;
  }

  /**
   * Adds a stealth output for `recipientPublicKeyHex` of the given amount.
   * Multiple calls add multiple outputs; they all share the same recipient.
   */
  public to(recipientPublicKeyHex: string, amount: bigint): this {
    if (this.recipientPublicKeyHex && this.recipientPublicKeyHex !== recipientPublicKeyHex) {
      this.amounts = [];
      throw new Error("StealthTransfer: recipient has changed. Amounts were cleared, try again.");
    }
    this.recipientPublicKeyHex = recipientPublicKeyHex;
    this.amounts.push(amount);

    return this;
  }

  public feeFrom(componentAddress: ComponentAddress, maxFee: Amount): this {
    this.txBuilder.feeTransactionPayFromComponent(componentAddress, maxFee);
    return this;
  }

  /**
   * Adds arbitrary instructions to the transaction (e.g. additional withdrawals).
   */
  public withBuilder(fn: (b: TransactionBuilder) => TransactionBuilder): this {
    this.txBuilder = fn(this.txBuilder);
    return this;
  }

  /**
   * Generates the stealth output statement and returns a `StealthTransferSpec`
   * containing the unsigned transaction ready for signing.
   */
  public async build(): Promise<StealthTransferSpec> {
    if (!this.recipientPublicKeyHex) {
      throw new Error("StealthTransfer: recipient public key not set. Call .to() first.");
    }
    if (!this.sourceAccount || !this.resourceAddress) {
      throw new Error("StealthTransfer: source account/resource not set. Call .from() first.");
    }
    if (this.amounts.length === 0) {
      throw new Error("StealthTransfer: no amounts specified. Call .to() with an amount.");
    }

    const statement = await this.factory.generateOutputsStatement(this.recipientPublicKeyHex, this.amounts);

    const totalAmount = this.amounts.reduce((a, b) => a + b, 0n);
    this.txBuilder
      .callMethod({ componentAddress: this.sourceAccount, methodName: "withdraw" }, [
        { Literal: this.resourceAddress },
        { Literal: String(totalAmount) },
      ])
      .saveVar("stealth_bucket")
      .callMethod({ componentAddress: this.sourceAccount, methodName: "deposit_stealth" }, [
        { Workspace: "stealth_bucket" },
        { Literal: JSON.stringify(statement) },
      ]);

    const unsignedTx = this.txBuilder.buildUnsignedTransaction();
    return { unsignedTx, statement };
  }
}
