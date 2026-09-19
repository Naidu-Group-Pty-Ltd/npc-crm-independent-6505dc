import { describe, expect, it } from "vitest";
import {
  checkReuseDecision,
  computeRefreshDueAt,
  isPartyScreeningMissing,
  matchDedupKey,
  partyScreeningOutstanding,
  pepControlsRequired,
  pepDeterminationCurrent,
  pepDeterminationRequiredForRole,
  pepEvidenceSatisfied,
  projectPartyScreeningState,
  resumableFromDurableState,
  screeningClaimDecision,
} from "../../../supabase/functions/_shared/aml/partyScreening.pure.ts";

/**
 * The projection and gate rules for party screening (Defects C/D/F) and the
 * AUSTRAC PEP control selection (Defect E). These pure functions are the
 * single definition shared by aml-cases, aml-risk, aml-monitoring and the
 * outbox worker's screening consumer.
 */

describe("projectPartyScreeningState — party state derives from canonical matches", () => {
  it("no matches at all → completed", () => {
    expect(projectPartyScreeningState([])).toBe("completed");
  });
  it("any open or escalated match → possible_match", () => {
    expect(projectPartyScreeningState(["open"])).toBe("possible_match");
    expect(projectPartyScreeningState(["dismissed", "escalated"])).toBe("possible_match");
  });
  it("any confirmed match → confirmed_match, even with others open", () => {
    expect(projectPartyScreeningState(["confirmed"])).toBe("confirmed_match");
    expect(projectPartyScreeningState(["open", "confirmed", "dismissed"])).toBe("confirmed_match");
  });
  it("all candidates dismissed → false_positive", () => {
    expect(projectPartyScreeningState(["dismissed"])).toBe("false_positive");
    expect(projectPartyScreeningState(["dismissed", "dismissed"])).toBe("false_positive");
  });
});

describe("required screening blocks clearance in every non-final state (Defect F)", () => {
  const now = "2026-08-07T00:00:00.000Z";
  const subject = (state: string, refresh_due_at: string | null = null) =>
    ({ required: true, state, refresh_due_at });

  it.each(["not_started", "queued", "processing", "error"])("%s is incomplete", (state) => {
    expect(partyScreeningOutstanding(subject(state), now)).toBe("incomplete");
    expect(isPartyScreeningMissing(subject(state), now)).toBe(true);
  });

  it("a technical error stays outstanding and retryable — never clear", () => {
    expect(partyScreeningOutstanding(subject("error"), now)).toBe("incomplete");
  });

  it("possible_match awaits adjudication", () => {
    expect(partyScreeningOutstanding(subject("possible_match"), now)).toBe("unresolved");
    expect(isPartyScreeningMissing(subject("possible_match"), now)).toBe(true);
  });

  it("confirmed_match is a finding, not missing work — the mandatory-hold path owns it", () => {
    expect(partyScreeningOutstanding(subject("confirmed_match"), now)).toBe("confirmed_match");
    expect(isPartyScreeningMissing(subject("confirmed_match"), now)).toBe(false);
  });

  it("satisfied screening past its refresh date is outstanding again", () => {
    expect(partyScreeningOutstanding(subject("completed", "2026-01-01T00:00:00.000Z"), now)).toBe("stale");
    expect(partyScreeningOutstanding(subject("false_positive", "2026-01-01T00:00:00.000Z"), now)).toBe("stale");
    expect(isPartyScreeningMissing(subject("completed", "2026-01-01T00:00:00.000Z"), now)).toBe(true);
  });

  it("current satisfied screening is not outstanding", () => {
    expect(partyScreeningOutstanding(subject("completed", "2027-01-01T00:00:00.000Z"), now)).toBeNull();
    expect(partyScreeningOutstanding(subject("false_positive"), now)).toBeNull();
  });

  it("non-required subjects never block", () => {
    expect(partyScreeningOutstanding({ required: false, state: "error" }, now)).toBeNull();
    expect(partyScreeningOutstanding({ required: true, state: "not_required" }, now)).toBeNull();
  });
});

describe("computeRefreshDueAt", () => {
  it("adds the rescreen interval to the screening time", () => {
    expect(computeRefreshDueAt("2026-01-01T00:00:00.000Z", 365))
      .toBe("2027-01-01T00:00:00.000Z");
  });
  it("falls back to an annual cycle on a nonsense interval", () => {
    expect(computeRefreshDueAt("2026-01-01T00:00:00.000Z", 0))
      .toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("pepControlsRequired — AUSTRAC PEP controls, not rejection (Defect E)", () => {
  const det = (pep_type: string, extra: Record<string, unknown> = {}) => ({
    result: "pep" as const, pep_type, pep_relationship: "self", ...extra,
  });

  it("a foreign PEP always requires EDD and senior manager approval", () => {
    for (const risk of ["low", "medium", "high", null]) {
      expect(pepControlsRequired(det("foreign"), risk)).toEqual({
        eddRequired: true, seniorManagerApprovalRequired: true,
      });
    }
  });

  it("domestic / international organisation PEPs require the controls only at high ML/TF risk", () => {
    expect(pepControlsRequired(det("domestic"), "low"))
      .toEqual({ eddRequired: false, seniorManagerApprovalRequired: false });
    expect(pepControlsRequired(det("domestic"), "high"))
      .toEqual({ eddRequired: true, seniorManagerApprovalRequired: true });
    expect(pepControlsRequired(det("international_organisation"), "prohibited"))
      .toEqual({ eddRequired: true, seniorManagerApprovalRequired: true });
  });

  it("family members and close associates carry the PEP's category", () => {
    expect(pepControlsRequired(
      { result: "pep", pep_type: "foreign", pep_relationship: "family_member" }, "low",
    )).toEqual({ eddRequired: true, seniorManagerApprovalRequired: true });
  });

  it("being a PEP is never an automatic rejection — not_pep and superseded determinations require nothing", () => {
    expect(pepControlsRequired({ result: "not_pep" }, "high"))
      .toEqual({ eddRequired: false, seniorManagerApprovalRequired: false });
    expect(pepControlsRequired(det("foreign", { superseded_at: "2026-01-01T00:00:00Z" }), "high"))
      .toEqual({ eddRequired: false, seniorManagerApprovalRequired: false });
    expect(pepControlsRequired(null, "high"))
      .toEqual({ eddRequired: false, seniorManagerApprovalRequired: false });
  });
});

describe("pepDeterminationCurrent — freshness for ongoing CDD", () => {
  const now = "2026-08-07T00:00:00.000Z";
  it("current when not superseded and not past review", () => {
    expect(pepDeterminationCurrent({ result: "not_pep", review_due_at: "2027-01-01T00:00:00Z" }, now)).toBe(true);
  });
  it("a lapsed review date makes it non-current — reconsidered, not assumed", () => {
    expect(pepDeterminationCurrent({ result: "not_pep", review_due_at: "2026-01-01T00:00:00Z" }, now)).toBe(false);
  });
  it("superseded determinations are never current", () => {
    expect(pepDeterminationCurrent({ result: "pep", superseded_at: "2026-06-01T00:00:00Z" }, now)).toBe(false);
    expect(pepDeterminationCurrent(null, now)).toBe(false);
  });
});

describe("pepEvidenceSatisfied — one evidence chain, linked to the current determination", () => {
  const determinedAt = "2026-06-01T00:00:00.000Z";
  const QUALIFYING_EDD = "edd-current";
  const OLD_EDD = "edd-old-unrelated";
  const base = {
    latestPepDeterminedAt: determinedAt,
    completedEddCases: [
      { id: QUALIFYING_EDD, completed_at: "2026-07-01T00:00:00.000Z" },
      { id: OLD_EDD, completed_at: "2026-01-01T00:00:00.000Z" },
    ],
    verifiedSofEddCaseIds: [QUALIFYING_EDD],
    verifiedSowEddCaseIds: [QUALIFYING_EDD],
    approvalResolvedAt: "2026-07-02T00:00:00.000Z",
  };

  it("A: qualifying EDD + verified SoF and SoW belonging to that EDD satisfies the requirement", () => {
    expect(pepEvidenceSatisfied(base)).toEqual({
      eddComplete: true, approvalGranted: true, qualifyingEddCaseId: QUALIFYING_EDD,
    });
  });

  it("B: SoF from an older/unrelated EDD does not satisfy the current PEP requirement", () => {
    expect(pepEvidenceSatisfied({ ...base, verifiedSofEddCaseIds: [OLD_EDD] }).eddComplete).toBe(false);
  });

  it("C: SoW from an older/unrelated EDD does not satisfy the current PEP requirement", () => {
    expect(pepEvidenceSatisfied({ ...base, verifiedSowEddCaseIds: [OLD_EDD] }).eddComplete).toBe(false);
  });

  it("D: SoF and SoW both verified but both belonging to another EDD — blocked", () => {
    expect(pepEvidenceSatisfied({
      ...base, verifiedSofEddCaseIds: [OLD_EDD], verifiedSowEddCaseIds: [OLD_EDD],
    }).eddComplete).toBe(false);
  });

  it("E: an EDD completed BEFORE the current determination never considered it — blocked", () => {
    expect(pepEvidenceSatisfied({
      ...base,
      completedEddCases: [{ id: QUALIFYING_EDD, completed_at: "2026-05-01T00:00:00.000Z" }],
    }).eddComplete).toBe(false);
  });

  it("F: an approval resolved before the current determination does not approve it", () => {
    expect(pepEvidenceSatisfied({ ...base, approvalResolvedAt: "2026-05-01T00:00:00.000Z" }).approvalGranted).toBe(false);
  });

  it("G: a superseding determination invalidates evidence that applied to the previous one", () => {
    const afterSupersession = pepEvidenceSatisfied({
      ...base,
      // The new determination moves the reference timestamp past all the
      // evidence gathered for the previous finding.
      latestPepDeterminedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(afterSupersession).toEqual({
      eddComplete: false, approvalGranted: false, qualifyingEddCaseId: null,
    });
  });

  it("H: missing verified SoF — blocked", () => {
    expect(pepEvidenceSatisfied({ ...base, verifiedSofEddCaseIds: [] }).eddComplete).toBe(false);
  });

  it("I: missing verified SoW — blocked", () => {
    expect(pepEvidenceSatisfied({ ...base, verifiedSowEddCaseIds: [] }).eddComplete).toBe(false);
  });

  it("SoF/SoW rows attached to no EDD at all establish nothing", () => {
    expect(pepEvidenceSatisfied({
      ...base, verifiedSofEddCaseIds: [null, undefined], verifiedSowEddCaseIds: [null],
    }).eddComplete).toBe(false);
  });

  it("missing evidence fails closed without becoming a customer finding", () => {
    expect(pepEvidenceSatisfied({
      ...base, completedEddCases: [], verifiedSofEddCaseIds: [], verifiedSowEddCaseIds: [],
      approvalResolvedAt: null,
    })).toEqual({ eddComplete: false, approvalGranted: false, qualifyingEddCaseId: null });
  });
});

describe("checkReuseDecision — one logical screening attempt, resumed not repeated", () => {
  const completedAt = "2026-08-07T10:00:00.000Z";

  it("a terminal check whose projection never landed is RESUMED — no provider re-run", () => {
    for (const status of ["clear", "review", "matched"]) {
      expect(checkReuseDecision(
        { status, completed_at: completedAt }, { last_screened_at: null },
      )).toBe("resume_completed");
      expect(checkReuseDecision(
        { status, completed_at: completedAt }, { last_screened_at: "2026-01-01T00:00:00.000Z" },
      )).toBe("resume_completed");
    }
  });

  it("a terminal check whose round already projected is a PREVIOUS round — re-queues get a fresh check", () => {
    expect(checkReuseDecision(
      { status: "review", completed_at: completedAt }, { last_screened_at: completedAt },
    )).toBe("new_check");
    expect(checkReuseDecision(
      { status: "clear", completed_at: completedAt }, { last_screened_at: "2026-08-08T00:00:00.000Z" },
    )).toBe("new_check");
  });

  it("an unfinished attempt re-runs the provider on the SAME check row", () => {
    for (const status of ["in_progress", "pending", "failed"]) {
      expect(checkReuseDecision(
        { status, completed_at: null }, { last_screened_at: null },
      )).toBe("rerun_provider");
    }
  });

  it("no check, no status, or a non-result status means a fresh check", () => {
    expect(checkReuseDecision(null, { last_screened_at: null })).toBe("new_check");
    expect(checkReuseDecision({ status: "cancelled" }, { last_screened_at: null })).toBe("new_check");
  });
});

describe("resumableFromDurableState — resume only when every candidate is on disk", () => {
  it("all recorded candidates persisted → resumable", () => {
    expect(resumableFromDurableState(0, 0)).toBe(true);
    expect(resumableFromDurableState(2, 2)).toBe(true);
  });
  it("fewer rows than the recorded match count → not resumable (re-run same attempt)", () => {
    expect(resumableFromDurableState(2, 1)).toBe(false);
    expect(resumableFromDurableState(1, 0)).toBe(false);
  });
});

describe("screeningClaimDecision — duplicate events succeed, in-flight events retry", () => {
  const now = Date.parse("2026-08-07T12:00:00.000Z");
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

  it.each(["queued", "error"])("%s is claimable", (state) => {
    expect(screeningClaimDecision({ state }, now, 10)).toBe("claim");
  });

  it.each(["completed", "possible_match", "confirmed_match", "false_positive", "not_required", "not_started"])(
    "%s is a duplicate/stale event — succeed silently", (state) => {
      expect(screeningClaimDecision({ state }, now, 10)).toBe("obsolete");
    });

  it("fresh 'processing' RETRIES the event — silent success would orphan a dead worker's subject", () => {
    expect(screeningClaimDecision({ state: "processing", updated_at: minutesAgo(2) }, now, 10))
      .toBe("in_flight_retry");
  });

  it("stale 'processing' is reclaimable after the staleness window", () => {
    expect(screeningClaimDecision({ state: "processing", updated_at: minutesAgo(11) }, now, 10))
      .toBe("claim");
  });
});

describe("matchDedupKey — redelivery cannot double-insert candidates", () => {
  it("keys on the list's external id when present", () => {
    expect(matchDedupKey({ details: { external_id: "DFAT-1" }, matchedName: "A", listName: "L" }))
      .toBe("ext:DFAT-1");
    // Provider-shape and row-shape carry the same key.
    expect(matchDedupKey({ details: { external_id: "DFAT-1" }, matched_name: "B", list_name: "M" }))
      .toBe("ext:DFAT-1");
  });

  it("falls back to name+list when the provider supplies no external id", () => {
    expect(matchDedupKey({ details: {}, matchedName: "Person X", listName: "PEP Register" }))
      .toBe("name:Person X|PEP Register");
    expect(matchDedupKey({ details: {}, matched_name: "Person X", list_name: "PEP Register" }))
      .toBe("name:Person X|PEP Register");
  });
});

describe("pepDeterminationRequiredForRole — mirrors the program's identification roles", () => {
  it.each(["co_purchaser", "director", "trustee", "beneficial_owner", "authorised_representative"])(
    "%s requires a determination", (role) => {
      expect(pepDeterminationRequiredForRole(role)).toBe(true);
    });
  it("roles outside the identification list do not", () => {
    expect(pepDeterminationRequiredForRole("private_lender")).toBe(false);
    expect(pepDeterminationRequiredForRole("donor")).toBe(false);
  });
});
