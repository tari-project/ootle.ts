//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Provider-agnostic parsing of a UTXO substate into the pieces the receive path
// needs: the 32-byte commitment (taken from the substate id) and the on-chain
// `OutputBody` (with the sender `public_nonce` + `encrypted_data`).
//
// Parsing lives in the stealth module — not in `ootle-indexer` — so it stays
// reusable from any `Provider` (e.g. a future browser provider) and never reaches
// into a concrete client. Binding types come straight from `@tari-project/ootle-ts-bindings`.

import type { IndexerGetSubstateResponse, OutputBody, SubstateValue, Utxo } from "@tari-project/ootle-ts-bindings";
import { fromHexStr, toHexStr } from "../helpers/hex";
import { SCALAR_LENGTH } from "./primitives";

/** Substate-id prefix for a stealth/confidential UTXO (`utxo_{resourceHex}_{commitmentHex}`). */
const UTXO_ID_PREFIX = "utxo";

/**
 * Compose a stealth UTXO substate id from a resource address and a 32-byte commitment.
 *
 * The id format is `utxo_{resourceHex}_{commitmentHex}`, where `resourceHex` is the
 * resource address with its `resource_` prefix stripped (a bare hex string is accepted
 * verbatim). This is the inverse of {@link commitmentOf} and matches the id the
 * `IndexerProvider.getStealthUtxo` fetch composes, so the spend builder can register a
 * stealth input as a tx input **without** reaching into the concrete indexer client.
 *
 * @param resourceAddress - The resource address (`resource_<hex>`) or a bare hex string.
 * @param commitment - The output's 32-byte Pedersen commitment.
 * @returns The `utxo_{resourceHex}_{commitmentHex}` substate id.
 */
export function stealthUtxoSubstateId(resourceAddress: string, commitment: Uint8Array): string {
  const resourceHex = resourceAddress.startsWith("resource_")
    ? resourceAddress.slice("resource_".length)
    : resourceAddress;
  return `${UTXO_ID_PREFIX}_${resourceHex}_${toHexStr(commitment)}`;
}

/** Number of hex characters in a 32-byte commitment. */
const COMMITMENT_HEX_LENGTH = SCALAR_LENGTH * 2;

/** True if `value` is a `{ Utxo: Utxo }` arm of the {@link SubstateValue} union. */
function isUtxoSubstate(value: SubstateValue): value is { Utxo: Utxo } {
  return typeof value === "object" && value !== null && "Utxo" in value;
}

/** True if `s` is a non-empty string of `[0-9a-fA-F]`. */
function isHex(s: string): boolean {
  return s.length > 0 && /^[0-9a-fA-F]+$/.test(s);
}

/**
 * Extract the 32-byte commitment from a UTXO substate id.
 *
 * A UTXO id has the form `utxo_{resourceHex}_{commitmentHex}`; the commitment is the
 * **trailing** hex segment. Returns `null` if the id is not a UTXO id (wrong prefix,
 * e.g. a component/vault id) or the trailing segment is not exactly 32 bytes of hex.
 *
 * The commitment is **never** in the output body — always derive it from the id.
 *
 * @param substateId - The full substate id string.
 * @returns The 32-byte commitment, or `null` if `substateId` is not a valid UTXO id.
 */
export function commitmentOf(substateId: string): Uint8Array | null {
  const parts = substateId.split("_");
  // Expect at least `utxo`, a resource segment, and the commitment segment.
  if (parts.length < 3 || parts[0] !== UTXO_ID_PREFIX) {
    return null;
  }
  const commitmentHex = parts[parts.length - 1];
  if (commitmentHex.length !== COMMITMENT_HEX_LENGTH || !isHex(commitmentHex)) {
    return null;
  }
  return fromHexStr(commitmentHex);
}

/** A parsed, spendable UTXO: its commitment (from the id) plus the on-chain output body. */
export interface ParsedUtxo {
  /** 32-byte Pedersen commitment, derived from the substate id via {@link commitmentOf}. */
  commitment: Uint8Array;
  /** The on-chain output body (`public_nonce`, `encrypted_data`, ...). */
  body: OutputBody;
}

/**
 * Parse a fetched substate into a {@link ParsedUtxo}, or `null` when it is not a
 * live, spendable stealth UTXO.
 *
 * Returns `null` when:
 * - the substate is not the `Utxo` arm of {@link SubstateValue} (e.g. a component/vault),
 * - the UTXO has been spent (`output === null`),
 * - the UTXO is frozen (`is_frozen === true`),
 * - or the substate id does not yield a valid 32-byte commitment.
 *
 * @param substate - The fetched substate response.
 * @param substateId - The substate id the response was fetched by (source of the commitment).
 */
export function parseSubstateUtxo(substate: IndexerGetSubstateResponse, substateId: string): ParsedUtxo | null {
  const value = substate.substate;
  if (!isUtxoSubstate(value)) {
    return null;
  }
  const utxo = value.Utxo;
  // Spent (output cleared) or frozen UTXOs are not spendable.
  if (utxo.output === null || utxo.is_frozen) {
    return null;
  }
  const commitment = commitmentOf(substateId);
  if (commitment === null) {
    return null;
  }
  return { commitment, body: utxo.output.output };
}
