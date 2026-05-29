//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { WasmStealthCrypto } from "@tari-project/ootle";
import { NETWORK } from "@tari-project/example-common";

let instance: WasmStealthCrypto | null = null;

// Lazy singleton — there is no reason to construct more than one `WasmStealthCrypto`
// per session. Module scope is per-page in Vite/React, so this is safe under
// strict-mode double-mount.
export function stealthCrypto(): WasmStealthCrypto {
  if (instance === null) instance = new WasmStealthCrypto(NETWORK);
  return instance;
}
