import { describe, expect, it } from "vitest";
import { deriveFundingObligation } from "@/lib/aml/fundingObligation.pure";
import { deriveAmlJourney } from "@/lib/aml/journeyModel";
import { deriveAmlNextAction, type AmlWorkspaceFacts } from "@/lib/aml/workspaceViewModel";

/**
 * Stage 5 → Stage 6 → Stage 7, and the stage that used to vanish between them.
 *
 * ── What was on the screen ────────────────────────────────────────────
 * Stage 5 completed and the case jumped to **Stage 7 · Submission review**,
 * under a line reading *"Stages 2–6 have nothing outstanding on this
 * reading."* Stage 6's own journey reading disagreed: `not_started`, owner
 * analyst, with the blocker *"Source of funds not recorded"*.
 *
 * Two derivations of one case, disagreeing, and the reassuring one on screen.
 *
 * ── Why ───────────────────────────────────────────────────────────────
 * The next-action ranking had exactly one funding candidate and it was gated
 * on `sources.length > 0 && unverified.length > 0` — it spoke only once
 * somebody had ALREADY started. A case with nothing recorded, which is every
 * case at the moment stage 5 finishes, produced no candidate at all. The
 * ranking orders by journey position, so with stage 6 silent the winner
 * became stage 7.
 *
 * Measured on `AML-2026-00005`: 0 `source_of_funds` rows, 0 transactions,
 * `case_stage = client_submitted`, next action pointing at stage 7.
 *
 * ── The rule ──────────────────────────────────────────────────────────
 * Whether stage 6 is owed is now DECIDED, never inferred from whether
 * anybody has got round to it — and when it is not owed, it is skipped with
 * a reason rather than silently.
 */

const caseRow = (over = {}) => ({
  id: "c1", status: "kyc_complete", case_stage: "client_submitted",
  client_portal_status: "submitted", service_gate_status: "pending",
  risk_rating: null, ...over,
});

const facts = (over: Partial<AmlWorkspaceFacts> = {}): AmlWorkspaceFacts => ({
  caseRow: caseRow(),
  identity: { checks: [] },
  screening: { subjects: [] },
  monitoring: { open_alerts: [], open_edd: [], overdue_review_count: 0 },
  documents: { requirements: [] },
  funding: { sources: [] },
  transactions: { transactions: [] },
  openClientRequests: 0,
  ...over,
} as unknown as AmlWorkspaceFacts);

const stage6 = (f: AmlWorkspaceFacts) =>
  deriveAmlJourney(f).stages.find((s) => s.id === "funding")!;

/* ── Required, and no longer silent ───────────────────────────────────── */

describe("a case with nothing recorded owes stage 6", () => {
  it("the next action is stage 6, not stage 7", () => {
    const a = deriveAmlNextAction(facts());
    expect(a.stageOrder).toBe(6);
    expect(a.key).toBe("funding_start");
  });

  it("the stage and the ranking now agree", () => {
    // The defect was two derivations of one case disagreeing. This is the
    // assertion that keeps them together.
    const f = facts();
    const stage = stage6(f);
    expect(stage.applicable).toBe(true);
    expect(stage.outstandingItems.length).toBeGreaterThan(0);
    expect(deriveAmlNextAction(f).stageOrder).toBe(stage.number);
  });

  it("says WHY it is owed, not merely that it is", () => {
    // A stage that appears without explanation is the other half of a stage
    // that disappears without one.
    expect(deriveAmlNextAction(facts()).explanation)
      .toMatch(/unclassified case counts as inside the perimeter/i);
  });

  it("carries the facts it was decided from", () => {
    const a = deriveAmlNextAction(facts());
    expect(a.sourceFacts.join(" ")).toMatch(/perimeter = unclassified/);
    expect(a.sourceFacts.join(" ")).toMatch(/source-of-funds items \(0\)/);
  });
});

/* ── Not required, and SAID ───────────────────────────────────────────── */

describe("an enquiry that never became a deal", () => {
  const outside = facts({
    perimeter: { classified: true, classification: "outside_perimeter",
      reason_code: "enquiry_only" },
  } as never);

  it("is skipped with a reason, not silently", () => {
    const stage = stage6(outside);
    expect(stage.applicable).toBe(false);
    expect(stage.notApplicableReason).toMatch(/outside the perimeter/i);
    expect(stage.notApplicableReason).toMatch(/enquiry only/i);
  });

  it("names what was NOT done, rather than implying it was", () => {
    // The rule this repository keeps re-learning: not required is not clear.
    const stage = stage6(outside);
    expect(stage.notApplicableReason).toMatch(/nobody was assessed/i);
    expect(stage.status).toBe("not_applicable");
  });

  it("does not hold the walk up", () => {
    expect(deriveAmlNextAction(outside).stageOrder).toBe(7);
  });

  it("is out of the journey's own count", () => {
    expect(deriveAmlJourney(outside).applicableCount)
      .toBeLessThan(deriveAmlJourney(facts()).applicableCount);
  });
});

/* ── The lever, and only the lever ────────────────────────────────────── */

describe("only the perimeter can stand it down", () => {
  it("an unclassified case is not an exempt one", () => {
    for (const perimeter of [
      null,
      { classified: false, classification: null, reason_code: null },
      // A classification nobody recorded is not a classification.
      { classified: false, classification: "outside_perimeter", reason_code: "enquiry_only" },
    ]) {
      expect(deriveFundingObligation({ perimeter }).reading).toBe("required");
    }
  });

  it("a risk rating cannot reach it, in either direction", () => {
    // The same rule sanctions has: risk is not a lever on an obligation that
    // arises from providing the service at all.
    for (const riskRating of ["low", "medium", null, "unrated"]) {
      expect(deriveFundingObligation({ riskRating }).reading).toBe("required");
    }
    expect(deriveFundingObligation({
      perimeter: { classified: true, classification: "outside_perimeter" },
      riskRating: "low",
    }).reading).toBe("not_required");
  });

  it("enhanced due diligence is checked first and cannot be reached", () => {
    /*
     * Ordered before the perimeter deliberately. A case that has reached EDD
     * is one this business is serving, and a mis-recorded classification must
     * not be able to stand down the strictest funding obligation there is.
     */
    for (const over of [
      { riskRating: "high" },
      { riskRating: "prohibited" },
      { enhancedDueDiligence: true },
      { pepFinding: true },
    ]) {
      const o = deriveFundingObligation({
        perimeter: { classified: true, classification: "outside_perimeter",
          reason_code: "enquiry_only" },
        ...over,
      });
      expect(o.reading).toBe("required");
      expect(o.nonWaivable).toBe(true);
      expect(o.reason).toMatch(/nothing stands this down/i);
    }
  });

  it("every reading explains itself", () => {
    for (const input of [
      {}, { riskRating: "high" }, { pepFinding: true },
      { perimeter: { classified: true, classification: "outside_perimeter" } },
      { perimeter: { classified: true, classification: "designated_service" } },
    ]) {
      const o = deriveFundingObligation(input);
      expect(o.reason.length).toBeGreaterThan(30);
      expect(o.sourceFacts.length).toBeGreaterThan(0);
    }
  });
});

/* ── The whole pathway ────────────────────────────────────────────────── */

describe("stage 5 → 6 → 7, walked", () => {
  const enrolled = {
    screened_name: "Pat Example", required: true, state: "completed",
    pep_determination: { result: "not_pep", review_due_at: "2027-01-01T00:00:00Z" },
  };

  it("stops at 5 while screening is outstanding", () => {
    expect(deriveAmlNextAction(facts({
      screening: { subjects: [{ ...enrolled, state: "not_started",
        pep_determination: null }] } as never,
    })).stageOrder).toBe(5);
  });

  it("moves to 6 once 5 is settled", () => {
    expect(deriveAmlNextAction(facts({
      screening: { subjects: [enrolled], pepRequired: true } as never,
    })).stageOrder).toBe(6);
  });

  it("moves to 7 once 6 is settled", () => {
    expect(deriveAmlNextAction(facts({
      screening: { subjects: [enrolled], pepRequired: true } as never,
      funding: { sources: [{ verified: true }] } as never,
    })).stageOrder).toBe(7);
  });

  it("a half-done stage 6 still holds at 6", () => {
    expect(deriveAmlNextAction(facts({
      screening: { subjects: [enrolled], pepRequired: true } as never,
      funding: { sources: [{ verified: true }, { verified: false }] } as never,
    })).key).toBe("funding_review");
  });

  it("an unreadable funding fact is never read as nothing owed", () => {
    /*
     * `unknown` is not `not_required`. A read that failed must not produce a
     * stage that quietly stands itself down — the cardinal rule everywhere
     * else in this codebase, and stage 6 is where it would be least visible.
     */
    const f = facts({ funding: null });
    const stage = stage6(f);
    expect(stage.applicable).toBe(true);
    expect(stage.status).toBe("unknown");
    expect(stage.unavailableFacts).toContain("source of funds");
  });
});
