import { describe, expect, it } from "vitest";
import {
  classifyOffice, describeRuleCoverage, summariseRuleCoverage,
} from "@/lib/aml/pepRuleCoverage";

/**
 * Coverage against the AML/CTF Rules, and the ways a claim about it goes bad.
 *
 * Every title below is a real office title from `aml.pep_officeholders` in
 * production — 910 distinct ones across the two registers. The ones that are
 * here are here because a plausible classifier gets them wrong.
 *
 * The failure that matters is not the miss. An office nobody recognises is
 * counted as unclassified and disclosed, so every number is a FLOOR and the
 * prose says "at least". The failure that matters is the CLAIM: telling an
 * operator that a category was searched when nothing of the kind is loaded.
 * This index has already shipped that once, and this file exists so it does
 * not ship it again through the coverage line.
 */

describe("the category that would have been wrong", () => {
  it("counts no Australian diplomat, because the index holds none", () => {
    /*
     * The Rules mean AUSTRALIAN diplomatic positions — our ambassadors posted
     * overseas. Production holds 16 offices containing "ambassador", "high
     * commissioner" or "consul". FIFTEEN are of the form `ambassador of
     * Botswana to Australia`: foreign envoys posted HERE, the opposite of the
     * category. Australian diplomats abroad: zero.
     *
     * A keyword classifier would have reported "diplomatic: 16 offices", and
     * an operator would reasonably have read that as "Australian ambassadors
     * were searched".
     */
    const s = summariseRuleCoverage([
      "ambassador of Botswana to Australia",
      "United States Ambassador to Australia",
      "Saudí ambassador to Australia",
      "list of ambassadors of China to Australia",
    ]);
    const diplomatic = s.categories.find((c) => c.code === "diplomatic")!;
    expect(diplomatic.officeCount).toBe(0);
    expect(diplomatic.notEvidenced).toBe(true);
    expect(describeRuleCoverage(diplomatic)).toMatch(/by hand/i);

    // And they are not silently dropped either. A foreign ambassador in
    // Canberra is a foreign PEP, which the Rules treat more strictly.
    const foreign = s.categories.find((c) => c.code === "foreign_mission_in_australia")!;
    expect(foreign.officeCount).toBe(4);
    expect(foreign.meaning).toMatch(/not an Australian one/i);
  });

  it("recognises an Australian diplomatic post when one appears", () => {
    expect(classifyOffice("Australian Ambassador to Indonesia")).toBe("diplomatic");
    expect(classifyOffice("Australian High Commissioner to New Zealand")).toBe("diplomatic");
  });
});

describe("the offices a plausible rule mislabels", () => {
  it("the Governor of the Reserve Bank is not a vice-regal office", () => {
    // A central banker filed under "Governors and Administrators" would tell
    // an operator the wrong thing about why the name surfaced.
    expect(classifyOffice("Governor of the Reserve Bank of Australia")).not.toBe("vice_regal");
    expect(classifyOffice("Governor of New South Wales")).toBe("vice_regal");
    expect(classifyOffice("Governor-General of Australia")).toBe("vice_regal");
    expect(classifyOffice("Administrator of the Northern Territory")).toBe("vice_regal");
  });

  it("a Justice of the Peace is not a judicial officer", () => {
    expect(classifyOffice("Justice of the Peace for South Australia")).not.toBe("judiciary");
    expect(classifyOffice("Justice of the High Court of Australia")).toBe("judiciary");
    expect(classifyOffice("Chief Justice of Australia")).toBe("judiciary");
    expect(classifyOffice("judge of the District Court of New South Wales")).toBe("judiciary");
  });

  it("a portfolio is ministry, not the thing the portfolio is about", () => {
    // "Minister for Defence" is a minister. Filing it under Defence would
    // report senior Defence coverage this index does not have.
    expect(classifyOffice("Minister for Defence")).toBe("ministry");
    expect(classifyOffice("Assistant Minister for Defence")).toBe("ministry");
    expect(classifyOffice("Minister for Local Government")).toBe("ministry");
    expect(classifyOffice("Minister for Justice")).toBe("ministry");
    expect(classifyOffice("Attorney-General")).toBe("ministry");
    // The actual Defence offices, which are in the index.
    expect(classifyOffice("Chief of the Defence Force")).toBe("defence");
    expect(classifyOffice("Chief of Navy")).toBe("defence");
  });

  it("councillors and aldermen are not heads of local government", () => {
    /*
     * The Rules name HEADS of local government. Folding in everyone who ever
     * sat on a council would turn a narrow category into a wide one, and the
     * index holds hundreds of them.
     */
    for (const t of [
      "Alderman of the Corporation of the City of Unley",
      "District Councillor of Barossa East",
      "member of Albury City Council",
      "Member of the District Council of Grant",
    ]) expect(classifyOffice(t)).not.toBe("local_government");

    for (const t of ["Lord Mayor of Sydney", "Mayor of Fremantle", "Shire President of the Shire of Mundaring"]) {
      expect(classifyOffice(t)).toBe("local_government");
    }
  });
});

describe("what it refuses to claim", () => {
  it("an office it does not recognise is disclosed, never absorbed", () => {
    const s = summariseRuleCoverage([
      "Anglican Bishop of Ballarat",
      "Chancellor of the University of Sydney",
      "Grand Mufti of Australia",
      "monarch of Australia",
      "Minister for Health",
    ]);
    expect(s.unclassifiedCount).toBe(4);
    expect(s.unclassifiedSamples).toContain("monarch of Australia");
    expect(s.totalOffices).toBe(5);
  });

  it("every count is stated as a floor", () => {
    const s = summariseRuleCoverage(["Minister for Health", "Treasurer"]);
    const ministry = s.categories.find((c) => c.code === "ministry")!;
    expect(describeRuleCoverage(ministry)).toMatch(/at least/i);
    // And it stays a statement about the SEARCH.
    expect(describeRuleCoverage(ministry)).toMatch(/not a statement about anybody/i);
  });

  it("no coverage sentence can be read as a result about a person", () => {
    const s = summariseRuleCoverage(["Chief Justice of Australia", "Mayor of Sydney"]);
    for (const c of s.categories) {
      const line = describeRuleCoverage(c);
      expect(line).not.toMatch(/\bclear|\bno match\b|\bnot a pep\b/i);
    }
  });

  it("an empty index evidences nothing at all", () => {
    // Zero rows for a category the index never covered reads exactly like
    // zero rows for a category with nobody in it. Both say "check by hand".
    const s = summariseRuleCoverage([]);
    expect(s.categories.every((c) => c.notEvidenced)).toBe(true);
    expect(s.totalOffices).toBe(0);
  });
});

describe("the categories the loaded index does evidence", () => {
  it("classifies the shapes the two registers actually publish", () => {
    const s = summariseRuleCoverage([
      "Senator for NSW", "Member for Grayndler",
      "Member of the Victorian Legislative Assembly", "Speaker", "Opposition Whip",
      "Prime Minister", "Premier of Queensland", "Chief Minister of the Northern Territory",
      "Governor of Tasmania",
      "Justice of the Federal Court of Australia",
      "Director-General of Security", "Commissioner of the Australian Federal Police",
      "Chief of Air Force",
      "Lord Mayor of Brisbane",
    ]);
    const byCode = Object.fromEntries(s.categories.map((c) => [c.code, c.officeCount]));
    expect(byCode.legislature).toBe(5);
    expect(byCode.ministry).toBe(3);
    expect(byCode.vice_regal).toBe(1);
    expect(byCode.judiciary).toBe(1);
    expect(byCode.public_administration).toBe(2);
    expect(byCode.defence).toBe(1);
    expect(byCode.local_government).toBe(1);
    expect(s.unclassifiedCount).toBe(0);
  });
});
