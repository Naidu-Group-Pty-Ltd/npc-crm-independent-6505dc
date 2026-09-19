/**
 * Writing an AUSTRAC report, on a page of its own.
 *
 * The draft used to be a modal. Everything it asks is unchanged and
 * everything the server refuses it still refuses; what the page adds is a
 * URL that can be linked, returned to and reached with the back button, and
 * room for a narrative AUSTRAC will actually read.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const getReport = vi.fn();
const upsertReport = vi.fn();
const mlroSignoff = vi.fn();
const listCases = vi.fn();

vi.mock("@/lib/aml/amlReportingApi", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  amlReportingApi: {
    getReport: (id: string) => getReport(id),
    upsertReport: (d: unknown) => upsertReport(d),
    mlroSignoff: (id: string) => mlroSignoff(id),
    summary: vi.fn(), listReports: vi.fn(), deleteReport: vi.fn(),
    mlroReject: vi.fn(), withdrawReport: vi.fn(),
    submitRecord: vi.fn(), recordReceipt: vi.fn(), exportBundle: vi.fn(),
    createVersion: vi.fn(),
  },
}));
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: { list: (a: unknown) => listCases(a) },
}));
vi.mock("@/hooks/useAmlAccess", () => ({
  useAmlAccess: () => ({
    roles: new Set(["mlro"]), hasAnyRole: true, canWrite: true, isMlro: true, loading: false,
  }),
}));

import AmlAustracReportDraft from "../AmlAustracReportDraft";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const REPORT = {
  id: "r1", kind: "smr", case_id: "case-1", title: "SMR — unusual cash deposits",
  status: "draft", narrative: "", reference_code: null,
  reporting_period_start: null, reporting_period_end: null,
  mlro_signed_at: null, submitted_at: null, acknowledged_at: null,
  metadata: {}, created_at: "2026-08-27T00:00:00.000Z", updated_at: "2026-08-27T00:00:00.000Z",
};

beforeEach(() => {
  getReport.mockResolvedValue({ report: REPORT, versions: [], submissions: [] });
  upsertReport.mockResolvedValue({ ...REPORT, id: "r9" });
  mlroSignoff.mockResolvedValue({ ...REPORT, status: "approved" });
  listCases.mockResolvedValue({
    cases: [{ id: "case-1", subject_display_name: "Rugesh Naidu", case_reference: "AML-2026-00005" }],
    total: 1,
  });
});

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}

const renderNew = () =>
  render(
    <MemoryRouter initialEntries={["/admin/aml/austrac/new"]}>
      <Routes>
        <Route path="/admin/aml/austrac/new" element={<AmlAustracReportDraft />} />
        <Route path="/admin/aml/austrac" element={<div>the hub</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

const renderKind = (kind: string): HTMLElement => {
  getReport.mockResolvedValue({ report: { ...REPORT, kind }, versions: [], submissions: [] });
  render(
    <MemoryRouter initialEntries={["/admin/aml/austrac/r1/edit"]}>
      <Routes>
        <Route path="/admin/aml/austrac/:reportId/edit" element={<AmlAustracReportDraft />} />
      </Routes>
    </MemoryRouter>,
  );
  return document.body;
};

describe("the page", () => {
  it("says the platform never lodges, before anything is typed", async () => {
    /* AUSTRAC Online is the entity's own account. An operator who thinks
       saving lodges the report will wait out a statutory deadline. */
    renderNew();
    expect(await screen.findByText(/Nothing here is sent to AUSTRAC/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Start an AUSTRAC report/i })).toBeInTheDocument();
  });

  it("is not a dialog", async () => {
    renderNew();
    await screen.findByText(/Nothing here is sent to AUSTRAC/i);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("loads an existing report at its own address", async () => {
    renderKind("smr");
    await waitFor(() => expect(getReport).toHaveBeenCalledWith("r1"));
    expect(await screen.findByDisplayValue("SMR — unusual cash deposits")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Edit AUSTRAC report/i })).toBeInTheDocument();
  });

  it("returns to the hub with the report it just saved selected", async () => {
    /* The dialog closed onto the report it had written. A page has to hand
       that back deliberately, or saving loses the operator's place. */
    renderNew();
    fireEvent.change(await screen.findByLabelText(/^Title$/i), { target: { value: "A matter" } });
    fireEvent.click(screen.getByRole("button", { name: /Save and continue/i }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/admin/aml/austrac?report=r9"));
  });

  it("will not save without the two fields the server has always required", async () => {
    renderNew();
    await screen.findByLabelText(/^Title$/i);
    expect(screen.getByRole("button", { name: /Save and continue/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Title$/i), { target: { value: "A matter" } });
    expect(screen.getByRole("button", { name: /Save and continue/i })).toBeEnabled();
  });
});

describe("choosing the customer", () => {
  const manyCases = Array.from({ length: 60 }, (_, i) => ({
    id: `c${i}`,
    subject_display_name: `Customer ${i}`,
    case_reference: `AML-2026-${String(i).padStart(5, "0")}`,
  }));

  it("is typed rather than scrolled", async () => {
    /* A plain drop-down of every open case is not a picker on a tenant with
       two hundred customers; it is a haystack. */
    listCases.mockResolvedValue({ cases: manyCases, total: manyCases.length });
    renderNew();
    const trigger = await screen.findByLabelText("Customer");
    expect(trigger).toHaveAttribute("role", "combobox");
    fireEvent.click(trigger);
    const input = await screen.findByPlaceholderText(/Type a name or a Passport reference/i);
    expect(input).toBeInTheDocument();
  });

  it("finds a customer by their Passport reference, hyphens or not", async () => {
    /* A reference is read off one screen and re-typed on another. */
    listCases.mockResolvedValue({ cases: manyCases, total: manyCases.length });
    renderNew();
    fireEvent.click(await screen.findByLabelText("Customer"));
    fireEvent.change(await screen.findByPlaceholderText(/Type a name or a Passport reference/i), {
      target: { value: "aml202600042" },
    });
    expect(await screen.findByText("AML-2026-00042")).toBeInTheDocument();
    expect(screen.queryByText("AML-2026-00041")).not.toBeInTheDocument();
  });

  it("selects the customer, and shows who was chosen", async () => {
    renderNew();
    fireEvent.click(await screen.findByLabelText("Customer"));
    fireEvent.change(await screen.findByPlaceholderText(/Type a name or a Passport reference/i), {
      target: { value: "rugesh" },
    });
    fireEvent.click(await screen.findByText("Rugesh Naidu"));
    await waitFor(() =>
      expect(screen.getByLabelText("Customer")).toHaveTextContent("Rugesh Naidu — AML-2026-00005"));
  });

  it("says so when nothing matches, rather than showing an empty box", async () => {
    renderNew();
    fireEvent.click(await screen.findByLabelText("Customer"));
    fireEvent.change(await screen.findByPlaceholderText(/Type a name or a Passport reference/i), {
      target: { value: "zzzzz" },
    });
    expect(await screen.findByText(/No customer matches that/i)).toBeInTheDocument();
  });
});

describe("the narrative", () => {
  it("carries no character count", async () => {
    /* AUSTRAC sets no threshold, and the one this had rendered as
       `298 / 200 characters` — the shape of an overrun, on the one field
       where running out of room would be a serious problem. */
    renderNew();
    await screen.findByLabelText(/Narrative/i);
    expect(screen.queryByText(/\d+\s*\/\s*\d+\s*characters/)).not.toBeInTheDocument();
  });

  it("is complete once something has been written, however brief", async () => {
    renderNew();
    expect(await screen.findByText(/3 things outstanding/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Title$/i), { target: { value: "A matter" } });
    fireEvent.change(screen.getByLabelText(/Narrative/i), {
      target: { value: "Cash paid at settlement with no explanation." },
    });
    /* Forty-three characters. Under the old floor this was still owed. */
    await waitFor(() =>
      expect(screen.getByText(/2 things outstanding/i)).toBeInTheDocument());
  });

  it("labels the box without sitting on top of it", async () => {
    /* The label shared a `flex items-end` row with the counter: the counter
       made the row taller, `items-end` dropped the label to its foot, and
       `leading-none` left the descenders on the textarea's own border. */
    renderNew();
    const label = await screen.findByText("Narrative");
    expect(label.closest(".flex")).toBeNull();
    expect(label.parentElement?.className).toContain("space-y-1.5");
  });
});

describe("why the report is being made", () => {
  it("explains the obligation and when AUSTRAC must be informed", async () => {
    renderNew();
    expect(await screen.findByText(/AUSTRAC must be informed when/i)).toBeInTheDocument();
    expect(screen.getByText(/attempted — a customer who walked away/i)).toBeInTheDocument();
  });

  it("warns about tipping off on a suspicious matter and not on a threshold transaction", async () => {
    /* s.123 attaches to the SMR alone. Showing the warning everywhere is
       how an operator learns to read past it. And it sits in the main
       column: below `xl` the reference panel follows the whole form, and a
       prohibition on what may be said cannot be below the fold. */
    const smr = renderKind("smr");
    const warning = await within(smr).findByText(/offence under s.123/i);
    const panel = within(smr)
      .getByRole("complementary", { name: /Why this report is being made/i });
    expect(panel.contains(warning)).toBe(false);
  });

  it("carries no tipping-off warning on a threshold transaction", async () => {
    const ttr = renderKind("ttr");
    await within(ttr).findByText(/You receive physical currency of A\$10,000 or more/i);
    expect(within(ttr).queryByText(/offence under s.123/i)).not.toBeInTheDocument();
  });

  it("numbers what is being asked and says what is still outstanding", async () => {
    renderNew();
    expect(await screen.findByRole("heading", { name: "Which report, and what obliges it" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Who it is about" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What happened" })).toBeInTheDocument();
    expect(screen.getByText(/things outstanding before this is ready for the MLRO/i)).toBeInTheDocument();
  });

  it("shows where drafting sits in the whole lodgement", async () => {
    renderNew();
    expect(await screen.findByText(/The whole path/i)).toBeInTheDocument();
    expect(screen.getAllByText(/on this screen/i).length).toBe(2);
    expect(screen.getByText("Review the checks and approve it")).toBeInTheDocument();
  });

  it("shows the deadline the answers produce, counted in business days", async () => {
    /* A suspicion formed on Thursday 27 August 2026 is due Tuesday 1
       September, not Sunday. */
    renderNew();
    fireEvent.change(await screen.findByLabelText(/Obligation arose/i), {
      target: { value: "2026-08-27T09:00" },
    });
    const due = await screen.findByText(/3 business days from the day the suspicion was formed/i);
    expect(due.textContent).toContain("01/09/2026");
    expect(due.textContent).toContain("s.41");
  });

  it("offers the questions a narrative must answer, and only into an empty one", async () => {
    renderNew();
    fireEvent.click(await screen.findByRole("button", { name: /Start from the questions to answer/i }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Start from the questions to answer/i }))
        .not.toBeInTheDocument());
    const narrative = screen.getByLabelText(/Narrative/i) as HTMLTextAreaElement;
    /* Questions only — never an answer. Whatever this writes could be lodged
       verbatim if nobody edited it. */
    for (const line of narrative.value.split("\n").filter((l) => l.trim())) {
      expect(line.trim().endsWith("?")).toBe(true);
    }
  });

  it("does not ask an annual compliance report to name a customer", async () => {
    /* And must not throw drawing one: `reports.kind` accepts five values and
       the obligation table is keyed by four. */
    const annual = renderKind("annual");
    expect(await within(annual)
      .findByText(/accounts for the reporting entity's own programme/i)).toBeInTheDocument();
    expect(within(annual).queryByLabelText("Customer")).not.toBeInTheDocument();
  });
});

describe("the whole process happens in the report", () => {
  const renderEdit = (report: Record<string, unknown> = REPORT) => {
    getReport.mockResolvedValue({ report, versions: [], submissions: [] });
    return render(
      <MemoryRouter initialEntries={["/admin/aml/austrac/r1/edit"]}>
        <Routes>
          <Route path="/admin/aml/austrac/:reportId/edit" element={<AmlAustracReportDraft />} />
          <Route path="/admin/aml/austrac" element={<div>the hub</div>} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
  };

  it("carries the path, and the checks lead it", async () => {
    /* An MLRO reviewing a report had the checks on one screen and the
       document on another. The checks are what "review" means, so they are
       the first thing on the card. */
    renderEdit();
    expect(await screen.findByText("Before it is lodged")).toBeInTheDocument();
    expect(screen.getAllByText("Review the checks and approve it").length).toBeGreaterThan(0);
  });

  it("approves from inside the report and lands on the lodgement step", async () => {
    /* Once approved it takes the operator to the hub, where the next act —
       recording the AUSTRAC lodgement — lives. */
    renderEdit();
    /* This fixture has no narrative, so the guard asks first — which is the
       point of the guard. */
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mlroSignoff).toHaveBeenCalledWith("r1"));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/admin/aml/austrac?report=r1"));
  });

  it("saves what is on screen before it signs off on it", async () => {
    /* The MLRO approves what they are LOOKING AT. Signing off an unsaved
       narrative would attest to a version nobody read. */
    renderEdit();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.change(await screen.findByLabelText(/Narrative/i), {
      target: { value: "Cash paid at settlement with no explanation offered." },
    });
    /* Two of them, deliberately: the path's own step and the action bar.
       Both are the same act. */
    const buttons = await screen.findAllByRole("button", { name: /Save and approve/i });
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(upsertReport).toHaveBeenCalled());
    await waitFor(() => expect(mlroSignoff).toHaveBeenCalledWith("r1"));
    const savedFirst = upsertReport.mock.invocationCallOrder[0]
      < mlroSignoff.mock.invocationCallOrder[0];
    expect(savedFirst).toBe(true);
  });

  it("puts the AUSTRAC Online door on the lodgement step", async () => {
    /* It was a locked panel at the foot of the card, three blocks below the
       step it is about. */
    renderEdit();
    const link = await screen.findByRole("link", { name: /Open AUSTRAC Online/i });
    expect(link).toHaveAttribute("href", "https://online.austrac.gov.au/");
    const step = link.closest("li")!;
    expect(within(step).getByText("Lodge it at AUSTRAC Online")).toBeInTheDocument();
  });

  it("does not call itself Edit when nothing on it can be edited", async () => {
    /* A report past the draft statuses is READ. Naming the page "Edit" is
       the same defect the read-only form itself fixes. */
    renderEdit({ ...REPORT, status: "submitted" });
    expect(await screen.findByRole("heading", { name: "AUSTRAC report" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Edit AUSTRAC report/i })).not.toBeInTheDocument();
  });

  it("refuses to edit a report that has already been approved, and says why", async () => {
    /* `upsert_report` refuses anything past the draft statuses, so an
       editable form here would have a Save the server answers 403 to. */
    renderEdit({ ...REPORT, status: "approved", mlro_signed_at: "2026-08-30T00:00:00.000Z" });
    expect(await screen.findByText(/can no longer be edited here/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save draft/i })).not.toBeInTheDocument();
  });

  it("draws the path once, not twice", async () => {
    /* The reference rail carries a six-step orientation list for somebody
       STARTING a report. With the live card on the page they would be two
       renderings of the same path, free to disagree about which step is
       open. */
    renderEdit();
    await screen.findByText("Before it is lodged");
    expect(screen.queryByText(/The whole path/i)).not.toBeInTheDocument();
  });

  it("still orients somebody starting a fresh report", async () => {
    renderNew();
    expect(await screen.findByText(/The whole path/i)).toBeInTheDocument();
    expect(screen.queryByText("Before it is lodged")).not.toBeInTheDocument();
  });
});

describe("nothing behind the page moved", () => {
  it("the SERVER still owns every refusal", () => {
    /* Two gates is how one of them becomes wrong. The page discloses what
       the server will say; it enforces none of it. */
    const fn = read("supabase/functions/aml-reporting/index.ts");
    expect(fn).toContain('report.status !== "approved"');
    expect(fn).toContain("Submission evidence required");
    expect(fn).toContain("SMR submissions require the AUSTRAC lodgement reference");
    expect(fn).toContain("attest_no_tipping_off");
    expect(fn).toContain("requireStepUpSession");
  });

  it("the draft route is declared unconditionally, like every other AML route", () => {
    /* Hiding is never deleting, and a route behind a flag is a bookmark that
       stops working. Both spellings are mounted under `austrac`, which is
       what keeps them in the Regulatory & Assurance workspace. */
    const app = read("src/App.tsx");
    expect(app).toContain('path="austrac/new"');
    expect(app).toContain('path="austrac/:reportId/edit"');
  });
});
