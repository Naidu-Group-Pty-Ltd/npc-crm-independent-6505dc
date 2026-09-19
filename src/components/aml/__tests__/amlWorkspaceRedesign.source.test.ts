/**
 * Guard-rails for the AML workspace redesign.
 *
 * The redesign is presentation only. These source tests pin the boundaries
 * it must not cross, so a later change cannot quietly turn a reading into
 * an authority, add a server operation behind a nicer card, or lose a
 * section that used to exist.
 *
 * They are deliberately about *shape*, not about wording: the behavioural
 * assertions live in `src/lib/aml/workspaceViewModel.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const viewModel = read("src/lib/aml/workspaceViewModel.ts");
const journeyModel = read("src/lib/aml/journeyModel.ts");
const summaryHook = read("src/lib/aml/useAmlCaseSummary.ts");
const workspace = read("src/pages/aml/AmlCaseWorkspace.tsx");
const register = read("src/pages/aml/AmlCases.tsx");
const actionPanel = read("src/components/aml/workspace/AmlContextActionPanel.tsx");
const readinessCard = read("src/components/aml/workspace/AmlServiceReadinessCard.tsx");
/** The authoritative transition map — the rail no longer keeps a copy. */
const edgeFunction = read("supabase/functions/aml-cases/index.ts");

const componentDir = "src/components/aml/workspace";
const componentFiles = readdirSync(join(repo, componentDir))
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .map((f) => ({ name: f, source: read(`${componentDir}/${f}`) }));

/* ------------------------------------------------------------------ */

describe("the view model is pure and cannot become an authority", () => {
  it("fetches nothing — no supabase, no fetch, no API client", () => {
    expect(viewModel).not.toMatch(/supabase|invokeSecureFunction|invokeAmlFunction|\bfetch\(/);
    // No API object is referenced at all, so no call can be made through one.
    expect(viewModel).not.toMatch(/\baml\w*Api\./);
  });

  it("imports only types from the API layer", () => {
    const apiImports = viewModel.match(/^import .*from "\.\/aml\w*Api";$/gm) ?? [];
    expect(apiImports.length).toBeGreaterThan(0);
    for (const line of apiImports) expect(line.startsWith("import type ")).toBe(true);
  });

  it("declares itself presentation-only where a reader will see it", () => {
    expect(viewModel).toContain("PRESENTATION ONLY");
    expect(viewModel).toContain("It never persists");
    expect(viewModel).toContain("It never decides");
  });

  it("has no next_action column anywhere — the value is derived per render", () => {
    expect(viewModel).not.toMatch(/next_action['"\s]*[:=]/);
    expect(workspace).not.toMatch(/next_action['"\s]*[:=]/);
    expect(register).not.toMatch(/next_action['"\s]*[:=]/);
  });
});

describe("the service gate is never inferred", () => {
  it("readiness reads the canonical gate and only the canonical gate", () => {
    const fn = viewModel.slice(
      viewModel.indexOf("export function deriveAmlServiceReadiness"),
      viewModel.indexOf("/* ═", viewModel.indexOf("export function deriveAmlServiceReadiness")),
    );
    expect(fn).toContain("serviceGateStatus(facts.caseRow)");
    // Nothing in the readiness derivation may look at risk, identity,
    // screening, funding or ownership.
    expect(fn).not.toMatch(/risk_rating|facts\.identity|facts\.screening|facts\.funding|facts\.ownership/);
  });

  it("the readiness card says in words that evidence does not move the gate", () => {
    expect(readinessCard).toContain("The service gate is an explicit decision");
    expect(readinessCard).toMatch(/none of them moves the gate/i);
  });

  it("the macro rail completes DECIDE from the gate, not from the stage", () => {
    const fn = viewModel.slice(
      viewModel.indexOf("export function deriveAmlMacroPhase"),
      viewModel.indexOf("/* ═", viewModel.indexOf("export function deriveAmlMacroPhase")),
    );
    expect(fn).toContain("gateSettled");
    expect(fn).not.toContain("risk_rating");
  });
});

describe("no new server surface", () => {
  it("the summary hook calls only existing read operations", () => {
    // Every call it makes goes through an existing typed API module.
    expect(summaryHook).not.toMatch(/supabase|invokeSecureFunction|invokeAmlFunction|\bfetch\(/);
    for (const call of [
      "amlVerificationApi.listVerificationChecks(",
      "amlCasesApi.listPartyScreening(",
      "amlMonitoringApi.caseMonitoringSummary(",
      "amlRiskApi.gateContract(",
      "amlCasesApi.listRequirements(",
      "amlEntitiesApi.listEntitiesForCase(",
      "amlMonitoringApi.listSof(",
      "amlRelianceApi.listGrants(",
      "amlRelianceApi.listAssessments(",
    ]) {
      expect(summaryHook).toContain(call);
    }
  });

  it("the summary hook only reads — it performs no mutation", () => {
    expect(summaryHook).not.toMatch(
      /\b(transition|setServiceGate|decide|recommend|adjudicate|resolveMatch|issueAttestation|grantAccess|upsert|create|delete)\w*\(/,
    );
  });

  it("every evidence read is individually failure-tolerant", () => {
    // A read that fails resolves to null and reads as "not available" —
    // one bad or unauthorised read can never blank the workspace.
    expect(summaryHook).toContain("const soft =");
    expect(summaryHook).toMatch(/\.then\(\(v\) => v, \(\) => null\)/);
    // A synchronous throw is caught too, not just a rejection.
    expect(summaryHook).toMatch(/} catch {\s*return Promise\.resolve\(null\);/);
  });

  it("the presentation components fetch nothing at all", () => {
    for (const { name, source } of componentFiles) {
      expect(
        /supabase|invokeSecureFunction|invokeAmlFunction|\bfetch\(|useEffect/.test(source),
        `${name} must not fetch or run effects`,
      ).toBe(false);
    }
  });

  it("the rail performs NO mutation at all", () => {
    /* It used to carry "Advance status" — an optional-reason box and a row of
       buttons that moved the case lifecycle straight from the rail. That is
       gone from every stage: a lifecycle is the consequence of decisions that
       carry their own reasons, and every state it could reach is set where
       that decision is recorded. What is left is a notice on a closed case
       and the authorised reopen, which the workspace performs. */
    const mutations = actionPanel.match(/aml\w+Api\.\w+\(/g) ?? [];
    expect(mutations).toEqual([]);
    // Prose may name what left; the component may not render it.
    const code = actionPanel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toContain("Advance status");
  });
});

describe("the case state machine is untouched", () => {
  it("the legal transition map is the SERVER's, and the rail no longer copies it", () => {
    /* The map was mirrored in the rail so it could draw the right buttons.
       With no buttons there is nothing to mirror — and a second copy of a
       state machine is how two of them come to disagree. The authoritative
       map is unchanged in `aml-cases`. */
    for (const line of [
      "draft: ['kyc_in_progress', 'closed']",
      "kyc_in_progress: ['kyc_complete', 'edd_required', 'blocked', 'closed']",
      "cleared: ['under_review', 'closed']",
      "closed: []",
    ]) {
      expect(edgeFunction).toContain(line);
    }
    expect(actionPanel).not.toContain("NEXT_STATUSES");
  });

  it("closing still requires a confirmed, non-empty reason", () => {
    /* `closed` is TERMINAL and the record is retained from that point, so it
       was never an ordinary advance and must never be one click. It moved to
       the case header — beside the case's own identity rather than the stage
       somebody happens to be on — and it asks for a reason it will not
       proceed without. */
    expect(workspace).toContain('amlCasesApi.transition(caseId, "closed"');
    const closeFn = workspace.slice(
      workspace.indexOf("const closeCase = useCallback"),
      workspace.indexOf("const closeCase = useCallback") + 2200,
    );
    expect(closeFn).toContain("required: true");
    expect(closeFn).toMatch(/minLength:\s*10/);
    expect(closeFn).toContain("confirmLabel");
    // And it is never offered to a reader who may not write.
    expect(workspace).toContain("onClose={canWrite ?");
  });

  it("a terminal act is never offered on an already-terminal record", () => {
    const header = read("src/components/aml/workspace/AmlWorkspaceHeader.tsx");
    expect(header).toContain("onClose && !closed");
    // Read on BOTH dimensions — they can disagree, and did in production.
    expect(header).toMatch(/caseStage\(caseRow\) === "closed" \|\| caseRow\.status === "closed"/);
  });

  it("the rail renders no status vocabulary at all", () => {
    // The rule it protected — a raw enum never reaches an operator — is kept
    // by there being nothing to render.
    expect(actionPanel).not.toMatch(/\{caseRow\.status\}/);
    expect(actionPanel).not.toContain("CASE_STATUS_LABELS");
  });
});

describe("no section, and no capability, was lost", () => {
  it("keeps every section the previous rail offered", () => {
    for (const key of [
      "overview", "identity", "ownership", "counterparty", "finance", "documents",
      "submission-review", "risk", "monitoring", "requests", "timeline",
    ]) {
      expect(viewModel).toContain(`"${key}"`);
      expect(workspace).toContain(`"${key}"`);
    }
  });

  it("still mounts every existing section component", () => {
    for (const component of [
      "VerificationSection", "PartyVerificationPanel", "PartyScreeningPanel",
      "LegacyVerificationHistoryPanel", "ScreeningTab", "OwnershipControlTab",
      "PurchaseCounterpartySection", "FundingFinanceTab", "DocumentsEvidenceSection",
      "SubmissionReviewPanel", "RiskTab", "RequestsSection", "MonitoringReviewsSection",
      "ComplianceJourneyMap", "ReliancePassportSection", "TimelineTab", "AuditTab",
      "ConsentEvidenceCard",
    ]) {
      expect(workspace).toContain(`<${component}`);
    }
  });

  it("keeps the detailed fourteen-step rail, in Records", () => {
    expect(workspace).toContain("progressRail(caseRow)");
    expect(workspace).toContain("<DetailedProcessRail");
  });

  it("keeps the role gates the previous rail applied", () => {
    expect(workspace).toContain("counterparty: (a) => a.canInvestigate");
    expect(workspace).toContain("finance: (a) => a.canInvestigate");
    expect(workspace).toContain("monitoring: (a) => a.canInvestigate");
    // Hiding a section is a rendering decision, and the source says so.
    expect(workspace).toContain("This is a rendering decision only");
  });
});

describe("deep links and rollout behaviour survive", () => {
  it("the section parameter still drives the workspace", () => {
    expect(workspace).toContain('searchParams.get("section")');
    expect(workspace).toContain('params.set("section", next)');
  });

  it("the flag-off redirect to the legacy dialog is unchanged", () => {
    expect(workspace).toContain("`/admin/aml/cases?open=${caseId}`");
  });

  it("the register keeps every saved-view key other surfaces deep-link to", () => {
    for (const key of ["onboarding", "awaiting_review", "additional_info", "awaiting_decision"]) {
      expect(register).toContain(`key: "${key}"`);
    }
    expect(register).toContain('searchParams.get("view")');
    expect(register).toContain('searchParams.get("open")');
    expect(register).toContain('searchParams.get("activateClientId")');
  });

  it("the register's client-side view is honest about a truncated page", () => {
    expect(register).toContain("refinedFromTruncatedPage");
    expect(register).toContain("loaded case");
  });
});

describe("presentation discipline", () => {
  it("uses semantic tokens only — no raw palette classes or hex literals", () => {
    const palette =
      /(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/;
    for (const { name, source } of [
      ...componentFiles,
      { name: "AmlCaseWorkspace.tsx", source: workspace },
      { name: "AmlCases.tsx", source: register },
      { name: "workspaceViewModel.ts", source: viewModel },
    ]) {
      expect(palette.test(source), `${name} uses a raw Tailwind palette class`).toBe(false);
      expect(/#[0-9a-fA-F]{3,8}\b/.test(source), `${name} contains a hex colour`).toBe(false);
    }
  });

  it("never claims a partner is 'independently compliant'", () => {
    for (const { name, source } of [
      ...componentFiles,
      { name: "workspaceViewModel.ts", source: viewModel },
      { name: "ComplianceJourneyMap.tsx", source: read("src/components/aml/ComplianceJourneyMap.tsx") },
    ]) {
      expect(
        /independently compliant/i.test(source),
        `${name} makes a compliance claim the domain does not support`,
      ).toBe(false);
    }
  });

  it("marks status with words as well as tone — no colour-only meaning", () => {
    // Every attention level maps to a label, not just a class.
    expect(viewModel).toContain("EVIDENCE_STATE_LABELS");
    // The journey rail replaced the area rail and the five-phase macro rail.
    // It carries the same guarantee those two did: every step states its
    // status in words a screen reader can read, not only in a tone.
    const rail = componentFiles.find((f) => f.name === "AmlJourneyRail.tsx")!.source;
    expect(rail).toContain("function statusSentence");
    expect(rail).toContain("EVIDENCE_STATE_LABELS");
    expect(rail).toContain('className="sr-only"');
    expect(rail).toContain('aria-current={active ? "step" : undefined}');
    const stageHeader = componentFiles.find((f) => f.name === "AmlJourneyStageHeader.tsx")!.source;
    expect(stageHeader).toContain("EVIDENCE_STATE_LABELS");
    expect(stageHeader).toContain("stage.ownerLabel");
  });
});

describe("no database change was needed", () => {
  /* This one test reads every migration in the repository — over a thousand
     files, and one more with every change that ships. It has nothing to do
     with the assertion's difficulty and everything to do with IO, so it gets
     an IO-shaped budget: at 5s it began failing under parallel load while
     passing in isolation, which is a flake that teaches people to re-run
     rather than to read. The assertion below is untouched. */
  it("no migration persists a derived reading", { timeout: 30_000 }, () => {
    // The next action, the macro phase, the journey stage and the attention
    // level are computed per render. If any of them ever acquires a column,
    // it has become a source of truth — which is the one thing this
    // architecture may not do. Scoped to the AML schema: an unrelated
    // `next_action` on a finance portal valuations table predates all of
    // this and is not ours.
    const offenders = readdirSync(join(repo, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => {
        const sql = read(`supabase/migrations/${f}`);
        return (
          /\baml\./i.test(sql) &&
          /\b(next_action|macro_phase|case_attention|attention_level|service_readiness|journey_stage|current_stage)\b/i.test(sql)
        );
      });
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The ten-stage journey                                               */
/* ------------------------------------------------------------------ */

describe("the journey model is pure and cannot become an authority", () => {
  it("fetches nothing and references no API client", () => {
    expect(journeyModel).not.toMatch(/supabase|invokeSecureFunction|invokeAmlFunction|\bfetch\(/);
    expect(journeyModel).not.toMatch(/\baml\w*Api\./);
    // No React at all: it is a pure module, not a hook.
    expect(journeyModel).not.toMatch(/\buse(State|Effect|Memo|Callback)\b/);
  });

  it("declares itself presentation-only where a reader will see it", () => {
    expect(journeyModel).toContain("It never fetches");
    expect(journeyModel).toContain("It never persists");
    expect(journeyModel).toContain("It never decides");
    expect(journeyModel).toContain("It never invents");
  });

  it("has no stored stage — the reading is recomputed per render", () => {
    for (const source of [journeyModel, workspace]) {
      expect(source).not.toMatch(/current_stage['"\s]*[:=]/);
      expect(source).not.toMatch(/journey_stage['"\s]*[:=]/);
    }
  });

  it("reuses the existing status vocabulary instead of forking a second one", () => {
    // `status` is `AmlEvidenceState`, the vocabulary the compliance summary
    // already uses. A parallel journey-status union would have to be kept in
    // step with it for ever, and would drift.
    expect(journeyModel).toContain("status: AmlEvidenceState");
    expect(journeyModel).toContain("EVIDENCE_STATE_LABELS");
    expect(journeyModel).not.toMatch(/JOURNEY_STATUSES\s*=/);
  });

  it("reads the Passport state the server derived and never derives one", () => {
    // `derivePassportState` runs in the edge function. A browser-side copy
    // is exactly the two-truths bug the Passport architecture exists to
    // prevent, so neither the model nor the workspace may call it.
    for (const source of [journeyModel, workspace, ...componentFiles.map((f) => f.source)]) {
      expect(source).not.toMatch(/derivePassportState/);
    }
    expect(journeyModel).toContain("facts.passport.state?.code");
  });

  it("never lets navigation change state — the stage rail and footer mutate nothing", () => {
    const journeyComponents = componentFiles.filter((f) =>
      /^(AmlJourney|AmlLivePositionRail|MlroDecisionDossier)/.test(f.name),
    );
    expect(journeyComponents.length).toBeGreaterThanOrEqual(4);
    for (const { name, source } of journeyComponents) {
      expect(/aml\w*Api\./.test(source), `${name} must not call an API`).toBe(false);
    }
  });

  it("the MLRO dossier consolidates by reference and states that it is not a decision", () => {
    const dossier = componentFiles.find((f) => f.name === "MlroDecisionDossier.tsx")!.source;
    expect(dossier).toContain("BY REFERENCE");
    expect(dossier).toContain("It is not a decision");
    // It names the canonical source of every group it renders.
    expect(dossier).toContain("source:");
    // An unread stream is called out rather than counted as satisfied.
    expect(dossier).toContain("Unknown is not");
  });

  it("the readiness meter is never presented as a clearance", () => {
    const rail = componentFiles.find((f) => f.name === "AmlLivePositionRail.tsx")!.source;
    expect(rail).toMatch(/evidence, not a clearance/i);
    expect(rail).toContain("explicit service-gate decision");
  });
});

describe("the journey adds no server surface", () => {
  it("the two new reads are existing operations on existing typed clients", () => {
    expect(summaryHook).toContain("amlCasesApi.consentStatus(");
    expect(summaryHook).toContain("amlRelianceApi.getPassportDistributionStatus(");
    // Still no direct transport of any kind.
    expect(summaryHook).not.toMatch(/supabase|invokeSecureFunction|invokeAmlFunction|\bfetch\(/);
  });

  it("partner distribution stays server-decided — the workspace ships no share control", () => {
    // Distribution is performed on the dedicated Passport page, which
    // re-derives readiness server-side first. A share button here would be
    // a second path with a browser-side idea of eligibility.
    expect(workspace).not.toMatch(/sharePassportTo(Partner|Partners)\(/);
    expect(workspace).not.toMatch(/issueAttestation\(|grantAccess\(/);
  });
});
