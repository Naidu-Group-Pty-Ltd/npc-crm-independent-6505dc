import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveAmlJourney, deriveAmlLivePosition } from "./journeyModel";
import { deriveAmlNextAction, deriveAmlOutstandingItems } from "./workspaceViewModel";
import type { AmlWorkspaceFacts } from "./workspaceViewModel";
import { readSanctionsSource } from "./screeningResolution.pure";

/**
 * Stage 5 as ONE case with ONE position and ONE next action.
 *
 * The screenshots showed a single case answering the same question three
 * different ways at once:
 *
 *   Stage 5        "PEP determination outstanding", 2 of 3 items complete
 *   Live position  "6 of 10 · Funding & transaction"
 *   Next action    "Review the client submission — Go to stage 7"
 *   Attention      "Nothing on this case is unresolved"
 *
 * Every one was individually derived and internally consistent. Together they
 * were unusable, because three derivations answered "where is this case" and
 * only one of them had been told the PEP determination existed.
 *
 * Two causes:
 *
 *   1  A required determination with no record was an OUTSTANDING item rather
 *      than a BLOCKER, so Stage 5 never set `blocking` — and `currentStage`
 *      scanned every stage for a blocker BEFORE considering order, letting a
 *      later stage's blocker claim the position over an earlier stage's work.
 *
 *   2  `nextActionCandidates` had no PEP candidate at all, so the rail could
 *      not name it even in principle and fell through to stage 7.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");
const journeySrc = read("src/lib/aml/journeyModel.ts");
const viewSrc = read("src/lib/aml/workspaceViewModel.ts");
const cardSrc = read("src/components/aml/ScreeningStageCard.tsx");

/** The reopened enquiry-only case from the screenshots. */
const reopenedEnquiry = (over: Partial<AmlWorkspaceFacts> = {}): AmlWorkspaceFacts => ({
  caseRow: {
    id: "case-1", status: "kyc_complete", case_stage: "client_submitted",
    client_portal_status: "in_progress", service_gate_status: "terminated",
    subject_type: "individual", risk_rating: null,
  } as never,
  openClientRequests: 0,
  screening: {
    subjects: [{
      screened_name: "Test Subject", state: "not_required", required: false,
      matches: [], pep_determination: null,
    }],
    pepRequired: true,
  },
  ...over,
});

/* ── One case, one position, one next action ──────────────────────────── */

describe("the journey cannot step over a genuine Stage 5 requirement", () => {
  it("puts the journey position AT stage 5", () => {
    const facts = reopenedEnquiry();
    const position = deriveAmlLivePosition(facts, deriveAmlJourney(facts));
    expect(position.stageNumber).toBe(5);
    expect(position.stageLabel).toMatch(/screening/i);
  });

  it("names the PEP determination as the next action, not a later stage", () => {
    const action = deriveAmlNextAction(reopenedEnquiry());
    expect(action.label).toBe("Record PEP determination");
    expect(action.actionType).toBe("record_pep");
    expect(action.blocking).toBe(true);
  });

  it("reports it in Attention rather than saying nothing is unresolved", () => {
    const items = deriveAmlOutstandingItems(reopenedEnquiry());
    expect(items.map((i) => i.key)).toContain("pep_determination");
  });

  it("marks Stage 5 as blocking, which is what holds the position", () => {
    const stage = deriveAmlJourney(reopenedEnquiry())
      .stages.find((s) => s.id === "screening")!;
    expect(stage.blocking).toBe(true);
    expect(stage.blockers.map((b) => b.key)).toContain("pep_outstanding");
  });

  it("the EARLIEST blocking stage wins, not a later one", () => {
    const code = strip(journeySrc);
    expect(code).toMatch(/const blocking = stages\.find\(\(s\) => s\.applicable && s\.blocking\)/);
    expect(code).toMatch(/WORKING_STATES\.includes\(s\.status\)/);
  });

  it("a blocking stage outranks an earlier stage that is only unfinished", () => {
    /*
     * Measured in production after the first attempt at this: intake sat
     * `in_progress` waiting on the CLIENT and claimed the position ahead of
     * the determination the MLRO actually owed at stage 5 — the rail read
     * "2 of 10 · Client intake" over the only actionable work on the case.
     * Unfinished is not the same as blocking.
     */
    const facts = reopenedEnquiry({
      consent: { satisfied: true, outstanding: [] },
      portalAccess: { hasAccount: true, isActive: true } as never,
      identity: { checks: [{ party_label: "Test Subject", status: "passed" }] },
      documents: { requirements: [{ label: "Passport", required: true, status: "accepted" }] },
    });
    const journey = deriveAmlJourney(facts);
    const intake = journey.stages.find((s) => s.id === "intake")!;
    expect(intake.status).not.toBe("complete");
    expect(intake.blocking).toBe(false);
    expect(journey.currentStageId).toBe("screening");
  });

  it("an UNREAD stage never claims the position", () => {
    // `unknown` means the fact could not be read. Parking the journey there
    // would report a failed read as outstanding work.
    const code = strip(journeySrc);
    expect(code).toMatch(/WORKING_STATES[\s\S]{0,160}"attention", "in_progress", "not_started"/);
    expect(code).not.toMatch(/WORKING_STATES[^=]*=[^;]*"unknown"/);
  });

  it("a genuinely settled case still rests at the end of the journey", () => {
    const facts = reopenedEnquiry({
      screening: {
        subjects: [{
          screened_name: "Test Subject", state: "not_required", required: false,
          matches: [], pep_determination: { result: "not_pep" },
        }],
        pepRequired: true,
      },
    });
    const stage = deriveAmlJourney(facts).stages.find((s) => s.id === "screening")!;
    expect(stage.blocking).toBe(false);
    expect(deriveAmlNextAction(facts).label).not.toBe("Record PEP determination");
  });

  it("a finding still outranks the determination", () => {
    const facts = reopenedEnquiry({
      screening: {
        subjects: [{
          screened_name: "Test Subject", state: "confirmed_match", required: true,
          matches: [], pep_determination: null,
        }],
        pepRequired: true,
      },
    });
    expect(deriveAmlNextAction(facts).key).toBe("screening_confirmed");
  });

  it("nobody enrolled is outstanding, never everybody-determined", () => {
    const facts = reopenedEnquiry({
      screening: { subjects: [], pepRequired: true },
    });
    expect(deriveAmlNextAction(facts).label).toBe("Record PEP determination");
  });

  it("no PEP action at all when the scope does not owe one", () => {
    const facts = reopenedEnquiry({
      screening: {
        subjects: [{
          screened_name: "Test Subject", state: "not_required", required: false,
          matches: [], pep_determination: null,
        }],
        pepRequired: false,
      },
    });
    expect(deriveAmlNextAction(facts).label).not.toBe("Record PEP determination");
  });

  it("the rail and the stage read the SAME facts, so they cannot disagree", () => {
    const code = strip(viewSrc);
    expect(code).toMatch(/facts\.screening\.pepRequired === true/);
    expect(code).toMatch(/!s\.pep_determination\?\.result/);
    // Journey position 5, so nothing later can outrank it in the ranking.
    expect(code).toMatch(/key: "pep_determination"[\s\S]{0,600}section: "ownership"/);
  });
});

/* ── A person is not in or out of scope. Each check is. ───────────────── */

describe("people carry a status per check", () => {
  it("no longer labels a person globally out of scope", () => {
    expect(strip(cardSrc)).not.toMatch(/not in scope/);
  });

  it("renders a sanctions and a PEP status for every person", () => {
    expect(cardSrc).toMatch(/sanctions · \{!sanctionsRequired/);
    expect(cardSrc).toMatch(/PEP · \{!pepRequired/);
  });

  it("takes each obligation from the server's scope decision", () => {
    const code = strip(cardSrc);
    expect(code).toMatch(/\(sync\.scopes \?\? \[\]\)\.find\(\(x\) => x\.scope === k\)\?\.required === true/);
  });

  it("calls the section what it is", () => {
    expect(cardSrc).toMatch(/People to assess/);
  });
});

/* ── The Australian sanctions source ──────────────────────────────────── */

describe("the sanctions source reports its real state", () => {
  const NOW = Date.parse("2026-08-19T00:00:00.000Z");
  const base = { providerReady: true, staleAfterDays: 365, nowMs: NOW };

  it("an unread source is unknown, never ready", () => {
    const r = readSanctionsSource({ ...base, syncs: null, entryCount: null });
    expect(r.state).toBe("unknown");
    expect(r.automatedReady).toBe(false);
    expect(r.detail).toMatch(/not evidence it is loaded/i);
  });

  it("no sync at all is NOT LOADED, and says screening would hit nothing", () => {
    const r = readSanctionsSource({ ...base, syncs: [], entryCount: 0 });
    expect(r.state).toBe("not_loaded");
    expect(r.automatedReady).toBe(false);
    expect(r.detail).toMatch(/screening against nothing/i);
  });

  it("reports a failed load as a failed load", () => {
    const r = readSanctionsSource({
      ...base, entryCount: 0,
      syncs: [{ list_code: "dfat", status: "failed", entry_count: 0, completed_at: null }],
    });
    expect(r.state).toBe("sync_failed");
    expect(r.automatedReady).toBe(false);
  });

  it("a list past the freshness window is stale and refuses", () => {
    const r = readSanctionsSource({
      ...base, entryCount: 3846,
      syncs: [{ list_code: "dfat", status: "succeeded", entry_count: 3846,
        completed_at: "2024-01-01T00:00:00.000Z" }],
    });
    expect(r.state).toBe("stale");
    expect(r.automatedReady).toBe(false);
  });

  it("a current list with a ready engine is the only ready state", () => {
    const r = readSanctionsSource({
      ...base, entryCount: 3846,
      syncs: [{ list_code: "dfat", status: "succeeded", entry_count: 3846,
        completed_at: "2026-08-01T00:00:00.000Z" }],
    });
    expect(r.state).toBe("current");
    expect(r.automatedReady).toBe(true);
    expect(r.entryCount).toBe(3846);
  });

  it("a current list with an unready engine is current and NOT ready", () => {
    const r = readSanctionsSource({
      ...base, providerReady: false, entryCount: 3846,
      syncs: [{ list_code: "dfat", status: "succeeded", entry_count: 3846,
        completed_at: "2026-08-01T00:00:00.000Z" }],
    });
    expect(r.state).toBe("current");
    expect(r.automatedReady).toBe(false);
  });

  it("takes the newest successful load, not the first row it sees", () => {
    const r = readSanctionsSource({
      ...base, entryCount: 3846,
      syncs: [
        { list_code: "dfat", status: "succeeded", entry_count: 10, completed_at: "2025-01-01T00:00:00.000Z" },
        { list_code: "dfat", status: "succeeded", entry_count: 3846, completed_at: "2026-08-01T00:00:00.000Z" },
      ],
    });
    expect(r.lastLoadedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(r.state).toBe("current");
  });

  it("a 'succeeded' sync that loaded nothing is not a loaded list", () => {
    const r = readSanctionsSource({
      ...base, entryCount: 0,
      syncs: [{ list_code: "dfat", status: "succeeded", entry_count: 0,
        completed_at: "2026-08-01T00:00:00.000Z" }],
    });
    expect(r.state).toBe("not_loaded");
  });

  it("hard-codes no count, date or freshness anywhere", () => {
    const code = strip(read("src/lib/aml/screeningResolution.pure.ts"));
    expect(code).not.toMatch(/3,?846/);
    expect(code).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it("the card shows it only where a sanctions obligation exists", () => {
    expect(cardSrc).toMatch(/\{sanctionsRequired && \(/);
    expect(cardSrc).toMatch(/Australian sanctions source/);
  });
});

/* ── The reopened enquiry prompts for a classification review ─────────── */

describe("a reopened enquiry-only case asks the question", () => {
  it("prompts for classification review at the top of the stage", () => {
    expect(cardSrc).toMatch(/Case classification requires review/);
    expect(cardSrc).toMatch(/perimeterNeedsReview/);
  });

  it("only for an ACTIVE case previously stood down as an enquiry", () => {
    const code = strip(cardSrc);
    expect(code).toMatch(/!caseClosed[\s\S]{0,200}reason_code === "enquiry_only"/);
  });

  it("changes no classification and infers nothing from the reopen", () => {
    const code = strip(cardSrc);
    // It opens the existing dialog. It writes nothing itself.
    expect(code).toMatch(/onReviewPerimeter/);
    expect(code).not.toMatch(/classifyScreeningPerimeter/);
    expect(code).not.toMatch(/amlCasesApi\./);
  });

  it("offers the review only to a reviewer or the MLRO, and says who otherwise", () => {
    const code = strip(cardSrc);
    expect(code).toMatch(/const canClassify = actor\.isReviewer \|\| actor\.isMlro/);
    expect(code).toMatch(/A reviewer or the MLRO records this classification/);
  });
});
