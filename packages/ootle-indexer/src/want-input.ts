//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { SubstateRequirement, ListSubstateItem } from "@tari-project/ootle-ts-bindings";
import { WalletError } from "@tari-project/ootle";
import type { IndexerClient } from "@tari-project/indexer-client";

/**
 * Lazily describes an input the transaction needs, resolved by querying the indexer.
 * Mirrors `WantInput` from the Rust ootle-rs crate.
 *
 * - `VaultForResource` — find the vault component that holds the given resource address.
 * - `SpecificSubstate` — resolve a specific substate by ID (same as `resolveInputs` but
 *   deferred until `resolveWantInputs` is called).
 */
export type WantInput =
  | { type: "VaultForResource"; resourceAddress: string }
  | { type: "SpecificSubstate"; substateId: string; version?: number | null };

/**
 * Resolves a list of `WantInput` descriptors by querying the indexer, returning
 * fully-versioned `SubstateRequirement` objects ready to attach to a transaction.
 *
 * Mirrors `TransactionInputResolver` from the Rust ootle-rs crate.
 *
 * @throws {WalletError} when a `VaultForResource` query finds no matching vault for
 *   the given resource address (an account-shape problem on the caller's side).
 */
export async function resolveWantInputs(client: IndexerClient, wants: WantInput[]): Promise<SubstateRequirement[]> {
  return Promise.all(
    wants.map(async (want): Promise<SubstateRequirement> => {
      if (want.type === "SpecificSubstate") {
        if (want.version != null) {
          return { substate_id: want.substateId, version: want.version };
        }
        const substate = await client.substatesGet(want.substateId, {
          version: null,
          local_search_only: false,
        });
        return { substate_id: want.substateId, version: substate.version };
      }

      // VaultForResource: list substates filtered by the resource address and
      // find the vault component that holds this resource.
      // The external IndexerClient has no listSubstates method — use the transport directly.
      const query: Record<string, unknown> = {
        filter_by_template: want.resourceAddress,
        filter_by_type: "Vault",
        limit: 1,
      };
      const result = await client.getTransport().sendGet<{ substates: ListSubstateItem[] }>("substates", query);

      const match = result.substates.find(
        (s) => s.template_address === want.resourceAddress || s.substate_id === want.resourceAddress,
      );

      if (!match) {
        throw new WalletError(`Could not find a vault for resource address: ${want.resourceAddress}`);
      }

      return { substate_id: match.substate_id, version: match.version };
    }),
  );
}
