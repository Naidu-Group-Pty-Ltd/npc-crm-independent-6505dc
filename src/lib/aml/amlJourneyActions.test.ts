import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveAmlJourney, deriveAmlLivePosition } from "./journeyModel";
import { deriveAmlNextAction } from "./workspaceViewModel";
import type { AmlWorkspaceFacts } from "./workspaceViewModel";

/**
 * The reopened case, and why nothing on it worked.
 *
 * Reopening `AML-2026-00005` succeeded — the lifecycle dimensions came back
 * into agreement — and the journey carried on behaving as though the case
 * were finished. Three causes, and the first explains most of the screen.
 *
 *   1  A TERMINATED SERVICE GATE WAS BEING READ AS A CLOSED CASE. Reopening
 *      deliberately leaves the gate terminated, so `isFinished` and
 *      `deriveAmlNextAction` both still said "finished": the rail rested on
 *      "10 of 10 · Partners & ongoing CDD", the next action read "Case
 *      closed", and Stage 5's outstanding PEP determination was silent. That
 *      made reopening a no-op in every surface an operator looks at.
 *
 *   2  THE STAGE COUNTED THE WRONG PARTIES. `subjectCount` came from the
 *      subjects whose SCREENING was owed, which on a perimeter-excluded case
 *      is none — so Stage 5 answered "Nobody is enrolled for screening yet"
 *      about a case with an enrolled party, directly above its own
 *      determination row saying the PEP determination was outstanding.
 *
 *   3  THE CTAs NAMED AN ACT AND PERFORMED A NAVIGATION. A stage's primary
 *      action points at the section the stage OPENS ON, so from the place it
 *      is most often pressed it navigated to where the operator already was
 *      and nothing happened.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");
const journeySrc = read("src/lib/aml/journeyModel.ts");
const workspaceSrc = read("src/pages/aml/AmlCaseWorkspace.tsx");
const headerSrc = read("src/components/aml/workspace/AmlJourneyStageHeader.tsx");
const panelSrc = read("src/components/aml/PartyScreeningPanel.tsx");
const casesFn = read("supabase/functions/aml-cases/index.ts");

/** The production row, after the reopen that #2212 made possible. */
const reopened = (over: Partial<AmlWorkspaceFacts> = {}): AmlWorkspaceFacts => ({
  caseRow: {
    id: "8b668f2f-0132-436f-b32c-d6709ea69526",
    status: "kyc_complete",
    case_stage: "client_submitted",
    client_portal_status: "in_progress",
    // Reopening never revives this, and that is the point.
    service_gate_status: "terminated",
    subject_type: "individual",
  } as never,
  openClientRequests: 0,
  screening: {
    subjects: [{
      screened_name: "Rugesh Naidu", state: "not_required", required: false, matches: [],
      pep_determination: null,
    }],
    pepRequired: true,
  },
  ...over,
});

/* ── 1. A terminated gate is not a closed case ────────────────────────── */

describe("reopening actually resumes the journey", () => {
  it("does not report a reopened case as closed", () => {
    const action = deriveAmlNextAction(reopened());
    expect(action.label).not.toBe("Case closed");
    expect(action.actionType).not.toBe("reopen_case");
  });

  it("still reports a genuinely closed case as closed", () => {
    const action = deriveAmlNextAction(reopened({
      caseRow: { ...reopened().caseRow, case_stage: "closed" } as never,
    }));
    expect(action.label).toBe("Case closed");
    expect(action.actionType).toBe("reopen_case");
  });

  it("closes on the LIFECYCLE alone, never on the service gate", () => {
    const code = strip(journeySrc);
    expect(code).toMatch(/return caseStage\(facts\.caseRow\) === "closed";/);
    expect(code).not.toMatch(
      /caseStage\(facts\.caseRow\) === "closed" \|\| serviceGateStatus/);
    expect(strip(read("src/lib/aml/workspaceViewModel.ts")))
      .not.toMatch(/stage === "closed" \|\| gate === "terminated"/);
  });

  it("puts the rail back on a stage that actually has work", () => {
    const journey = deriveAmlJourney(reopened());
    const position = deriveAmlLivePosition(reopened(), journey);
    /*
     * The defect was resting on 10 of 10 — the retention end — because a
     * terminated gate read as a finished case. Which working stage leads
     * depends on the rest of the evidence (a blocking submission review
     * outranks an outstanding determination, correctly); what must never
     * happen again is the journey declaring itself over.
     */
    expect(position.stageNumber).toBeLessThan(10);
    expect(position.stageLabel).not.toMatch(/partners|ongoing cdd/i);
  });

  it("a closed case still rests at the retention end", () => {
    const facts = reopened({
      caseRow: { ...reopened().caseRow, case_stage: "closed" } as never,
    });
    const position = deriveAmlLivePosition(facts, deriveAmlJourney(facts));
    expect(position.stageNumber).toBe(10);
  });

  it("keeps reporting the gate as terminated — it was never restored", () => {
    const position = deriveAmlLivePosition(reopened(), deriveAmlJourney(reopened()));
    expect(position.serviceGateLabel).toMatch(/terminated/i);
  });

  it("names the PEP determination as the outstanding work", () => {
    const journey = deriveAmlJourney(reopened());
    const stage = journey.stages.find((s) => s.id === "screening")!;
    // A required determination with no record BLOCKS the stage — it is not a
    // waiting item. That is what lets the sequence hold the journey position
    // and the Attention panel report it.
    expect(stage.blockers.map((b) => b.key)).toContain("pep_outstanding");
    expect(stage.blocking).toBe(true);
    expect(stage.primaryAction?.label).toBe("Record PEP determination");
  });
});

/* ── 2. Counting the parties, not the screening obligation ────────────── */

describe("the stage counts enrolled parties", () => {
  const code = strip(casesFn);
  const sync = code.slice(
    code.indexOf("const nextAction = deriveScreeningNextAction({"),
    code.indexOf("const { data: priorEvents }"),
  );

  it("takes the subject count from the ENROLLED parties", () => {
    expect(sync).toMatch(/subjectCount: enrolled\.length/);
    expect(sync).not.toMatch(/subjectCount: required\.length/);
  });

  it("reads PEP over the enrolled parties, and only when the scope owes one", () => {
    expect(sync).toMatch(/anyMissingPep: scope\.pep\.required === true/);
    expect(sync).toMatch(/enrolled\.length === 0/);
    expect(sync).not.toMatch(/anyMissingPep: required\.some/);
  });

  it("an empty party list is outstanding, never everybody-determined", () => {
    // `enrolled.length === 0 ||` short-circuits the `.some()` that returns
    // false for an empty array — the vacuous truth this class of bug rests on.
    expect(sync).toMatch(/enrolled\.length === 0\s*\n?\s*\|\| enrolled\.some/);
  });
});

/* ── 3. A CTA that names an act performs it ───────────────────────────── */

describe("the stage CTAs do what they say", () => {
  it("the header performs the action when a handler is given", () => {
    const code = strip(headerSrc);
    expect(code).toMatch(/if \(onPerform\) onPerform\(action\);/);
    // And still navigates when nothing routes it — no behaviour is removed.
    expect(code).toMatch(/else onOpenSection\(action\.section\);/);
  });

  it("the workspace routes the PEP action to the determination dialog", () => {
    const code = strip(workspaceSrc);
    expect(code).toMatch(/case "record_pep":/);
    expect(code).toMatch(/setPepRequest\(\(n\) => n \+ 1\)/);
  });

  it("the workspace focuses the request form rather than only navigating", () => {
    const code = strip(workspaceSrc);
    expect(code).toMatch(/case "client_request":/);
    expect(code).toMatch(/aml-client-request/);
    expect(code).toMatch(/\.focus\(\)/);
  });

  it("the request form carries the id the action focuses", () => {
    expect(workspaceSrc).toMatch(/id="aml-client-request"/);
  });

  it("the journey gives both actions a routable type", () => {
    const code = strip(journeySrc);
    expect(code).toMatch(/actionType: "client_request"/);
    expect(code).toMatch(/actionType: pepIsTheWork \? "record_pep"/);
  });

  it("PEP is only the named work when nothing more urgent is", () => {
    const code = strip(journeySrc);
    // A candidate or a confirmed match still leads.
    expect(code).toMatch(
      /!blockers\.some\(\(b\) => \["confirmed", "possible", "no_subjects"\]\.includes\(b\.key\)\)/);
  });

  it("the panel opens the PEP flow on the nonce, for a party that needs one", () => {
    const code = strip(panelSrc);
    expect(code).toMatch(/lastPepRequest/);
    expect(code).toMatch(/subjects\.find\(\(s\) => !s\.pep_determination\)/);
    expect(code).toMatch(/setPepSubject\(target\)/);
  });

  /*
   * The CTA opens the determination; it does not make it.
   *
   * This effect used to call `recordPep(target, "not_pep")`, so pressing
   * "Record PEP determination" opened a dialog headed "Record not-PEP
   * determination". The conclusion IS the determination, and a default
   * answer to it is the one default this product cannot carry.
   */
  it("the nonce never presumes the conclusion", () => {
    const code = strip(panelSrc);
    const effect = code.slice(code.indexOf("const lastPepRequest"));
    const body = effect.slice(0, effect.indexOf("}, [pepRequest,"));
    // Nothing in the opening path names an outcome.
    expect(body).not.toMatch(/not_pep/);
    expect(body).not.toMatch(/"pep"/);
    // The dialog is opened on the subject alone; the determination is made
    // inside it, after the evidence step rather than before it.
    expect(code).toMatch(/<PepDeterminationDialog/);
    expect(code).toMatch(/subject=\{pepSubject\}/);
    // The panel offers ONE button, because the outcome is not a way in.
    expect(code).not.toMatch(/Record not-PEP determination/);
  });

  /*
   * Stage 5's own card had the second copy of this action, and it only
   * scrolled. On a case whose sanctions obligation is not required — the
   * shape of the reopened production case — the PEP determination is the
   * ONLY thing Stage 5 is waiting for, so that card is exactly where the
   * CTA is pressed.
   */
  it("the screening card's PEP action opens the dialog too", () => {
    const code = strip(workspaceSrc);
    const from = code.indexOf("const runScreeningAction");
    const handler = code.slice(from, code.indexOf("const connectedPortals", from));
    expect(from).toBeGreaterThan(-1);
    expect(handler).toMatch(/case "record_pep":\s*\n\s*setPepRequest\(\(n\) => n \+ 1\)/);
  });

  it("a nonce, not a boolean — the CTA can be pressed twice", () => {
    const code = strip(workspaceSrc);
    expect(code).toMatch(/setPepRequest\(\(n\) => n \+ 1\)/);
    expect(code).not.toMatch(/setPepRequest\(true\)/);
  });

  it("performing an action mutates nothing itself", () => {
    const fn = strip(workspaceSrc).slice(
      strip(workspaceSrc).indexOf("const performStageAction"),
      strip(workspaceSrc).indexOf("const runScreeningAction"),
    );
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).not.toMatch(/amlCasesApi\./);
    expect(fn).not.toMatch(/await /);
  });

  it("only a reviewer or MLRO can be walked into the PEP dialog", () => {
    // The panel already gates the determination on `canAdjudicate`; the nonce
    // must not become a way around it.
    expect(strip(panelSrc)).toMatch(/if \(!canAdjudicate \|\| !subjects\) return;/);
  });
});
