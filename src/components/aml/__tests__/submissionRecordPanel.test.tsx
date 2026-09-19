import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SubmissionReviewPanel } from "../SubmissionReviewPanel";

/**
 * The submission record: read in full, downloaded, stored on the case.
 * What is pinned here — the reading view puts the entirety in front of the
 * reviewer and coverage says so; the download and the stored copy come from
 * the one shared module; and the stored record can never reach the client
 * portal.
 */

const getSubmissionReview = vi.fn();
const storeSubmissionRecord = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    getSubmissionReview: (...a: unknown[]) => getSubmissionReview(...a),
    storeSubmissionRecord: (...a: unknown[]) => storeSubmissionRecord(...a),
    acceptSubmission: vi.fn(),
    requestSubmissionChanges: vi.fn(),
    requestSubmissionDocument: vi.fn(),
    requestSubmissionClarification: vi.fn(),
    escalateSubmission: vi.fn(),
    supersedeSubmission: vi.fn(),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

/* An unbranded workspace: the record must issue under the Aurixa Systems
 * fallback, never an empty masthead. */
vi.mock("@/branding/BrandProvider", () => ({
  useBrand: () => ({
    settings: {
      companyName: "Dashboard", brandColor: null,
      authLogo: null, sidebarLogo: null, sidebarIcon: null,
      favicon: null, reportLogo: null, reportMonoLogo: null,
    },
  }),
}));

/*
 * The PDF generator is mocked at the module edge — its real output is pinned
 * by submissionRecordPdf.test.ts (parsed back with pdf-lib). What THIS file
 * pins is the wiring: the download button hands the browser a .pdf built
 * from the record on screen. The filename rule stays real.
 */
const generatePdf = vi.fn(
  async (..._args: unknown[]) => new Blob(["%PDF-test"], { type: "application/pdf" }),
);
vi.mock("@/lib/aml/submissionRecordPdf", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/aml/submissionRecordPdf")>();
  return { ...real, generateSubmissionRecordPdf: (...a: unknown[]) => generatePdf(...a) };
});

const CASE_ID = "11111111-1111-4111-8111-111111111111";

const reviewData = (over = {}) => ({
  case: {
    id: CASE_ID, reference: "AML-2026-00005", subject: "Rugesh Naidu",
    status: "kyc_complete", case_stage: "client_submitted",
    client_portal_status: "in_progress", service_gate_status: "terminated",
  },
  submission: {
    id: "sub1", version_number: 1, review_status: "submitted",
    submitted_at: "2026-08-16T02:59:52Z", submitted_by_type: "client",
    review_reason: null, reviewed_at: null,
    questionnaire_version: "v2", consent_version: "v2026.2",
    applicable_sections: [],
    sections: [{ section: "personal_details", payload: { full_name: "Rugesh Naidu" } }],
    superseded_at: null,
  },
  versions: [{ id: "sub1", version_number: 1 }],
  previous_version: null,
  differences: [],
  differences_material: false,
  risk: { latest_assessment_at: null, stale: false, stale_reasons: [] },
  missing_mandatory: [],
  consent_evidence: [{ kind: "privacy_notice", version: "v2026.2", accepted_at: "2026-08-16T02:10:00Z", document_hash: null }],
  related_parties: [],
  documents: [{ id: "d1", filename: "passport.jpg", status: "accepted", version_number: 1 }],
  verification: [{ id: "v1", party_label: "Rugesh Naidu", check_type: "electronic_idv", status: "passed" }],
  screening: [{ id: "sc1", screened_name: "Rugesh Naidu", party_type: "primary_subject", state: "completed" }],
  open_requests: [],
  requirements: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSubmissionReview.mockResolvedValue(reviewData());
  storeSubmissionRecord.mockResolvedValue({ document: { id: "doc-record" }, content_hash: "a".repeat(64) });
});

const renderPanel = () => render(
  <SubmissionReviewPanel caseId={CASE_ID} canWrite canDecide onChanged={vi.fn()} />,
);

describe("the reading view is the entirety of the submission", () => {
  it("opens as one continuous document and counts every section as seen", async () => {
    renderPanel();
    expect(await screen.findByText(/1 of 5 sections\s+opened/i)).toBeTruthy();
    // The record row's button, not the strip's — both open the same reader.
    fireEvent.click(screen.getAllByRole("button", { name: /read in full/i })[0]);
    // Every record section renders, in order, inside the dialog.
    expect(await screen.findByRole("heading", { name: "Review decision" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Questionnaire answers" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Screening by party" })).toBeTruthy();
    // Reading in full put everything in front of the reviewer: coverage says so.
    expect(screen.getByText(/every section with content has been opened — 5 of 5/i)).toBeTruthy();
  });

  it("carries the staff-only notice", async () => {
    renderPanel();
    fireEvent.click((await screen.findAllByRole("button", { name: /read in full/i }))[0]);
    expect(await screen.findByText(/must not be provided to the client/i)).toBeTruthy();
  });
});

describe("download and store", () => {
  it("downloads the internal record as a PDF issued under the Aurixa fallback", async () => {
    const createObjectURL = vi.fn(() => "blob:record");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      renderPanel();
      // The download is a menu of two named documents. Keyboard-open: Radix
      // opens reliably on Enter in jsdom, where pointer events are partial.
      const trigger = await screen.findByRole("button", { name: /download pdf/i });
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(await screen.findByText(/internal record — full detail/i));
      // A .pdf handed to the browser as a download — never an .html that
      // opens as a tab: the reviewer keeps the finished document.
      await waitFor(() => expect(generatePdf).toHaveBeenCalledTimes(1));
      const [recordArg, brandArg] = generatePdf.mock.calls[0] as any[];
      expect(recordArg.audience).toBe("internal");
      expect(brandArg.name).toBe("Aurixa Systems");
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        title: "PDF downloaded",
        description: "AML-2026-00005-submission-v1-record.pdf · issued by Aurixa Systems",
      }));
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("downloads the client copy without internal readings, named as a client copy", async () => {
    const createObjectURL = vi.fn(() => "blob:record");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      renderPanel();
      const trigger = await screen.findByRole("button", { name: /download pdf/i });
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(await screen.findByText(/client copy — shareable/i));
      await waitFor(() => expect(generatePdf).toHaveBeenCalledTimes(1));
      const [recordArg] = generatePdf.mock.calls[0] as any[];
      expect(recordArg.audience).toBe("client");
      // The structural guarantee, asserted on the exact record handed to the
      // renderer: no screening, no risk, from THIS screen's data.
      const keys = recordArg.sections.map((sec: any) => sec.key);
      expect(keys).not.toContain("screening");
      expect(keys).not.toContain("risk");
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Client copy downloaded",
        description: "AML-2026-00005-submission-v1-client-copy.pdf · issued by Aurixa Systems",
      }));
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("stores the version on screen, explicitly — never 'latest'", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /store on case/i }));
    await waitFor(() => expect(storeSubmissionRecord).toHaveBeenCalledWith(CASE_ID, 1));
    // The toast names where it went and the hash that proves what it was.
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Record stored on the case",
    })));
  });
});

describe("the server side, pinned at the source", () => {
  const casesSrc = readFileSync(
    join(__dirname, "../../../../supabase/functions/aml-cases/index.ts"), "utf8");
  const portalSrc = readFileSync(
    join(__dirname, "../../../../supabase/functions/aml-client-portal/index.ts"), "utf8");

  it("get_submission_review and store_submission_record share one composition", () => {
    // Two compositions would be two opinions about what the review contains.
    expect(casesSrc).toContain("async function composeSubmissionReview(");
    expect((casesSrc.match(/await composeSubmissionReview\(/g) ?? []).length).toBe(2);
    expect(casesSrc).toContain("case 'store_submission_record':");
    expect(casesSrc).toContain("renderSubmissionRecordHtml(record)");
  });

  it("the stored record is marked, staff-uploaded and content-addressed", () => {
    expect(casesSrc).toContain("kind: SUBMISSION_RECORD_DOCUMENT_KIND");
    expect(casesSrc).toMatch(/uploaded_by_type: 'staff',\s*\n\s*uploaded_by: userId/);
    expect(casesSrc).toContain("content_sha256: contentHash");
  });

  it("a stored record is an export OF the review, never evidence IN it", () => {
    expect(casesSrc).toMatch(
      /evidenceDocs = \(docs \?\? \[\]\)\.filter\(\s*\n?\s*\(d: any\) => d\?\.metadata\?\.kind !== SUBMISSION_RECORD_DOCUMENT_KIND/,
    );
  });

  it("the client portal refuses the record in both the listing and the signing op", () => {
    // The record carries screening states and risk readings — staff-only.
    expect(portalSrc).toContain(
      'import { SUBMISSION_RECORD_DOCUMENT_KIND } from "../_shared/aml/submissionRecord.pure.ts"');
    expect(portalSrc).toContain(
      ".filter((d: any) => d?.metadata?.kind !== SUBMISSION_RECORD_DOCUMENT_KIND)");
    expect(portalSrc).toContain(
      "(doc as any)?.metadata?.kind === SUBMISSION_RECORD_DOCUMENT_KIND");
  });
});
