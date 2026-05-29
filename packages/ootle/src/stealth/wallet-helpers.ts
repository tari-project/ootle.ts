//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Receive-side wallet helpers: detect and decrypt a stealth payment.
//
// Depends only on the `StealthCryptoProvider` interface — never on raw WASM —
// so tests can inject a fake. Derives the 32-byte AEAD key from the recipient
// view secret + the output's sender `public_nonce`, then unblinds the raw
// commitment + encrypted-data bytes. `unblindOutput` **throws** when the
// output is not ours; `decryptOwnedUtxo` catches that and returns `null` so a
// recipient can scan a batch of substates without try/catch at every call site.

import type { IndexerGetSubstateResponse } from "@tari-project/ootle-ts-bindings";
import { fromHexStr } from "../helpers/hex";
import { InvalidArgumentError } from "../errors";
import { signBalanceProof } from "./balance-proof";
import type { StealthCryptoProvider } from "./crypto-provider";
import { Mask, type DecryptedData, type Output } from "./primitives";
import { StealthTransferStatement } from "./statements";
import { parseSubstateUtxo } from "./substate-parse";

/** Inputs to {@link decryptInputData}. All byte fields are raw `Uint8Array`. */
export interface DecryptInputOptions {
  /** The output's sender public nonce (the substate body `public_nonce`, as bytes). */
  senderPublicNonce: Uint8Array;
  /** The recipient's 32-byte view secret. */
  viewSecret: Uint8Array;
  /** When `true`, the memo is not decrypted. */
  skipMemo: boolean;
}

/**
 * Decrypt an output's encrypted data given its raw commitment + ciphertext bytes.
 *
 * Derives the AEAD key (`deriveAeadKey(viewSecret, senderPublicNonce)`) and unblinds.
 * **Throws** (via `unblindOutput`) when the output is not owned — callers that scan a
 * batch should prefer {@link decryptOwnedUtxo}, which swallows that throw.
 *
 * @param crypto - The crypto seam (real WASM or a fake).
 * @param commitment - The output's 32-byte Pedersen commitment.
 * @param encryptedData - The raw ciphertext bytes.
 * @param options - The sender public nonce, recipient view secret, and `skipMemo` flag.
 * @returns The decrypted value / mask / memo.
 */
export async function decryptInputData(
  crypto: StealthCryptoProvider,
  commitment: Uint8Array,
  encryptedData: Uint8Array,
  options: DecryptInputOptions,
): Promise<DecryptedData> {
  const aeadKey = await crypto.deriveAeadKey(options.viewSecret, options.senderPublicNonce);
  return crypto.unblindOutput(commitment, encryptedData, aeadKey, options.skipMemo);
}

/**
 * The recipient owner-read: try to decrypt a fetched UTXO substate with a view secret.
 *
 * Parses the substate (commitment from the id, `public_nonce` + `encrypted_data` from
 * the body), derives the AEAD key, and unblinds. Returns the {@link DecryptedData} for
 * an owned UTXO, or `null` when the substate is not a live stealth UTXO **or** the
 * decrypt throws (the "not ours" signal). This lets a recipient scan many substates in
 * a loop without a try/catch at each call site.
 *
 * @param crypto - The crypto seam (real WASM or a fake).
 * @param viewSecret - The recipient's 32-byte view secret.
 * @param substate - The fetched substate response.
 * @param substateId - The substate id the response was fetched by (source of the commitment).
 * @returns The decrypted output if owned, else `null`.
 */
export async function decryptOwnedUtxo(
  crypto: StealthCryptoProvider,
  viewSecret: Uint8Array,
  substate: IndexerGetSubstateResponse,
  substateId: string,
): Promise<DecryptedData | null> {
  const parsed = parseSubstateUtxo(substate, substateId);
  if (parsed === null) {
    return null;
  }
  const encryptedData = fromHexStr(parsed.body.encrypted_data);
  const senderPublicNonce = fromHexStr(parsed.body.public_nonce);
  try {
    return await decryptInputData(crypto, parsed.commitment, encryptedData, {
      senderPublicNonce,
      viewSecret,
      skipMemo: false,
    });
  } catch {
    // `unblindOutput` throws on AEAD failure / commitment mismatch — i.e. this UTXO
    // isn't ours. Swallow it so a batch scan can continue.
    return null;
  }
}

/**
 * Faucet / public-stealth convenience: build a **complete** {@link StealthTransferStatement}
 * for a transfer that has no stealth inputs (e.g. a faucet minting confidential outputs, or
 * any revealed → stealth transfer that doesn't need the full {@link StealthTransfer} builder).
 *
 * Generates the outputs statement, uses a zero (`Mask.zero()`) input mask over an empty
 * revealed-only inputs statement, signs the balance proof, and returns a ready-to-embed
 * statement (`balanceProof` filled). The output mask is non-zero (there is ≥1 stealth
 * output), so the proof is real — not the omitted all-zeros case.
 *
 * For multi-step transfers with revealed change / fee, prefer the {@link StealthTransfer}
 * builder + {@link WalletStealthAuthorizer}; this is the one-shot helper.
 *
 * @param crypto - The crypto seam (real WASM or a fake).
 * @param specs - The stealth outputs to create (must be non-empty).
 * @param revealed - The revealed (un-confidential) output amount (0 for fully-stealth).
 * @returns A complete transfer statement.
 * @throws {InvalidArgumentError} if `specs` is empty.
 */
export async function generateOutputsStatement(
  crypto: StealthCryptoProvider,
  specs: Output[],
  revealed: bigint,
): Promise<StealthTransferStatement> {
  if (specs.length === 0) {
    throw new InvalidArgumentError("generateOutputsStatement: at least one stealth output is required");
  }
  const { statement: outputsStatement, outputMask } = await crypto.generateOutputsStatement(specs, revealed);
  // No stealth inputs: a revealed-only inputs statement with a zero revealed-input amount.
  const inputsStatement = await crypto.buildInputsStatement([], 0n);
  const balanceProof = await signBalanceProof(crypto, Mask.zero(), outputMask, inputsStatement, outputsStatement);
  return new StealthTransferStatement(inputsStatement, outputsStatement, balanceProof);
}
