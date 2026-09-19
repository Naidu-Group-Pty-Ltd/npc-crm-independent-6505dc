import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PEP_INDEX_CHANGE_ALERT_TITLE,
  changeSeverity,
  detectIndexChange,
  type IndexMatch,
} from "@/lib/aml/pepIndexChange";

/**
 * A refresh is a monitoring event.
 *
 * ── The window this closes ────────────────────────────────────────────
 * Political exposure is not established once at onboarding. A customer
 * determined not to be a PEP in March and elected in September is a PEP from
 * September, and knowing that is ongoing CDD.
 *
 * What existed was a review DATE: every determination, `not_pep` included,
 * carries `review_due_at` twelve months out and monitoring alerts when it
 * lapses. Necessary, and on its own a window of up to a year in which a
 * customer can take public office with nothing noticing — while the index
 * reloaded every week and nobody asked it whether any name in it now matched
 * somebody already screened.
 *
 * ── The line it must not cross ────────────────────────────────────────
 * It raises an alert. It writes no determination, moves no standing
 * conclusion and supersedes nothing.
 */

const RUN_AT = "2026-03-01T00:00:00.000Z";
const match = (over: Partial<IndexMatch> = {}): IndexMatch => ({
  id: "wikidata_au_public_office:Q42",
  sourceCode: "wikidata_au_public_office",
  name: "Pat Example",
  positionTitle: "member of the Australian Senate",
  rowCreatedAt: "2026-08-01T00:00:00.000Z",
  score: 0.94,
  ...over,
});

describe("a case nobody has screened is not a case that has changed", () => {
  it("reports it as not comparable, and raises nothing", () => {
    /*
     * Unscreened is a different state with a different remedy. Sweeping it in
     * here would report every unscreened party as a change and bury the ones
     * that are.
     */
    for (const prior of [null, { candidateIds: [], runAt: null }]) {
      const c = detectIndexChange({ prior, currentMatches: [match()] });
      expect(c.reading).toBe("no_prior_screening");
      expect(c.newCandidates).toEqual([]);
      expect(changeSeverity({ change: c, standingResult: "not_pep" })).toBe(null);
    }
  });
});

describe("no change is a statement about two searches", () => {
  it("never says the party is still clear", () => {
    const c = detectIndexChange({
      prior: { candidateIds: ["wikidata_au_public_office:Q42"], runAt: RUN_AT },
      currentMatches: [match()],
    });
    expect(c.reading).toBe("no_change");
    expect(c.summary).toMatch(/comparison of two\s+searches/i);
    expect(c.summary).not.toMatch(/\bclear\b|\bno match\b|\bnot a pep\b|\bstill\b.*\bsafe\b/i);
    expect(changeSeverity({ change: c, standingResult: null })).toBe(null);
  });
});

describe("a new candidate is a change in the SEARCH, not in the person", () => {
  /** A register that was already being searched at the time of the run. */
  const established = { wikidata_au_public_office: "2025-01-01T00:00:00.000Z" };

  it("a row created since the run, in an established register, is consistent with taking office", () => {
    const c = detectIndexChange({
      prior: { candidateIds: [], runAt: RUN_AT },
      currentMatches: [match({ rowCreatedAt: "2026-08-01T00:00:00.000Z" })],
      sourceFirstLoaded: established,
    });
    expect(c.reading).toBe("new_candidates");
    expect(c.newCandidates[0].origin).toBe("entered_since");
    expect(c.summary).toMatch(/consistent with a person having taken office/i);
  });

  it("a whole register added since the run says the COVERAGE grew, not the person", () => {
    /*
     * The reading that would have been wrong exactly where it matters most.
     *
     * Checked against production: 226 rows entered the index in the hour
     * after the only screening runs on file, because the Parliament register
     * was loaded for the first time. Every one of those rows is newer than
     * the run and not one of them is a person who took office.
     *
     * A bulk register addition is when the most cases change at once, so a
     * reading that mislabels it is wrong at its own peak — and "this person
     * has just taken office" is precisely the sentence that sends an operator
     * into the wrong enquiry.
     */
    const c = detectIndexChange({
      prior: { candidateIds: [], runAt: RUN_AT },
      currentMatches: [match({
        sourceCode: "aph_commonwealth_parliament",
        id: "aph_commonwealth_parliament:aph:house:example:pat:fake",
        rowCreatedAt: "2026-08-20T09:11:00.000Z",
      })],
      sourceFirstLoaded: { aph_commonwealth_parliament: "2026-08-20T09:11:18.000Z" },
    });
    expect(c.newCandidates[0].origin).toBe("source_added_since");
    expect(c.summary).toMatch(/was not being searched at all when that screening ran/i);
    expect(c.summary).toMatch(/nothing here is said about the person/i);
    expect(c.summary).not.toMatch(/taken office/i);
  });

  it("the register's FIRST load decides it, never its most recent", () => {
    // The weekly refresh moves "last loaded" every week. Keying on that would
    // make every register look new forever, and every candidate a coverage
    // artefact — the opposite error, equally silent.
    const c = detectIndexChange({
      prior: { candidateIds: [], runAt: RUN_AT },
      currentMatches: [match({ rowCreatedAt: "2026-08-01T00:00:00.000Z" })],
      sourceFirstLoaded: { wikidata_au_public_office: "2025-06-01T00:00:00.000Z" },
    });
    expect(c.newCandidates[0].origin).toBe("entered_since");
  });

  it("an unknown first-load date does not become a coverage excuse", () => {
    // With nothing recorded about the register, the row's own age is the only
    // evidence there is, and it is used as such.
    const c = detectIndexChange({
      prior: { candidateIds: [], runAt: RUN_AT },
      currentMatches: [match({ rowCreatedAt: "2026-08-01T00:00:00.000Z" })],
    });
    expect(c.newCandidates[0].origin).toBe("entered_since");
  });

  it("a row that was already there means the search changed, not the register", () => {
    /*
     * The distinction that makes the alert actionable. An operator told "this
     * person has just taken office" about a corrected spelling is sent into
     * the wrong enquiry entirely.
     */
    const c = detectIndexChange({
      prior: { candidateIds: [], runAt: RUN_AT },
      currentMatches: [match({ rowCreatedAt: "2025-01-01T00:00:00.000Z" })],
      sourceFirstLoaded: established,
    });
    expect(c.newCandidates[0].origin).toBe("already_present");
    expect(c.summary).toMatch(/corrected name or a new alias/i);
    expect(c.summary).not.toMatch(/taken office/i);
  });

  it("a row with no creation time is unknown, never assumed", () => {
    const c = detectIndexChange({
      prior: { candidateIds: [], runAt: RUN_AT },
      currentMatches: [match({ rowCreatedAt: null })],
      sourceFirstLoaded: established,
    });
    expect(c.newCandidates[0].origin).toBe("unknown");
    expect(c.summary).toMatch(/no record of when it was added/i);
  });

  it("never asserts anything about the person, and says the determination stands", () => {
    const c = detectIndexChange({
      prior: { candidateIds: [], runAt: RUN_AT }, currentMatches: [match()],
    });
    expect(c.summary).toMatch(/candidate to confirm against the official register/i);
    expect(c.summary).toMatch(/none of\s+them is a determination/i);
    expect(c.summary).toMatch(/stands\s+until a reviewer changes it/i);
    expect(c.summary).not.toMatch(/\bis a pep\b|\bnow a pep\b/i);
  });
});

describe("how loudly it is raised", () => {
  const changed = detectIndexChange({
    prior: { candidateIds: [], runAt: RUN_AT }, currentMatches: [match()],
  });

  it("contradicting a recorded 'not a PEP' is the loudest case", () => {
    // The file says the question is settled. It is the only one where a new
    // match cuts against a conclusion somebody wrote down.
    expect(changeSeverity({ change: changed, standingResult: "not_pep" })).toBe("urgent");
  });

  it("a case nobody has determined is an ordinary lead", () => {
    expect(changeSeverity({ change: changed, standingResult: null })).toBe("high");
  });

  it("a further office on a known PEP is relevant, not news", () => {
    // It bears on the risk assessment and on enhanced due diligence. It is
    // not news about whether they are one.
    expect(changeSeverity({ change: changed, standingResult: "pep" })).toBe("normal");
  });

  it("severity never reverses anything — it only orders a queue", () => {
    for (const standing of ["pep", "not_pep", null] as const) {
      expect(changeSeverity({
        change: detectIndexChange({
          prior: { candidateIds: ["wikidata_au_public_office:Q42"], runAt: RUN_AT },
          currentMatches: [match()],
        }),
        standingResult: standing,
      })).toBe(null);
    }
  });
});

describe("the sweep, as wired", () => {
  const monitoring = readFileSync(
    join(__dirname, "../../../supabase/functions/aml-monitoring/index.ts"), "utf8");

  it("writes an alert and nothing else", () => {
    /*
     * The whole design position: only a reviewer or MLRO moves a standing
     * conclusion. A sweep that could write to `pep_determinations` would be
     * the automation reaching the determination, however carefully it did it.
     */
    const scan = monitoring.slice(
      monitoring.indexOf("Has the office-holder index started matching somebody?"),
      monitoring.indexOf("Escalate overdue existing-customer reviews"));
    expect(scan).toContain('from("alerts")');
    expect(scan).not.toMatch(/from\("pep_determinations"\)\s*\n?\s*\.(insert|update|upsert|delete)/);
    expect(scan).not.toContain("superseded_at:");
    // It READS the standing determination, only to decide how loudly to speak.
    expect(scan).toMatch(/from\("pep_determinations"\)\s*\n?\s*\.select/);
  });

  it("a failed index read is skipped, never counted as no change", () => {
    // Reporting a database fault as "no change" is how a broken sweep looks
    // exactly like a working one.
    const scan = monitoring.slice(
      monitoring.indexOf("Has the office-holder index started matching somebody?"));
    expect(scan).toMatch(/if \(idxErr\)/);
    expect(scan).toMatch(/pep index change scan: read failed/);
  });

  it("compares against the LATEST run per party, not every run", () => {
    expect(monitoring).toContain("latestByParty");
  });

  it("keys a register's novelty on its FIRST successful load", () => {
    // Ordered ascending and first-wins. Ordering the other way would key on
    // the most recent refresh and make every register permanently new.
    const scan = monitoring.slice(monitoring.indexOf("const sourceFirstLoaded"));
    expect(scan).toMatch(/\.eq\("status", "succeeded"\)/);
    expect(scan).toMatch(/ascending: true/);
    expect(scan).toContain("if (!(sync.source_code in sourceFirstLoaded))");
  });

  it("uses the shared admission floor rather than a re-typed threshold", () => {
    expect(monitoring).toContain("admitCandidate(m.score)");
  });

  it("the alert title is stable so a weekly sweep cannot spam", () => {
    expect(monitoring).toContain("PEP_INDEX_CHANGE_ALERT_TITLE");
    expect(PEP_INDEX_CHANGE_ALERT_TITLE).toBe(
      "Office-holder index now matches a screened party");
  });
});
