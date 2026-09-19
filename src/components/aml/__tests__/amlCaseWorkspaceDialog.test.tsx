import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmlCaseWorkspaceDialog } from "../AmlCaseWorkspaceDialog";
import type { AmlCase, AmlCaseEvent } from "@/lib/aml/amlCasesApi";

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });

const get = vi.fn();
const transition = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    get: (...a: unknown[]) => get(...a),
    transition: (...a: unknown[]) => transition(...a),
  },
}));
// Inactive tabs never mount, but their modules (and the flag/access hooks)
// pull the supabase client at import time — stub them out.
vi.mock("@/lib/aml/amlVerificationApi", () => ({ amlVerificationApi: {} }));
vi.mock("@/lib/aml/amlRiskApi", () => ({ amlRiskApi: {} }));
vi.mock("@/lib/aml/amlFinanceApi", () => ({ amlFinanceApi: {} }));
vi.mock("@/lib/aml/amlEntitiesApi", () => ({ amlEntitiesApi: {} }));
vi.mock("@/lib/aml/useAmlV3Flags", () => ({
  useAmlV3Flags: () => ({
    v3Nav: false, startClientCompliance: false, complianceHome: false, caseWorkspace: false,
    regulatoryHub: false, terminologyEditor: false, metricsRelocation: false, orgSettings: false,
    loading: false,
  }),
}));
vi.mock("@/hooks/useAmlAccess", () => ({
  useAmlAccess: () => ({
    loading: false, flagEnabled: true, roles: new Set(["analyst"]),
    hasAnyRole: true, canWrite: true, isMlro: false, refresh: vi.fn(),
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
  subject_display_name: "rugesh naidu",
  status: "kyc_in_progress",
  risk_rating: null,
  risk_score: null,
  assigned_analyst_id: null,
  assigned_mlro_id: null,
  opened_at: "2026-08-01T00:00:00Z",
  closed_at: null,
  metadata: {
    activation: {
      model: "A",
      event: "Signed engagement letter",
      activated_by_email: "analyst@example.test",
      activated_at: "2026-08-01T00:00:00Z",
    },
  },
  created_by: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-02T00:00:00Z",
};

const someEvents: AmlCaseEvent[] = [
  {
    id: "ev-1", case_id: CASE_ID, category: "case_created",
    summary: "Case AML-2026-00001 activated (Model A) for Rugesh Naidu",
    payload: {}, actor_id: null, actor_label: "analyst@example.test",
    prev_hash: null, row_hash: "abc123def456abc123def456", created_at: "2026-08-01T00:00:00Z",
  },
];

function setup(props: Partial<Parameters<typeof AmlCaseWorkspaceDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const view = render(
    <AmlCaseWorkspaceDialog
      caseId={CASE_ID}
      onClose={onClose}
      onChanged={onChanged}
      canWrite
      canInvestigate
      {...props}
    />,
  );
  return { ...view, onClose, onChanged };
}

beforeEach(() => {
  get.mockReset();
  transition.mockReset();
  toast.mockReset();
  get.mockResolvedValue({ case: baseCase, events: someEvents });
});

describe("AmlCaseWorkspaceDialog — centred workspace shell", () => {
  it("opens as a large centred viewport-bounded dialog, not a side sheet", async () => {
    setup();
    const shell = await screen.findByTestId("aml-case-workspace-dialog");
    const cls = shell.className;
    // Desktop: min(94vw, 1240px) wide, capped at 92vh, centred via translate.
    expect(cls).toContain("sm:w-[min(94vw,1240px)]");
    expect(cls).toContain("sm:max-h-[92vh]");
    expect(cls).toContain("sm:left-1/2");
    expect(cls).toContain("sm:top-1/2");
    // Mobile: full-screen; shell never scrolls as one block.
    expect(cls).toContain("h-[100dvh]");
    expect(cls).toContain("overflow-hidden");
    expect(cls).toContain("flex-col");
    expect(get).toHaveBeenCalledWith(CASE_ID);
  });

  it("shows a structured header with readable name and human-readable statuses", async () => {
    setup();
    // smartCapitalize for display — stored value stays lowercase.
    expect((await screen.findAllByText("Rugesh Naidu")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AML-2026-00001/).length).toBeGreaterThan(0);
    // Stage badge (kyc_in_progress → "Client in progress") + gate + unrated risk.
    expect(screen.getAllByText("Client in progress").length).toBeGreaterThan(0);
    expect(screen.getByText("Risk: Unrated")).toBeInTheDocument();
    expect(screen.getByText(/Service:/)).toBeInTheDocument();
    // Overview shows the readable status label, never the raw enum.
    expect(screen.getByText("Onboarding in progress")).toBeInTheDocument();
    expect(screen.queryByText("kyc_in_progress")).not.toBeInTheDocument();
  });

  it("keeps the header and tab bar outside the scrollable tab body", async () => {
    setup();
    const shell = await screen.findByTestId("aml-case-workspace-dialog");
    await screen.findAllByText("Rugesh Naidu");
    const tablist = screen.getByRole("tablist");
    // The header title is the first "Rugesh Naidu" in DOM order.
    const headerTitle = screen.getAllByText("Rugesh Naidu")[0];
    const scrollRegions = shell.querySelectorAll(".overflow-y-auto");
    expect(scrollRegions.length).toBeGreaterThan(0);
    for (const region of scrollRegions) {
      expect(region.contains(tablist)).toBe(false);
      expect(region.contains(headerTitle)).toBe(false);
    }
  });

  it("keeps all workspace tabs available", async () => {
    setup();
    await screen.findAllByText("Rugesh Naidu");
    for (const name of ["Overview", "Verification", "Screening", "Risk & Decision", "Audit"]) {
      expect(screen.getByRole("tab", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it("respects initialTab deep links", async () => {
    setup({ initialTab: "audit" });
    await screen.findAllByText("Rugesh Naidu");
    expect(screen.getByRole("tab", { name: /Audit/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Audit trail (hash-chained)")).toBeInTheDocument();
  });

  it("renders the Overview dashboard with activation record and recent activity", async () => {
    setup();
    await screen.findAllByText("Rugesh Naidu");
    expect(screen.getByText("Case summary")).toBeInTheDocument();
    expect(screen.getByText("Progress & readiness")).toBeInTheDocument();
    expect(screen.getByText("Model A")).toBeInTheDocument();
    expect(screen.getByText("Signed engagement letter")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText(/activated \(Model A\)/)).toBeInTheDocument();
    // Jump-link opens the full Audit tab without refetching events.
    fireEvent.click(screen.getByRole("button", { name: "View full audit trail" }));
    expect(screen.getByRole("tab", { name: /Audit/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("AmlCaseWorkspaceDialog — case actions", () => {
  it("runs ordinary transitions through the existing API with the optional reason", async () => {
    transition.mockResolvedValue({ case: baseCase });
    const { onChanged } = setup();
    await screen.findByText("Case actions");

    fireEvent.change(screen.getByLabelText("Transition reason"), {
      target: { value: "Docs received" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submission received" }));

    await waitFor(() =>
      expect(transition).toHaveBeenCalledWith(CASE_ID, "kyc_complete", "Docs received"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    // Case reloaded in place after the transition.
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("separates destructive transitions behind a confirmation requiring a reason", async () => {
    transition.mockResolvedValue({ case: baseCase });
    setup();
    await screen.findByText("Case actions");

    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    // Confirmation shown; nothing transitioned yet.
    expect(await screen.findByText("Close this case?")).toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();

    const confirm = screen.getByRole("button", { name: "Close case" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason (required)"), {
      target: { value: "Duplicate case opened in error" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(transition).toHaveBeenCalledWith(CASE_ID, "closed", "Duplicate case opened in error"));
  });

  it("hides case actions for read-only users", async () => {
    setup({ canWrite: false });
    await screen.findAllByText("Rugesh Naidu");
    expect(screen.queryByText("Case actions")).not.toBeInTheDocument();
  });
});

describe("AmlCaseWorkspaceDialog — loading and failure states", () => {
  it("shows an accessible centred loading state", async () => {
    get.mockImplementation(() => new Promise(() => {}));
    setup();
    expect(await screen.findByRole("status")).toHaveTextContent("Loading case…");
  });

  it("shows a retryable error state when the case fails to load", async () => {
    get.mockRejectedValueOnce(new Error("Network unavailable"));
    get.mockResolvedValueOnce({ case: baseCase, events: [] });
    setup();

    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect((await screen.findAllByText("Rugesh Naidu")).length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
