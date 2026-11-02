//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// The indexer serves engine values in their CBOR encoding, as base64 strings. These wrap the
// `@tari-project/ootle-wasm-bor` decoders, which turn one into its JSON in the shape of the
// binding type of the same name, and raise a typed error when the bytes do not decode.

import type {
  Event,
  ExecuteResult,
  Resource,
  SubstateValue,
  TransactionReceipt,
  Utxo,
} from "@tari-project/ootle-ts-bindings";
import {
  decodeEvent as wasmDecodeEvent,
  decodeExecuteResult as wasmDecodeExecuteResult,
  decodeResource as wasmDecodeResource,
  decodeSubstateValue as wasmDecodeSubstateValue,
  decodeTransactionReceipt as wasmDecodeTransactionReceipt,
  decodeUtxo as wasmDecodeUtxo,
} from "@tari-project/ootle-wasm-bor";
import { CryptoBridgeError } from "../errors";

function decodeWith<T>(name: string, decode: (encoded: string) => string, encoded: string): T {
  let json: string;
  try {
    json = decode(encoded);
  } catch (cause) {
    throw new CryptoBridgeError(`${name}: value is not a valid CBOR encoding: ${String(cause)}`, {
      cause,
      context: name,
    });
  }
  return JSON.parse(json) as T;
}

/** Decodes a base64 CBOR `SubstateValue`, as in `SubstateState.up.substate` and `EncodedSubstate.value`. */
export function decodeSubstateValue(encoded: string): SubstateValue {
  return decodeWith("decodeSubstateValue", wasmDecodeSubstateValue, encoded);
}

/** Decodes a base64 CBOR `ExecuteResult`, as in a finalized transaction's `execution_result`. */
export function decodeExecuteResult(encoded: string): ExecuteResult {
  return decodeWith("decodeExecuteResult", wasmDecodeExecuteResult, encoded);
}

/** Decodes a base64 CBOR `TransactionReceipt`, as served by `/transaction-receipts`. */
export function decodeTransactionReceipt(encoded: string): TransactionReceipt {
  return decodeWith("decodeTransactionReceipt", wasmDecodeTransactionReceipt, encoded);
}

/** Decodes a base64 CBOR `Event`, as served by the transaction event query and stream. */
export function decodeEvent(encoded: string): Event {
  return decodeWith("decodeEvent", wasmDecodeEvent, encoded);
}

/** Decodes a base64 CBOR `Resource`, as served by `/resources/{address}`. */
export function decodeResource(encoded: string): Resource {
  return decodeWith("decodeResource", wasmDecodeResource, encoded);
}

/** Decodes a base64 CBOR `Utxo`, as served by `/utxos`. */
export function decodeUtxo(encoded: string): Utxo {
  return decodeWith("decodeUtxo", wasmDecodeUtxo, encoded);
}
