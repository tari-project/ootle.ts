//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Dry-run-only example — estimate fees and surface reject reasons without
 * committing on-chain.
 *
 * A dry-run submits the transaction through the indexer's executor but **does
 * not commit it on-chain**. The result carries the would-be fee, outcome, and
 * events — perfect for the pre-flight check a fee estimator / wallet UI runs
 * before asking the user to authorise the real send.
 *
 * Two dry-runs are issued so callers see both success and failure paths:
 *
 *   - (a) expected-commit: 1 TARI public transfer with inline recipient-
 *         account creation. Prints the estimated fee.
 *   - (b) expected-reject: an over-spending transfer (10_000 TARI). Prints
 *         the reject reason.
 *
 * **No `sendTransaction` is called** — no funds move either way.
 */

import { TransactionBuilder, getVaultIdsForAccount } from "@tari-project/ootle";
import type { ComponentAddress } from "@tari-project/ootle-ts-bindings";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  DEFAULT_FAUCET_FEE,
  NETWORK,
  TARI_RESOURCE,
  appendPublicTransferToNew,
  classifyDryRun,
  dryRun,
  faucetAndWait,
  indexerUrl,
  newRecipient,
  newWallet,
  runScript,
  tari,
} from "./_common/index.js";
import type { NewWallet } from "./_common/index.js";

interface DryRunExpectation {
  expectCommit: boolean;
}

async function dryRunTransfer(
  provider: IndexerProvider,
  senderWallet: NewWallet,
  label: string,
  sender: ComponentAddress,
  recipientOwnerPkHex: string,
  amount: bigint,
  expect: DryRunExpectation,
): Promise<void> {
  // Declare the sender component and every vault it references as inputs — the
  // engine rejects with `vault_… not found` otherwise.
  const senderVaults = await getVaultIdsForAccount(provider, sender);
  const builder = new TransactionBuilder(NETWORK)
    .withInputs([
      { substate_id: sender, version: null },
      ...senderVaults.map((v) => ({ substate_id: v, version: null })),
    ])
    .feeTransactionPayFromComponent(sender, DEFAULT_FAUCET_FEE);
  appendPublicTransferToNew(builder, sender, TARI_RESOURCE, amount, recipientOwnerPkHex, "bucket");
  const unsigned = builder.buildUnsignedTransaction();

  const result = await dryRun(unsigned, [senderWallet.secret]);
  const outcome = classifyDryRun(result);

  if (expect.expectCommit) {
    if (outcome.outcome !== "Commit") {
      throw new Error(`[${label}] expected dry-run to commit; got ${JSON.stringify(outcome)}`);
    }
    const fee = result.result.finalize.fee_receipt?.total_fees_paid ?? "<unknown>";
    console.log(`\n[${label}] dry-run committed. Estimated fee: ${fee}`);
  } else {
    if (outcome.outcome === "Commit") {
      throw new Error(`[${label}] expected dry-run to reject but it committed; outcome=${JSON.stringify(outcome)}`);
    }
    console.log(`\n[${label}] dry-run rejected: ${outcome.reason ?? "<no reason>"}`);
  }
}

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const senderWallet = await newWallet();
  const recipient = await newRecipient();
  console.log(`Sender owner: ${senderWallet.ownerAddress}`);
  console.log(`Recipient owner: ${recipient.ownerAddress}`);

  console.log("\nFaucet: creating sender account + depositing TARI ...");
  const { account: senderAccount } = await faucetAndWait(provider, senderWallet);
  console.log(`Sender account: ${senderAccount}`);

  await dryRunTransfer(provider, senderWallet, "ok (1 TARI)", senderAccount, recipient.ownerPublicKeyHex, tari(1n), {
    expectCommit: true,
  });
  await dryRunTransfer(
    provider,
    senderWallet,
    "overspend (10_000 TARI)",
    senderAccount,
    recipient.ownerPublicKeyHex,
    tari(10_000n),
    { expectCommit: false },
  );

  console.log("\nDone — no transfer was sent. Sender's balance is untouched (minus faucet fee).");
  return { provider };
});
