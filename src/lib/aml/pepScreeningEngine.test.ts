import { describe, expect, it } from "vitest";
import {
  SERVER_UNREACHABLE_SOURCES,
  buildScreeningRun,
  runIsEvidence,
  runToMethodDraft,
  type PepScreeningCandidate,
  type PepScreeningSourceResult,
} from "@/lib/aml/pepScreeningEngine";
import { PEP_SOURCE_KINDS } from "@/lib/aml/pepEvidence";
import { PEP_INDEX_SOURCES } from "@/lib/aml/pepOfficeholderIndex";

/**
 * The engine screens. It never determines.
 *
 * An automated search that finds nothing has established nothing about the
 * person: it searched some registers and not others, and it cannot see a
 * foreign office it does not hold, a family relationship nobody publishes, or
 * a name spelled differently in the source.
 */

const source = (over: Partial<PepScreeningSourceResult> = {}): PepScreeningSourceResult => ({
  key: "wikidata_au_public_office",
  label: "Australian public office holders",
  status: "searched",
  coverage: "offices whose jurisdiction is Australia",
  excludes: "family members and close associates",
  foundCount: 0,
  asAt: "2026-08-19",
  ...over,
});

const candidate = (over: Partial<PepScreeningCandidate> = {}): PepScreeningCandidate => ({
  id: "wikidata_au_public_office:Q42",
  sourceKey: "wikidata_au_public_office",
  name: "Pat Example",
  aliases: [],
  positionTitle: "member of the Australian Senate",
  jurisdiction: "Australia",
  positionStart: "2016-07-02",
  positionEnd: null,
  currentlyHeld: true,
  confirmUrl: "https://en.wikipedia.org/wiki/Pat_Example",
  score: 0.94,
  ...over,
});

/* A declaration is `yes | no | null`, so the fixture is typed as the engine's
   own shape. `as const` alone narrows `answer` to "no" and makes the "declared
   yes" case below unassignable. */
type DeclarationInput = { answered: boolean; answer: "yes" | "no" | null; summary?: string | null };
const answered: DeclarationInput = { answered: true, answer: "no", summary: "The customer said no." };

const run = (over: Parameters<typeof buildScreeningRun>[0] extends never ? never : Partial<{
  searchedNames: string[];
  sources: PepScreeningSourceResult[];
  candidates: PepScreeningCandidate[];
  sanctionsSignal: "none" | "candidate" | "confirmed";
  declaration: typeof answered | null;
}> = {}) => buildScreeningRun({
  searchedNames: ["Pat Example"],
  sources: [source()],
  candidates: [],
  sanctionsSignal: "none",
  declaration: answered,
  ...over,
});

/* ── The line, asserted ────────────────────────────────────────────────── */

describe("a screening verdict can never be read as a determination", () => {
  it("shares no value with the determination vocabulary", () => {
    // `pep_determinations.result` is `not_pep` | `pep`. If a verdict could
    // ever spell one of those, a search would become a conclusion by
    // vocabulary alone.
    const verdicts = new Set([
      run().verdict,
      run({ candidates: [candidate()] }).verdict,
      run({ sources: [source({ status: "unavailable" })] }).verdict,
      run({ searchedNames: [] }).verdict,
    ]);
    for (const v of verdicts) {
      expect(["not_pep", "pep"]).not.toContain(v);
      expect(v).not.toMatch(/clear|pass|clean|ok/i);
    }
  });

  it("no message anywhere asserts a clearance", () => {
    for (const r of [
      run(),
      run({ candidates: [candidate()] }),
      run({ sources: [source({ status: "unavailable" })] }),
      run({ sources: [source({ status: "failed" })] }),
      run({ searchedNames: [] }),
    ]) {
      expect(r.message).not.toMatch(/\bcleared\b|\bclearance\b/i);
      expect(r.message).not.toMatch(/\bis not a pep\b/i);
      expect(r.message).not.toMatch(/\bnot politically exposed\b/i);
    }
  });

  it("an empty result says it is about the SEARCH, not the person", () => {
    const r = run();
    expect(r.verdict).toBe("no_indicators");
    expect(r.message).toMatch(/about the search, not about the person/i);
    expect(r.message).toMatch(/does not clear anybody/i);
  });
});

/* ── Coverage travels ──────────────────────────────────────────────────── */

describe("what the run could not reach", () => {
  it("names every unreached source, and forces a manual review", () => {
    const r = run({
      sources: [source(), source({ key: "aph", label: "Parliament", status: "not_reachable" })],
    });
    expect(r.notReached).toContain("Parliament");
    expect(r.requiresManualReview).toBe(true);
  });

  it("a register that FAILED is not a register that was empty", () => {
    const r = run({ sources: [source({ status: "failed" })] });
    // Nothing was searched, so the run is incomplete rather than empty.
    expect(r.verdict).toBe("incomplete");
    expect(r.message).toMatch(/nothing was checked/i);
  });

  it("a run that searched nothing never reports no_indicators", () => {
    for (const status of ["unavailable", "failed", "not_reachable"] as const) {
      expect(run({ sources: [source({ status })] }).verdict).toBe("incomplete");
    }
  });

  it("with nothing unreached and nothing found, no manual review is forced", () => {
    // The one case where the engine does not insist — every source it names
    // was searched and the customer answered.
    const r = run({ sources: [source()], declaration: answered });
    expect(r.notReached).toEqual([]);
    expect(r.requiresManualReview).toBe(false);
  });

  it("a party with no searchable name is its own reading", () => {
    const r = run({ searchedNames: [] });
    expect(r.verdict).toBe("not_searchable");
    expect(r.candidates).toEqual([]);
    expect(r.requiresManualReview).toBe(true);
  });
});

/* ── Indicators ────────────────────────────────────────────────────────── */

describe("indicators are leads, never findings", () => {
  it("a candidate becomes a possible_match that says to confirm it", () => {
    const r = run({ candidates: [candidate()] });
    expect(r.verdict).toBe("indicators_found");
    const ind = r.indicators.find((i) => i.kind === "possible_match");
    expect(ind?.detail).toMatch(/confirm against the official register/i);
    expect(ind?.candidateId).toBe(candidate().id);
  });

  it("a confirmed sanctions match is a signal in one direction only", () => {
    const r = run({ sanctionsSignal: "confirmed" });
    const ind = r.indicators.find((i) => i.kind === "sanctions_signal");
    expect(ind?.detail).toMatch(/not itself the determination/i);
  });

  it("a clear sanctions result says nothing at all", () => {
    // "Screened, no match" carries no information about political exposure.
    expect(run({ sanctionsSignal: "none" }).indicators
      .some((i) => i.kind === "sanctions_signal")).toBe(false);
  });

  it("an unanswered declaration is a COVERAGE GAP, not a no", () => {
    const r = run({ declaration: null });
    const ind = r.indicators.find((i) => i.key === "declaration:unanswered");
    expect(ind?.kind).toBe("coverage_gap");
    expect(ind?.detail).toMatch(/is not a declaration that they are not/i);
    expect(r.requiresManualReview).toBe(true);
  });

  it("a declared yes is an indicator to consider", () => {
    const r = run({ declaration: { answered: true, answer: "yes", summary: "Held office." } });
    expect(r.verdict).toBe("indicators_found");
    expect(r.indicators.some((i) => i.kind === "declaration")).toBe(true);
  });
});

/* ── The run as evidence ───────────────────────────────────────────────── */

describe("a run becomes a source row, and only when it searched something", () => {
  it("a run that searched nothing is not evidence", () => {
    expect(runIsEvidence(run({ sources: [source({ status: "failed" })] }))).toBe(false);
    expect(runIsEvidence(run({ searchedNames: [] }))).toBe(false);
  });

  it("a completed run is evidence, and names the registers it read", () => {
    const r = run();
    expect(runIsEvidence(r)).toBe(true);
    const draft = runToMethodDraft(r);
    expect(draft.source).toContain("Australian public office holders");
    expect(draft.reference).toBe("Pat Example");
    expect(draft.result).toMatch(/no entry returned/i);
    // A source kind the evidence contract actually accepts.
    expect(PEP_SOURCE_KINDS).toContain(draft.kind as never);
  });

  it("the drafted result states what came back, never a conclusion", () => {
    const draft = runToMethodDraft(run({ candidates: [candidate()] }));
    expect(draft.result).toMatch(/possible match/i);
    expect(draft.result).not.toMatch(/not a pep|cleared/i);
  });

  it("only the searched registers are named in the source row", () => {
    // Naming a register that was never read would put a line in the record
    // that reads exactly like a check.
    const draft = runToMethodDraft(run({
      sources: [source(), source({ key: "x", label: "Unread register", status: "unavailable" })],
    }));
    expect(draft.source).not.toContain("Unread register");
  });
});

describe("a register that was searched but is out of date", () => {
  it("is a gap in the SEARCH, and never turns an empty result into a finding", () => {
    /*
     * A stale office-holder register is not a finding about the customer. It
     * is a fact about our loader, and reporting it as `indicators_found`
     * would put our infrastructure into a sentence about a person.
     *
     * It IS a reason for somebody to look: those rows were current on the day
     * of the load, and every one of them still says the seat is held.
     */
    const r = run({ sources: [source({ currency: "stale", detail: "Last loaded 2026-02-01, 200 days ago." })] });
    expect(r.verdict).toBe("no_indicators");
    const gap = r.indicators.find((i) => i.key === "stale:wikidata_au_public_office");
    expect(gap?.kind).toBe("coverage_gap");
    expect(gap?.headline).toMatch(/is out of date/i);
    expect(gap?.detail).toMatch(/what it returned is real/i);
    expect(r.requiresManualReview).toBe(true);
  });

  it("one missed weekly run is not a hole in the search", () => {
    // `ageing` gets its sentence on the source row and no gap. A gap for
    // every slightly-late refresh is a gap nobody reads.
    const r = run({ sources: [source({ currency: "ageing" })] });
    expect(r.indicators.some((i) => i.key?.startsWith("stale:"))).toBe(false);
    expect(r.requiresManualReview).toBe(false);
  });

  it("a fresh register says nothing about its freshness", () => {
    const r = run({ sources: [source({ currency: "fresh" })] });
    expect(r.indicators.some((i) => i.key?.startsWith("stale:"))).toBe(false);
  });

  it("an unsearched register is not reported as a stale one", () => {
    // Different facts, different remedies: one is reloaded, one is repaired.
    const r = run({ sources: [source({ status: "unavailable", currency: "stale" })] });
    expect(r.indicators.some((i) => i.key?.startsWith("stale:"))).toBe(false);
    expect(r.verdict).toBe("incomplete");
  });
});

describe("the sources a server cannot reach", () => {
  it("are declared, with what they hold and why they were not searched", () => {
    expect(SERVER_UNREACHABLE_SOURCES.length).toBeGreaterThan(0);
    for (const s of SERVER_UNREACHABLE_SOURCES) {
      expect(s.coverage.length).toBeGreaterThan(10);
      expect(s.excludes.length).toBeGreaterThan(10);
      expect(s.detail).toMatch(/blocks automated requests/i);
    }
  });

  it("a register the index loads is never also declared out of reach", () => {
    /*
     * `aph_members` sat in that list saying "Blocks automated requests"
     * while Parliament published its register as a CSV that downloads on
     * every attempt. The sentence was true about the WEBSITE and was being
     * used as a statement about the DATASET, and the cost was not cosmetic:
     * the product named an authoritative federal register as unreachable
     * and sent operators to open it by hand, one URL away from a source it
     * could have been searching all along.
     *
     * The two lists answer opposite questions — "what we read for you" and
     * "what you must read yourself" — so nothing may appear in both, under
     * any spelling.
     */
    const loaded = PEP_INDEX_SOURCES.map((s) => s.code);
    expect(loaded).toContain("aph_commonwealth_parliament");
    const key = (s: string) => s.replace(/[^a-z]/g, "");
    for (const unreachable of SERVER_UNREACHABLE_SOURCES) {
      for (const code of loaded) {
        expect(key(code).includes(key(unreachable.key))
          || key(unreachable.key).includes(key(code))).toBe(false);
      }
    }
  });
});

describe("the two index sources are not the same kind of thing", () => {
  it("the authoritative one says plainly that it holds no former office holder", () => {
    // It is a snapshot of who sits today. AUSTRAC is explicit that leaving
    // office does not end the risk, so the narrower coverage of the more
    // authoritative source has to be stated, not implied by its absence.
    const aph = PEP_INDEX_SOURCES.find((s) => s.code === "aph_commonwealth_parliament");
    expect(aph?.collaborative).toBe(false);
    expect(aph?.excludes).toMatch(/former members and senators/i);
    expect(aph?.excludes).toMatch(/family members and close associates/i);
  });

  it("neither source's coverage prose counts anything", () => {
    // Everything countable is measured by the loader and rendered from the
    // sync row. A number in a sentence is a claim nobody can check, and
    // this index shipped one once: 1,254 people across two offices, under
    // prose promising ministers, judges and every state.
    for (const s of PEP_INDEX_SOURCES) {
      expect(s.covers).not.toMatch(/\d/);
      expect(s.excludes).not.toMatch(/\d/);
    }
  });
});
