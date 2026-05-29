//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Read-only balance query example.
 *
 * Generates a fresh wallet, faucets TARI into a new account in one
 * transaction, then reads the balance back two ways: a single-resource lookup
 * (`getAccountBalance`) and a full sweep of every vault on the account
 * (`getAccountBalances`). Both helpers walk the component's `tari_bor::Value`
 * state for vault id references.
 */

import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  NETWORK,
  TARI_RESOURCE,
  faucetAndWait,
  getAccountBalance,
  getAccountBalances,
  indexerUrl,
  newWallet,
  runScript,
} from "./_common/index.js";

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const wallet = await newWallet();
  console.log(`Funding fresh wallet (owner ${wallet.ownerAddress}) ...`);
  const { account } = await faucetAndWait(provider, wallet);
  console.log(`Created account: ${account}`);

  console.log(`\nQuerying TARI balance for ${account} ...`);
  const tariBalance = await getAccountBalance(provider, account, TARI_RESOURCE);
  console.log(`TARI balance: ${tariBalance}`);

  console.log(`\nQuerying all balances for ${account} ...`);
  const allBalances = await getAccountBalances(provider, account);
  if (allBalances.size === 0) {
    console.log("  (no vaults found)");
  } else {
    for (const [resource, balance] of allBalances) {
      console.log(`  ${resource}: ${balance}`);
    }
  }

  if (BigInt(tariBalance) <= 0n) {
    throw new Error(`Expected positive TARI balance, got ${tariBalance}`);
  }

  return { provider };
});
