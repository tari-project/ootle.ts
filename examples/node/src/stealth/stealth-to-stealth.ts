//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Stealth → stealth transfer with revealed change.
 *
 * A sender spends a revealed input and splits it into a confidential output
 * for a fresh recipient plus a revealed-change bucket for itself, paying the
 * fee from its revealed vault. Both outputs must land. Demonstrates the
 * mixed confidential/revealed output shape via
 * {@link StealthTransfer.toStealthOutput} + {@link StealthTransfer.toRevealedOutput},
 * routed through {@link sendStealth}.
 *
 * ### Amount accounting
 *
 * `StealthTransfer.payFeeFromRevealed` does NOT fold the fee into
 * `revealedOutputAmount`, so the TS validator's strict
 * `revealed_in == stealth_out + revealed_out` check requires the revealed
 * change to absorb the fee. This script uses `4 revealed_in → 1 stealth_out +
 * 3 revealed_out + 1 fee`: the validator sees `4 == 1 + 3`, and the engine
 * pays the 1 µTari fee from the same account via the separate `pay_fee`
 * instruction `payFeeFromRevealed` emits.
 */

import { createOutput } from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  NETWORK,
  TARI_RESOURCE,
  faucetAndWait,
  getAccountBalance,
  indexerUrl,
  newRecipient,
  newWallet,
  runScript,
  tari,
  wait,
} from "../_common/index.js";
import { makeTransfer, sendStealth, stealthUtxoSubstate } from "./_common.js";

/** Revealed XTR withdrawn from the sender's account into the transfer. */
const REVEALED_INPUT = tari(4);
/** Confidential output amount routed to the fresh recipient. */
const STEALTH_TO_RECIPIENT = tari(1);
/** Revealed change deposited back into the sender's account. */
const REVEALED_CHANGE = tari(3);
/** Max fee (charged via a separate `pay_fee` instruction on the sender account). */
const FEE = tari(1);

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const sender = await newWallet();
  const recipient = await newRecipient();
  console.log(`sender:    ${sender.ownerAddress}`);
  console.log(`recipient: ${recipient.ownerAddress}`);

  // Stand up the sender's revealed account via the faucet (creates the
  // account component and deposits the default dispense into its revealed vault).
  const { account: senderAccount } = await faucetAndWait(provider, sender, { label: "faucet-seed" });
  console.log(`account:   ${senderAccount}`);

  // 4 revealed in == 1 stealth out (recipient) + 3 revealed out (sender change),
  // with 1 paid separately as fee via the on-chain `pay_fee` instruction.
  const transfer = makeTransfer(provider)
    .spendRevealedInput(senderAccount, REVEALED_INPUT)
    .toStealthOutput(
      createOutput({
        destination: recipient.ownerAddress,
        amount: STEALTH_TO_RECIPIENT,
        resourceAddress: TARI_RESOURCE,
      }),
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
  await wait("stealth->stealth", pending);

  const balance = await getAccountBalance(provider, senderAccount, TARI_RESOURCE);
  console.log(`sender revealed balance: ${balance} µTari`);

  // Surface the produced stealth UTXO for the recipient (informational — the
  // recipient would decrypt it with their view secret to learn the amount).
  const found = await stealthUtxoSubstate(provider, pending);
  if (found !== null) {
    console.log(`recipient stealth UTXO: ${found.substateId}`);
  }

  console.log("Done.");
  return { provider };
});
