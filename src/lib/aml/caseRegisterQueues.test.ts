/**
 * Queue counts — what a number on a queue is allowed to claim.
 *
 * The register offered eleven filter chips, seven of which duplicated the
 * Status and Risk dropdowns beside them, and not one of which said how much
 * was in it. These pin the rules for the four that survived as QUEUES.
 */
import { describe, it, expect } from "vitest";
import {
  REGISTER_QUEUES, countRegisterQueues, queueCountLabel,
} from "./caseRegisterQueues.pure";

const rows = [
  { status: "kyc_in_progress", assigned_analyst_id: "me" },
  { status: "escalated_mlro", assigned_analyst_id: "someone" },
  { status: "escalated_mlro", assigned_mlro_id: "me" },
  { status: "cleared", assigned_analyst_id: "someone" },
];

const count = (over: Partial<Parameters<typeof countRegisterQueues>[0]> = {}) =>
  countRegisterQueues({
    rows, total: rows.length, needsAttention: (r) => r.status === "kyc_in_progress",
    userId: "me", ready: true, ...over,
  });

describe("what the queues count", () => {
  it("counts the work, not the attributes", () => {
    /* A queue asks about the WORK — is anything mine, stuck, ready to
       decide. A status or a risk rating is an attribute and belongs behind
       the Filters control, not on a chip beside the dropdown that already
       offers it. */
    expect(REGISTER_QUEUES.map((q) => q.key))
      .toEqual(["all", "my_queue", "needs_attention", "awaiting_decision"]);
    for (const q of REGISTER_QUEUES) expect(q.hint.length).toBeGreaterThan(10);
  });

  it("takes 'All open' from the SERVER's total, not the page", () => {
    // The one queue that is exact whether or not the page is truncated.
    expect(count({ total: 148 }).all).toEqual({ count: 148, partial: false });
  });

  it("counts mine, flagged and ready-to-decide", () => {
    const c = count();
    expect(c.my_queue.count).toBe(2);
    expect(c.needs_attention.count).toBe(1);
    expect(c.awaiting_decision.count).toBe(2);
  });

  it("marks a count taken from a truncated register as a floor", () => {
    /* A number presented as complete when it is not is worse than no
       number: it is the same claim, told wrongly. */
    const c = count({ total: 500 });
    expect(c.needs_attention.partial).toBe(true);
    expect(queueCountLabel(c.needs_attention)).toBe("1+");
    // "All open" is still exact — it came from the server.
    expect(c.all.partial).toBe(false);
    expect(queueCountLabel(c.all)).toBe("500");
  });

  it("shows NO number rather than a wrong one", () => {
    // Before the snapshot arrives, and when the signed-in user is unknown.
    for (const q of REGISTER_QUEUES) {
      expect(count({ ready: false })[q.key].count).toBeNull();
      expect(queueCountLabel(count({ ready: false })[q.key])).toBeNull();
    }
    expect(count({ userId: null }).my_queue.count).toBeNull();
  });
});
