import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PEP_DECLARATION_RELATIONSHIPS, PEP_DETAIL_FIELDS,
  collectsPepDetail, prunePepDeclaration, readPepDeclaration,
} from "./pepDeclaration";
import { deriveScreeningPath } from "./screeningSteps.pure";
import type { AmlScreeningStageSync } from "./amlCasesApi";
import type { AmlCaseScreeningPosition } from "./screeningScope";

/**
 * The political-exposure question, and the answer reaching the person who
 * has to decide.
 *
 * The portal asked "Are you a Politically Exposed Person (PEP)?" with two
 * radio buttons and no explanation, and stored a bare yes/no. A customer who
 * has never met the term answers "no" to a phrase they do not know; a
 * customer who answers "yes" gives the MLRO no office, no jurisdiction and no
 * relationship, so the determination cannot start without going back to ask
 * what should have been asked once.
 *
 * And whatever they answered reached the command centre only as
 * `personal_details.pep` inside the policy's material inputs — one collapse
 * down, as the string "no".
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

/* ── 1. The reading ───────────────────────────────────────────────────── */

describe("reading the declaration", () => {
  it("an unanswered question is unanswered, never a no", () => {
    const r = readPepDeclaration({});
    expect(r.answered).toBe(false);
    expect(r.answer).toBeNull();
    expect(r.summary).toMatch(/not a declaration that they are not/i);
  });

  it("null personal details do not become an answer either", () => {
    expect(readPepDeclaration(null).answered).toBe(false);
    expect(readPepDeclaration(undefined).answer).toBeNull();
  });

  it("a no is complete on its own, and says what was actually declared", () => {
    const r = readPepDeclaration({ pep: "no" });
    expect(r).toMatchObject({ answered: true, answer: "no", complete: true });
    // The scope of what a "no" covers, in the customer's terms.
    expect(r.summary).toMatch(/family member/i);
    expect(r.summary).toMatch(/close associate/i);
  });

  it("a full yes carries the position, the jurisdiction and the relationship", () => {
    const r = readPepDeclaration({
      pep: "yes", pep_relationship: "family_member",
      pep_role: "Member of Parliament", pep_country: "Fiji",
    });
    expect(r).toMatchObject({
      answer: "yes", relationship: "family_member",
      role: "Member of Parliament", country: "Fiji", complete: true,
    });
  });

  it("a bare yes is INCOMPLETE, not a smaller yes", () => {
    const r = readPepDeclaration({ pep: "yes" });
    expect(r.answer).toBe("yes");
    expect(r.complete).toBe(false);
    expect(r.summary).toMatch(/did not give/i);
  });

  it("refuses a relationship it does not recognise", () => {
    // A value no determination can be compared against is not a relationship.
    expect(readPepDeclaration({ pep: "yes", pep_relationship: "cousin" }).relationship)
      .toBeNull();
  });

  it("shares its vocabulary with the determination the MLRO records", () => {
    /*
     * `record_pep_determination` accepts exactly this triple. Keeping them
     * identical is what lets a reviewer compare what the customer said with
     * what they concluded, without translating it by hand.
     */
    const casesFn = strip(read("supabase/functions/aml-cases/index.ts"));
    const guard = casesFn.slice(casesFn.indexOf("case 'record_pep_determination'"));
    for (const r of PEP_DECLARATION_RELATIONSHIPS) expect(guard).toContain(`'${r}'`);
  });
});

/* ── 2. A corrected answer leaves nothing behind ──────────────────────── */

describe("pruning", () => {
  const YES = {
    pep: "yes", pep_relationship: "self", pep_role: "Judge", pep_country: "Australia",
    full_name: "Rugesh Naidu",
  };

  it("keeps the detail while the answer is yes", () => {
    expect(prunePepDeclaration(YES)).toBe(YES);
    expect(collectsPepDetail("yes")).toBe(true);
  });

  it("drops every detail field when the answer changes to no", () => {
    const after = prunePepDeclaration({ ...YES, pep: "no" });
    for (const f of PEP_DETAIL_FIELDS) expect(after).not.toHaveProperty(f);
    // and touches nothing else on the section
    expect(after.full_name).toBe("Rugesh Naidu");
  });

  it("drops it for an unanswered question too", () => {
    expect(prunePepDeclaration({ ...YES, pep: undefined }))
      .not.toHaveProperty("pep_role");
  });

  it("returns the same object when nothing needed removing", () => {
    const clean = { pep: "no", full_name: "x" };
    expect(prunePepDeclaration(clean)).toBe(clean);
  });

  it("never mutates its input", () => {
    const before = { ...YES, pep: "no" };
    prunePepDeclaration(before);
    expect(before.pep_role).toBe("Judge");
  });
});

/* ── 3. It is enforced where it is written, not only where it is typed ── */

describe("the write boundary", () => {
  it("the portal function normalises every section before storing it", () => {
    /*
     * The prune lives in `questionnaireValidation.ts` rather than at the call
     * site because `aml-client-portal/index.ts` may not mention PEP,
     * screening, risk or sanctions in a line of code — a blunt contract
     * (`amlPortalContracts.test.ts`) that exists so the portal never becomes
     * a surface returning screening detail to a customer. It cannot tell a
     * prune from a disclosure, and it should not have to.
     */
    const src = strip(read("supabase/functions/aml-client-portal/index.ts"));
    expect(src).toMatch(/normaliseQuestionnaireSection\(\s*body\.section/);
    const boundary = strip(read("supabase/functions/aml-client-portal/questionnaireValidation.ts"));
    expect(boundary).toMatch(/section === 'personal_details'\) return prunePepDeclaration\(payload\)/);
    expect(boundary).toMatch(/section === 'purchasing_structure'\) return prunePurchasingStructure\(payload\)/);
  });

  it("a declared exposure must name the position, jurisdiction and relationship", () => {
    const src = strip(read("supabase/functions/aml-client-portal/questionnaireValidation.ts"));
    expect(src).toMatch(/collectsPepDetail\(payload\.pep\)/);
    expect(src).toMatch(/errors\.push\('pep_relationship'\)/);
    expect(src).toMatch(/requireFields\(payload, \['pep_role', 'pep_country'\]\)/);
  });

  it("the stored answer is still yes/no, so no policy reads anything new", () => {
    const policy = strip(read("supabase/functions/_shared/aml/screeningPolicy.pure.ts"));
    // The policy's own input is untouched by this work.
    expect(policy).toMatch(/"personal_details\.pep": String\(a\?\.pep \?\? "not answered"\)/);
    expect(policy).not.toMatch(/pep_role|pep_country|pep_relationship/);
  });

  it("declaring exposure records no determination anywhere", () => {
    /*
     * The rule the whole feature hangs on. A declaration is evidence; a
     * determination is made by a reviewer or the MLRO, with sources and a
     * rationale, through `record_pep_determination`.
     */
    const shared = strip(read("supabase/functions/_shared/aml/pepDeclaration.pure.ts"));
    expect(shared).not.toMatch(/pep_determinations|record_pep|determined_by|insert\(/);
    const portal = strip(read("supabase/functions/aml-client-portal/index.ts"));
    expect(portal).not.toMatch(/pep_determinations/);
  });
});

/* ── 4. It reaches the command centre ─────────────────────────────────── */

describe("the stage carries it", () => {
  const sync = (declaration: unknown): AmlScreeningStageSync => ({
    enrolled: 1, subjects: [],
    policy: { summary: "", policyVersion: "2026.08-1", notRequired: [], evidence: {} } as never,
    scopes: [{
      scope: "pep", required: true, optional: false, state: "required",
      reason_code: "pep_determination_required", reason: "Owed.",
    }] as never,
    perimeter: {
      classification: "designated_service", classified: true, reason_code: null,
      scopes_excluded: [], recorded_by_label: "x", recorded_at: "2026-08-19T00:00:00Z",
    } as never,
    policy_version: "2026.08-1", provider_ready: true, provider_relevant: false,
    next_action: { key: "record_pep", label: "Record", headline: "h", detail: "d",
      owner: "reviewer" } as never,
    decision_recorded: false, scope_changed: [], case_closed: false,
    pep_declaration: declaration as never,
  } as AmlScreeningStageSync);

  const position: AmlCaseScreeningPosition = {
    subjects: [{
      id: "s1", name: "Rugesh Naidu", partyType: "primary_subject", required: false,
      state: "not_required",
      sanctions: { state: "not_required", resolved: false, detail: "" },
      pep: { resolved: false, detail: "outstanding" }, outstanding: ["pep"],
    }] as never,
    facts: {} as never, read: true,
  } as AmlCaseScreeningPosition;

  it("attaches the declaration to the PEP step", () => {
    const declaration = readPepDeclaration({
      pep: "yes", pep_relationship: "close_associate",
      pep_role: "Minister", pep_country: "Australia",
    });
    const step = deriveScreeningPath({ sync: sync(declaration), position })
      .steps.find((s) => s.key === "pep")!;
    expect(step.declaration).toMatchObject({ answer: "yes", role: "Minister" });
  });

  it("keeps it out of the step's own summary and status", () => {
    /*
     * The declaration must not be able to read as the determination or as a
     * status this stage reached, so it never joins the sentence that says
     * where the step has got to.
     */
    const declaration = readPepDeclaration({ pep: "no" });
    const step = deriveScreeningPath({ sync: sync(declaration), position })
      .steps.find((s) => s.key === "pep")!;
    expect(step.summary).not.toMatch(/customer declared/i);
    /*
     * The step the server is asking for reads "Do this now". It read
     * "Blocked" until the promotion stopped being guarded on whether the
     * step was already settled — a determination that is owed and has not
     * been made is the operator's turn, not an obstruction.
     */
    expect(step.state).toBe("current");
  });

  it("a server that sends nothing produces no declaration, not a no", () => {
    const step = deriveScreeningPath({ sync: sync(undefined), position })
      .steps.find((s) => s.key === "pep")!;
    expect(step.declaration).toBeNull();
  });
});
