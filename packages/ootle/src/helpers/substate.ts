//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { IndexerGetSubstateResponse, SubstateValue } from "@tari-project/ootle-ts-bindings";
import { decodeSubstateValue } from "./decode";

/**
 * The decoded value of a fetched substate, or `null` if the indexer answered that the
 * requested version is down (only possible for a request with `include_proof`
 * that names the version).
 *
 * The indexer serves the value CBOR-encoded (`state.up.substate` is base64); this decodes it.
 *
 * @throws {CryptoBridgeError} if the served value is not a valid `SubstateValue` encoding.
 */
export function upSubstateValue(response: IndexerGetSubstateResponse): SubstateValue | null {
  return "up" in response.state ? decodeSubstateValue(response.state.up.substate) : null;
}
