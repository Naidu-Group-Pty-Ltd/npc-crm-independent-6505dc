import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FundingEvidencePanel } from "../FundingEvidencePanel";

/**
 * Stage 6's working surface, on screen.
 *
 * The rules are pinned in `fundingEvidence.test.ts`. What is asserted here is
 * the wiring the defect was made of: the panel exists at all (nothing called
 * `upsertSof` before it), a declared source is recorded by a PERSON pressing
 * a button, verification is its own explicit act, and a failed read never
 * renders as an empty list ready to work on.
 */

const listSof = vi.fn();
const upsertSof = vi.fn();
const deleteSof = vi.fn();
const getSubmissionReview = vi.fn();
vi.mock("@/lib/aml/amlMonitoringApi", () => ({
  amlMonitoringApi: {
    listSof: (...a: unknown[]) => listSof(...a),
    upsertSof: (...a: unknown[]) => upsertSof(...a),
    deleteSof: (...a: unknown[]) => deleteSof(...a),
  },
}));
const listDocuments = vi.fn();
const reviewDocument = vi.fn();
const getDocumentDownloadUrl = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    getSubmissionReview: (...a: unknown[]) => getSubmissionReview(...a),
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    reviewDocument: (...a: unknown[]) => reviewDocument(...a),
    getDocumentDownloadUrl: (...a: unknown[]) => getDocumentDownloadUrl(...a),
  },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const sof = (over = {}) => ({
  id: "s1", edd_case_id: null, case_id: CASE_ID, source_type: "savings",
  description: "Salary savings", amount: null, currency: "AUD",
  evidence_path: null, evidence_provider: null, verified: false,
  verified_by: null, verified_at: null, notes: null, metadata: {},
  created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z",
  ...over,
});
const review = (sources: string[] = ["Salary savings", "Loan / mortgage"]) => ({
  submission: {
    sections: [{ section: "funding", payload: {
      deposit: "200000", sources, overseas: "no",
      narrative: "Family and savings", institutions: "Cba",
    } }],
  },
});

const caseDoc = (over = {}) => ({
  id: "d1", filename: "statement.pdf", display_name: null, status: "uploaded",
  uploaded_at: "2026-08-20T00:00:00Z", uploaded_by_type: "client",
  requirement: { code: "source_of_funds", label: "Source of funds evidence" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listSof.mockResolvedValue({ items: [] });
  listDocuments.mockResolvedValue({ documents: [] });
  getSubmissionReview.mockResolvedValue(review());
  upsertSof.mockResolvedValue({ item: sof() });
  reviewDocument.mockResolvedValue({ document: caseDoc() });
  getDocumentDownloadUrl.mockResolvedValue({ url: "https://signed.example/x" });
});

const renderPanel = (canWrite = true, onChanged = vi.fn()) => {
  render(<FundingEvidencePanel caseId={CASE_ID} canWrite={canWrite} onChanged={onChanged} />);
  return onChanged;
};

describe("the customer's declaration reaches the analyst", () => {
  it("offers each declared source, recorded by a person's click, unverified", async () => {
    renderPanel();
    expect(await screen.findByText(/declared by the customer, not yet recorded/i)).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: /record as a source/i });
    expect(buttons.length).toBe(2);

    fireEvent.click(buttons[0]);
    await waitFor(() => expect(upsertSof).toHaveBeenCalled());
    const written = upsertSof.mock.calls[0][0];
    expect(written.case_id).toBe(CASE_ID);
    expect(written.source_type).toBe("savings");
    expect(written.description).toBe("Salary savings");
    // The line the whole flow rests on: a declaration arrives unverified.
    expect(written.verified).toBeUndefined();
    expect(written.amount).toBeNull();
  });

  it("a source already recorded is not offered again", async () => {
    listSof.mockResolvedValue({ items: [sof()] });
    renderPanel();
    expect(await screen.findByText("Salary savings")).toBeTruthy();
    const offers = screen.getAllByRole("button", { name: /record as a source/i });
    expect(offers.length).toBe(1); // only Loan / mortgage remains
  });
});

describe("verification is an explicit act", () => {
  it("verify asks WHICH documents it rested on, and records them", async () => {
    /*
     * The act used to be one click that named nothing — `evidence_path` had
     * been writable and unwritten since the table was created. Verification
     * and the document it rested on are one recorded act now.
     */
    listSof.mockResolvedValue({ items: [sof()] });
    listDocuments.mockResolvedValue({ documents: [
      caseDoc({ status: "accepted", display_name: "CBA statement" }),
    ] });
    const onChanged = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /verify against evidence/i }));

    // The accepted document arrives pre-ticked, and the button says the count.
    const confirm = await screen.findByRole("button", { name: /verify — 1 document named/i });
    fireEvent.click(confirm);

    await waitFor(() => expect(upsertSof).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "s1", verified: true,
        evidence_path: "aml_document:d1",
        metadata: expect.objectContaining({
          evidence_document_ids: ["d1"],
          evidence_document_names: ["CBA statement"],
        }),
      })));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("a merely-uploaded document is offered but never pre-ticked", async () => {
    // Pre-ticking unreviewed evidence into a verification would launder its
    // review status. With nothing accepted, the button is explicit about it.
    listSof.mockResolvedValue({ items: [sof()] });
    listDocuments.mockResolvedValue({ documents: [caseDoc({ status: "uploaded" })] });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /verify against evidence/i }));
    expect(await screen.findByRole("button", { name: /verify without naming a document/i }))
      .toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("a verified row shows what it rested on", async () => {
    listSof.mockResolvedValue({ items: [sof({
      verified: true, verified_at: "2026-08-25T00:00:00Z",
      metadata: { evidence_document_names: ["CBA statement"] },
    })] });
    renderPanel();
    expect(await screen.findByText(/Evidence: CBA statement/)).toBeTruthy();
  });

  it("a verified source can be withdrawn, never silently edited", async () => {
    listSof.mockResolvedValue({ items: [sof({ verified: true, verified_at: "2026-08-25T00:00:00Z" })] });
    renderPanel();
    expect(await screen.findByText("Verified")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /withdraw verification/i }));
    await waitFor(() => expect(upsertSof).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", verified: false })));
  });

  it("a reader without the write role gets a reading, not buttons", async () => {
    listSof.mockResolvedValue({ items: [sof()] });
    renderPanel(false);
    expect(await screen.findByText("Salary savings")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /verify against evidence/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /record as a source/i })).toBeNull();
  });
});

describe("the Passport line tells the truth", () => {
  it("unearned while nothing is verified, and says recording is not enough", async () => {
    listSof.mockResolvedValue({ items: [sof()] });
    renderPanel();
    expect(await screen.findByText(/recording alone does not earn it/i)).toBeTruthy();
  });

  it("earned once a source is verified, with the date", async () => {
    listSof.mockResolvedValue({ items: [sof({ verified: true, verified_at: "2026-08-25T00:00:00Z" })] });
    renderPanel();
    expect(await screen.findByText(/carries SOURCE OF FUNDS REVIEWED, dated 2026-08-25/i)).toBeTruthy();
  });
});

describe("a failed read is not an empty list", () => {
  it("says the list could not be read and offers no work over it", async () => {
    listSof.mockRejectedValue(new Error("503"));
    renderPanel();
    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
    // Recording against a list you cannot see risks doubling what is there.
    expect(screen.queryByRole("button", { name: /record as a source/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /record another source/i })).toBeNull();
  });

  it("an unreadable submission only mutes the seeding, never the panel", async () => {
    getSubmissionReview.mockRejectedValue(new Error("403"));
    listSof.mockResolvedValue({ items: [sof()] });
    renderPanel();
    expect(await screen.findByText("Salary savings")).toBeTruthy();
    expect(screen.queryByText(/declared by the customer, not yet recorded/i)).toBeNull();
  });
});

describe("the funding documents, reviewed where the work is", () => {
  it("shows them with the same accept/reject review Stage 4 writes", async () => {
    listSof.mockResolvedValue({ items: [sof()] });
    listDocuments.mockResolvedValue({ documents: [caseDoc()] });
    renderPanel();
    expect(await screen.findByText(/funding documents on file/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    await waitFor(() => expect(reviewDocument).toHaveBeenCalledWith("d1", "accepted"));
  });

  it("a rejection needs a reason the client will read", async () => {
    listSof.mockResolvedValue({ items: [sof()] });
    listDocuments.mockResolvedValue({ documents: [caseDoc()] });
    renderPanel();
    await screen.findByText(/funding documents on file/i);
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    const confirm = await screen.findByRole("button", { name: /reject document/i });
    // Too short — the button stays disabled rather than sending "bad".
    fireEvent.change(screen.getByLabelText(/reason shown to the client/i),
      { target: { value: "bad" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/reason shown to the client/i),
      { target: { value: "The statement is missing the first page." } });
    fireEvent.click(confirm);
    await waitFor(() => expect(reviewDocument).toHaveBeenCalledWith(
      "d1", "rejected", "The statement is missing the first page."));
  });

  it("a document bound to a non-funding requirement stays in Stage 4", async () => {
    listSof.mockResolvedValue({ items: [sof()] });
    listDocuments.mockResolvedValue({ documents: [
      caseDoc({ id: "d9", requirement: { code: "photo_id_primary", label: "Photo ID" } }),
    ] });
    renderPanel();
    await screen.findByText("Salary savings");
    expect(screen.queryByText(/funding documents on file/i)).toBeNull();
  });
});

describe("the next step is always on screen", () => {
  it("documents awaiting review outrank verification", async () => {
    listSof.mockResolvedValue({ items: [sof()] });
    listDocuments.mockResolvedValue({ documents: [caseDoc()] });
    renderPanel();
    expect(await screen.findByText(/review the 1 funding document/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /continue to submission review/i })).toBeNull();
  });

  it("settled offers Continue, and pressing it navigates", async () => {
    listSof.mockResolvedValue({ items: [sof({ verified: true, verified_at: "2026-08-25T00:00:00Z" })] });
    const onContinue = vi.fn();
    render(<FundingEvidencePanel caseId={CASE_ID} canWrite onContinue={onContinue} />);
    fireEvent.click(await screen.findByRole("button", { name: /continue to submission review/i }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("an unreadable document list mutes the documents block, not the panel", async () => {
    listDocuments.mockRejectedValue(new Error("503"));
    listSof.mockResolvedValue({ items: [sof()] });
    renderPanel();
    expect(await screen.findByText(/case documents could not be read/i)).toBeTruthy();
    expect(screen.getByText("Salary savings")).toBeTruthy();
  });
});
