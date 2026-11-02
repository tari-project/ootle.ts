//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only stand-ins for the CBOR values the indexer serves.
//
// The SDK has no CBOR encoder for engine values, so a test that builds a fixture in code
// (`{ Utxo: { ... } }`) wraps it with {@link encodeForTest}. The vitest setup file
// (`./encoded.setup.ts`) mocks `@tari-project/ootle-wasm-bor` so its decoders hand such a value
// back as JSON, and pass every other string to the real decoder — so the genuine vectors below
// still exercise the real WASM.

/** Prefix marking a test-encoded value; never valid base64 CBOR, so it cannot shadow a real one. */
export const TEST_ENCODING_PREFIX = "test-json:";

/** Encodes `value` so the mocked `ootle-wasm-bor` decoders return it unchanged. */
export function encodeForTest(value: unknown): string {
  return TEST_ENCODING_PREFIX + JSON.stringify(value);
}

// Genuine encodings, from tari-ootle v0.49.0 `crates/ootle_sdk_core/fixtures`.

/** `SubstateValue::Vault`: a fungible vault of `resource_22…22` holding 9577588913 (`substate_decode/fungible_vault`). */
export const SERVED_VAULT = "ggKBgoIAg9iDWCAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIhsAAAACOt5osQAA";

/** `SubstateValue::Component` whose state references `vault_11…11` and `vault_12…12` (`substate_decode/component`). */
export const SERVED_COMPONENT =
  "ggCBgoVYIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAggCAgqCCAYBBAIIAgIGC2IRYIBERERERERERERERERERERERERERERERERERERERERER2IRYIBISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhIS";

/**
 * `ExecuteResult` whose finalize result is `AcceptFeeRejectRest` ("main intent failed")
 * (`parse_finalized_result/accept_fee_reject_rest`).
 */
export const SERVED_ACCEPT_FEE_REJECT_REST_RESULT =
  "hYZYIFFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRgYSCAIHYgFggQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFYIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAa3N0ZC5kZXBvc2l02IGhZmFtb3VudGcxMDAwMDAwgYJxdHJhbnNmZXIgZXhlY3V0ZWSCAoCCAYKDgYKCAIHYgFggQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUGCggCBgoVYIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAggCAgqCCAYBBAIIAgIGB2IRYIENDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDAIGCggKB2IRYIEJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCAYCCAIKCDIBybWFpbiBpbnRlbnQgZmFpbGVkhRsAIAAAAAAH0BsAIAAAAAAF3ACBooIAgBkD6IICgBsAIAAAAAAABwAbACAAAAAAA++iZHNlY3MBZW5hbm9zAAcAAA==";
