import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AmlCasesPage from "../AmlCases";
import type { AmlCase } from "@/lib/aml/amlCasesApi";

const list = vi.fn();
const create = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    list: (...a: unknown[]) => list(...a),
    create: (...a: unknown[]) => create(...a),
  },
}));
// The workspace dialog and activation dialog pull heavy trees + supabase at
// import time — replace with test doubles that expose their wiring.
vi.mock("@/components/aml/AmlCaseWorkspaceDialog", () => ({
  AmlCaseWorkspaceDialog: ({ caseId, initialTab }: { caseId: string | null; initialTab?: string }) => (
    <div data-testid="workspace-dialog" data-case-id={caseId ?? ""} data-initial-tab={initialTab ?? ""} />
  ),
}));
vi.mock("@/components/aml/ActivateClientDialog", () => ({
  ActivateClientDialog: ({ open, clientId }: { open: boolean; clientId?: string }) => (
    <div data-testid="activate-dialog" data-open={String(open)} data-client-id={clientId ?? ""} />
  ),
}));

let mockCaseWorkspaceFlag = false;
let mockFlagsUnavailable = false;
vi.mock("@/lib/aml/useAmlV3Flags", () => ({
  useAmlV3Flags: () => ({
    v3Nav: false, startClientCompliance: false, complianceHome: false,
    caseWorkspace: mockCaseWorkspaceFlag,
    regulatoryHub: false, terminologyEditor: false, metricsRelocation: false,
    orgSettings: false, loading: false, unavailable: mockFlagsUnavailable,
  }),
}));

let mockAccess = {
  loading: false, flagEnabled: true, roles: new Set(["analyst", "mlro"]),
  hasAnyRole: true, canWrite: true, isMlro: true, refresh: vi.fn(),
};
vi.mock("@/hooks/useAmlAccess", () => ({ useAmlAccess: () => mockAccess }));
let mockSuperadmin = false;
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isSuperadmin: mockSuperadmin }) }));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const baseCase = (over: Partial<AmlCase> = {}): AmlCase => ({
  id: CASE_ID,
  case_reference: "AML-2026-00001",
  client_id: null, purchase_file_id: null,
  subject_type: "individual",
  subject_display_name: "Avery Client",
  status: "kyc_complete",
  risk_rating: "high", risk_score: null,
  assigned_analyst_id: null, assigned_mlro_id: null,
  opened_at: "2026-08-01T00:00:00Z", closed_at: null,
  metadata: {}, created_by: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z",
  ...over,
} as AmlCase);

function setup(url = "/admin/aml/cases") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AmlCasesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  toast.mockReset();
  mockCaseWorkspaceFlag = false;
  mockSuperadmin = false;
  mockAccess = {
    loading: false, flagEnabled: true, roles: new Set(["analyst", "mlro"]),
    hasAnyRole: true, canWrite: true, isMlro: true, refresh: vi.fn(),
  };
  list.mockResolvedValue({ cases: [baseCase()], total: 1 });
});

describe("AmlCases — register shell", () => {
  it("renders header, queues, toolbar and the loaded register", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Case register" })).toBeInTheDocument();
    /* Four QUEUES — questions about the work — replaced eleven chips, seven
       of which duplicated the Status and Risk dropdowns beside them. */
    const queues = screen.getByRole("navigation", { name: "Case queues" });
    for (const q of ["All open", "Mine", "Needs attention", "Ready for decision"]) {
      expect(within(queues).getByRole("button", { name: new RegExp(q) })).toBeInTheDocument();
    }
    for (const gone of ["High risk", "Cleared", "Closed", "Awaiting client"]) {
      expect(within(queues).queryByRole("button", { name: new RegExp(`^${gone}`) }))
        .not.toBeInTheDocument();
    }
    expect(screen.getByRole("search", { name: "Search and filter the case register" }))
      .toBeInTheDocument();
    expect(await screen.findByText("1 case")).toBeInTheDocument();
    // The work-queue columns: where in the process, how risky, may the
    // service proceed, and what is waiting. Status is text, never a raw
    // enum and never colour alone.
    expect(screen.getAllByText("Verify").length).toBeGreaterThan(0); // macro phase
    expect(screen.getAllByText("HIGH").length).toBeGreaterThan(0); // risk
    expect(screen.getAllByText("Under review").length).toBeGreaterThan(0); // service readiness
    expect(screen.getAllByText("Submission to review").length).toBeGreaterThan(0); // attention
    expect(screen.queryByText("kyc_complete")).not.toBeInTheDocument();
    expect(screen.queryByText("client_submitted")).not.toBeInTheDocument();
  });

  it("applies a saved view from the ?view= deep link with ONE filtered fetch", async () => {
    setup("/admin/aml/cases?view=awaiting_decision");
    await waitFor(() =>
      expect(list.mock.calls.some((c) => (c[0] as any)?.status === "escalated_mlro")).toBe(true));

    /* The rule this has always protected: the register's own rows come from
       exactly ONE filtered request. The view seeds the filter state before
       the first fetch, so a deep-linked mount never issues an unfiltered
       request that could race the filtered one and overwrite the rows.

       There is a second call now — an unfiltered snapshot read only to count
       the queues — and it must carry no filters at all and never touch the
       rows on screen. Counting the filtered rows would report the
       intersection of a queue with whatever is selected and call it the
       queue. */
    const filtered = list.mock.calls.filter((c) => {
      const p = (c[0] ?? {}) as Record<string, unknown>;
      return p.status !== undefined || p.risk !== undefined || p.assigned_to_me !== undefined;
    });
    expect(filtered).toHaveLength(1);
    expect((filtered[0][0] as any).status).toBe("escalated_mlro");

    const queues = screen.getByRole("navigation", { name: "Case queues" });
    expect(within(queues).getByRole("button", { name: /Ready for decision/ }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("counts a queue from an unfiltered snapshot, and shows the number", async () => {
    setup();
    const queues = await screen.findByRole("navigation", { name: "Case queues" });
    // "All open" is the server's own total, exact whether or not the page
    // was truncated.
    await waitFor(() =>
      expect(within(queues).getByRole("button", { name: /All open/ })).toHaveTextContent("1"));
  });

  it("shows the active-filter summary and clears everything with one action", async () => {
    setup("/admin/aml/cases?view=high_risk");
    // The snapshot read is unfiltered, so the filtered call is not
    // necessarily the last one.
    await waitFor(() =>
      expect(list.mock.calls.some((c) => (c[0] as any)?.risk === "high")).toBe(true));
    /* `high_risk` was a chip sitting beside the Risk dropdown that did the
       same thing. Its `?view=` key still resolves — it simply arrives as the
       Risk filter it always was underneath, and as a pill you can take off
       on its own rather than an inert grey label. */
    expect(await screen.findByRole("button", { name: /Risk: High/ })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await waitFor(() => {
      const params = list.mock.calls.at(-1)![0] as any;
      expect(params.risk).toBeUndefined();
      expect(params.status).toBeUndefined();
      expect(params.assigned_to_me).toBeUndefined();
    });
    expect(screen.getByRole("button", { name: /All open/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the legacy dialog from the ?open=&tab= deep link and clears the params", async () => {
    setup(`/admin/aml/cases?open=${CASE_ID}&tab=audit`);
    const dialog = await screen.findByTestId("workspace-dialog");
    expect(dialog).toHaveAttribute("data-case-id", CASE_ID);
    expect(dialog).toHaveAttribute("data-initial-tab", "audit");
  });

  it("hands ?activateClientId= to the activation dialog", async () => {
    setup("/admin/aml/cases?activateClientId=99999999-9999-4999-8999-999999999999");
    const dialog = await screen.findByTestId("activate-dialog");
    expect(dialog).toHaveAttribute("data-open", "true");
    expect(dialog).toHaveAttribute("data-client-id", "99999999-9999-4999-8999-999999999999");
  });

  it("activates a row with the keyboard and opens the dialog while the workspace flag is off", async () => {
    setup();
    const row = await screen.findByRole("link", {
      name: /Open case AML-2026-00001 for Avery Client/,
    });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByTestId("workspace-dialog")).toHaveAttribute("data-case-id", CASE_ID);
  });

  it("renders mobile cards with attention, phase, risk and readiness in text", async () => {
    setup();
    await screen.findByText("1 case");
    // The mobile card is a real button whose accessible name carries the
    // reason it needs attention, so nothing is conveyed by colour alone.
    const card = screen.getByRole("button", {
      name: /Open case AML-2026-00001 for Avery Client/,
    });
    expect(card).toHaveAccessibleName(/waiting for review/i);
    expect(within(card).getByText("Submission to review")).toBeInTheDocument();
    expect(within(card).getByText("Verify")).toBeInTheDocument();
    expect(within(card).getByText("Risk: HIGH")).toBeInTheDocument();
    expect(within(card).getByText("Service: Under review")).toBeInTheDocument();
  });

  it("shows an inline retryable error when the register fails to load", async () => {
    list.mockRejectedValueOnce(new Error("Gateway timeout"));
    list.mockResolvedValueOnce({ cases: [baseCase()], total: 1 });
    setup();
    expect(await screen.findByText("The case register could not be loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("1 case")).toBeInTheDocument();
  });

  it("shows a skeleton, not a false empty state, while refetching from an empty result", async () => {
    // First load: genuinely empty register.
    list.mockResolvedValueOnce({ cases: [], total: 0 });
    setup();
    expect(await screen.findByText("No cases yet")).toBeInTheDocument();
    // Switching to a view whose fetch is still in flight must not claim
    // "no matches" for data that hasn't arrived.
    let resolveNext: (v: unknown) => void = () => {};
    list.mockImplementationOnce(() => new Promise((r) => { resolveNext = r; }));
    fireEvent.click(screen.getByRole("button", { name: /Ready for decision/ }));
    expect(await screen.findByText("Loading the case register")).toBeInTheDocument();
    expect(screen.queryByText("No cases match the current filters")).not.toBeInTheDocument();
    resolveNext({ cases: [baseCase()], total: 1 });
    expect(await screen.findByText("1 case")).toBeInTheDocument();
  });

  it("offers a next action in the filtered empty state", async () => {
    list.mockResolvedValue({ cases: [], total: 0 });
    setup("/admin/aml/cases?view=cleared");
    expect(await screen.findByText("No cases match the current filters")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });

  it("keeps access gates intact: module off and no-role states", async () => {
    mockAccess = { ...mockAccess, flagEnabled: false };
    setup();
    expect(await screen.findByText("AML/CTF is not enabled")).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it("hides restricted actions: no Exception case button for non-MLRO users", async () => {
    mockAccess = { ...mockAccess, isMlro: false, roles: new Set(["analyst"]) };
    setup();
    await screen.findByText("1 case");
    expect(screen.queryByRole("button", { name: /Exception case/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activate client/ })).toBeInTheDocument();
  });
});

/**
 * The staged-rollout gate must never be silent again.
 *
 * `aml_v3_case_workspace` defaults to off, and with it off a case opens in
 * the legacy dialog while `/admin/aml/cases/:caseId` redirects here — so a
 * finished journey workspace and an absent one are indistinguishable. That
 * is exactly how the workspace stayed switched off in production from Phase
 * 6 until somebody asked why a merged, deployed feature had changed nothing.
 *
 * And the notice alone was not enough, which is the second half of this
 * suite. Underneath the switched-off flag sat a flag reader that could not
 * read: an anon browser client against a table that grants SELECT `TO
 * authenticated` returns `[]` with HTTP 200, so every flag coerced to false.
 * The notice would then have reported a switched-off feature — and sent a
 * superadmin to a toggle that was already on. "Off" and "unknown" carry the
 * same eight false values and must not carry the same words.
 */
describe("AmlCases — the rollout gate is visible to whoever can move it", () => {
  it("tells a superadmin when cases are still opening in the legacy dialog", async () => {
    mockSuperadmin = true;
    mockCaseWorkspaceFlag = false;
    mockFlagsUnavailable = false;
    list.mockResolvedValue({ cases: [], total: 0 });
    render(
      <MemoryRouter initialEntries={["/admin/aml/cases"]}>
        <AmlCasesPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Cases are opening in the legacy dialog")).toBeInTheDocument();
    expect(screen.getByText("aml_v3_case_workspace")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /V3 cutover controls/ }))
      .toHaveAttribute("href", "/admin/aml-v3-cutover");
  });

  it("says nothing once the workspace is switched on", async () => {
    mockSuperadmin = true;
    mockCaseWorkspaceFlag = true;
    mockFlagsUnavailable = false;
    list.mockResolvedValue({ cases: [], total: 0 });
    render(
      <MemoryRouter initialEntries={["/admin/aml/cases"]}>
        <AmlCasesPage />
      </MemoryRouter>,
    );
    await screen.findByText("Case register");
    expect(screen.queryByText("Cases are opening in the legacy dialog")).not.toBeInTheDocument();
  });

  it("never shows rollout plumbing to an ordinary operator", async () => {
    mockSuperadmin = false;
    mockCaseWorkspaceFlag = false;
    mockFlagsUnavailable = false;
    list.mockResolvedValue({ cases: [], total: 0 });
    render(
      <MemoryRouter initialEntries={["/admin/aml/cases"]}>
        <AmlCasesPage />
      </MemoryRouter>,
    );
    await screen.findByText("Case register");
    expect(screen.queryByText("Cases are opening in the legacy dialog")).not.toBeInTheDocument();
  });

  it("says the flags could not be READ rather than that they are off", async () => {
    // The distinction the previous reader could not make. Reporting this as
    // "switched off" points a superadmin at a toggle that will not help —
    // the flag may already be on and simply unreadable.
    mockSuperadmin = true;
    mockCaseWorkspaceFlag = false;
    mockFlagsUnavailable = true;
    list.mockResolvedValue({ cases: [], total: 0 });
    render(
      <MemoryRouter initialEntries={["/admin/aml/cases"]}>
        <AmlCasesPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("The rollout flags could not be read")).toBeInTheDocument();
    expect(screen.queryByText("Cases are opening in the legacy dialog")).not.toBeInTheDocument();
    // It still names where the answer comes from, so the next step is obvious.
    expect(screen.getByText("aml-access")).toBeInTheDocument();
  });

  it("stays quiet about unreadable flags when the workspace is already on", async () => {
    // A cached-but-stale reading can be `on` while a revalidation fails.
    // There is nothing to tell anyone: the surface they want is rendering.
    mockSuperadmin = true;
    mockCaseWorkspaceFlag = true;
    mockFlagsUnavailable = true;
    list.mockResolvedValue({ cases: [], total: 0 });
    render(
      <MemoryRouter initialEntries={["/admin/aml/cases"]}>
        <AmlCasesPage />
      </MemoryRouter>,
    );
    await screen.findByText("Case register");
    expect(screen.queryByText("The rollout flags could not be read")).not.toBeInTheDocument();
  });
});
