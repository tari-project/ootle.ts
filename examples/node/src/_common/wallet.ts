//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { OotleWallet, toHexStr } from "@tari-project/ootle";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { generateOotleAddress, generateOotleSecretKey, ootlePublicKeyFromSecretKey } from "@tari-project/ootle-wasm";
import { NETWORK } from "@tari-project/example-common";

/** A fresh `(secret, wallet)` pair, both stealth-ready (view key included). */
export interface NewWallet {
  /** The in-memory key holder — also the default `Signer` for `wallet`. */
  secret: SecretKeyWallet;
  /** A multi-signer wallet with `secret` registered as the default signer. */
  wallet: OotleWallet;
  /**
   * The bech32m **owner identity** (e.g. `otl_loc_…`). This is **not** a
   * component address — the on-chain account component (`component_…`) is
   * created by the faucet transaction.
   */
  ownerAddress: string;
}

/**
 * Generate a fresh stealth-ready wallet (view key included) for LocalNet.
 */
export async function newWallet(): Promise<NewWallet> {
  const sk = generateOotleSecretKey();
  const pk = ootlePublicKeyFromSecretKey(sk.owner_key, sk.view_key);
  const secret = SecretKeyWallet.fromKeypair(sk.owner_key, pk.owner_key, NETWORK, sk.view_key);
  const ownerAddress = generateOotleAddress(pk.owner_key, pk.view_key, NETWORK);
  const wallet = new OotleWallet().registerKeyProvider(ownerAddress, secret).setDefaultSigner(ownerAddress);
  return { secret, wallet, ownerAddress };
}

/** A fresh recipient identity — bech32m owner address + owner public key hex. */
export interface NewRecipient {
  /** The bech32m owner identity (e.g. `otl_loc_…`). */
  ownerAddress: string;
  /**
   * Hex-encoded owner public key. Needed to build a `CreateAccount`
   * instruction that lands funds into this recipient's brand-new on-chain
   * account inside the same transaction as a transfer.
   */
  ownerPublicKeyHex: string;
}

/**
 * A fresh recipient — a throwaway stealth-ready holder whose secret is
 * discarded after the owner address and public key are extracted. Useful
 * for "send to someone else" demos.
 */
export async function newRecipient(): Promise<NewRecipient> {
  const secret = SecretKeyWallet.randomWithViewKey(NETWORK);
  const ownerAddress = await secret.getAddress();
  const ownerPublicKeyHex = toHexStr(await secret.getPublicKey());
  return { ownerAddress, ownerPublicKeyHex };
}
