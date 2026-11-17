//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { describe, expect, it } from "vitest";
import type { FeeReceipt } from "@tari-project/ootle-ts-bindings";
import { FEE_ESTIMATE_ALLOWANCE, estimatedFee, feesCharged } from "./fees";

function receipt(breakdown: Record<string, number | bigint>): Pick<FeeReceipt, "cost_breakdown"> {
  return { cost_breakdown: { breakdown } } as unknown as Pick<FeeReceipt, "cost_breakdown">;
}

describe("feesCharged", () => {
  it("sums the cost breakdown", () => {
    expect(feesCharged(receipt({ RuntimeCall: 14n, Storage: 90n, TemplateLoad: 450n }))).toBe(554n);
  });

  it("accepts the numbers a JSON-decoded receipt carries", () => {
    expect(feesCharged(receipt({ RuntimeCall: 14, Storage: 90 }))).toBe(104n);
  });

  it("is zero for an empty breakdown", () => {
    expect(feesCharged(receipt({}))).toBe(0n);
  });
});

describe("estimatedFee", () => {
  it("adds the allowance to the charge", () => {
    expect(estimatedFee(receipt({ RuntimeCall: 14n, Storage: 90n, TemplateLoad: 450n }))).toBe(
      554n + FEE_ESTIMATE_ALLOWANCE,
    );
  });

  it("matches the engine's allowance", () => {
    expect(FEE_ESTIMATE_ALLOWANCE).toBe(12n);
  });
});
