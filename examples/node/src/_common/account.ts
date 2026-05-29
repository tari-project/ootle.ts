//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { Amount, ComponentAddress, ResourceAddress } from "@tari-project/ootle-ts-bindings";
import { iterVaultIdsInState } from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";

interface ComponentSubstateArm {
  Component: { body: { state: unknown } };
}
interface VaultSubstateArm {
  Vault: {
    resource_container: {
      Fungible?: { address: ResourceAddress; amount: Amount };
      NonFungible?: { address: ResourceAddress; token_ids: unknown[] };
      Confidential?: { address: ResourceAddress; revealed_amount: Amount };
      Stealth?: { address: ResourceAddress; revealed_amount: Amount };
    };
  };
}

function isComponentSubstate(value: unknown): value is ComponentSubstateArm {
  return typeof value === "object" && value !== null && "Component" in value;
}

function isVaultSubstate(value: unknown): value is VaultSubstateArm {
  return typeof value === "object" && value !== null && "Vault" in value;
}

function readContainerRevealed(container: VaultSubstateArm["Vault"]["resource_container"]): {
  address: ResourceAddress;
  amount: Amount;
} {
  if (container.Fungible) return { address: container.Fungible.address, amount: container.Fungible.amount };
  if (container.NonFungible)
    return { address: container.NonFungible.address, amount: container.NonFungible.token_ids.length };
  if (container.Confidential)
    return { address: container.Confidential.address, amount: container.Confidential.revealed_amount };
  if (container.Stealth) return { address: container.Stealth.address, amount: container.Stealth.revealed_amount };
  throw new Error("Vault has no known resource_container arm");
}

/**
 * Return `{ resource: amount }` for every vault on `account`.
 *
 * Fetches the component substate, walks its state tree for vault id
 * references, batch-fetches the vaults, and sums revealed amounts per
 * `ResourceAddress`. Confidential/stealth vaults contribute their
 * `revealed_amount` only; blinded balances are not exposed here.
 *
 * Returns an empty `Map` if the component doesn't exist or holds no vaults.
 */
export async function getAccountBalances(
  provider: IndexerProvider,
  account: ComponentAddress,
): Promise<Map<ResourceAddress, Amount>> {
  const componentResponse = await provider.getSubstate(account);
  const componentValue = componentResponse.substate;
  if (!isComponentSubstate(componentValue)) return new Map();

  const vaultIds = Array.from(iterVaultIdsInState(componentValue.Component.body.state));
  if (vaultIds.length === 0) return new Map();

  const fetched = await provider.fetchSubstates(vaultIds);
  const balances = new Map<ResourceAddress, Amount>();
  for (const substate of Object.values(fetched.substates)) {
    if (!substate) continue;
    const sv = substate.substate;
    if (!isVaultSubstate(sv)) continue;
    const container = sv.Vault.resource_container;
    const { address, amount } = readContainerRevealed(container);
    balances.set(address, amount);
  }
  return balances;
}

/**
 * Return the balance of `resource` held by `account`, or `0n` if there is no vault.
 */
export async function getAccountBalance(
  provider: IndexerProvider,
  account: ComponentAddress,
  resource: ResourceAddress,
): Promise<Amount> {
  const balances = await getAccountBalances(provider, account);
  return balances.get(resource) ?? 0n;
}
