//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type {
  UnsignedTransactionV1,
  TransactionSignature,
  TransactionEnvelope,
  IndexerGetTransactionResultResponse,
  UnsealedTransactionV1,
  FinalizeOutcome,
  IndexerTransactionFinalizedResult,
  Transaction,
} from "@tari-project/ootle-ts-bindings";
import type { Provider } from "./provider";
import type { Signer } from "./signer";
import type { WatchOptions } from "./types";
import {
  borEncodeTransaction,
  generateKeypair,
  sealTransaction as wasmSealTransaction,
} from "@tari-project/ootle-wasm";
import { assertByteLength, toHexStr } from "./helpers";
import { InvalidArgumentError, TransactionRejectedError, TransactionTimeoutError } from "./errors";

/**
 * Resolves unversioned inputs in the unsigned transaction by fetching their current
 * version from the provider.
 */
export async function resolveTransaction(
  provider: Provider,
  unsignedTx: UnsignedTransactionV1,
): Promise<UnsignedTransactionV1> {
  const resolvedInputs = await provider.resolveInputs(unsignedTx.inputs);
  return { ...unsignedTx, inputs: resolvedInputs };
}

/**
 * A seal keypair: the throwaway key the seal signature is produced with.
 *
 * Both fields are expected to be exactly 32 bytes. The length invariant is
 * enforced at the trust boundary (in {@link signTransaction}) rather than via
 * a branded type — see the README scope decision on asserted-`Uint8Array` as
 * the default for non-stealth 32-byte values.
 */
export interface SealKeypair {
  secret_key: Uint8Array;
  public_key: Uint8Array;
}

/**
 * Generate a fresh seal keypair (a thin wrapper over the WASM `generateKeypair`).
 *
 * Exposed so a caller that needs the seal **public key before sealing** can fix the
 * keypair once and thread the same public key through other signatures that hash with
 * it (the stealth one-time authorizations — see {@link signTransaction}'s `sealKeypair`
 * parameter). Keeps `@tari-project/ootle-wasm` out of the `stealth/` module.
 */
export function generateSealKeypair(): SealKeypair {
  const { secret_key, public_key } = generateKeypair();
  return { secret_key, public_key };
}

/**
 * Assemble a TransactionSignature from a 32-byte public key and a Schnorr
 * `(public_nonce, signature)` pair. Asserts the 32-byte length on all three
 * inputs at the trust boundary so length regressions surface here, not deeper.
 */
export function buildTransactionSignature(
  publicKey: Uint8Array,
  sig: { public_nonce: Uint8Array; signature: Uint8Array },
): TransactionSignature {
  return {
    public_key: toHexStr(assertByteLength(publicKey, 32, "publicKey")),
    signature: {
      public_nonce: toHexStr(assertByteLength(sig.public_nonce, 32, "schnorr.public_nonce")),
      signature: toHexStr(assertByteLength(sig.signature, 32, "schnorr.signature")),
    },
  };
}

/**
 * Collects signatures from all provided signers and assembles a signed Transaction.
 *
 * @param sealKeypair - Optional pre-generated seal keypair. When omitted, a fresh one is
 *   generated internally (the default for the plain transaction flow). The stealth spend
 *   authorizer passes one so the **same** seal public key flows into its one-time
 *   spend-key authorizations (which hash the tx with the seal public key) and into this
 *   final seal — otherwise those signatures would be over a different hash and fail to
 *   verify.
 */
export async function signTransaction(
  signers: Signer[],
  unsignedTx: UnsignedTransactionV1,
  sealKeypair?: SealKeypair,
): Promise<Transaction> {
  const kp = sealKeypair ?? generateKeypair();
  const secret_key = assertByteLength(kp.secret_key, 32, "sealKeypair.secret_key");
  const seal_signer_public_key = assertByteLength(kp.public_key, 32, "sealKeypair.public_key");
  const allSignatures: TransactionSignature[] = [];
  for (const signer of signers) {
    const sigs = await signer.signTransaction(unsignedTx, seal_signer_public_key);
    allSignatures.push(...sigs);
  }

  const body: UnsealedTransactionV1 = {
    transaction: unsignedTx,
    signatures: allSignatures,
  };

  const sealedJson = wasmSealTransaction(JSON.stringify(body), secret_key);
  return JSON.parse(sealedJson) as Transaction;
}

/**
 * BOR encodes a signed transaction into a TransactionEnvelope.
 */
export function sealTransaction(signedTransaction: Transaction): TransactionEnvelope {
  return borEncodeTransaction(JSON.stringify(signedTransaction));
}

/**
 * Submits an encoded transaction envelope and returns the transaction ID.
 */
export async function submitTransaction(provider: Provider, envelope: TransactionEnvelope): Promise<string> {
  const response = await provider.submitTransaction(envelope);
  return response.transaction_id;
}

/**
 * @throws {InvalidArgumentError} if `result` carries an unrecognised `final_decision`
 *   variant (an indexer protocol mismatch — defence-in-depth).
 */
export function classifyOutcome(
  result: IndexerTransactionFinalizedResult,
): { outcome: FinalizeOutcome | "Reject"; reason?: string } | null {
  if (result === "Pending") return null;
  if (!("Finalized" in result)) return null;

  const finalized = result.Finalized;
  const decision = finalized.final_decision;

  if (decision === "Commit") {
    return { outcome: decision };
  }

  if (typeof decision === "object" && "Abort" in decision) {
    const reason = finalized.abort_details ?? JSON.stringify(decision.Abort);
    // OnlyFeeCommit: fees were paid (fee_decision === "Commit") but execution aborted.
    const execResult = finalized.execution_result?.finalize?.result;
    if (typeof execResult === "object" && "AcceptFeeRejectRest" in execResult) {
      return { outcome: "FeeIntentCommit", reason };
    }
    return { outcome: "Reject", reason };
  }

  throw new InvalidArgumentError(`Unexpected final_decision variant: ${JSON.stringify(decision)}`);
}

/**
 * Polls the provider until a transaction reaches a finalized state, then returns the result.
 *
 * Throws for `Reject` outcomes. `FeeIntentCommit` (fees paid, execution aborted) also
 * throws with a distinct message so callers can distinguish it from a full rejection.
 * Use `classifyOutcome` on the raw result for non-throwing outcome inspection.
 *
 * @throws {TransactionRejectedError} when consensus rejects the transaction, or commits
 *   only the fee intent (execution aborted). The error's `.txId` and `.reason` carry the
 *   structured fields; the message remains the human-readable summary.
 * @throws {TransactionTimeoutError} when the transaction did not finalize within
 *   `timeoutMs`. The error's `.txId` identifies the polled transaction.
 */
export async function watchTransaction(
  provider: Provider,
  txId: string,
  opts?: WatchOptions,
): Promise<IndexerGetTransactionResultResponse> {
  const pollIntervalMs = opts?.pollIntervalMs ?? 500;
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const response = await provider.getTransactionResult(txId);
    const result: IndexerTransactionFinalizedResult = response.result;

    if (result !== "Pending" && "Finalized" in result) {
      const classifiedOutcome = classifyOutcome(result);
      const { outcome, reason } = classifiedOutcome ?? { outcome: "Reject" };
      if (outcome === "Reject") {
        throw new TransactionRejectedError(`Transaction ${txId} was rejected: ${reason}`, {
          txId,
          reason: reason ?? "",
        });
      }
      if (outcome === "FeeIntentCommit") {
        throw new TransactionRejectedError(`Transaction ${txId} only committed fees (execution aborted): ${reason}`, {
          txId,
          reason: `FeeIntentCommit: ${reason ?? ""}`,
        });
      }
      return response;
    }

    if (Date.now() >= deadline) {
      throw new TransactionTimeoutError(`Transaction ${txId} did not finalize within ${timeoutMs}ms`, { txId });
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * All-in-one convenience function: resolve → sign → encode → submit → watch.
 */
export async function sendTransaction(
  provider: Provider,
  signers: Signer | Signer[],
  unsignedTx: UnsignedTransactionV1,
  watchOpts?: WatchOptions,
): Promise<IndexerGetTransactionResultResponse> {
  const resolved = await resolveTransaction(provider, unsignedTx);
  const signedTransaction = await signTransaction(Array.isArray(signers) ? signers : [signers], resolved);
  const envelope = sealTransaction(signedTransaction);
  const txId = await submitTransaction(provider, envelope);
  return watchTransaction(provider, txId, watchOpts);
}

/**
 * Like `sendTransaction` but sets `dry_run = true` on the transaction before
 * submitting, so the network simulates execution without committing state.
 */
export async function sendDryRun(
  provider: Provider,
  signers: Signer | Signer[],
  unsignedTx: UnsignedTransactionV1,
  watchOpts?: WatchOptions,
): Promise<IndexerGetTransactionResultResponse> {
  return sendTransaction(provider, signers, { ...unsignedTx, dry_run: true }, watchOpts);
}
