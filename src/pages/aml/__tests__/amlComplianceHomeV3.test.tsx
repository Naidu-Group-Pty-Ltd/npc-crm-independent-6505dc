import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AmlComplianceHomeV3 from "../AmlComplianceHomeV3";
import type { AmlCase } from "@/lib/aml/amlCasesApi";
import type { AmlRole } from "@/hooks/useAmlAccess";

let mockRoles = new Set<AmlRole>(["analyst", "mlro"]);

const list = vi.fn();
const monitoringSummary = vi.fn();
const listDiscrepancies = vi.fn();
const partnerDashboard = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: { list: (...a: unknown[]) => list(...a) },
}));
vi.mock("@/lib/aml/amlMonitoringApi", () => ({
  amlMonitoringApi: { summary: (...a: unknown[]) => monitoringSummary(...a) },
}));
vi.mock("@/lib/aml/amlFinanceApi", () => ({
  amlFinanceApi: { listDiscrepancies: (...a: unknown[]) => listDiscrepancies(...a) },
}));
vi.mock("@/lib/aml/amlRelianceApi", () => ({
  amlRelianceApi: { getPartnerOperationsDashboard: (...a: unknown[]) => partnerDashboard(...a) },
}));
vi.mock("@/hooks/useAmlAccess", () => ({
  useAmlAccess: () => ({
    loading: false, flagEnabled: true, roles: mockRoles,
    hasAnyRole: mockRoles.size > 0, canWrite: true,
    isMlro: mockRoles.has("mlro"), refresh: vi.fn(),
  }),
}));

const caseRow = (over: Partial<AmlCase>): AmlCase => ({
  id: "11111111-1111-4111-8111-111111111111",
  case_reference: "AML-2026-00001",
  client_id: null, purchase_file_id: null,
  subject_type: "individual",
  subject_display_name: "Avery Client",
  status: "kyc_in_progress",
  risk_rating: null, risk_score: null,
  assigned_analyst_id: null, assigned_mlro_id: null,
  opened_at: "2026-08-01T00:00:00Z", closed_at: null,
  metadata: {}, created_by: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z",
  ...over,
} as AmlCase);

function mockListByStatus(perStatus: Record<string, { cases: AmlCase[]; total: number }>) {
  list.mockImplementation((params: any = {}) => {
    const key = params.status ?? "recent";
    return Promise.resolve(perStatus[key] ?? { cases: [], total: 0 });
  });
}

function setup() {
  return render(
    <MemoryRouter>
      <AmlComplianceHomeV3 />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockRoles = new Set<AmlRole>(["analyst", "mlro"]);
  list.mockReset();
  monitoringSummary.mockReset();
  listDiscrepancies.mockReset();
  partnerDashboard.mockReset();
  partnerDashboard.mockRejectedValue(new Error("disabled"));
  monitoringSummary.mockResolvedValue({
    open_alerts: 4, critical_alerts: 1, unprocessed_events: 2,
    pending_reviews: 3, overdue_reviews: 1,
  });
  listDiscrepancies.mockResolvedValue({ discrepancies: [{ id: "d1" }] });
  mockListByStatus({
    recent: { cases: [caseRow({})], total: 12 },
    escalated_mlro: {
      cases: [caseRow({ id: "22222222-2222-4222-8222-222222222222", case_reference: "AML-2026-00002", subject_display_name: "Urgent Client", status: "escalated_mlro" })],
      total: 1,
    },
    kyc_complete: { cases: [], total: 0 },
    edd_required: { cases: [], total: 0 },
    kyc_in_progress: { cases: [], total: 7 },
  });
});

describe("Compliance Home V3 — operational dashboard", () => {
  it("keeps the required hierarchy: header, next best action, priority queue", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Attention, blocked work and programme health" })).toBeInTheDocument();
    // Next best action derives from the top of the priority queue.
    expect(await screen.findByText(/Awaiting decision — Urgent Client/)).toBeInTheDocument();
    expect(screen.getByText("Priority work queue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("renders real zeros as zeros, not dashes, once loaded", async () => {
    setup();
    await screen.findByText(/Awaiting decision — Urgent Client/);
    const tile = screen.getByText("Submissions to review").closest("a")!;
    expect(within(tile as HTMLElement).getByText("0")).toBeInTheDocument();
    expect(within(tile as HTMLElement).queryByText("—")).not.toBeInTheDocument();
  });

  it("keeps monitoring tiles in a loading state until their fetch settles — never a fabricated zero", async () => {
    let resolveSummary: (v: unknown) => void = () => {};
    monitoringSummary.mockImplementation(() => new Promise((r) => { resolveSummary = r; }));
    listDiscrepancies.mockImplementation(() => new Promise(() => {}));
    setup();
    await screen.findByText(/Awaiting decision — Urgent Client/);
    const alerts = screen.getByText("Open alerts").closest("a")!;
    expect(within(alerts as HTMLElement).queryByText("0")).not.toBeInTheDocument();
    expect(within(alerts as HTMLElement).getByText("Loading Open alerts")).toBeInTheDocument();
    resolveSummary(null);
  });

  it("shows an explicit unavailable state when monitoring data cannot load", async () => {
    monitoringSummary.mockRejectedValue(new Error("boom"));
    listDiscrepancies.mockRejectedValue(new Error("boom"));
    setup();
    await screen.findByText(/Awaiting decision — Urgent Client/);
    await waitFor(() => {
      expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    });
    // Never a fake zero for a failed source.
    const alerts = screen.getByText("Open alerts").closest("a")!;
    expect(within(alerts as HTMLElement).queryByText("0")).not.toBeInTheDocument();
  });

  it("deep-links each customer metric to the matching register view", async () => {
    setup();
    await screen.findByText(/Awaiting decision — Urgent Client/);
    expect(screen.getByText("Submissions to review").closest("a")).toHaveAttribute(
      "href", "/admin/aml/cases?view=awaiting_review");
    expect(screen.getByText("Enhanced CDD").closest("a")).toHaveAttribute(
      "href", "/admin/aml/cases?view=additional_info");
    expect(screen.getByText("Awaiting decision").closest("a")).toHaveAttribute(
      "href", "/admin/aml/cases?view=awaiting_decision");
    expect(screen.getByText("Onboarding in progress").closest("a")).toHaveAttribute(
      "href", "/admin/aml/cases?view=onboarding");
  });

  it("queue rows link to the case's ?open= deep link", async () => {
    setup();
    const row = (await screen.findByText("Urgent Client")).closest("li")!;
    const action = within(row).getByRole("link", { name: "Decide" });
    expect(action).toHaveAttribute(
      "href",
      "/admin/aml/cases?open=22222222-2222-4222-8222-222222222222",
    );
  });

  it("omits restricted monitoring metrics entirely for view-only users", async () => {
    mockRoles = new Set<AmlRole>(["auditor"]);
    setup();
    await screen.findByRole("heading", { name: "Attention, blocked work and programme health" });
    expect(screen.queryByText("Open alerts")).not.toBeInTheDocument();
    expect(screen.queryByText("Monitoring & finance operations")).not.toBeInTheDocument();
    expect(monitoringSummary).not.toHaveBeenCalled();
  });

  it("shows the actionable no-access state for users with no AML roles", async () => {
    mockRoles = new Set<AmlRole>();
    setup();
    expect(await screen.findByText("You don't have access yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "User Management" })).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it("surfaces case-load failures with a retry, not silence", async () => {
    list.mockRejectedValue(new Error("Network down"));
    setup();
    expect(await screen.findByText("Unable to load cases")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });
});
