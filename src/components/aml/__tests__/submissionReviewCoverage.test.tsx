import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SubmissionReviewPanel } from "../SubmissionReviewPanel";

/**
 * "Review the submission" did nothing, the decision sat above unopened
 * evidence, and a first submission wore a red "20 · material" badge above
 * the sentence "This is the first submission." What is pinned here is the
 * on-screen half of each fix; the rules live in
 * `submissionReviewCoverage.test.ts`.
 */

const getSubmissionReview = vi.fn();
const acceptSubmission = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    getSubmissionReview: (...a: unknown[]) => getSubmissionReview(...a),
    acceptSubmission: (...a: unknown[]) => acceptSubmission(...a),
    requestSubmissionChanges: vi.fn(),
    requestSubmissionDocument: vi.fn(),
    requestSubmissionClarification: vi.fn(),
    escalateSubmission: vi.fn(),
    supersedeSubmission: vi.fn(),
  },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
// The panel reads the white-label identity for its PDF downloads.
vi.mock("@/branding/BrandProvider", () => ({
  useBrand: () => ({
    settings: {
      companyName: "Dashboard", brandColor: null,
      authLogo: null, sidebarLogo: null, sidebarIcon: null,
      favicon: null, reportLogo: null, reportMonoLogo: null,
    },
  }),
}));

const CASE_ID = "11111111-1111-4111-8111-111111111111";

/** The production case, exactly: first submission, old-server payload. */
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
    applicable_sections: [], sections: [], superseded_at: null,
  },
  versions: [{ id: "sub1", version_number: 1 }],
  previous_version: null,
  // What the deployed function sends for a FIRST submission: a diff against
  // an empty snapshot.
  differences: new Array(20).fill({ section: "personal_details", field: "x", kind: "added" }),
  differences_material: true,
  risk: { stale: false, stale_reasons: [] },
  missing_mandatory: [],
  consent_evidence: [],
  related_parties: [],
  documents: [{ id: "d1" }, { id: "d2" }, { id: "d3" }],
  verification: [{ id: "v1", party_label: "Rugesh Naidu", check_type: "electronic_idv", status: "passed" }],
  screening: [{ id: "sc1", screened_name: "Rugesh Naidu", party_type: "primary_subject", state: "completed" }],
  open_requests: [],
  requirements: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSubmissionReview.mockResolvedValue(reviewData());
  acceptSubmission.mockResolvedValue({ submission: {} });
});

const renderPanel = () => render(
  <SubmissionReviewPanel caseId={CASE_ID} canWrite canDecide onChanged={vi.fn()} />,
);

describe("a first submission is not twenty material changes", () => {
  it("reads FIRST SUBMISSION even against the old server's payload", async () => {
    renderPanel();
    expect(await screen.findByText("First submission")).toBeTruthy();
    // The badge, specifically — a bare /20/ would match "2026" in the dates.
    expect(screen.queryByText(/20 · material/)).toBeNull();
    expect(screen.queryByText(/· material/)).toBeNull();
  });
});

describe("coverage stands beside the decision", () => {
  it("counts what has been opened and names what has not", async () => {
    renderPanel();
    // consent, answers, documents, verification, screening have content;
    // verification is open by default → 1 of 5.
    expect(await screen.findByText(/1 of 5 sections\s+opened/i)).toBeTruthy();
    expect(screen.getByText(/still to look at: consent evidence/i)).toBeTruthy();
  });

  it("Open next opens the next unopened section and the count moves", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /open next: consent evidence/i }));
    expect(await screen.findByText(/2 of 5 sections\s+opened/i)).toBeTruthy();
    // …and the next target advances in page order.
    expect(screen.getByRole("button", { name: /open next: questionnaire answers/i })).toBeTruthy();
  });

  it("closing a section does not un-see it", async () => {
    // Coverage is "had it open in front of them", not "has it open now".
    renderPanel();
    // Exact name: "Open next: Consent evidence" also matches a loose regex.
    const trigger = await screen.findByRole("button", { name: "Consent evidence" });
    fireEvent.click(trigger); // open
    expect(await screen.findByText(/2 of 5 sections\s+opened/i)).toBeTruthy();
    fireEvent.click(trigger); // close again
    expect(screen.getByText(/2 of 5 sections\s+opened/i)).toBeTruthy();
  });
});

describe("accepting with unopened sections is a visible choice", () => {
  it("the accept dialog names what was not opened, and stays actionable", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /accept submission/i }));
    expect(await screen.findByText(/not everything was opened/i)).toBeTruthy();
    expect(screen.getByText(/you have not opened: consent evidence/i)).toBeTruthy();
    // Disclosed, never a gate: the confirm button is enabled.
    const confirm = screen.getAllByRole("button", { name: /accept submission/i }).at(-1)!;
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the button that did nothing", () => {
  it("review_submission lands on the panel instead of falling through", () => {
    /*
     * `performStageAction` set the section the operator was already on and
     * fell through a switch with no case for it — the workspace's own
     * comment names the failure: a click that changes nothing visible is
     * indistinguishable from a broken button.
     */
    const src = readFileSync(
      join(__dirname, "../../../pages/aml/AmlCaseWorkspace.tsx"), "utf8");
    expect(src).toContain('case "review_submission":');
    expect(src).toContain('document.getElementById("aml-submission-review")');
    expect(src).toContain('id="aml-submission-review"');
  });
});
