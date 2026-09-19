/**
 * One rule for finding a customer, wherever they are looked for.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { caseSearchLabel, filterCases, matchesCaseSearch } from "./caseSearch.pure";

const CASES = [
  { id: "1", subject_display_name: "Rugesh Naidu", case_reference: "AML-2026-00005" },
  { id: "2", subject_display_name: "Mithu Limited", case_reference: "AML-2026-00012" },
  { id: "3", subject_display_name: "Anna Chen", case_reference: "AML-2025-00301" },
];

describe("finding a customer", () => {
  it("matches part of a name", () => {
    expect(filterCases(CASES, "nai").map((c) => c.id)).toEqual(["1"]);
    expect(filterCases(CASES, "RUGESH").map((c) => c.id)).toEqual(["1"]);
  });

  it("matches a Passport reference with or without its hyphens", () => {
    /* A reference is copied off one screen and re-typed on another, and the
       hyphens are not part of what anybody remembers. */
    expect(filterCases(CASES, "AML-2026-00005").map((c) => c.id)).toEqual(["1"]);
    expect(filterCases(CASES, "aml202600005").map((c) => c.id)).toEqual(["1"]);
    expect(filterCases(CASES, "00012").map((c) => c.id)).toEqual(["2"]);
  });

  it("requires every word, and lets them match different fields", () => {
    /* Which is how somebody types when they are reading a reference off one
       screen and a name off another. */
    expect(filterCases(CASES, "rugesh 00005").map((c) => c.id)).toEqual(["1"]);
    expect(filterCases(CASES, "rugesh 00012")).toEqual([]);
  });

  it("returns everything for an empty query, in the order it was given", () => {
    expect(filterCases(CASES, "").map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(filterCases(CASES, "   ").map((c) => c.id)).toEqual(["1", "2", "3"]);
  });

  it("survives a row with no name and no reference", () => {
    expect(matchesCaseSearch({}, "anything")).toBe(false);
    expect(matchesCaseSearch({}, "")).toBe(true);
  });

  it("labels a customer by name and reference, and never renders 'undefined'", () => {
    expect(caseSearchLabel(CASES[0])).toBe("Rugesh Naidu — AML-2026-00005");
    expect(caseSearchLabel({ subject_display_name: "Solo" })).toBe("Solo");
    expect(caseSearchLabel({})).toBe("Unnamed customer");
  });
});

describe("both surfaces use it", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("the Passport register no longer carries a filter of its own", () => {
    /* This is where the convention started — name or case reference. It
       moved rather than being copied, because a customer found one way and
       not the other is how an operator concludes a case does not exist. */
    const page = read("src/pages/aml/AmlPassports.tsx");
    expect(page).toContain("filterCases(cases, search)");
    expect(page).not.toContain("subject_display_name ?? \"\").toLowerCase().includes(q)");
  });

  it("the AUSTRAC customer picker filters through it and not through cmdk", () => {
    /* cmdk's own scorer would be a second, different answer to "is this the
       customer they meant". */
    const picker = read("src/components/aml/AustracCustomerPicker.tsx");
    expect(picker).toContain("filterCases(cases, query)");
    expect(picker).toContain("shouldFilter={false}");
  });
});
