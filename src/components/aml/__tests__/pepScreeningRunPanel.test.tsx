import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PepScreeningRunPanel } from "../PepScreeningRunPanel";
import { buildScreeningRun } from "@/lib/aml/pepScreeningEngine";

/**
 * The screening result, on screen.
 *
 * The engine's own rules are pinned in `pepScreeningEngine.test.ts`. What is
 * asserted here is that RENDERING them cannot turn a search into a
 * clearance — an empty result must not be drawn as a success, every reading
 * must carry what was not reached, and a candidate must not be dismissible
 * without a reason.
 */

const runPepScreening = vi.fn();
const reviewPepScreeningCandidate = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    runPepScreening: (...a: unknown[]) => runPepScreening(...a),
    reviewPepScreeningCandidate: (...a: unknown[]) => reviewPepScreeningCandidate(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "55555555-5555-4555-8555-555555555555";

const source = (over = {}) => ({
  key: "wikidata_au_public_office",
  label: "Australian public office holders",
  status: "searched" as const,
  coverage: "offices whose jurisdiction is Australia",
  excludes: "family members and close associates",
  foundCount: 0,
  asAt: "2026-08-19",
  ...over,
});

const candidate = (over = {}) => ({
  id: "wikidata_au_public_office:Q42",
  sourceKey: "wikidata_au_public_office",
  name: "Pat Example",
  aliases: [],
  positionTitle: "member of the Australian Senate",
  jurisdiction: "Australia",
  positionStart: "2016-07-02",
  positionEnd: null,
  currentlyHeld: true,
  confirmUrl: "https://en.wikipedia.org/wiki/Pat_Example",
  score: 0.94,
  ...over,
});

const mockRun = (over = {}) => {
  const built = buildScreeningRun({
    searchedNames: ["Pat Example"],
    sources: [source()],
    candidates: [],
    sanctionsSignal: "none",
    declaration: { answered: true, answer: "no", summary: "The customer said no." },
    ...over,
  } as never);
  runPepScreening.mockResolvedValue({
    run: { ...built, id: "run-1", created_at: "2026-08-20T00:00:00.000Z" },
    evidence: null,
  });
  return built;
};

const renderPanel = (onEvidence = vi.fn()) => {
  render(
    <PepScreeningRunPanel caseId={CASE_ID} subjectId={SUBJECT_ID} onEvidence={onEvidence} />,
  );
  return onEvidence;
};

beforeEach(() => vi.clearAllMocks());

describe("before it is run", () => {
  it("says what it does and what it will not do", () => {
    renderPanel();
    expect(screen.getByText(/informs the determination; it never makes one/i)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("screens the party the caller named, never a caller-supplied name", async () => {
    mockRun();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    await waitFor(() => expect(runPepScreening).toHaveBeenCalledWith({
      case_id: CASE_ID, party_screening_subject_id: SUBJECT_ID,
    }));
  });
});

describe("an empty result is never drawn as a success", () => {
  it("reports on the search and says it clears nobody", async () => {
    mockRun();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/about the search, not about the person/i);
    expect(status.textContent).toMatch(/does not clear anybody/i);
  });

  it("nothing on the surface reads as a result about a person", async () => {
    mockRun();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    await screen.findByRole("status");
    const text = document.body.textContent ?? "";
    for (const forbidden of [
      /\bcleared\b/i, /\bclearance\b/i, /\bis not a pep\b/i,
      /\bnot politically exposed\b/i, /\bno match\b/i, /\bpassed\b/i,
    ]) expect(text).not.toMatch(forbidden);
  });

  it("renders what each source holds AND what it does not, under the empty result", async () => {
    mockRun();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    expect(await screen.findByText(/what was searched/i)).toBeTruthy();
    expect(screen.getByText(/does not hold family members/i)).toBeTruthy();
    expect(screen.getByText(/current to 2026-08-19/i)).toBeTruthy();
  });
});

describe("a source that was not searched", () => {
  it("says so, and is distinguished from one that found nothing", async () => {
    mockRun({
      sources: [
        source(),
        source({ key: "aph", label: "Parliament of Australia", status: "not_reachable",
          detail: "Blocks automated requests. Open it from the manual checks below." }),
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    expect(await screen.findByText(/not searchable from here/i)).toBeTruthy();
    expect(screen.getAllByText(/blocks automated requests/i).length).toBeGreaterThan(0);
  });

  it("a register that could not be READ is a technical condition", async () => {
    mockRun({ sources: [source({ status: "failed" })] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    expect((await screen.findAllByText(/could not be read/i)).length).toBeGreaterThan(0);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/nothing was checked/i);
  });

  it("a failed run is a toast, not an empty result", async () => {
    runPepScreening.mockRejectedValue(new Error("The server refused it."));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].variant).toBe("destructive");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a candidate needs a person", () => {
  it("shows the office, the dates, and a held seat AS AT the day the register was read", async () => {
    /*
     * It used to say the bare word "Current".
     *
     * Every Parliament row carries `currently_held: true` by construction —
     * the files are a snapshot of who sits on the day they are downloaded,
     * with no dates in them at all. An unqualified present tense is a claim
     * about today made from a photograph of last week, and it travels into
     * the evidence the determination rests on.
     *
     * The as-at comes off the run's own record of the source it searched, so
     * the badge cannot disagree with what was searched.
     */
    mockRun({ candidates: [candidate()] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    expect(await screen.findByText("Pat Example")).toBeTruthy();
    expect(screen.getByText(/australian senate/i)).toBeTruthy();
    expect(screen.getByText("Held as at 2026-08-19")).toBeTruthy();
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.getByText(/94% name match/)).toBeTruthy();
  });

  it("cannot be dismissed without saying how it was told", async () => {
    mockRun({ candidates: [candidate()] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    fireEvent.click(await screen.findByRole("button", { name: /not the customer/i }));
    // The submit is refused until a real reason is given.
    expect(screen.getByRole("button", { name: /record this/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/how did you tell/i), { target: { value: "no" } });
    expect(screen.getByRole("button", { name: /record this/i })).toBeDisabled();
    expect(screen.getByText(/exactly like nobody having looked/i)).toBeTruthy();
    expect(reviewPepScreeningCandidate).not.toHaveBeenCalled();
  });

  it("records a rejection with its reason", async () => {
    mockRun({ candidates: [candidate()] });
    reviewPepScreeningCandidate.mockResolvedValue({ review: {} });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    fireEvent.click(await screen.findByRole("button", { name: /not the customer/i }));
    fireEvent.change(screen.getByLabelText(/how did you tell/i), {
      target: { value: "Different date of birth; the senator is 30 years older." },
    });
    fireEvent.click(screen.getByRole("button", { name: /record this/i }));
    await waitFor(() => expect(reviewPepScreeningCandidate).toHaveBeenCalledWith({
      run_id: "run-1",
      candidate_id: candidate().id,
      decision: "rejected",
      reason: "Different date of birth; the senator is 30 years older.",
    }));
    expect(await screen.findByText(/rejected — a different person/i)).toBeTruthy();
  });

  it("an accepted candidate becomes a source row in the operator's own words", async () => {
    mockRun({ candidates: [candidate()] });
    reviewPepScreeningCandidate.mockResolvedValue({ review: {} });
    const onEvidence = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    fireEvent.click(await screen.findByRole("button", { name: /this is the customer/i }));
    fireEvent.change(screen.getByLabelText(/how did you confirm/i), {
      target: { value: "Date of birth and electorate match the client file." },
    });
    fireEvent.click(screen.getByRole("button", { name: /record this/i }));
    await waitFor(() => expect(onEvidence).toHaveBeenCalled());
    const draft = onEvidence.mock.calls[0][0];
    expect(draft.kind).toBe("official_register");
    expect(draft.source).toMatch(/confirmed against the official register/i);
    expect(draft.result).toBe("Date of birth and electorate match the client file.");
  });
});

describe("the run never settles the step", () => {
  it("says a person still has to look whenever anything was not reached", async () => {
    mockRun({ declaration: null });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /run screening/i }));
    expect(await screen.findByText(/a person still has to look/i)).toBeTruthy();
    expect(screen.getByText(/does not settle it/i)).toBeTruthy();
  });
});
