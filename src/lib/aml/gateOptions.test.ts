import { describe, expect, it } from "vitest";

import { DECISION_CHOICES, GATE_CHOICES, RECOMMENDATION_CHOICES, gateOptionGroups } from "./gateOptions.pure";

/**
 * The choices an operator reads, and which gate statuses the moment
 * suggests. Pinned: suggestions only follow the recorded decision, the
 * current status is never suggested, MLRO-only statuses never reach anyone
 * else, and nothing is ever REMOVED by suggestion — grouping is
 * arrangement, not a second gate policy.
 */

describe("which statuses the moment suggests", () => {
  it("a cleared decision suggests the two approvals — the road to Gate & Passport", () => {
    const groups = gateOptionGroups({ decisionOutcome: "cleared", currentGate: "under_review", isMlro: false });
    expect(groups.suggested.map((c) => c.value)).toEqual(["approved", "approved_with_controls"]);
    // Everything else stays choosable.
    expect(groups.suggested.length + groups.other.length).toBe(6);
  });

  it("never suggests the status the gate already holds", () => {
    const groups = gateOptionGroups({ decisionOutcome: "cleared", currentGate: "approved", isMlro: true });
    expect(groups.suggested.map((c) => c.value)).toEqual(["approved_with_controls"]);
  });

  it("a blocked decision suggests locking — for the MLRO who can", () => {
    expect(gateOptionGroups({ decisionOutcome: "blocked", currentGate: "under_review", isMlro: true })
      .suggested.map((c) => c.value)).toEqual(["locked"]);
    expect(gateOptionGroups({ decisionOutcome: "blocked", currentGate: "under_review", isMlro: false })
      .suggested).toEqual([]);
  });

  it("no decision suggests nothing — the change is context this rule must not guess", () => {
    const groups = gateOptionGroups({ decisionOutcome: null, currentGate: "under_review", isMlro: true });
    expect(groups.suggested).toEqual([]);
    expect(groups.other.length).toBe(GATE_CHOICES.length);
  });

  it("MLRO-only statuses never reach anyone else's list", () => {
    const groups = gateOptionGroups({ decisionOutcome: null, currentGate: null, isMlro: false });
    const values = [...groups.suggested, ...groups.other].map((c) => c.value);
    expect(values).not.toContain("locked");
    expect(values).not.toContain("terminated");
  });
});

describe("every choice says what it does", () => {
  it("each gate status carries a meaning, not just a spelling", () => {
    for (const c of GATE_CHOICES) {
      expect(c.meaning.length).toBeGreaterThan(20);
    }
    expect(GATE_CHOICES.find((c) => c.value === "approved")!.meaning).toMatch(/service-ready/);
  });

  it("the recommendation vocabulary is wider than the decision's — that is why they are two acts", () => {
    // Conditions and EDD are proposals an analyst can make that a decision
    // cannot spell; a recommendation is never a decision.
    const recValues = RECOMMENDATION_CHOICES.map((c) => c.value);
    const decisionValues = DECISION_CHOICES.map((c) => c.value as string);
    expect(recValues).toContain("cleared_with_conditions");
    expect(recValues).toContain("edd_required");
    expect(decisionValues).not.toContain("cleared_with_conditions");
    expect(decisionValues).not.toContain("edd_required");
    for (const c of RECOMMENDATION_CHOICES) {
      expect(c.meaning.toLowerCase()).toContain("recommend");
    }
  });

  it("the decision choices keep the vocabulary apart: clearing is not granting the service", () => {
    const cleared = DECISION_CHOICES.find((c) => c.value === "cleared")!;
    expect(cleared.meaning).toMatch(/still needs the gate approved/);
    const escalated = DECISION_CHOICES.find((c) => c.value === "escalated")!;
    expect(escalated.meaning).toMatch(/Money Laundering Reporting Officer/);
  });
});
