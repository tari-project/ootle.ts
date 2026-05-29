//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Verifies that @tari-project/ootle-wasm initializes under plain Node ESM
// via tsx (no Vite, no bundler). This is the dual-environment linchpin —
// every Node script in this workspace depends on this import resolving and
// producing a working keypair without manual init.
//
// Intentionally NO try/catch around the WASM calls: a clean stack trace is
// the diagnostic, and the script's exit code is the CI signal.

import { generateKeypair, publicKeyFromSecretKey } from "@tari-project/ootle-wasm";

const kp = generateKeypair();
const derived = publicKeyFromSecretKey(kp.secret_key);

if (derived.length !== 32) {
  throw new Error(`expected 32-byte pubkey, got ${derived.length}`);
}
if (Buffer.compare(Buffer.from(kp.public_key), Buffer.from(derived)) !== 0) {
  throw new Error("derived pubkey did not match generated keypair");
}

const prefix = Buffer.from(kp.public_key).toString("hex").slice(0, 16);
console.log(`WASM ok: pubkey ${prefix}…`);
