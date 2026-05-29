//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Walk a component's JSON-rendered `tari_bor::Value` state for vault id
// references — the engine emits values that don't map cleanly to JSON via a
// `{"@cbor": …}` sentinel object (see `tari_bor::value_serde`), so a literal
// JSON tree-walk has to know about `tag`, `map`, and `bytes` sentinels.
//
// The walker powers two callers: (1) `StealthTransfer.prepare` needs the
// revealed source account's vaults in `tx.inputs` so the engine can dispatch
// `withdraw` / `pay_fee` (otherwise it rejects with `SubstateNotFound`); (2)
// public example code reads balances by summing each vault's revealed amount.

import type { ComponentAddress } from "@tari-project/ootle-ts-bindings";
import type { Provider } from "../provider";

/** CBOR tag for a `VaultId` payload in the JSON-rendered `tari_bor::Value` (BinaryTag::VAULT_ID). */
const VAULT_ID_BINARY_TAG = 132;

/** Length, in bytes, of an on-chain `ObjectKey` (the body of an address-like tag). */
const OBJECT_KEY_LEN = 32;

/**
 * Walk the JSON-rendered `tari_bor::Value` of a component's state and yield every
 * 32-byte payload of a `Tag(VAULT_ID, Bytes(..))` node — i.e. every vault id the
 * component references. Depth-first, unique by hex payload.
 *
 * The engine emits values that don't map cleanly to JSON via a `{"@cbor": …}`
 * sentinel object; this walker handles `tag`, `map`, and `bytes` sentinels and
 * recurses through plain text-keyed maps and arrays.
 */
export function* iterVaultIdsInState(value: unknown): Generator<string> {
  const seen = new Set<string>();
  for (const hex of walkTaggedBytes(value, VAULT_ID_BINARY_TAG)) {
    if (hex.length === OBJECT_KEY_LEN * 2 && !seen.has(hex)) {
      seen.add(hex);
      yield `vault_${hex}`;
    }
  }
}

/**
 * Fetch `account` and return the list of vault ids it references (depth-first,
 * unique). Returns an empty array if the component does not exist or holds no
 * vaults.
 */
export async function getVaultIdsForAccount(provider: Provider, account: ComponentAddress): Promise<string[]> {
  const response = await provider.getSubstate(account);
  const componentValue = response.substate;
  if (!isComponentSubstate(componentValue)) return [];
  return Array.from(iterVaultIdsInState(componentValue.Component.body.state));
}

function* walkTaggedBytes(value: unknown, wantTag: number): Generator<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* walkTaggedBytes(item, wantTag);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;

  const node = value as Record<string, unknown>;
  const sentinel = node["@cbor"];
  if (typeof sentinel === "string") {
    if (sentinel === "tag") {
      const inner = node.value;
      if (node.tag === wantTag) {
        const hex = bytesSentinelHex(inner);
        if (hex !== null) yield hex;
      }
      yield* walkTaggedBytes(inner, wantTag);
    } else if (sentinel === "map") {
      const entries = node.entries;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (Array.isArray(entry) && entry.length === 2) {
            yield* walkTaggedBytes(entry[0], wantTag);
            yield* walkTaggedBytes(entry[1], wantTag);
          }
        }
      }
    }
    // `bytes`, `int` sentinels are leaves: a byte payload is only an
    // object key when it sits under a matching `tag`, handled above.
    return;
  }

  for (const child of Object.values(node)) {
    yield* walkTaggedBytes(child, wantTag);
  }
}

function bytesSentinelHex(node: unknown): string | null {
  if (node === null || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (obj["@cbor"] !== "bytes") return null;
  const hex = obj.hex;
  return typeof hex === "string" ? hex : null;
}

interface ComponentSubstateArm {
  Component: { body: { state: unknown } };
}

function isComponentSubstate(value: unknown): value is ComponentSubstateArm {
  return typeof value === "object" && value !== null && "Component" in value;
}
