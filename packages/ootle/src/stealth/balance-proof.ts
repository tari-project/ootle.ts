//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Balance-proof helpers (no WASM import — depends only on the crypto seam).
//
// These pull the canonical wire JSON out of the two statement carriers and route it
// through `StealthCryptoProvider.generateBalanceProofSignature`. The statement JSONs are
// already canonical (WASM-produced) — they are carried **byte-exact**, never
// re-stringified or re-keyed, or the signed bytes won't match the wire bytes.

import type { StealthCryptoProvider } from "./crypto-provider";
import type { Mask } from "./primitives";
import { CryptoBridgeError } from "../errors";
import type { BalanceProofSignature, StealthInputsStatement, StealthOutputsStatement } from "./statements";

/**
 * The canonical wire JSON the WASM signer hashes for a statement.
 *
 * - **inputs**: prefers the WASM-produced `statementJson` from `buildInputsStatement`
 *   (the canonical signed bytes, carried byte-exact); falls back to `JSON.stringify`
 *   of the structural view only for the revealed-only / test case where no WASM string
 *   was attached. **Throws** if a non-empty inputs statement has no WASM `statementJson`
 *   — those bytes must come from WASM, never be re-derived (silent signature mismatch).
 * - **outputs**: the WASM-produced `statement_json`, carried verbatim.
 */
export function statementJsonFor(statement: StealthInputsStatement | StealthOutputsStatement): string {
  if (isOutputsStatement(statement)) {
    // Already the WASM-produced canonical string; carry verbatim.
    return statement.statementJson;
  }
  if (statement.statementJson !== undefined) {
    return statement.statementJson;
  }
  // Revealed-only / test path: no confidential inputs, so there is no WASM string. A
  // non-empty inputs statement MUST carry the WASM bytes — refuse to re-derive them.
  if (statement.inputs.length > 0) {
    throw new CryptoBridgeError(
      "inputs statement has confidential inputs but no WASM statementJson — call buildInputsStatement first",
      { context: "statementJsonFor" },
    );
  }
  return JSON.stringify(statement.toJSON());
}

/** Discriminate the two statement carriers (outputs has only a `statementJson` string). */
function isOutputsStatement(
  statement: StealthInputsStatement | StealthOutputsStatement,
): statement is StealthOutputsStatement {
  return !("inputs" in statement);
}

/**
 * Sign the balance proof over an inputs + outputs statement pair.
 *
 * A transfer with **no stealth inputs** uses `inputMask = Mask.zero()`; a
 * **fully-revealed** transfer omits the balance proof entirely (not called here).
 *
 * @returns The `(public_nonce, signature)` balance-proof signature.
 */
export async function signBalanceProof(
  crypto: StealthCryptoProvider,
  inputMask: Mask,
  outputMask: Mask,
  inputsStatement: StealthInputsStatement,
  outputsStatement: StealthOutputsStatement,
): Promise<BalanceProofSignature> {
  const inputsJson = statementJsonFor(inputsStatement);
  const outputsJson = statementJsonFor(outputsStatement);
  return crypto.generateBalanceProofSignature(inputMask, outputMask, inputsJson, outputsJson);
}
