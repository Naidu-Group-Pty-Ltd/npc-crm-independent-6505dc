/**
 * The AUSTRAC hub — a path to lodgement, and a report that lands on a
 * customer's file.
 *
 * The page rendered a dialog with five boxes and a table of statuses.
 * Nothing said what happens next, nothing said when the report was due, and
 * nothing asked which customer it was about — so `reports.case_id`, which
 * has existed since the first migration, was never set and every report was
 * filed against nobody.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterAll, afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const listReports = vi.fn();
const getReport = vi.fn();
const summary = vi.fn();
const listCases = vi.fn();
const exportBundle = vi.fn();
const upsertReport = vi.fn();
const mlroSignoff = vi.fn();
const archiveReport = vi.fn();
const restoreReport = vi.fn();

vi.mock("@/lib/aml/amlReportingApi", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  amlReportingApi: {
    summary: () => summary(),
    listReports: (a: unknown) => listReports(a),
    getReport: (id: string) => getReport(id),
    deleteReport: vi.fn(),
    mlroSignoff: (id: string) => mlroSignoff(id),
    archiveReport: (id: string) => archiveReport(id),
    restoreReport: (id: string) => restoreReport(id),
    mlroReject: vi.fn(), withdrawReport: vi.fn(), submitRecord: vi.fn(),
    recordReceipt: vi.fn(), createVersion: vi.fn(),
    exportBundle: (id: string) => exportBundle(id),
    upsertReport: (d: unknown) => upsertReport(d),
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
/* An unbranded workspace: every download must issue under the Aurixa
   Systems fallback, never an empty masthead. */
vi.mock("@/branding/BrandProvider", () => ({
  useBrand: () => ({
    settings: {
      companyName: "Dashboard", brandColor: null,
      authLogo: null, sidebarLogo: null, sidebarIcon: null,
      favicon: null, reportLogo: null, reportMonoLogo: null,
    },
  }),
}));
vi.mock("@/lib/aml/useAmlV3Flags", () => ({
  useAmlV3Flags: () => ({ regulatoryHub: false, loading: false }),
}));

import { Toaster, toast } from "sonner";

import AmlAustracReporting from "../AmlAustracReporting";
import { drainToastTimers } from "../../../test/toastTeardown";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * A suspicion formed TODAY, and that is deliberate.
 *
 * An SMR runs on a three-business-day clock from the obligation, and
 * `austracReadiness` reports "Within the statutory window" as `blocked` once
 * that clock expires — which turns the plain approval below into one that
 * asks `window.confirm` first. This fixture used to carry a literal
 * `2026-08-27`: a Thursday, so the report fell due at 2026-09-01T00:00Z, and
 * at 00:45Z that morning CI went red on a suite nobody had touched. Between
 * the last green run and the first red one the only change to the repository
 * was in Builder Stock. The calendar was the change.
 *
 * A fixture that is inside its statutory window has to SAY it is inside it,
 * not name a date that was. Today's date is always inside a window measured
 * forward from today, on any day the suite is ever run.
 */
const nowIso = () => new Date().toISOString();

/** Well past any window this product measures, on any day. */
const longOverdueIso = () => new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();

const REPORT = {
  id: "r1", kind: "smr", case_id: "case-1", title: "SMR — unusual cash deposits",
  status: "draft", narrative: "x".repeat(300), reference_code: null,
  reporting_period_start: null, reporting_period_end: null,
  mlro_signed_at: null, submitted_at: null, acknowledged_at: null,
  metadata: { obligation_at: nowIso() },
  created_at: nowIso(), updated_at: nowIso(),
};

/*
  This file is the only one in the suite that mounts a `<Toaster />`, which
  makes it the only one that can end with sonner's uncancellable unmount
  timer still in flight. When that timer fires after Vitest has disposed this
  file's jsdom, React reads a `window` that is no longer there and the whole
  run fails on an unhandled error while every test in it passed. Waiting past
  the animation window costs 400ms, once. See `src/test/toastTeardown.ts`.
*/
afterAll(drainToastTimers);

beforeEach(() => {
  // Call history must not leak between tests: one of these asserts that a
  // write was NOT made, which the previous test had already made. Spies on
  // `window.confirm` are restored for the same reason — a stale one that
  // answers "no" makes the next test's archive silently not happen — and
  // sonner's store is global, so its toasts are cleared too.
  vi.clearAllMocks();
  vi.restoreAllMocks();
  toast.dismiss();
  listReports.mockResolvedValue([REPORT]);
  getReport.mockResolvedValue({ report: REPORT, versions: [], submissions: [] });
  summary.mockResolvedValue({ draft: 1, awaiting_mlro: 0, approved: 0, submitted: 0, acknowledged: 0, rejected: 0, archived: 2 });
  exportBundle.mockResolvedValue({
    bundle: { report: REPORT, versions: [], submissions: [], exported_at: "2026-08-30T05:00:00.000Z", exported_by: "R Naidu" },
    content_hash: "f".repeat(64),
  });
  upsertReport.mockResolvedValue({ ...REPORT, status: "awaiting_mlro" });
  mlroSignoff.mockResolvedValue({ report: { ...REPORT, status: "approved" } });
  archiveReport.mockResolvedValue({ ...REPORT, archived_at: "2026-08-30T00:00:00.000Z" });
  restoreReport.mockResolvedValue({ ...REPORT, archived_at: null });
  listCases.mockResolvedValue({
    cases: [{ id: "case-1", subject_display_name: "Rugesh Naidu", case_reference: "AML-2026-00005" }],
    total: 1,
  });
});

/** Shows where the router ended up, so a navigation can be asserted. */
function Where() {
  return <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;
}

/* The Toaster is mounted so the undo affordance is asserted as an operator
   meets it — a real button in a real toast — rather than as an option object
   passed to a spy. */
const renderPage = (entry = "/admin/aml/austrac") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AmlAustracReporting />
      <Where />
      <Toaster />
    </MemoryRouter>,
  );

/**
 * Select a report by clicking its ROW.
 *
 * The title is no longer the way to select: it opens the report's own page,
 * which is what a title should do and what an operator could not do at all
 * for a submitted report.
 */
const selectRow = async (title: string) => {
  const row = (await screen.findByRole("button", { name: title })).closest("tr")!;
  fireEvent.click(row);
  return row;
};

/**
 * The register on a phone.
 *
 * At 390px the table was 775px wide inside a horizontal scroller: Status,
 * Updated and every action sat off the right-hand edge, the Kind chip was
 * squeezed to 40px and set `COMPLIANCE_REPORT` one letter per line, and each
 * row stood 150px tall to hold it. An operator could see that reports
 * existed and do nothing with them.
 */
describe("the register is a list of cards under 768px", () => {
  /* jsdom's window is 1024px wide and stays however a test leaves it, so the
     width is put back as well as the mock: `useIsMobile`'s listener reads
     `innerWidth`, and a test that leaves it at 390 makes every test after it
     a phone. */
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  });

  const mobile = () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({
      matches: /max-width/.test(q), media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
  };

  it("draws the cards and not the table", async () => {
    mobile();
    const { container } = renderPage();
    await screen.findByRole("button", { name: REPORT.title });
    expect(container.querySelector("table")).toBeNull();
  });

  it("draws the table and not the cards on a desktop", async () => {
    const { container } = renderPage();
    await screen.findByRole("button", { name: REPORT.title });
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("never draws both, so nothing is announced twice", async () => {
    /* A CSS-hidden copy still carries every accessible name in the
       document: assistive technology would meet each report's title, its
       checkbox and each of its actions twice, on whichever layout it is not
       looking at. `ResponsiveTable` — this repository's own mobile-table
       pattern — switches on the same hook for the same reason. */
    mobile();
    renderPage();
    expect((await screen.findAllByRole("button", { name: REPORT.title })).length).toBe(1);
  });

  it("offers the same acts on a card as in a row", async () => {
    /* One definition of what can be done to a row, rendered in both
       places. Two copies is how a phone comes to offer an Approve that the
       desktop has already taken away. */
    mobile();
    renderPage();
    await screen.findByRole("button", { name: REPORT.title });
    for (const act of ["Edit", "Approve", "Record", "Delete"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${act}$`) })).toBeInTheDocument();
    }
    const page = read("src/pages/aml/AmlAustracReporting.tsx");
    expect(page).toContain("rowActions(r, \"end\")");
    expect(page).toContain("rowActions(r, \"start\")");
  });

  it("names the kind and the status rather than printing the column", async () => {
    mobile();
    renderPage();
    await screen.findByRole("button", { name: REPORT.title });
    const page = read("src/pages/aml/AmlAustracReporting.tsx")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(page).not.toContain("r.kind.toUpperCase()");
    expect(page).not.toContain("r.status.replace(/_/g");
  });
});

describe("drafting is a page, not a dialog", () => {
  /*
    A report to a regulator is the longest single piece of writing anyone
    does in this product, written against a statutory deadline and usually
    over more than one sitting. A modal could not be linked to, returned to
    with the back button, or reopened where it was left, and it closed on an
    outside click with whatever was in it.
  */
  it("names the act rather than the record it would add", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Start AUSTRAC Report" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Draft/i })).not.toBeInTheDocument();
  });

  it("opens no dialog at all — it navigates", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start AUSTRAC Report" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/aml/austrac/new");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("edits an existing report at its own address", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit$/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/aml/austrac/r1/edit");
  });

  it("selects the report the draft page hands back", async () => {
    /* The dialog closed onto the report it had just written. Losing that on
       the move to a page is the one thing it could have cost, so the page
       returns with `?report=` and the hub opens it. */
    renderPage("/admin/aml/austrac?report=r1");
    await waitFor(() => expect(getReport).toHaveBeenCalledWith("r1"));
  });
});

describe("the guided path", () => {
  it("renders, and leads with what to do next", async () => {
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    await waitFor(() =>
      expect(screen.getByText("Suspicious Matter Report")).toBeInTheDocument());
    /* Five numbered steps, one of them open. It was six: a "clear the
       checks" step whose only completion was routing the report to the
       MLRO, and the MLRO's approval. Without the routing the two count the
       same fact, and two steps counting one thing is how a header comes to
       disagree with the list under it. */
    /* Twice: the header leads with the open step, and the list names it. */
    expect((await screen.findAllByText("Review the checks and approve it")).length)
      .toBeGreaterThan(0);
    expect(screen.queryByText("MLRO approves it")).not.toBeInTheDocument();
    expect(screen.queryByText("Clear the pre-lodgement checks")).not.toBeInTheDocument();
    expect(screen.getByText("Lodge it at AUSTRAC Online")).toBeInTheDocument();
    expect(screen.getByText("Keep the receipt with the report")).toBeInTheDocument();
  });

  it("shows the statutory deadline and the section it comes from", async () => {
    /* A deadline nobody can see is a deadline nobody meets. */
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    await waitFor(() =>
      expect(screen.getAllByText(/AML\/CTF Act 2006 \(Cth\) s\.41/).length).toBeGreaterThan(0));
  });

  it("says the platform never lodges, on the page rather than in a tooltip", async () => {
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    await waitFor(() =>
      expect(screen.getByText(/holds no AUSTRAC credentials and submits nothing on your behalf/i))
        .toBeInTheDocument());
  });
});

describe("the record download", () => {
  /*
    "Bundle" downloaded the edge function's JSON response — a file that opens
    in a text editor, carries no identity and no branding, and is a developer
    artefact rather than the archive record for a report to a regulator.
  */
  it("names the act rather than the payload", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /Record/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bundle$/i })).not.toBeInTheDocument();
  });

  it("produces a real PDF, under the Aurixa Systems fallback", async () => {
    /* End to end: the export is fetched, the record is built, jsPDF draws
       it, and what reaches the anchor is a PDF whose bytes start `%PDF`.
       The workspace in this test has no brand, so it must issue under the
       platform identity rather than an empty masthead. */
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") { (el as HTMLAnchorElement).click = () => {}; created.push(el as HTMLAnchorElement); }
      return el;
    });
    const blobs: Blob[] = [];
    const realUrl = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => { blobs.push(b); return "blob:x"; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

    try {
      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: /Record/i }));
      await waitFor(() => expect(blobs.length).toBe(1));
      const head = new Uint8Array(await blobs[0].arrayBuffer()).slice(0, 4);
      expect(String.fromCharCode(...head)).toBe("%PDF");
      expect(blobs[0].size).toBeGreaterThan(1000);
      expect(created.at(-1)?.download).toBe("austrac-smr-AML-2026-00005.pdf");
    } finally {
      spy.mockRestore();
      URL.createObjectURL = realUrl;
    }
  });
});

describe("the guided path leads somewhere", () => {
  it("opens the report to be reviewed rather than approving from the row", async () => {
    /* Approving from a register row asks somebody to authorise a document
       they are not looking at. The step opens the report itself, where the
       checks, the narrative and the approval are all on one screen. */
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    fireEvent.click(await screen.findByRole("button", { name: /Review and approve/i }));
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/aml/austrac/r1/edit");
    expect(mlroSignoff).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Open$/ })).not.toBeInTheDocument();
  });

  it("never asks anybody to send the report to themselves", async () => {
    /* On a reporting entity where the person drafting the report IS the
       MLRO — most of them — a hand-off step is a report sent from somebody
       to themselves before they can act on it. */
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    await screen.findByRole("button", { name: /Review and approve/i });
    expect(screen.queryByRole("button", { name: /Send to the MLRO/i })).not.toBeInTheDocument();
    expect(upsertReport).not.toHaveBeenCalled();
  });

  /* Complete enough to reach the approval, and past its statutory window —
     the one check that can still be outstanding when the approval is the
     open step. Measured backwards from today for the same reason the fixture
     above is measured forwards: a literal date is only ever correct for a
     while. */
  const withGaps = { ...REPORT, metadata: { obligation_at: longOverdueIso() } };

  it("keeps the row's own approval for an MLRO who has already read it", async () => {
    /* Removing a control is not what opening the report was for. */
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    const confirmed = vi.spyOn(window, "confirm");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mlroSignoff).toHaveBeenCalledWith("r1"));
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("asks before approving a report whose checks are still outstanding", async () => {
    /* Approving an incomplete report is legitimate and is recorded against
       the person who did it — but it should never happen by accident. */
    listReports.mockResolvedValue([withGaps]);
    getReport.mockResolvedValue({ report: withGaps, versions: [], submissions: [] });
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    const confirmed = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(confirmed).toHaveBeenCalled();
    expect(mlroSignoff).not.toHaveBeenCalled();
  });

  it("does not count the steps the approval itself unlocks against it", async () => {
    /* Lodgement and the receipt come AFTER approval. Listing them as
       outstanding would ask the approver to answer for the steps their own
       decision unlocks. */
    listReports.mockResolvedValue([withGaps]);
    getReport.mockResolvedValue({ report: withGaps, versions: [], submissions: [] });
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    const confirmed = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const asked = String(confirmed.mock.calls[0]?.[0] ?? "");
    expect(asked).toMatch(/Within the statutory window/);
    expect(asked).not.toMatch(/Lodged at AUSTRAC Online/);
    expect(asked).not.toMatch(/Receipt on file/);
    expect(asked).not.toMatch(/MLRO approval/);
  });
});

describe("which report am I looking at", () => {
  it("marks the selected row, and says so in words", async () => {
    /* A 40%-opacity muted tint on a dark theme is the same charcoal as the
       row beside it. Three signals rather than one. */
    renderPage();
    const row = await selectRow("SMR — unusual cash deposits");
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
    expect(within(row).getByText(/Viewing/i)).toBeInTheDocument();
  });

  it("can be driven from the keyboard", async () => {
    /* The row was click-only, so the register could not be worked without
       a mouse at all. */
    renderPage();
    const row = (await screen.findByRole("button", { name: "SMR — unusual cash deposits" })).closest("tr")!;
    expect(row).toHaveAttribute("tabIndex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(getReport).toHaveBeenCalledWith("r1"));
  });

  it("heads the detail panel with the obligation and the status", async () => {
    /* It said "Detail" with the title in muted small print, naming neither
       the obligation nor the status. */
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    await waitFor(() =>
      expect(screen.getByText("Suspicious Matter Report")).toBeInTheDocument());
    expect(screen.getAllByText(/^SMR$/).length).toBeGreaterThan(0);
  });

  it("tints the suspicious matter report and nothing else", () => {
    /* In the dark theme `--primary` and `--warning` are both the brand gold,
       so a tone per obligation renders as five near-identical amber chips.
       The three letters tell the obligations apart; colour is reserved for
       the one whose existence may not be disclosed. */
    const src = read("src/pages/aml/AmlAustracReporting.tsx");
    const i = src.indexOf("const KIND_TONE");
    const block = src.slice(i, src.indexOf("};", i));
    expect(block).toContain("smr:");
    for (const other of ["ttr:", "ifti:", "compliance:", "annual:"]) {
      expect(block).not.toContain(other);
    }
  });

  it("invites a choice when nothing is selected, without saying where to look", async () => {
    /* It read "Choose a report on the left". The register IS on the left on
       a desktop and directly above on a phone, so the sentence was wrong on
       every small screen — the same rule the AUSTRAC path already holds, that
       no step may describe its own position. The assertion is the rule
       rather than the wording. */
    listReports.mockResolvedValue([]);
    renderPage();
    const invite = await screen.findByText(/Choose a report/i);
    expect(invite).toBeInTheDocument();
    expect(invite.textContent).not.toMatch(/\b(on the left|on the right|above|below)\b/i);
  });
});

describe("a report can be opened from the register", () => {
  /* "Edit" was offered on a draft alone, so a submitted or approved report
     could be SELECTED and never opened: the register showed a status and a
     date and there was no way to read the document behind them. */
  const LODGED = { ...REPORT, id: "r5", status: "submitted", title: "Lodged SMR" };

  it("opens the report when its title is clicked, whatever its status", async () => {
    listReports.mockResolvedValue([LODGED]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Lodged SMR" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/aml/austrac/r5/edit");
  });

  it("still selects the report when the row itself is clicked", async () => {
    renderPage();
    await selectRow("SMR — unusual cash deposits");
    await waitFor(() => expect(getReport).toHaveBeenCalledWith("r1"));
  });
});

describe("archiving is putting away, not throwing away", () => {
  const LODGED = { ...REPORT, id: "r5", status: "submitted", title: "Lodged SMR" };

  it("offers Archive on a report whose lodgement is behind it", async () => {
    listReports.mockResolvedValue([LODGED]);
    renderPage();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archiveReport).toHaveBeenCalledWith("r5"));
  });

  it("does not offer it on a draft, which is deleted instead", async () => {
    /* A button that exists in order to be refused teaches an operator to
       distrust the page. */
    renderPage();
    await screen.findByText("SMR — unusual cash deposits");
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete/i })).toBeInTheDocument();
  });

  it("does not offer it on an approved report that has not been lodged", async () => {
    /* The rule the whole feature turns on: hiding it would lose a statutory
       deadline, not tidy a list. */
    listReports.mockResolvedValue([{ ...REPORT, id: "r6", status: "approved", title: "Approved SMR" }]);
    renderPage();
    await screen.findByRole("button", { name: "Approved SMR" });
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("says what is kept before it archives anything", async () => {
    listReports.mockResolvedValue([LODGED]);
    renderPage();
    const confirmed = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    const asked = String(confirmed.mock.calls[0]?.[0] ?? "");
    expect(asked).toMatch(/Everything is kept/i);
    expect(asked).toMatch(/restore/i);
    /* Lodged with no receipt on file — said, not hidden. */
    expect(asked).toMatch(/No AUSTRAC receipt/i);
    expect(archiveReport).not.toHaveBeenCalled();
  });

  it("lets the operator choose which reports to archive", async () => {
    /* "Choose the report to archive" — an explicit pick rather than
       something a stray click does to a row nobody meant. */
    listReports.mockResolvedValue([LODGED, { ...LODGED, id: "r6", title: "Second lodged" }]);
    renderPage();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Lodged SMR" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Second lodged" }));
    expect(await screen.findByText("2 reports selected")).toBeInTheDocument();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /Archive selected/i }));
    await waitFor(() => expect(archiveReport).toHaveBeenCalledTimes(2));
    expect(archiveReport).toHaveBeenCalledWith("r5");
    expect(archiveReport).toHaveBeenCalledWith("r6");
  });

  it("offers no checkbox on a report the archive would refuse", async () => {
    /* A control that exists to be turned down teaches an operator to
       distrust the page. The checkbox reads the same rule the row's button
       and the server both read. */
    listReports.mockResolvedValue([{ ...REPORT, id: "r7", status: "approved", title: "Approved SMR" }]);
    renderPage();
    await screen.findByRole("button", { name: "Approved SMR" });
    expect(screen.queryByRole("checkbox", { name: "Select Approved SMR" })).not.toBeInTheDocument();
  });

  it("selects every archivable report at once, and only those", async () => {
    listReports.mockResolvedValue([
      LODGED,
      { ...REPORT, id: "r8", status: "approved", title: "Approved SMR" },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("checkbox", {
      name: /Select every report that can be archived/i,
    }));
    expect(await screen.findByText("1 report selected")).toBeInTheDocument();
  });

  it("offers Undo on what it just archived", async () => {
    /* Telling somebody a thing is reversible and then making them go and
       find the other view to reverse it is not the same as reversing it. */
    listReports.mockResolvedValue([LODGED]);
    renderPage();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archiveReport).toHaveBeenCalledWith("r5"));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(restoreReport).toHaveBeenCalledWith("r5"));
  });

  it("does not ask a second time when undoing", async () => {
    /* Undoing is not a new decision. */
    listReports.mockResolvedValue([LODGED]);
    renderPage();
    const confirmed = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archiveReport).toHaveBeenCalled());
    expect(confirmed).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(restoreReport).toHaveBeenCalled());
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it("has its own view, and restores from it", async () => {
    renderPage();
    await screen.findByText("SMR — unusual cash deposits");
    listReports.mockResolvedValue([{ ...LODGED, archived_at: "2026-08-30T00:00:00.000Z" }]);
    fireEvent.click(screen.getByRole("button", { name: /^Archived/ }));
    await waitFor(() => expect(listReports).toHaveBeenCalledWith(
      expect.objectContaining({ archived: "archived" })));
    fireEvent.click(await screen.findByRole("button", { name: /Restore/i }));
    await waitFor(() => expect(restoreReport).toHaveBeenCalledWith("r5"));
  });

  it("asks for the working register by default", async () => {
    renderPage();
    await waitFor(() => expect(listReports).toHaveBeenCalledWith(
      expect.objectContaining({ archived: "live" })));
  });
});

describe("the machinery underneath is untouched", () => {
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

  it("an SMR case event is still marked restricted — tipping off is an offence", () => {
    /* s.123 makes disclosing an SMR an offence. The event the submission
       writes carries `restricted` so downstream renderers can withhold it. */
    const fn = read("supabase/functions/aml-reporting/index.ts");
    expect(fn).toMatch(/report\.kind === "smr"\) eventPayload\.restricted = true/);
  });

  it("the Passport already denies SMR and AUSTRAC material to BOTH audiences", () => {
    /* Tipping off is an offence under s.123, so the protection has to be at
       the projection rather than in a caller's discretion. Both deny-lists
       already carry `smr` and `austrac`, and this pins them: a report can
       never travel to a client's copy or a partner's, whatever is added to
       the record above them. */
    const view = read("supabase/functions/_shared/aml/passport/passportView.pure.ts");
    for (const list of ["CLIENT_RESTRICTED_KEYS", "PARTNER_RESTRICTED_KEYS"]) {
      const i = view.indexOf(`const ${list}`);
      expect(i).toBeGreaterThan(0);
      const pattern = view.slice(i, view.indexOf(";", i));
      expect(pattern).toContain("smr");
      expect(pattern).toContain("austrac");
      expect(pattern).toContain("suspic");
    }
  });
});
