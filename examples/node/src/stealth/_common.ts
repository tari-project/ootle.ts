//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Stealth-specific scaffolding for the Node examples.
 *
 * Builds on the base `examples/node/src/_common.ts` and provides the full
 * receive + send + spend surface the stealth scripts share:
 *
 *  - {@link faucetStealth} — faucet → confidential deposit into a fresh recipient.
 *  - {@link stealthUtxoSubstate} — poll the receipt's `up_substates` diff for
 *    the produced `utxo_…` substate.
 *  - {@link faucetRevealed} — sugar over the base `faucet` with the
 *    stealth-tier default fee.
 *  - {@link makeTransfer} — one-liner for `new StealthTransfer(provider, TARI_RESOURCE)`.
 *  - {@link sendStealth} — `prepare → authorize → seal → submit`.
 *  - {@link readUtxoBody} — pull `{ commitment, nonce, encrypted }` from a
 *    fetched UTXO substate.
 */

import type {
  ComponentAddress,
  IndexerGetSubstateResponse,
  Instruction,
  UnsignedTransactionV1,
} from "@tari-project/ootle-ts-bindings";
import {
  Mask,
  StealthTransfer,
  type StealthTransferSpec,
  StealthTransferStatement,
  TransactionBuilder,
  WalletStealthAuthorizer,
  WasmStealthCrypto,
  XTR_FAUCET_CLAIM_RESOURCE_ADDRESS,
  XTR_FAUCET_VAULT_ADDRESS,
  commitmentOf,
  createOutput,
  fromHexStr,
  parseSubstateUtxo,
  signBalanceProof,
  stealthTransferInstruction,
  toHexStr,
} from "@tari-project/ootle";
import { IndexerProvider, PendingTransaction } from "@tari-project/ootle-indexer";
import { DEFAULT_STEALTH_FAUCET_FEE } from "@tari-project/example-common";
import {
  NETWORK,
  TARI_RESOURCE,
  amountLiteralHex,
  faucet,
  faucetComponentAddress,
  firstNewSubstate,
  resourceAddressLiteralHex,
  signAndSubmit,
  type FaucetOptions,
  type NewWallet,
} from "../_common/index.js";

export { DEFAULT_STEALTH_FAUCET_FEE, commitmentOf };

/**
 * The indexer can emit the SSE "committed" event a beat before the receipt
 * diff is queryable, so reading the produced UTXO right after `watch()`
 * occasionally races. Poll a few times before giving up.
 */
const RECEIPT_RETRIES = 6;
const RECEIPT_BACKOFF_MS = 500;

/** Options accepted by {@link faucetStealth}. */
export interface FaucetStealthOptions {
  /** The confidential amount (µTari) to mint into `recipientAddress`. Must be positive. */
  stealthAmount: bigint;
  /**
   * Revealed portion of the faucet dispense used to pay the transaction fee. Defaults to
   * {@link DEFAULT_STEALTH_FAUCET_FEE}. The on-chain `take` mints the dispense onto the
   * sender's freshly-created account; we then withdraw `revealedFee` µTari from it as the
   * revealed input the `StealthTransfer` instruction balances against the stealth output.
   * The residual revealed bucket from the stealth instruction is paid as the fee via
   * `PayFeeFromBucket`.
   */
  revealedFee?: bigint;
  /** Override the faucet component address. Defaults to {@link faucetComponentAddress}. */
  faucetAddress?: ComponentAddress;
}

/**
 * Faucet → confidential deposit into `recipientAddress`, sealed and submitted.
 *
 * All eight steps land in the **fee** block (a single `withFeeInstructionsBuilder`
 * call) so the workspace ids are local and the {@link StealthTransfer}
 * instruction can back-reference the `account`/`bucket` slots produced by the
 * earlier steps in the same block. The main instructions block is empty.
 *
 * Steps emitted in the fee block:
 *
 * 1. `CreateAccount(senderOwnerPk)`            → create the sender account on demand
 * 2. `saveVar("account")`                      → workspace bucket id 0
 * 3. `CallMethod(faucet, "take", [Workspace(account)])` → mints dispense onto account
 * 4. `CallMethod(account, "withdraw", [TARI, revealedFee])` → bucket of revealed XTR
 * 5. `saveVar("bucket")`                       → workspace bucket id 1
 * 6. `StealthTransfer { statement, revealed_input_bucket: bucket }` → confidential output
 * 7. `saveVar("fee_bucket")`                   → workspace bucket id 2 (residual revealed)
 * 8. `PayFeeFromBucket(fee_bucket)`            → pays the tx fee from the residual
 *
 * Returns the {@link PendingTransaction} handle; the caller wraps with `wait()`.
 *
 * @throws if `stealthAmount` is non-positive.
 */
export async function faucetStealth(
  provider: IndexerProvider,
  senderWallet: NewWallet,
  recipientAddress: string,
  options: FaucetStealthOptions,
): Promise<PendingTransaction> {
  const stealthAmount = options.stealthAmount;
  if (stealthAmount <= 0n) {
    throw new Error(`faucetStealth: stealthAmount must be > 0, got ${stealthAmount}`);
  }
  const revealedFee = options.revealedFee ?? DEFAULT_STEALTH_FAUCET_FEE;
  const faucetAddress = options.faucetAddress ?? faucetComponentAddress();
  const senderOwnerPublicKeyHex = toHexStr(await senderWallet.secret.getPublicKey());

  // Build the complete (balance-proof-signed) statement. We deliberately do NOT use
  // the SDK's public `generateOutputsStatement` helper here because it hard-codes
  // `inputs_statement.revealed_amount` to zero — that's correct for a fully-stealth
  // mint, but the faucet path needs `inputs_statement.revealed_amount == stealth_out
  // + revealed_out` so the on-chain `withdraw(account, TARI, revealed_amount)` (read
  // off the statement by the engine's `into_stealth_transfer` validator) lines up
  // with the outputs side. The TS SDK helper diverging here is a known follow-up.
  const crypto = new WasmStealthCrypto(NETWORK);
  const revealedInputAmount = stealthAmount + revealedFee;
  const { statement: outputsStatement, outputMask } = await crypto.generateOutputsStatement(
    [createOutput({ destination: recipientAddress, amount: stealthAmount, resourceAddress: TARI_RESOURCE })],
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
        // Withdraw the revealed slice the stealth instruction will consume. Amount =
        // `inputs_statement.revealed_amount` = stealth_out + revealed_out. The engine's
        // stealth-instruction validator re-derives this from the statement and rejects
        // the call if the bucket's revealed XTR doesn't match.
        .callMethod({ fromWorkspace: "account", methodName: "withdraw" }, [
          { Literal: resourceAddressLiteralHex(TARI_RESOURCE) },
          { Literal: amountLiteralHex(revealedInputAmount) },
        ])
        .saveVar("bucket")
        // Native StealthTransfer instruction mints the confidential output. The
        // statement is embedded as a structured object — a string-typed `statement`
        // field is rejected by the engine.
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
      // Faucet's on-chain inputs (component + vault + claim resource). Without these
      // the engine rejects with `OneOrMoreInputsNotFound`.
      { substate_id: faucetAddress, version: null },
      { substate_id: XTR_FAUCET_VAULT_ADDRESS, version: null },
      { substate_id: XTR_FAUCET_CLAIM_RESOURCE_ADDRESS, version: null },
    ])
    .buildUnsignedTransaction();

  return signAndSubmit(provider, unsigned, [senderWallet.secret]);
}

/** Encode the `PayFeeFromBucket` instruction variant by `WorkspaceOffsetId`. */
function payFeeFromBucketInstruction(bucket: { id: number; offset: number | null }): Instruction {
  return { PayFeeFromBucket: { bucket } };
}

/** A discovered stealth UTXO: the substate id (carries the commitment) and the fetched body. */
export interface StealthUtxoLookup {
  /** The `utxo_<resource>_<commitment>` substate id, source of the commitment. */
  substateId: string;
  /** The fetched substate response (carries `public_nonce` + `encrypted_data`). */
  substate: IndexerGetSubstateResponse;
}

/**
 * Find the stealth UTXO produced by `pending` and fetch its substate.
 *
 * Polls the receipt's `up_substates` diff up to {@link RECEIPT_RETRIES} times
 * with {@link RECEIPT_BACKOFF_MS}ms backoff. The SSE "committed" event can
 * arrive a beat before the diff is queryable, so without the retry this
 * returns `null` intermittently and the script flakes.
 *
 * Both the substate id and the response are returned — `decryptOwnedUtxo` needs
 * both (the id carries the 32-byte commitment derivable via {@link commitmentOf}
 * and the substate carries the `public_nonce` + `encrypted_data` body).
 *
 * @returns The substate + id, or `null` if no `utxo_…` appeared within the retry window.
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

/**
 * Claim the faucet's default dispense into the default account (revealed).
 *
 * Thin wrapper around the base `_common.faucet(...)` — no stealth specifics,
 * kept for naming symmetry with {@link faucetStealth}. The default fee is
 * higher than the base `_common.DEFAULT_FAUCET_FEE` because stealth txs are a
 * hair more expensive at fee-estimation time and would otherwise reject with
 * `MaxFeeExceeded`. Returns the pending handle (caller wraps with `wait()`).
 */
export async function faucetRevealed(
  provider: IndexerProvider,
  signer: NewWallet,
  options: FaucetOptions = {},
): Promise<PendingTransaction> {
  return faucet(provider, signer, { ...options, fee: options.fee ?? DEFAULT_STEALTH_FAUCET_FEE });
}

/** Sugar for a {@link StealthTransfer} over the TARI resource. */
export function makeTransfer(provider: IndexerProvider): StealthTransfer {
  return new StealthTransfer(provider, TARI_RESOURCE);
}

/** Options accepted by {@link sendStealth}. */
export interface SendStealthOptions {
  /**
   * The owner's 32-byte view secret. Required when `transfer` spends stealth
   * inputs (the authorizer needs it to unblind them); the revealed-only path
   * ignores it. Pass `secret.getViewOnlySecret() ?? undefined` from a
   * `SecretKeyWallet` built via `randomWithViewKey` / `fromKeypair(...,
   * viewSecret)`.
   */
  viewSecret?: Uint8Array;
}

/** Result of {@link sendStealth}: the hydrated spec and the pending handle. */
export interface SendStealthResult {
  /** Hydrated `StealthTransferSpec` post-`authorizer.prepare`. */
  spec: StealthTransferSpec;
  /** The pending transaction handle (caller wraps with `wait()`). */
  pending: PendingTransaction;
}

/**
 * Prepare → authorize → seal → submit `transfer`. Returns the hydrated spec and the
 * pending handle.
 */
export async function sendStealth(
  provider: IndexerProvider,
  senderWallet: NewWallet,
  transfer: StealthTransfer,
  options: SendStealthOptions = {},
): Promise<SendStealthResult> {
  const spec = await transfer.prepare();
  const authorizer = WalletStealthAuthorizer.fromSpec(senderWallet.wallet, spec, {
    viewSecret: options.viewSecret,
  });
  const tx = await authorizer.prepare(provider);
  const envelope = await tx.seal();
  const submission = await provider.submitTransaction(envelope);
  const pending = provider.watchTransactionSSE(submission.transaction_id);
  return { spec: tx.getSpec(), pending };
}

/** Parsed UTXO body — the three byte-typed values the spend path needs. */
export interface UtxoBody {
  /** 32-byte Pedersen commitment, derived from the substate id. */
  commitment: Uint8Array;
  /** Sender public nonce (`OutputBody.public_nonce`), raw bytes. */
  nonce: Uint8Array;
  /** AEAD ciphertext (`OutputBody.encrypted_data`), raw bytes. */
  encrypted: Uint8Array;
}

/**
 * Pull `{ commitment, nonce, encrypted }` from a fetched UTXO substate.
 *
 * Thin wrapper over the public {@link parseSubstateUtxo} that converts the hex
 * `public_nonce` / `encrypted_data` fields into raw bytes. Returns `null` when
 * `substate` is not a live, spendable stealth UTXO.
 */
export function readUtxoBody(substate: IndexerGetSubstateResponse, substateId: string): UtxoBody | null {
  const parsed = parseSubstateUtxo(substate, substateId);
  if (parsed === null) {
    return null;
  }
  return {
    commitment: parsed.commitment,
    nonce: fromHexStr(parsed.body.public_nonce),
    encrypted: fromHexStr(parsed.body.encrypted_data),
  };
}
