//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * End-to-end faucet → multi-recipient transfer example.
 *
 * Generates a fresh sender, faucets TARI into a freshly-created account,
 * registers a second signer to exercise the multi-signer co-authorisation
 * path (`OotleWallet.registerKeyProvider`), dry-runs the transfer to surface
 * the estimated fee, then publicly transfers 2 + 1 TARI to two fresh
 * recipients — each recipient's account is created **inline** in the
 * transfer transaction.
 */

import { TransactionBuilder, getVaultIdsForAccount, resolveMaxEpoch } from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  DEFAULT_FAUCET_FEE,
  NETWORK,
  TARI_RESOURCE,
  appendPublicTransferToNew,
  classifyDryRun,
  dryRun,
  faucetAndWait,
  firstNewSubstate,
  getAccountBalance,
  indexerUrl,
  newRecipient,
  newWallet,
  runScript,
  signAndSubmit,
  tari,
  wait,
} from "./_common/index.js";

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const senderWallet = await newWallet();
  console.log(`Sender owner: ${senderWallet.ownerAddress}`);

  // Step 1: create + faucet the sender's account.
  const { account: senderAccount } = await faucetAndWait(provider, senderWallet);
  console.log(`Sender account: ${senderAccount}`);

  // Step 2: register a second signer to exercise the multi-signer co-auth path.
  // The second signer is generated alongside the sender; both feed `signAndSubmit`
  // so the transfer carries two signatures, even though only the sender's account
  // is touched.
  const coSigner = await newWallet();
  console.log(`Registered co-signer: ${coSigner.ownerAddress}`);

  // Step 3: prepare the transfer (2 TARI + 1 TARI) to two fresh recipients,
  // inlining each recipient's `create_account` (their components don't exist
  // yet — `newRecipient()` only generated owner keys).
  const recipient1 = await newRecipient();
  const recipient2 = await newRecipient();

  // Declare the sender component + every vault it references (the engine
  // rejects `withdraw` with `vault_… not found` otherwise).
  const senderVaults = await getVaultIdsForAccount(provider, senderAccount);
  const transferBuilder = new TransactionBuilder(NETWORK, await resolveMaxEpoch(provider))
    .withInputs([
      { substate_id: senderAccount, version: null },
      ...senderVaults.map((v) => ({ substate_id: v, version: null })),
    ])
    .feeTransactionPayFromComponent(senderAccount, DEFAULT_FAUCET_FEE);
  appendPublicTransferToNew(
    transferBuilder,
    senderAccount,
    TARI_RESOURCE,
    tari(2n),
    recipient1.ownerPublicKeyHex,
    "b1",
  );
  appendPublicTransferToNew(
    transferBuilder,
    senderAccount,
    TARI_RESOURCE,
    tari(1n),
    recipient2.ownerPublicKeyHex,
    "b2",
  );
  const unsigned = transferBuilder.buildUnsignedTransaction();

  // Step 4: dry-run to surface any reject reason before paying for the real send.
  // Both signers participate in the dry-run too so the indexer sees the same
  // signature set it will get on the real send.
  const signers = [senderWallet.secret, coSigner.secret];
  const dryRunResult = await dryRun(unsigned, signers);
  const dryRunOutcome = classifyDryRun(dryRunResult);
  if (dryRunOutcome.outcome !== "Commit") {
    throw new Error(`Dry run did not commit: ${JSON.stringify(dryRunOutcome)}`);
  }
  const dryRunFee = dryRunResult.result.finalize.fee_receipt?.total_fees_paid ?? "<unknown>";
  console.log(`\nDry run successful. Estimated fee: ${dryRunFee}`);

  // Step 5: seal + send the real transfer.
  const pending = await signAndSubmit(provider, unsigned, signers);
  await wait("transfer", pending);

  // Step 6: surface each recipient's freshly-created account from the receipt
  // diff, then read balances. The diff carries the sender account (an input,
  // also up'd) plus both recipient accounts (new). We exclude the sender as we
  // walk, so the first two remaining `component_…` ids are the two recipients,
  // in transfer order.
  const receipt = await pending.getReceipt();
  const seen = new Set<string>([senderAccount]);
  const recipient1Account = firstNewSubstate(receipt, "component_", { exclude: seen });
  if (recipient1Account === null) {
    throw new Error("Transfer committed but recipient 1's account was not in the receipt diff");
  }
  seen.add(recipient1Account);
  const recipient2Account = firstNewSubstate(receipt, "component_", { exclude: seen });
  if (recipient2Account === null) {
    throw new Error("Transfer committed but recipient 2's account was not in the receipt diff");
  }

  const senderBalance = await getAccountBalance(provider, senderAccount, TARI_RESOURCE);
  console.log(`\nSender TARI balance: ${senderBalance}`);
  for (const [label, addr, expected] of [
    ["Recipient 1", recipient1Account, tari(2n)] as const,
    ["Recipient 2", recipient2Account, tari(1n)] as const,
  ]) {
    const balance = await getAccountBalance(provider, addr, TARI_RESOURCE);
    console.log(`${label} TARI balance: ${balance} (account ${addr})`);
    if (BigInt(balance) !== expected) {
      throw new Error(`${label} expected ${expected} but got ${balance}`);
    }
  }

  return { provider };
});
