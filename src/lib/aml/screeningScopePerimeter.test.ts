import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_SCREENING_SCOPES,
  decideScreeningPolicy,
  deriveScreeningScope,
  PERIMETER_REASON_CODES,
  deriveScreeningNextAction,
  providerReadinessRelevant,
  readPerimeter,
  reconcileSubjectToScope,
  requiredScopes,
  SCREENING_POLICY_VERSION,
} from "../../../supabase/functions/_shared/aml/screeningPolicy.pure.ts";
import {
  isPartyScreeningMissing,
  partyScreeningOutstanding,
} from "../../../supabase/functions/_shared/aml/partyScreening.pure.ts";
import { deriveAmlScreeningScope } from "./screeningScope";

/**
 * Sanctions screening stops being universally mandatory — and the ONE basis
 * on which it may be stood down.
 *
 * Targeted financial sanctions bind every dealing under the Charter of the
 * United Nations Act 1945 and the Autonomous Sanctions Act 2011. They are
 * not risk-based, so no rating, profile or questionnaire answer reduces
 * them. What can be true is that a case is not a dealing at all — an enquiry
 * that never became an engagement, an administrative duplicate, a service
 * declined before it commenced.
 *
 * Everything below is about that distinction holding under pressure: that
 * the perimeter is the only lever, that it fails closed, that `not_required`
 * never becomes "clear", and that a case nobody had to screen is not held up
 * by a provider it does not use.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const casesFn = read("supabase/functions/aml-cases/index.ts");
const policyFn = read("supabase/functions/_shared/aml/screeningPolicy.pure.ts");
const migration = read(
  "supabase/migrations/20260920000000_aml_screening_scope_perimeter.sql");

/** A case that is plainly inside the perimeter, answers complete, low risk. */
const CLEAN_INPUT = {
  answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" },
  entityType: "individual",
  riskRating: "low",
  enhancedDueDiligence: false,
  anyPepFinding: false,
} as const;

/** The stored perimeter row for a case that is outside it, sanctions only. */
const OUTSIDE = {
  classification: "outside_perimeter",
  reason_code: "enquiry_only",
  scopes_excluded: ["sanctions"],
  recorded_by_label: "mlro@npcservices.com.au",
  recorded_at: "2026-08-18T00:00:00.000Z",
  superseded_at: null,
};

describe("1-2. an eligible case has sanctions not_required", () => {
  it("marks sanctions not required, with a reason code and a reason", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.sanctions.required).toBe(false);
    expect(d.sanctions.optional).toBe(true);
    expect(d.sanctions.reasonCode).toBe("perimeter:enquiry_only");
    expect(d.sanctions.reason).toMatch(/never entered into/i);
    expect(requiredScopes(d)).not.toContain("sanctions");
  });

  it("says plainly that nobody was screened", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.sanctions.reason).toMatch(/not a screening result/i);
    expect(d.sanctions.reason).toMatch(/nobody has been cleared/i);
  });
});

describe("19. a case inside the perimeter keeps sanctions mandatory", () => {
  it("requires sanctions with no perimeter row at all", () => {
    const d = deriveScreeningScope(CLEAN_INPUT);
    expect(d.sanctions.required).toBe(true);
    expect(d.sanctions.optional).toBe(false);
    expect(d.sanctions.reasonCode).toBe("tfs_obligation");
  });

  it("cannot be stood down by ANY risk or profile input", () => {
    // The whole input space, without a perimeter finding. Sanctions survives
    // every combination, because it does not answer to risk.
    for (const riskRating of ["low", "medium", "high", "prohibited", null]) {
      for (const entityType of ["individual", "company", "trust", null]) {
        for (const edd of [true, false]) {
          for (const pep of ["yes", "no", null] as const) {
            const d = deriveScreeningScope({
              answers: { pep, adverse: "no", thirdParty: "no", overseasFunding: "no" },
              entityType, riskRating, enhancedDueDiligence: edd, anyPepFinding: false,
            });
            expect(d.sanctions.required).toBe(true);
          }
        }
      }
    }
  });
});

describe("the perimeter fails closed", () => {
  it.each([
    ["no row", null],
    ["undefined", undefined],
    ["a string", "outside_perimeter"],
    ["classification missing", { reason_code: "enquiry_only", scopes_excluded: ["sanctions"] }],
    ["an unknown reason code", { ...OUTSIDE, reason_code: "low_risk" }],
    ["no reason code", { ...OUTSIDE, reason_code: null }],
    ["excluding nothing", { ...OUTSIDE, scopes_excluded: [] }],
    ["excluding an unknown scope", { ...OUTSIDE, scopes_excluded: ["everything"] }],
    ["superseded", { ...OUTSIDE, superseded_at: "2026-08-18T01:00:00.000Z" }],
  ])("keeps sanctions required when the perimeter is %s", (_label, perimeter) => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter });
    expect(d.sanctions.required).toBe(true);
    expect(readPerimeter(perimeter).classification).toBe("designated_service");
  });

  it("offers no reason code that is about risk", () => {
    // "low risk" as a sanctions exemption is the one basis an auditor would
    // reject, so it must not be expressible.
    for (const code of PERIMETER_REASON_CODES) {
      expect(code).not.toMatch(/risk|low|rating|score/i);
    }
  });
});

describe("22-23. the scopes are decided independently", () => {
  it("stands sanctions down while PEP stays mandatory", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.sanctions.required).toBe(false);
    expect(d.pep.required).toBe(true);
    expect(requiredScopes(d)).toContain("pep");
  });

  it("stands PEP down while sanctions stays mandatory", () => {
    const d = deriveScreeningScope({
      ...CLEAN_INPUT,
      perimeter: { ...OUTSIDE, scopes_excluded: ["pep"] },
    });
    expect(d.pep.required).toBe(false);
    expect(d.sanctions.required).toBe(true);
  });

  it("keeps adverse media and watchlist on their own risk rule", () => {
    // Untouched by a sanctions-only perimeter finding: they are stood down
    // here by the risk rule, and that is a different reason code.
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.adverse_media.required).toBe(false);
    expect(d.adverse_media.reasonCode).toBe("risk_not_triggered");
    expect(d.watchlist.reasonCode).toBe("risk_not_triggered");

    // ...and a triggered case keeps them even with the perimeter finding.
    const triggered = deriveScreeningScope({
      ...CLEAN_INPUT, riskRating: "high", perimeter: OUTSIDE,
    });
    expect(triggered.sanctions.required).toBe(false);
    expect(triggered.adverse_media.required).toBe(true);
    expect(triggered.adverse_media.reasonCode).toBe("risk_triggered");
  });

  it("every scope carries its own reason code", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    for (const k of ALL_SCREENING_SCOPES) {
      expect(d[k].reasonCode).toBeTruthy();
      expect(d[k].reason).toBeTruthy();
      expect(d[k].scope).toBe(k);
    }
  });
});

describe("5-6, 24. provider readiness is scope-aware", () => {
  it("is irrelevant when nothing required needs the provider", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    // sanctions not required, adverse media and watchlist not triggered.
    expect(providerReadinessRelevant(d)).toBe(false);
  });

  it("is relevant the moment a scope that uses it is required", () => {
    expect(providerReadinessRelevant(deriveScreeningScope(CLEAN_INPUT))).toBe(true);
    const triggered = deriveScreeningScope({
      ...CLEAN_INPUT, riskRating: "high", perimeter: OUTSIDE,
    });
    expect(providerReadinessRelevant(triggered)).toBe(true);
  });

  it("is relevant for a voluntary run, and only for that run", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(providerReadinessRelevant(d, { voluntaryRunRequested: true })).toBe(true);
    expect(providerReadinessRelevant(d)).toBe(false);
  });
});

describe("28-29. the gates ignore a scope nobody required", () => {
  const now = "2026-08-18T00:00:00.000Z";

  it("partyScreeningOutstanding returns nothing for a not_required subject", () => {
    expect(partyScreeningOutstanding(
      { required: false, state: "not_required" }, now)).toBeNull();
    expect(isPartyScreeningMissing(
      { required: false, state: "not_required" }, now)).toBe(false);
  });

  it("still reports a required subject that has not been screened", () => {
    expect(partyScreeningOutstanding(
      { required: true, state: "not_started" }, now)).toBe("incomplete");
    expect(isPartyScreeningMissing(
      { required: true, state: "not_started" }, now)).toBe(true);
  });

  it("still reports a technical error, which is never a clear result", () => {
    expect(partyScreeningOutstanding(
      { required: true, state: "error" }, now)).toBe("incomplete");
  });
});

describe("10, 30. not_required is never rendered as clear", () => {
  const serverScopes = [
    { scope: "sanctions", required: false, optional: true, state: "not_required",
      reason_code: "perimeter:enquiry_only",
      reason: "This record exists for an enquiry or quotation only." },
    { scope: "pep", required: true, optional: false, state: "required",
      reason_code: "pep_determination_required", reason: "A determination must be established." },
  ] as const;

  it("marks the reading notRequired, distinct from resolved", () => {
    const view = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, serverScopes as never);
    const sanctions = view.determinations.find((d) => d.scope === "sanctions")!;
    expect(sanctions.required).toBe(false);
    expect(sanctions.notRequired).toBe(true);
    // Satisfied for the stage...
    expect(sanctions.resolved).toBe(true);
    // ...and never described as a screening outcome.
    expect(sanctions.detail).toMatch(/not required/i);
    expect(sanctions.detail).not.toMatch(/\bclear\b/i);
    expect(sanctions.detail).not.toMatch(/no match/i);
    expect(sanctions.detail).not.toMatch(/screened and/i);
  });

  it("does not list a not-required scope as outstanding", () => {
    const view = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, serverScopes as never);
    expect(view.outstanding.join(" ")).not.toMatch(/sanction/i);
  });

  it("keeps PEP outstanding on the very same case", () => {
    const view = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, serverScopes as never);
    expect(view.outstanding.join(" ")).toMatch(/PEP determination/i);
    expect(view.canAdvance).toBe(false);
  });

  it("11. advances once the other required scopes resolve", () => {
    const view = deriveAmlScreeningScope({
      answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" },
      entityType: "individual",
      sanctionsState: "not_started",
      pepDetermination: {
        result: "not_pep", determinedAt: "2026-08-01T00:00:00.000Z",
        reviewDueAt: "2027-08-01T00:00:00.000Z", supersededAt: null,
      },
      now: "2026-08-18T00:00:00.000Z",
    }, null, serverScopes as never);
    expect(view.outstanding).toEqual([]);
    expect(view.canAdvance).toBe(true);
  });

  it("without a server decision, every scope is still required", () => {
    // An older server sends no scopes. The browser must not read silence as
    // an exemption.
    const view = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, null);
    const sanctions = view.determinations.find((d) => d.scope === "sanctions")!;
    expect(sanctions.required).toBe(true);
    expect(sanctions.notRequired).toBeFalsy();
  });
});

describe("18. the client cannot manufacture an exemption", () => {
  it("the scope engine reads no `required` field from its input", () => {
    // Anything a caller claims about `required` is ignored because nothing
    // reads it: the decision comes from the perimeter row and the risk rule.
    const forged = deriveScreeningScope({
      ...CLEAN_INPUT,
      // @ts-expect-error — deliberately forging a field the type has no place for
      sanctions: { required: false }, required: ["pep"], scopes: { sanctions: false },
    });
    expect(forged.sanctions.required).toBe(true);
  });

  it("a perimeter row invented in the request body still needs a valid shape", () => {
    const forged = deriveScreeningScope({
      ...CLEAN_INPUT,
      perimeter: { classification: "outside_perimeter", reason_code: "because_i_said" },
    });
    expect(forged.sanctions.required).toBe(true);
  });

  it("the operation takes a classification and reason code, never a required flag", () => {
    const op = casesFn.slice(
      casesFn.indexOf("case 'classify_screening_perimeter'"),
      casesFn.indexOf("case 'run_optional_screening'"));
    expect(op).toMatch(/body\.classification/);
    expect(op).toMatch(/body\.reason_code/);
    expect(op).not.toMatch(/body\.required/);
    expect(op).not.toMatch(/body\.state/);
  });
});

describe("17. only the right roles may act", () => {
  const classify = casesFn.slice(
    casesFn.indexOf("case 'classify_screening_perimeter'"),
    casesFn.indexOf("case 'run_optional_screening'"));
  const optional = casesFn.slice(
    casesFn.indexOf("case 'run_optional_screening'"),
    casesFn.indexOf("case 'queue_party_screening'"));

  it("classifying the perimeter needs reviewer or MLRO, not merely write", () => {
    // canWrite includes analysts. Standing down a sanctions obligation is a
    // compliance act, not data entry.
    expect(classify).toMatch(/roles\.has\('reviewer'\)/);
    expect(classify).toMatch(/roles\.has\('mlro'\)/);
    expect(classify).toMatch(/insufficient_role/);
  });

  it("running an optional screening needs a write role", () => {
    expect(optional).toMatch(/if \(!canWrite\) return jsonResponse/);
  });
});

describe("12-16. the optional run", () => {
  const optional = casesFn.slice(
    casesFn.indexOf("case 'run_optional_screening'"),
    casesFn.indexOf("case 'queue_party_screening'"));

  it("13. uses the normal provider pipeline", () => {
    expect(optional).toMatch(/runScreeningInline\(admin, subjectId\)/);
  });

  it("refuses to run against a scope that is actually required", () => {
    expect(optional).toMatch(/scopeRow\.required === true/);
    expect(optional).toMatch(/scope_is_required/);
  });

  it("15. never rewrites the policy decision", () => {
    // `required` is reported false whatever the run produces, and the
    // operation writes nothing to case_screening_scopes.
    expect(optional).toMatch(/scope_required: false/);
    expect(optional).not.toMatch(/from\('case_screening_scopes'\)[\s\S]{0,80}(update|insert)/);
  });

  it("14. persists a real check, marked voluntary and attributed", () => {
    expect(optional).toMatch(/voluntary: true/);
    expect(optional).toMatch(/policy_required: false/);
    expect(optional).toMatch(/scope_decision_id/);
    expect(optional).toMatch(/requested_by: userId/);
  });

  it("records who asked BEFORE the run, so no check can exist without it", () => {
    const stamp = optional.indexOf("voluntary_run_at: nowIso");
    const run = optional.indexOf("runScreeningInline");
    expect(stamp).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(run);
  });

  it("16. an unavailable provider refuses the run and blocks nothing", () => {
    expect(optional).toMatch(/provider_unavailable_for_optional_run/);
    expect(optional).toMatch(/nothing is blocked/i);
    // 200, not an error: the case is not in a bad state.
    expect(optional).toMatch(/scope_required: false,\s*\n\s*subject,\s*\n\s*\}, 200\)/);
    // and it must not mark the subject failed.
    const refusal = optional.slice(optional.indexOf("if (!optReady)"), optional.indexOf("const nowIso"));
    expect(refusal).not.toMatch(/error_category/);
    expect(refusal).not.toMatch(/state: 'error'/);
  });
});

describe("3. an exempt case queues no screening work automatically", () => {
  it("auto-execution requires the sanctions scope", () => {
    expect(casesFn).toContain(
      "const providerReadyForAuto = providerReady && scope.sanctions.required;");
  });

  it("the stalled-subject converger does not fire for an exempt scope", () => {
    expect(casesFn).toContain(
      "if (canWrite && scope.sanctions.required && !providerReadyForAuto)");
  });
});

describe("25, 3-4. reconciling a subject with the scope, behaviourally", () => {
  const sub = (state: string, extra: Record<string, unknown> = {}) =>
    ({ state, required: true, ...extra });

  it("a possible match stays required when sanctions is stood down", () => {
    const r = reconcileSubjectToScope(sub("possible_match"), false);
    expect(r.action).toBe("keep_finding");
    expect(r.patch).toBeNull();
  });

  it("a confirmed match stays required too", () => {
    expect(reconcileSubjectToScope(sub("confirmed_match"), false).action)
      .toBe("keep_finding");
  });

  it("a completed check keeps its state and loses only the obligation", () => {
    const r = reconcileSubjectToScope(sub("completed"), false);
    expect(r.action).toBe("release");
    expect(r.patch).toEqual({ required: false });
    expect(r.patch).not.toHaveProperty("state");
    expect(r.retireQueued).toBe(false);
  });

  it("a false positive is treated the same way", () => {
    expect(reconcileSubjectToScope(sub("false_positive"), false).patch)
      .toEqual({ required: false });
  });

  it("an unscreened subject becomes not_required and its queue is retired", () => {
    const r = reconcileSubjectToScope(sub("not_started"), false);
    expect(r.action).toBe("release");
    expect(r.patch).toEqual({
      required: false, state: "not_required", error_category: null,
    });
    expect(r.retireQueued).toBe(true);
  });

  it("an errored subject is released rather than left showing a fault", () => {
    const r = reconcileSubjectToScope(sub("error"), false);
    expect(r.patch?.state).toBe("not_required");
    expect(r.patch?.error_category).toBeNull();
    expect(r.retireQueued).toBe(true);
  });

  it("a stale queued request is retired — no job survives the exemption", () => {
    const r = reconcileSubjectToScope(sub("queued"), false);
    expect(r.retireQueued).toBe(true);
    expect(r.patch?.state).toBe("not_required");
  });

  it("an in-flight VOLUNTARY run is left alone", () => {
    for (const state of ["queued", "processing"]) {
      const r = reconcileSubjectToScope(
        sub(state, { required: false, voluntaryRunAt: "2026-08-18T00:00:00Z" }), false);
      expect(r.action).toBe("keep_in_flight");
      expect(r.patch).toBeNull();
      expect(r.retireQueued).toBe(false);
    }
  });

  it("11-12. a prior provider_misconfigured failure stops blocking, and survives", () => {
    /*
     * The case this shipped against already had a subject sitting in
     * `error / provider_misconfigured` from the old always-required rule.
     * Once the obligation is stood down that error must not go on holding
     * Stage 5 — and it must not be deleted or relabelled either. The subject
     * moves to `not_required`; the screening_checks row, its matches and the
     * case events that recorded the failure are untouched, because nothing
     * here writes to them.
     */
    const r = reconcileSubjectToScope(
      { state: "error", required: true }, false);
    expect(r.action).toBe("release");
    expect(r.patch).toEqual({
      required: false, state: "not_required", error_category: null,
    });
    // The obligation is gone; the evidence is not this function's to touch.
    expect(r.patch).not.toHaveProperty("screening_check_id");
    // And it is emphatically not a result.
    expect(r.patch?.state).not.toBe("completed");
  });

  it("is idempotent — a settled subject is not rewritten on every read", () => {
    const r = reconcileSubjectToScope(
      { state: "not_required", required: false }, false);
    expect(r.action).toBe("none");
    expect(r.patch).toBeNull();
  });

  it("withdrawing the exemption restores unscreened, never a result", () => {
    const r = reconcileSubjectToScope(
      { state: "not_required", required: false }, true);
    expect(r.action).toBe("restore");
    expect(r.patch).toEqual({ required: true, state: "not_started" });
  });

  it("withdrawing it does not disturb a subject that already has evidence", () => {
    const r = reconcileSubjectToScope(
      { state: "completed", required: false }, true);
    expect(r.patch).toEqual({ required: true, state: "completed" });
  });

  it("no reconciliation ever writes a satisfied screening state", () => {
    // The one thing that would turn "not required" into "screened and clear".
    for (const state of [
      "not_started", "queued", "processing", "error", "completed",
      "false_positive", "possible_match", "confirmed_match", "not_required",
    ]) {
      for (const required of [true, false]) {
        const r = reconcileSubjectToScope({ state, required: true }, required);
        if (r.patch?.state) {
          expect(["not_required", "not_started", state]).toContain(r.patch.state);
          expect(r.patch.state).not.toBe("completed");
        }
      }
    }
  });
});

describe("25b. the applier does what the decision says, and nothing else", () => {
  const helper = casesFn.slice(
    casesFn.indexOf("async function syncScreeningScopeDecision"),
    casesFn.indexOf("async function ensureScreeningSubjects"));

  it("delegates the decision to the pure module", () => {
    expect(helper).toMatch(/reconcileSubjectToScope\(/);
  });

  it("retires the queue before writing the stand-down, scoped to the subject", () => {
    expect(helper).toMatch(/superseded_by_scope_decision/);
    expect(helper).toMatch(/\.eq\('aggregate_id', s\.id\)/);
    const retire = helper.indexOf("superseded_by_scope_decision");
    const write = helper.indexOf("from('party_screening_subjects')\n      .update({ ...decision.patch");
    expect(retire).toBeGreaterThan(-1);
    expect(retire).toBeLessThan(helper.indexOf("...decision.patch"));
  });
});

describe("8-9, 26. the decision is persisted so it can be reconstructed", () => {
  const helper = casesFn.slice(
    casesFn.indexOf("async function syncScreeningScopeDecision"),
    casesFn.indexOf("async function ensureScreeningSubjects"));

  it("writes reason code, reason, policy version and the material inputs", () => {
    expect(helper).toMatch(/reason_code: decided\.reasonCode/);
    expect(helper).toMatch(/reason: decided\.reason/);
    expect(helper).toMatch(/policy_version: scope\.policyVersion/);
    expect(helper).toMatch(/material_inputs: scope\.evidence/);
    expect(helper).toMatch(/decision_source: 'server_policy'/);
    expect(helper).toMatch(/perimeter_id: perimeterId/);
  });

  it("supersedes rather than overwrites, so history survives", () => {
    expect(helper).toMatch(/superseded_at: nowIso/);
    expect(helper).toMatch(/\.insert\(\{/);
  });

  it("the evidence reproduces the exemption from stored inputs", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(d.evidence["case.perimeter"]).toBe("outside_perimeter");
    expect(d.evidence["case.perimeter_reason"]).toBe("enquiry_only");
    expect(d.evidence["case.perimeter_scopes_excluded"]).toBe("sanctions");
    expect(d.policyVersion).toBe(SCREENING_POLICY_VERSION);
  });

  it("the table refuses a state that disagrees with `required`", () => {
    expect(migration).toMatch(/case_screening_scopes_state_agrees/);
    expect(migration).toMatch(/decision_source = 'server_policy'/);
  });

  it("the table refuses an exemption with no reason or no scopes", () => {
    expect(migration).toMatch(/case_screening_perimeter_reason_required/);
    expect(migration).toMatch(/case_screening_perimeter_scopes_required/);
  });

  it("the empty-array check coalesces, because array_length of empty is NULL", () => {
    /*
     * The first version of this constraint was:
     *
     *   CHECK (classification <> 'outside_perimeter'
     *          OR array_length(scopes_excluded, 1) >= 1)
     *
     * `array_length(ARRAY[]::text[], 1)` is NULL, not 0. `NULL >= 1` is NULL,
     * and a CHECK PASSES on NULL — so the constraint accepted the one shape
     * it existed to refuse, while reading as though it worked. Exercising it
     * against the real table found it; the assertion above, which only
     * checks the constraint is NAMED, is true of a constraint that does
     * nothing.
     */
    const fix = read(
      "supabase/migrations/20260920000100_aml_perimeter_empty_scopes_check.sql");
    // Both files QUOTE the broken form in a comment explaining it, so the
    // comments are stripped before the code is judged.
    const code = (sql: string) =>
      sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const sql of [migration, fix]) {
      expect(code(sql)).toMatch(
        /coalesce\(array_length\(scopes_excluded, 1\), 0\) >= 1/i);
      expect(code(sql)).not.toMatch(/[^(]array_length\(scopes_excluded, 1\) >= 1/);
    }
  });
});

describe("the stage survives its migration not being applied yet", () => {
  const helper = casesFn.slice(
    casesFn.indexOf("async function syncScreeningScopeDecision"),
    casesFn.indexOf("async function ensureScreeningSubjects"));

  it("probes the scope table rather than assuming it exists", () => {
    // Migrations are applied by a dispatched workflow while functions deploy
    // on merge, so the two land in either order. This repository has already
    // paid for assuming otherwise: finance-portal-notifications returned 500
    // for three weeks against a migration that was merged and never applied.
    expect(helper).toMatch(/const \{ data: current, error: readError \}/);
    expect(helper).toMatch(/if \(readError\) \{\s*\n\s*return \{ changed: \[\], subjectsChanged: 0, recorded: false \};/);
    expect(helper).toMatch(/if \(insertError\) return \{ changed: \[\], subjectsChanged: 0, recorded: false \};/);
  });

  it("an unreadable table can never look like an exemption", () => {
    // With no perimeter row readable the engine has already concluded
    // sanctions is required, so a missing table degrades to today's
    // behaviour rather than to a stood-down control.
    const readPerimeterFn = casesFn.slice(
      casesFn.indexOf("async function readCasePerimeter"),
      casesFn.indexOf("async function syncScreeningScopeDecision"));
    expect(readPerimeterFn).toMatch(/if \(error\) return null;/);
    expect(deriveScreeningScope({ ...CLEAN_INPUT, perimeter: null }).sanctions.required)
      .toBe(true);
  });

  it("says on the response whether the decision was recorded", () => {
    expect(casesFn).toMatch(/scope_recorded: scopeSync\.recorded/);
  });
});

describe("an undecided perimeter outranks a provider fault", () => {
  /*
   * On an unclassified case sanctions defaults to required — correctly, and
   * fail-closed — so an unready provider read as THE blocker and Stage 5 told
   * the operator to go and fix the sanctions configuration. Wrong order:
   * nobody had yet decided whether this case needs sanctions screening at
   * all, and an administrator restoring a provider for what turns out to be
   * an enquiry has done work nobody needed.
   */
  const base = {
    hasSubmission: true, subjectCount: 1,
    anyUnscreened: true, anyProcessing: false,
    anyPossibleMatch: false, anyConfirmedMatch: false,
    anyMissingPep: true, pepRoute: "manual_review" as const,
  };

  it("unclassified + provider down → classify_perimeter, not fix_provider", () => {
    const a = deriveScreeningNextAction({
      ...base, providerReady: false, perimeterClassified: false,
    });
    expect(a.key).toBe("classify_perimeter");
    expect(a.headline).toMatch(/classify sanctions screening requirement/i);
    expect(a.detail).toMatch(/inside or outside the sanctions screening perimeter/i);
    expect(a.owner).toBe("reviewer");
    expect(a.label).not.toMatch(/open screening configuration/i);
  });

  it("unclassified + an empty DFAT list → classify_perimeter", () => {
    // An unloaded list reaches this as a provider that is not ready, and as
    // `list_data_unavailable` once a subject has failed on it. Both defer.
    for (const errorCategory of [null, "list_data_unavailable"]) {
      expect(deriveScreeningNextAction({
        ...base, providerReady: false, perimeterClassified: false, errorCategory,
      }).key).toBe("classify_perimeter");
    }
  });

  it("unclassified + a provider-fault error category → classify_perimeter", () => {
    for (const errorCategory of ["provider_misconfigured", "provider_not_configured"]) {
      expect(deriveScreeningNextAction({
        ...base, providerReady: true, anyUnscreened: false,
        perimeterClassified: false, errorCategory,
      }).key).toBe("classify_perimeter");
    }
  });

  it("inside perimeter + provider down → fix_provider, exactly as before", () => {
    const a = deriveScreeningNextAction({
      ...base, providerReady: false, perimeterClassified: true,
    });
    expect(a.key).toBe("fix_provider");
    expect(a.label).toMatch(/open screening configuration/i);
  });

  it("outside perimeter with sanctions excluded → no provider blocker at all", () => {
    /*
     * The stage passes `providerReady: providerRelevant ? providerReady : true`,
     * so a case with no provider-backed obligation cannot reach either the
     * classify branch or the fix_provider branch on account of the provider.
     */
    const decision = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: OUTSIDE });
    expect(providerReadinessRelevant(decision)).toBe(false);
    const a = deriveScreeningNextAction({
      ...base, providerReady: true, anyUnscreened: false, perimeterClassified: true,
    });
    expect(a.key).not.toBe("fix_provider");
    expect(a.key).not.toBe("classify_perimeter");
    expect(a.key).toBe("record_pep");
  });

  it("a healthy provider is never interrupted to ask the question", () => {
    // Nothing is blocked, so there is nothing to reprioritise.
    expect(deriveScreeningNextAction({
      ...base, providerReady: true, perimeterClassified: false,
    }).key).not.toBe("classify_perimeter");
  });

  it("a finding still outranks the question", () => {
    // A candidate match is a fact. The perimeter question is not more urgent.
    expect(deriveScreeningNextAction({
      ...base, providerReady: false, perimeterClassified: false, anyPossibleMatch: true,
    }).key).toBe("adjudicate_match");
    expect(deriveScreeningNextAction({
      ...base, providerReady: false, perimeterClassified: false, anyConfirmedMatch: true,
    }).key).toBe("escalate");
  });

  it("an omitted perimeterClassified behaves exactly as before", () => {
    // The step is added by SUPPLYING the fact, never by assuming its absence.
    expect(deriveScreeningNextAction({ ...base, providerReady: false }).key)
      .toBe("fix_provider");
  });

  it("the default policy is untouched — unclassified still requires sanctions", () => {
    const d = deriveScreeningScope({ ...CLEAN_INPUT, perimeter: null });
    expect(d.sanctions.required).toBe(true);
    expect(d.perimeter.classified).toBe(false);
  });
});

describe("classified is a different fact from classification", () => {
  it("an unclassified case and one recorded INSIDE differ", () => {
    const none = readPerimeter(null);
    const inside = readPerimeter({
      classification: "designated_service", superseded_at: null,
      recorded_by_label: "reviewer@npcservices.com.au",
      recorded_at: "2026-08-18T00:00:00.000Z",
    });
    // Same obligation...
    expect(none.classification).toBe("designated_service");
    expect(inside.classification).toBe("designated_service");
    // ...different operator situation.
    expect(none.classified).toBe(false);
    expect(inside.classified).toBe(true);
    expect(inside.recordedByLabel).toBe("reviewer@npcservices.com.au");
  });

  it("a malformed or superseded row counts as undecided", () => {
    // Still fail-closed on the requirement; the operator is asked to decide
    // rather than told a decision exists that cannot be read.
    for (const row of [
      { ...OUTSIDE, reason_code: "low_risk" },
      { ...OUTSIDE, scopes_excluded: [] },
      { ...OUTSIDE, superseded_at: "2026-08-18T01:00:00.000Z" },
      "outside_perimeter",
    ]) {
      const r = readPerimeter(row);
      expect(r.classified).toBe(false);
      expect(r.classification).toBe("designated_service");
    }
  });

  it("an outside finding is classified", () => {
    expect(readPerimeter(OUTSIDE).classified).toBe(true);
  });
});

describe("there is one rule, not two", () => {
  it("decideScreeningPolicy is an adapter over the scope engine", () => {
    // It used to hold the rule itself, with sanctions hardcoded into
    // `required`. Two copies of one rule is how they drift.
    const fn = policyFn.slice(
      policyFn.indexOf("export function decideScreeningPolicy"),
      policyFn.indexOf("/* ─────────────────────────── Enrolment"));
    expect(fn).toMatch(/deriveScreeningScope\(input as ScreeningScopeInput\)/);
    expect(fn).not.toMatch(/required: ScreeningScopeKey\[\] = \["sanctions", "pep"\]/);
  });

  it("the legacy shape still requires sanctions with no perimeter", () => {
    expect(decideScreeningPolicy(CLEAN_INPUT).required).toContain("sanctions");
    expect(decideScreeningPolicy(CLEAN_INPUT).required).toContain("pep");
  });

  it("27. the API publishes the same decision the UI renders", () => {
    const sync = casesFn.slice(casesFn.indexOf("case 'sync_screening_stage'"));
    expect(sync).toMatch(/scopes: ALL_SCREENING_SCOPES\.map/);
    expect(sync).toMatch(/reason_code: scope\[k\]\.reasonCode/);
    expect(sync).toMatch(/provider_relevant: providerRelevant/);
    /*
     * The card now renders the rows `buildDeterminationRows` arranges, and
     * that module reads `sync.scopes` — the SERVER's per-scope decision —
     * rather than deriving one. Same guarantee, one indirection: the
     * assertion follows the code to where the reading happens.
     */
    const rows = read("src/lib/aml/screeningResolution.pure.ts");
    expect(rows).toMatch(/\(sync\.scopes \?\? \[\]\)\.map/);
    expect(rows).toMatch(/not required/);
    // And the browser still reaches no conclusion of its own about what is
    // owed: the obligation comes from `sc.required` and nothing else.
    expect(rows).toMatch(/sc\.required \? "required" : "not_required"/);
    const card = read("src/components/aml/ScreeningStageCard.tsx");
    expect(card).toMatch(/buildDeterminationRows\(/);
  });
});
