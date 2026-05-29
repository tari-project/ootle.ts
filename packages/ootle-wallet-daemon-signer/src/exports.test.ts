//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Sanity check that the package's own surface is reachable through the
// published `exports` map. The typed-error hierarchy lives in
// `@tari-project/ootle` and is no longer re-exported here — consumers
// catch typed errors by importing from the core package directly.

import { describe, expect, it } from "vitest";
import { WalletDaemonSigner, authenticate } from "./index";

describe("@tari-project/ootle-wallet-daemon-signer exports map resolution", () => {
  it("resolves the package's own surface", () => {
    expect(typeof WalletDaemonSigner).toBe("function");
    expect(typeof authenticate).toBe("function");
  });
});
