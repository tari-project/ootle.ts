//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit coverage for the network -> indexer URL table. Every branch of the
// switch is exercised so a future "add MainNet default URL" change can update
// the test alongside the code in one PR.

import { describe, expect, it } from "vitest";
import { Network } from "../network";
import { defaultIndexerUrl } from "./network";

describe("defaultIndexerUrl", () => {
  it("returns the LocalNet indexer URL", () => {
    expect(defaultIndexerUrl(Network.LocalNet)).toBe("http://localhost:12500");
  });

  it("returns the Esmeralda public indexer URL", () => {
    expect(defaultIndexerUrl(Network.Esmeralda)).toBe("https://ootle-indexer-a.tari.com");
  });

  it("throws for MainNet (no default URL configured)", () => {
    expect(() => defaultIndexerUrl(Network.MainNet)).toThrow(/No default indexer URL is configured for MainNet/);
  });

  it("throws for StageNet (no default URL configured)", () => {
    expect(() => defaultIndexerUrl(Network.StageNet)).toThrow(/No default indexer URL is configured for StageNet/);
  });

  it("throws for NextNet (no default URL configured)", () => {
    expect(() => defaultIndexerUrl(Network.NextNet)).toThrow(/No default indexer URL is configured for NextNet/);
  });

  it("throws for Igor (no default URL configured)", () => {
    expect(() => defaultIndexerUrl(Network.Igor)).toThrow(/No default indexer URL is configured for Igor/);
  });
});
