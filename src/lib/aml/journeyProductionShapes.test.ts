/**
 * The journey, read against the shapes production actually holds.
 *
 * ── Why this file exists separately from `journeyModel.test.ts` ────────
 * That suite is written in the model's own vocabulary: it builds the facts
 * a derivation needs and checks the derivation. It passes on fixtures that
 * are, by construction, well formed. This one is written the other way
 * round — every case below is transcribed verbatim from the AML register of
 * the deployment this feature was built for, including the parts that are
 * empty because nobody ever filled them in.
 *
 * That distinction is not academic. It is the reason a real defect was
 * caught before the surface was switched on: `AML-2026-00002` is closed with
 * a terminated service gate, and because it closed before any document
 * requirement was ever created, the Documents stage read "No requirements
 * set" as a blocker — which made Documents the *current* stage and pointed
 * an operator at chasing a customer whose relationship had ended. Nothing
 * about that reading was wrong fact by fact; it was wrong as a whole, and
 * only a real row showed it.
 *
 * When the register grows a shape these five do not cover — an entity
 * customer, a rated case, an issued Passport, a linked partner — add it
 * here rather than inventing one.
 */
import { describe, expect, it } from "vitest";

import { deriveAmlJourney, deriveAmlLivePosition } from "./journeyModel";
import { deriveAmlNextAction } from "./workspaceViewModel";
import type { AmlWorkspaceFacts } from "./workspaceViewModel";

/* ------------------------------------------------------------------ */
/* Transcribed from `aml.cases` + its evidence counts                  */
/* ------------------------------------------------------------------ */

/** AML-2026-00004 — activated, client never started, one check pending. */
const activatedAwaitingClient: AmlWorkspaceFacts = {
  caseRow: {
    id: "8c58cc07-2175-4a5b-a18d-98fcfae9b67e",
    case_reference: "AML-2026-00004",
    subject_display_name: "Mithruban Bupathy",
    subject_type: "individual",
    status: "draft",
    case_stage: "activated",
    client_portal_status: "not_started",
    finance_portal_status: "not_requested",
    service_gate_status: "cdd_incomplete",
    risk_rating: null,
  },
  activation: { model: "A", event: "Signed engagement letter", activated_at: "2026-08-06T13:06:32Z" },
  openClientRequests: 1,
  identity: { checks: [{ party_label: "Mithruban Bupathy", status: "pending" }] },
  screening: { subjects: [] },
  documents: { requirements: [] },
  ownership: { links: [] },
  funding: { sources: [] },
  monitoring: { monitoring_status: "active", open_alerts: [], open_edd: [], overdue_review_count: 0 },
  gate: { status: "cdd_incomplete", conditions: [] },
  consent: null,
  passport: null,
};

/** SYN-AML-E2E-001 — no activation metadata at all (created by the harness). */
const legacyNoActivation: AmlWorkspaceFacts = {
  caseRow: {
    id: "97668f4b-d313-491a-a51b-779141d1f446",
    case_reference: "SYN-AML-E2E-001",
    subject_display_name: "Synthetic Testcase-Aml",
    subject_type: "individual",
    status: "kyc_in_progress",
    case_stage: "client_in_progress",
    client_portal_status: "in_progress",
    // Null in the register, not "not_requested" — the backfill never ran.
    finance_portal_status: null,
    service_gate_status: "cdd_incomplete",
    risk_rating: null,
  },
  activation: null,
  openClientRequests: 1,
  identity: { checks: [{ party_label: "Synthetic Testcase-Aml", status: "passed" }] },
  screening: { subjects: [] },
  documents: { requirements: [] },
  ownership: { links: [] },
  funding: { sources: [] },
  monitoring: null,
  gate: null,
  consent: null,
  passport: null,
};

/** AML-2026-00003 — enhanced CDD, information outstanding, nothing screened. */
const enhancedCdd: AmlWorkspaceFacts = {
  caseRow: {
    id: "2abb13da-8950-448d-8b47-7272ff588465",
    case_reference: "AML-2026-00003",
    subject_display_name: "lavanethaan ravachandran",
    subject_type: "individual",
    status: "edd_required",
    case_stage: "enhanced_cdd",
    client_portal_status: "additional_info_required",
    finance_portal_status: "not_requested",
    service_gate_status: "information_outstanding",
    risk_rating: null,
  },
  activation: { model: "A", event: "Engagement", activated_at: "2026-08-06T07:44:56Z" },
  openClientRequests: 1,
  identity: { checks: [] },
  screening: { subjects: [] },
  documents: { requirements: [] },
  ownership: { links: [] },
  funding: { sources: [] },
  monitoring: { monitoring_status: "active", open_alerts: [], open_edd: [], overdue_review_count: 0 },
  gate: { status: "information_outstanding", conditions: [] },
  consent: null,
  passport: null,
};

/** AML-2026-00002 — closed, gate terminated, nothing ever collected. */
const closedTerminated: AmlWorkspaceFacts = {
  caseRow: {
    id: "be5f1031-7d69-4e56-88a3-4df007f67f6e",
    case_reference: "AML-2026-00002",
    subject_display_name: "lavanethaan ravachandran",
    subject_type: "individual",
    status: "closed",
    case_stage: "closed",
    client_portal_status: "complete",
    finance_portal_status: "not_requested",
    service_gate_status: "terminated",
    risk_rating: null,
  },
  activation: { model: "A", event: "Engagement", activated_at: "2026-08-05T04:56:08Z" },
  openClientRequests: 0,
  identity: { checks: [] },
  screening: { subjects: [] },
  documents: { requirements: [] },
  ownership: { links: [] },
  funding: { sources: [] },
  monitoring: { monitoring_status: "active", open_alerts: [], open_edd: [], overdue_review_count: 0 },
  gate: { status: "terminated", conditions: [] },
  consent: null,
  passport: null,
};

const REGISTER: Array<[string, AmlWorkspaceFacts]> = [
  ["AML-2026-00004", activatedAwaitingClient],
  ["SYN-AML-E2E-001", legacyNoActivation],
  ["AML-2026-00003", enhancedCdd],
  ["AML-2026-00002", closedTerminated],
];

/* ------------------------------------------------------------------ */

describe("every case in the production register produces a usable journey", () => {
  it.each(REGISTER)("%s renders ten coherent stages", (_ref, facts) => {
    const journey = deriveAmlJourney(facts);
    expect(journey.stages).toHaveLength(10);
    for (const stage of journey.stages) {
      expect(stage.label).toBeTruthy();
      expect(stage.summary).toBeTruthy();
      expect(stage.ownerLabel).toBeTruthy();
      // Every stage must resolve to a section the workspace can mount.
      expect(stage.targetSection).toBeTruthy();
      expect(stage.sections.length).toBeGreaterThan(0);
      // A blocker is always an outstanding item, so the readiness count on
      // the rail can never read "all complete" beside a visible blocker.
      expect(stage.completedItems.length + stage.outstandingItems.length)
        .toBeGreaterThanOrEqual(stage.blockers.length);
    }
    // The live position never throws on a partially-backfilled row.
    const position = deriveAmlLivePosition(facts, journey);
    expect(position.stageTotal).toBe(10);
    expect(position.caseStageLabel).toBeTruthy();
    expect(position.clientStatusLabel).toBeTruthy();
    expect(position.financeStatusLabel).toBeTruthy();
    expect(position.serviceGateLabel).toBeTruthy();
  });

  it("points an activated case with an untouched client at Client intake", () => {
    const journey = deriveAmlJourney(activatedAwaitingClient);
    expect(journey.currentStageId).toBe("intake");
    const intake = journey.stages.find((s) => s.id === "intake")!;
    expect(intake.owner).toBe("client");
    expect(intake.blockers.map((b) => b.key)).toContain("portal_not_started");
    // The consent catalogue was not read for this case; that is stated, and
    // it is never mistaken for "consents accepted".
    expect(intake.unavailableFacts).toContain("consent catalogue");
    expect(intake.completedItems.map((c) => c.key)).not.toContain("consent");
  });

  it("treats a case with no activation metadata as activated, not as broken", () => {
    const activation = deriveAmlJourney(legacyNoActivation).stages
      .find((s) => s.id === "activation")!;
    expect(activation.status).toBe("complete");
    expect(activation.blockers).toHaveLength(0);
    expect(activation.warnings.map((w) => w.key)).toContain("legacy_activation");
  });

  it("survives a null finance_portal_status the backfill never wrote", () => {
    const position = deriveAmlLivePosition(
      legacyNoActivation,
      deriveAmlJourney(legacyNoActivation),
    );
    expect(position.financeStatusLabel).toBe("Not requested");
  });

  it("gives a closed, terminated case no next move and nothing blocking", () => {
    // The defect this file exists for. Before the fix, Documents read
    // "No requirements set" as a blocker and became the current stage.
    const journey = deriveAmlJourney(closedTerminated);
    expect(journey.stages.some((s) => s.blocking)).toBe(false);
    expect(journey.currentStageId).toBe("distribution");
    // ...and the ranked next action agrees, as it always has.
    expect(deriveAmlNextAction(closedTerminated).label).toBe("Case closed");
    // The gate is still stated for what it is.
    const passport = journey.stages.find((s) => s.id === "passport")!;
    expect(passport.summary).toMatch(/Terminated/i);
  });

  it("keeps enhanced due diligence visible as the analyst's move", () => {
    const decision = deriveAmlJourney(enhancedCdd).stages.find((s) => s.id === "decision")!;
    expect(decision.owner).toBe("analyst");
    expect(decision.blockers.map((b) => b.key)).toContain("edd_stage");
  });

  it("reports the Passport as not available — never as not issued — when no read succeeded", () => {
    // Every case in this register returns `null` for the passport read on a
    // deployment where the caller is not an MLRO. "Not available" and "Not
    // issued" are different statements and the rail must not conflate them.
    for (const [, facts] of REGISTER) {
      const journey = deriveAmlJourney(facts);
      expect(deriveAmlLivePosition(facts, journey).passportLabel).toBeNull();
      expect(journey.stages.find((s) => s.id === "passport")!.unavailableFacts)
        .toContain("passport state");
    }
  });
});

/**
 * Portal access, and the difference between "not started" and "cannot start".
 *
 * `client_portal_status` says how far the client has got. It says nothing
 * about whether they can log in. AML-2026-00005 was activated, its portal
 * notification written to `/client/aml` at 15:41, and the client has no
 * `client_portal_users` row at all — so the workspace told an operator to
 * "send or chase the onboarding invitation" when there was nothing to chase
 * and no way, from that screen, to send one.
 */
describe("the intake stage knows whether the client can actually get in", () => {
  const base = activatedAwaitingClient;

  it("names the missing login rather than telling anyone to chase it", () => {
    const journey = deriveAmlJourney({
      ...base,
      portalAccess: { exists: false },
    });
    const intake = journey.stages.find((s) => s.id === "intake")!;
    expect(intake.blockers.map((b) => b.key)).toContain("portal_no_access");
    expect(intake.blockers.map((b) => b.key)).not.toContain("portal_not_started");
    expect(intake.blockers.find((b) => b.key === "portal_no_access")?.detail)
      .toMatch(/issue portal access/i);
  });

  it("says chase, and only chase, once the client can sign in", () => {
    const journey = deriveAmlJourney({
      ...base,
      portalAccess: { exists: true, status: "active", lastLoginAt: null },
    });
    const intake = journey.stages.find((s) => s.id === "intake")!;
    expect(intake.blockers.map((b) => b.key)).toContain("portal_not_started");
    expect(intake.blockers.find((b) => b.key === "portal_not_started")?.detail)
      .toMatch(/chase/i);
  });

  it("degrades to the old wording when the portal was never read", () => {
    // An unread fact must not become "they have no login" — that would
    // offer to issue access to a client who already has it.
    const journey = deriveAmlJourney(base);
    const intake = journey.stages.find((s) => s.id === "intake")!;
    expect(intake.blockers.map((b) => b.key)).toContain("portal_not_started");
    expect(intake.blockers.map((b) => b.key)).not.toContain("portal_no_access");
  });

  it("leaves every other stage untouched by the new fact", () => {
    const without = deriveAmlJourney(base);
    const with_ = deriveAmlJourney({ ...base, portalAccess: { exists: false } });
    const other = (j: typeof without) =>
      j.stages.filter((s) => s.id !== "intake").map((s) => `${s.id}:${s.status}`);
    expect(other(with_)).toEqual(other(without));
  });
});
