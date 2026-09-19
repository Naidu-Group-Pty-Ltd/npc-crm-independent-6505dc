/**
 * The server-side screening policy, tested on the case that produced the
 * complaint.
 *
 * AML-2026-00005 / Rugesh Naidu, read from production:
 *
 *   purchasing_structure.entity_type  "Individual"
 *   personal_details.pep              "no"
 *   personal_details.adverse          "no"
 *   purchase_profile.third_party      "no"
 *   funding.overseas                  "no"
 *   cases.risk_rating                 null
 *   party_screening_subjects          0 rows
 *   party_reconciliation_items        0 rows
 *
 * The operator read that screen as "this client does not need screening".
 * The truth was that nobody had ever been enrolled — `party_screening_subjects`
 * was only ever written when a RELATED PARTY was reconciled, and an individual
 * purchase has none. So the first describe block is the enrolment fix, and the
 * invariant that outlives it: **the case subject is always enrolled.**
 */
import { describe, expect, it } from "vitest";

import {
  MANDATORY_SCOPES,
  PRIMARY_SUBJECT_PARTY_TYPE,
  RISK_BASED_SCOPES,
  SCREENING_POLICY_VERSION,
  SCREENING_ERROR_DETAIL,
  SCREENING_STALL_SECONDS,
  decideScreeningPolicy,
  deriveMissingScreeningSubjects,
  deriveScreeningNextAction,
  type EnrolmentInput,
  type NextActionInput,
  type ScreeningPolicyInput,
} from "../../../supabase/functions/_shared/aml/screeningPolicy.pure";

/** The production questionnaire, verbatim. */
const PRODUCTION_PERSONAL = {
  dob: "1993-12-10",
  pep: "no",
  address: "42 Seymour Way",
  adverse: "no",
  full_name: "Rugesh Naidu",
  occupation: "Property Consultant & Director",
  citizenship: "Australia",
  tax_residency: "Australia",
};

const lowRisk = (over: Partial<ScreeningPolicyInput> = {}): ScreeningPolicyInput => ({
  answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" },
  entityType: "Individual",
  riskRating: null,
  enhancedDueDiligence: false,
  anyPepFinding: false,
  ...over,
});

const enrolment = (over: Partial<EnrolmentInput> = {}): EnrolmentInput => ({
  subjectDisplayName: "Rugesh Naidu",
  personalDetails: PRODUCTION_PERSONAL,
  reconciled: [],
  existing: [],
  ...over,
});

/* ═════════════════ The enrolment defect ═════════════════ */

describe("the case subject is always enrolled", () => {
  it("enrols the customer on a case with no related parties at all", () => {
    // The exact production shape. This returned nothing before, which is why
    // Stage 5 had nothing to screen and nothing to press.
    const missing = deriveMissingScreeningSubjects(enrolment());
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      partyType: PRIMARY_SUBJECT_PARTY_TYPE,
      screenedName: "Rugesh Naidu",
      partyId: null,
      reconciliationItemId: null,
    });
  });

  it("carries the identifying detail the matcher needs, not a bare name", () => {
    // Matching on a display name alone wastes the matcher's DOB tolerance and
    // produces false positives a reviewer then has to clear by hand.
    const [subject] = deriveMissingScreeningSubjects(enrolment());
    expect(subject.dateOfBirth).toBe("1993-12-10");
    expect(subject.country).toBe("Australia");
  });

  it("enrols from the case record even with no questionnaire yet", () => {
    // The customer exists whether or not they have submitted anything.
    const missing = deriveMissingScreeningSubjects(enrolment({ personalDetails: null }));
    expect(missing).toHaveLength(1);
    expect(missing[0].screenedName).toBe("Rugesh Naidu");
    expect(missing[0].dateOfBirth).toBeNull();
  });

  it("falls back to the questionnaire name when the case has none", () => {
    const missing = deriveMissingScreeningSubjects(
      enrolment({ subjectDisplayName: null }));
    expect(missing[0].screenedName).toBe("Rugesh Naidu");
  });

  it("never enrols a subject with no name", () => {
    // An unnamed subject cannot be screened and would sit outstanding for ever.
    for (const name of [null, "", "   "]) {
      const missing = deriveMissingScreeningSubjects(
        enrolment({ subjectDisplayName: name, personalDetails: {} }));
      expect(missing).toHaveLength(0);
    }
  });

  it("is idempotent — running it twice enrols nobody twice", () => {
    const first = deriveMissingScreeningSubjects(enrolment());
    const second = deriveMissingScreeningSubjects(enrolment({
      existing: first.map((c) => ({
        partyType: c.partyType, partyId: c.partyId, screenedName: c.screenedName,
      })),
    }));
    expect(second).toHaveLength(0);
  });

  it("matches an existing subject case-insensitively", () => {
    const missing = deriveMissingScreeningSubjects(enrolment({
      existing: [{ partyType: PRIMARY_SUBJECT_PARTY_TYPE, partyId: null, screenedName: "  rugesh naidu " }],
    }));
    expect(missing).toHaveLength(0);
  });

  it("rejects a malformed date rather than storing it", () => {
    const [s] = deriveMissingScreeningSubjects(enrolment({
      personalDetails: { ...PRODUCTION_PERSONAL, dob: "10/12/1993" },
    }));
    expect(s.dateOfBirth).toBeNull();
  });
});

describe("reconciled related parties, and self-healing", () => {
  const item = (over: Partial<EnrolmentInput["reconciled"][number]> = {}) => ({
    id: "r1", declaredName: "Sam Roe", declaredRole: "co_purchaser",
    resolvedPartyType: "co_purchaser", resolvedPartyId: "p1",
    screeningRequired: true, resolutionStatus: "linked",
    declaredPayload: { date_of_birth: "1990-01-01", country: "Australia" },
    ...over,
  });

  it("enrols a resolved co-purchaser alongside the subject", () => {
    const missing = deriveMissingScreeningSubjects(enrolment({ reconciled: [item()] }));
    expect(missing.map((m) => m.partyType).sort())
      .toEqual(["co_purchaser", PRIMARY_SUBJECT_PARTY_TYPE].sort());
  });

  it("re-enrols a party whose insert was missed, without duplicating the subject", () => {
    // The self-healing case: parties resolved before this shipped.
    const missing = deriveMissingScreeningSubjects(enrolment({
      reconciled: [item()],
      existing: [{ partyType: PRIMARY_SUBJECT_PARTY_TYPE, partyId: null, screenedName: "Rugesh Naidu" }],
    }));
    expect(missing).toHaveLength(1);
    expect(missing[0].partyType).toBe("co_purchaser");
  });

  it("does not enrol an unresolved or screening-exempt party", () => {
    for (const over of [
      { resolutionStatus: "open" }, { resolutionStatus: "dismissed" },
      { screeningRequired: false },
    ]) {
      const missing = deriveMissingScreeningSubjects(
        enrolment({ reconciled: [item(over)] }));
      expect(missing.map((m) => m.partyType)).toEqual([PRIMARY_SUBJECT_PARTY_TYPE]);
    }
  });

  it("falls back to the declared role when nothing resolved a party type", () => {
    const missing = deriveMissingScreeningSubjects(enrolment({
      reconciled: [item({ resolvedPartyType: null, resolvedPartyId: null })],
    }));
    expect(missing.some((m) => m.partyType === "co_purchaser")).toBe(true);
  });
});

/* ═════════════════ Scope: what is proportionate ═════════════════ */

describe("sanctions and PEP are never stood down", () => {
  it("are the mandatory scopes, and the risk-based set holds neither", () => {
    expect([...MANDATORY_SCOPES].sort()).toEqual(["pep", "sanctions"]);
    expect([...RISK_BASED_SCOPES].sort()).toEqual(["adverse_media", "watchlist"]);
  });

  it("survives every combination of answers, risk, entity and EDD", () => {
    const yn = ["yes", "no", null] as const;
    for (const pep of yn) {
      for (const adverse of yn) {
        for (const riskRating of ["low", "medium", "high", "prohibited", null]) {
          for (const entityType of ["Individual", "Company", "Trust", null]) {
            for (const edd of [true, false]) {
              const d = decideScreeningPolicy(lowRisk({
                answers: { pep, adverse, thirdParty: "no", overseasFunding: "no" },
                riskRating, entityType, enhancedDueDiligence: edd,
              }));
              const where = `pep=${pep} adverse=${adverse} risk=${riskRating} entity=${entityType} edd=${edd}`;
              expect(d.required, where).toContain("sanctions");
              expect(d.required, where).toContain("pep");
              expect(d.notRequired.map((n) => n.scope), where).not.toContain("sanctions");
              expect(d.notRequired.map((n) => n.scope), where).not.toContain("pep");
            }
          }
        }
      }
    }
  });
});

describe("the production case's scope", () => {
  it("reduces to sanctions and PEP, and says so", () => {
    const d = decideScreeningPolicy(lowRisk());
    expect(d.required.sort()).toEqual(["pep", "sanctions"]);
    expect(d.notRequired.map((n) => n.scope).sort()).toEqual(["adverse_media", "watchlist"]);
    expect(d.summary).toMatch(/Reduced scope/);
    expect(d.triggers).toEqual([]);
  });

  it("records the answers that produced it, for the audit trail", () => {
    const d = decideScreeningPolicy(lowRisk());
    expect(d.evidence).toMatchObject({
      "personal_details.pep": "no",
      "personal_details.adverse": "no",
      "purchase_profile.third_party": "no",
      "funding.overseas": "no",
      "purchasing_structure.entity_type": "Individual",
      "case.risk_rating": "unrated",
    });
    expect(d.policyVersion).toBe(SCREENING_POLICY_VERSION);
  });

  it("states the basis on the risk profile, never on 'the client said no'", () => {
    const { basis } = decideScreeningPolicy(lowRisk()).notRequired[0];
    expect(basis).toContain(SCREENING_POLICY_VERSION);
    expect(basis).toMatch(/not rated high or prohibited risk/);
    expect(basis.length).toBeGreaterThan(80);
  });

  it("selects the declaration-supported PEP route — a route, not a waiver", () => {
    const d = decideScreeningPolicy(lowRisk());
    expect(d.pepRoute).toBe("declaration_supported");
    // And PEP is still required.
    expect(d.required).toContain("pep");
  });
});

describe("risk evidence overrides the client's own answers", () => {
  const cases: Array<[string, Partial<ScreeningPolicyInput>, RegExp]> = [
    ["high risk", { riskRating: "high" }, /high risk/],
    ["prohibited risk", { riskRating: "prohibited" }, /prohibited risk/],
    ["enhanced due diligence", { enhancedDueDiligence: true }, /enhanced due diligence/],
    ["a PEP finding", { anyPepFinding: true }, /politically exposed person/],
    ["a company customer", { entityType: "Company" }, /company rather than an individual/],
    ["a trust customer", { entityType: "Trust" }, /trust rather than an individual/],
    ["overseas funding", {
      answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "yes" },
    }, /overseas/],
    ["a third party", {
      answers: { pep: "no", adverse: "no", thirdParty: "yes", overseasFunding: "no" },
    }, /third party/],
    ["a disclosed adverse finding", {
      answers: { pep: "no", adverse: "yes", thirdParty: "no", overseasFunding: "no" },
    }, /disclosed adverse media/],
  ];

  it.each(cases)("keeps the full scope for %s", (_n, over, reason) => {
    const d = decideScreeningPolicy(lowRisk(over));
    expect(d.notRequired).toHaveLength(0);
    expect(d.required.sort()).toEqual(["adverse_media", "pep", "sanctions", "watchlist"]);
    expect(d.triggers.join(" ")).toMatch(reason);
    expect(d.pepRoute).toBe("manual_review");
  });

  it("names every reason, not just the first", () => {
    const d = decideScreeningPolicy(lowRisk({ riskRating: "high", enhancedDueDiligence: true }));
    expect(d.triggers).toHaveLength(2);
    expect(d.summary).toMatch(/high risk/);
    expect(d.summary).toMatch(/enhanced due diligence/);
  });
});

describe("an incomplete questionnaire stands nothing down", () => {
  it("requires everything when a single answer is missing", () => {
    const partial = [
      { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: null },
      { pep: "no", adverse: null, thirdParty: "no", overseasFunding: "no" },
      { pep: null, adverse: "no", thirdParty: "no", overseasFunding: "no" },
    ] as const;
    for (const answers of partial) {
      const d = decideScreeningPolicy(lowRisk({ answers }));
      expect(d.notRequired).toHaveLength(0);
      expect(d.pepRoute).toBe("manual_review");
      expect(d.summary).toMatch(/incomplete/);
    }
  });

  it("requires everything when the questionnaire was never read", () => {
    const d = decideScreeningPolicy(lowRisk({ answers: null }));
    expect(d.notRequired).toHaveLength(0);
    expect(d.required).toContain("adverse_media");
  });

  it("does not treat an unrecognised answer as 'no'", () => {
    const d = decideScreeningPolicy(lowRisk({
      answers: { pep: "unsure" as never, adverse: "no", thirdParty: "no", overseasFunding: "no" },
    }));
    expect(d.notRequired).toHaveLength(0);
  });
});

/* ═════════════════ Exactly one next action ═════════════════ */

describe("one next action, chosen by what actually blocks the stage", () => {
  const state = (over: Partial<NextActionInput> = {}): NextActionInput => ({
    hasSubmission: true, subjectCount: 1, providerReady: true,
    anyUnscreened: true, anyProcessing: false, anyPossibleMatch: false,
    anyConfirmedMatch: false, anyMissingPep: true,
    pepRoute: "declaration_supported", ...over,
  });

  it("never offers to run screening with nobody enrolled", () => {
    // The bug on the screenshot: a "Run screening" button over an empty
    // subject list, beside a panel telling the operator to go reconcile
    // parties that do not exist.
    const a = deriveScreeningNextAction(state({ subjectCount: 0 }));
    expect(a.key).toBe("enrol_subjects");
    expect(a.owner).toBe("system");
    expect(a.detail).toMatch(/no client action is required/i);
  });

  it("waits on the client when there is no questionnaire to prepare from", () => {
    const a = deriveScreeningNextAction(state({ subjectCount: 0, hasSubmission: false }));
    expect(a.key).toBe("await_submission");
    expect(a.owner).toBe("client");
    expect(a.label).toBeNull();
  });

  it("points a provider fault at an administrator, not the client", () => {
    const a = deriveScreeningNextAction(state({ providerReady: false }));
    expect(a.key).toBe("fix_provider");
    expect(a.owner).toBe("administrator");
    expect(a.detail).toMatch(/No client action is required/i);
  });

  it("does not offer a provider fix once everything is already screened", () => {
    const a = deriveScreeningNextAction(state({ providerReady: false, anyUnscreened: false }));
    expect(a.key).toBe("record_pep");
  });

  it("prefers adjudication over everything else", () => {
    const a = deriveScreeningNextAction(state({
      anyPossibleMatch: true, providerReady: false, subjectCount: 0,
    }));
    expect(a.key).toBe("adjudicate_match");
  });

  it("escalates a confirmed match above ordinary work", () => {
    const a = deriveScreeningNextAction(state({ anyConfirmedMatch: true }));
    expect(a.key).toBe("escalate");
    expect(a.detail).toMatch(/must not proceed to service/i);
  });

  it("says the engine is working rather than asking for another click", () => {
    const a = deriveScreeningNextAction(state({ anyProcessing: true }));
    expect(a.key).toBe("await_provider_result");
    expect(a.label).toBeNull();
    expect(a.owner).toBe("system");
  });

  it("offers screening once somebody is enrolled and the provider is healthy", () => {
    const a = deriveScreeningNextAction(state());
    expect(a.key).toBe("run_screening");
    expect(a.label).toBe("Run screening");
  });

  it("explains the prefilled route when the declaration supports it", () => {
    const a = deriveScreeningNextAction(state({ anyUnscreened: false }));
    expect(a.key).toBe("record_pep");
    expect(a.detail).toMatch(/prefilled/);
    expect(a.detail).toMatch(/evidence, not the determination/);
  });

  it("says so when the case does not qualify for that route", () => {
    const a = deriveScreeningNextAction(state({
      anyUnscreened: false, pepRoute: "manual_review",
    }));
    expect(a.detail).toMatch(/does not qualify/);
  });

  it("completes only when nothing is outstanding, and is not an approval", () => {
    const a = deriveScreeningNextAction(state({
      anyUnscreened: false, anyMissingPep: false,
    }));
    expect(a.key).toBe("none");
    expect(a.headline).toBe("Stage 5 complete");
    expect(a.detail).toMatch(/not a service-gate decision/i);
  });

  it("always produces a headline and a detail", () => {
    const combos: Array<Partial<NextActionInput>> = [
      {}, { subjectCount: 0 }, { subjectCount: 0, hasSubmission: false },
      { providerReady: false }, { anyProcessing: true }, { anyPossibleMatch: true },
      { anyConfirmedMatch: true }, { anyUnscreened: false },
      { anyUnscreened: false, anyMissingPep: false },
    ];
    for (const over of combos) {
      const a = deriveScreeningNextAction(state(over));
      expect(a.headline).toBeTruthy();
      expect(a.detail).toBeTruthy();
      expect(a.key === "none").toBe(a.owner === "none");
    }
  });
});

/* ═════════════════ "Queued" is only "running" if something runs ═════════ */

describe("a queue nobody drains is not screening in progress", () => {
  const queued = (over: Partial<NextActionInput> = {}): NextActionInput => ({
    hasSubmission: true, subjectCount: 1, providerReady: true,
    anyUnscreened: false, anyProcessing: true, anyPossibleMatch: false,
    anyConfirmedMatch: false, anyMissingPep: true,
    pepRoute: "declaration_supported", ...over,
  });

  it("reports work as running inside the stall window", () => {
    const a = deriveScreeningNextAction(queued({ oldestQueuedSeconds: 30 }));
    expect(a.key).toBe("await_provider_result");
    expect(a.headline).toBe("Screening is running");
  });

  it("stops claiming it is running once nothing has picked it up", () => {
    // The production case: the outbox row sat with attempts = 0 because no
    // cron drove the worker, while the workspace said the engine was working.
    const a = deriveScreeningNextAction(
      queued({ oldestQueuedSeconds: SCREENING_STALL_SECONDS }));
    expect(a.key).toBe("screening_stalled");
    expect(a.headline).toBe("Screening has not started");
    expect(a.label).toBe("Retry screening");
    expect(a.owner).toBe("administrator");
  });

  it("says how long, in minutes, rather than 'a while'", () => {
    const a = deriveScreeningNextAction(queued({ oldestQueuedSeconds: 20 * 60 }));
    expect(a.detail).toMatch(/queued for 20 minutes/);
    expect(a.detail).toMatch(/refused rather than sent twice/);
  });

  it("never reports an UNREAD queue as stalled", () => {
    // No queue reading is not evidence of a stalled queue.
    for (const age of [null, undefined]) {
      expect(deriveScreeningNextAction(queued({ oldestQueuedSeconds: age })).key)
        .toBe("await_provider_result");
    }
  });

  it("keeps adjudication and escalation ahead of a stall", () => {
    expect(deriveScreeningNextAction(
      queued({ oldestQueuedSeconds: 9999, anyPossibleMatch: true })).key)
      .toBe("adjudicate_match");
    expect(deriveScreeningNextAction(
      queued({ oldestQueuedSeconds: 9999, anyConfirmedMatch: true })).key)
      .toBe("escalate");
  });
});

/* ═════════════ A technical failure is named, owned and actionable ═══════ */

describe("a failed check says what failed and who fixes it", () => {
  const failed = (errorCategory: string): NextActionInput => ({
    hasSubmission: true, subjectCount: 1, providerReady: true,
    anyUnscreened: true, anyProcessing: false, anyPossibleMatch: false,
    anyConfirmedMatch: false, anyMissingPep: true,
    pepRoute: "declaration_supported", errorCategory,
  });

  it("names the empty sanctions list, and where to load it", () => {
    // The production state: `aml.sanctions_entries` is empty, so a check
    // would be screening against nothing.
    const a = deriveScreeningNextAction(failed("list_data_unavailable"));
    // Named as the AUTOMATED method failing: the obligation is untouched by
    // it, and a second method may still be able to discharge it.
    expect(a.headline).toBe("Automated screening could not complete");
    expect(a.detail).toMatch(/never been loaded/);
    expect(a.detail).toMatch(/AML › Verification/);
    expect(a.detail).toMatch(/No client action is required/i);
    expect(a.owner).toBe("administrator");
  });

  it("names simulator mode as a configuration fault, not a client one", () => {
    const a = deriveScreeningNextAction(failed("provider_misconfigured"));
    expect(a.detail).toMatch(/simulator mode/);
    expect(a.owner).toBe("administrator");
    expect(a.label).toBe("Open screening configuration");
  });

  it("offers a retry for a transient fault, owned by the analyst", () => {
    for (const category of ["timeout", "provider_unavailable"]) {
      const a = deriveScreeningNextAction(failed(category));
      expect(a.label, category).toBe("Retry screening");
      expect(a.owner, category).toBe("analyst");
      expect(a.detail, category).toMatch(/consumes no attempt/);
    }
  });

  it("never renders a raw category code at the operator", () => {
    for (const category of Object.keys(SCREENING_ERROR_DETAIL)) {
      const a = deriveScreeningNextAction(failed(category));
      expect(a.detail, category).not.toContain("_");
    }
  });

  it("falls back to a safe sentence for an unknown category", () => {
    const a = deriveScreeningNextAction(failed("something_new"));
    expect(a.detail).toMatch(/never a clear result/);
  });

  it("still puts adjudication and escalation ahead of a technical failure", () => {
    expect(deriveScreeningNextAction({
      ...failed("list_data_unavailable"), anyPossibleMatch: true,
    }).key).toBe("adjudicate_match");
    expect(deriveScreeningNextAction({
      ...failed("list_data_unavailable"), anyConfirmedMatch: true,
    }).key).toBe("escalate");
  });

  it("does not claim a failure when there is none", () => {
    const a = deriveScreeningNextAction({ ...failed("x"), errorCategory: null });
    expect(a.key).toBe("run_screening");
  });
});
