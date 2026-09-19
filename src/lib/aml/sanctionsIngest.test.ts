/**
 * Loading the sanctions register, and the two ways it can go silently wrong.
 *
 * `aml.sanctions_entries` has been empty since this platform was built, so
 * every screening attempt fails closed. The batch loader could not fix it from
 * anywhere useful: it needs the production service-role key, and dfat.gov.au
 * answers HTTP 403 to a scripted request. So the file is fetched by a person
 * and the mapping happens server-side.
 *
 * The two silent failures this guards:
 *
 *   1. A list that matches NOBODY looks exactly like one that works. That is
 *      why normalisation is here and not in the browser, and why the drift
 *      test below re-checks it against the batch loader every run.
 *
 *   2. A truncated upload that prunes the real register. A list that halves
 *      is far more likely to be a bad download than a mass delisting.
 */
import { describe, expect, it } from "vitest";

import {
  PRUNE_SHRINK_FLOOR,
  decideSanctionsIngest,
  normaliseName,
  rowsToDfatEntries,
  withNormalisedNames,
} from "../../../supabase/functions/_shared/aml/sanctionsIngest.pure";
import {
  normaliseName as loaderNormaliseName,
  rowsToDfatEntries as loaderRowsToDfatEntries,
} from "../../../scripts/aml/sanctionsParsers.mjs";

/** A DFAT sheet: a blurb row, a header, then one row per name variant. */
const SHEET: unknown[][] = [
  ["DFAT Consolidated List — updated 1 August 2026"],
  ["Reference", "Name of Individual or Entity", "Name Type", "Type",
    "Date of Birth", "Place of Birth", "Citizenship", "Address",
    "Additional Information", "Committees"],
  ["AF001", "Mohammed Al-Hassan", "Primary name", "Individual",
    "12 Mar 1970", "Kabul", "Afghanistan", "12 Road", "Former minister", "UN 1267"],
  ["AF001", "Mohammad Hassan", "aka", "Individual", "", "", "", "", "", ""],
  ["AF001", "M. Al Hassan", "aka", "Individual", "", "", "", "", "", ""],
  ["EN002", "Sunrise Trading Pty Ltd", "Primary name", "Entity",
    "", "", "", "5 Dock St", "Shipping", "Autonomous"],
];

describe("the mapping the loader already proved", () => {
  it("groups name variants into one listing rather than one each", () => {
    // One row per name variant. Treating each as its own listing collides on
    // (list_code, external_id) and leaves an alias standing in as the
    // person's primary name.
    const entries = rowsToDfatEntries(SHEET);
    expect(entries).toHaveLength(2);
    const person = entries.find((e) => e.external_id === "DFAT-AF001")!;
    expect(person.primary_name).toBe("Mohammed Al-Hassan");
    expect(person.aliases.sort()).toEqual(["M. Al Hassan", "Mohammad Hassan"]);
    expect(person.entry_type).toBe("individual");
    expect(person.date_of_birth).toBe("12 Mar 1970");
  });

  it("classifies an entity and keeps its listing reference", () => {
    const entity = rowsToDfatEntries(SHEET).find((e) => e.external_id === "DFAT-EN002")!;
    expect(entity.entry_type).toBe("entity");
    expect(entity.listing_reference).toBe("Autonomous");
  });

  it("finds the header under a title row rather than assuming row 0", () => {
    expect(rowsToDfatEntries(SHEET)).toHaveLength(2);
    expect(rowsToDfatEntries(SHEET.slice(1))).toHaveLength(2);
  });

  it("refuses to guess when no name column can be found", () => {
    // A misread column is a list that matches the wrong people. Worse than
    // a refusal, so it throws rather than mapping by position.
    expect(() => rowsToDfatEntries([["a", "b"], ["1", "2"]]))
      .toThrow(/could not find a DFAT header row/i);
  });

  it("does not drift from the batch loader", () => {
    // Two implementations of one mapping is how a list comes to hold
    // different people depending on who loaded it.
    expect(JSON.parse(JSON.stringify(rowsToDfatEntries(SHEET))))
      .toEqual(JSON.parse(JSON.stringify(loaderRowsToDfatEntries(SHEET))));
    for (const name of [
      "Mohammed Al-Hassan", "Sunrise Trading Pty Ltd", "Dr. José Ørsted-Æther",
      "MR ibn Saud", "Zoë  van  der   Berg", "", "  ",
    ]) {
      expect(normaliseName(name), name).toEqual(loaderNormaliseName(name));
    }
  });
});

describe("normalisation is what makes a match possible", () => {
  it("drops honorifics, entity suffixes and particles", () => {
    expect(normaliseName("Mr Mohammed Al-Hassan")).toEqual(["mohammed", "hassan"]);
    expect(normaliseName("Sunrise Trading Pty Ltd")).toEqual(["sunrise", "trading"]);
  });

  it("folds accents and transliterates, so a match survives the keyboard", () => {
    expect(normaliseName("José Ørsted")).toEqual(["jose", "orsted"]);
  });

  it("indexes every alias, not just the primary name", () => {
    const [person] = rowsToDfatEntries(SHEET);
    const row = withNormalisedNames(person, "dfat", "sync-1", "2026-08-16T00:00:00.000Z");
    // A screen on the alias must hit, or the alias is decoration.
    expect(row.normalised_names).toContain("mohammad");
    expect(row.normalised_names).toContain("mohammed");
    expect(row.normalised_names).toContain("hassan");
    expect(row.sync_id).toBe("sync-1");
    expect(row.list_code).toBe("dfat");
  });

  it("never emits a duplicate token", () => {
    const [person] = rowsToDfatEntries(SHEET);
    const { normalised_names: n } = withNormalisedNames(person, "dfat", null, "2026-08-16T00:00:00.000Z");
    expect(new Set(n).size).toBe(n.length);
  });
});

describe("a bad upload must not destroy the register", () => {
  it("refuses an empty load outright", () => {
    // A zero-entry "success" publishes a list that returns clear for
    // everybody and looks identical to one that worked.
    const d = decideSanctionsIngest(0, 8421);
    expect(d.accept).toBe(false);
    expect(d.prune).toBe(false);
    expect(d.reason).toMatch(/no usable entries/);
  });

  it("refuses an empty load even into an empty register", () => {
    expect(decideSanctionsIngest(0, 0).accept).toBe(false);
  });

  it("writes but does not prune when the list implausibly shrinks", () => {
    const d = decideSanctionsIngest(1_000, 8_421);
    expect(d.accept).toBe(true);
    expect(d.prune).toBe(false);
    expect(d.reason).toMatch(/truncated file than a mass delisting/);
  });

  it("prunes a plausible refresh", () => {
    const d = decideSanctionsIngest(8_400, 8_421);
    expect(d.accept).toBe(true);
    expect(d.prune).toBe(true);
  });

  it("prunes the first load, having nothing to lose", () => {
    expect(decideSanctionsIngest(8_421, 0).prune).toBe(true);
  });

  it("lets an operator force a genuine mass delisting", () => {
    expect(decideSanctionsIngest(10, 8_421, true).prune).toBe(true);
  });

  it("puts the floor exactly where the batch loader does", () => {
    expect(PRUNE_SHRINK_FLOOR).toBe(0.5);
    // Just under the floor keeps the old entries; just over prunes.
    expect(decideSanctionsIngest(499, 1_000).prune).toBe(false);
    expect(decideSanctionsIngest(501, 1_000).prune).toBe(true);
  });
});
