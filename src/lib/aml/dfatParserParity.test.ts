import { describe, expect, it } from "vitest";
// The copy the MLRO upload at /aml/verification runs (server-side, Deno).
import {
  rowsToDfatEntries as rowsTs,
  dfatListingKey as keyTs,
} from "../../../supabase/functions/_shared/aml/sanctionsIngest.pure.ts";
// The copy the scheduled refresh workflow runs (Node).
import { rowsToDfatEntries as rowsJs, dfatListingKey as keyJs } from "../../../scripts/aml/sanctionsParsers.mjs";

/**
 * There are TWO implementations of the DFAT parser and only one list.
 *
 * `_shared/aml/sanctionsIngest.pure.ts` is what an MLRO's upload runs.
 * `scripts/aml/sanctionsParsers.mjs` is what the nightly refresh runs. They
 * write the same table, and this repo has been bitten before by exactly this
 * shape: two copies of one rule drift, and the drift is invisible because
 * each copy is self-consistent and separately tested.
 *
 * The drift that mattered here was the grouping. DFAT stopped repeating a
 * listing's reference on every name row and started suffixing it with a
 * letter, so `2`, `2a`, `2b` are one person. Fixing one copy and not the
 * other would mean the same file loaded two ways produces 3,846 listings or
 * 10,581, depending on who loaded it — and in the second case two rows in
 * three name the sanctioned party by an alias.
 *
 * So this asserts the two agree on real DFAT shapes rather than asserting
 * each is individually plausible.
 */

/** The format published since November 2025: suffixed references. */
const CURRENT = [
  ['Reference', 'Name of Individual or Entity', 'Type', 'Name Type',
   'Alias Strength', 'Date of Birth', 'Place of Birth', 'Citizenship',
   'Address', 'Additional Information', 'Listing Information', 'IMO Number',
   'Committees', 'Control Date', 'Instrument of Designation',
   'Targeted Financial Sanction', 'Travel Ban', 'Arms Embargo',
   'Maritime Restriction'],
  ['2', 'MOHAMMAD HASSAN AKHUND', 'Individual', 'Primary Name', '', '1945',
   'Kandahar', 'Afghanistan', 'Kabul', 'Taliban', '', '', '1988 (Taliban)',
   '3/26/26', 'Taliban Regulation 2013', 'TRUE', 'TRUE', 'FALSE', 'FALSE'],
  ['2a', 'محمد حسن أخوند', 'Individual', 'Original Script', '', '', '', '', '',
   '', '', '', '', '3/26/26', '', 'TRUE', 'TRUE', 'FALSE', 'FALSE'],
  ['2b', 'Haji Mudir', 'Individual', 'Alias', 'Weak', '', '', '', '', '', '',
   '', '', '3/26/26', '', 'TRUE', 'TRUE', 'FALSE', 'FALSE'],
  ['417', 'ANDAMAN SKIES', 'Vessel', 'Primary Name', '', '', '', '', '', '',
   '', '9288693', '', '5/8/26', 'Russia Instrument 2025', 'FALSE', 'FALSE',
   'FALSE', 'TRUE'],
];

/** The older format, kept so the fix cannot regress it. */
const LEGACY = [
  ['The Consolidated List', '', '', '', '', '', '', '', '', ''],
  ['Reference', 'Name of Individual or Entity', 'Name Type', 'Type',
   'Date of Birth', 'Place of Birth', 'Citizenship', 'Address',
   'Additional Information', 'Committees'],
  ['AF001', 'Mohammed Omar', 'Primary Name', 'Individual', '1960', 'Kandahar',
   'Afghan', 'Kabul', 'Taliban leader', 'Al-Qaida'],
  ['AF001', 'Mullah Omar', 'aka', 'Individual', '', '', '', '', '', ''],
  ['EN002', 'Acme Trading Pty Ltd', 'Primary Name', 'Entity', '', '', '',
   'Sydney', '', 'Autonomous'],
];

const sorted = (entries: any[]) =>
  [...entries].sort((a, b) => a.external_id.localeCompare(b.external_id));

describe("the two DFAT parsers cannot disagree", () => {
  it.each([["current format", CURRENT], ["legacy format", LEGACY]])(
    "produces identical entries — %s",
    (_label, rows) => {
      expect(sorted(rowsJs(rows))).toEqual(sorted(rowsTs(rows as unknown[][])));
    },
  );

  it("groups a suffixed reference the same way in both", () => {
    for (const [input, expected] of [
      ["2a", "2"], ["AF001", "AF001"], ["AF001b", "AF001"], ["ABC", "ABC"], ["", ""],
    ]) {
      expect(keyJs(input)).toBe(expected);
      expect(keyTs(input)).toBe(expected);
    }
  });

  it("both collapse 2 / 2a / 2b onto one listing with its aliases", () => {
    for (const parse of [rowsJs, rowsTs]) {
      const akhund = parse(CURRENT as unknown[][])
        .find((e: any) => e.external_id === "DFAT-2");
      expect(akhund.primary_name).toBe("MOHAMMAD HASSAN AKHUND");
      expect(akhund.aliases).toHaveLength(2);
      expect(akhund.listing_detail.weak_aliases).toEqual(["Haji Mudir"]);
    }
  });

  it("both type a designated vessel as a vessel", () => {
    for (const parse of [rowsJs, rowsTs]) {
      const vessel = parse(CURRENT as unknown[][])
        .find((e: any) => e.external_id === "DFAT-417");
      expect(vessel.entry_type).toBe("vessel");
      expect(vessel.listing_detail.imo_number).toBe("9288693");
      expect(vessel.listing_detail.measures.maritime_restriction).toBe(true);
    }
  });
});
