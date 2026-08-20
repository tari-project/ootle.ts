//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * End-to-end template publish example.
 *
 * Reads a compiled template WASM blob from disk (path via OOTLE_TEMPLATE_WASM),
 * faucets a fresh account, dry-runs the publish so the caller sees the
 * estimated fee before paying it (publishing is ~250x the cost of a transfer),
 * submits the real publish, and extracts the resulting template_… address
 * from the receipt diff.
 */

import { readFile } from "node:fs/promises";
import { AccountInvokeBuilder, getVaultIdsForAccount, resolveMaxEpoch } from "@tari-project/ootle";
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

// Publishing is ~250x the cost of a public transfer (≈500k µTari empirically
// on LocalNet). Set this above the dry-run estimate before sending real funds.
const PUBLISH_FEE = 1_000_000n;

await runScript(async () => {
  const wasmPath = process.env.OOTLE_TEMPLATE_WASM;
  if (!wasmPath) {
    throw new Error("OOTLE_TEMPLATE_WASM is required (path to a compiled .wasm file)");
  }

  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const wallet = await newWallet();
  console.log(`Funding fresh wallet (owner ${wallet.ownerAddress}) ...`);
  const { account } = await faucetAndWait(provider, wallet);
  console.log(`Sender account: ${account}`);

  console.log(`\nReading ${wasmPath} ...`);
  const wasmBytes = await readFile(wasmPath);
  const templateBinaryBase64 = wasmBytes.toString("base64");
  console.log(`WASM size: ${wasmBytes.length} bytes (${templateBinaryBase64.length} base64 chars)`);

  // Declare the account and its vaults as inputs so the indexer resolves their versions.
  const senderVaults = await getVaultIdsForAccount(provider, account);
  const unsigned = new AccountInvokeBuilder(NETWORK, await resolveMaxEpoch(provider))
    .withInputs([
      { substate_id: account, version: null },
      ...senderVaults.map((v) => ({ substate_id: v, version: null })),
    ])
    .feeTransactionPayFromComponent(account, PUBLISH_FEE)
    .publishTemplate(account, templateBinaryBase64)
    .build();

  console.log("\nDry-running publish ...");
  const dryRunResult = await dryRun(unsigned, [wallet.secret]);
  const dryRunOutcome = classifyDryRun(dryRunResult);
  if (dryRunOutcome.outcome !== "Commit") {
    throw new Error(`Dry run did not commit: ${JSON.stringify(dryRunOutcome)}`);
  }
  const dryRunFee = dryRunResult.result.finalize.fee_receipt?.total_fees_paid ?? "<unknown>";
  console.log(`Dry run successful. Estimated fee: ${dryRunFee}`);

  console.log("\nSubmitting real publish ...");
  const pending = await signAndSubmit(provider, unsigned, [wallet.secret]);
  await wait("publish", pending);
  const receipt = await pending.getReceipt();

  const templateAddress = firstNewSubstate(receipt, "template_");
  if (templateAddress === null) {
    throw new Error("Publish committed but no new template substate appeared in the receipt diff");
  }
  console.log(`\nPublished template: ${templateAddress}`);

  const substate = await provider.getSubstate(templateAddress);
  console.log(`Substate version: ${substate.version}`);

  return { provider };
});
