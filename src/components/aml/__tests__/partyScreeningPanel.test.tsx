import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PartyScreeningPanel } from "../PartyScreeningPanel";
import type { AmlPartyScreeningSubject } from "@/lib/aml/amlCasesApi";

/**
 * The repaired party screening panel: staff inspect the actual canonical
 * candidate matches before adjudicating, adjudication resolves a specific
 * match through the accessible dialog (no window.prompt), and PEP
 * determination state is visible and actionable.
 */

const listPartyScreening = vi.fn();
const queuePartyScreening = vi.fn();
const runOptionalScreening = vi.fn();
const adjudicatePartyScreening = vi.fn();
const recordPepDetermination = vi.fn();
const deferPepDetermination = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    listPartyScreening: (...a: unknown[]) => listPartyScreening(...a),
    queuePartyScreening: (...a: unknown[]) => queuePartyScreening(...a),
    runOptionalScreening: (...a: unknown[]) => runOptionalScreening(...a),
    adjudicatePartyScreening: (...a: unknown[]) => adjudicatePartyScreening(...a),
    recordPepDetermination: (...a: unknown[]) => recordPepDetermination(...a),
    deferPepDetermination: (...a: unknown[]) => deferPepDetermination(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const CHECK_ID = "33333333-3333-4333-8333-333333333333";
const MATCH_ID = "44444444-4444-4444-8444-444444444444";

const subject = (over: Partial<AmlPartyScreeningSubject> = {}): AmlPartyScreeningSubject => ({
  id: "55555555-5555-4555-8555-555555555555",
  case_id: CASE_ID,
  party_type: "beneficial_owner",
  party_id: null,
  screened_name: "Pat Example",
  required: true,
  state: "possible_match",
  last_screened_at: "2026-08-01T00:00:00.000Z",
  refresh_due_at: null,
  adjudicated_at: null,
  adjudication_note: null,
  screening_check_id: CHECK_ID,
  error_category: null,
  matches: [{
    id: MATCH_ID, screening_check_id: CHECK_ID, match_type: "sanctions",
    list_name: "DFAT Consolidated List (Australia)", matched_name: "Patrik Exampel",
    score: 0.88, jurisdiction: "AU", status: "open",
  }],
  pep_determination: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listPartyScreening.mockResolvedValue({ subjects: [subject()], case_pep_determination: null });
});

const renderPanel = (props: Partial<Parameters<typeof PartyScreeningPanel>[0]> = {}) =>
  render(
    <PartyScreeningPanel
      caseId={CASE_ID} canWrite canAdjudicate onChanged={() => {}} {...props}
    />,
  );

describe("PartyScreeningPanel — canonical candidate adjudication", () => {
  it("shows the canonical candidate match so staff can inspect before deciding", async () => {
    renderPanel();
    expect(await screen.findByText("Pat Example")).toBeTruthy();
    expect(screen.getByText(/Patrik Exampel/)).toBeTruthy();
    expect(screen.getByText(/DFAT Consolidated List/)).toBeTruthy();
    expect(screen.getByText(/possible match/)).toBeTruthy();
  });

  it("adjudicates the specific match through the dialog — never window.prompt", async () => {
    adjudicatePartyScreening.mockResolvedValue({ subject: subject({ state: "confirmed_match" }) });
    const promptSpy = vi.spyOn(window, "prompt");
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    // The accessible dialog collects the rationale.
    const note = await screen.findByLabelText(/adjudication rationale/i);
    fireEvent.change(note, { target: { value: "Same DOB and listed alias." } });
    fireEvent.click(screen.getByRole("button", { name: /^confirm match$/i }));
    await waitFor(() => expect(adjudicatePartyScreening).toHaveBeenCalledWith(
      subject().id, MATCH_ID, "confirmed_match", "Same DOB and listed alias.",
    ));
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("dismissing a candidate resolves that match as a false positive", async () => {
    adjudicatePartyScreening.mockResolvedValue({ subject: subject({ state: "false_positive" }) });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    const note = await screen.findByLabelText(/adjudication rationale/i);
    fireEvent.change(note, { target: { value: "Different person, DOB mismatch." } });
    fireEvent.click(screen.getByRole("button", { name: /dismiss match/i }));
    await waitFor(() => expect(adjudicatePartyScreening).toHaveBeenCalledWith(
      subject().id, MATCH_ID, "false_positive", "Different person, DOB mismatch.",
    ));
  });

  it("hides adjudication from staff without the adjudication role", async () => {
    renderPanel({ canAdjudicate: false });
    expect(await screen.findByText(/awaiting reviewer\/MLRO/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
  });

  it("surfaces the error state with its category, offering a retry", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "error", error_category: "list_data_unavailable", matches: [] })],
      case_pep_determination: null,
    });
    renderPanel();
    expect(await screen.findByText("error")).toBeTruthy();
    expect(screen.getByText(/list data unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry screening/i })).toBeTruthy();
  });

  it("7, 10. a not-required subject offers the optional run and nothing else", async () => {
    // No Retry, no provider blocker, no "upload the sanctions list": none of
    // those are steps towards anything on a case that is not waiting.
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "not_required", required: false, matches: [] })],
      case_pep_determination: null,
    });
    renderPanel();
    expect(await screen.findByRole(
      "button", { name: /run optional sanctions screening/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry screening/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /start screening/i })).toBeNull();
    // ...and it is never presented as a screening outcome.
    expect(screen.queryByText(/\bclear\b/i)).toBeNull();
    expect(screen.queryByText(/no match/i)).toBeNull();
  });

  it("16. an unavailable provider says so without offering a dead action", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "not_required", required: false, matches: [] })],
      case_pep_determination: null,
    });
    renderPanel({ optionalUnavailable: true });
    // The unavailability is now stated against the AUTOMATED method, which is
    // the only one it applies to.
    expect(await screen.findByText(/the provider or its list is not ready/i)).toBeTruthy();
    expect(screen.getByText(/nothing is blocked/i)).toBeTruthy();
    expect(screen.queryByRole(
      "button", { name: /run optional sanctions screening/i })).toBeNull();
  });

  it("12. running it calls the optional operation, not the mandatory one", async () => {
    runOptionalScreening.mockResolvedValue({ ran: true, scope_required: false });
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "not_required", required: false, matches: [] })],
      case_pep_determination: null,
    });
    renderPanel();
    fireEvent.click(await screen.findByRole(
      "button", { name: /run optional sanctions screening/i }));
    await waitFor(() => expect(runOptionalScreening).toHaveBeenCalledWith(subject().id));
    expect(queuePartyScreening).not.toHaveBeenCalled();
  });

  it("labels a voluntary run as one, naming who asked", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({
        state: "completed", required: false, matches: [],
        voluntary_run_at: "2026-08-18T00:00:00.000Z",
        voluntary_run_by_label: "mlro@npcservices.com.au",
      })],
      case_pep_determination: null,
    });
    renderPanel();
    expect(await screen.findByText(/run voluntarily by mlro@npcservices\.com\.au/i)).toBeTruthy();
    expect(screen.getByText(/not required under policy/i)).toBeTruthy();
  });

  it("tells an administrator a simulator-mode provider is unfinished, not absent", async () => {
    // The state production converges to while `pep_sanctions` is
    // `local_lists`, active, mode `simulator`. The consumers used to record
    // this as `provider_not_configured`, so the panel offered to configure a
    // provider that already existed and never named the real remedy.
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "error", error_category: "provider_misconfigured", matches: [] })],
      case_pep_determination: null,
    });
    renderPanel();
    expect(await screen.findByText("error")).toBeTruthy();
    expect(screen.getByText(/provider misconfigured/i)).toBeTruthy();
    expect(screen.queryByText(/No screening provider is configured/i)).toBeNull();
  });
});

describe("PartyScreeningPanel — PEP determination", () => {
  /*
   * The panel offers ONE control, because there is one act. Two buttons
   * labelled with the two answers picked the conclusion before the evidence
   * was looked at, which is the wrong way round for a determination.
   */
  it("flags an outstanding PEP determination and offers one control, not an answer", async () => {
    renderPanel();
    expect(await screen.findByText(/determination outstanding/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /record pep determination/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^not a pep$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /record not-pep/i })).toBeNull();
  });

  it("records a not-PEP through the evidence dialog, with structured sources", async () => {
    recordPepDetermination.mockResolvedValue({ determination: { id: "x" } });
    renderPanel();
    fireEvent.click(await screen.findByRole(
      "button", { name: /record pep determination/i }));

    // The dialog opens with no outcome chosen — the answer is picked after
    // the sources, not by the way in.
    expect(await screen.findByText(/record the pep determination/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /add a source/i }));
    fireEvent.change(screen.getByLabelText(/^source 1$/i), {
      target: { value: "Australian Government Directory" },
    });
    fireEvent.change(screen.getByLabelText(/^searched or reference 1$/i), {
      target: { value: "Pat Example" },
    });
    fireEvent.change(screen.getByLabelText(/^what came back 1$/i), {
      target: { value: "No entry for this name" },
    });
    fireEvent.click(screen.getByRole(
      "radio", { name: /not a politically exposed person/i }));
    fireEvent.change(screen.getByLabelText(/why you are satisfied on reasonable grounds/i), {
      target: { value: "No public office found in any consulted source." },
    });
    fireEvent.click(screen.getByRole("button", { name: /record determination/i }));

    await waitFor(() => expect(recordPepDetermination).toHaveBeenCalled());
    const payload = recordPepDetermination.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.result).toBe("not_pep");
    expect(payload.party_screening_subject_id).toBe(subject().id);
    expect(payload.methods).toEqual([{
      kind: "open_source",
      source: "Australian Government Directory",
      reference: "Pat Example",
      result: "No entry for this name",
      note: null,
    }]);
    expect(payload.rationale).toBe("No public office found in any consulted source.");
  });

  /*
   * The defect this dialog was built for. The old flow's own example of a
   * source was the DFAT consolidated list, which is a targeted financial
   * sanctions register: absence from it is not evidence that somebody is not
   * politically exposed, so a determination resting on it rests on nothing.
   */
  it("refuses a sanctions register as the source of a PEP determination", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole(
      "button", { name: /record pep determination/i }));
    fireEvent.click(await screen.findByRole("button", { name: /add a source/i }));
    fireEvent.change(screen.getByLabelText(/^source 1$/i), {
      target: { value: "DFAT consolidated list — screened via case screening" },
    });
    fireEvent.change(screen.getByLabelText(/^what came back 1$/i), {
      target: { value: "no match" },
    });
    fireEvent.click(screen.getByRole(
      "radio", { name: /not a politically exposed person/i }));
    fireEvent.change(screen.getByLabelText(/why you are satisfied on reasonable grounds/i), {
      target: { value: "Nothing found against the sanctions register." },
    });

    expect(screen.getAllByText(/is a sanctions register/i).length).toBeGreaterThan(0);
    expect(screen.getByRole(
      "button", { name: /record determination/i })).toBeDisabled();
    expect(recordPepDetermination).not.toHaveBeenCalled();
  });

  /*
   * A tick on a step that is not settled is worse than no tick: it is the
   * product telling an operator they are done. Step 2 read its state off the
   * live verdict, which carries only an "outcome" error until an outcome is
   * picked — so it showed a green tick with nothing in it but the customer's
   * own declaration, which can never satisfy the independent-source rule.
   */
  it("does not tick the sources step for a declaration that cannot stand alone", async () => {
    renderPanel({
      pepDeclaration: {
        answered: true, answer: "no", complete: true,
        summary: "The customer answered no to the political-exposure question.",
        relationship: null, role: null, country: null,
      },
    });
    fireEvent.click(await screen.findByRole(
      "button", { name: /record pep determination/i }));
    await screen.findByText(/check the sources/i);

    // The seeded declaration is one method, and it is not enough.
    const step = screen.getByText(/check the sources/i).closest("div")?.parentElement;
    expect(step?.textContent).toContain("Check the sources");
    // The step number renders instead of the tick until an independent
    // source with a recorded result is present.
    expect(screen.getByText("2")).toBeTruthy();
  });

  /*
   * The customer's own answer is the thing being tested. It is evidence
   * towards the determination and can never be the whole of one — so the
   * dialog seeds it as a source, and refuses to let it stand alone.
   */
  it("will not accept the customer's declaration as the only source", async () => {
    renderPanel({
      pepDeclaration: {
        answered: true, answer: "no", complete: true,
        summary: "The customer answered no to the political-exposure question.",
        relationship: null, role: null, country: null,
      },
    });
    fireEvent.click(await screen.findByRole(
      "button", { name: /record pep determination/i }));
    // Held under step 1 as read-only evidence — not an editable row in the
    // "check the sources" grid, where it read as a source somebody checked.
    expect(await screen.findByText(
      /the customer's declaration in the client portal/i)).toBeTruthy();
    expect(screen.queryByDisplayValue(
      /the customer's declaration in the client portal/i)).toBeNull();
    expect(screen.getByText(/carried into the record as evidence/i)).toBeTruthy();


    fireEvent.click(screen.getByRole(
      "radio", { name: /not a politically exposed person/i }));
    fireEvent.change(screen.getByLabelText(/why you are satisfied on reasonable grounds/i), {
      target: { value: "The customer answered no to the question." },
    });

    expect(screen.getAllByText(/independent of the customer/i).length)
      .toBeGreaterThan(0);
    expect(screen.getByRole(
      "button", { name: /record determination/i })).toBeDisabled();
    expect(recordPepDetermination).not.toHaveBeenCalled();
  });

  /*
   * "Cannot determine yet" is not a third outcome — it writes no
   * determination. Forcing an operator to pick "not a PEP" to close a dialog
   * is exactly how an unfounded conclusion gets written down.
   */
  it("defers without writing a determination", async () => {
    deferPepDetermination.mockResolvedValue({ deferred: true });
    renderPanel();
    fireEvent.click(await screen.findByRole(
      "button", { name: /record pep determination/i }));
    fireEvent.click(await screen.findByRole(
      "radio", { name: /cannot determine yet/i }));
    fireEvent.click(await screen.findByRole(
      "radio", { name: /identity could not be confirmed/i }));
    fireEvent.change(screen.getByLabelText(/what is needed/i), {
      target: { value: "Date of birth, to separate them from a same-named MP." },
    });
    fireEvent.click(screen.getByRole("button", { name: /record what is needed/i }));

    await waitFor(() => expect(deferPepDetermination).toHaveBeenCalled());
    expect(recordPepDetermination).not.toHaveBeenCalled();
    const payload = deferPepDetermination.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.reason).toBe("identity_ambiguous");
  });

  it("shows a recorded PEP determination instead of the outstanding flag", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({
        state: "completed", matches: [],
        pep_determination: {
          id: "pd1", party_screening_subject_id: subject().id, subject_name: "Pat Example",
          result: "pep", pep_type: "foreign", pep_relationship: "self",
          determined_at: "2026-08-01T00:00:00.000Z", determined_by_label: "reviewer@example.com",
          review_due_at: "2027-08-01T00:00:00.000Z", superseded_at: null,
        },
      })],
      case_pep_determination: null,
    });
    renderPanel();
    expect(await screen.findByText(/PEP · foreign \(self\)/)).toBeTruthy();
    expect(screen.queryByText(/PEP determination outstanding/)).toBeNull();
  });
});
