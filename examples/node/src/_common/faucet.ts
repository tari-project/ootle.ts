//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { ComponentAddress, UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import type { TransactionOutcome } from "@tari-project/ootle";
import {
  TransactionBuilder,
  XTR_FAUCET_CLAIM_RESOURCE_ADDRESS,
  XTR_FAUCET_VAULT_ADDRESS,
  toHexStr,
} from "@tari-project/ootle";
import { IndexerProvider, PendingTransaction } from "@tari-project/ootle-indexer";
import { DEFAULT_FAUCET_FEE, NETWORK, amountLiteralHex, firstNewSubstate, wait } from "@tari-project/example-common";
import { faucetComponentAddress } from "./env.js";
import { signAndSubmit } from "./submission.js";
import type { NewWallet } from "./wallet.js";

/** Options accepted by {@link faucet} / {@link faucetAndWait}. */
export interface FaucetOptions {
  /** Max fee (µTari) for the claim. Defaults to {@link DEFAULT_FAUCET_FEE}. */
  fee?: bigint;
  /** Override the faucet component address. Defaults to {@link faucetComponentAddress}. */
  faucetAddress?: ComponentAddress;
}

/**
 * Submit a faucet claim that creates a fresh account for `signer` and deposits
 * the dispense into it. Returns the pending handle (does NOT wait for finality
 * — see {@link faucetAndWait}).
 *
 * Everything happens in the `fee_instructions` block so the freshly-created
 * account can be used to pay its own creation fee. The main `instructions`
 * block is empty. The new component's address is derived by the engine — to
 * read it back, pass the pending handle to {@link faucetAndWait}.
 */
export async function faucet(
  provider: IndexerProvider,
  signer: NewWallet,
  options: FaucetOptions = {},
): Promise<PendingTransaction> {
  const fee = options.fee ?? DEFAULT_FAUCET_FEE;
  const faucetAddress = options.faucetAddress ?? faucetComponentAddress();
  const ownerPublicKeyHex = toHexStr(await signer.secret.getPublicKey());

  const unsigned: UnsignedTransactionV1 = new TransactionBuilder(NETWORK)
    .withFeeInstructionsBuilder((b) =>
      b
        .createAccount(ownerPublicKeyHex)
        .saveVar("account")
        // The on-chain faucet exposes a single `take(account)` method that deposits
        // directly into the workspace-ref'd account. There is NO `take_free_coins` on
        // the live faucet template (the `take_free_coins` name in `FaucetInvokeBuilder`
        // is a leftover and currently fails with `"Function take_free_coins not found"`).
        .callMethod({ componentAddress: faucetAddress, methodName: "take" }, [{ Workspace: "account" }])
        .callMethod({ fromWorkspace: "account", methodName: "pay_fee" }, [{ Literal: amountLiteralHex(fee) }]),
    )
    // Declare the faucet's on-chain inputs (component + vault + claim resource) so the
    // indexer fetches their latest versions before submission — without this, execution
    // rejects with `OneOrMoreInputsNotFound`.
    .withInputs([
      { substate_id: faucetAddress, version: null },
      { substate_id: XTR_FAUCET_VAULT_ADDRESS, version: null },
      { substate_id: XTR_FAUCET_CLAIM_RESOURCE_ADDRESS, version: null },
    ])
    .buildUnsignedTransaction();

  // Submit with `version: null` for each input — the engine resolves the latest
  // version at execution time. Pre-resolving via `resolveTransaction` here is a
  // race: between resolve and execution another tx (faucet claims are shared by
  // every running script) can bump the vault version, causing the engine to
  // reject with `vault_…:NN is DOWN`. The unversioned form leaves resolution to
  // the executor, which always sees the current head.
  return signAndSubmit(provider, unsigned, [signer.secret]);
}

/** Result of a `faucetAndWait` call. */
export interface FaucetAndWaitResult {
  /** The finality outcome (always `Commit` — throws otherwise). */
  outcome: TransactionOutcome;
  /**
   * The freshly-created account's `component_…` address — extracted from the
   * receipt's `up_substates` diff. Use this for any subsequent on-chain ops
   * (balance reads, transfers, fee payments).
   */
  account: ComponentAddress;
}

/**
 * Create a fresh account for `signer`, faucet the dispense into it, and watch the
 * claim to finality. Throws if the outcome is anything other than `Commit`,
 * or if no new `component_…` substate appears in the receipt diff.
 *
 * The new account component is the first new `component_…` substate in the
 * receipt's up_substates list (the faucet's own component is an input).
 */
export async function faucetAndWait(
  provider: IndexerProvider,
  signer: NewWallet,
  options: FaucetOptions & { label?: string } = {},
): Promise<FaucetAndWaitResult> {
  const pending = await faucet(provider, signer, options);
  const outcome = await wait(options.label ?? "faucet", pending);
  const receipt = await pending.getReceipt();
  const account = firstNewSubstate(receipt, "component_");
  if (account === null) {
    throw new Error("Faucet claim committed but no new component substate appeared in the receipt diff");
  }
  return { outcome, account };
}
