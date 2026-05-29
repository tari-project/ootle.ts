//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Faucet → stealth deposit, then decrypt the new UTXO with the recipient's view key.
 *
 * Demonstrates the public faucet stealth path and the recipient-side AEAD owner-read:
 *
 * - {@link generateOutputsStatement} (one-shot helper for revealed → stealth) + the
 *   native `StealthTransfer` instruction shape land a confidential value on a fresh
 *   recipient UTXO (see {@link faucetStealth}).
 * - {@link decryptOwnedUtxo} recovers the confidential `(value, mask)` from the
 *   UTXO's `encrypted_data` using the recipient's 32-byte view secret — proving
 *   ownership without ever consulting the network for a balance.
 */

import { WasmStealthCrypto, decryptOwnedUtxo } from "@tari-project/ootle";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import { NETWORK, indexerUrl, newWallet, runScript, tari, wait } from "../_common/index.js";
import { faucetStealth, stealthUtxoSubstate } from "./_common.js";

/** TARI count to deposit confidentially. The script asserts the recipient decrypts the same value. */
const STEALTH_AMOUNT = 2;

await runScript(async () => {
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const sender = await newWallet();
  const recipient = await newWallet();
  const amount = tari(STEALTH_AMOUNT);

  console.log(`sender:    ${sender.ownerAddress}`);
  console.log(`recipient: ${recipient.ownerAddress}`);

  const pending = await faucetStealth(provider, sender, recipient.ownerAddress, { stealthAmount: amount });
  await wait("faucet-stealth", pending);

  const found = await stealthUtxoSubstate(provider, pending);
  if (found === null) {
    throw new Error("faucet stealth deposit committed but no utxo_… substate appeared in the receipt diff");
  }
  console.log(`\nstealth UTXO: ${found.substateId}`);

  // The recipient owns the new UTXO via their view-only secret — AEAD-decrypt the
  // commitment + encrypted_data to recover the confidential value. A `null` return
  // here would mean "this UTXO isn't ours" (AEAD failure or commitment mismatch);
  // since WE minted it for this exact recipient, `null` is a script failure.
  const viewSecret = recipient.secret.getViewOnlySecret();
  if (viewSecret === null) {
    // newWallet() builds via `SecretKeyWallet.fromKeypair(..., viewSecret)` so this is
    // unreachable — but the type allows null (a non-stealth wallet would return null),
    // so guard explicitly rather than `!`-asserting.
    throw new Error("recipient wallet has no view-only secret — newWallet() must include one");
  }
  const crypto = new WasmStealthCrypto(NETWORK);
  const decrypted = await decryptOwnedUtxo(crypto, viewSecret, found.substate, found.substateId);
  if (decrypted === null) {
    throw new Error("could not decrypt the stealth UTXO with the recipient's view secret (not ours?)");
  }
  console.log(`recipient decrypts: ${decrypted.value} µTari (expected ${amount})`);
  if (decrypted.value !== amount) {
    throw new Error(`decrypted value mismatch: ${decrypted.value} != ${amount}`);
  }

  console.log("Done.");
  return { provider };
});
