//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Browser stealth helpers — the React/Vite analogue of
 * `examples/node/src/stealth/_common.ts`. Runtime-agnostic helpers
 * (literal encoders, wait/receipt scanning, constants) live in
 * `@tari-project/example-common`; this module carries the
 * `SecretKeyWallet`-flavoured stealth flow the browser demo runs.
 */

import type {
  ComponentAddress,
  IndexerGetSubstateResponse,
  Instruction,
  UnsignedTransactionV1,
} from "@tari-project/ootle-ts-bindings";
import {
  Mask,
  OotleWallet,
  StealthTransfer,
  type StealthTransferSpec,
  StealthTransferStatement,
  TransactionBuilder,
  WalletStealthAuthorizer,
  XTR_FAUCET_CLAIM_RESOURCE_ADDRESS,
  XTR_FAUCET_VAULT_ADDRESS,
  createOutput,
  sealTransaction,
  signBalanceProof,
  signTransaction,
  stealthTransferInstruction,
  toHexStr,
} from "@tari-project/ootle";
import type { Signer } from "@tari-project/ootle";
import { IndexerProvider, PendingTransaction } from "@tari-project/ootle-indexer";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import {
  DEFAULT_STEALTH_FAUCET_FEE,
  FAUCET_COMPONENT_ADDRESS,
  NETWORK,
  TARI_RESOURCE,
  amountLiteralHex,
  firstNewSubstate,
  resourceAddressLiteralHex,
} from "@tari-project/example-common";
import { stealthCrypto } from "./crypto";

const RECEIPT_RETRIES = 6;
const RECEIPT_BACKOFF_MS = 500;

/** The owner identity + wallet pair. */
export interface StealthIdentity {
  /** In-memory secret key holder (also the default `Signer`). */
  secret: SecretKeyWallet;
  /** Multi-signer wallet (for `WalletStealthAuthorizer`'s key-provider lookup). */
  wallet: OotleWallet;
  /** Owner bech32m address (e.g. `otl_loc_…`). */
  ownerAddress: string;
  /** 32-byte view-only secret — required for stealth scan + spend. */
  viewSecret: Uint8Array;
}

/**
 * Sign `unsigned` with each `signers` and submit the sealed envelope. Thin wrapper around
 * the SDK's `signTransaction` → `sealTransaction` → submit pipeline.
 */
async function signAndSubmit(
  provider: IndexerProvider,
  unsigned: UnsignedTransactionV1,
  signers: Signer[],
): Promise<PendingTransaction> {
  const signed = await signTransaction(signers, unsigned);
  const envelope = sealTransaction(signed);
  const { transaction_id } = await provider.submitTransaction(envelope);
  return provider.watchTransactionSSE(transaction_id);
}

/** Options accepted by {@link faucetStealth}. */
export interface FaucetStealthOptions {
  /** The confidential amount (µTari) to mint into `recipientAddress`. */
  stealthAmount: bigint;
  /** Revealed portion of the dispense used to pay the tx fee. */
  revealedFee?: bigint;
  /** Override the faucet component address. */
  faucetAddress?: ComponentAddress;
}

/**
 * Faucet → confidential deposit into `recipientAddress`, sealed and submitted.
 *
 * All eight instructions land in the fee block so workspace ids are local to
 * the StealthTransfer instruction.
 */
export async function faucetStealth(
  provider: IndexerProvider,
  sender: StealthIdentity,
  recipientAddress: string,
  options: FaucetStealthOptions,
): Promise<PendingTransaction> {
  if (options.stealthAmount <= 0n) {
    throw new Error(`faucetStealth: stealthAmount must be > 0, got ${options.stealthAmount}`);
  }
  const revealedFee = options.revealedFee ?? DEFAULT_STEALTH_FAUCET_FEE;
  const faucetAddress = options.faucetAddress ?? FAUCET_COMPONENT_ADDRESS;
  const senderOwnerPublicKeyHex = toHexStr(await sender.secret.getPublicKey());

  const crypto = stealthCrypto();
  const revealedInputAmount = options.stealthAmount + revealedFee;
  const { statement: outputsStatement, outputMask } = await crypto.generateOutputsStatement(
    [createOutput({ destination: recipientAddress, amount: options.stealthAmount, resourceAddress: TARI_RESOURCE })],
    revealedFee,
  );
  const inputsStatement = await crypto.buildInputsStatement([], revealedInputAmount);
  const balanceProof = await signBalanceProof(crypto, Mask.zero(), outputMask, inputsStatement, outputsStatement);
  const statement = new StealthTransferStatement(inputsStatement, outputsStatement, balanceProof);

  const unsigned: UnsignedTransactionV1 = new TransactionBuilder(NETWORK)
    .withFeeInstructionsBuilder((b) =>
      b
        .createAccount(senderOwnerPublicKeyHex)
        .saveVar("account")
        .callMethod({ componentAddress: faucetAddress, methodName: "take" }, [{ Workspace: "account" }])
        .callMethod({ fromWorkspace: "account", methodName: "withdraw" }, [
          { Literal: resourceAddressLiteralHex(TARI_RESOURCE) },
          { Literal: amountLiteralHex(revealedInputAmount) },
        ])
        .saveVar("bucket")
        .addInstruction(
          stealthTransferInstruction(
            { resourceAddress: TARI_RESOURCE, revealedInputBucket: "bucket", statement },
            (name) => b.resolveWorkspaceOffsetId(name),
          ),
        )
        .saveVar("fee_bucket")
        .addInstruction(payFeeFromBucketInstruction(b.resolveWorkspaceOffsetId("fee_bucket"))),
    )
    .withInputs([
      { substate_id: faucetAddress, version: null },
      { substate_id: XTR_FAUCET_VAULT_ADDRESS, version: null },
      { substate_id: XTR_FAUCET_CLAIM_RESOURCE_ADDRESS, version: null },
    ])
    .buildUnsignedTransaction();

  return signAndSubmit(provider, unsigned, [sender.secret]);
}

function payFeeFromBucketInstruction(bucket: { id: number; offset: number | null }): Instruction {
  return { PayFeeFromBucket: { bucket } };
}

/** A discovered stealth UTXO: the substate id and the fetched body. */
export interface StealthUtxoLookup {
  substateId: string;
  substate: IndexerGetSubstateResponse;
}

/**
 * Find the stealth UTXO produced by `pending` and fetch its substate, polling
 * a few times because the SSE "committed" event can arrive a beat before the
 * receipt diff is queryable.
 */
export async function stealthUtxoSubstate(
  provider: IndexerProvider,
  pending: PendingTransaction,
): Promise<StealthUtxoLookup | null> {
  for (let attempt = 0; attempt < RECEIPT_RETRIES; attempt++) {
    const receipt = await pending.getReceipt().catch(() => null);
    if (receipt !== null) {
      const substateId = firstNewSubstate(receipt, "utxo_");
      if (substateId !== null) {
        const substate = await provider.getSubstate(substateId);
        return { substateId, substate };
      }
    }
    if (attempt + 1 < RECEIPT_RETRIES) {
      await new Promise<void>((resolve) => setTimeout(resolve, RECEIPT_BACKOFF_MS));
    }
  }
  return null;
}

/** Sugar for a {@link StealthTransfer} over the TARI resource. */
export function makeTransfer(provider: IndexerProvider): StealthTransfer {
  return new StealthTransfer(provider, TARI_RESOURCE);
}

/** Result of {@link sendStealth}: the hydrated spec and the pending handle. */
export interface SendStealthResult {
  spec: StealthTransferSpec;
  pending: PendingTransaction;
}

/**
 * Prepare → authorize → seal → submit `transfer`. Returns the hydrated spec and the
 * pending handle.
 */
export async function sendStealth(
  provider: IndexerProvider,
  sender: StealthIdentity,
  transfer: StealthTransfer,
): Promise<SendStealthResult> {
  const spec = await transfer.prepare();
  const authorizer = WalletStealthAuthorizer.fromSpec(sender.wallet, spec, {
    viewSecret: sender.viewSecret,
  });
  const tx = await authorizer.prepare(provider);
  const envelope = await tx.seal();
  const submission = await provider.submitTransaction(envelope);
  const pending = provider.watchTransactionSSE(submission.transaction_id);
  return { spec: tx.getSpec(), pending };
}

