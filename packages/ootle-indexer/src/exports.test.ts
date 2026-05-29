//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Sanity check that the package's own surface is reachable through the
// published `exports` map. The typed-error hierarchy lives in
// `@tari-project/ootle` and is no longer re-exported here — consumers
// catch typed errors by importing from the core package directly.

import { describe, expect, it } from "vitest";
import { IndexerProvider } from "./index";

describe("@tari-project/ootle-indexer exports map resolution", () => {
  it("resolves the package's own surface", () => {
    expect(typeof IndexerProvider).toBe("function");
  });
});
