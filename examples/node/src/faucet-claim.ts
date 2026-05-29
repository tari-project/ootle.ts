//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Faucet smoke test — the shortest end-to-end script in this workspace.
 *
 * Creates a fresh wallet, issues a single transaction that creates an
 * on-chain account, takes the default 10 TARI dispense from the faucet,
 * deposits it into the new account, and pays the transaction fee from the
 * same freshly-funded account. Reads the post-claim TARI balance back and
 * throws if zero.
 */

import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  NETWORK,
  TARI_RESOURCE,
  faucetAndWait,
  getAccountBalance,
  indexerUrl,
  newWallet,
  runScript,
} from "./_common/index.js";

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const wallet = await newWallet();
  console.log(`Wallet owner: ${wallet.ownerAddress}`);

  console.log(`Claiming faucet (creates account + deposits) ...`);
  const { account } = await faucetAndWait(provider, wallet);
  console.log(`Created account: ${account}`);

  const balance = await getAccountBalance(provider, account, TARI_RESOURCE);
  console.log(`Post-claim TARI balance: ${balance}`);

  if (BigInt(balance) <= 0n) {
    throw new Error(`Expected positive TARI balance after faucet claim, got ${balance}`);
  }

  console.log("Done.");
  return { provider };
});
