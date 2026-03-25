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
  generateOotleSecretKey,
  hashUnsignedTransaction,
  publicKeyFromSecretKey,
  schnorrSign,
} from "@tari-project/ootle-wasm";
import { toHexStr } from "./helpers";

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
 * Collects signatures from all provided signers and assembles a signed Transaction.
 */
export async function signTransaction(signers: Signer[], unsignedTx: UnsignedTransactionV1): Promise<Transaction> {
  const { owner_key, view_key } = generateOotleSecretKey();

  const seal_signer_public_key = (await signers[0]?.getPublicKey()) ?? publicKeyFromSecretKey(view_key);

  const allSignatures: TransactionSignature[] = [];
  for (const signer of signers) {
    const sigs = await signer.signTransaction(unsignedTx);
    allSignatures.push(...sigs);
  }

  console.debug("allSignatures= ", allSignatures);
  const body: UnsealedTransactionV1 = {
    transaction: unsignedTx,
    signatures: allSignatures,
  };

  const hash = hashUnsignedTransaction(JSON.stringify(unsignedTx), seal_signer_public_key);
  const s = schnorrSign(owner_key, hash);

  const seal_signature = {
    public_key: toHexStr(seal_signer_public_key),
    signature: {
      public_nonce: toHexStr(s.public_nonce),
      signature: toHexStr(s.signature),
    },
  };

  return {
    V1: {
      body,
      seal_signature,
    },
  };
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

  throw new Error(`Unexpected final_decision variant: ${JSON.stringify(decision)}`);
}

/**
 * Polls the provider until a transaction reaches a finalized state, then returns the result.
 *
 * Throws for `Reject` outcomes. `FeeIntentCommit` (fees paid, execution aborted) also
 * throws with a distinct message so callers can distinguish it from a full rejection.
 * Use `classifyOutcome` on the raw result for non-throwing outcome inspection.
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
        throw new Error(`Transaction ${txId} was rejected: ${reason}`);
      }
      if (outcome === "FeeIntentCommit") {
        throw new Error(`Transaction ${txId} only committed fees (execution aborted): ${reason}`);
      }
      return response;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Transaction ${txId} did not finalize within ${timeoutMs}ms`);
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
