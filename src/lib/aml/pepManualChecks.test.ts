import { describe, expect, it } from "vitest";
import {
  MANUAL_LINK_TO_INDEX_SOURCE,
  classifyManualChecks,
  describeManualChecks,
  recencyFromRunSource,
  type RunSourceState,
} from "@/lib/aml/pepManualChecks";
import { buildPepSearches } from "@/lib/aml/pepSearchLinks.pure";
import { describeTenure } from "@/lib/aml/pepOfficeholderIndex";

/**
 * The screen must not contradict the search it is describing.
 *
 * ── What was on the screen ────────────────────────────────────────────
 * The determination dialog told the operator, in fixed prose:
 *
 *   "The two Commonwealth registers block automated requests, so the run
 *    above cannot read them."
 *
 * By the time anybody read that, ONE register blocked automated requests.
 * Parliament of Australia had become a loaded register the server searches on
 * every run, and the panel directly above the sentence said so — "1 source was
 * not searched". The same scroll, two different answers, and the operator was
 * sent to open by hand a register the platform had just read for them.
 *
 * Correcting "two" to "one" would be true today and wrong at the next move,
 * and moving sources from "somebody opens a tab" to "the server reads it" is
 * the whole direction of this programme. Prose that counts things goes stale.
 */

const LINKS = buildPepSearches({ name: "Pat Example" })
  .filter((s) => s.tier === "register").map((s) => s.id);

const sources = (over: Partial<Record<string, RunSourceState["status"]>> = {}) =>
  Object.entries({
    aph_commonwealth_parliament: "searched",
    wikidata_au_public_office: "searched",
    directory_gov_au: "not_reachable",
    ...over,
  }).map(([key, status]) => ({ key, status: status as RunSourceState["status"] }));

describe("a register the run read is not a register to check by hand", () => {
  it("is offered as a place to CONFIRM, not as a hole to fill", () => {
    const checks = classifyManualChecks({ linkIds: LINKS, runSources: sources() });
    const aph = checks.find((c) => c.id === "aph_members")!;
    expect(aph.state).toBe("searched_by_platform");
    expect(aph.action).toMatch(/already searched on this run/i);
    expect(aph.action).toMatch(/confirm a candidate/i);
  });

  it("the one that genuinely blocks is still named as blocking", () => {
    const checks = classifyManualChecks({ linkIds: LINKS, runSources: sources() });
    const dir = checks.find((c) => c.id === "directory_gov_au")!;
    expect(dir.state).toBe("must_check_by_hand");
    expect(dir.action).toMatch(/the run could not read it/i);
  });

  it("counts what the run says, and never a number the list contradicts", () => {
    const one = describeManualChecks(
      classifyManualChecks({ linkIds: LINKS, runSources: sources() }), true);
    expect(one).toMatch(/^1 register below cannot be read/);
    expect(one).not.toMatch(/\btwo\b/i);

    // The state the old prose actually described — before APH was loaded.
    const two = describeManualChecks(classifyManualChecks({
      linkIds: LINKS,
      runSources: sources({ aph_commonwealth_parliament: "not_reachable" }),
    }), true);
    expect(two).toMatch(/^2 registers below cannot be read/);
  });
});

describe("a source the platform never holds is not a coverage failure", () => {
  it("ParlInfo and ABN Lookup are simply manual, and are not reported as gaps", () => {
    /*
     * ParlInfo is a full-text archive of the parliamentary record; ABN Lookup
     * is a company register that happens to name office holders. Neither is a
     * register the index could hold, so listing them as "the run could not
     * read them" would report a coverage failure that does not exist — the
     * same overstatement, pointed the other way.
     */
    const checks = classifyManualChecks({ linkIds: LINKS, runSources: sources() });
    for (const id of ["parlinfo", "abn_lookup"]) {
      const c = checks.find((x) => x.id === id);
      expect(c?.state).toBe("not_held_by_platform");
    }
    // …so they do not inflate the count in the sentence.
    expect(describeManualChecks(checks, true)).toMatch(/^1 register/);
  });
});

describe("before anything has been run", () => {
  it("every register the platform holds needs a person", () => {
    // A search nobody has run has read nothing. Telling somebody a register
    // is covered before it has been searched is exactly backwards.
    const checks = classifyManualChecks({ linkIds: LINKS, runSources: null });
    expect(checks.find((c) => c.id === "aph_members")?.state).toBe("must_check_by_hand");
    expect(describeManualChecks(checks, false)).toMatch(/run the screening above first/i);
  });

  it("a run that failed puts them back, rather than crediting the last one", () => {
    const checks = classifyManualChecks({
      linkIds: LINKS,
      runSources: sources({ aph_commonwealth_parliament: "failed" }),
    });
    const aph = checks.find((c) => c.id === "aph_members")!;
    expect(aph.state).toBe("must_check_by_hand");
    expect(aph.action).toMatch(/could not read it this time/i);
  });

  it("a register that is loaded but empty is not reported as searched", () => {
    const checks = classifyManualChecks({
      linkIds: LINKS,
      runSources: sources({ aph_commonwealth_parliament: "unavailable" }),
    });
    expect(checks.find((c) => c.id === "aph_members")?.state).toBe("must_check_by_hand");
  });
});

describe("the mapping between two names for one register", () => {
  it("is declared, never inferred from the strings", () => {
    // `aph_members` and `aph_commonwealth_parliament` are the same register
    // under two spellings, and nothing about either string says so.
    expect(MANUAL_LINK_TO_INDEX_SOURCE.aph_members).toBe("aph_commonwealth_parliament");
  });

  it("every mapped link id is a real link, so the map cannot rot silently", () => {
    for (const id of Object.keys(MANUAL_LINK_TO_INDEX_SOURCE)) {
      expect(LINKS).toContain(id);
    }
  });
});

describe("a held office is held AS AT a date", () => {
  const NOW = Date.parse("2026-08-20T00:00:00.000Z");

  it("uses the one renderer, fed from what the run recorded", () => {
    /*
     * `describeTenure` is the single place that turns "held" plus an as-at
     * into words. This adapter exists because a screening run stores less
     * than an index coverage row — not so a second sentence can be written
     * somewhere else.
     */
    expect(describeTenure(true, recencyFromRunSource("2026-08-19", "fresh", NOW)))
      .toBe("Held as at 2026-08-19");
    expect(describeTenure(true, recencyFromRunSource("2026-02-01", "stale", NOW)))
      .toMatch(/^Held as at 2026-02-01 — 200 days ago$/);
    expect(describeTenure(false, recencyFromRunSource("2026-08-19", "fresh", NOW)))
      .toBe("Formerly held");
  });

  it("ages from the as-at at render time, not from the run", () => {
    // How long ago the register was read grows whether or not anybody reruns
    // the screening, and that is the number the operator needs.
    expect(recencyFromRunSource("2026-08-13", "fresh", NOW).ageDays).toBe(7);
  });

  it("a run with no recorded as-at does not invent one", () => {
    const r = recencyFromRunSource(null, "fresh", NOW);
    expect(r.reading).toBe("never");
    expect(r.loadedAt).toBe(null);
    expect(describeTenure(true, r)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("nothing it produces is the bare word 'Current'", () => {
    for (const held of [true, false, null]) {
      for (const asAt of ["2026-08-19", null]) {
        expect(describeTenure(held, recencyFromRunSource(asAt, "fresh", NOW)))
          .not.toBe("Current");
      }
    }
  });
});
