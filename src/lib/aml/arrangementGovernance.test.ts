import { describe, expect, it } from "vitest";
import {
  evaluateArrangementForReliance,
  type ArrangementInput,
} from "../../../supabase/functions/_shared/aml/relianceEligibility";

/**
 * Behavioural tests for the Phase 2 arrangement-governance layer of the
 * reliance eligibility guard. Deterministic: `now` is injected. Synthetic
 * identifiers only.
 */

const NOW = new Date("2026-08-05T00:00:00Z");

const arrangement = (over: Partial<ArrangementInput> = {}): ArrangementInput => ({
  id: "agr-0001",
  status: "active",
  next_review_due: "2027-01-01",
  eligibility_classification: "eligible_reporting_entity",
  scope_procedures: ["customer_identification"],
  scope_customer_types: null,
  effective_from: null,
  expires_on: null,
  partner_org_id: "org-aaaa",
  ...over,
});

const operative = { decision: "suitable", next_due_at: "2027-01-01", status: "operative" };

const evaluate = (
  a: ArrangementInput | null,
  s: typeof operative | null = operative,
  caseCustomerType: string | null = null,
) => evaluateArrangementForReliance({
  arrangement: a, assessment: s,
  requiredProcedure: "customer_identification",
  caseCustomerType, now: NOW,
});

describe("arrangement governance guard (Phase 2)", () => {
  it("passes a current, in-scope, eligible, suitably-assessed arrangement", () => {
    expect(evaluate(arrangement())).toEqual({ ok: true });
    expect(evaluate(arrangement(), { ...operative, decision: "suitable_with_conditions" }))
      .toEqual({ ok: true });
  });

  it("no agreement blocks reliance", () => {
    expect(evaluate(null)).toMatchObject({ ok: false, code: "agreement_missing" });
  });

  it("suspended and terminated agreements block reliance", () => {
    for (const status of ["suspended", "terminated"]) {
      expect(evaluate(arrangement({ status })))
        .toMatchObject({ ok: false, code: "agreement_inactive" });
    }
  });

  it("expired and not-yet-effective agreements block reliance", () => {
    expect(evaluate(arrangement({ expires_on: "2026-08-01" })))
      .toMatchObject({ ok: false, code: "agreement_expired" });
    expect(evaluate(arrangement({ effective_from: "2026-09-01" })))
      .toMatchObject({ ok: false, code: "agreement_not_yet_effective" });
  });

  it("an overdue arrangement review blocks new reliance", () => {
    expect(evaluate(arrangement({ next_review_due: "2026-08-04" })))
      .toMatchObject({ ok: false, code: "review_overdue" });
  });

  it("unrecorded or not-eligible eligibility blocks reliance without guessing", () => {
    expect(evaluate(arrangement({ eligibility_classification: "unassessed" })))
      .toMatchObject({ ok: false, code: "eligibility_not_recorded" });
    expect(evaluate(arrangement({ eligibility_classification: "not_eligible" })))
      .toMatchObject({ ok: false, code: "eligibility_not_eligible" });
  });

  it("a scope mismatch blocks reliance — unrecorded procedures fail closed", () => {
    expect(evaluate(arrangement({ scope_procedures: null })))
      .toMatchObject({ ok: false, code: "scope_not_recorded" });
    expect(evaluate(arrangement({ scope_procedures: [] })))
      .toMatchObject({ ok: false, code: "scope_not_recorded" });
    expect(evaluate(arrangement({ scope_procedures: ["ongoing_cdd"] })))
      .toMatchObject({ ok: false, code: "scope_procedure_not_covered" });
  });

  it("customer-type scope restricts only when it was recorded", () => {
    // Recorded and covering: passes.
    expect(evaluate(arrangement({ scope_customer_types: ["individual"] }), operative, "individual"))
      .toEqual({ ok: true });
    // Recorded and not covering: blocks.
    expect(evaluate(arrangement({ scope_customer_types: ["individual"] }), operative, "trust"))
      .toMatchObject({ ok: false, code: "scope_customer_type_not_covered" });
    // Not recorded: does not restrict by type.
    expect(evaluate(arrangement({ scope_customer_types: null }), operative, "trust"))
      .toEqual({ ok: true });
  });

  it("a missing, superseded, overdue or unsuitable assessment blocks reliance", () => {
    expect(evaluate(arrangement(), null))
      .toMatchObject({ ok: false, code: "assessment_missing" });
    expect(evaluate(arrangement(), { ...operative, status: "superseded" }))
      .toMatchObject({ ok: false, code: "assessment_missing" });
    expect(evaluate(arrangement(), { ...operative, next_due_at: "2026-08-04" }))
      .toMatchObject({ ok: false, code: "assessment_overdue" });
    expect(evaluate(arrangement(), { ...operative, decision: "unsuitable" }))
      .toMatchObject({ ok: false, code: "assessment_unsuitable" });
  });

  it("every denial names the independent route or a remedial step, never restricted reasoning", () => {
    const denials = [
      evaluate(null),
      evaluate(arrangement({ status: "terminated" })),
      evaluate(arrangement({ eligibility_classification: "unassessed" })),
      evaluate(arrangement({ scope_procedures: ["ongoing_cdd"] })),
      evaluate(arrangement(), { ...operative, decision: "unsuitable" }),
    ];
    for (const d of denials) {
      expect(d.ok).toBe(false);
      if (d.ok === false) {
        expect(d.message).not.toMatch(/risk|screening|match|mlro note|reviewer note|suspicious|smr/i);
      }
    }
  });

  it("the guard is pure — evaluating never mutates its inputs", () => {
    const a = arrangement();
    const s = { ...operative };
    const before = JSON.stringify({ a, s });
    evaluate(a, s, "individual");
    expect(JSON.stringify({ a, s })).toBe(before);
  });
});
