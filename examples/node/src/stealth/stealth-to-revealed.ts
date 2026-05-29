//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Stealth transfer dominated by a revealed-output bucket (revealed-change path).
 *
 * Demonstrates {@link StealthTransfer.spendRevealedInput} +
 * {@link StealthTransfer.toRevealedOutput} + {@link StealthTransfer.payFeeFromRevealed}
 * routed through {@link sendStealth}. A small stealth output to the sender's
 * own address is included to satisfy the SDK's "at least one stealth output"
 * precondition.
 *
 * ### Amount accounting
 *
 * The `StealthTransfer` builder requires (a) at least one stealth output and
 * (b) a strict revealed-side balance equation that does NOT count the fee
 * toward the revealed-output amount. This script:
 *
 *  - withdraws **3 µTari** of revealed input,
 *  - emits a **1 µTari stealth output to the sender's own address** (so the
 *    sender still owns it after the transfer),
 *  - returns **2 µTari** as the revealed-output change bucket,
 *  - and pays a **1 µTari** fee via `payFeeFromRevealed`.
 *
 * The validator sees `revealed_in (3) == stealth_out (1) + revealed_out (2)`;
 * the engine pays the 1 µTari fee from the sender account vault via the
 * separate `pay_fee` instruction `payFeeFromRevealed` emits.
 */

import { createOutput } from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  NETWORK,
  TARI_RESOURCE,
  faucetAndWait,
  getAccountBalance,
  indexerUrl,
  newWallet,
  runScript,
  tari,
  wait,
} from "../_common/index.js";
import { makeTransfer, sendStealth } from "./_common.js";

/** Revealed XTR withdrawn from the sender's account into the transfer. */
const REVEALED_INPUT = tari(3);
/** Sentinel stealth output sent back to the sender so the TS validator is satisfied. */
const STEALTH_TO_SELF = tari(1);
/** Revealed change deposited back into the sender account by the StealthTransfer. */
const REVEALED_CHANGE = tari(2);
/** Max fee (charged via a separate `pay_fee` instruction on the sender account). */
const FEE = tari(1);

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const sender = await newWallet();
  console.log(`sender: ${sender.ownerAddress}`);

  // Stand up the sender's revealed account via the faucet (creates the
  // account component and deposits the default dispense into its revealed vault).
  const { account: senderAccount } = await faucetAndWait(provider, sender, { label: "faucet-seed" });
  console.log(`account: ${senderAccount}`);

  // Build the stealth transfer:
  //   3 revealed in == 1 stealth out (to self) + 2 revealed out (change) — the
  //   fee is paid separately via the on-chain `pay_fee` instruction and does
  //   NOT appear in the StealthTransfer balance equation.
  const transfer = makeTransfer(provider)
    .spendRevealedInput(senderAccount, REVEALED_INPUT)
    .toStealthOutput(
      createOutput({ destination: sender.ownerAddress, amount: STEALTH_TO_SELF, resourceAddress: TARI_RESOURCE }),
    )
    .toRevealedOutput(REVEALED_CHANGE)
    .payFeeFromRevealed(FEE);

  const viewSecret = sender.secret.getViewOnlySecret();
  if (viewSecret === null) {
    // newWallet() builds via `SecretKeyWallet.fromKeypair(..., viewSecret)` so this is
    // unreachable in practice — guard explicitly rather than `!`-asserting.
    throw new Error("sender wallet has no view-only secret — newWallet() must include one");
  }
  const { pending } = await sendStealth(provider, sender, transfer, { viewSecret });
  await wait("stealth->revealed", pending);

  const balance = await getAccountBalance(provider, senderAccount, TARI_RESOURCE);
  console.log(`sender revealed balance: ${balance} µTari`);

  console.log("Done.");
  return { provider };
});
