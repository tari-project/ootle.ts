//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Identity construction — browser port of `newWallet()` from
 * `examples/node/src/_common.ts`.
 *
 * Generates a fresh (owner, view) keypair via the WASM crypto helpers and
 * constructs a `SecretKeyWallet` via `.fromKeypair(...)` so the view secret
 * is present for stealth scan/spend.
 */

import { OotleWallet } from "@tari-project/ootle";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { generateOotleAddress, generateOotleSecretKey, ootlePublicKeyFromSecretKey } from "@tari-project/ootle-wasm";
import { NETWORK } from "@tari-project/example-common";
import type { StealthIdentity } from "./stealth";

/** Create a fresh in-memory stealth-ready identity. */
export function createIdentity(): StealthIdentity {
  const sk = generateOotleSecretKey();
  const pk = ootlePublicKeyFromSecretKey(sk.owner_key, sk.view_key);
  const secret = SecretKeyWallet.fromKeypair(sk.owner_key, pk.owner_key, NETWORK, sk.view_key);
  const ownerAddress = generateOotleAddress(pk.owner_key, pk.view_key, NETWORK);
  const wallet = new OotleWallet().registerKeyProvider(ownerAddress, secret).setDefaultSigner(ownerAddress);
  return {
    secret,
    wallet,
    ownerAddress,
    viewSecret: sk.view_key,
  };
}
