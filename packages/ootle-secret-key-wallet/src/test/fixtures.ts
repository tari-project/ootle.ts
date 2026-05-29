//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Test-only deterministic fixtures for `@tari-project/ootle-secret-key-wallet`
// unit tests. The existing stealth test derives its keys at runtime through
// `generateOotleSecretKey()` (so each run produces a fresh valid Ristretto
// keypair the WASM accepts); these fixtures are reserved for tests that want
// a fixed hex secret/view-key pair (e.g. for asserting deterministic
// signatures with a future stable input vector).
//
// This module is TEST-ONLY: it is deliberately NOT re-exported from the
// package root (`packages/ootle-secret-key-wallet/src/index.ts`), so it never
// reaches external consumers. Test files import these constants by relative
// subpath (`import { TEST_NETWORK } from "./test/fixtures"`).

import { Network } from "@tari-project/ootle";

/** The network byte every wallet test uses unless it explicitly varies it. */
export const TEST_NETWORK = Network.LocalNet;
