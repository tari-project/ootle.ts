//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { InvalidArgumentError, Network, defaultIndexerUrl } from "@tari-project/ootle";
import { IndexerProvider, type IndexerProviderOptions } from "./indexer-provider";

/**
 * Fluent builder for constructing an `IndexerProvider`.
 * Mirrors `ProviderBuilder` from the Rust ootle-rs crate.
 *
 * @example
 * ```ts
 * const provider = await ProviderBuilder.new()
 *   .withNetwork(Network.Esmeralda)
 *   .connect();
 * ```
 */
export class ProviderBuilder {
  private _network: Network = Network.LocalNet;
  private _url: string | null = null;
  private _transactionTimeoutMs: number = 60_000;

  public static new(): ProviderBuilder {
    return new ProviderBuilder();
  }

  public withNetwork(network: Network): this {
    this._network = network;
    return this;
  }

  public withUrl(url: string): this {
    if (typeof url !== "string" || url.trim() === "") {
      throw new InvalidArgumentError("ProviderBuilder.withUrl: url must be a non-empty string");
    }
    this._url = url;
    return this;
  }

  /**
   * Sets the maximum time `watchTransaction` will wait for finalization.
   * Mirrors `connect_with_transaction_timeout` from ootle-rs.
   */
  public withTransactionTimeoutMs(ms: number): this {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new InvalidArgumentError(
        `ProviderBuilder.withTransactionTimeoutMs: timeout must be a positive finite number, got ${ms}`,
      );
    }
    this._transactionTimeoutMs = ms;
    return this;
  }

  /**
   * Connects to the indexer. If no URL was set, falls back to `defaultIndexerUrl`
   * for the configured network.
   */
  public async connect(): Promise<IndexerProvider> {
    const url = this._url ?? defaultIndexerUrl(this._network);
    const options: IndexerProviderOptions = {
      url,
      network: this._network,
      defaultTransactionTimeoutMs: this._transactionTimeoutMs,
    };
    return IndexerProvider.connect(options);
  }
}
