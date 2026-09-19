/**
 * Real unit tests for the screening/MRZ engine.
 *
 * This is the component that replaces a commercial vendor's matching engine,
 * so it is tested behaviourally rather than by reading its source. The cases
 * below are the failure modes that actually cause missed sanctions hits:
 * reordered names, omitted middle names, transliteration variants, and
 * publishers' partial dates of birth.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normaliseName, normalisedKey, scoreNames, compareDob, applyDobAdjustment,
  screenSubject, jaroWinkler, editSimilarity, levenshtein,
  mrzCheckDigit, verifyMrzField, parseMrz, mrzDateToIso,
  DEFAULT_MATCH_THRESHOLD,
  type ScreeningCandidate,
} from "../../../supabase/functions/_shared/aml/matching";

describe("normaliseName", () => {
  it("strips diacritics and transliterates", () => {
    expect(normaliseName("José Müller")).toEqual(["jose", "muller"]);
    expect(normaliseName("Øystein Ångström")).toEqual(["oystein", "angstrom"]);
  });

  it("drops honorifics, entity suffixes and particles", () => {
    expect(normaliseName("Mr John Smith")).toEqual(["john", "smith"]);
    expect(normaliseName("Acme Holdings Pty Ltd")).toEqual(["acme"]);
    // "al" is connective and goes; "abd" is name-forming and stays.
    expect(normaliseName("Abd al-Rahman")).toEqual(["abd", "rahman"]);
  });

  it("treats hyphens and apostrophes as joins, not letters", () => {
    expect(normaliseName("Anne-Marie O'Brien")).toEqual(["anne", "marie", "obrien"]);
  });

  it("drops single-letter initials, which carry no matching signal", () => {
    expect(normaliseName("John Q Smith")).toEqual(["john", "smith"]);
  });

  it("produces an order-independent key", () => {
    expect(normalisedKey("SMITH, John")).toBe(normalisedKey("John Smith"));
  });
});

describe("similarity primitives", () => {
  it("levenshtein counts edits", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("jaroWinkler rewards a shared prefix", () => {
    expect(jaroWinkler("martha", "marhta")).toBeGreaterThan(0.94);
    expect(jaroWinkler("abcd", "wxyz")).toBe(0);
  });

  it("editSimilarity is bounded and symmetric-ish", () => {
    expect(editSimilarity("", "")).toBe(1);
    expect(editSimilarity("abc", "abc")).toBe(1);
    expect(editSimilarity("abc", "xyz")).toBe(0);
  });
});

describe("scoreNames", () => {
  it("scores an exact match at 1 regardless of word order", () => {
    expect(scoreNames("John Smith", "SMITH, John").score).toBe(1);
    expect(scoreNames("John Smith", "SMITH, John").basis).toBe("exact");
  });

  it("scores an omitted middle name highly — the common list case", () => {
    const s = scoreNames("John Smith", "John Michael Smith");
    expect(s.basis).toBe("token_subset");
    expect(s.score).toBeGreaterThanOrEqual(0.9);
  });

  it("matches transliteration variants", () => {
    expect(scoreNames("Mohammed Hussein", "Muhammad Hussain").score)
      .toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLD);
  });

  it("does not let a single common surname reach the threshold", () => {
    // "Smith" alone must not refer every Smith in the country.
    const s = scoreNames("Jane Smith", "Robert Smith");
    expect(s.score).toBeLessThan(DEFAULT_MATCH_THRESHOLD);
  });

  it("scores unrelated names at zero", () => {
    expect(scoreNames("John Smith", "Yuki Tanaka").score).toBe(0);
  });

  it("handles empty input without throwing", () => {
    expect(scoreNames("", "John Smith").score).toBe(0);
    expect(scoreNames("John Smith", "").score).toBe(0);
  });

  it("is not defeated by a name carrying more tokens than ours", () => {
    // List entries routinely carry four or five names against our two.
    const s = scoreNames("Ahmed Hassan", "Ahmed Abdullah Hassan Al Fulani");
    expect(s.score).toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLD);
  });
});

describe("date of birth handling", () => {
  it("recognises full, year-only and partial dates", () => {
    expect(compareDob("1961-03-04", "1961-03-04")).toBe("match");
    expect(compareDob("1961-03-04", "1961-11-22")).toBe("year_match");
    expect(compareDob("1961", "1961-03-04")).toBe("year_match");
    expect(compareDob("1961", "1972")).toBe("mismatch");
    expect(compareDob(null, "1961")).toBe("unknown");
    expect(compareDob("circa 1961", "1961")).toBe("year_match");
  });

  it("dampens on mismatch but never zeroes", () => {
    // List DOBs are frequently wrong; zeroing here is how real hits get missed.
    const adjusted = applyDobAdjustment(0.9, "mismatch");
    expect(adjusted).toBeGreaterThan(0);
    expect(adjusted).toBeLessThan(0.9);
  });

  it("boosts on agreement without exceeding 1", () => {
    expect(applyDobAdjustment(0.98, "match")).toBeLessThanOrEqual(1);
    expect(applyDobAdjustment(0.5, "match")).toBeGreaterThan(0.5);
  });
});

describe("screenSubject", () => {
  const candidates: ScreeningCandidate[] = [
    {
      externalId: "DFAT-001", listCode: "dfat", primaryName: "Ivan Petrov",
      aliases: ["PETROV, Ivan Sergeyevich"], dateOfBirth: "1970-05-01",
      listingReference: "Autonomous Sanctions Regulations 2011",
    },
    {
      externalId: "UN-002", listCode: "un", primaryName: "Acme Trading Company Ltd",
      aliases: [], entryType: "entity",
    },
    {
      externalId: "OFAC-003", listCode: "ofac", primaryName: "Yuki Tanaka",
      aliases: [], dateOfBirth: "1980",
    },
  ];

  it("finds a hit through an alias, not just the primary name", () => {
    const hits = screenSubject({ name: "Ivan Sergeyevich Petrov", dateOfBirth: "1970-05-01" }, candidates);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].externalId).toBe("DFAT-001");
    expect(hits[0].dobAgreement).toBe("match");
  });

  it("returns nothing for an unrelated subject", () => {
    expect(screenSubject({ name: "Margaret Whitlam" }, candidates)).toEqual([]);
  });

  it("carries the listing reference so a hit traces to the gazetted entry", () => {
    const hits = screenSubject({ name: "Ivan Petrov" }, candidates);
    expect(hits[0].listingReference).toContain("Autonomous Sanctions Regulations");
  });

  it("sorts by descending score", () => {
    const hits = screenSubject({ name: "Ivan Petrov" }, candidates, 0.1);
    const scores = hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("respects a caller-supplied threshold", () => {
    const loose = screenSubject({ name: "Ivan Petroff" }, candidates, 0.1);
    const strict = screenSubject({ name: "Ivan Petroff" }, candidates, 0.99);
    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });

  it("matches an entity through its suffix-stripped form", () => {
    const hits = screenSubject({ name: "ACME TRADING CO" }, candidates);
    expect(hits.some((h) => h.externalId === "UN-002")).toBe(true);
  });
});

describe("MRZ check digits (ICAO 9303)", () => {
  it("computes check digits per the 7-3-1 weighting", () => {
    // Verified independently: sum(value * weight) mod 10.
    expect(mrzCheckDigit("D23145890734")).toBe(9);
    expect(mrzCheckDigit("340712")).toBe(7);
    // The canonical ICAO TD3 specimen document number, published as
    // "L898902C36" — the trailing 6 is the check digit.
    expect(mrzCheckDigit("L898902C3")).toBe(6);
  });

  it("rejects invalid characters", () => {
    expect(mrzCheckDigit("ABC*DEF")).toBeNull();
  });

  it("verifyMrzField requires a numeric expectation", () => {
    expect(verifyMrzField("340712", "7")).toBe(true);
    expect(verifyMrzField("340712", "8")).toBe(false);
    expect(verifyMrzField("340712", "<")).toBe(false);
  });
});

describe("parseMrz", () => {
  // Canonical ICAO TD3 specimen.
  const line1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
  const line2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

  it("parses a valid TD3 passport MRZ", () => {
    const r = parseMrz(`${line1}\n${line2}`);
    expect(r.format).toBe("TD3");
    expect(r.fields.surname).toBe("ERIKSSON");
    expect(r.fields.givenNames).toBe("ANNA MARIA");
    expect(r.fields.issuingState).toBe("UTO");
    expect(r.fields.documentNumber).toBe("L898902C3");
    expect(r.fields.dateOfBirth).toBe("740812");
    expect(r.fields.sex).toBe("F");
  });

  it("passes every check digit on the specimen", () => {
    const r = parseMrz(`${line1}\n${line2}`);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  it("detects a tampered document number — the forgery signal", () => {
    const tampered = "L898902C46UTO7408122F1204159ZE184226B<<<<<10";
    const r = parseMrz(`${line1}\n${tampered}`);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("check_digit_failed_document_number");
  });

  it("detects a tampered date of birth", () => {
    const tampered = "L898902C36UTO7408123F1204159ZE184226B<<<<<10";
    const r = parseMrz(`${line1}\n${tampered}`);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("check_digit_failed_date_of_birth");
  });

  it("reports an unrecognised shape rather than guessing", () => {
    expect(parseMrz("TOO SHORT").errors).toContain("mrz_not_found");
    expect(parseMrz("ABC\nDEF").format).toBe("unknown");
  });

  it("declines TD1 explicitly instead of returning a false pass", () => {
    const td1 = ["A".repeat(30), "B".repeat(30), "C".repeat(30)].join("\n");
    const r = parseMrz(td1);
    expect(r.format).toBe("TD1");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("td1_not_supported");
  });
});

describe("mrzDateToIso", () => {
  it("windows birth years into the past", () => {
    expect(mrzDateToIso("740812", "birth")).toBe("1974-08-12");
  });

  it("treats expiry years as current century", () => {
    expect(mrzDateToIso("300101", "expiry")).toBe("2030-01-01");
  });

  it("rejects impossible dates", () => {
    expect(mrzDateToIso("741332")).toBeNull();
    expect(mrzDateToIso("abc")).toBeNull();
  });
});

describe("regression: name-forming prefixes must survive normalisation", () => {
  it("keeps abd/abu so Arabic name variants still match", () => {
    // Dropping "abd" left a single token, which one-token damping then pushed
    // below the threshold — a silent miss on exactly the names most likely to
    // appear on a sanctions list.
    expect(normaliseName("Abd al-Rahman")).toContain("abd");
    expect(normaliseName("Abu Bakr")).toContain("abu");
    expect(scoreNames("Abd al-Rahman", "Abdul Rahman").score)
      .toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLD);
  });
});

describe("loader normalisation cannot drift from query normalisation", () => {
  // The loader writes `normalised_names`; the screening query matches against
  // them. If the two token sets diverge, entries silently stop matching and
  // nothing fails loudly — so assert they stay identical.
  const loader = readFileSync(
    join(process.cwd(), "scripts/aml/load-sanctions-lists.mjs"), "utf8");
  // Normalisation moved into the parser module when DFAT XLSX support was
  // added, so the loader could stay I/O-only and the parsers become testable.
  // The guarantee is unchanged — only its file moved.
  const parsers = readFileSync(
    join(process.cwd(), "scripts/aml/sanctionsParsers.mjs"), "utf8");
  const matcher = readFileSync(
    join(process.cwd(), "supabase/functions/_shared/aml/matching.ts"), "utf8");

  const extract = (src: string, name: string) => {
    const m = src.match(new RegExp(`const ${name} = new Set\\(\\[(.*?)\\]\\)`, "s"));
    if (!m) throw new Error(`${name} not found`);
    return m[1].replace(/[\s'"]/g, "").split(",").filter(Boolean).sort().join(",");
  };

  it.each(["HONORIFICS", "ENTITY_SUFFIXES", "PARTICLES"])(
    "%s is identical on both sides", (name) => {
      expect(extract(parsers, name)).toBe(extract(matcher, name));
    });

  it("loads from the publishers, not from the CC-BY-NC aggregator", () => {
    expect(loader).toContain("scsanctions.un.org");
    expect(loader).toContain("treasury.gov/ofac");
    expect(loader).toContain("dfat.gov.au");
    expect(loader).not.toMatch(/opensanctions\.org/);
  });

  it("refuses to record a successful sync with no entries", () => {
    // A silently-empty sanctions list is worse than an obviously absent one.
    expect(loader).toContain("refusing to publish an empty list");
    // Any list that throws is marked 'failed' — never 'succeeded' — so an
    // empty or unparseable download can never present as a completed sync.
    expect(loader).toContain("status: 'failed'");
  });

  it("refuses to guess at DFAT columns rather than load a partial list", () => {
    // DFAT is downloaded and parsed directly now. The old manual CSV export
    // step is gone, so the guard against a silently-wrong parse moved to
    // header resolution: no recognisable name column means no load at all.
    expect(parsers).toContain("Refusing to guess at column positions");
    expect(loader).toContain("no .xlsx/.csv link found");
  });

  it("prunes entries that have left the list", () => {
    // Upsert alone leaves a delisted party matching forever. Pruning is
    // guarded by a shrink floor so a truncated download cannot wipe the list.
    expect(loader).toContain("PRUNE_SHRINK_FLOOR");
    // Must cover NULL sync_id too: `neq` against NULL is NULL, not true, so a
    // row predating sync tracking would otherwise match forever.
    expect(loader).toContain("sync_id.is.null,sync_id.neq.");
  });
});
