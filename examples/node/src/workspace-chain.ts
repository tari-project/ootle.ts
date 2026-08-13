//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Workspace composability example.
 *
 * A single transaction that:
 *   - withdraws 2 TARI from the sender's account, stashing the bucket in a
 *     workspace slot,
 *   - deposits the stashed bucket into an existing recipient account,
 *   - creates a fresh third account alongside the transfer.
 *
 * Everything is one signed payload, one fee. After commit, the script
 * confirms atomicity by reading every touched account's balance and
 * printing the receipt's event list.
 */

import {
  TransactionBuilder,
  getVaultIdsForAccount,
  microTariLiteral,
  resourceAddressLiteral,
} from "@tari-project/ootle";
import type { IndexerGetTransactionResultResponse } from "@tari-project/ootle-ts-bindings";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  NETWORK,
  TARI_RESOURCE,
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

const CHAIN_FEE = 5_000n;

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const senderWallet = await newWallet();
  const recipientWallet = await newWallet();
  const extra = await newRecipient();

  console.log(`Sender owner:    ${senderWallet.ownerAddress}`);
  console.log(`Recipient owner: ${recipientWallet.ownerAddress}`);
  console.log(`Extra owner:     ${extra.ownerAddress}`);

  // Faucet the sender, wait, then faucet the recipient. Running them in
  // parallel races on the faucet's `version: null` resolution and can wedge
  // one of them into a `vault_… is DOWN` reject (faucet.ts:67-72).
  const { account: senderAccount } = await faucetAndWait(provider, senderWallet, { label: "faucet:sender" });
  const { account: recipientAccount } = await faucetAndWait(provider, recipientWallet, { label: "faucet:recipient" });
  console.log(`\nSender account:    ${senderAccount}`);
  console.log(`Recipient account: ${recipientAccount}`);

  const senderVaults = await getVaultIdsForAccount(provider, senderAccount);
  const recipientVaults = await getVaultIdsForAccount(provider, recipientAccount);
  const unsigned = new TransactionBuilder(NETWORK)
    .withInputs([
      { substate_id: senderAccount, version: null },
      ...senderVaults.map((v) => ({ substate_id: v, version: null })),
      { substate_id: recipientAccount, version: null },
      ...recipientVaults.map((v) => ({ substate_id: v, version: null })),
    ])
    .feeTransactionPayFromComponent(senderAccount, CHAIN_FEE)
    .callMethod({ componentAddress: senderAccount, methodName: "withdraw" }, [
      resourceAddressLiteral(TARI_RESOURCE),
      microTariLiteral(tari(2n)),
    ])
    .saveVar("bucket")
    .callMethod({ componentAddress: recipientAccount, methodName: "deposit" }, [{ Workspace: "bucket" }])
    .createAccount(extra.ownerPublicKeyHex)
    .buildUnsignedTransaction();

  console.log("\nDry-running the 3-instruction chain ...");
  const dryRunResult = await dryRun(unsigned, [senderWallet.secret]);
  const dryRunOutcome = classifyDryRun(dryRunResult);
  if (dryRunOutcome.outcome !== "Commit") {
    throw new Error(`Dry run did not commit: ${JSON.stringify(dryRunOutcome)}`);
  }
  const dryRunFee = dryRunResult.result.finalize.fee_receipt?.total_fees_paid ?? "<unknown>";
  console.log(`Dry run successful. Estimated fee: ${dryRunFee}`);

  const pending = await signAndSubmit(provider, unsigned, [senderWallet.secret]);
  await wait("workspace-chain", pending);
  const receipt = await pending.getReceipt();

  // The diff carries the sender (up'd by withdraw), the recipient (up'd by
  // deposit) and the brand-new extra account. Exclude the first two to land
  // on the extra.
  const seen = new Set<string>([senderAccount, recipientAccount]);
  const extraAccount = firstNewSubstate(receipt, "component_", { exclude: seen });
  if (extraAccount === null) {
    throw new Error("Chain committed but the third account didn't appear in the receipt diff");
  }
  console.log(`\nExtra account (created in the same tx): ${extraAccount}`);

  console.log("\nPost-chain balances:");
  for (const [label, addr] of [
    ["Sender   ", senderAccount],
    ["Recipient", recipientAccount],
    ["Extra    ", extraAccount],
  ] as const) {
    const balance = await getAccountBalance(provider, addr, TARI_RESOURCE);
    console.log(`  ${label}: ${balance} (${addr})`);
  }

  printEvents(receipt);

  return { provider };
});

function printEvents(receipt: IndexerGetTransactionResultResponse): void {
  const result = receipt.result;
  if (result === "Pending") return;
  const events = result.Finalized.execution_result?.finalize.events ?? [];
  console.log(`\nReceipt events (${events.length}):`);
  for (const event of events) {
    console.log(`  ${JSON.stringify(event)}`);
  }
}
