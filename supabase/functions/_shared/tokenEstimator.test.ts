import { describe, expect, it } from "vitest";
import { applyEstimateOptions, estimateTokens } from "./tokenEstimator";

describe("report token estimation", () => {
  it("applies workload modifiers to a catalogue base price", () => {
    expect(applyEstimateOptions(2, {
      aiNarrative: true,
      multiplier: 50,
    })).toBe(150);
  });

  it("uses the same modifiers for fallback kind pricing", () => {
    expect(estimateTokens("report.chart-analysis", {
      aiNarrative: true,
      multiplier: 50,
    })).toBe(150);
  });

  it("preserves a deliberately free catalogue price", () => {
    expect(applyEstimateOptions(0, {
      aiNarrative: true,
      extraSections: 10,
      multiplier: 50,
    })).toBe(0);
  });
});
