//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Spend an owned stealth UTXO — the headline input-aggregation path.
 *
 * End-to-end round-trip exercising the full confidential-spend flow:
 *
 *  1. Faucet → stealth deposit to **self**, so the wallet owns a confidential
 *     UTXO (plus revealed change in its account vault to pay fees with).
 *  2. Discover the produced UTXO from the receipt diff and decrypt it with
 *     {@link decryptInputData} (AEAD value / mask recovery) — purely a
 *     sanity check before spending.
 *  3. Spend it via {@link StealthTransfer.spendStealthInput}; the
 *     {@link WalletStealthAuthorizer} unblinds the input, aggregates the
 *     masks, signs the balance proof, and produces a one-time spend-key
 *     authorization. {@link sendStealth} routes it all through `prepare →
 *     authorize → seal → submit`.
 *
 * ### Amount accounting
 *
 * `StealthTransfer.payFeeFromRevealed` does NOT fold the fee into
 * `revealedOutputAmount`, so without a revealed output the engine sees
 * `revealed_in (1) == revealed_out (0)` and rejects. This script adds a
 * {@link StealthTransfer.toRevealedOutput} of 1 µTari to match `revealed_in`,
 * then pays the 1 µTari fee via the separate `pay_fee` instruction emitted
 * by `payFeeFromRevealed`. The TS validator skips the balance check when
 * stealth inputs are present, so it passes locally; the engine sees
 * revealed_in (1) == revealed_out (1) on the StealthTransfer side and the
 * fee comes from the sender account vault separately.
 */

import { WasmStealthCrypto, createOutput, decryptInputData } from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  NETWORK,
  TARI_RESOURCE,
  firstNewSubstate,
  indexerUrl,
  newRecipient,
  newWallet,
  runScript,
  tari,
  wait,
} from "../_common/index.js";
import { faucetStealth, makeTransfer, readUtxoBody, sendStealth, stealthUtxoSubstate } from "./_common.js";

/** Confidential XTR minted to self via the faucet stealth deposit. */
const SEED_AMOUNT = tari(5);
/** Revealed XTR pulled from the deposit's revealed change to pay the fee. */
const SPEND_FEE = tari(1);

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const sender = await newWallet();
  const recipient = await newRecipient();
  console.log(`owner:     ${sender.ownerAddress}`);
  console.log(`recipient: ${recipient.ownerAddress}`);

  // Faucet → confidential deposit to self in a single transaction. The faucet
  // flow creates the sender's account inline (via the `CreateAccount`
  // instruction the faucet emits), mints the stealth output of `SEED_AMOUNT`
  // onto a fresh UTXO owned by the sender, and leaves the residual revealed
  // dispense as the account's revealed change — that change funds the spend's
  // fee + revealed-input below.
  const depositPending = await faucetStealth(provider, sender, sender.ownerAddress, { stealthAmount: SEED_AMOUNT });
  await wait("faucet-stealth", depositPending);
  const depositReceipt = await depositPending.getReceipt();
  const senderAccount = firstNewSubstate(depositReceipt, "component_");
  if (senderAccount === null) {
    throw new Error("faucet stealth deposit committed but no new component substate appeared in the receipt diff");
  }
  console.log(`account:   ${senderAccount}`);

  // Discover the produced stealth UTXO + decrypt it as a sanity check before
  // trying to spend (`decryptInputData` mirrors what the authorizer does
  // internally on the spend path).
  const found = await stealthUtxoSubstate(provider, depositPending);
  if (found === null) {
    throw new Error("faucet stealth deposit committed but no utxo_… substate appeared in the receipt diff");
  }
  console.log(`\nowned stealth UTXO: ${found.substateId}`);

  const body = readUtxoBody(found.substate, found.substateId);
  if (body === null) {
    throw new Error(`stealth UTXO ${found.substateId} is not a live, spendable substate`);
  }

  const viewSecret = sender.secret.getViewOnlySecret();
  if (viewSecret === null) {
    // newWallet() builds via `SecretKeyWallet.fromKeypair(..., viewSecret)`, so this is
    // unreachable in practice — guard explicitly rather than `!`-asserting.
    throw new Error("sender wallet has no view-only secret — newWallet() must include one");
  }
  const crypto = new WasmStealthCrypto(NETWORK);
  const decrypted = await decryptInputData(crypto, body.commitment, body.encrypted, {
    senderPublicNonce: body.nonce,
    viewSecret,
    skipMemo: true,
  });
  console.log(`  decryptInputData -> value=${decrypted.value} µTari (expected ${SEED_AMOUNT})`);
  if (decrypted.value !== SEED_AMOUNT) {
    throw new Error(`decrypted stealth UTXO value mismatch: ${decrypted.value} != ${SEED_AMOUNT}`);
  }

  // Spend: stealth-in (commitment 5) + revealed-in (1, from the deposit's
  // revealed change) → stealth-out (5, to recipient) + revealed-out (1, to
  // balance the revealed side) + fee (1). Mask aggregation + balance-proof
  // signature happen inside `sendStealth` via the WalletStealthAuthorizer.
  const transfer = makeTransfer(provider)
    .spendStealthInput(sender.ownerAddress, body.commitment)
    .spendRevealedInput(senderAccount, SPEND_FEE)
    .toStealthOutput(
      createOutput({ destination: recipient.ownerAddress, amount: SEED_AMOUNT, resourceAddress: TARI_RESOURCE }),
    )
    .toRevealedOutput(SPEND_FEE)
    .payFeeFromRevealed(SPEND_FEE);

  const { pending } = await sendStealth(provider, sender, transfer, { viewSecret });
  await wait("stealth-spend", pending);

  console.log("Done.");
  return { provider };
});
