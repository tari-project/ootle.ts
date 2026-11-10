//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { SubstateRequirement, ListSubstateItem } from "@tari-project/ootle-ts-bindings";
import { IndexerClientError, WalletError } from "@tari-project/ootle";
import type { IndexerClient } from "@tari-project/indexer-client";

function isNotFoundError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "status" in err && (err as { status?: unknown }).status === 404) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /not found/i.test(message) || message.includes("404");
}

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
        try {
          const substate = await client.substatesGet(want.substateId, {
            version: null,
            local_search_only: false,
            include_proof: false,
          });
          return { substate_id: want.substateId, version: substate.version };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isNotFoundError(error)) {
            throw new IndexerClientError(
              `Failed to find input "${want.substateId}": ${message}. ` +
                `Verify the substate id is correct (typo? wrong network?) or wait for the producing transaction to finalize.`,
              { cause: error },
            );
          }
          throw new IndexerClientError(
            `Failed to resolve input "${want.substateId}": ${message}. ` +
              `Check the indexer URL points at the same network as the substate.`,
            { cause: error },
          );
        }
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
