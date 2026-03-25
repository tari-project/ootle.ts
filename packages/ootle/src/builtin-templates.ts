//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type {
  Amount,
  ComponentAddress,
  ResourceAddress,
  PublishedTemplateAddress,
  UnsignedTransactionV1,
} from "@tari-project/ootle-ts-bindings";
import { TransactionBuilder } from "./transaction/builder";
import type { Network } from "./network";

/**
 * Fluent builder for common account component invocations.
 * Mirrors `AccountInvokeBuilder` from the Rust ootle-rs crate.
 *
 * @example
 * ```ts
 * const tx = new AccountInvokeBuilder(network, accountAddress)
 *   .feeTransactionPayFromComponent(accountAddress, 1000n)
 *   .publicTransfer(accountAddress, resourceAddress, 500n, recipientAddress)
 *   .build();
 * ```
 */
export class AccountInvokeBuilder {
  private builder: TransactionBuilder;
  private readonly accountAddress: ComponentAddress;

  constructor(network: Network | number, accountAddress: ComponentAddress) {
    this.builder = TransactionBuilder.new(network);
    this.accountAddress = accountAddress;
  }

  /**
   * Adds a fee instruction paying from the account's default vault.
   */
  public feeTransactionPayFromComponent(componentAddress: ComponentAddress, maxFee: Amount): this {
    this.builder.feeTransactionPayFromComponent(componentAddress, maxFee);
    return this;
  }

  /**
   * Transfers `amount` of `resource` from `sourceAccount` to `destinationAddress`.
   * Mirrors `AccountInvokeBuilder::public_transfer` from ootle-rs.
   */
  public publicTransfer(
    sourceAccount: ComponentAddress,
    resourceAddress: ResourceAddress,
    amount: Amount,
    destinationAddress: string,
  ): this {
    this.builder
      .callMethod({ componentAddress: sourceAccount, methodName: "withdraw" }, [
        { Literal: resourceAddress },
        { Literal: String(amount) },
      ])
      .saveVar("bucket")
      .callMethod({ componentAddress: destinationAddress, methodName: "deposit" }, [{ Workspace: "bucket" }]);
    return this;
  }

  /**
   * Publishes a compiled template WASM blob from the account.
   * Mirrors `AccountInvokeBuilder::publish_template` from ootle-rs.
   */
  public publishTemplate(sourceAccount: ComponentAddress, templateBinaryHex: string, workspaceBucket?: string): this {
    const bucket = workspaceBucket ?? "template";
    this.builder
      .callMethod({ componentAddress: sourceAccount, methodName: "publish_template" }, [{ Literal: templateBinaryHex }])
      .saveVar(bucket);
    return this;
  }

  public build(): UnsignedTransactionV1 {
    return this.builder.buildUnsignedTransaction();
  }
}

/**
 * Fluent builder for common faucet component invocations.
 * Mirrors `FaucetInvokeBuilder` from the Rust ootle-rs crate.
 *
 * @example
 * ```ts
 * const tx = new FaucetInvokeBuilder(network, faucetAddress)
 *   .feeTransactionPayFromComponent(accountAddress, 1000n)
 *   .takeFaucetFunds(accountAddress, 10_000n)
 *   .build();
 * ```
 */
export class FaucetInvokeBuilder {
  private builder: TransactionBuilder;
  private readonly faucetAddress: ComponentAddress;

  constructor(network: Network | number, faucetAddress: ComponentAddress) {
    this.builder = TransactionBuilder.new(network);
    this.faucetAddress = faucetAddress;
  }

  public feeTransactionPayFromComponent(componentAddress: ComponentAddress, maxFee: Amount): this {
    this.builder.feeTransactionPayFromComponent(componentAddress, maxFee);
    return this;
  }

  /**
   * Takes `amount` of funds from the faucet and deposits them into `destinationAccount`.
   * Mirrors `FaucetInvokeBuilder::take_faucet_funds` from ootle-rs.
   */
  public takeFaucetFunds(destinationAccount: ComponentAddress, amount: Amount): this {
    this.builder
      .callMethod({ componentAddress: this.faucetAddress, methodName: "take_free_coins" }, [
        { Literal: String(amount) },
      ])
      .saveVar("faucet_bucket")
      .callMethod({ componentAddress: destinationAccount, methodName: "deposit" }, [{ Workspace: "faucet_bucket" }]);
    return this;
  }

  /**
   * Takes the maximum available funds from the faucet into `destinationAccount`.
   * Mirrors `FaucetInvokeBuilder::take_max_faucet_funds` from ootle-rs.
   */
  public takeMaxFaucetFunds(destinationAccount: ComponentAddress): this {
    this.builder
      .callMethod({ componentAddress: this.faucetAddress, methodName: "take_max_free_coins" }, [])
      .saveVar("faucet_bucket")
      .callMethod({ componentAddress: destinationAccount, methodName: "deposit" }, [{ Workspace: "faucet_bucket" }]);
    return this;
  }

  /**
   * Publishes a template from the faucet component address.
   * Mirrors `FaucetInvokeBuilder::publish_template` from ootle-rs.
   */
  public publishTemplate(templateAddress: PublishedTemplateAddress, workspaceBucket?: string): this {
    const bucket = workspaceBucket ?? "template";
    this.builder.callFunction({ templateAddress, functionName: "new" }, []).saveVar(bucket);
    return this;
  }

  public build(): UnsignedTransactionV1 {
    return this.builder.buildUnsignedTransaction();
  }
}
