import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualScreeningDialog } from "../ManualScreeningDialog";
import { PartyScreeningPanel } from "../PartyScreeningPanel";
import type { AmlPartyScreeningSubject } from "@/lib/aml/amlCasesApi";

/**
 * The operator side of manual screening.
 *
 * Two things are being pinned. The dialog must not let a "no match" be
 * recorded without the sources checked, the names searched and a rationale —
 * and it must refuse for the SAME reason the server would, because a form
 * that disagrees with the server either blocks legitimate work or promises
 * work the server then rejects.
 *
 * And the control must be offered only to the MLRO, only where there is an
 * obligation to discharge, and never as an alternative to the obligation. It
 * appears when the provider is blocked as well as when it is not: a blocked
 * provider is precisely when screening by hand is the remedy.
 */

const listPartyScreening = vi.fn();
const queuePartyScreening = vi.fn();
const runOptionalScreening = vi.fn();
const adjudicatePartyScreening = vi.fn();
const recordPepDetermination = vi.fn();
const recordManualScreening = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    listPartyScreening: (...a: unknown[]) => listPartyScreening(...a),
    queuePartyScreening: (...a: unknown[]) => queuePartyScreening(...a),
    runOptionalScreening: (...a: unknown[]) => runOptionalScreening(...a),
    adjudicatePartyScreening: (...a: unknown[]) => adjudicatePartyScreening(...a),
    recordPepDetermination: (...a: unknown[]) => recordPepDetermination(...a),
    recordManualScreening: (...a: unknown[]) => recordManualScreening(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "55555555-5555-4555-8555-555555555555";

const subject = (over: Partial<AmlPartyScreeningSubject> = {}): AmlPartyScreeningSubject => ({
  id: SUBJECT_ID,
  case_id: CASE_ID,
  party_type: "beneficial_owner",
  party_id: null,
  screened_name: "Pat Example",
  required: true,
  state: "not_started",
  last_screened_at: null,
  refresh_due_at: null,
  adjudicated_at: null,
  adjudication_note: null,
  screening_check_id: null,
  error_category: null,
  matches: [],
  pep_determination: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listPartyScreening.mockResolvedValue({ subjects: [subject()], case_pep_determination: null });
  recordManualScreening.mockResolvedValue({
    check: { id: "c1" }, outcome: "no_match",
    policy_required: true, voluntary: false, satisfies_obligation: true,
  });
});

const renderDialog = (over: Partial<AmlPartyScreeningSubject> = {}) => {
  const onRecorded = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ManualScreeningDialog
      subject={subject(over)} open onOpenChange={onOpenChange} onRecorded={onRecorded}
    />,
  );
  return { onRecorded, onOpenChange };
};

const submitButton = () =>
  screen.getByRole("button", { name: /record manual screening/i });

const fillEvidence = () => {
  fireEvent.change(screen.getByLabelText(/source 1 name/i), {
    target: { value: "DFAT Consolidated List" },
  });
  fireEvent.change(screen.getByLabelText(/why the conclusion is reasonable/i), {
    target: {
      value: "Searched the published consolidated list against the legal name and both "
        + "recorded transliterations; no listing corresponds.",
    },
  });
};

describe("ManualScreeningDialog — the evidence bar the operator meets", () => {
  it("cannot be submitted with no source checked", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/why the conclusion is reasonable/i), {
      target: { value: "A rationale that is comfortably long enough to pass the minimum." },
    });
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/at least one source that was actually checked/i)).toBeTruthy();
  });

  it("cannot be submitted with no rationale", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/source 1 name/i), {
      target: { value: "DFAT Consolidated List" },
    });
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/at least 20 characters/i)).toBeTruthy();
  });

  it("cannot be submitted with no name searched", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/names actually searched/i), { target: { value: "" } });
    fillEvidence();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/at least one name that was actually searched/i)).toBeTruthy();
  });

  it("pre-fills the name the case actually screens", () => {
    renderDialog();
    expect((screen.getByLabelText(/names actually searched/i) as HTMLTextAreaElement).value)
      .toBe("Pat Example");
  });

  it("enables submission once the evidence is complete", () => {
    renderDialog();
    fillEvidence();
    expect(submitButton()).not.toBeDisabled();
  });

  it("says plainly that a complete no-match will be recorded as performed by the user", () => {
    renderDialog();
    fillEvidence();
    expect(screen.getByText(/recorded as a completed screening, performed by you/i)).toBeTruthy();
  });

  it("sends the structured evidence, not a blob of prose", async () => {
    const { onRecorded } = renderDialog();
    fillEvidence();
    fireEvent.click(submitButton());
    await waitFor(() => expect(recordManualScreening).toHaveBeenCalled());
    const payload = recordManualScreening.mock.calls[0][0];
    expect(payload.subject_id).toBe(SUBJECT_ID);
    expect(payload.outcome).toBe("no_match");
    expect(payload.sources[0].source_name).toBe("DFAT Consolidated List");
    expect(payload.searched_names).toEqual(["Pat Example"]);
    expect(onRecorded).toHaveBeenCalled();
  });

  it("never sends who performed it, when, or whether policy required it", async () => {
    renderDialog();
    fillEvidence();
    fireEvent.click(submitButton());
    await waitFor(() => expect(recordManualScreening).toHaveBeenCalled());
    const payload = recordManualScreening.mock.calls[0][0];
    for (const forbidden of [
      "performed_by", "performed_at", "policy_required", "voluntary",
      "required", "case_id", "status",
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it("reports a server refusal instead of claiming success", async () => {
    recordManualScreening.mockRejectedValueOnce(new Error("MLRO role required"));
    const { onRecorded } = renderDialog();
    fillEvidence();
    fireEvent.click(submitButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" })));
    expect(onRecorded).not.toHaveBeenCalled();
  });
});

describe("ManualScreeningDialog — unable to complete", () => {
  const chooseUnable = () =>
    fireEvent.click(screen.getByRole("radio", { name: /^unable to complete/i }));

  it("drops the evidence fields and asks why instead", () => {
    renderDialog();
    chooseUnable();
    expect(screen.queryByLabelText(/source 1 name/i)).toBeNull();
    expect(screen.getByText(/why it could not be concluded/i)).toBeTruthy();
  });

  it("is submittable with a reason and no evidence", async () => {
    recordManualScreening.mockResolvedValueOnce({
      check: { id: "c1" }, outcome: "unable_to_complete",
      policy_required: true, voluntary: false, satisfies_obligation: false,
    });
    renderDialog();
    chooseUnable();
    expect(submitButton()).not.toBeDisabled();
    fireEvent.click(submitButton());
    await waitFor(() => expect(recordManualScreening).toHaveBeenCalled());
    expect(recordManualScreening.mock.calls[0][0].unable_reason).toBe("insufficient_identity");
  });

  it("tells the operator the obligation is still outstanding", () => {
    renderDialog();
    chooseUnable();
    expect(screen.getByText(/does not discharge the screening obligation/i)).toBeTruthy();
  });
});

describe("ManualScreeningDialog — a match goes to the shared adjudication", () => {
  it("asks what matched, and refuses until it is named", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /^possible match/i }));
    fillEvidence();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/record the listed name that matched/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/candidate 1 listed name/i), {
      target: { value: "Patrik Exampel" },
    });
    expect(submitButton()).not.toBeDisabled();
  });

  it("does not claim the obligation is discharged by a finding", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /^possible match/i }));
    fillEvidence();
    fireEvent.change(screen.getByLabelText(/candidate 1 listed name/i), {
      target: { value: "Patrik Exampel" },
    });
    expect(screen.getByText(/does not discharge the screening obligation/i)).toBeTruthy();
  });
});

describe("PartyScreeningPanel — who is offered manual screening, and when", () => {
  const renderPanel = (props: Partial<Parameters<typeof PartyScreeningPanel>[0]> = {}) =>
    render(
      <PartyScreeningPanel
        caseId={CASE_ID} canWrite canAdjudicate onChanged={() => {}} {...props}
      />,
    );

  it("is not offered to a reviewer who is not the MLRO", async () => {
    renderPanel({ isMlro: false });
    await screen.findByText("Pat Example");
    expect(screen.queryByRole("button", { name: /perform manual sanctions screening/i })).toBeNull();
  });

  it("is offered to the MLRO", async () => {
    renderPanel({ isMlro: true });
    expect(await screen.findByRole("button", { name: /perform manual sanctions screening/i })).toBeTruthy();
  });

  it("is offered even when the provider blocks the automated path", async () => {
    renderPanel({ isMlro: true, screeningBlocked: "Screening cannot run — see the action above" });
    expect(await screen.findByRole("button", { name: /perform manual sanctions screening/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start screening/i })).toBeNull();
  });

  it("IS offered where the policy requires no screening, as an optional method", async () => {
    // The defect this replaces. Whether a screening is OWED and whether one
    // may be PERFORMED are different questions; a hand-written state
    // allowlist that omitted `not_required` made "not required" mean "not
    // permitted", while the server would have accepted the attempt and
    // recorded it correctly as voluntary.
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "not_required", required: false })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    expect(await screen.findByRole(
      "button", { name: /perform manual sanctions screening/i })).toBeTruthy();
    expect(screen.getByText(/MLRO only · optional/i)).toBeTruthy();
  });

  it("is NOT offered while an automated run is in flight", async () => {
    for (const state of ["queued", "processing"]) {
      listPartyScreening.mockResolvedValue({
        subjects: [subject({ state })], case_pep_determination: null,
      });
      const view = renderPanel({ isMlro: true });
      await screen.findByText("Pat Example");
      expect(screen.queryByRole("button", { name: /perform manual sanctions screening/i })).toBeNull();
      view.unmount();
    }
  });

  it("opens the dialog in one click", async () => {
    renderPanel({ isMlro: true });
    fireEvent.click(await screen.findByRole("button", { name: /perform manual sanctions screening/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(within(screen.getByRole("dialog"))
      .getByText(/not a way of\s+standing it down/i)).toBeTruthy();
  });

  it("says on the row that the current position was reached by hand", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "completed", screening_method: "manual" })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    expect(await screen.findByText(/reached by manual MLRO screening/i)).toBeTruthy();
  });

  it("renders one history, with the sources and names a manual attempt carries", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({
        state: "completed", screening_method: "manual",
        manual_checks: [{
          id: "c1", scope: ["sanctions"], status: "clear", manual_outcome: "no_match",
          unable_reason: null,
          rationale: "No listing corresponds to this party.",
          sources_checked: [{ source_type: "sanctions_list", source_name: "DFAT Consolidated List" }],
          searched_names: ["Pat Example"],
          performed_at: "2026-08-18T00:00:00.000Z",
          policy_required: true, voluntary: false,
        }],
      })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    expect(await screen.findByText(/sources: DFAT Consolidated List/i)).toBeTruthy();
    expect(screen.getByText(/names searched: Pat Example/i)).toBeTruthy();
    expect(screen.getByText(/No listing corresponds to this party\./i)).toBeTruthy();
  });

  it("marks a voluntary manual check as not required under policy", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({
        state: "completed",
        manual_checks: [{
          id: "c1", scope: ["sanctions"], status: "clear", manual_outcome: "no_match",
          unable_reason: null, rationale: null, sources_checked: [], searched_names: [],
          performed_at: "2026-08-18T00:00:00.000Z", policy_required: false, voluntary: true,
        }],
      })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    expect(await screen.findByText(/not required under policy/i)).toBeTruthy();
  });
});

/**
 * The exact production state that was reported, and the separations it
 * depends on.
 *
 * Sanctions `not_required`, PEP still required, provider unavailable, user is
 * the MLRO. Before this, the party row said "Optional sanctions screening
 * unavailable" and offered nothing but the two PEP buttons — an operator who
 * was entitled to screen by hand had no way to say so.
 */
describe("PartyScreeningPanel — sanctions not required, provider down, MLRO", () => {
  const renderPanel = (props: Partial<Parameters<typeof PartyScreeningPanel>[0]> = {}) =>
    render(
      <PartyScreeningPanel
        caseId={CASE_ID} canWrite canAdjudicate onChanged={() => {}} {...props}
      />,
    );

  const notRequired = (over: Partial<AmlPartyScreeningSubject> = {}) =>
    subject({ state: "not_required", required: false, ...over });

  beforeEach(() => {
    listPartyScreening.mockResolvedValue({
      subjects: [notRequired()], case_pep_determination: null,
    });
  });

  it("the reported case: automated unavailable, manual available, PEP outstanding", async () => {
    renderPanel({ isMlro: true, optionalUnavailable: true });

    // Sanctions: the policy decision, stated as one.
    expect(await screen.findByText(/not required under policy/i)).toBeTruthy();
    expect(screen.getByText(/no obligation arose, so nobody was screened/i)).toBeTruthy();

    // Automated: unavailable, and no dead action offered.
    expect(screen.getByText(/the provider or its list is not ready/i)).toBeTruthy();
    expect(screen.queryByRole(
      "button", { name: /run optional sanctions screening/i })).toBeNull();

    // Manual: available anyway. This is the defect being fixed.
    expect(screen.getByRole(
      "button", { name: /perform manual sanctions screening/i })).toBeTruthy();
    expect(screen.getByText(/MLRO only · optional/i)).toBeTruthy();

    // PEP: untouched, still its own outstanding obligation.
    expect(screen.getByText(/determination outstanding/i)).toBeTruthy();
    // ONE control, which opens the determination rather than answering it.
    expect(screen.getByRole(
      "button", { name: /record pep determination/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^not a pep$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /record pep/i })).toBeTruthy();
  });

  it("offers BOTH methods when the provider is available and screening is optional", async () => {
    renderPanel({ isMlro: true, optionalUnavailable: false });
    expect(await screen.findByRole(
      "button", { name: /run optional sanctions screening/i })).toBeTruthy();
    expect(screen.getByRole(
      "button", { name: /perform manual sanctions screening/i })).toBeTruthy();
  });

  it("offers BOTH methods when screening is required and the provider is up", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "not_started" })], case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    expect(await screen.findByRole("button", { name: /start screening/i })).toBeTruthy();
    expect(screen.getByRole(
      "button", { name: /perform manual sanctions screening/i })).toBeTruthy();
    expect(screen.getByText(/MLRO only · required/i)).toBeTruthy();
  });

  it("keeps the manual method when a REQUIRED screening is blocked by the provider", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "not_started" })], case_pep_determination: null,
    });
    renderPanel({ isMlro: true, screeningBlocked: "Screening cannot run — see the action above" });
    expect(await screen.findByRole(
      "button", { name: /perform manual sanctions screening/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start screening/i })).toBeNull();
  });

  it("opens the dialog for a not_required party in one click", async () => {
    renderPanel({ isMlro: true, optionalUnavailable: true });
    fireEvent.click(await screen.findByRole(
      "button", { name: /perform manual sanctions screening/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("sends no policy claim when recording against a not_required party", async () => {
    recordManualScreening.mockResolvedValue({
      check: { id: "c1" }, outcome: "no_match",
      policy_required: false, voluntary: true, satisfies_obligation: false,
      party_state: null,
    });
    renderPanel({ isMlro: true, optionalUnavailable: true });
    fireEvent.click(await screen.findByRole(
      "button", { name: /perform manual sanctions screening/i }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/source 1 name/i), {
      target: { value: "DFAT Consolidated List" },
    });
    fireEvent.change(screen.getByLabelText(/why the conclusion is reasonable/i), {
      target: { value: "Searched the published list against the legal name; no listing corresponds." },
    });
    fireEvent.click(screen.getByRole("button", { name: /record manual screening/i }));
    await waitFor(() => expect(recordManualScreening).toHaveBeenCalled());
    const payload = recordManualScreening.mock.calls[0][0];
    for (const forbidden of ["policy_required", "voluntary", "required", "state"]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it("shows the policy decision and a voluntary no-match at the same time", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [notRequired({
        manual_checks: [{
          id: "c1", scope: ["sanctions"], status: "clear", manual_outcome: "no_match",
          unable_reason: null,
          rationale: "No listing corresponds to this party.",
          sources_checked: [{ source_type: "sanctions_list", source_name: "DFAT Consolidated List" }],
          searched_names: ["Pat Example"],
          performed_at: "2026-08-18T00:00:00.000Z",
          policy_required: false, voluntary: true,
        }],
      })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true, optionalUnavailable: true });
    // Both true at once: the obligation and the result answer different
    // questions, so the phrase appears on the policy badge AND on the history.
    expect((await screen.findAllByText(/not required under policy/i)).length)
      .toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/voluntary manual sanctions screening/i)).toBeTruthy();
    expect(screen.getByText(/sources: DFAT Consolidated List/i)).toBeTruthy();
  });

  it("still surfaces a voluntary finding for adjudication", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({
        state: "possible_match", required: false, screening_method: "manual",
        matches: [{
          id: "44444444-4444-4444-8444-444444444444",
          screening_check_id: "c1", match_type: "sanctions",
          list_name: "DFAT Consolidated List (Australia)", matched_name: "Patrik Exampel",
          score: null, jurisdiction: "AU", status: "open",
        }],
      })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true, optionalUnavailable: true });
    expect(await screen.findByText("Patrik Exampel")).toBeTruthy();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeTruthy();
  });

  it("says a closed case still accepts compliance evidence rather than hiding the action", async () => {
    renderPanel({ isMlro: true, optionalUnavailable: true, caseStatus: "closed" });
    expect(await screen.findByRole(
      "button", { name: /perform manual sanctions screening/i })).toBeTruthy();
    expect(screen.getByText(/the case is closed, and AML evidence may still be recorded/i))
      .toBeTruthy();
  });

  it("shows a reviewer or analyst no manual control at all", async () => {
    for (const isMlro of [false, undefined]) {
      const view = renderPanel({ isMlro, optionalUnavailable: true });
      await screen.findByText("Pat Example");
      expect(screen.queryByRole(
        "button", { name: /perform manual sanctions screening/i })).toBeNull();
      view.unmount();
    }
  });

  it("still shows a reviewer the manual history they may read", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [notRequired({
        manual_checks: [{
          id: "c1", scope: ["sanctions"], status: "clear", manual_outcome: "no_match",
          unable_reason: null, rationale: "Nothing found.",
          sources_checked: [{ source_type: "sanctions_list", source_name: "DFAT Consolidated List" }],
          searched_names: ["Pat Example"], performed_at: "2026-08-18T00:00:00.000Z",
          policy_required: false, voluntary: true,
        }],
      })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: false });
    expect(await screen.findByText(/voluntary manual sanctions screening/i)).toBeTruthy();
    expect(screen.queryByRole(
      "button", { name: /perform manual sanctions screening/i })).toBeNull();
  });

  it("does not offer the manual method while an automated run is in flight", async () => {
    for (const state of ["queued", "processing"]) {
      listPartyScreening.mockResolvedValue({
        subjects: [subject({ state })], case_pep_determination: null,
      });
      const view = renderPanel({ isMlro: true });
      await screen.findByText("Pat Example");
      expect(screen.queryByRole(
        "button", { name: /perform manual sanctions screening/i })).toBeNull();
      view.unmount();
    }
  });

  it("does not offer it over an unadjudicated finding either", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "possible_match" })], case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    await screen.findByText("Pat Example");
    expect(screen.queryByRole(
      "button", { name: /perform manual sanctions screening/i })).toBeNull();
    expect(screen.getByText(/adjudicate them before recording a new screening/i)).toBeTruthy();
  });

  it("keeps sanctions and PEP visibly separate", async () => {
    renderPanel({ isMlro: true, optionalUnavailable: true });
    expect(await screen.findByText(/targeted financial sanctions/i)).toBeTruthy();
    expect(screen.getByText(/politically exposed person/i)).toBeTruthy();
  });

  it("an automated and a manual attempt coexist in one history", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({
        state: "completed", screening_method: "manual",
        last_screened_at: "2026-08-10T00:00:00.000Z",
        manual_checks: [{
          id: "c1", scope: ["sanctions"], status: "clear", manual_outcome: "no_match",
          unable_reason: null, rationale: "Nothing found.",
          sources_checked: [{ source_type: "sanctions_list", source_name: "DFAT Consolidated List" }],
          searched_names: ["Pat Example"], performed_at: "2026-08-18T00:00:00.000Z",
          policy_required: true, voluntary: false,
        }],
      })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    expect(await screen.findByText(/reached by manual MLRO screening/i)).toBeTruthy();
    expect(screen.getByText(/last screened/i)).toBeTruthy();
  });
});

/**
 * The dialog's SHAPE — the fast guard under the real-browser one.
 *
 * `tests-e2e/manual-screening-dialog/dialogViewports.e2e.ts` measures the
 * rendered boxes in Chromium, which is the only thing that can prove the
 * dialog is usable at 1366x768. These assertions are the cheap half: they run
 * on every CI push and catch the structure regressing — the footer sliding
 * back inside the scroll region, the width collapsing to a narrow column —
 * without waiting for a browser.
 *
 * They are deliberately about STRUCTURE, never about pixels. A class list
 * cannot tell you a dialog fits on a screen, and pretending otherwise is how
 * the original defect passed review.
 */
describe("ManualScreeningDialog — header, scrolling body, fixed footer", () => {
  const dialogEl = () => screen.getByRole("dialog");
  const bodyEl = () => document.querySelector('[data-testid="manual-screening-body"]')!;
  const footerEl = () => document.querySelector('[data-testid="manual-screening-footer"]')!;

  it("is no longer a 672px column", () => {
    renderDialog();
    expect(dialogEl().className).not.toMatch(/\bmax-w-2xl\b/);
    expect(dialogEl().className).toMatch(/sm:w-\[min\(1100px,94vw\)\]/);
    expect(dialogEl().className).toMatch(/sm:max-w-none/);
  });

  it("does not scroll as one column — the dialog itself clips", () => {
    renderDialog();
    expect(dialogEl().className).toMatch(/\boverflow-hidden\b/);
    expect(dialogEl().className).not.toMatch(/\boverflow-y-auto\b/);
    expect(dialogEl().className).toMatch(/\bflex flex-col\b/);
  });

  it("gives the body its own scroll region that can actually shrink", () => {
    renderDialog();
    // `min-h-0` is the half people leave out: without it a flex child refuses
    // to shrink below its content and the footer is pushed off the screen.
    expect(bodyEl().className).toMatch(/\bmin-h-0\b/);
    expect(bodyEl().className).toMatch(/\bflex-1\b/);
    expect(bodyEl().className).toMatch(/\boverflow-y-auto\b/);
  });

  it("keeps the footer OUTSIDE the scrolling body", () => {
    renderDialog();
    expect(bodyEl().contains(footerEl())).toBe(false);
    expect(footerEl().className).toMatch(/\bshrink-0\b/);
  });

  it("keeps the header outside it too", () => {
    renderDialog();
    const header = document.querySelector('[data-testid="manual-screening-header"]')!;
    expect(bodyEl().contains(header)).toBe(false);
    expect(header.className).toMatch(/\bshrink-0\b/);
  });

  it("the footer holds both actions and the reason a submission is refused", () => {
    renderDialog();
    const footer = footerEl();
    expect(footer.textContent).toMatch(/cancel/i);
    expect(footer.textContent).toMatch(/record manual screening/i);
    // Disabled with nothing filled in, and the reason is right there.
    expect(submitButton()).toBeDisabled();
    expect(footer.textContent).toMatch(/at least one source that was actually checked/i);
  });

  it("bounds its height in dvh so mobile browser chrome cannot hide the footer", () => {
    renderDialog();
    expect(dialogEl().className).toMatch(/max-h-\[95dvh\]/);
    expect(dialogEl().className).toMatch(/sm:max-h-\[90dvh\]/);
  });

  it("lays the four outcomes out in two columns on desktop, one on mobile", () => {
    renderDialog();
    const grid = document.querySelector('[data-testid="manual-outcome-grid"]')!;
    expect(grid.className).toMatch(/\bgrid\b/);
    expect(grid.className).toMatch(/sm:grid-cols-2/);
    // No UNPREFIXED column count: a bare `grid-cols-2` would force two
    // columns onto a phone. (The browser test measures the collapse itself.)
    expect(grid.className.split(/\s+/)).not.toContain("grid-cols-2");
    expect(grid.querySelectorAll('[role="radio"]')).toHaveLength(4);
  });

  it("splits the evidence across two columns on a wide screen", () => {
    renderDialog();
    const grid = document.querySelector('[data-testid="manual-evidence-grid"]')!;
    expect(grid.className).toMatch(/lg:grid-cols-\[minmax\(0,1\.35fr\)_minmax\(0,1fr\)\]/);
  });

  it("lays a source row out as a grid rather than a stack", () => {
    renderDialog();
    const row = document.querySelector('[data-testid="manual-source-row"]')!;
    expect(row.className).toMatch(/\bgrid\b/);
    expect(row.className).toMatch(/sm:grid-cols-2/);
    // All four fields still there.
    expect(screen.getByLabelText(/source 1 type/i)).toBeTruthy();
    expect(screen.getByLabelText(/source 1 name/i)).toBeTruthy();
    expect(screen.getByLabelText(/source 1 reference/i)).toBeTruthy();
    expect(screen.getByLabelText(/source 1 searched at/i)).toBeTruthy();
  });

  it("lays candidate fields out as a grid, with every field kept", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /^possible match/i }));
    const row = document.querySelector('[data-testid="manual-candidate-row"]')!;
    expect(row.className).toMatch(/sm:grid-cols-2/);
    for (const field of [/listed name/i, /candidate 1 list$/i, /jurisdiction/i, /candidate 1 reference/i, /basis/i]) {
      expect(screen.getByLabelText(field)).toBeTruthy();
    }
  });

  it("lays the unable reasons out in two columns and drops the evidence fields", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /^unable to complete/i }));
    const grid = document.querySelector('[data-testid="manual-unable-grid"]')!;
    expect(grid.className).toMatch(/sm:grid-cols-2/);
    expect(document.querySelector('[data-testid="manual-source-row"]')).toBeNull();
    expect(screen.queryByLabelText(/names actually searched/i)).toBeNull();
    // The footer is unchanged by the branch.
    expect(footerEl().textContent).toMatch(/record manual screening/i);
  });

  it("keeps the scope select, and the PEP distinction with it", () => {
    renderDialog();
    expect(screen.getByLabelText(/screened/i)).toBeTruthy();
    expect(dialogEl().textContent).toMatch(/obligation is unchanged/i);
  });

  it("still refuses a duplicate submission while one is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    recordManualScreening.mockImplementationOnce(
      () => new Promise((res) => { release = res; }));
    renderDialog();
    fillEvidence();
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton()).toBeDisabled());
    fireEvent.click(submitButton());
    fireEvent.click(submitButton());
    expect(recordManualScreening).toHaveBeenCalledTimes(1);
    release({
      check: { id: "c1" }, outcome: "no_match",
      policy_required: true, voluntary: false, satisfies_obligation: true,
    });
  });

  it("does not let the busy dialog be dismissed out from under a request", async () => {
    let release: (v: unknown) => void = () => {};
    recordManualScreening.mockImplementationOnce(
      () => new Promise((res) => { release = res; }));
    const { onOpenChange } = renderDialog();
    fillEvidence();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled());
    release({
      check: { id: "c1" }, outcome: "no_match",
      policy_required: true, voluntary: false, satisfies_obligation: true,
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
