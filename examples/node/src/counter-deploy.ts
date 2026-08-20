//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Instantiate-a-template + chain-a-method example.
 *
 * Calls `new()` on a published template (address via OOTLE_COUNTER_TEMPLATE),
 * stashes the returned component reference in a workspace slot, calls
 * `increase()` on that reference — all in one atomic transaction — then
 * extracts the freshly-created `component_…` address from the receipt and
 * reads its state back.
 *
 * The script works against any template whose `new()` constructor takes no
 * args and exposes an `increase()` method. The brief uses "counter" as the
 * canonical example.
 */

import { TransactionBuilder, getVaultIdsForAccount, resolveMaxEpoch } from "@tari-project/ootle";
import type {
  ComponentAddress,
  IndexerGetTransactionResultResponse,
  PublishedTemplateAddress,
} from "@tari-project/ootle-ts-bindings";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  NETWORK,
  classifyDryRun,
  dryRun,
  faucetAndWait,
  firstNewSubstate,
  indexerUrl,
  newWallet,
  runScript,
  signAndSubmit,
  wait,
} from "./_common/index.js";

const DEPLOY_FEE = 2_000n;

await runScript(async () => {
  const templateAddress = process.env.OOTLE_COUNTER_TEMPLATE;
  if (!templateAddress) {
    throw new Error(
      "OOTLE_COUNTER_TEMPLATE is required (the published counter template_… address; " +
        "run `publish-template` to publish one if you don't have a deployed copy).",
    );
  }
  if (!templateAddress.startsWith("template_")) {
    throw new Error(`OOTLE_COUNTER_TEMPLATE must start with 'template_' (got '${templateAddress}')`);
  }

  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const wallet = await newWallet();
  console.log(`Funding fresh wallet (owner ${wallet.ownerAddress}) ...`);
  const { account: sender } = await faucetAndWait(provider, wallet);
  console.log(`Sender account: ${sender}`);

  console.log(`\nBuilding deploy + increase chain on ${templateAddress} ...`);
  const senderVaults = await getVaultIdsForAccount(provider, sender);
  const unsigned = new TransactionBuilder(NETWORK, await resolveMaxEpoch(provider))
    .withInputs([
      { substate_id: sender, version: null },
      ...senderVaults.map((v) => ({ substate_id: v, version: null })),
    ])
    .feeTransactionPayFromComponent(sender, DEPLOY_FEE)
    .callFunction({ templateAddress: templateAddress as PublishedTemplateAddress, functionName: "new" }, [])
    .saveVar("counter")
    .callMethod({ fromWorkspace: "counter", methodName: "increase" }, [])
    .buildUnsignedTransaction();

  console.log("\nDry-running deploy chain ...");
  const dryRunResult = await dryRun(unsigned, [wallet.secret]);
  const dryRunOutcome = classifyDryRun(dryRunResult);
  if (dryRunOutcome.outcome !== "Commit") {
    throw new Error(`Dry run did not commit: ${JSON.stringify(dryRunOutcome)}`);
  }
  const dryRunFee = dryRunResult.result.finalize.fee_receipt?.total_fees_paid ?? "<unknown>";
  console.log(`Dry run successful. Estimated fee: ${dryRunFee}`);

  console.log("\nSubmitting real deploy ...");
  const pending = await signAndSubmit(provider, unsigned, [wallet.secret]);
  await wait("counter-deploy", pending);
  const receipt = await pending.getReceipt();

  const counterAddress = extractNewCounter(receipt, sender);
  console.log(`\nNew counter component: ${counterAddress}`);

  const substate = await provider.getSubstate(counterAddress);
  console.log(`Counter substate: ${JSON.stringify(substate, null, 2)}`);

  return { provider };
});

function extractNewCounter(receipt: IndexerGetTransactionResultResponse, sender: ComponentAddress): ComponentAddress {
  const found = firstNewSubstate(receipt, "component_", { exclude: new Set([sender]) });
  if (found === null) {
    throw new Error("Counter deploy committed but no new component substate appeared in the receipt diff");
  }
  return found;
}
