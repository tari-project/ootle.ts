//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Sanity check that the package's own surface is reachable through the
// published `exports` map. The typed-error hierarchy lives in
// `@tari-project/ootle` and is no longer re-exported here — consumers
// catch typed errors by importing from the core package directly.

import { describe, expect, it } from "vitest";
import { SecretKeyWallet, EphemeralKeySigner } from "./index";

describe("@tari-project/ootle-secret-key-wallet exports map resolution", () => {
  it("resolves the package's own surface", () => {
    expect(typeof SecretKeyWallet).toBe("function");
    expect(typeof EphemeralKeySigner).toBe("function");
  });
});
