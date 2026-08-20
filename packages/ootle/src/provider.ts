//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type {
  IndexerGetSubstateResponse,
  IndexerGetTransactionResultResponse,
  IndexerSubmitTransactionResponse,
  GetSubstatesResponse,
  TransactionEnvelope,
  SubstateRequirement,
  SubstateId,
  GetTemplateDefinitionResponse,
  ListRecentTransactionsRequest,
  ListRecentTransactionsResponse,
} from "@tari-project/ootle-ts-bindings";
import type { Network } from "./network";

/**
 * A Provider reads chain state and submits transactions. It has no signing capability.
 * The canonical implementation is IndexerProvider, which talks to the indexer REST API.
 */
export interface Provider {
  /** Returns the network this provider is connected to. */
  network(): Network;

  /**
   * Returns the epoch the network is currently on.
   *
   * Every transaction carries a mandatory `max_epoch`, capped at
   * `MAX_TRANSACTION_VALIDITY_EPOCHS` past this value, so a builder needs the chain tip
   * before it can be constructed: `TransactionBuilder.new(network, await
   * provider.getCurrentEpoch() + 10)`.
   */
  getCurrentEpoch(): Promise<number>;

  /** Fetches a single substate by ID and optional version. */
  getSubstate(substateId: string, version?: number | null): Promise<IndexerGetSubstateResponse>;

  /**
   * Fetches a stealth UTXO substate by resource address + 32-byte commitment.
   *
   * The provider owns the `utxo_{resourceHex}_{commitmentHex}` id format; callers pass
   * the resource and commitment and never string the id themselves. Returns `null` when
   * the UTXO does not exist (already spent / never created), instead of throwing.
   */
  getStealthUtxo(resourceAddress: string, commitment: Uint8Array): Promise<IndexerGetSubstateResponse | null>;

  /** Fetches multiple substates by ID in a single request. */
  fetchSubstates(requests: SubstateId[]): Promise<GetSubstatesResponse>;

  /** Returns the ABI definition for a published template. */
  getTemplateDefinition(templateAddress: string): Promise<GetTemplateDefinitionResponse>;

  /**
   * Submits a BOR+base64-encoded transaction envelope to the network.
   * Encoding is performed by `sealTransaction` in `transaction.ts`.
   */
  submitTransaction(envelope: TransactionEnvelope): Promise<IndexerSubmitTransactionResponse>;

  /** Polls for the result of a previously submitted transaction. */
  getTransactionResult(transactionId: string): Promise<IndexerGetTransactionResultResponse>;

  /**
   * Resolves unversioned inputs by fetching their current version from the indexer.
   * Returns the same list with `version` filled in for any entry that had `version: null`.
   */
  resolveInputs(inputs: SubstateRequirement[]): Promise<SubstateRequirement[]>;

  /** Lists recent transactions. */
  listRecentTransactions(params: ListRecentTransactionsRequest): Promise<ListRecentTransactionsResponse>;
}
