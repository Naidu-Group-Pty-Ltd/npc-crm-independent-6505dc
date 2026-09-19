import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScreeningPathCard } from "../ScreeningPathCard";
import { deriveScreeningPath } from "@/lib/aml/screeningSteps.pure";
import type { AmlScreeningStageSync } from "@/lib/aml/amlCasesApi";
import type { AmlCaseScreeningPosition } from "@/lib/aml/screeningScope";

/**
 * Stage 5's path, rendered.
 *
 * The screenshots that prompted this showed one act — record a PEP
 * determination — asked for four times, in four sets of words, among nine
 * panels of equal weight, on a case where everything else was settled. The
 * assertions below are about what an operator SEES: one thing to do, one
 * button to do it with, and every other step reduced to a line that says
 * what it was and why.
 */

const onAct = vi.fn();
const onReviewPerimeter = vi.fn();
const onOpenDetail = vi.fn();
const onContinue = vi.fn();

beforeEach(() => vi.clearAllMocks());

const scope = (key: string, required: boolean, reason: string, reasonCode = "") => ({
  scope: key, required, optional: !required,
  state: required ? "required" : "not_required", reason_code: reasonCode, reason,
} as never);

const action = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  label: "Record PEP determination",
  headline: "PEP determinations outstanding",
  detail: "A determination is still recorded against each party.",
  owner: "reviewer",
  ...over,
} as never);

/** `AML-2026-00005`: reopened, enquiry-only, one party, PEP outstanding. */
const sync = (over: Partial<AmlScreeningStageSync> = {}): AmlScreeningStageSync => ({
  enrolled: 1,
  subjects: [],
  policy: { summary: "Reduced scope.", policyVersion: "2026.08-1",
    notRequired: [], evidence: {} } as never,
  scopes: [
    scope("sanctions", false, "This record exists for an enquiry or quotation only.",
      "perimeter:enquiry_only"),
    scope("pep", true, "A determination is owed for every party in scope.",
      "pep_determination_required"),
  ],
  perimeter: {
    classification: "outside_perimeter", classified: true, reason_code: "enquiry_only",
    scopes_excluded: ["sanctions"], recorded_by_label: "Rugesh Naidu",
    recorded_at: "2026-08-19T12:19:45.727Z",
  } as never,
  policy_version: "2026.08-1",
  provider_ready: false,
  provider_relevant: false,
  next_action: action("record_pep"),
  decision_recorded: false,
  scope_changed: [],
  case_closed: false,
  ...over,
} as AmlScreeningStageSync);

const position = (over: Partial<AmlCaseScreeningPosition> = {}): AmlCaseScreeningPosition => ({
  subjects: [{
    id: "s1", name: "Rugesh Naidu", partyType: "primary_subject", required: false,
    state: "not_required",
    sanctions: { state: "not_required", resolved: false, detail: "not required" },
    pep: { resolved: false, detail: "outstanding" },
    outstanding: ["pep"],
  }] as never,
  facts: {} as never,
  read: true,
  ...over,
} as AmlCaseScreeningPosition);

const REVIEWER = { canWrite: true, isReviewer: true, isMlro: false };

function renderPath(over: {
  sync?: AmlScreeningStageSync;
  position?: AmlCaseScreeningPosition;
  actor?: typeof REVIEWER;
} = {}) {
  const s = over.sync ?? sync();
  return render(
    <ScreeningPathCard
      path={deriveScreeningPath({ sync: s, position: over.position ?? position() })}
      caseClosed={s.case_closed === true}
      closedAction={s.next_action?.key === "reopen_case" ? s.next_action : null}
      actor={over.actor ?? REVIEWER}
      onAct={onAct}
      onReviewPerimeter={onReviewPerimeter}
      onOpenDetail={onOpenDetail}
      onContinue={onContinue}
    />,
  );
}

/* ── 1. One act, once ─────────────────────────────────────────────────── */

describe("the reported case, on screen", () => {
  it("offers the act exactly once", () => {
    renderPath();
    expect(screen.getAllByRole("button", { name: /record pep determination/i }))
      .toHaveLength(1);
  });

  it("says where the operator is on the path", () => {
    renderPath();
    // Four steps apply here: perimeter, parties, sanctions, pep, resolve.
    expect(screen.getByRole("heading", { level: 3 }).textContent)
      .toMatch(/^Step \d+ of \d+$/);
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("opens the step the server is asking for, and only that one", () => {
    renderPath();
    const expanded = screen.getAllByRole("button", { expanded: true });
    expect(expanded).toHaveLength(1);
    expect(expanded[0].textContent).toMatch(/record the pep determination/i);
  });

  it("performs the server's own action object", () => {
    renderPath();
    fireEvent.click(screen.getByRole("button", { name: /record pep determination/i }));
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onAct.mock.calls[0][0]).toMatchObject({ key: "record_pep" });
  });

  it("shows the settled steps as one line each, not as panels", () => {
    renderPath();
    // Every step is a disclosure button; only the current one is expanded.
    const steps = screen.getAllByRole("button", { expanded: false });
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });
});

/* ── 2. The vocabulary an operator reads ──────────────────────────────── */

describe("obligation is never dressed as a result", () => {
  it("labels the sanctions step Not required, never Done", () => {
    renderPath();
    const step = screen.getByText(/screen for targeted financial sanctions/i)
      .closest("li")!;
    expect(within(step).getByText("Not required")).toBeTruthy();
    expect(within(step).queryByText("Done")).toBeNull();
  });

  it("says nobody was screened and nobody was cleared, when opened", () => {
    renderPath();
    fireEvent.click(screen.getByText(/screen for targeted financial sanctions/i));
    expect(screen.getByText(/nobody was screened and nobody\s+was cleared/i)).toBeTruthy();
  });

  it("never renders the word clear as an outcome for an unscreened case", () => {
    const { container } = renderPath();
    expect(container.textContent).not.toMatch(/\bno match\b/i);
  });
});

/* ── 3. The reopened enquiry is raised without hijacking the ask ──────── */

describe("the classification question", () => {
  it("asks for confirmation on the perimeter step", () => {
    renderPath();
    const step = screen.getByText(/confirm what kind of case this is/i).closest("li")!;
    expect(within(step).getByText(/confirm this still holds/i)).toBeTruthy();
  });

  it("still leaves the PEP step as the open one", () => {
    renderPath();
    const expanded = screen.getAllByRole("button", { expanded: true });
    expect(expanded[0].textContent).toMatch(/pep/i);
  });

  it("routes the confirmation to the classification dialog", () => {
    renderPath();
    fireEvent.click(screen.getByText(/confirm what kind of case this is/i));
    fireEvent.click(screen.getByRole("button", { name: /confirm or change the classification/i }));
    expect(onReviewPerimeter).toHaveBeenCalledTimes(1);
  });

  it("offers no classification control to somebody who may not record one", () => {
    renderPath({ actor: { canWrite: true, isReviewer: false, isMlro: false } });
    fireEvent.click(screen.getByText(/confirm what kind of case this is/i));
    expect(screen.queryByRole("button", { name: /classification/i })).toBeNull();
    expect(screen.getByText(/a reviewer or the MLRO records this classification/i)).toBeTruthy();
  });
});

/* ── 4. Authorisation is shown, never faked ───────────────────────────── */

describe("who may act", () => {
  it("shows no button to an analyst, and says who can", () => {
    /*
     * `record_pep_determination` answers a non-reviewer with 403. Until this
     * work the key fell through to `canWrite`, so an analyst was offered the
     * one button Stage 5 was asking for on the reported case — a CTA that
     * reads as the step which unblocks the case and cannot succeed.
     */
    renderPath({ actor: { canWrite: true, isReviewer: false, isMlro: false } });
    expect(screen.queryByRole("button", { name: "Record PEP determination" })).toBeNull();
    expect(screen.getByText("A reviewer or the MLRO records a PEP determination.")).toBeTruthy();
  });

  it("still offers it to a reviewer", () => {
    renderPath();
    expect(screen.getByRole("button", { name: "Record PEP determination" })).toBeTruthy();
  });
});

/* ── 5. A closed case is a record, not a path ─────────────────────────── */

describe("a closed case", () => {
  const closed = sync({
    case_closed: true,
    next_action: action("reopen_case", { label: "Reopen the case", owner: "reviewer" }),
  });

  it("leads with the retained record and no step pointer", () => {
    renderPath({ sync: closed });
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/closed/i);
    expect(screen.queryByRole("button", { expanded: true })).toBeNull();
  });

  it("offers the authorised reopen and nothing else", () => {
    renderPath({ sync: closed });
    expect(screen.getByRole("button", { name: /reopen the case/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /continue to funding/i })).toBeNull();
  });

  it("does not promise that reopening restores the gate or the passport", () => {
    renderPath({ sync: closed });
    expect(screen.getByText(/does not approve the service/i)).toBeTruthy();
  });
});

/* ── 6. The way on, only when the server says so ──────────────────────── */

describe("finishing the stage", () => {
  it("offers Continue only when the server reports no action left", () => {
    renderPath();
    expect(screen.queryByRole("button", { name: /continue to funding/i })).toBeNull();

    renderPath({
      sync: sync({ next_action: action("none", { label: null, owner: "none" }) }),
      position: position({
        subjects: [{
          id: "s1", name: "Rugesh Naidu", partyType: "primary_subject", required: false,
          state: "not_required",
          sanctions: { state: "not_required", resolved: false, detail: "" },
          pep: { resolved: true, detail: "not a PEP" },
          outstanding: [],
        }] as never,
      }),
    });
    expect(screen.getByRole("button", { name: /continue to funding/i })).toBeTruthy();
    expect(screen.getByText(/evidence completion only/i)).toBeTruthy();
  });
});

/* ── 6b. A candidate is not announced as a finding ────────────────────── */

describe("the finding banner", () => {
  const screened = (state: string) => ({
    sync: sync({
      scopes: [
        scope("sanctions", true, "TFS applies.", "tfs_obligation"),
        scope("pep", true, "Owed.", "pep_determination_required"),
      ],
      provider_relevant: true, provider_ready: true,
      next_action: action("adjudicate_match", { label: "Adjudicate the candidate" }),
    }),
    position: position({
      subjects: [{
        id: "s1", name: "Rugesh Naidu", partyType: "primary_subject", required: true,
        state,
        sanctions: { state, resolved: false, detail: "" },
        pep: { resolved: true, detail: "not a PEP" },
        outstanding: ["sanctions"],
      }] as never,
    }),
  });

  it("stays silent for a candidate nobody has looked at yet", () => {
    renderPath(screened("possible_match"));
    expect(screen.queryByText(/a screening finding is recorded/i)).toBeNull();
    expect(screen.getByText(/1 candidate awaiting adjudication/i)).toBeTruthy();
  });

  it("announces a confirmed match", () => {
    renderPath(screened("confirmed_match"));
    expect(screen.getByText(/a screening finding is recorded/i)).toBeTruthy();
  });
});

/* ── 7. The detail is one click away, per step ────────────────────────── */

describe("the evidence beneath", () => {
  it("names the step whose detail is being opened", () => {
    renderPath();
    fireEvent.click(screen.getByRole("button", { name: /open the full detail for this step/i }));
    expect(onOpenDetail).toHaveBeenCalledWith("pep");
  });
});
