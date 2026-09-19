import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planCaseReopen } from "../../../supabase/functions/_shared/aml/caseReopen.pure.ts";
import { buildDeterminationRows } from "./screeningResolution.pure";

/**
 * Four defects found by working the reported case through to completion.
 *
 * The screen said the right things and then could not act on any of them.
 *
 *   1  "Reopen case to resume AML/CTF" returned "AML-2026-00005 is not
 *      closed, so there is nothing to reopen." The UI read the canonical
 *      dimension and the server checked the legacy one, so the ONE action
 *      offered was the one action that could not run. A case stuck in the
 *      divergence could never leave it.
 *
 *   2  The PEP row read "Not a PEP · Recorded for every party in scope" on a
 *      case with ZERO `pep_determinations` rows. `.some()` over an empty
 *      array is `false`, and the array was empty because it was filtered by
 *      the SANCTIONS obligation. A determination nobody made, rendered as
 *      one that was — the worst failure mode this product has.
 *
 *   3  The journey said "Screening has not been run" on a case whose every
 *      party's screening obligation had been stood down. Not owed is not the
 *      same as not done, and both statements sat on one page.
 *
 *   4  Nothing named the PEP determination, which was the only outstanding
 *      item on the case, so the rail could not say what to do.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const journeySrc = read("src/lib/aml/journeyModel.ts");
const summarySrc = read("src/lib/aml/workspaceViewModel.ts");
const cardSrc = read("src/components/aml/ScreeningStageCard.tsx");
const casesFn = read("supabase/functions/aml-cases/index.ts");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

/* ── 1. The reopen that could not run ─────────────────────────────────── */

describe("a case closed on either dimension can be reopened", () => {
  const facts = (over: Record<string, unknown> = {}) => ({
    caseId: "c1", caseReference: "AML-2026-00005",
    status: "kyc_complete", caseStage: "closed",
    serviceGateStatus: "terminated",
    consents: [], currentConsentVersions: {}, hasPortalUser: true,
    screening: [], roles: ["mlro"],
    reason: "The client has confirmed they are proceeding with the purchase.",
    ...over,
  } as never);

  it("reopens the EXACT production state that was refused", () => {
    // status kyc_complete, case_stage closed — the row behind the toast.
    const plan = planCaseReopen(facts());
    expect(plan.allowed).toBe(true);
    expect(plan.code).toBe("ok");
  });

  it("still reopens a case closed only on the legacy dimension", () => {
    const plan = planCaseReopen(facts({ status: "closed", caseStage: "client_submitted" }));
    expect(plan.allowed).toBe(true);
  });

  it("still reopens when the canonical dimension is not supplied at all", () => {
    const plan = planCaseReopen(facts({ status: "closed", caseStage: undefined }));
    expect(plan.allowed).toBe(true);
  });

  it("still refuses a case that is open on BOTH dimensions", () => {
    const plan = planCaseReopen(facts({ status: "kyc_complete", caseStage: "client_submitted" }));
    expect(plan.allowed).toBe(false);
    expect(plan.code).toBe("not_closed");
  });

  it("an absent canonical dimension is never read as closed", () => {
    const plan = planCaseReopen(facts({ status: "under_review", caseStage: null }));
    expect(plan.allowed).toBe(false);
  });

  it("keeps every other refusal exactly as it was", () => {
    expect(planCaseReopen(facts({ roles: ["analyst"] })).code).toBe("role_required");
    expect(planCaseReopen(facts({ reason: "oops" })).code).toBe("reason_required");
    expect(planCaseReopen(facts({ reason: null })).code).toBe("reason_required");
  });

  it("still restores no decision: the gate and the passport are untouched", () => {
    const plan = planCaseReopen(facts());
    // `notRestored` NAMES them — that is the point of it — so the assertion
    // is that they are named there and nowhere that grants anything.
    expect(plan.notRestored.join(" ")).toMatch(/gate stays terminated/i);
    expect(plan.notRestored.join(" ")).toMatch(/passport stays as it is/i);
    expect(plan.reissue.join(" ")).not.toMatch(/gate|passport|service/i);
  });

  it("the operation passes the canonical dimension in", () => {
    const op = casesFn.slice(
      casesFn.indexOf("case 'reopen_case'"), casesFn.indexOf("case 'reset_client_journey'"));
    expect(strip(op)).toMatch(/caseStage: caseRow\.case_stage/);
    expect(strip(op)).toMatch(/case_stage, service_gate_status/);
  });
});

/* ── 2. The determination nobody made ─────────────────────────────────── */

describe("a PEP determination is never satisfied vacuously", () => {
  const scope = (s: string, required: boolean) =>
    ({ scope: s, required, optional: !required,
       state: required ? "required" : "not_required",
       reason_code: "x", reason: "y" } as never);
  const sync = (scopes: unknown[]) => ({ scopes } as never);
  const party = (over: Record<string, unknown> = {}) => ({
    id: "s1", name: "Rugesh Naidu", partyType: "primary_subject", required: false,
    state: "not_required",
    sanctions: { state: "not_started", resolved: false, detail: "" },
    pep: { resolved: false, detail: "" },
    ...over,
  } as never);

  it("the EXACT reported case: PEP required, sanctions stood down, no determination", () => {
    // One subject, `required: false` because the perimeter stood sanctions
    // down. The PEP row used to be computed over the sanctions-required set,
    // find it empty, and report the determination as recorded.
    const rows = buildDeterminationRows({
      sync: sync([scope("sanctions", false), scope("pep", true)]),
      position: { subjects: [party()], facts: {}, read: true } as never,
      providerReady: false, providerRelevant: true,
    });
    const pep = rows.find((r) => r.scope === "pep")!;
    expect(pep.outcome).toBe("not_started");
    expect(pep.outcomeDetail).not.toMatch(/recorded for every party/i);
    expect(pep.blocking).toBe(true);
  });

  it("counts every ENROLLED party, not the screening-required ones", () => {
    const rows = buildDeterminationRows({
      sync: sync([scope("pep", true)]),
      position: {
        subjects: [party({ required: false, pep: { resolved: true, detail: "" } })],
        facts: {}, read: true,
      } as never,
      providerReady: true, providerRelevant: true,
    });
    // A determination on a party whose sanctions obligation was stood down
    // still counts — it is a different obligation.
    expect(rows[0].blocking).toBe(false);
    expect(rows[0].outcome).toBe("not_a_pep");
  });

  it("nobody enrolled is outstanding, never satisfied", () => {
    const rows = buildDeterminationRows({
      sync: sync([scope("pep", true)]),
      position: { subjects: [], facts: {}, read: false } as never,
      providerReady: true, providerRelevant: true,
    });
    expect(rows[0].outcome).toBe("not_started");
    expect(rows[0].blocking).toBe(true);
    expect(rows[0].outcomeDetail).toMatch(/outstanding, not satisfied/i);
  });

  it("a required SCREENING with nobody enrolled is not settled either", () => {
    const rows = buildDeterminationRows({
      sync: sync([scope("sanctions", true)]),
      position: { subjects: [], facts: {}, read: false } as never,
      providerReady: true, providerRelevant: true,
    });
    expect(rows[0].blocking).toBe(true);
    expect(rows[0].outcome).toBe("not_started");
  });

  it("one determined party and one not is still outstanding", () => {
    const rows = buildDeterminationRows({
      sync: sync([scope("pep", true)]),
      position: {
        subjects: [
          party({ pep: { resolved: true, detail: "" } }),
          party({ id: "s2", pep: { resolved: false, detail: "" } }),
        ],
        facts: {}, read: true,
      } as never,
      providerReady: true, providerRelevant: true,
    });
    expect(rows[0].blocking).toBe(true);
  });
});

/* ── 3 & 4. Not owed is not not-done, and the real work is named ──────── */

describe("the journey distinguishes no obligation from no work done", () => {
  it("reports a fully stood-down scope as settled, not as unrun", () => {
    const code = strip(journeySrc);
    expect(code).toMatch(/subjects\.length === 0 && enrolled\.length > 0/);
    expect(code).toMatch(/No screening is required for this case/);
  });

  it("says it is a policy decision rather than a result", () => {
    expect(journeySrc).toMatch(/policy decision, "?\s*\+?\s*"?not a screening result/);
  });

  it("keeps 'Screening has not been run' for a case with nobody enrolled", () => {
    // The original branch still exists — the fix separates two cases rather
    // than removing the honest reading of the first.
    expect(strip(journeySrc)).toMatch(/No screening subjects recorded/);
    expect(strip(journeySrc)).toMatch(/Screening has not been run/);
  });

  it("reads the PEP determination, which the stage could not see at all", () => {
    const code = strip(journeySrc);
    expect(code).toMatch(/pep_determination\?\.result/);
    expect(code).toMatch(/PEP determination outstanding/);
  });

  it("treats an unread PEP scope as unknown, not as outstanding work", () => {
    const code = strip(journeySrc);
    expect(code).toMatch(/pepState = "unknown"/);
    expect(code).toMatch(/unavailableFacts\.push\("PEP scope decision"\)/);
  });

  it("never lets the PEP owner outrank a match being adjudicated", () => {
    expect(strip(journeySrc)).toMatch(/if \(owner === "none"\) owner = "reviewer"/);
  });

  it("names the actual work in the primary action", () => {
    expect(strip(journeySrc)).toMatch(/Record PEP determination/);
  });

  it("the compliance summary stops calling a stood-down scope not started", () => {
    const code = strip(summarySrc);
    expect(code).toMatch(/subjects\.length === 0 && enrolled\.length > 0/);
    expect(code).toMatch(/Not required under the recorded scope/);
  });
});

/* ── The way on ───────────────────────────────────────────────────────── */

describe("a completed stage 5 leads somewhere", () => {
  it("offers Funding only when every required determination is recorded", () => {
    expect(cardSrc).toMatch(/action\.key === "none" && !caseClosed && onContinue/);
    expect(cardSrc).toMatch(/Continue to Funding/);
  });

  it("says plainly that this is evidence completion, not an approval", () => {
    expect(cardSrc).toMatch(/evidence completion only/i);
    expect(cardSrc).toMatch(/separate service-gate decision/i);
  });

  it("never uses an approval vocabulary at this stage", () => {
    const code = strip(cardSrc);
    for (const banned of ["AML clear", "AML approved", "Client compliant", "Cleared for service"]) {
      expect(code).not.toContain(banned);
    }
  });

  it("navigates and completes nothing", () => {
    // `onContinue` is wired to the existing stage navigation; the card holds
    // no mutation of its own.
    const code = strip(cardSrc);
    expect(code).not.toMatch(/amlCasesApi\./);
    expect(code).not.toMatch(/transition\(/);
  });
});
