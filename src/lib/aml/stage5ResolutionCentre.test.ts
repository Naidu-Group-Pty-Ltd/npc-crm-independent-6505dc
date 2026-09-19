import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveScreeningNextAction,
} from "../../../supabase/functions/_shared/aml/screeningPolicy.pure.ts";
import {
  buildDeterminationRows, deriveStageHeadline,
} from "./screeningResolution.pure";
import {
  perimeterIsClassified, resolveClosedCaseAction, resolveScreeningNextAction,
} from "./screeningNextAction";
import { canPerformScreeningAction } from "./screeningActionAccess";

/**
 * Stage 5 as one operator workflow.
 *
 * ── The reported screen, and what it actually was ─────────────────────
 * A case showing "Case stage: Closed", "Service gate: Terminated",
 * "Passport: Revoked" — and, beside them, an Advance status card offering
 * Cleared, on a Stage 5 that looked like live onboarding.
 *
 * Traced to the production row (`AML-2026-00005`): `case_stage = 'closed'`
 * with `status = 'kyc_complete'`. Both surfaces were reading their own
 * dimension correctly and the DATA disagreed with itself. `reopen_case` had
 * run, moved the legacy `status`, and left the canonical `case_stage` and
 * `closed_at` where they were — while `transition`, the other write that
 * changes `status`, has always kept all three coherent.
 *
 * So these tests hold three lines at once: the write keeps the dimensions
 * together, the UI refuses to advance a case either dimension calls closed,
 * and the stage says which question each number answers.
 *
 * ── And the second dead end ───────────────────────────────────────────
 * "Provider unavailable" with nothing to press. Two lawful routes exist and
 * an MLRO could always have taken one of them; the stage offered neither by
 * name. Both are decided server-side now, so nobody is left holding a status.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const casesFn = read("supabase/functions/aml-cases/index.ts");
const policyFn = read("supabase/functions/_shared/aml/screeningPolicy.pure.ts");
const rowsSrc = read("src/lib/aml/screeningResolution.pure.ts");
const cardSrc = read("src/components/aml/ScreeningStageCard.tsx");
const panelSrc = read("src/components/aml/workspace/AmlContextActionPanel.tsx");
const partySrc = read("src/components/aml/PartyScreeningPanel.tsx");

/** Judge code, never comments. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

const BASE = {
  hasSubmission: true,
  subjectCount: 1,
  providerReady: true,
  anyUnscreened: false,
  anyProcessing: false,
  anyPossibleMatch: false,
  anyConfirmedMatch: false,
  anyMissingPep: false,
  pepRoute: "declaration_supported" as const,
  perimeterClassified: true,
};

const scopeRow = (scope: string, required: boolean, reason = "") =>
  ({ scope, required, optional: !required, state: required ? "required" : "not_required",
     reason_code: required ? "tfs_obligation" : "perimeter:enquiry_only", reason } as never);

const subject = (over: Record<string, unknown> = {}) => ({
  id: "s1", name: "Rugesh Naidu", partyType: "customer", required: true,
  state: "not_started",
  sanctions: { state: "not_started", resolved: false, detail: "" },
  pep: { resolved: false, detail: "" },
  ...over,
} as never);

const syncOf = (scopes: unknown[]) => ({ scopes } as never);

/* ── SCENARIO A — the reported case ───────────────────────────────────── */

describe("Scenario A — a closed, enquiry-only case", () => {
  const closedInput = {
    ...BASE, caseClosed: true, anyMissingPep: true,
    providerReady: false, anyUnscreened: false,
  };

  it("leads with reopening, not with screening or PEP work", () => {
    const a = deriveScreeningNextAction(closedInput);
    expect(a.key).toBe("reopen_case");
    expect(a.label).toMatch(/reopen case to resume/i);
    expect(a.owner).toBe("reviewer");
  });

  it("says the record is retained and the journey is not progressing", () => {
    const a = deriveScreeningNextAction(closedInput);
    expect(a.detail).toMatch(/retained for compliance/i);
    expect(a.detail).toMatch(/never approves the service/i);
    expect(a.detail).toMatch(/terminated gate|revoked passport/i);
  });

  it("reads as CASE CLOSED at the top of the stage, not as action required", () => {
    const a = deriveScreeningNextAction(closedInput);
    expect(deriveStageHeadline({ caseClosed: true, action: a as never })).toBe("case_closed");
  });

  it("offers no ordinary advance-status control, on any stage", () => {
    /* The rail's "Advance status" card is gone everywhere. It read the
       CANONICAL lifecycle as well as the legacy one, because the two can
       disagree — and the closed reading is still made on both dimensions,
       since a retained record must never be presented as a case in
       progress. */
    const code = strip(panelSrc);
    expect(code).toMatch(
      /caseStage\(caseRow\) === "closed" \|\| caseRow\.status === "closed"/);
    expect(code).not.toMatch(/nextOptions/);
    expect(code).not.toContain("Advance status");
  });

  it("offers reopening as its own reason-bearing action, never a transition", () => {
    const code = strip(panelSrc);
    // The reopen control calls a passed-in handler; it never reaches the
    // status-transition call itself.
    expect(code).toMatch(/onReopen/);
    expect(code).not.toMatch(/transition\(\s*["']closed/);
  });

  it("still says sanctions is not required WITHOUT saying anybody was cleared", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([
        scopeRow("sanctions", false, "An enquiry. The customer relationship was never entered into."),
        scopeRow("pep", true),
      ]),
      position: { subjects: [subject()], facts: {}, read: true } as never,
      providerReady: false, providerRelevant: true,
    });
    const sanctions = rows.find((r) => r.scope === "sanctions")!;
    expect(sanctions.obligation).toBe("not_required");
    expect(sanctions.outcome).toBe("not_applicable");
    expect(sanctions.outcomeDetail).toMatch(/nobody was screened/i);
    expect(sanctions.outcomeDetail).toMatch(/policy decision, not a screening result/i);
    expect(sanctions.blocking).toBe(false);
  });

  it("keeps PEP outstanding and blocking, independently", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([scopeRow("sanctions", false), scopeRow("pep", true)]),
      position: { subjects: [subject()], facts: {}, read: true } as never,
      providerReady: false, providerRelevant: true,
    });
    const pep = rows.find((r) => r.scope === "pep")!;
    expect(pep.obligation).toBe("required");
    expect(pep.method).toBe("determination");
    expect(pep.outcome).toBe("not_started");
    expect(pep.blocking).toBe(true);
  });
});

/* ── SCENARIO B — reopened, then reclassified ─────────────────────────── */

describe("Scenario B — reopening resumes work and approves nothing", () => {
  const reopen = casesFn.slice(
    casesFn.indexOf("case 'reopen_case'"), casesFn.indexOf("case 'reset_client_journey'"));

  it("syncs the CANONICAL lifecycle dimension, which is the reported defect", () => {
    expect(strip(reopen)).toMatch(/case_stage: STATUS_TO_STAGE\[resumeStatus\]/);
  });

  it("clears closed_at, so nothing reads the date and concludes closed", () => {
    expect(strip(reopen)).toMatch(/closed_at: null/);
  });

  it("does NOT restore the service gate", () => {
    const code = strip(reopen);
    expect(code).not.toMatch(/service_gate_status:\s*STATUS_TO_SERVICE_GATE/);
    expect(code).not.toMatch(/service_gate_status:\s*['"]approved/);
  });

  it("does NOT mint, restore or touch a passport", () => {
    expect(strip(reopen)).not.toMatch(/passport/i);
  });

  it("does not mark any screening complete", () => {
    const code = strip(reopen);
    // It READS `last_screened_at` to decide what to re-ask for; it must never
    // WRITE one, which would date a screening nobody performed.
    expect(code).not.toMatch(/last_screened_at:/);
    expect(code).not.toMatch(/refresh_due_at/);
    expect(code).not.toMatch(/state:\s*['"]completed/);
    expect(code).not.toMatch(/party_screening_subjects'\)\s*\n?\s*\.update/);
  });

  it("does not reclassify the perimeter for the operator", () => {
    expect(strip(reopen)).not.toMatch(/case_screening_perimeter|classification:/);
  });

  it("a reopened case that is inside the perimeter puts sanctions back on", () => {
    // Nothing is inferred: the perimeter is re-recorded by a person, and the
    // scope engine follows it. This asserts the stage moves when it does.
    const a = deriveScreeningNextAction({
      ...BASE, caseClosed: false, anyUnscreened: true, providerReady: true,
    });
    expect(a.key).toBe("run_screening");
  });
});

/* ── SCENARIO C — automated screening healthy ─────────────────────────── */

describe("Scenario C — the provider is healthy", () => {
  it("makes automated screening the primary route", () => {
    const a = deriveScreeningNextAction({ ...BASE, anyUnscreened: true });
    expect(a.key).toBe("run_screening");
    expect(a.alternative ?? null).toBeNull();
  });

  it("reports the method as automated on the sanctions row", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([scopeRow("sanctions", true)]),
      position: { subjects: [subject()], facts: {}, read: true } as never,
      providerReady: true, providerRelevant: true,
    });
    expect(rows[0].method).toBe("automated");
  });
});

/* ── SCENARIO D — the provider is unavailable ─────────────────────────── */

describe("Scenario D — no dead end when automation cannot run", () => {
  const blocked = { ...BASE, providerReady: false, anyUnscreened: true, manualAvailable: true };

  it("gives the MLRO a route that completes the obligation", () => {
    const a = deriveScreeningNextAction(blocked);
    expect(a.key).toBe("complete_manually");
    expect(a.owner).toBe("reviewer");
    expect(a.label).toMatch(/manually/i);
  });

  it("keeps the broken automation named and owned as the alternative", () => {
    const a = deriveScreeningNextAction(blocked);
    expect(a.alternative?.key).toBe("fix_provider");
    expect(a.alternative?.owner).toBe("administrator");
  });

  it("says recording it manually discharges the obligation and never removes it", () => {
    const a = deriveScreeningNextAction(blocked);
    expect(a.detail).toMatch(/discharges the obligation; it never removes it/i);
  });

  it("falls back to the administrator's route when no manual route exists", () => {
    const a = deriveScreeningNextAction({ ...blocked, manualAvailable: false });
    expect(a.key).toBe("fix_provider");
    expect(a.alternative ?? null).toBeNull();
  });

  it("does the same for a CONVERGED technical failure, not just an unready provider", () => {
    const a = deriveScreeningNextAction({
      ...BASE, anyUnscreened: true, manualAvailable: true,
      errorCategory: "list_data_unavailable",
    });
    expect(a.key).toBe("complete_manually");
    expect(a.alternative?.key).toBe("fix_provider");
    // The technical cause is still stated, not papered over.
    expect(a.detail).toMatch(/sanctions list/i);
  });

  it("reports the METHOD as unavailable without touching the obligation", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([scopeRow("sanctions", true)]),
      position: { subjects: [subject()], facts: {}, read: true } as never,
      providerReady: false, providerRelevant: true,
    });
    expect(rows[0].obligation).toBe("required");
    expect(rows[0].method).toBe("automated_unavailable");
    expect(rows[0].outcome).toBe("not_started");
    expect(rows[0].methodDetail).toMatch(/MLRO may complete/i);
  });

  it("only the MLRO may take the manual route; a reviewer may not", () => {
    expect(canPerformScreeningAction("complete_manually",
      { canWrite: true, isReviewer: true, isMlro: false })).toBe(false);
    expect(canPerformScreeningAction("complete_manually",
      { canWrite: true, isReviewer: false, isMlro: true })).toBe(true);
  });
});

/* ── SCENARIOS E–G, J — outcomes reach the right place ────────────────── */

describe("Scenarios E-G — what a manual outcome does to the stage", () => {
  const rowsFor = (state: string) => buildDeterminationRows({
    sync: syncOf([scopeRow("sanctions", true)]),
    position: {
      subjects: [subject({ sanctions: { state, resolved: false, detail: "" } })],
      facts: {}, read: true,
    } as never,
    providerReady: false, providerRelevant: true,
  });

  it("E. a no-match settles the sanctions row and stops blocking", () => {
    const r = rowsFor("clear")[0];
    expect(r.outcome).toBe("no_match");
    expect(r.blocking).toBe(false);
  });

  it("F. a possible match holds the stage open for adjudication", () => {
    const r = rowsFor("possible_match")[0];
    expect(r.outcome).toBe("possible_match");
    expect(r.blocking).toBe(true);
    const a = deriveScreeningNextAction({ ...BASE, anyPossibleMatch: true });
    expect(a.key).toBe("adjudicate_match");
  });

  it("G. a confirmed match escalates, and outranks even a closed case", () => {
    const r = rowsFor("confirmed_match")[0];
    expect(r.outcome).toBe("confirmed_match");
    expect(r.blocking).toBe(true);
    const a = deriveScreeningNextAction({
      ...BASE, anyConfirmedMatch: true, caseClosed: true,
    });
    expect(a.key).toBe("escalate");
    expect(deriveStageHeadline({ caseClosed: true, action: a as never })).toBe("escalated");
  });

  it("a technical failure holds it open and never reads as clear", () => {
    const r = rowsFor("error")[0];
    expect(r.outcome).toBe("unable_to_complete");
    expect(r.blocking).toBe(true);
    expect(r.outcomeDetail).toMatch(/never a clear result/i);
  });

  it("J. an optional scope never blocks, whatever was voluntarily found", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([scopeRow("sanctions", false, "Enquiry only.")]),
      position: {
        subjects: [subject({ sanctions: { state: "clear", resolved: true, detail: "" } })],
        facts: {}, read: true,
      } as never,
      providerReady: false, providerRelevant: true,
    });
    expect(rows[0].blocking).toBe(false);
    // And a voluntary clear is still never reported as the obligation.
    expect(rows[0].obligation).toBe("not_required");
  });
});

/* ── SCENARIOS H-I — PEP stays a separate determination ───────────────── */

describe("Scenarios H-I — PEP is its own record", () => {
  it("is established by a recorded determination, never by a screening run", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([scopeRow("pep", true)]),
      position: { subjects: [subject()], facts: {}, read: true } as never,
      providerReady: true, providerRelevant: true,
    });
    expect(rows[0].method).toBe("determination");
    expect(rows[0].methodDetail).toMatch(/never the determination itself/i);
  });

  it("says a client declaration is evidence and not the conclusion", () => {
    expect(rowsSrc).toMatch(/declaration is evidence that supports it/i);
  });

  it("settles only when every party in scope has one", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([scopeRow("pep", true)]),
      position: {
        subjects: [
          subject({ pep: { resolved: true, detail: "" } }),
          subject({ id: "s2", pep: { resolved: false, detail: "" } }),
        ],
        facts: {}, read: true,
      } as never,
      providerReady: true, providerRelevant: true,
    });
    expect(rows[0].blocking).toBe(true);
  });

  it("a settled sanctions row does not settle PEP", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([scopeRow("sanctions", true), scopeRow("pep", true)]),
      position: {
        subjects: [subject({ sanctions: { state: "clear", resolved: true, detail: "" } })],
        facts: {}, read: true,
      } as never,
      providerReady: true, providerRelevant: true,
    });
    expect(rows.find((r) => r.scope === "sanctions")!.blocking).toBe(false);
    expect(rows.find((r) => r.scope === "pep")!.blocking).toBe(true);
  });

  it("the PEP row never reaches for the sanctions vocabulary", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([scopeRow("pep", true)]),
      position: { subjects: [subject()], facts: {}, read: true } as never,
      providerReady: true, providerRelevant: true,
    });
    expect(["no_match", "possible_match", "confirmed_match"]).not.toContain(rows[0].outcome);
  });
});

/* ── §12 — obligation, method and outcome never collapse ──────────────── */

describe("obligation is not method is not outcome", () => {
  const unionMembers = (name: string) => {
    const decl = strip(rowsSrc).split(`export type ${name} =`)[1]?.split(";")[0] ?? "";
    return (decl.match(/"[a-z_]+"/g) ?? []).map((m) => m.slice(1, -1));
  };

  it("`not required` is an obligation and is not in the outcome vocabulary", () => {
    expect(unionMembers("ObligationReading")).toContain("not_required");
    expect(unionMembers("OutcomeReading")).not.toContain("not_required");
  });

  it("`no match` is an outcome and is not in the obligation vocabulary", () => {
    expect(unionMembers("OutcomeReading")).toContain("no_match");
    expect(unionMembers("ObligationReading")).not.toContain("no_match");
  });

  it("the two vocabularies share no value at all", () => {
    const overlap = unionMembers("ObligationReading")
      .filter((v) => unionMembers("OutcomeReading").includes(v));
    expect(overlap).toEqual([]);
  });

  it("an unread obligation reads as not established, never as not required", () => {
    expect(strip(rowsSrc)).toMatch(/unknown: "Not established"/);
  });

  it("every row publishes all three separately", () => {
    const rows = buildDeterminationRows({
      sync: syncOf([scopeRow("sanctions", true), scopeRow("pep", true)]),
      position: { subjects: [subject()], facts: {}, read: true } as never,
      providerReady: false, providerRelevant: true,
    });
    for (const r of rows) {
      expect(r.obligation).toBeTruthy();
      expect(r.method).toBeTruthy();
      expect(r.outcome).toBeTruthy();
      expect(r.obligationDetail).toBeTruthy();
      expect(r.methodDetail).toBeTruthy();
      expect(r.outcomeDetail).toBeTruthy();
    }
  });

  it("the card renders all three labels rather than one badge", () => {
    expect(cardSrc).toMatch(/OBLIGATION_LABEL\[row\.obligation\]/);
    expect(cardSrc).toMatch(/METHOD_LABEL\[row\.method\]/);
    expect(cardSrc).toMatch(/OUTCOME_LABEL\[row\.outcome\]/);
  });

  it("status is never carried by colour alone — every badge has a label", () => {
    expect(cardSrc).toMatch(/<dt className="font-medium text-foreground\/80">Obligation<\/dt>/);
    expect(cardSrc).toMatch(/Method<\/dt>/);
    expect(cardSrc).toMatch(/Outcome<\/dt>/);
  });
});

/* ── §45 — cross-component contracts ──────────────────────────────────── */

describe("the browser decides no legal scope and satisfies no screening", () => {
  it("the stage card reads the server's scopes and derives none", () => {
    const code = strip(cardSrc);
    expect(code).toMatch(/buildDeterminationRows\(/);
    expect(code).not.toMatch(/deriveScreeningScope\(/);
    expect(code).not.toMatch(/riskRating/);
  });

  it("the row builder takes the obligation from the server and nowhere else", () => {
    const code = strip(rowsSrc);
    expect(code).toMatch(/sc\.required \? "required" : "not_required"/);
    expect(code).not.toMatch(/riskRating|enhancedDueDiligence|perimeter\s*=/);
  });

  it("no React file marks a screening satisfied", () => {
    for (const src of [cardSrc, partySrc, rowsSrc]) {
      const code = strip(src);
      expect(code).not.toMatch(/satisfies_obligation\s*[:=]\s*true/);
      expect(code).not.toMatch(/last_screened_at\s*[:=]/);
      expect(code).not.toMatch(/refresh_due_at\s*[:=]/);
      // Nor decide an obligation: the scope and perimeter records are the
      // server's, and no browser file writes to either.
      expect(code).not.toMatch(/case_screening_scopes|case_screening_perimeter/);
      expect(code).not.toMatch(/policy_required\s*[:=]/);
    }
  });

  it("the party panel derives admissibility from the shared module", () => {
    expect(strip(partySrc)).toMatch(/manualScreeningAdmissible/);
  });

  it("PEP stays on its own record and manual screening on screening_checks", () => {
    const manual = strip(casesFn.slice(
      casesFn.indexOf("case 'record_manual_screening'"),
      casesFn.indexOf("case 'queue_party_screening'")));
    expect(manual).toMatch(/from\('screening_checks'\)/);
    // It may NAME the PEP route in a refusal message; it must never write to
    // that table, which would give "is this party a PEP" two answers.
    expect(manual).not.toMatch(/from\('pep_determinations'\)/);
  });

  it("introduces no second screening, determination or policy store", () => {
    const code = strip(casesFn);
    for (const forbidden of [
      "manual_screening_results", "manual_screening_checks",
      "pep_determinations_v2", "screening_results_v2",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("adds no stored stage-5 completion column", () => {
    expect(strip(casesFn)).not.toMatch(/stage_5_complete|stage5_complete/);
    expect(strip(rowsSrc)).not.toMatch(/stage_5_complete/);
  });
});

/* ── The closed-case override, held on both sides ─────────────────────── */

describe("the closed-case reading survives a stale deployment", () => {
  const action = (key: string) =>
    ({ key, label: "x", headline: "h", detail: "d", owner: "analyst" } as never);

  it("rewrites an ordinary next step into a reopen", () => {
    const a = resolveClosedCaseAction(action("run_screening"), true);
    expect(a?.key).toBe("reopen_case");
  });

  it("leaves an open case exactly as the server sent it", () => {
    const a = resolveClosedCaseAction(action("run_screening"), false);
    expect(a?.key).toBe("run_screening");
  });

  it("never overrides a finding", () => {
    for (const key of ["adjudicate_match", "escalate"]) {
      expect(resolveClosedCaseAction(action(key), true)?.key).toBe(key);
    }
  });

  it("runs lifecycle-first, ahead of the perimeter override", () => {
    // A closed, unclassified case is not asked to classify a perimeter it may
    // never need — it is asked whether the engagement is resuming at all.
    const a = resolveScreeningNextAction(action("fix_provider"), null, true);
    expect(a?.key).toBe("reopen_case");
    // ...and with the case open, the perimeter question returns.
    expect(resolveScreeningNextAction(action("fix_provider"), null, false)?.key)
      .toBe("classify_perimeter");
  });

  it("still fails closed on an unreadable perimeter", () => {
    expect(perimeterIsClassified(null)).toBe(false);
    expect(perimeterIsClassified({ classification: "designated_service" } as never)).toBe(false);
  });

  it("only a reviewer or the MLRO may reopen", () => {
    expect(canPerformScreeningAction("reopen_case",
      { canWrite: true, isReviewer: false, isMlro: false })).toBe(false);
    expect(canPerformScreeningAction("reopen_case",
      { canWrite: true, isReviewer: true, isMlro: false })).toBe(true);
  });
});

/* ── Stage completion, and what it is not ─────────────────────────────── */

describe("stage completion is evidence completion", () => {
  it("says so rather than reading as an approval", () => {
    const a = deriveScreeningNextAction(BASE);
    expect(a.key).toBe("none");
    expect(a.detail).toMatch(/not a service-gate decision/i);
    expect(a.detail).not.toMatch(/AML clear|AML approved|client compliant/i);
  });

  it("an optional scope does not hold the stage open", () => {
    const a = deriveScreeningNextAction({
      ...BASE, providerReady: false, anyUnscreened: false,
    });
    expect(a.key).toBe("none");
  });

  it("the engine still fails closed on an unclassified, blocked case", () => {
    const a = deriveScreeningNextAction({
      ...BASE, perimeterClassified: false, providerReady: false, anyUnscreened: true,
    });
    expect(a.key).toBe("classify_perimeter");
  });

  it("nothing in the policy module can spell an approval", () => {
    expect(strip(policyFn)).not.toMatch(/service_gate_status|approve_service/);
  });
});
