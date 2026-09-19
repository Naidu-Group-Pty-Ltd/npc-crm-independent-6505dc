/**
 * Stage progression must reflect what actually happened.
 *
 * ── What was on screen ────────────────────────────────────────────────
 * Stage 7 (Submission) carried a green tick while Stage 5 (Screening) was
 * still in progress and Stage 6 (Funding) had not started. The rail is
 * numbered, so that reads as "the case got this far". It had not.
 *
 * Two distinct causes, and they need opposite fixes.
 *
 *   1. `PAST_SUBMISSION` contained `closed`. A case can close from ANY
 *      stage, so closing at Stage 5 marked Stage 7 complete. That is simply
 *      false and is removed: closure is an ending, not a progression.
 *
 *   2. AML evidence genuinely arrives out of order — a client can submit
 *      their questionnaire before screening has run. Denying that would be
 *      false too. So the evidence is kept and the SEQUENCE is qualified.
 */
import { describe, expect, it } from "vitest";

import { deriveAmlJourney } from "./journeyModel";
import type { AmlWorkspaceFacts } from "./workspaceViewModel";

const caseRow = (over: Record<string, unknown> = {}) => ({
  id: "c1", case_reference: "AML-2026-00005", subject_display_name: "Rugesh Naidu",
  subject_type: "individual", status: "kyc_complete", risk_rating: null,
  case_stage: "client_submitted", client_portal_status: "submitted",
  service_gate_status: "cdd_incomplete", ...over,
}) as unknown as AmlWorkspaceFacts["caseRow"];

const facts = (over: Partial<AmlWorkspaceFacts> = {}): AmlWorkspaceFacts => ({
  caseRow: caseRow(),
  identity: { checks: [] },
  screening: { subjects: [] },
  monitoring: { open_edd: [], open_alerts: [] },
  documents: { requirements: [] },
  funding: { sources: [] },
  openClientRequests: 0,
  ...over,
} as unknown as AmlWorkspaceFacts);

const stage = (f: AmlWorkspaceFacts, id: string) =>
  deriveAmlJourney(f).stages.find((s) => s.id === id)!;

/* ═════════ 1 · Closure is an ending, not a progression ═════════ */

describe("closing a case does not complete the stages it never reached", () => {
  it("does not mark Submission complete on a closed case", () => {
    // The reported defect, exactly: the case was closed from Stage 5 and
    // Stage 7 rendered a green tick.
    const s = stage(facts({ caseRow: caseRow({ case_stage: "closed", status: "closed" }) }),
      "submission");
    expect(s.status).not.toBe("complete");
  });

  it("says the case ended rather than inventing a completion", () => {
    const s = stage(facts({ caseRow: caseRow({ case_stage: "closed", status: "closed" }) }),
      "submission");
    expect(s.summary).toMatch(/closed without this checkpoint/i);
    // And it does not claim the submission was taken into review.
    expect(s.summary).not.toMatch(/taken in/i);
  });

  it("still marks Submission complete when the case genuinely moved past it", () => {
    for (const case_stage of [
      "staff_review", "checks_in_progress", "enhanced_cdd",
      "decision_pending", "cleared", "blocked",
    ]) {
      expect(stage(facts({ caseRow: caseRow({ case_stage }) }), "submission").status,
        case_stage).toBe("complete");
    }
  });

  it("does not treat a closed case as past submission for the count either", () => {
    const closed = deriveAmlJourney(
      facts({ caseRow: caseRow({ case_stage: "closed", status: "closed" }) }));
    const past = deriveAmlJourney(facts({ caseRow: caseRow({ case_stage: "staff_review" }) }));
    expect(closed.completeCount).toBeLessThan(past.completeCount);
  });
});

/* ═════════ 2 · The sequence is qualified, the evidence is kept ═════════ */

describe("a stage cannot imply progression it does not have", () => {
  it("flags a complete stage that sits above an outstanding earlier one", () => {
    const j = deriveAmlJourney(facts({ caseRow: caseRow({ case_stage: "staff_review" }) }));
    const submission = j.stages.find((s) => s.id === "submission")!;
    const earlierOutstanding = j.stages
      .slice(0, j.stages.indexOf(submission))
      .some((s) => s.applicable && s.status !== "complete");

    // Whatever the fixture produces, the invariant holds both ways.
    expect(submission.aheadOfSequence).toBe(
      submission.status === "complete" && earlierOutstanding);
  });

  it("keeps the status complete — the evidence is real", () => {
    // Downgrading the STATUS would break every count, gate and readiness
    // figure derived from it. Only the sequence is qualified.
    const j = deriveAmlJourney(facts({ caseRow: caseRow({ case_stage: "staff_review" }) }));
    for (const s of j.stages) {
      if (s.aheadOfSequence) expect(s.status).toBe("complete");
    }
  });

  it("never flags a stage with nothing before it", () => {
    const j = deriveAmlJourney(facts({ caseRow: caseRow({ case_stage: "cleared" }) }));
    expect(j.stages[0].aheadOfSequence).toBe(false);
  });

  it("never flags a stage that is not complete", () => {
    const j = deriveAmlJourney(facts());
    for (const s of j.stages) {
      if (s.status !== "complete") expect(s.aheadOfSequence, s.id).toBe(false);
    }
  });

  it("ignores stages that do not apply to this case", () => {
    // A not-applicable stage is not "outstanding" and must not make every
    // later stage look out of sequence.
    const j = deriveAmlJourney(facts({ caseRow: caseRow({ case_stage: "cleared" }) }));
    for (const s of j.stages) {
      if (!s.applicable) expect(s.aheadOfSequence).toBe(false);
    }
  });

  it("holds the invariant across every case stage", () => {
    for (const case_stage of [
      "activated", "client_in_progress", "client_submitted", "staff_review",
      "checks_in_progress", "enhanced_cdd", "decision_pending", "cleared",
      "blocked", "closed",
    ]) {
      const j = deriveAmlJourney(facts({ caseRow: caseRow({ case_stage }) }));
      j.stages.forEach((s, i) => {
        const earlierOutstanding = j.stages
          .slice(0, i)
          .some((e) => e.applicable && e.status !== "complete");
        const expected = s.applicable && s.status === "complete" && earlierOutstanding;
        expect(s.aheadOfSequence, `${case_stage}/${s.id}`).toBe(expected);
      });
    }
  });

  it("gives every stage the flag, so the rail never reads undefined", () => {
    for (const s of deriveAmlJourney(facts()).stages) {
      expect(typeof s.aheadOfSequence).toBe("boolean");
    }
  });
});
