import { describe, expect, it } from "vitest";

import {
  decisionPath, decisionPathComplete, gateChangeHint, reasonHint,
  type DecisionPathFacts,
} from "./decisionPath.pure";

/**
 * Stage 8's order and its disabled-button words. Pinned here: one step is
 * open at a time per operator; a recommendation is optional and settles
 * rather than ticks; the gate step is done only when a gate decision was
 * recorded SINCE the case decision; and every disabled control's reason is
 * derivable in words.
 */

const facts = (over: Partial<DecisionPathFacts> = {}): DecisionPathFacts => ({
  assessment: { created_at: "2026-08-27T02:00:00Z", risk_rating: "low" },
  recalcStale: false,
  recalcReasons: [],
  openConditions: 0,
  pendingRecommendation: false,
  decision: null,
  gate: { status: "terminated", effective_at: "2026-08-20T00:00:00Z" },
  canWrite: true,
  canReview: true,
  isMlro: true,
  ...over,
});

const byKey = (steps: ReturnType<typeof decisionPath>, key: string) =>
  steps.find((s) => s.key === key)!;

describe("the order of the decision", () => {
  it("no assessment → computing it is the current step and everything else waits", () => {
    const steps = decisionPath(facts({ assessment: null }));
    expect(byKey(steps, "assessment").state).toBe("current");
    expect(byKey(steps, "decision").state).toBe("outstanding");
    expect(byKey(steps, "gate").state).toBe("outstanding");
  });

  it("a stale assessment is not a done step, and names what changed", () => {
    const steps = decisionPath(facts({ recalcStale: true, recalcReasons: ["screening_adjudicated"] }));
    const a = byKey(steps, "assessment");
    expect(a.state).toBe("current");
    expect(a.detail).toContain("screening adjudicated");
  });

  it("for a reviewer, the decision is the current step once the assessment stands", () => {
    const steps = decisionPath(facts());
    expect(byKey(steps, "assessment").state).toBe("done");
    expect(byKey(steps, "decision").state).toBe("current");
    expect(byKey(steps, "gate").state).toBe("outstanding");
    // A decision-maker owes no recommendation to themselves: with nothing
    // waiting, the step settles rather than nagging as "later".
    const r = byKey(steps, "recommendation");
    expect(r.state).toBe("settled");
    expect(r.detail).toMatch(/you may decide directly/);
  });

  it("a pending recommendation still ticks the step for a decision-maker", () => {
    const steps = decisionPath(facts({ pendingRecommendation: true }));
    expect(byKey(steps, "recommendation").state).toBe("done");
  });

  it("for an analyst, the recommendation is current and the decision is blocked with its blocker named", () => {
    const steps = decisionPath(facts({ canReview: false, isMlro: false }));
    expect(byKey(steps, "recommendation").state).toBe("current");
    const d = byKey(steps, "decision");
    expect(d.state).toBe("blocked");
    expect(d.blockedBy).toBe("Requires a reviewer or the MLRO");
  });

  it("an escalated decision is a handover, never done: the step stays open for the MLRO", () => {
    const escalated = { outcome: "escalated", decided_at: "2026-08-27T03:00:00Z" };
    const mlro = decisionPath(facts({ decision: escalated }));
    const d = byKey(mlro, "decision");
    expect(d.state).toBe("current");
    expect(d.detail).toMatch(/the MLRO's to record/);
    // Everyone else sees it blocked, with the blocker named.
    const reviewer = decisionPath(facts({ decision: escalated, isMlro: false }));
    expect(byKey(reviewer, "decision").state).toBe("blocked");
    expect(byKey(reviewer, "decision").blockedBy).toBe("Waiting on the MLRO");
    // And the gate stays outstanding — an escalation grants nothing.
    expect(byKey(mlro, "gate").state).toBe("outstanding");
  });

  it("a cleared decision makes the gate step DIRECT, not describe", () => {
    const steps = decisionPath(facts({
      decision: { outcome: "cleared", decided_at: "2026-08-27T03:00:00Z" },
      gate: { status: "under_review", effective_at: "2026-08-20T00:00:00Z" },
    }));
    const g = byKey(steps, "gate");
    expect(g.state).toBe("current");
    expect(g.detail).toMatch(/set the gate to Approved to grant the service/);
    expect(g.detail).toMatch(/Currently under review/);
  });

  it("a decision without a recommendation SETTLES the recommendation — never ticks it", () => {
    const steps = decisionPath(facts({
      decision: { outcome: "cleared", decided_at: "2026-08-27T03:00:00Z" },
    }));
    const r = byKey(steps, "recommendation");
    expect(r.state).toBe("settled");
    expect(r.detail).toMatch(/optional/i);
  });

  it("the gate is done only when a gate decision was recorded since the case decision", () => {
    const decided = { outcome: "cleared", decided_at: "2026-08-27T03:00:00Z" };
    const before = decisionPath(facts({
      decision: decided,
      gate: { status: "terminated", effective_at: "2026-08-20T00:00:00Z" },
    }));
    expect(byKey(before, "gate").state).toBe("current");
    const after = decisionPath(facts({
      decision: decided,
      gate: { status: "approved", effective_at: "2026-08-27T04:00:00Z" },
    }));
    expect(byKey(after, "gate").state).toBe("done");
    expect(decisionPathComplete(after)).toBe(true);
  });
});

describe("why a button is disabled, in words", () => {
  it("counts down to the ten characters and disappears at the floor", () => {
    expect(reasonHint("short")).toContain("5 more to go");
    expect(reasonHint("exactly ten")).toBeNull();
    expect(reasonHint("   padded    ", "rationale")).toContain("rationale");
  });
});

describe("the gate preconditions, read before the 409", () => {
  it("approving needs a cleared decision", () => {
    expect(gateChangeHint("approved", { decisionOutcome: null, openConditions: 0, isMlro: true }))
      .toMatch(/cleared decision/);
    expect(gateChangeHint("approved", { decisionOutcome: "blocked", openConditions: 0, isMlro: true }))
      .toMatch(/cleared decision/);
  });

  it("plain approval refuses open conditions; approval with controls requires one", () => {
    expect(gateChangeHint("approved", { decisionOutcome: "cleared", openConditions: 2, isMlro: true }))
      .toMatch(/Approved with controls/);
    expect(gateChangeHint("approved_with_controls", { decisionOutcome: "cleared", openConditions: 0, isMlro: true }))
      .toMatch(/at least one open condition/);
  });

  it("locking or terminating names the MLRO for anyone else", () => {
    expect(gateChangeHint("terminated", { decisionOutcome: "cleared", openConditions: 0, isMlro: false }))
      .toMatch(/MLRO/);
    expect(gateChangeHint("terminated", { decisionOutcome: "cleared", openConditions: 0, isMlro: true }))
      .toBeNull();
  });

  it("says nothing when nothing pre-derivable stands in the way", () => {
    expect(gateChangeHint("under_review", { decisionOutcome: null, openConditions: 0, isMlro: false }))
      .toBeNull();
    expect(gateChangeHint("approved", { decisionOutcome: "cleared", openConditions: 0, isMlro: false }))
      .toBeNull();
  });

  it("mirrors the server's own checks — pinned at the source", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/aml-risk/index.ts", "utf8");
    // The hints disclose; set_service_gate still enforces. If a server rule
    // moves or a new one arrives, this pin fails and the mirror is revisited.
    expect(src).toContain('latestDec.outcome !== "cleared"');
    expect(src).toContain('status === "approved" && (openConds ?? []).length > 0');
    expect(src).toContain('status === "approved_with_controls" && (openConds ?? []).length === 0');
    expect(src).toContain('(status === "locked" || status === "terminated") && !access.isMlro');
    expect(src).toContain("reason.length < 10");
  });
});
