//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type {
  GetSubstatesResponse,
  GetTemplateDefinitionResponse,
  IndexerGetSubstateResponse,
  IndexerGetTransactionResultResponse,
  IndexerSubmitTransactionResponse,
  ListRecentTransactionsRequest,
  ListRecentTransactionsResponse,
  SubstateId,
  SubstateRequirement,
  TransactionEnvelope,
} from "@tari-project/ootle-ts-bindings";
import type { Provider } from "@tari-project/ootle";
import { IndexerClientError, Network, toHexStr } from "@tari-project/ootle";
import { IndexerClient } from "@tari-project/indexer-client";
import { PendingTransaction, TransactionWatcher } from "./tx-watcher";

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found/i.test(message) || message.includes("404");
}

export interface IndexerProviderOptions {
  /** Base URL of the indexer REST API, e.g. "http://localhost:18300" */
  url: string;
  network: Network;
  /** Default timeout for `watchTransaction`, in milliseconds. Defaults to 60000ms. */
  defaultTransactionTimeoutMs?: number;
}

export class IndexerProvider implements Provider {
  private readonly client: IndexerClient;
  private readonly _network: Network;
  private readonly _url: string;
  private _watcher: TransactionWatcher | null = null;
  readonly defaultTransactionTimeoutMs: number;

  private constructor(client: IndexerClient, network: Network, url: string, defaultTransactionTimeoutMs: number) {
    this.client = client;
    this._network = network;
    this._url = url;
    this.defaultTransactionTimeoutMs = defaultTransactionTimeoutMs;
  }

  /**
   * Creates an IndexerProvider and verifies connectivity by fetching the indexer identity.
   */
  public static async connect(options: IndexerProviderOptions): Promise<IndexerProvider> {
    const client = IndexerClient.usingFetchTransport(options.url);
    await client.identityGet();
    return new IndexerProvider(client, options.network, options.url, options.defaultTransactionTimeoutMs ?? 60_000);
  }

  /** Exposes the underlying IndexerClient for advanced use (e.g. resolveWantInputs). */
  public getClient(): IndexerClient {
    return this.client;
  }

  /**
   * Returns a `PendingTransaction` that resolves via SSE when the network
   * finalises the transaction, falling back to REST polling on timeout.
   *
   * The `TransactionWatcher` SSE loop is created lazily on the first call
   * and reused for all subsequent calls on this provider instance.
   */
  public watchTransactionSSE(txId: string, timeoutMs?: number): PendingTransaction {
    if (!this._watcher) {
      this._watcher = new TransactionWatcher(this._url);
      this._watcher.start();
    }
    return this._watcher.watch(txId, this.client, timeoutMs ?? this.defaultTransactionTimeoutMs);
  }

  /**
   * Stops the SSE `TransactionWatcher` if one is running.
   * Call this when the provider is no longer needed to release the connection.
   */
  public stopWatcher(): void {
    this._watcher?.stop();
    this._watcher = null;
  }

  public network(): Network {
    return this._network;
  }

  public async getSubstate(substateId: string, version: number | null = null): Promise<IndexerGetSubstateResponse> {
    return this.client.substatesGet(substateId, {
      version,
      local_search_only: false,
    });
  }

  public async getStealthUtxo(
    resourceAddress: string,
    commitment: Uint8Array,
  ): Promise<IndexerGetSubstateResponse | null> {
    // A UTXO substate id is `utxo_{resourceHex}_{commitmentHex}`, where `resourceHex` is
    // the hex of the resource address (i.e. its `resource_` prefix stripped). Accept either
    // a full `resource_<hex>` address or a bare hex string for forward-compatibility.
    const resourceHex = resourceAddress.startsWith("resource_")
      ? resourceAddress.slice("resource_".length)
      : resourceAddress;
    const substateId = `utxo_${resourceHex}_${toHexStr(commitment)}`;
    try {
      return await this.getSubstate(substateId);
    } catch (error) {
      // A missing UTXO (spent / never created) is a normal "not found" outcome,
      // surfaced as `null` rather than a throw.
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  public async fetchSubstates(requests: SubstateId[]): Promise<GetSubstatesResponse> {
    return this.client.fetchSubstates({ requests, cached_only: false });
  }

  public async getTemplateDefinition(templateAddress: string): Promise<GetTemplateDefinitionResponse> {
    // The external IndexerClient.templatesGet() is typed as returning TemplatesGetResponse
    // (wallet type), but the indexer REST endpoint actually returns GetTemplateDefinitionResponse.
    return this.client.templatesGet(templateAddress) as unknown as Promise<GetTemplateDefinitionResponse>;
  }

  public async submitTransaction(envelope: TransactionEnvelope): Promise<IndexerSubmitTransactionResponse> {
    // The external IndexerClient.submitTransaction() is typed as TransactionSubmitRequest
    // (wallet type with seal_signer, etc.), but the indexer REST endpoint accepts
    // IndexerSubmitTransactionRequest ({ transaction: TransactionEnvelope }).
    // Use the transport directly to send the correct request shape.
    return this.client
      .getTransport()
      .sendPost<IndexerSubmitTransactionResponse>("transactions", { transaction: envelope });
  }

  public async getTransactionResult(transactionId: string): Promise<IndexerGetTransactionResultResponse> {
    return this.client.getTransactionResult(transactionId);
  }

  public async resolveInputs(inputs: SubstateRequirement[]): Promise<SubstateRequirement[]> {
    return await Promise.all(
      inputs.map(async (req): Promise<SubstateRequirement> => {
        if (req.version !== null) {
          return req;
        }
        try {
          const substate = await this.client.substatesGet(req.substate_id, {
            version: null,
            local_search_only: false,
          });
          return { substate_id: req.substate_id, version: substate.version };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isNotFoundError(error)) {
            throw new IndexerClientError(
              `Failed to find input "${req.substate_id}": ${message}. ` +
                `Verify the substate id is correct (typo? wrong network?) or wait for the producing transaction to finalize.`,
              {
                cause: error,
                url: this._url,
              },
            );
          }
          throw new IndexerClientError(
            `Failed to resolve input "${req.substate_id}": ${message}. ` +
              `Check the indexer URL points at the same network as the substate.`,
            {
              cause: error,
              url: this._url,
            },
          );
        }
      }),
    );
  }

  public async listRecentTransactions(params: ListRecentTransactionsRequest): Promise<ListRecentTransactionsResponse> {
    return await this.client.listRecentTransactions(params);
  }
}
