import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PepDeterminationDialog } from "../PepDeterminationDialog";
import { buildScreeningRun } from "@/lib/aml/pepScreeningEngine";

/**
 * A refetch behind the dialog must not throw away the operator's work.
 *
 * ── What happens on the real screen ───────────────────────────────────
 * The workspace keeps an open case current with `useLiveCaseRefresh`, which
 * refetches **on `focus` and `visibilitychange`**. The determination screen's
 * own design asks the operator to open official registers in a new tab and
 * come back — so returning from a register IS a refetch, every time.
 *
 * The refetch produces a new `pep_declaration` object with identical content,
 * because a parsed JSON payload is a new object. The dialog's reset effect
 * was keyed on that object:
 *
 *     }, [open, declaration]);
 *
 * so it fired, cleared `runSources`, and the cascade effect then stripped
 * every row the run had recorded. The screening card above stayed — the run
 * lives in the child — while the checklist below it emptied, and the only way
 * back was to run the screening again. Which is what "it comes in and out"
 * looks like from the operator's chair.
 *
 * Object identity of refetched data is not a signal that anything changed.
 * These tests hold that.
 */

const runPepScreening = vi.fn();
const recordPepDetermination = vi.fn();
const pepOfficeholderIndexStatus = vi.fn();
const reviewPepScreeningCandidate = vi.fn();
const listPepScreeningRuns = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    listPepScreeningRuns: (...a: unknown[]) => listPepScreeningRuns(...a),
    runPepScreening: (...a: unknown[]) => runPepScreening(...a),
    recordPepDetermination: (...a: unknown[]) => recordPepDetermination(...a),
    deferPepDetermination: vi.fn(),
    pepOfficeholderIndexStatus: (...a: unknown[]) => pepOfficeholderIndexStatus(...a),
    reviewPepScreeningCandidate: (...a: unknown[]) => reviewPepScreeningCandidate(...a),
  },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const subject = {
  id: "55555555-5555-4555-8555-555555555555",
  case_id: CASE_ID,
  screened_name: "Rugesh Naidu",
  party_type: "individual",
  state: "cleared",
} as never;

/** A source the run reports as read — the one that cascades. */
const aphSearched = {
  key: "aph_commonwealth_parliament",
  label: "Senators and members of the Australian Parliament",
  status: "searched" as const,
  coverage: "the senators and members currently sitting",
  excludes: "former members and senators",
  foundCount: 0,
  asAt: "2026-08-20",
};

/**
 * A fresh object every call, with identical content.
 *
 * This is precisely what a refetch hands the dialog: `JSON.parse` cannot
 * return the object it returned last time.
 */
const declaration = () => ({
  answered: true, answer: "no" as const, relationship: null, role: null, country: null,
  complete: true,
  summary: "The customer declared that neither they nor a family member holds office.",
});

beforeEach(() => {
  vi.clearAllMocks();
  pepOfficeholderIndexStatus.mockResolvedValue({ coverage: [] });
  listPepScreeningRuns.mockResolvedValue({ runs: [], reviews: [] });
  runPepScreening.mockResolvedValue({
    run: {
      ...buildScreeningRun({
        searchedNames: ["Rugesh Naidu"],
        sources: [aphSearched],
        candidates: [],
        sanctionsSignal: "none",
        declaration: { answered: true, answer: "no", summary: null },
      }),
      id: "99999999-9999-4999-8999-999999999999",
    },
  });
});

const renderDialog = (decl: ReturnType<typeof declaration>) => render(
  <PepDeterminationDialog
    subject={subject} caseId={CASE_ID} declaration={decl}
    sanctionsSignal="none" open onOpenChange={vi.fn()} onRecorded={vi.fn()}
  />,
);

/** The wording `describeRunResult` produces for the cascaded row. */
const CASCADED = /Searched by the platform on this run/;

describe("the run's results survive a refetch behind the dialog", () => {
  it("a new declaration object with identical content changes nothing", async () => {
    const { rerender } = renderDialog(declaration());
    fireEvent.click(await screen.findByRole("button", { name: /run screening/i }));
    await waitFor(() => expect(screen.getAllByDisplayValue(CASCADED).length)
      .toBeGreaterThan(0));

    /*
     * The refetch. Same content, new object — exactly what returning from an
     * opened register produced, via `focus` → `screeningStage.reload()`.
     */
    rerender(
      <PepDeterminationDialog
        subject={subject} caseId={CASE_ID} declaration={declaration()}
        sanctionsSignal="none" open onOpenChange={vi.fn()} onRecorded={vi.fn()}
      />,
    );

    expect(screen.getAllByDisplayValue(CASCADED).length).toBeGreaterThan(0);
  });

  it("a row the operator typed survives it too", async () => {
    const { rerender } = renderDialog(declaration());
    fireEvent.click(await screen.findByRole("button", { name: /run screening/i }));
    await waitFor(() => expect(screen.getAllByDisplayValue(CASCADED).length)
      .toBeGreaterThan(0));

    /*
     * Opening a register records a row against it — and it is this very
     * action that triggers the refetch, because `window.open` moves focus
     * away and coming back fires `focus`.
     */
    const before = screen.getAllByLabelText(/what came back/i).length;
    fireEvent.click(
      screen.getAllByRole("button", { name: /open register and record/i })[0]);
    await waitFor(() => expect(screen.getAllByLabelText(/what came back/i).length)
      .toBe(before + 1));

    rerender(
      <PepDeterminationDialog
        subject={subject} caseId={CASE_ID} declaration={declaration()}
        sanctionsSignal="none" open onOpenChange={vi.fn()} onRecorded={vi.fn()}
      />,
    );

    // The row the operator opened, and the run's own row, both still there.
    expect(screen.getAllByLabelText(/what came back/i).length).toBe(before + 1);
    expect(screen.getAllByDisplayValue(CASCADED).length).toBeGreaterThan(0);
  });

  it("what the operator has typed into the determination survives it", async () => {
    // The refetch fires on a timer as well as on focus, so this could land
    // mid-sentence with nothing the operator did to provoke it.
    const { rerender } = renderDialog(declaration());
    const rationale = await screen.findByLabelText(/why you are satisfied/i);
    fireEvent.change(rationale, { target: { value: "Checked both registers." } });

    rerender(
      <PepDeterminationDialog
        subject={subject} caseId={CASE_ID} declaration={declaration()}
        sanctionsSignal="none" open onOpenChange={vi.fn()} onRecorded={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("Checked both registers.")).toBeTruthy();
  });
});

describe("a genuinely different party does start clean", () => {
  it("the previous party's run and rows do not carry across", async () => {
    /*
     * The other half of the rule. Immunity to refetches must not become
     * immunity to the thing the reset is actually for — telling an operator a
     * register was searched for a party it was never searched for is the same
     * lie, arrived at from the opposite direction.
     */
    const { rerender } = renderDialog(declaration());
    fireEvent.click(await screen.findByRole("button", { name: /run screening/i }));
    await waitFor(() => expect(screen.getAllByDisplayValue(CASCADED).length)
      .toBeGreaterThan(0));

    rerender(
      <PepDeterminationDialog
        subject={{ ...(subject as object), id: "66666666-6666-4666-8666-666666666666",
          screened_name: "Someone Else" } as never}
        caseId={CASE_ID} declaration={declaration()}
        sanctionsSignal="none" open onOpenChange={vi.fn()} onRecorded={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryAllByDisplayValue(CASCADED)).toHaveLength(0));
    // And the run panel offers a fresh run rather than "Run again".
    expect(screen.getByRole("button", { name: /^run screening$/i })).toBeTruthy();
  });
});
