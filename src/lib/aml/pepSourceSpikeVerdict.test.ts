import { describe, expect, it } from "vitest";

import {
  FORMAT_SATISFIED_BY,
  classifyBody,
  formatSatisfies,
  sniff,
} from "../../../scripts/aml/pep-source-spike.mjs";
import { CANDIDATE_SOURCES, CONTROLS } from "../../../scripts/aml/pepSourceCatalogue.mjs";

/**
 * The probe's verdict is a MEASUREMENT, and a wrong one is worse than none.
 *
 * ── What this exists to stop ──────────────────────────────────────────
 * The DFAT control downloaded 1,299,680 bytes of a real spreadsheet from a
 * GitHub Actions runner and the run reported it as a FAILED CONTROL. An OOXML
 * file is a zip container, so it sniffs as `zip/xlsx/docx`; the catalogue says
 * `xlsx`; the comparison was `expect !== format` with two hand-written
 * exceptions, and `xlsx` was not one of them.
 *
 * The damage was not the FAIL line. It was the paragraph the script prints
 * underneath it — telling a reader the run had measured the network and that
 * every candidate line in it was uninterpretable — printed about a run whose
 * control had worked perfectly. A prober defect had been dressed up as a
 * finding about somebody else's infrastructure.
 *
 * So: a sniff names a FAMILY, a catalogue entry names a MEMBER, and
 * membership is declared in one table rather than inferred at the comparison.
 */

const bytes = (s: string) => Buffer.from(s, "latin1");

describe("what came back either satisfies what was expected, or is named", () => {
  it("an .xlsx is satisfied by the zip container it actually is", () => {
    // The whole defect, in one line.
    expect(formatSatisfies("xlsx", "zip/xlsx/docx")).toBe(true);
  });

  it("sniffing an OOXML file cannot say more than 'zip'", () => {
    // PK\x03\x04 — and nothing in the first two bytes distinguishes an .xlsx
    // from a .docx. The probe deliberately does not open the container, so
    // the expectation has to meet the sniff rather than the other way round.
    expect(sniff(bytes("PK\x03\x04\x14\x00\x06\x00"))).toBe("zip/xlsx/docx");
  });

  it("a CSV expectation is satisfied by a delimited body", () => {
    expect(formatSatisfies("csv", "csv-like")).toBe(true);
    expect(sniff(bytes("Surname,First Name,Electorate\nExample,Pat,Fake"))).toBe("csv-like");
  });

  it("an expectation nothing declares is only met exactly", () => {
    // Failing loudly on one source beats failing quietly on every source.
    expect(formatSatisfies("sqlite", "zip/xlsx/docx")).toBe(false);
    expect(formatSatisfies("sqlite", "sqlite")).toBe(true);
  });

  it("no expectation claimed means nothing to contradict", () => {
    expect(formatSatisfies(null, "html")).toBe(true);
    expect(formatSatisfies(undefined, "pdf")).toBe(true);
  });

  it("still refuses the substitution the spike was built to catch", () => {
    // `Members_List.csv` answers 200 with 184 KB beginning `%PDF-1.7`. That
    // must stay a wrong-format reading, or an adapter gets written against a
    // PDF because the URL ended in .csv.
    expect(sniff(bytes("%PDF-1.7\n%\xe2\xe3\xcf\xd3"))).toBe("pdf");
    expect(formatSatisfies("csv", "pdf")).toBe(false);
  });

  it("a block page wearing a 200 is still a block", () => {
    const page = bytes("<!DOCTYPE html><html><body>Access Denied · Incapsula</body></html>");
    expect(classifyBody(page, "html")).toMatch(/block page/);
  });
});

describe("every expectation in the catalogue is one the table can satisfy", () => {
  it("names no format the probe could never report", () => {
    /*
     * A catalogue entry expecting a format that no sniff can produce is a
     * source permanently reported as broken — the same failure as the DFAT
     * control, arriving through the data rather than the code.
     */
    const SNIFFABLE = new Set([
      "pdf", "zip/xlsx/docx", "gzip", "xml", "html", "json",
      "xml-or-html", "csv-like", "text", "empty",
    ]);
    const unreachable: string[] = [];
    for (const s of [...CONTROLS, ...CANDIDATE_SOURCES]) {
      if (!s.expect) continue;
      const satisfiedBy = [s.expect, ...(FORMAT_SATISFIED_BY[s.expect] ?? [])];
      if (!satisfiedBy.some((f: string) => SNIFFABLE.has(f))) {
        unreachable.push(`${s.key} expects ${s.expect}`);
      }
    }
    expect(unreachable).toEqual([]);
  });
});
