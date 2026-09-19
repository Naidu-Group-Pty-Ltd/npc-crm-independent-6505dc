import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildSubmissionRecord, type SubmissionRecordInput } from "./submissionRecord";
import { generateSubmissionRecordPdf, submissionRecordPdfFilename } from "./submissionRecordPdf";
import { resolveRecordBrand, type RecordBrand } from "./submissionRecordBrand";

/**
 * The PDF is a PRESENTATION of the record structure, never a second source —
 * so what these tests pin is that it really is a PDF (parsed back with
 * pdf-lib, not sniffed), that it paginates instead of clipping, and that the
 * filename follows the record's own rule with only the extension changed.
 */

const input = (over: Partial<SubmissionRecordInput> = {}): SubmissionRecordInput => ({
  case: {
    reference: "AML-2026-00005", subject: "Rugesh Naidu",
    case_stage: "client_submitted", client_portal_status: "in_progress",
    service_gate_status: "terminated",
  },
  submission: {
    version_number: 1, review_status: "submitted", submitted_at: "2026-08-16T02:59:52Z",
    submitted_by_type: "client", review_reason: null, reviewed_at: null,
    questionnaire_version: "2", consent_version: "2026.2",
    sections: [
      { section: "personal_details", payload: { full_name: "Rugesh Naidu", dob: "1993-12-10", occupation: "Property Consultant & Director" } },
      { section: "funding", payload: { deposit: 200000, sources: ["Salary savings", "Loan / mortgage"], institutions: "Cba" } },
    ],
    superseded_at: null,
  },
  previous_version: null,
  differences: [],
  consent_evidence: [
    // A SHA-256-length hash: exercises the Courier hex-literal path and the
    // wrap-instead-of-truncate rule in the same render the sample ships.
    { kind: "privacy_notice", version: "2026.2", accepted_at: "2026-08-15T16:51:00Z", document_hash: "25b27d80c97dc12a4e61d421acfdee0025b27d80c97dc12a4e61d421acfdee00" },
    { kind: "record_keeping", version: "2026.2", accepted_at: "2026-08-15T16:53:00Z", document_hash: "2734e2871f7a0447aa00000000000000" },
  ],
  related_parties: [],
  requirements: [{ id: "req1", code: "identity_document", label: "Identity document" }],
  documents: [
    { filename: "17868164409098814737826021437062.jpg", display_name: null, requirement_id: "req1", version_number: 1, status: "accepted", client_safe_rejection_reason: null },
  ],
  verification: [
    { party_label: "Rugesh Naidu", check_type: "electronic_idv", status: "passed", execution_mode: "live", provider_error_category: null },
  ],
  screening: [{ screened_name: "Rugesh Naidu", party_type: "primary_subject", state: "completed" }],
  open_requests: [],
  missing_mandatory: [],
  risk: { latest_assessment_at: null, stale: true, stale_reasons: ["no_assessment"] },
  ...over,
});

const record = (over: Partial<SubmissionRecordInput> = {}) =>
  buildSubmissionRecord(input(over), { generatedAt: "2026-08-26T03:48:00Z", generatedBy: null });

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("the record renders as a real PDF", () => {
  it("produces a parseable A4 document", async () => {
    const bytes = await blobBytes(await generateSubmissionRecordPdf(record()));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    const { width, height } = parsed.getPage(0).getSize();
    // A4 in PDF points, within a point of rounding.
    expect(Math.round(width)).toBeGreaterThanOrEqual(594);
    expect(Math.round(width)).toBeLessThanOrEqual(596);
    expect(Math.round(height)).toBeGreaterThanOrEqual(841);
    expect(Math.round(height)).toBeLessThanOrEqual(843);
    if (process.env.RECORD_PDF_OUT) writeFileSync(process.env.RECORD_PDF_OUT, bytes);
  });

  it("paginates a long submission instead of clipping it", async () => {
    // 90 questionnaire fields and 60 screening rows must flow onto further
    // pages — a declared height a record outgrows must never print over the
    // footer or vanish off the sheet.
    const bigPayload: Record<string, string> = {};
    for (let i = 0; i < 90; i++) bigPayload[`field_${i}`] = `A reasonably long answer number ${i} that wraps across the value column.`;
    const bytes = await blobBytes(await generateSubmissionRecordPdf(record({
      submission: {
        ...input().submission,
        sections: [{ section: "everything", payload: bigPayload }],
      },
      screening: Array.from({ length: 60 }, (_, i) => ({
        screened_name: `Related Party Number ${i}`, party_type: "beneficial_owner", state: "completed",
      })),
    })));
    const { PDFDocument } = await import("pdf-lib");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(3);
  });

  it("renders every section of an empty-ish review without throwing", async () => {
    const bytes = await blobBytes(await generateSubmissionRecordPdf(record({
      consent_evidence: [], documents: [], verification: [], screening: [],
      submission: { ...input().submission, sections: [] },
    })));
    const { PDFDocument } = await import("pdf-lib");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe("the filename is the record's own rule, extension swapped", () => {
  it("swaps .html for .pdf and changes nothing else", () => {
    expect(submissionRecordPdfFilename(record())).toBe("AML-2026-00005-submission-v1-record.pdf");
  });
});

describe("the branded document", () => {
  // The real fallback identity, from the real resolver — the render under
  // test is exactly the one an unbranded workspace produces.
  const testBrand = (over: Partial<RecordBrand> = {}): RecordBrand => ({
    ...resolveRecordBrand({ companyName: "", brandColor: null }),
    ...over,
  });

  it("renders both audiences under a brand as parseable documents", async () => {
    const { PDFDocument } = await import("pdf-lib");
    // The real Aurixa delta emblem, embedded from its real bytes — the
    // addImage path runs against the actual asset, not a stub.
    const emblem = "data:image/png;base64,"
      + readFileSync(join(__dirname, "../../../public/brand/aurixa-emblem-240.png")).toString("base64");
    for (const audience of ["internal", "client"] as const) {
      const rec = buildSubmissionRecord(input(), {
        generatedAt: "2026-08-26T03:48:00Z", generatedBy: "a.reviewer@npcservices.com.au", audience,
      });
      const bytes = await blobBytes(await generateSubmissionRecordPdf(rec, testBrand({ logoDataUrl: emblem })));
      const parsed = await PDFDocument.load(bytes);
      expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
      if (process.env.RECORD_PDF_OUT) {
        writeFileSync(process.env.RECORD_PDF_OUT.replace(/\.pdf$/, `-${audience}-branded.pdf`), bytes);
      }
    }
  });

  it("an undrawable logo degrades to the wordmark instead of failing the download", async () => {
    const rec = record();
    const bytes = await blobBytes(await generateSubmissionRecordPdf(
      rec, testBrand({ logoDataUrl: "data:image/png;base64,not-actually-a-png" })));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
