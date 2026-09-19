import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PepIndexReadiness } from "../PepIndexReadiness";
import { describeCoverage } from "@/lib/aml/pepOfficeholderIndex";

/**
 * The tool, named where the work is.
 *
 * The index was reachable only from inside the determination dialog, so an
 * operator could not tell it existed — let alone whether it had loaded —
 * until after they had opened the dialog and searched. A whole working
 * integration was invisible from the step it serves.
 *
 * What it may say is tightly bounded: it describes the TOOL and never the
 * subject. An index in perfect health is not evidence about anybody.
 */

const pepOfficeholderIndexStatus = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    pepOfficeholderIndexStatus: (...a: unknown[]) => pepOfficeholderIndexStatus(...a),
  },
}));

const coverage = (over = {}) => ({
  ...describeCoverage("wikidata_au_public_office", {
    entry_count: 10558, source_as_at: "2026-08-19",
    completed_at: "2026-08-19T22:42:22.000Z", status: "succeeded",
    detail: { office_count: 724, distinct_offices: 676, sample_offices: ["Senator"] },
  }),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("a loaded index", () => {
  it("says how much is loaded and how current it is", async () => {
    pepOfficeholderIndexStatus.mockResolvedValue({ coverage: [coverage()], usable: true });
    render(<PepIndexReadiness />);
    expect(await screen.findByText(/office-holder index ready/i)).toBeTruthy();
    expect(screen.getByText(/10,558 people/)).toBeTruthy();
    expect(screen.getByText(/across 676 offices/)).toBeTruthy();
    expect(screen.getByText(/current to 2026-08-19/)).toBeTruthy();
  });

  it("says a hit is a candidate, in the same breath as saying it is ready", async () => {
    // A healthy index is a healthy TOOL. Nothing here is a statement about
    // the party being determined.
    pepOfficeholderIndexStatus.mockResolvedValue({ coverage: [coverage()], usable: true });
    render(<PepIndexReadiness />);
    expect(await screen.findByText(/never clears anybody/i)).toBeTruthy();
  });

  it("never says anything that reads as a result about a person", async () => {
    pepOfficeholderIndexStatus.mockResolvedValue({ coverage: [coverage()], usable: true });
    render(<PepIndexReadiness />);
    await screen.findByText(/office-holder index ready/i);
    const text = document.body.textContent ?? "";
    for (const forbidden of [
      /\bno match\b/i, /\bcleared\b/i, /\bclearance\b/i, /\bnot a pep\b/i,
      /\bnot politically exposed\b/i,
    ]) expect(text).not.toMatch(forbidden);
  });
});

describe("two registers, reported on their own terms", () => {
  const aph = () => ({
    ...describeCoverage("aph_commonwealth_parliament", {
      entry_count: 225, source_as_at: "2026-08-20",
      completed_at: "2026-08-20T08:00:00.000Z", status: "succeeded",
      detail: { distinct_offices: 275, sample_offices: ["Prime Minister"] },
    }),
  });

  it("never adds the entry counts together", async () => {
    /*
     * The two registers overlap almost completely at the federal level —
     * every sitting member of Parliament is in both — so 225 + 10,558 is a
     * count of ROWS wearing the label of a count of PEOPLE.
     *
     * That is the overstatement this index already shipped once, when a load
     * holding two offices read identically to one holding seven hundred.
     */
    pepOfficeholderIndexStatus.mockResolvedValue({
      coverage: [aph(), coverage()], usable: true,
    });
    render(<PepIndexReadiness />);
    await screen.findByText(/office-holder index ready/i);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/225 people/);
    expect(text).toMatch(/10,558 people/);
    expect(text).not.toMatch(/10,783/);        // the sum
    expect(text).not.toMatch(/951 offices/);   // the sum of offices
  });

  it("names a register that did not load, rather than omitting it", async () => {
    // "Index ready" while half of it is missing tells an operator the search
    // reached further than it did.
    pepOfficeholderIndexStatus.mockResolvedValue({
      coverage: [aph(), coverage({ entryCount: 0, lastSyncStatus: "failed" })],
      usable: true,
    });
    render(<PepIndexReadiness />);
    await screen.findByText(/office-holder index ready/i);
    expect(screen.getByText(/not loaded, and therefore not searched/i)).toBeTruthy();
    expect(document.body.textContent).toContain("Australian public office holders");
  });
});

describe("an index that is not loaded", () => {
  it("says so, and does not imply the step is blocked", async () => {
    // The determination is made from the sources an operator checks. This
    // only saves them typing, so its absence must not read as an obstacle.
    pepOfficeholderIndexStatus.mockResolvedValue({
      coverage: [coverage({ entryCount: 0, lastSyncStatus: "never" })], usable: false,
    });
    render(<PepIndexReadiness />);
    expect(await screen.findByText(/not loaded/i)).toBeTruthy();
    expect(screen.getByText(/still open from inside the determination/i)).toBeTruthy();
  });

  it("a failed read is unknown, never an index holding nothing", async () => {
    pepOfficeholderIndexStatus.mockRejectedValue(new Error("503"));
    render(<PepIndexReadiness />);
    expect(await screen.findByText(/state could not be read/i)).toBeTruthy();
    // "Could not read" and "holds nothing" are different facts.
    expect(screen.queryByText(/not loaded/i)).toBeNull();
    expect(screen.getByText(/determination is unaffected/i)).toBeTruthy();
  });
});

describe("while it is being read", () => {
  it("says it is checking rather than asserting either state", async () => {
    pepOfficeholderIndexStatus.mockReturnValue(new Promise(() => {}));
    render(<PepIndexReadiness />);
    await waitFor(() => expect(screen.getByText(/checking the office-holder index/i)).toBeTruthy());
    expect(screen.queryByText(/ready/i)).toBeNull();
    expect(screen.queryByText(/not loaded/i)).toBeNull();
  });
});
