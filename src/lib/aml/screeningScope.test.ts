/**
 * Stage 5 scope — and the two things it must never do.
 *
 * ── Correction one ────────────────────────────────────────────────────
 * An earlier revision of this file asserted `pep=no → PEP waived`. Those
 * assertions were wrong and they are gone. A customer's declaration is
 * EVIDENCE that may support a determination; it is never the determination
 * and never an exemption from making one. PEP and targeted financial
 * sanctions are the mandatory baseline: they are ESTABLISHED, not skipped.
 * Only adverse media and internal watchlists are risk-based.
 *
 * ── Correction two ────────────────────────────────────────────────────
 * "The provider can run the check" and "the required determinations have
 * been made" are different questions with different failure modes.
 * `canExecute` and `canAdvance` must never be aliases, and the case that
 * proves it is a perfectly healthy provider with no result yet.
 *
 * The first two describe blocks are compliance invariants. If either ever
 * fails, the change that made it fail is wrong, not the test.
 */
import { describe, expect, it } from "vitest";

import {
  MANDATORY_DETERMINATIONS,
  WAIVABLE_SCREENING_SCOPES,
  deriveAmlScreeningScope,
  describeScreeningStage,
  readCaseScreeningPosition,
  type AmlPepDeterminationFacts,
  type AmlScreeningScopeFacts,
  type AmlScreeningSubjectFacts,
} from "./screeningScope";

const NOW = "2026-08-16T00:00:00.000Z";

const ready = {
  code: "ready" as const, label: "Ready to screen", detail: "…",
  canRun: true, blockers: [], owner: "none" as const,
};
const noDfat = {
  code: "lists_never_loaded" as const, label: "Screening is not configured",
  detail: "The DFAT sanctions list has never been successfully loaded.",
  canRun: false, blockers: ["The DFAT sanctions list has never been successfully loaded."],
  owner: "administrator" as const,
};

/** A current, in-date determination that the customer is not a PEP. */
const determinedNotPep: AmlPepDeterminationFacts = {
  result: "not_pep",
  method: "onboarding_declaration_supported",
  determinedAt: "2026-08-10T00:00:00.000Z",
  reviewDueAt: "2027-08-10T00:00:00.000Z",
  supersededAt: null,
};

const find = (d: ReturnType<typeof deriveAmlScreeningScope>, scope: string) =>
  d.determinations.find((x) => x.scope === scope);

/** An ordinary low-risk individual whose Stage 5 evidence is all present. */
const settled = (over: Partial<AmlScreeningScopeFacts> = {}): AmlScreeningScopeFacts => ({
  answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" },
  entityType: "individual",
  subjectType: "individual",
  riskRating: "low",
  enhancedDueDiligence: false,
  pepDetermination: determinedNotPep,
  sanctionsState: "clear",
  now: NOW,
  ...over,
});

/* ───────────────────────── A · B — the baseline ───────────────────────── */

describe("PEP and sanctions are the mandatory baseline", () => {
  it("A · neither is in the waivable set", () => {
    expect(WAIVABLE_SCREENING_SCOPES).not.toContain("pep");
    expect(WAIVABLE_SCREENING_SCOPES).not.toContain("sanctions");
    expect([...WAIVABLE_SCREENING_SCOPES].sort()).toEqual(["adverse_media", "watchlist"]);
  });

  it("B · both are declared mandatory determinations", () => {
    expect([...MANDATORY_DETERMINATIONS].sort()).toEqual(["pep", "sanctions"]);
  });

  it("A · no combination of answers, risk or entity ever waives either", () => {
    const answers = ["yes", "no", null, undefined] as const;
    for (const pep of answers) {
      for (const adverse of answers) {
        for (const riskRating of ["low", "medium", "high", "prohibited", null]) {
          for (const entityType of ["individual", "company", "trust", null]) {
            const where = `pep=${pep} adverse=${adverse} risk=${riskRating} entity=${entityType}`;
            const d = deriveAmlScreeningScope({
              answers: { pep, adverse }, riskRating, entityType, now: NOW,
            });
            const waived = d.notRequiredByPolicy.map((w) => w.scope);
            expect(waived, where).not.toContain("pep");
            expect(waived, where).not.toContain("sanctions");
            expect(find(d, "pep")?.required, where).toBe(true);
            expect(find(d, "sanctions")?.required, where).toBe(true);
          }
        }
      }
    }
  });

  it("B · never describes a mandatory determination as not required", () => {
    const d = deriveAmlScreeningScope(settled({ pepDetermination: null }));
    expect(d.summary).not.toMatch(/not required|waived|exempt/i);
    expect(find(d, "pep")!.detail).not.toMatch(/not required|waived|exempt/i);
  });
});

/* ────────────────── C · D · E — the declaration is evidence ────────────── */

describe("a client's declaration selects a route, never a waiver", () => {
  it("C · pep=no with no determination recorded does not resolve PEP", () => {
    const d = deriveAmlScreeningScope(settled({ pepDetermination: null }));
    const pep = find(d, "pep")!;
    expect(pep.required).toBe(true);
    expect(pep.resolved).toBe(false);
    expect(d.notRequiredByPolicy.map((w) => w.scope)).not.toContain("pep");
  });

  it("C · says the declaration supports the route but is not the outcome", () => {
    const d = deriveAmlScreeningScope(settled({ pepDetermination: null }));
    const outstanding = d.outstanding.find((o) => /PEP determination/i.test(o))!;
    expect(outstanding).toMatch(/declaration/i);
    expect(outstanding).toMatch(/not itself the determination/i);
  });

  it("C · a recorded determination on the declaration route does resolve it", () => {
    // The route is legitimate — what was missing was the recorded outcome.
    const d = deriveAmlScreeningScope(settled());
    const pep = find(d, "pep")!;
    expect(pep.resolved).toBe(true);
    expect(pep.basis).toMatch(/onboarding_declaration_supported/);
  });

  it("D · a missing determination does not complete Stage 5", () => {
    const d = deriveAmlScreeningScope(settled({ pepDetermination: null }), ready);
    expect(d.canAdvance).toBe(false);
    expect(describeScreeningStage(d, ready).canProceed).toBe(false);
  });

  it("E · a determination past its review date does not complete Stage 5", () => {
    const d = deriveAmlScreeningScope(settled({
      pepDetermination: { ...determinedNotPep, reviewDueAt: "2026-08-15T00:00:00.000Z" },
    }), ready);
    expect(find(d, "pep")!.resolved).toBe(false);
    expect(find(d, "pep")!.detail).toMatch(/past its review date/i);
    expect(d.canAdvance).toBe(false);
  });

  it("E · a superseded determination does not complete Stage 5", () => {
    const d = deriveAmlScreeningScope(settled({
      pepDetermination: { ...determinedNotPep, supersededAt: "2026-08-14T00:00:00.000Z" },
    }), ready);
    expect(find(d, "pep")!.resolved).toBe(false);
    expect(find(d, "pep")!.detail).toMatch(/superseded/i);
    expect(d.canAdvance).toBe(false);
  });

  it("E · an unresolved determination is not a determination", () => {
    const d = deriveAmlScreeningScope(settled({
      pepDetermination: { ...determinedNotPep, result: "unresolved" },
    }), ready);
    expect(find(d, "pep")!.resolved).toBe(false);
    expect(d.canAdvance).toBe(false);
  });
});

/* ──────────────── F — executing is not completing ──────────────────────── */

describe("canExecute and canAdvance are never aliases", () => {
  it("F · provider ready with no screening result: can execute, cannot advance", () => {
    const d = deriveAmlScreeningScope(
      settled({ sanctionsState: "not_started", pepDetermination: null }), ready);
    expect(d.canExecute).toBe(true);
    expect(d.canAdvance).toBe(false);
  });

  it("F · determinations resolved with a broken provider: cannot execute, can advance", () => {
    // The mirror image. Evidence already gathered is not un-gathered by a
    // provider that has since gone down.
    const d = deriveAmlScreeningScope(settled(), noDfat);
    expect(d.canExecute).toBe(false);
    expect(d.canAdvance).toBe(true);
  });

  it("F · an unread readiness never reports as executable", () => {
    expect(deriveAmlScreeningScope(settled()).canExecute).toBe(false);
    expect(deriveAmlScreeningScope(settled(), null).canExecute).toBe(false);
  });
});

/* ──────────────── G · H · I — sanctions outcomes ───────────────────────── */

describe("sanctions outcomes", () => {
  it("G · an error is never a clear result", () => {
    const d = deriveAmlScreeningScope(settled({ sanctionsState: "error" }), ready);
    expect(find(d, "sanctions")!.resolved).toBe(false);
    expect(find(d, "sanctions")!.detail).toMatch(/never a clear result/i);
    expect(d.canAdvance).toBe(false);
    expect(d.outstanding.some((o) => /must be re-run/i.test(o))).toBe(true);
  });

  it("H · a possible match blocks the stage and belongs to an analyst", () => {
    const d = deriveAmlScreeningScope(settled({ sanctionsState: "possible_match" }), ready);
    expect(d.canAdvance).toBe(false);
    expect(d.owner).toBe("analyst");
    expect(d.outstanding.some((o) => /Adjudicate/i.test(o))).toBe(true);
  });

  it("H · adjudicating a false positive to clear releases the stage", () => {
    const d = deriveAmlScreeningScope(settled({ sanctionsState: "clear" }), ready);
    expect(d.canAdvance).toBe(true);
  });

  it("I · a confirmed match resolves the determination but escalates", () => {
    // The trap: a confirmed TFS match IS a resolved determination, so
    // resolution alone must never read as "nothing to do".
    const d = deriveAmlScreeningScope(settled({ sanctionsState: "confirmed_match" }), ready);
    expect(find(d, "sanctions")!.resolved).toBe(true);
    expect(d.escalation).toMatch(/Compliance Officer/i);
    expect(d.owner).toBe("reviewer");
    const stage = describeScreeningStage(d, ready);
    expect(stage.headline).toMatch(/escalation required/i);
    expect(stage.whatHappensNext).toMatch(/does not permit the case to proceed to service/i);
  });

  it("I · a PEP finding escalates too", () => {
    const d = deriveAmlScreeningScope(settled({
      pepDetermination: { ...determinedNotPep, result: "pep" },
      adverseMediaState: "clear",
    }), ready);
    expect(find(d, "pep")!.resolved).toBe(true);
    expect(d.escalation).toMatch(/source of funds and source of wealth/i);
    expect(d.owner).toBe("reviewer");
  });
});

/* ──────────── J · K · P — adverse media is a policy decision ───────────── */

describe("adverse media comes from the risk policy, not from client.adverse", () => {
  it("J · standing it down cites the risk profile, never the client's answer", () => {
    const d = deriveAmlScreeningScope(settled());
    const stood = d.notRequiredByPolicy.find((w) => w.scope === "adverse_media")!;
    expect(stood.basis).toMatch(/current AML\/CTF policy/i);
    expect(stood.basis).toMatch(/not high risk/i);
    // Not "the customer said no".
    expect(stood.basis).not.toMatch(/declared|the customer answered/i);
  });

  const overriding: Array<[string, Partial<AmlScreeningScopeFacts>, RegExp]> = [
    ["high risk", { riskRating: "high" }, /high risk/],
    ["prohibited risk", { riskRating: "prohibited" }, /prohibited risk/],
    ["enhanced due diligence", { enhancedDueDiligence: true }, /enhanced due diligence/],
    ["a company customer", { entityType: "company" }, /company rather than an individual/],
    ["a trust customer", { entityType: "trust" }, /trust rather than an individual/],
    ["a PEP finding", {
      pepDetermination: { ...determinedNotPep, result: "pep" },
    }, /politically exposed person/],
    ["overseas funding", {
      answers: { pep: "no", adverse: "no", overseasFunding: "yes", thirdParty: "no" },
    }, /overseas/],
    ["a third party", {
      answers: { pep: "no", adverse: "no", overseasFunding: "no", thirdParty: "yes" },
    }, /third party/],
  ];

  it.each(overriding)(
    "J · %s keeps adverse media required despite adverse=no", (_n, over, reason) => {
      const d = deriveAmlScreeningScope(settled(over));
      const am = find(d, "adverse_media")!;
      expect(am.required).toBe(true);
      expect(am.resolved).toBe(false);
      expect(d.notRequiredByPolicy.map((w) => w.scope)).not.toContain("adverse_media");
      expect(am.basis).toMatch(reason);
      expect(d.canAdvance).toBe(false);
    },
  );

  it("P · an entity case is released only once the research is done", () => {
    const trust = settled({ entityType: "trust" });
    expect(deriveAmlScreeningScope(trust, ready).canAdvance).toBe(false);
    const done = deriveAmlScreeningScope(
      { ...trust, adverseMediaState: "clear" }, ready);
    expect(find(done, "adverse_media")!.resolved).toBe(true);
    expect(done.canAdvance).toBe(true);
  });

  it("J · names every reason, not just the first", () => {
    const d = deriveAmlScreeningScope(settled({ riskRating: "high", enhancedDueDiligence: true }));
    const am = find(d, "adverse_media")!;
    expect(am.basis).toMatch(/high risk/);
    expect(am.basis).toMatch(/enhanced due diligence/);
  });
});

describe("absence is never a negative answer", () => {
  it("K · an unread questionnaire stands nothing down", () => {
    for (const f of [null, undefined, { answers: null }]) {
      const d = deriveAmlScreeningScope(f as AmlScreeningScopeFacts, ready);
      expect(d.notRequiredByPolicy).toHaveLength(0);
      expect(find(d, "adverse_media")!.required).toBe(true);
      expect(find(d, "adverse_media")!.detail).toMatch(/has not been read/i);
      expect(d.canAdvance).toBe(false);
    }
  });

  it("K · a missing adverse answer is not an answer of 'no'", () => {
    for (const answers of [{ pep: "no" }, { adverse: null }, {}] as const) {
      const d = deriveAmlScreeningScope(settled({ answers }));
      expect(d.notRequiredByPolicy).toHaveLength(0);
    }
  });
});

/* ─────────── R · S — the right people, read from canonical rows ────────── */

describe("the case position aggregates the server's own subject list", () => {
  const subject = (over: Partial<AmlScreeningSubjectFacts> = {}): AmlScreeningSubjectFacts => ({
    id: "s1", name: "Alex Doe", partyType: "primary_subject",
    required: true, state: "completed", pepDetermination: determinedNotPep, ...over,
  });

  it("R · an unread subject list is not an empty one", () => {
    const p = readCaseScreeningPosition(null, NOW);
    expect(p.read).toBe(false);
    expect(p.facts.sanctionsState).toBe("not_started");
    expect(deriveAmlScreeningScope({ ...settled(), ...p.facts }, ready).canAdvance).toBe(false);
  });

  it("R · no required subject at all is 'nothing checked', never 'clear'", () => {
    const p = readCaseScreeningPosition([], NOW);
    expect(p.facts.sanctionsState).toBe("not_started");
    expect(p.facts.pepDetermination).toBeNull();
    expect(deriveAmlScreeningScope({ ...settled(), ...p.facts }, ready).canAdvance).toBe(false);
  });

  it("S · one outstanding co-purchaser holds the whole case open", () => {
    const p = readCaseScreeningPosition([
      subject(),
      subject({ id: "s2", name: "Sam Roe", partyType: "co_purchaser", state: "not_started" }),
    ], NOW);
    expect(p.facts.sanctionsState).toBe("not_started");
    const d = deriveAmlScreeningScope({ ...settled(), ...p.facts }, ready);
    expect(d.canAdvance).toBe(false);
    expect(p.subjects[1].outstanding).toContain("Run the sanctions check.");
  });

  it("S · one co-purchaser without a PEP determination holds it open too", () => {
    const p = readCaseScreeningPosition([
      subject(),
      subject({
        id: "s2", partyType: "beneficial_owner", state: "completed", pepDetermination: null,
      }),
    ], NOW);
    expect(p.facts.pepDetermination).toBeNull();
    expect(deriveAmlScreeningScope({ ...settled(), ...p.facts }, ready).canAdvance).toBe(false);
  });

  it("S · a party the server does not require does not hold it open", () => {
    const p = readCaseScreeningPosition([
      subject(),
      subject({ id: "s2", required: false, state: "not_required", pepDetermination: null }),
    ], NOW);
    expect(p.facts.sanctionsState).toBe("clear");
    expect(deriveAmlScreeningScope({ ...settled(), ...p.facts }, ready).canAdvance).toBe(true);
  });

  it("I · a confirmed match on one party escalates behind another's outstanding work", () => {
    // The trap the extra facts exist for: reporting only the most-blocking
    // state would have lost the confirmed match entirely.
    const p = readCaseScreeningPosition([
      subject({ state: "confirmed_match" }),
      subject({ id: "s2", partyType: "director", state: "not_started" }),
    ], NOW);
    expect(p.facts.sanctionsState).toBe("not_started");
    expect(p.facts.confirmedSanctionsMatch).toBe(true);
    const d = deriveAmlScreeningScope({ ...settled(), ...p.facts }, ready);
    expect(d.canAdvance).toBe(false);
    expect(d.escalation).toMatch(/Compliance Officer/i);
    expect(d.owner).toBe("reviewer");
  });

  it("I · a PEP finding on one party escalates behind another's outstanding work", () => {
    const p = readCaseScreeningPosition([
      subject({ pepDetermination: { ...determinedNotPep, result: "pep" } }),
      subject({ id: "s2", partyType: "trustee", pepDetermination: null }),
    ], NOW);
    expect(p.facts.pepFinding).toBe(true);
    const d = deriveAmlScreeningScope({ ...settled(), ...p.facts }, ready);
    expect(d.escalation).toMatch(/politically exposed person/i);
    // And it makes adverse media proportionate for the whole case.
    expect(find(d, "adverse_media")!.required).toBe(true);
    expect(d.notRequiredByPolicy).toHaveLength(0);
  });

  it("R · a possible match outranks an unstarted check for attention", () => {
    const p = readCaseScreeningPosition([
      subject({ state: "possible_match" }),
      subject({ id: "s2", state: "not_started" }),
    ], NOW);
    expect(p.facts.sanctionsState).toBe("possible_match");
  });

  it("R · an unknown subject state fails closed", () => {
    const p = readCaseScreeningPosition([subject({ state: "something_new" })], NOW);
    expect(p.facts.sanctionsState).toBe("not_started");
  });

  it("R · a stale determination on a screened party is not a determination", () => {
    const p = readCaseScreeningPosition([
      subject({ pepDetermination: { ...determinedNotPep, reviewDueAt: "2026-01-01T00:00:00.000Z" } }),
    ], NOW);
    expect(p.subjects[0].pep.resolved).toBe(false);
    expect(deriveAmlScreeningScope({ ...settled(), ...p.facts }, ready).canAdvance).toBe(false);
  });

  it("S · every required party is named with what it still needs", () => {
    const p = readCaseScreeningPosition([
      subject({ state: "not_started", pepDetermination: null }),
    ], NOW);
    expect(p.subjects[0].outstanding).toEqual([
      "Run the sanctions check.", "Record the PEP determination.",
    ]);
  });

  it("M · a fully settled multi-party case completes", () => {
    const p = readCaseScreeningPosition([
      subject(),
      subject({ id: "s2", partyType: "co_purchaser" }),
      subject({ id: "s3", partyType: "authorised_representative", state: "false_positive" }),
    ], NOW);
    const d = deriveAmlScreeningScope({ ...settled(), ...p.facts }, ready);
    expect(d.canAdvance).toBe(true);
    expect(d.escalation).toBeNull();
  });
});

/* ──────── L · M · N · O · Q — readiness, completion and Stage 6 ────────── */

describe("the stage description", () => {
  it("Q · never says 'not required' while the provider cannot run", () => {
    const d = describeScreeningStage(
      deriveAmlScreeningScope(settled({ sanctionsState: "not_started" }), noDfat), noDfat);
    expect(d.canProceed).toBe(false);
    expect(d.headline).toMatch(/cannot run/i);
    expect(d.detail).not.toMatch(/not required/i);
    expect(d.whatHappensNext).toMatch(/administrator/i);
    expect(d.whatHappensNext).toMatch(/No client action is required/i);
  });

  it("Q · a DFAT blocker is an administrator's, never the client's", () => {
    const d = deriveAmlScreeningScope(settled({ sanctionsState: "not_started" }), noDfat);
    expect(d.owner).toBe("administrator");
  });

  it("M · an ordinary low-risk case with its evidence in is complete", () => {
    const d = deriveAmlScreeningScope(settled(), ready);
    expect(d.canAdvance).toBe(true);
    expect(d.outstanding).toEqual([]);
    expect(d.owner).toBe("none");
    expect(describeScreeningStage(d, ready).headline).toBe("Stage 5 complete");
  });

  it("N · completion names Stage 6 as what happens next", () => {
    const next = describeScreeningStage(deriveAmlScreeningScope(settled(), ready), ready)
      .whatHappensNext;
    expect(next).toMatch(/Stage 6/);
    expect(next).toMatch(/Funding & transaction/);
  });

  it("O · completion is not approval and issues no Passport", () => {
    const next = describeScreeningStage(deriveAmlScreeningScope(settled(), ready), ready)
      .whatHappensNext;
    expect(next).toMatch(/not a service-gate decision/i);
    expect(next).toMatch(/Aurixa Compliance Passport/);
  });

  it("L · an incomplete stage says what to do next", () => {
    const d = deriveAmlScreeningScope(
      settled({ sanctionsState: "not_started", pepDetermination: null }), ready);
    const stage = describeScreeningStage(d, ready);
    expect(stage.canProceed).toBe(false);
    expect(stage.headline).toBe("Action required");
    expect(stage.whatHappensNext).toMatch(/Stage 6 becomes available/i);
  });

  it("every reading is renderable, and only a resolved case proceeds", () => {
    const cases: Array<[AmlScreeningScopeFacts | null, typeof ready | typeof noDfat | null]> = [
      [null, null], [null, ready], [settled(), ready], [settled(), noDfat],
      [settled({ sanctionsState: "error" }), ready],
      [settled({ sanctionsState: "confirmed_match" }), ready],
      [settled({ pepDetermination: null }), ready],
    ];
    for (const [f, r] of cases) {
      const d = deriveAmlScreeningScope(f, r);
      const stage = describeScreeningStage(d, r);
      expect(stage.headline).toBeTruthy();
      expect(stage.detail).toBeTruthy();
      expect(stage.whatHappensNext).toBeTruthy();
      expect(stage.canProceed).toBe(d.canAdvance);
      expect(d.canAdvance).toBe(d.determinations.every((x) => x.resolved));
    }
  });
});
