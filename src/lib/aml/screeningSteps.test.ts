import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_STEP, deriveScreeningPath, isOutstanding, STEP_STATE_LABEL,
} from "./screeningSteps.pure";
import { OBLIGATION_LABEL, OUTCOME_LABEL } from "./screeningResolution.pure";
import type { AmlScreeningStageSync } from "./amlCasesApi";
import type { AmlCaseScreeningPosition } from "./screeningScope";

/**
 * Stage 5 as a sequence.
 *
 * ── What was reported ─────────────────────────────────────────────────
 * A screen carrying, in this order: a next-action card, an "action
 * required" alert, a second next-action card, a classification prompt, a
 * screening scope, a required-determinations list, a not-required
 * collapse, a perimeter statement, an answers collapse, a people list, a
 * sanctions requirement card, a party panel with two more buttons, an empty
 * checks panel and an ownership panel.
 *
 * On `AML-2026-00005` all of it reduced to ONE act: record a PEP
 * determination for one party. "Record PEP determination" appeared four
 * times in four different words, and everything else on the page was
 * already settled — which the page never said.
 *
 * These tests hold the arrangement, not the compliance decisions. The
 * decisions are the server's and are tested where they are made.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

const scope = (
  key: string, required: boolean, reason: string, reasonCode = "",
) => ({
  scope: key, required, optional: !required,
  state: required ? "required" : "not_required",
  reason_code: reasonCode, reason,
} as never);

const subject = (over: Record<string, unknown> = {}) => ({
  id: "s1", name: "Rugesh Naidu", partyType: "primary_subject",
  required: false, state: "not_required",
  sanctions: { state: "not_required", resolved: false, detail: "not required" },
  pep: { resolved: false, detail: "outstanding" },
  outstanding: ["pep"],
  ...over,
} as never);

const action = (key: string, over: Record<string, unknown> = {}) => ({
  key, label: "Do it", headline: "Do it", detail: "…", owner: "reviewer", ...over,
} as never);

/** The production row: reopened, enquiry-only, one party, PEP outstanding. */
const productionSync = (over: Partial<AmlScreeningStageSync> = {}): AmlScreeningStageSync => ({
  enrolled: 1,
  subjects: [],
  policy: { summary: "Reduced scope: sanctions and PEP only.", policyVersion: "2026.08-1",
    notRequired: [], evidence: {} } as never,
  scopes: [
    scope("sanctions", false,
      "This record exists for an enquiry or quotation only.", "perimeter:enquiry_only"),
    scope("pep", true, "A determination must be established for every customer.",
      "pep_determination_required"),
    scope("adverse_media", false, "Not triggered for this profile.", "risk_not_triggered"),
    scope("watchlist", false, "Not triggered for this profile.", "risk_not_triggered"),
  ],
  perimeter: {
    classification: "outside_perimeter", classified: true, reason_code: "enquiry_only",
    scopes_excluded: ["sanctions"], recorded_by_label: "Rugesh Naidu",
    recorded_at: "2026-08-19T12:19:45.727Z",
  } as never,
  policy_version: "2026.08-1",
  provider_ready: false,
  provider_relevant: false,
  next_action: action("record_pep"),
  decision_recorded: false,
  scope_changed: [],
  case_closed: false,
  ...over,
} as AmlScreeningStageSync);

const productionPosition = (
  over: Partial<AmlCaseScreeningPosition> = {},
): AmlCaseScreeningPosition => ({
  subjects: [subject()],
  facts: {} as never,
  read: true,
  ...over,
} as AmlCaseScreeningPosition);

const path = (
  sync = productionSync(), position = productionPosition(),
) => deriveScreeningPath({ sync, position });

/* ── 1. The reported case reduces to one step ─────────────────────────── */

describe("the production case", () => {
  it("puts the operator on the PEP step, because that is what the server asks for", () => {
    const p = path();
    expect(p.currentKey).toBe("pep");
    expect(p.steps.find((s) => s.key === "pep")!.blocking).toBe(true);
  });

  it("still raises the reopened enquiry, without letting it outrank the ask", () => {
    /*
     * Both are true on this case and the page must say both: the recorded
     * perimeter is an enquiry the reviewer should confirm, and the server is
     * asking for the determination. The confirmation is OUTSTANDING (it is
     * not counted as settled) and NOT blocking (it does not take the pointer
     * off what the server asked for).
     */
    const perimeter = path().steps.find((s) => s.key === "perimeter")!;
    expect(perimeter.state).toBe("review");
    expect(perimeter.blocking).toBe(false);
    expect(isOutstanding(perimeter.state)).toBe(true);
    expect(path().currentKey).toBe("pep");
  });

  it("carries the server's action on that step and on no other", () => {
    const withAction = path().steps.filter((s) => s.action !== null);
    expect(withAction.map((s) => s.key)).toEqual(["pep"]);
  });

  it("settles every other step, and says which are DONE and which are NOT REQUIRED", () => {
    const byKey = Object.fromEntries(path().steps.map((s) => [s.key, s.state]));
    expect(byKey.perimeter).toBe("review");
    expect(byKey.parties).toBe("done");
    // The whole point: an obligation that never arose is not a completed one.
    expect(byKey.sanctions).toBe("not_required");
    expect(byKey.resolve).toBe("not_required");
    /*
     * "Do this now", not "Blocked".
     *
     * The server's action on this case IS the PEP determination, so the step
     * it points at is the current one. It used to keep a red BLOCKED badge
     * and a warning marker while the operator was being asked to do it,
     * because the promotion to `current` was guarded by
     * `!isOutstanding(s.state)` — which only ever upgraded a step that was
     * already settled.
     *
     * A determination that is owed and has not been made is work. The one
     * thing that genuinely blocks it — having nobody enrolled to determine
     * against — belongs to the parties step, and is asserted below.
     */
    expect(byKey.pep).toBe("current");
    expect(path().steps.find((s) => s.key === "pep")!.blockedBy).toBeNull();
  });

  it("a step is only blocked when it can say what is blocking it", () => {
    // The rule one way round: a red badge with no obstacle named is an
    // instruction to go and look for one.
    for (const step of path().steps) {
      if (step.state === "blocked") expect(step.blockedBy).toBeTruthy();
      else expect(step.blockedBy).toBeNull();
    }
  });

  it("counts the settled steps honestly", () => {
    const p = path();
    // Two are outstanding: the determination, and the classification to confirm.
    expect(p.settled).toBe(p.total - 2);
    expect(p.steps.filter((s) => isOutstanding(s.state)).map((s) => s.key))
      .toEqual(["perimeter", "pep"]);
    expect(p.complete).toBe(false);
  });

  it("never renders adverse media or watchlists as steps when nobody owes them", () => {
    expect(path().steps.map((s) => s.key)).not.toContain("other_checks");
  });

  it("says nobody was screened rather than that screening passed", () => {
    const sanctions = path().steps.find((s) => s.key === "sanctions")!;
    expect(sanctions.summary).toMatch(/enquiry|quotation/i);
    expect(sanctions.summary).not.toMatch(/\bclear\b|no match|passed/i);
  });
});

/* ── 2. The server owns "what next" ───────────────────────────────────── */

describe("the server decides the current step", () => {
  it("follows next_action even when the local order would have said otherwise", () => {
    /*
     * Sanctions required and unscreened — the local order would put the
     * operator there. The server is asking for adjudication, so that wins:
     * the spine may be wrong about ordering; it must never ask for something
     * the server is not asking for.
     */
    const sync = productionSync({
      scopes: [
        scope("sanctions", true, "TFS applies.", "tfs_obligation"),
        scope("pep", true, "Owed.", "pep_determination_required"),
      ],
      provider_relevant: true, provider_ready: true,
      next_action: action("adjudicate_match"),
    });
    const position = productionPosition({
      subjects: [subject({
        required: true, state: "possible_match",
        sanctions: { state: "possible_match", resolved: false, detail: "candidate" },
      })],
    });
    expect(deriveScreeningPath({ sync, position }).currentKey).toBe("resolve");
  });

  it("maps every action key the server can emit", () => {
    /*
     * A key with no entry resolves to `undefined`, which reads as "no step"
     * — the path would go quiet on exactly the action somebody added.
     * Read from the server's own union so a new key fails here.
     */
    const policy = strip(read("supabase/functions/_shared/aml/screeningPolicy.pure.ts"));
    const from = policy.indexOf("export type ScreeningNextActionKey =");
    const union = policy.slice(from, policy.indexOf(";", from));
    const keys = (union.match(/"([a-z_]+)"/g) ?? []).map((m) => m.replace(/"/g, ""));
    expect(keys).toContain("record_pep");
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(Object.keys(ACTION_STEP)).toContain(k);
  });

  it("a closed case has no current step at all", () => {
    const p = path(productionSync({
      case_closed: true, next_action: action("reopen_case"),
    }));
    expect(p.currentKey).toBeNull();
    expect(p.complete).toBe(false);
  });

  it("a settled stage has no current step and reports complete", () => {
    const sync = productionSync({ next_action: action("none", { label: null }) });
    const position = productionPosition({
      subjects: [subject({ pep: { resolved: true, detail: "not a PEP" } })],
    });
    const p = deriveScreeningPath({ sync, position });
    expect(p.currentKey).toBeNull();
    expect(p.complete).toBe(true);
  });
});

/* ── 3. Nothing is settled by omission ────────────────────────────────── */

describe("absence is never a pass", () => {
  it("an unread party list is unknown, not empty", () => {
    const p = path(productionSync(), productionPosition({ subjects: [], read: false }));
    const parties = p.steps.find((s) => s.key === "parties")!;
    expect(parties.state).toBe("unknown");
    expect(isOutstanding(parties.state)).toBe(true);
    expect(parties.summary).toMatch(/not evidence/i);
  });

  it("nobody enrolled blocks, and says so about the determinations too", () => {
    const p = path(productionSync(), productionPosition({ subjects: [] }));
    expect(p.steps.find((s) => s.key === "parties")!.state).toBe("blocked");
    expect(p.steps.find((s) => s.key === "pep")!.summary).toMatch(/nobody is enrolled/i);
  });

  it("an unclassified perimeter asks for the decision and assumes nothing", () => {
    const p = path(productionSync({
      perimeter: {
        classification: "designated_service", classified: false, reason_code: null,
        scopes_excluded: [], recorded_by_label: null, recorded_at: null,
      } as never,
    }));
    const step = p.steps.find((s) => s.key === "perimeter")!;
    expect(step.state).toBe("current");
    expect(step.summary).toMatch(/inside the perimeter/i);
    expect(step.summary).toMatch(/required/i);
  });

  it("a reopened enquiry re-asks the classification without changing it", () => {
    const step = path().steps.find((s) => s.key === "perimeter")!;
    expect(step.state).toBe("review");
    expect(step.summary).toMatch(/reopened and is being worked again/i);
    // The recorded finding is reported verbatim — nothing is inferred from
    // the reopen, and the exemption still stands until somebody records
    // another classification.
    expect(step.detail.join(" ")).toMatch(/OUTSIDE the perimeter/);
    expect(path().steps.find((s) => s.key === "sanctions")!.state).toBe("not_required");
  });

  it("a closed enquiry is not asked to confirm anything", () => {
    // A retained record is not a path in progress.
    const closed = path(productionSync({
      case_closed: true, next_action: action("reopen_case"),
    })).steps.find((s) => s.key === "perimeter")!;
    expect(closed.state).toBe("done");
  });
});

/* ── 3b. A candidate is not a finding ─────────────────────────────────── */

describe("candidate and finding are different words", () => {
  const screened = (state: string) => ({
    sync: productionSync({
      scopes: [
        scope("sanctions", true, "TFS applies.", "tfs_obligation"),
        scope("pep", true, "Owed.", "pep_determination_required"),
      ],
      provider_relevant: true, provider_ready: true,
      next_action: action("adjudicate_match"),
    }),
    position: productionPosition({
      subjects: [subject({
        required: true, state,
        sanctions: { state, resolved: false, detail: "" },
        pep: { resolved: true, detail: "not a PEP" },
      })],
    }),
  });

  it("a possible match is a candidate — never announced as a finding", () => {
    const p = deriveScreeningPath(screened("possible_match"));
    expect(p.finding).toBe(false);
    expect(p.steps.find((s) => s.key === "resolve")!.summary).toMatch(/candidate/i);
  });

  it("a confirmed match is a finding", () => {
    const p = deriveScreeningPath(screened("confirmed_match"));
    expect(p.finding).toBe(true);
  });

  it("nothing returned is not a finding either", () => {
    expect(path().finding).toBe(false);
  });
});

/* ── 4. The two vocabularies stay apart ───────────────────────────────── */

describe("obligation and outcome never share a word", () => {
  it("no step state is spelled like an obligation or an outcome label", () => {
    /*
     * The rule Stage 5 is built on: `not required` is an OBLIGATION,
     * `no match` is an OUTCOME, and a step state is neither. The one word
     * they may share is "Not required" itself, which is the obligation
     * reading deliberately carried through — a step nobody owes must not be
     * ticked as done.
     */
    const outcomes = Object.values(OUTCOME_LABEL).map((v) => v.toLowerCase());
    const states = Object.entries(STEP_STATE_LABEL)
      .filter(([k]) => k !== "not_required")
      .map(([, v]) => v.toLowerCase());
    for (const s of states) expect(outcomes).not.toContain(s);
  });

  it("keeps the not-required wording identical to the obligation vocabulary", () => {
    expect(STEP_STATE_LABEL.not_required).toBe(OBLIGATION_LABEL.not_required);
  });

  it("a not-required step is settled but never counted as work done", () => {
    const sanctions = path().steps.find((s) => s.key === "sanctions")!;
    expect(isOutstanding(sanctions.state)).toBe(false);
    expect(sanctions.state).not.toBe("done");
  });
});

/* ── 5. It derives nothing the server did not decide ──────────────────── */

describe("one compliance engine", () => {
  const src = strip(read("src/lib/aml/screeningSteps.pure.ts"));

  it("reads obligations through buildDeterminationRows and nowhere else", () => {
    expect(src).toMatch(/buildDeterminationRows/);
    // No local re-derivation of whether a scope is owed.
    expect(src).not.toMatch(/riskRating|risk_rating/);
    expect(src).not.toMatch(/required\s*=\s*(true|false)\s*;/);
  });

  it("performs nothing and persists nothing", () => {
    expect(src).not.toMatch(/fetch\(|await |\.from\(|localStorage/);
    // Types only — importing the client itself is how a pure module stops
    // being one.
    expect(src).toMatch(/import type \{[\s\S]*?\} from "\.\/amlCasesApi"/);
  });

  it("cannot invent an action", () => {
    // Every action on a step is the server's own object, by identity.
    expect(src).toMatch(/action: action && ACTION_STEP\[action\.key\] === s\.key \? action : null/);
  });
});

/* ── 6. Screened scopes appear when, and only when, they are owed ─────── */

describe("risk-triggered checks", () => {
  const withAdverse = productionSync({
    scopes: [
      scope("sanctions", true, "TFS applies.", "tfs_obligation"),
      scope("pep", true, "Owed.", "pep_determination_required"),
      scope("adverse_media", true, "High risk.", "risk_triggered"),
      scope("watchlist", false, "Not triggered.", "risk_not_triggered"),
    ],
    provider_relevant: true, provider_ready: true,
  });

  it("adds one step for the risk-triggered checks that are owed", () => {
    const p = deriveScreeningPath({
      sync: withAdverse,
      position: productionPosition({ subjects: [subject({ required: true })] }),
    });
    expect(p.steps.map((s) => s.key)).toContain("other_checks");
    expect(p.steps.find((s) => s.key === "other_checks")!.state).not.toBe("not_required");
  });

  it("numbers the steps contiguously whichever ones apply", () => {
    const p = deriveScreeningPath({
      sync: withAdverse,
      position: productionPosition({ subjects: [subject({ required: true })] }),
    });
    expect(p.steps.map((s) => s.number)).toEqual(p.steps.map((_, i) => i + 1));
    expect(p.total).toBe(p.steps.length);
  });
});
