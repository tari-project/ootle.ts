//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * The simplest stealth transfer: two transactions, start to finish.
 *
 * 1. **Faucet** — create an account for a fresh sender and fill its (public) TARI vault
 *    from the faucet.
 * 2. **Transfer** — withdraw a revealed amount from that vault and send it to a recipient
 *    as a stealth UTXO. On chain, the UTXO is an independent `utxo_…` substate holding a
 *    confidential amount; only the recipient's view key can decrypt it.
 *
 * Usage:
 *
 * ```bash
 * pnpm --filter ootle-example-stealth-transfer start [recipient-address] [memo]
 * ```
 *
 * `recipient-address` is an `otl_loc_…` Ootle address. If omitted, a throwaway recipient is
 * generated (its keys are discarded, so those funds are unspendable).
 *
 * `memo` is an optional message attached to the stealth output. It is encrypted with the
 * output's data, so only the recipient can read it.
 */

import {
  OotleWallet,
  StealthTransfer,
  TransactionBuilder,
  WalletStealthAuthorizer,
  XTR_FAUCET_CLAIM_RESOURCE_ADDRESS,
  XTR_FAUCET_COMPONENT_ADDRESS,
  XTR_FAUCET_VAULT_ADDRESS,
  createOutput,
  defaultIndexerUrl,
  resolveMaxEpoch,
  sealTransaction,
  signTransaction,
  toHexStr,
} from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { NETWORK, TARI_RESOURCE, amountLiteralHex, firstNewSubstate, tari, wait } from "@tari-project/example-common";

/** Max fee for the faucet transaction, paid from the new account. Whatever isn't charged is refunded. */
const FAUCET_MAX_FEE = 250_000n;
/** Revealed TARI withdrawn from the sender's vault and sent to the recipient as a stealth UTXO. */
const TRANSFER_AMOUNT = tari(2);
/** Max fee for the transfer, paid from the sender's vault. Whatever isn't charged is refunded. */
const TRANSFER_MAX_FEE = tari(1);

const provider = await IndexerProvider.connect({
  url: process.env.OOTLE_INDEXER_URL || defaultIndexerUrl(NETWORK),
  network: NETWORK,
});

try {
  // The sender holds its keys in memory. Don't do this with real funds!
  const sender = SecretKeyWallet.randomWithViewKey(NETWORK);
  const senderAddress = await sender.getAddress();
  const recipientAddress = process.argv[2] || (await SecretKeyWallet.randomWithViewKey(NETWORK).getAddress());
  console.log(`Sender:    ${senderAddress}`);
  console.log(`Recipient: ${recipientAddress}`);
  // An optional message for the recipient, encrypted along with the output's amount.
  const memo = process.argv[3] ? { Message: process.argv[3] } : undefined;
  if (memo) {
    console.log(`Memo:      ${memo.Message}`);
  }

  // ---------------------------------------------------------------------------------------
  // Transaction 1: create the sender's account and fill it from the faucet.
  // ---------------------------------------------------------------------------------------
  const senderPublicKeyHex = toHexStr(await sender.getPublicKey());
  const faucetTx = new TransactionBuilder(NETWORK, await resolveMaxEpoch(provider))
    // Everything runs in the fee block: the account doesn't hold any funds to pay a fee
    // until the faucet has paid into it.
    .withFeeInstructionsBuilder((b) =>
      b
        .createAccount(senderPublicKeyHex)
        .saveVar("account")
        .callMethod({ componentAddress: XTR_FAUCET_COMPONENT_ADDRESS, methodName: "take" }, [{ Workspace: "account" }])
        .callMethod({ fromWorkspace: "account", methodName: "pay_fee" }, [
          { Literal: amountLiteralHex(FAUCET_MAX_FEE) },
        ]),
    )
    .withInputs([
      { substate_id: XTR_FAUCET_COMPONENT_ADDRESS, version: null },
      { substate_id: XTR_FAUCET_VAULT_ADDRESS, version: null },
      { substate_id: XTR_FAUCET_CLAIM_RESOURCE_ADDRESS, version: null },
    ])
    .buildUnsignedTransaction();

  const signed = await signTransaction([sender], faucetTx);
  const { transaction_id: faucetTxId } = await provider.submitTransaction(sealTransaction(signed));
  const faucetPending = provider.watchTransactionSSE(faucetTxId);
  await wait(`faucet ${faucetTxId}`, faucetPending);

  const account = firstNewSubstate(await faucetPending.getReceipt(), "component_");
  if (account === null) {
    throw new Error("Faucet transaction committed but created no account");
  }
  console.log(`Sender account: ${account}`);

  // ---------------------------------------------------------------------------------------
  // Transaction 2: send a revealed amount from the account's vault as a stealth UTXO.
  // ---------------------------------------------------------------------------------------
  const transfer = new StealthTransfer(provider, TARI_RESOURCE)
    // Withdraw TRANSFER_AMOUNT of revealed (public) TARI from the sender's vault...
    .spendRevealedInput(account, TRANSFER_AMOUNT)
    // ...and turn all of it into one stealth output for the recipient (∑inputs == ∑outputs).
    .toStealthOutput(
      createOutput({ destination: recipientAddress, amount: TRANSFER_AMOUNT, resourceAddress: TARI_RESOURCE, memo }),
    )
    // The fee is paid separately, from the same vault.
    .payFeeFromRevealed(TRANSFER_MAX_FEE);

  // Builds the transfer statement (range proofs, encrypted output data, balance proof).
  const spec = await transfer.prepare();
  // Signs with the wallet keys the transfer requires (here, the sender's account owner key).
  const wallet = new OotleWallet().registerKeyProvider(senderAddress, sender).setDefaultSigner(senderAddress);
  const authorized = await WalletStealthAuthorizer.fromSpec(wallet, spec).prepare(provider);

  const { transaction_id: transferTxId } = await provider.submitTransaction(await authorized.seal());
  const transferPending = provider.watchTransactionSSE(transferTxId);
  await wait(`stealth transfer ${transferTxId}`, transferPending);

  const utxo = firstNewSubstate(await transferPending.getReceipt(), "utxo_");
  console.log(`Recipient stealth UTXO: ${utxo}`);
} finally {
  provider.stopWatcher();
}
