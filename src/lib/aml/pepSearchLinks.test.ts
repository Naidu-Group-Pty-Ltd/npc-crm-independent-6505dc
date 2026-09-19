import { describe, expect, it } from "vitest";
import {
  PEP_SEARCH_COVERAGE_GAPS,
  buildPepSearches,
  searchNames,
} from "@/lib/aml/pepSearchLinks.pure";
import { namesSanctionsRegister } from "@/lib/aml/pepEvidence";

/**
 * The assisted search.
 *
 * It builds URLs and nothing else. Every guarantee here is about what it does
 * NOT do: it performs no request, reads no result, and cannot report a match
 * or the absence of one — because a partial index reporting "no match" is a
 * confident clear against nothing, which is the failure this platform has
 * already had once with an empty sanctions table.
 */

describe("the names a search is run on", () => {
  it("carries the aliases, trimmed and de-duplicated", () => {
    expect(searchNames("  Pat Example  ", ["Patrick Example", "Pat Example", " "]))
      .toEqual(["Pat Example", "Patrick Example"]);
  });

  it("drops a name too short to search on", () => {
    expect(searchNames("A", ["", null, undefined])).toEqual([]);
  });
});

describe("the sources offered", () => {
  const searches = buildPepSearches({
    name: "Pat Example", aliases: ["Patrick Example"], jurisdiction: "Australia",
  });

  it("offers nothing at all without a name to search", () => {
    expect(buildPepSearches({ name: "  " })).toEqual([]);
  });

  it("names the government and parliamentary sources AUSTRAC's guidance points at", () => {
    const hosts = searches.map((s) => new URL(s.url).hostname);
    expect(hosts).toContain("www.directory.gov.au");
    expect(hosts).toContain("www.aph.gov.au");
    expect(hosts).toContain("abr.business.gov.au");
    expect(hosts).toContain("parlinfo.aph.gov.au");
  });

  /*
   * The Government Directory link was `/search/node?keys=…` — a Drupal 7
   * path the site no longer serves. Every operator who followed the most
   * authoritative source on the list got "Page not found".
   */
  it("the Government Directory link uses the search the site actually serves", () => {
    const dir = searches.find((s) => s.id === "directory_gov_au")!;
    const url = new URL(dir.url);
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("keywords")).toBe("Pat Example");
    expect(dir.url).not.toContain("/search/node");
    expect(dir.url).not.toContain("keys=");
  });

  /*
   * The list used to end with two DuckDuckGo rows sitting beside DFAT and
   * Parliament as though they were peers. A search engine is a starting
   * point; it is not a source of record, and a screening that rests on one
   * rests on whatever it returned that morning.
   */
  it("no search engine is presented as a register", () => {
    for (const s of searches.filter((x) => x.tier === "register")) {
      const host = new URL(s.url).hostname;
      expect(host).not.toMatch(/duckduckgo|google|bing|yahoo/i);
      expect(host).toMatch(/\.gov\.au$/);
    }
  });

  it("there is exactly one general web search, and it says what it is", () => {
    const open = searches.filter((s) => s.tier === "open_web");
    expect(open).toHaveLength(1);
    expect(open[0].purpose).toMatch(/not a source of record/i);
    expect(searches.filter((s) => s.tier === "register").length)
      .toBeGreaterThan(open.length);
  });

  it("every source declares which tier it is", () => {
    for (const s of searches) expect(["register", "open_web"]).toContain(s.tier);
  });

  it("every source is a SEARCH page, never an assertion about the subject", () => {
    for (const s of searches) {
      const url = new URL(s.url);
      expect(url.protocol).toBe("https:");
      expect(url.search + url.pathname).toMatch(/Pat(%20|\+)?Example|Pat%20Example/);
    }
  });

  it("no source offered is a sanctions register", () => {
    // The whole reason this module exists. A sanctions list must never reach
    // an operator as a way of establishing political exposure.
    for (const s of searches) {
      expect(namesSanctionsRegister(s.label)).toBe(false);
      expect(namesSanctionsRegister(s.purpose)).toBe(false);
      expect(s.kind).not.toBe("pep_database");
    }
  });

  it("records exactly what is being searched, including every alias", () => {
    // The URL can only carry one spelling; the record carries all of them, so
    // a later reader knows which names were actually considered.
    for (const s of searches) expect(s.searchTerms).toContain("Patrick Example");
  });

  it("uses the declared jurisdiction to narrow the open-source search", () => {
    const open = searches.find((s) => s.id === "open_source");
    expect(decodeURIComponent(open!.url)).toContain("Australia");
    const without = buildPepSearches({ name: "Pat Example" })
      .find((s) => s.id === "open_source");
    expect(decodeURIComponent(without!.url)).not.toContain("undefined");
    expect(decodeURIComponent(without!.url)).not.toContain("null");
  });

  it("marks which sources are domestic, because a foreign PEP is not in them", () => {
    expect(searches.filter((s) => s.coverage === "domestic").length).toBeGreaterThan(0);
    expect(searches.filter((s) => s.coverage === "general").length).toBeGreaterThan(0);
  });

  it("ids are stable and unique, so a row can be paired with its search", () => {
    expect(new Set(searches.map((s) => s.id)).size).toBe(searches.length);
  });

  it("a name with a quote or an ampersand still produces a valid URL", () => {
    for (const s of buildPepSearches({ name: "O'Brien & Sons Pty Ltd" })) {
      expect(() => new URL(s.url)).not.toThrow();
    }
  });
});

describe("what the searches do not reach is said every time", () => {
  it("names the three gaps a clean sweep of these sources still leaves", () => {
    const all = PEP_SEARCH_COVERAGE_GAPS.join(" ").toLowerCase();
    expect(all).toContain("foreign");
    expect(all).toContain("family");
    expect(all).toContain("left");
    // Nothing here may read as a clearance.
    expect(all).not.toContain("no match");
  });
});
