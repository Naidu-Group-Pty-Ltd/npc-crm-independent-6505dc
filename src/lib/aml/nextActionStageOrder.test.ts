/**
 * The next action must not skip stages.
 *
 * ── What the MLRO saw ─────────────────────────────────────────────────
 * Standing on Stage 1 of AML-2026-00005, the workspace showed one blocking
 * action — "Review the client submission" — with a button that jumped
 * straight to **Stage 7**, while Stages 3, 5 and 6 still had outstanding
 * work. Nothing on the screen said it was skipping anything.
 *
 * Two independent causes, both fixed here:
 *
 *   1. The winner was `candidates[0]` — the first rule that happened to
 *      fire, in the order the rules were WRITTEN. `submission_review` is
 *      authored above documents and funding, so it beat them regardless of
 *      where they sat in the journey.
 *
 *   2. Every screening action routed to `section: "identity"` — Stage 3 —
 *      when screening is Stage 5 (`ownership`). An MLRO told to "Start
 *      screening" was sent to Identity verification.
 *
 * The first describe block is the invariant: ordering is by journey
 * position, and the local map may never drift from `JOURNEY_STAGES`.
 */
import { describe, expect, it } from "vitest";

import {
  SECTION_JOURNEY_ORDER,
  WORKSPACE_SECTIONS,
  deriveAmlNextAction,
  type AmlWorkspaceFacts,
} from "./workspaceViewModel";
import { JOURNEY_STAGES, stageForSection } from "./journeyModel";

/* ── The drift guard ───────────────────────────────────────────────── */

describe("the local order may never drift from the journey", () => {
  it("agrees with JOURNEY_STAGES for every section", () => {
    // `journeyModel` imports this module, so the order is duplicated rather
    // than imported. That duplication is only safe because of this test —
    // a stage reorder that desynchronised the two has bitten here before.
    for (const section of WORKSPACE_SECTIONS) {
      const stage = stageForSection(section);
      if (!stage) continue;
      expect(SECTION_JOURNEY_ORDER[section], section)
        .toBe(JOURNEY_STAGES.indexOf(stage) + 1);
    }
  });

  it("covers every section, so nothing sorts to the end by accident", () => {
    for (const section of WORKSPACE_SECTIONS) {
      expect(SECTION_JOURNEY_ORDER[section], section).toBeGreaterThan(0);
      expect(SECTION_JOURNEY_ORDER[section], section).toBeLessThanOrEqual(JOURNEY_STAGES.length);
    }
  });

  it("puts screening at stage 5, where the journey puts it", () => {
    expect(SECTION_JOURNEY_ORDER.ownership).toBe(5);
    expect(SECTION_JOURNEY_ORDER["submission-review"]).toBe(7);
    expect(SECTION_JOURNEY_ORDER.identity).toBe(3);
  });
});

/* ── Facts builders ────────────────────────────────────────────────── */

const caseRow = (over: Record<string, unknown> = {}) => ({
  id: "c1", case_reference: "AML-2026-00005", subject_display_name: "Rugesh Naidu",
  subject_type: "individual", status: "kyc_complete", risk_rating: null,
  case_stage: "client_submitted", client_portal_status: "submitted",
  service_gate_status: "cdd_incomplete", ...over,
}) as unknown as AmlWorkspaceFacts["caseRow"];

const subject = (over: Record<string, unknown> = {}) => ({
  id: "s1", party_type: "primary_subject", screened_name: "Rugesh Naidu",
  required: true, state: "not_started", matches: [], ...over,
});

/** Everything loaded and quiet, so a single rule can be isolated. */
const facts = (over: Partial<AmlWorkspaceFacts> = {}): AmlWorkspaceFacts => ({
  caseRow: caseRow(),
  identity: { checks: [] },
  screening: { subjects: [] },
  monitoring: { open_edd: [], reviews_overdue: [], rescreen_due: [], alerts_open: [] },
  documents: { requirements: [] },
  funding: { sources: [] },
  openClientRequests: 0,
  ...over,
} as unknown as AmlWorkspaceFacts);

/* ── The reported defect ───────────────────────────────────────────── */

describe("the journey is walked in order", () => {
  it("sends the MLRO to screening, not past it to submission review", () => {
    // The production case, exactly: client_submitted, with a subject enrolled
    // and unscreened. This produced "Review the client submission" → Stage 7.
    const a = deriveAmlNextAction(facts({
      screening: { subjects: [subject()] } as never,
    }));
    expect(a.key).toBe("screening_start");
    expect(a.section).toBe("ownership");
    expect(a.stageOrder).toBe(5);
  });

  it("does not fall through to stage 7 while screening is running", () => {
    // The gap that let it happen: a queued subject produced NO candidate, so
    // the ranking fell through to whatever fired next.
    const a = deriveAmlNextAction(facts({
      screening: { subjects: [subject({ state: "queued" })] } as never,
    }));
    expect(a.key).toBe("screening_in_flight");
    expect(a.stageOrder).toBe(5);
  });

  it("prefers an earlier stage's work over a later stage's", () => {
    // Documents (4) must beat submission review (7), which authorship order
    // had backwards.
    const a = deriveAmlNextAction(facts({
      documents: { requirements: [{ status: "uploaded" }] } as never,
    }));
    expect(a.key).toBe("documents_review");
    expect(a.stageOrder).toBe(4);
  });

  it("prefers funding over submission review", () => {
    const a = deriveAmlNextAction(facts({
      funding: { sources: [{ verified: false }] } as never,
    }));
    expect(a.stageOrder).toBe(6);
    expect(a.section).toBe("finance");
  });

  it("does not fall through to stage 7 while stage 6 has nothing recorded", () => {
    /*
     * The reported defect, and the sibling of the one at the top of this
     * file. There was ONE funding candidate and it was gated on
     * `sources.length > 0 && unverified.length > 0` — it spoke only once
     * somebody had already started. A case with nothing recorded, which is
     * every case at the moment stage 5 finishes, produced no candidate, so
     * the ranking walked past stage 6 to submission review.
     */
    const a = deriveAmlNextAction(facts());
    expect(a.key).toBe("funding_start");
    expect(a.stageOrder).toBe(6);
    expect(a.section).toBe("finance");
  });

  it("reaches submission review only once the earlier stages are quiet", () => {
    // Including stage 6. "Quiet" has to mean settled, not merely silent.
    const a = deriveAmlNextAction(facts({
      funding: { sources: [{ verified: true }] } as never,
    }));
    expect(a.key).toBe("submission_review");
    expect(a.stageOrder).toBe(7);
  });

  it("a stage nobody owes does not hold the walk up", () => {
    // An enquiry that never became a deal owes no funding evidence, so the
    // walk reaches stage 7 with nothing recorded — because it is not owed,
    // not because nobody asked.
    const a = deriveAmlNextAction(facts({
      perimeter: { classified: true, classification: "outside_perimeter",
        reason_code: "enquiry_only" },
    } as never));
    expect(a.key).toBe("submission_review");
    expect(a.stageOrder).toBe(7);
  });

  it("never returns an action without a stage", () => {
    const readings = [
      facts(),
      facts({ screening: { subjects: [subject()] } as never }),
      facts({ documents: { requirements: [{ status: "uploaded" }] } as never }),
      facts({ caseRow: caseRow({ status: "closed", case_stage: "closed" }) }),
      { caseRow: caseRow() } as unknown as AmlWorkspaceFacts,
    ];
    for (const f of readings) {
      const a = deriveAmlNextAction(f);
      expect(a.stageOrder).toBeGreaterThan(0);
      expect(a.stageSection).toBeTruthy();
      expect(SECTION_JOURNEY_ORDER[a.section]).toBe(a.stageOrder);
    }
  });
});

/* ── What must still jump the queue ────────────────────────────────── */

describe("a finding is not queued behind the journey", () => {
  it("puts a confirmed screening match first, whatever else is outstanding", () => {
    // Ordering by stage must not bury the one outcome that stops a case.
    const a = deriveAmlNextAction(facts({
      screening: { subjects: [subject({ state: "confirmed_match" })] } as never,
      documents: { requirements: [{ status: "uploaded" }] } as never,
    }));
    expect(a.key).toBe("screening_confirmed");
    expect(a.attention).toBe("critical");
  });

  it("puts a prohibited rating first", () => {
    const a = deriveAmlNextAction(facts({
      caseRow: caseRow({ risk_rating: "prohibited" }),
      documents: { requirements: [{ status: "uploaded" }] } as never,
    }));
    expect(a.key).toBe("prohibited_risk");
  });

  it("puts an MLRO decision first", () => {
    const a = deriveAmlNextAction(facts({
      caseRow: caseRow({ case_stage: "decision_pending" }),
      documents: { requirements: [{ status: "uploaded" }] } as never,
    }));
    expect(a.key).toBe("mlro_decision");
  });

  it("still ranks a possible match by its own stage, not ahead of everything", () => {
    // Adjudication is real work but it is not a finding, so an earlier
    // stage's blocker still comes first.
    const a = deriveAmlNextAction(facts({
      screening: { subjects: [subject({ state: "possible_match" })] } as never,
      documents: { requirements: [{ status: "uploaded" }] } as never,
    }));
    expect(a.stageOrder).toBe(4);
    expect(a.key).toBe("documents_review");
  });
});

describe("within one stage, blocking work comes first", () => {
  it("prefers the referred check over the retryable one", () => {
    const a = deriveAmlNextAction(facts({
      identity: {
        checks: [
          { status: "passed", processing_status: "provider_error", superseded_at: null },
          { status: "referred", processing_status: null, superseded_at: null },
        ],
      } as never,
    }));
    expect(a.key).toBe("identity_referred");
    expect(a.blocking).toBe(true);
  });
});
