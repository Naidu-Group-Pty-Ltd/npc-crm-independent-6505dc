import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PepOfficeholderIndexPanel } from "../PepOfficeholderIndexPanel";
import { describeCoverage, searchVerdict } from "@/lib/aml/pepOfficeholderIndex";

/**
 * The empty reading is the one that has to be right.
 *
 * Zero candidates for somebody the index never covered looks exactly like
 * zero candidates for somebody who holds no office. So the coverage renders
 * underneath every reading, there is no tick and no green in the empty
 * state, and nothing on screen can be read as a clearance.
 */

const searchPepOfficeholders = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    searchPepOfficeholders: (...a: unknown[]) => searchPepOfficeholders(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "55555555-5555-4555-8555-555555555555";

const coverage = (over = {}) => ({
  ...describeCoverage("wikidata_au_public_office", {
    entry_count: 12000, source_as_at: "2026-08-19",
    completed_at: "2026-08-19T00:00:00.000Z", status: "succeeded",
    detail: {
      office_count: 724, distinct_offices: 724,
      sample_offices: ["Prime Minister of Australia", "Justice of the High Court of Australia"],
    },
  }),
  ...over,
});

const candidate = (over = {}) => ({
  dateOfBirth: undefined,
  dob: undefined,
  externalId: "Q42", sourceCode: "wikidata_au_public_office",
  fullName: "Pat Example", aliases: ["Patricia Example"],
  positionTitle: "Member of the Australian House of Representatives",
  pepType: null, jurisdiction: "Australia",
  positionStart: "2016-07-02", positionEnd: null, currentlyHeld: true,
  confirmUrl: "https://en.wikipedia.org/wiki/Pat_Example", score: 0.94,
  ...over,
});

const renderPanel = (onAddSource = vi.fn()) => {
  render(
    <PepOfficeholderIndexPanel
      caseId={CASE_ID} subjectId={SUBJECT_ID} onAddSource={onAddSource}
    />,
  );
  return onAddSource;
};

beforeEach(() => vi.clearAllMocks());

describe("before anybody presses anything", () => {
  it("says what it can and cannot do, without having searched", () => {
    renderPanel();
    expect(screen.getByText(/can never clear anybody/i)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("searches the party the caller named, never a caller-supplied name", async () => {
    searchPepOfficeholders.mockResolvedValue(searchVerdict({
      hasSearchableName: true, candidates: [], coverage: [coverage()],
    }));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => expect(searchPepOfficeholders).toHaveBeenCalledWith({
      case_id: CASE_ID, party_screening_subject_id: SUBJECT_ID,
    }));
  });
});

describe("the empty reading", () => {
  beforeEach(() => {
    searchPepOfficeholders.mockResolvedValue(searchVerdict({
      hasSearchableName: true, candidates: [], coverage: [coverage()],
    }));
  });

  it("renders the coverage underneath it, including what is NOT covered", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(await screen.findByText(/not an answer to the question/i)).toBeTruthy();
    expect(screen.getByText(/what this index holds/i)).toBeTruthy();
    expect(screen.getAllByText(/does not cover/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/12,000 people/i)).toBeTruthy();
    // The measured office count, which is the fact a coverage SENTENCE got
    // wrong: a load holding two offices read identically to one holding 724.
    expect(screen.getByText(/across 724 offices/i)).toBeTruthy();
    expect(screen.getByText(/Prime Minister of Australia/)).toBeTruthy();
    expect(screen.getByText(/current to 2026-08-19/i)).toBeTruthy();
  });

  it("says nothing that reads as a result", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    const status = await screen.findByRole("status");
    // The panel's own header does say the word "clear" — in the sentence
    // "it can never clear anybody", which is the denial. What must never
    // appear is an ASSERTED clearance, anywhere on the surface.
    for (const forbidden of [
      /\bcleared\b/i, /\bclearance\b/i, /no match/i, /not a pep/i,
      /\bnot politically exposed\b/i, /\bpassed\b/i,
    ]) {
      expect(document.body.textContent ?? "").not.toMatch(forbidden);
    }
    expect(status.textContent ?? "").not.toMatch(/\bclear/i);
  });

  it("names the source as collaboratively edited, so a hit reads as a lead", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(await screen.findByText(/collaboratively edited/i)).toBeTruthy();
  });
});

describe("an index that has not looked", () => {
  it("reports unavailable rather than empty", async () => {
    searchPepOfficeholders.mockResolvedValue(searchVerdict({
      hasSearchableName: true, candidates: [],
      coverage: [coverage({ entryCount: 0, lastSyncStatus: "failed" })],
    }));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(await screen.findByText(/has not loaded, so nothing was searched/i)).toBeTruthy();
    expect(screen.getAllByText(/not loaded/i).length).toBeGreaterThan(0);
  });

  it("a failed search is a technical condition, not an empty result", async () => {
    searchPepOfficeholders.mockRejectedValue(new Error("The office-holder index could not be searched."));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].variant).toBe("destructive");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a candidate", () => {
  beforeEach(() => {
    searchPepOfficeholders.mockResolvedValue(searchVerdict({
      hasSearchableName: true, candidates: [candidate()], coverage: [coverage()],
    }));
  });

  it("shows the office, the dates, and a held seat AS AT a date", async () => {
    /*
     * It used to say the bare word "Current".
     *
     * Every row from the Parliament register carries `currently_held: true`
     * by construction — the files are a snapshot of who sits on the day they
     * are downloaded. That is accurate at the load and decays from then on,
     * so a member who lost their seat at an election read as "Current" for as
     * long as nothing reloaded, and that word travels into the evidence a
     * determination rests on.
     *
     * The date is what makes the claim checkable.
     */
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(await screen.findByText("Pat Example")).toBeTruthy();
    expect(screen.getByText(/House of Representatives/)).toBeTruthy();
    expect(screen.getByText(/Held as at 2026-08-19/)).toBeTruthy();
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.getByText(/94% name match/)).toBeTruthy();
  });

  it("marks a former office holder as former rather than hiding it", async () => {
    // Leaving office is a risk assessment, not an expiry date.
    searchPepOfficeholders.mockResolvedValue(searchVerdict({
      hasSearchableName: true,
      candidates: [candidate({ currentlyHeld: false, positionEnd: "2022-05-21" })],
      coverage: [coverage()],
    }));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(await screen.findByText("Formerly held")).toBeTruthy();
  });

  it("records as a source with the RESULT left empty for the operator", async () => {
    const onAddSource = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /record this as a source/i }));
    expect(onAddSource).toHaveBeenCalledTimes(1);
    const draft = onAddSource.mock.calls[0][0];
    expect(draft.result).toBe("");
    expect(draft.kind).toBe("official_register");
    expect(draft.source.toLowerCase()).not.toContain("wikidata");
  });

  it("offers the confirm link, because the register is the source", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(await screen.findByRole("button", { name: /open to confirm/i })).toBeTruthy();
  });
});
