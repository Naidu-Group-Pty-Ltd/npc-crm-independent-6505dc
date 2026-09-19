import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AmlCaseWorkspace from "../AmlCaseWorkspace";
import type { AmlCase } from "@/lib/aml/amlCasesApi";

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });

const get = vi.fn();
const listClientRequests = vi.fn();
const transition = vi.fn();
const consentStatus = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    get: (...a: unknown[]) => get(...a),
    listClientRequests: (...a: unknown[]) => listClientRequests(...a),
    transition: (...a: unknown[]) => transition(...a),
    consentStatus: (...a: unknown[]) => consentStatus(...a),
    listRequirements: () => Promise.resolve({ requirements: [] }),
    listDocuments: () => Promise.resolve({ documents: [] }),
    createClientRequest: vi.fn(),
    resolveClientRequest: vi.fn(),
  },
}));
vi.mock("@/lib/aml/amlFinanceApi", () => ({
  amlFinanceApi: { listEvidence: () => Promise.resolve({ evidence: [] }) },
}));
vi.mock("@/lib/aml/amlTransactionsApi", () => ({ amlTransactionsApi: {} }));
vi.mock("@/lib/aml/amlMonitoringApi", () => ({
  amlMonitoringApi: { caseMonitoringSummary: () => Promise.resolve({ monitoring: null }) },
}));
// Section bodies are heavy trees with their own data models — replace with
// labelled stubs; this suite is about the workspace shell.
vi.mock("@/components/aml/VerificationSection", () => ({
  VerificationSection: () => <div data-testid="section-verification" />,
}));
vi.mock("@/components/aml/ReliancePassportSection", () => ({
  ReliancePassportSection: () => <div data-testid="section-reliance" />,
}));
vi.mock("@/components/aml/ComplianceJourneyMap", () => ({
  ComplianceJourneyMap: () => <div data-testid="journey-map" />,
}));
// Stage 9's approval act fetches its own facts (gate contract, open
// conditions); the shell suite only cares that the stage mounts the ACT,
// not the full gate card or the readiness ledger both removed before it.
vi.mock("@/components/aml/CaseWorkspaceTabs", () => ({
  VerificationTab: () => <div data-testid="tab-verification" />,
  ScreeningTab: () => <div data-testid="tab-screening" />,
  RiskTab: () => <div data-testid="tab-risk" />,
  OwnershipControlTab: () => <div data-testid="tab-ownership" />,
  FundingFinanceTab: () => <div data-testid="tab-finance" />,
  TimelineTab: () => <div data-testid="tab-timeline" />,
  AuditTab: () => <div data-testid="tab-audit" />,
}));

let mockWorkspaceFlag = true;
vi.mock("@/lib/aml/useAmlV3Flags", () => ({
  useAmlV3Flags: () => ({
    v3Nav: false, startClientCompliance: false, complianceHome: false,
    caseWorkspace: mockWorkspaceFlag,
    regulatoryHub: false, terminologyEditor: false, metricsRelocation: false,
    orgSettings: false, loading: false,
  }),
}));

let mockRoles = new Set(["analyst", "reviewer", "mlro"]);
vi.mock("@/hooks/useAmlAccess", () => ({
  useAmlAccess: () => ({
    loading: false, flagEnabled: true, roles: mockRoles,
    hasAnyRole: mockRoles.size > 0, canWrite: true,
    isMlro: mockRoles.has("mlro"), refresh: vi.fn(),
  }),
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const baseCase: AmlCase = {
  id: CASE_ID,
  case_reference: "AML-2026-00001",
  client_id: "22222222-2222-4222-8222-222222222222",
  purchase_file_id: null,
  subject_type: "individual",
  subject_display_name: "Avery Client",
  status: "kyc_complete",
  risk_rating: "medium", risk_score: null,
  assigned_analyst_id: null, assigned_mlro_id: null,
  opened_at: "2026-08-01T00:00:00Z", closed_at: null,
  metadata: {}, created_by: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z",
} as AmlCase;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location" data-search={location.search} />;
}

function setup(url = `/admin/aml/cases/${CASE_ID}`) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/admin/aml/cases/:caseId"
          element={<><AmlCaseWorkspace /><LocationProbe /></>}
        />
        <Route path="/admin/aml/cases" element={<><div data-testid="register-page" /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  get.mockReset();
  listClientRequests.mockReset();
  consentStatus.mockReset();
  toast.mockReset();
  mockWorkspaceFlag = true;
  mockRoles = new Set(["analyst", "reviewer", "mlro"]);
  get.mockResolvedValue({ case: baseCase, events: [] });
  listClientRequests.mockResolvedValue({ requests: [] });
  consentStatus.mockResolvedValue({ version: 1, satisfied: true, outstanding: [], documents: [], history: [] });
});

describe("AmlCaseWorkspace — full-page shell", () => {
  it("renders the persistent case header with gate and risk in text", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Avery Client" })).toBeInTheDocument();
    expect(screen.getByText("AML-2026-00001")).toBeInTheDocument();
    // Risk and the gate are the header's only two badges, and they are
    // always words — never colour alone.
    expect(screen.getByText(/Service gate: Under review/)).toBeInTheDocument();
    expect(screen.getByText(/Risk: MEDIUM/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the case register" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Client record/ })).toBeInTheDocument();
  });

  it("renders the ten-stage journey rail with the open stage marked for assistive tech", async () => {
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    const rail = screen.getByRole("list", { name: "Compliance journey stages" });
    for (const stage of [
      "Activation", "Intake", "Identity", "Documents", "Screening",
      "Funding", "Submission", "Decision", "Passport & Partners", "Ongoing CDD",
    ]) {
      expect(within(rail).getByText(stage)).toBeInTheDocument();
    }
    // The unparameterised default opens on stage 1.
    expect(within(rail).getByText("Activation").closest("li"))
      .toHaveAttribute("aria-current", "step");
    // Every step states its status in words, not only in a tone.
    expect(within(rail).getAllByText(/Stage \d+ of 10,/).length).toBe(10);
  });

  it("puts the activation record, the next action and the evidence summary on stage 1", async () => {
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByText("Activation record")).toBeInTheDocument();
    // The one dominant call to action, derived from canonical state.
    expect(screen.getByRole("heading", { name: "Review the client submission" })).toBeInTheDocument();
    expect(screen.getByText("Compliance evidence")).toBeInTheDocument();
  });

  it("mounts NO gate act on the Passport stage — the cleared decision carries it", async () => {
    /* Stage 9 asked a reviewer to decide again what they had just decided
       on the Decision stage, with a second reason, behind a button that was
       disabled while it still read "Approve the gate — Approved". The
       cleared decision records the gate itself now, so this stage owes
       nothing about it — and neither the readiness ledger nor the full
       eight-status card may take its place. */
    setup(`/admin/aml/cases/${CASE_ID}?section=passport`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.queryByTestId("gate-approval-card")).not.toBeInTheDocument();
    expect(screen.queryByText("Approve the service gate")).not.toBeInTheDocument();
    expect(screen.queryByText("Service readiness")).not.toBeInTheDocument();
    expect(screen.queryByText("Change service gate")).not.toBeInTheDocument();
  });

  it("selecting a stage writes its section to the URL so refresh and sharing keep it", async () => {
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    const rail = screen.getByRole("list", { name: "Compliance journey stages" });
    fireEvent.click(within(rail).getByText("Screening"));
    expect(screen.getByTestId("location").dataset.search).toBe("?section=ownership");
    expect(screen.getByTestId("tab-screening")).toBeInTheDocument();
    expect(screen.getByTestId("tab-ownership")).toBeInTheDocument();
    // Stage 1 is the clean default — no parameter.
    fireEvent.click(within(rail).getByText("Activation"));
    expect(screen.getByTestId("location").dataset.search).toBe("");
  });

  it("accepts ?stage= as an alias and resolves it to that stage's section", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?stage=decision`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByTestId("tab-risk")).toBeInTheDocument();
    expect(screen.getByText("MLRO decision dossier")).toBeInTheDocument();
  });

  it("walks stages with Previous and Next without touching any case state", async () => {
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    const footer = screen.getByRole("navigation", { name: "Journey stage navigation" });
    expect(within(footer).getByText("Stage 1 of 10")).toBeInTheDocument();
    // Previous is unavailable on the first stage rather than wrapping.
    expect(within(footer).getByRole("button", { name: /Previous/ })).toBeDisabled();

    fireEvent.click(within(footer).getByRole("button", { name: /Intake/ }));
    expect(screen.getByTestId("location").dataset.search).toBe("?section=requests");
    // Navigation is a page turn: no transition, and no write of any kind.
    expect(transition).not.toHaveBeenCalled();

    // Identity is stage 3 — it precedes Documents, because the identity
    // result determines which documents are required.
    const onIntake = screen.getByRole("navigation", { name: "Journey stage navigation" });
    fireEvent.click(within(onIntake).getByRole("button", { name: /Identity/ }));
    expect(screen.getByTestId("location").dataset.search).toBe("?section=identity");
    // Nothing is verified on this fixture, so the stage is unfinished — and
    // the footer says so, so nobody reads "Next" as "sign off".
    expect(screen.getByText("Moving on does not complete this stage.")).toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();

    // ...and Documents follows it, at stage 4.
    const onIdentity = screen.getByRole("navigation", { name: "Journey stage navigation" });
    fireEvent.click(within(onIdentity).getByRole("button", { name: /Documents/ }));
    expect(screen.getByTestId("location").dataset.search).toBe("?section=documents");
    expect(transition).not.toHaveBeenCalled();

    const footerAfter = screen.getByRole("navigation", { name: "Journey stage navigation" });
    fireEvent.click(within(footerAfter).getByRole("button", { name: /Identity/ }));
    expect(screen.getByTestId("location").dataset.search).toBe("?section=identity");
    expect(transition).not.toHaveBeenCalled();
  });

  it("shows the live position rail with the gate and the readiness caveat", async () => {
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByText("Live position")).toBeInTheDocument();
    /*
     * Two rows, two questions, and neither is called simply "stage" any more.
     * "Case is at" sat beside "Case stage" and the pair read as a
     * contradiction — a 10-of-10 position next to a Closed lifecycle next to
     * an open Stage 5. Each now says which question it answers.
     */
    expect(screen.getByText("Journey position")).toBeInTheDocument();
    expect(screen.getByText("Case lifecycle")).toBeInTheDocument();
    expect(screen.getByText("Service gate")).toBeInTheDocument();
    expect(screen.getByText("Stage readiness")).toBeInTheDocument();
    // A readiness count is never a clearance, and the rail says so.
    expect(
      screen.getByText(/A complete stage is evidence, not a clearance/),
    ).toBeInTheDocument();
    // Stage 1 carries the full-width next action and "also outstanding", so
    // the rail does not repeat them a third of the width narrower.
    expect(screen.queryByText("Attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Next action")).not.toBeInTheDocument();
    expect(screen.getByText("Also outstanding")).toBeInTheDocument();
  });

  it("carries attention and the next action in the rail on every other stage", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?section=documents`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.getByText("Next action")).toBeInTheDocument();
    expect(screen.queryByText("Also outstanding")).not.toBeInTheDocument();
  });

  it("keeps every previously deep-linked section reachable at the same key", async () => {
    for (const [section, testId] of [
      ["risk", "tab-risk"],
      ["ownership", "tab-ownership"],
      ["finance", "tab-finance"],
    ] as const) {
      const view = setup(`/admin/aml/cases/${CASE_ID}?section=${section}`);
      await screen.findByRole("heading", { name: "Avery Client" });
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("opens directly on a deep-linked ?section=", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?section=timeline`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByTestId("tab-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("tab-audit")).toBeInTheDocument();
  });

  it("ignores unknown ?section= values and falls back to stage 1", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?section=nonsense`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByText("Activation record")).toBeInTheDocument();
  });

  it("keeps the compliance journey map and passport, on the Passport stage", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?section=passport`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByTestId("journey-map")).toBeInTheDocument();
    expect(screen.getByTestId("section-reliance")).toBeInTheDocument();
  });

  it("keeps the detailed fourteen-step rail, on the case record", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?section=timeline`);
    await screen.findByRole("heading", { name: "Avery Client" });
    const rail = screen.getByRole("list", { name: "Case process steps" });
    expect(within(rail).getByText("Identity verification")).toBeInTheDocument();
    expect(within(rail).getByText("Service gate")).toBeInTheDocument();
    expect(within(rail).getByText("Retention")).toBeInTheDocument();
  });

  it("omits whole stages whose sections a role may not open", async () => {
    mockRoles = new Set(["auditor"]);
    setup(`/admin/aml/cases/${CASE_ID}?section=documents`);
    await screen.findByRole("heading", { name: "Avery Client" });
    const rail = screen.getByRole("list", { name: "Compliance journey stages" });
    // Documents stays; Funding (finance + counterparty) and Partners
    // (monitoring) sit entirely behind canInvestigate and disappear.
    expect(within(rail).getByText("Documents")).toBeInTheDocument();
    expect(within(rail).queryByText("Funding")).not.toBeInTheDocument();
    expect(within(rail).queryByText("Partners")).not.toBeInTheDocument();
    expect(within(rail).getByText("Activation")).toBeInTheDocument();
    // "Stage 8 of 10" is still the case's position; the walk is over what
    // this role can open.
    expect(screen.getByText(/Stage \d+ of 8/)).toBeInTheDocument();
  });

  it("falls back to stage 1 when a deep link points at a section the role cannot open", async () => {
    mockRoles = new Set(["auditor"]);
    setup(`/admin/aml/cases/${CASE_ID}?section=finance`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.queryByTestId("tab-finance")).not.toBeInTheDocument();
    expect(screen.getByText("Activation record")).toBeInTheDocument();
  });

  it("redirects to the legacy ?open= deep link while the workspace flag is off", async () => {
    mockWorkspaceFlag = false;
    setup();
    await screen.findByTestId("register-page");
    expect(screen.getByTestId("location").dataset.search).toBe(`?open=${CASE_ID}`);
  });

  it("shows a retryable error state when the case cannot load", async () => {
    get.mockRejectedValue(new Error("No access to this case"));
    setup();
    expect(await screen.findByText("Case unavailable")).toBeInTheDocument();
    expect(screen.getByText("No access to this case")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to case register/ })).toBeInTheDocument();
  });

  it("closing is on the case header, confirmed, and refuses to proceed without a reason", async () => {
    /* It used to be a button in the rail's "Advance status" row, beside the
       ordinary advances, behind a reason marked OPTIONAL. `closed` is
       terminal and the record is retained from that point, so it is neither
       ordinary nor an advance. The rail card is gone from every stage; this
       is where the act lives now, and the confirmation and required reason
       are unchanged. */
    transition.mockResolvedValue({ case: baseCase });
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });

    // Not in the rail any more, on any stage.
    expect(screen.queryByText("Advance status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close case" }));
    expect(await screen.findByText("Close this case?")).toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();

    const confirm = screen.getAllByRole("button", { name: "Close case" })
      .find((b) => b.closest('[role="dialog"]'))!;

    /* The reason is refused, not the button. The prompt dialog deliberately
       keeps confirm enabled and moves focus to the problem — a dead control
       with no explanation is the worse of the two. What matters is that
       nothing is written. */
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(transition).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByLabelText(/Why is this case being closed\?/),
      { target: { value: "Duplicate case opened in error" } },
    );
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(transition).toHaveBeenCalledWith(CASE_ID, "closed", "Duplicate case opened in error"));
  });

});
