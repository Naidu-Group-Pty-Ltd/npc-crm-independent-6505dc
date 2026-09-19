import { describe, expect, it } from "vitest";
import {
  PEP_INDEX_SOURCES,
  candidateToMethodDraft,
  describeCoverage,
  indexIsUsable,
  searchVerdict,
  type PepIndexCandidate,
  type PepIndexCoverage,
} from "@/lib/aml/pepOfficeholderIndex";

/**
 * A hit is a candidate. A miss is nothing.
 *
 * The index is partial by construction, and the dangerous reading is the
 * EMPTY one: zero rows for a person the sources never covered looks exactly
 * like zero rows for a person who holds no office. This platform has already
 * shipped that shape once — `sanctions_entries` was empty from the day it
 * was built, and every screening against it would have cleared everybody.
 */

const candidate = (over: Partial<PepIndexCandidate> = {}): PepIndexCandidate => ({
  dateOfBirth: undefined,
  dob: undefined,
  externalId: "Q42",
  sourceCode: "wikidata_au_public_office",
  fullName: "Pat Example",
  aliases: ["Patricia Example"],
  positionTitle: "Member of the Australian House of Representatives",
  pepType: null,
  jurisdiction: "Australia",
  positionStart: "2016-07-02",
  positionEnd: null,
  currentlyHeld: true,
  confirmUrl: "https://en.wikipedia.org/wiki/Pat_Example",
  score: 0.94,
  ...over,
});

const coverage = (over: Partial<PepIndexCoverage> = {}): PepIndexCoverage => ({
  ...describeCoverage("wikidata_au_public_office", {
    entry_count: 12000, source_as_at: "2026-08-19",
    completed_at: "2026-08-19T00:00:00.000Z", status: "succeeded",
    detail: {
      office_count: 724, distinct_offices: 724,
      sample_offices: ["Prime Minister of Australia", "member of the Australian Senate"],
    },
  }),
  ...over,
});

describe("the empty reading is never a clearance", () => {
  it("says what the index does not cover, in the same breath", () => {
    const v = searchVerdict({
      hasSearchableName: true, candidates: [], coverage: [coverage()],
    });
    expect(v.reading).toBe("no_candidates");
    expect(v.message).toMatch(/not an answer/i);
    expect(v.message).toMatch(/family members/i);
    // The words that would turn a partial index into a determination.
    expect(v.message).not.toMatch(/\bclear\b/i);
    expect(v.message).not.toMatch(/not a pep/i);
    expect(v.message).not.toMatch(/no match/i);
  });

  it("carries the coverage even when there is nothing to show", () => {
    // This is the reading that needs it most.
    const v = searchVerdict({
      hasSearchableName: true, candidates: [], coverage: [coverage()],
    });
    expect(v.coverage).toHaveLength(1);
    expect(v.coverage[0].excludes).toMatch(/family members/i);
    expect(v.coverage[0].entryCount).toBe(12000);
    // Measured, not claimed.
    expect(v.coverage[0].officeCount).toBe(724);
    expect(v.coverage[0].sampleOffices).toContain("Prime Minister of Australia");
  });

  it("no reading anywhere can be paraphrased into a determination", () => {
    const readings = [
      searchVerdict({ hasSearchableName: false, candidates: [], coverage: [coverage()] }),
      searchVerdict({ hasSearchableName: true, candidates: [], coverage: [coverage()] }),
      searchVerdict({ hasSearchableName: true, candidates: [], coverage: [coverage({ entryCount: 0, lastSyncStatus: "never" })] }),
      searchVerdict({ hasSearchableName: true, candidates: [candidate()], coverage: [coverage()] }),
    ];
    for (const v of readings) {
      expect(v.message).not.toMatch(/\bclear(ed|ance)?\b/i);
      expect(v.message).not.toMatch(/\bis not a pep\b/i);
    }
  });
});

describe("an index that has not looked says so", () => {
  it("an index that never loaded is unavailable, not empty", () => {
    const v = searchVerdict({
      hasSearchableName: true, candidates: [],
      coverage: [coverage({ entryCount: 0, lastSyncStatus: "never" })],
    });
    expect(v.reading).toBe("unavailable");
    expect(v.message).toMatch(/has not loaded/i);
  });

  it("an index whose last load FAILED is unavailable too", () => {
    // A failed load is a technical condition. Reporting it as "nothing
    // found" is how an error becomes an outcome — the exact defect the
    // screening consumers had when they discarded a claim's error.
    const v = searchVerdict({
      hasSearchableName: true, candidates: [],
      coverage: [coverage({ entryCount: 12000, lastSyncStatus: "failed" })],
    });
    expect(v.reading).toBe("unavailable");
  });

  it("a running load beside no entries is still unavailable", () => {
    expect(indexIsUsable([coverage({ entryCount: 0, lastSyncStatus: "running" })])).toBe(false);
  });

  it("one usable source is enough", () => {
    expect(indexIsUsable([
      coverage({ lastSyncStatus: "failed" }),
      coverage({ sourceCode: "other", entryCount: 5, lastSyncStatus: "succeeded" }),
    ])).toBe(true);
  });

  it("a party with no searchable name is its own reading", () => {
    const v = searchVerdict({ hasSearchableName: false, candidates: [], coverage: [coverage()] });
    expect(v.reading).toBe("not_searchable");
    expect(v.candidates).toEqual([]);
  });
});

describe("a hit is a candidate", () => {
  it("says how many, and that they must be confirmed", () => {
    const v = searchVerdict({
      hasSearchableName: true, candidates: [candidate(), candidate({ externalId: "Q43" })],
      coverage: [coverage()],
    });
    expect(v.reading).toBe("candidates");
    expect(v.message).toMatch(/2 possible office holders/);
    expect(v.message).toMatch(/confirm against the official register/i);
  });

  it("counts one candidate in the singular", () => {
    expect(searchVerdict({
      hasSearchableName: true, candidates: [candidate()], coverage: [coverage()],
    }).message).toMatch(/1 possible office holder\b/);
  });
});

describe("a candidate becomes a source only through the operator", () => {
  it("prefills the office and the identity, and leaves the RESULT empty", () => {
    // The platform writing what the operator saw is what would make the
    // record indefensible.
    const draft = candidateToMethodDraft(candidate());
    expect(draft.result).toBe("");
    expect(draft.kind).toBe("official_register");
    expect(draft.source).toMatch(/House of Representatives/);
    expect(draft.reference).toContain("Pat Example");
  });

  it("carries current-or-former into the reference", () => {
    expect(candidateToMethodDraft(candidate({
      currentlyHeld: false, positionEnd: "2022-05-21",
    })).reference).toContain("former");
    expect(candidateToMethodDraft(candidate()).reference).toContain("current");
  });

  it("never names the index itself as the source", () => {
    // The index is a lead; the official register is the source. A row
    // reading "found in our PEP index" is a record of nothing.
    const draft = candidateToMethodDraft(candidate());
    expect(draft.source.toLowerCase()).not.toContain("wikidata");
    expect(draft.source.toLowerCase()).not.toContain("index");
  });
});

describe("coverage prose", () => {
  it("names what each source excludes, and whether it is collaboratively edited", () => {
    for (const s of PEP_INDEX_SOURCES) {
      const c = describeCoverage(s.code, null);
      expect(c.covers.length).toBeGreaterThan(20);
      expect(c.excludes.length).toBeGreaterThan(20);
      expect(c.lastSyncStatus).toBe("never");
      expect(c.entryCount).toBe(0);
    }
  });

  it("reports the SOURCE's own as-at, not when we synced", () => {
    // Every other control here measures our own activity, and a four-year-old
    // file uploaded today passes all of them.
    const c = describeCoverage("wikidata_au_public_office", {
      entry_count: 10, source_as_at: "2024-01-01",
      completed_at: "2026-08-19T00:00:00.000Z", status: "succeeded",
    });
    expect(c.sourceAsAt).toBe("2024-01-01");
    expect(c.lastSyncedAt).toBe("2026-08-19T00:00:00.000Z");
  });

  it("an unknown source code still produces a coverage row rather than throwing", () => {
    expect(describeCoverage("something_new", null).sourceCode).toBe("something_new");
  });

  /*
   * The defect this replaced. `covers` was a sentence naming ministers,
   * judges and every state; the first real load reached TWO offices, and
   * nothing anywhere could tell the difference. Anything an operator counts
   * on now comes off the load.
   */
  it("counts nothing in the prose — the numbers come off the load", () => {
    for (const s of PEP_INDEX_SOURCES) {
      expect(s.covers).not.toMatch(/\d/);
      expect(s.excludes).not.toMatch(/\d/);
    }
  });

  it("a load with no recorded detail reports the office count as unknown, not as zero", () => {
    // Unknown and none are different facts, and only one of them is alarming.
    const c = describeCoverage("wikidata_au_public_office", {
      entry_count: 10, status: "succeeded",
    });
    expect(c.officeCount).toBeNull();
    expect(c.sampleOffices).toEqual([]);
  });

  it("reads the office count from the load's own detail", () => {
    const c = describeCoverage("wikidata_au_public_office", {
      entry_count: 10569, status: "succeeded",
      detail: { office_count: 724, distinct_offices: 700, sample_offices: ["Senator", ""] },
    });
    // The DISTINCT count is what was reached; `office_count` is what was asked for.
    expect(c.officeCount).toBe(700);
    expect(c.sampleOffices).toEqual(["Senator"]);
  });

  it("the index never asserts an AUSTRAC category", () => {
    // Foreign / domestic / international-organisation is part of the
    // determination a person reaches. It is also unavailable here: an
    // Australian-jurisdiction office includes foreign ambassadors posted
    // to Australia.
    expect(candidate().pepType).toBeNull();
  });
});
