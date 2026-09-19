import { describe, expect, it } from "vitest";

import {
  buildSubmissionRecord,
  formatUtc,
  payloadEntries,
  renderSubmissionRecordHtml,
  submissionRecordFilename,
  valueText,
  verificationOutcomeText,
  type SubmissionRecordInput,
} from "./submissionRecord";

/**
 * The submission record is one structure with three presentations — read on
 * screen, downloaded, stored on the case. What is pinned here: the record
 * repeats the screen's vocabulary exactly, a first submission never carries
 * fabricated differences, and the rendered HTML is inert — everything
 * escaped, nothing that runs, nothing fetched from anywhere.
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
    questionnaire_version: "v2", consent_version: "v2026.2",
    sections: [
      { section: "personal_details", payload: { full_name: "Rugesh Naidu", pep: false, citizenships: ["AU", "ZA"] } },
      { section: "funding", payload: {} },
    ],
    superseded_at: null,
  },
  previous_version: null,
  differences: [],
  consent_evidence: [{ kind: "privacy_notice", version: "v2026.2", accepted_at: "2026-08-16T02:10:00Z", document_hash: "abc123def456abc123def456" }],
  related_parties: [{ declared_name: "A Partner", declared_role: "co_purchaser", change_kind: "new", resolution_status: "resolved" }],
  documents: [{ filename: "passport.jpg", display_name: "Passport", version_number: 1, status: "accepted", client_safe_rejection_reason: null }],
  verification: [
    { party_label: "Rugesh Naidu", check_type: "electronic_idv", status: "passed", execution_mode: "live", provider_error_category: null },
  ],
  screening: [{ screened_name: "Rugesh Naidu", party_type: "primary_subject", state: "completed" }],
  open_requests: [],
  missing_mandatory: [],
  risk: { latest_assessment_at: "2026-08-20T00:00:00Z", stale: false, stale_reasons: [] },
  ...over,
});

const build = (over: Partial<SubmissionRecordInput> = {}) =>
  buildSubmissionRecord(input(over), { generatedAt: "2026-08-26T03:00:00Z", generatedBy: null });

describe("the record carries the whole review, in page order", () => {
  it("orders decision and risk before the evidence sections", () => {
    const keys = build().sections.map((s) => s.key);
    expect(keys).toEqual([
      "decision", "risk", "differences", "consent", "answers",
      "parties", "documents", "verification", "screening", "requests",
    ]);
  });

  it("names what is absent instead of omitting the section", () => {
    const record = build({ open_requests: [], screening: [] });
    const screeningSec = record.sections.find((s) => s.key === "screening")!;
    expect(screeningSec.blocks[0].paragraph).toMatch(/no party screening work yet/i);
    const requests = record.sections.find((s) => s.key === "requests")!;
    expect(requests.blocks[0].paragraph).toBe("No open requests.");
  });
});

describe("a first submission never carries fabricated differences", () => {
  it("derives from previous_version, whatever the differences array says", () => {
    // The old server diffs a first submission against an empty snapshot and
    // sends twenty fabricated "changes" — same defence as differencesBadge.
    const record = build({
      previous_version: null,
      differences: new Array(20).fill({ section: "personal_details", field: "x", previous: null, current: "y" }),
    });
    const diffSec = record.sections.find((s) => s.key === "differences")!;
    expect(diffSec.blocks[0].paragraph).toMatch(/first submission/i);
    expect(diffSec.blocks[0].table).toBeUndefined();
  });

  it("tables real differences when a previous version exists", () => {
    const record = build({
      previous_version: { version_number: 1 },
      differences: [{ section: "funding", field: "deposit", previous: 50000, current: 80000 }],
    });
    const diffSec = record.sections.find((s) => s.key === "differences")!;
    expect(diffSec.blocks[0].table!.rows).toEqual([["funding", "deposit", "50000", "80000"]]);
  });
});

describe("the screen's vocabulary is preserved, never paraphrased", () => {
  it("a simulation is never an outcome", () => {
    expect(verificationOutcomeText({ status: "passed", execution_mode: "simulation", provider_error_category: null }))
      .toBe("Test simulation — not compliance evidence");
  });

  it("a provider error never consumed the attempt", () => {
    expect(verificationOutcomeText({ status: "failed", execution_mode: "live", provider_error_category: "provider_unreachable" }))
      .toBe("provider unreachable — attempt not consumed");
  });

  it("a live outcome is its status, verbatim", () => {
    expect(verificationOutcomeText({ status: "passed", execution_mode: "live", provider_error_category: null }))
      .toBe("passed");
  });

  it("the rendered record carries the simulation wording through to the file", () => {
    const html = renderSubmissionRecordHtml(build({
      verification: [{ party_label: "X", check_type: "electronic_idv", status: "passed", execution_mode: "simulation", provider_error_category: null }],
    }));
    expect(html).toContain("Test simulation — not compliance evidence");
    expect(html).not.toMatch(/<td>passed<\/td>/);
  });
});

describe("the rendered HTML is inert", () => {
  it("escapes every interpolated string", () => {
    const html = renderSubmissionRecordHtml(build({
      case: {
        reference: "AML-2026-00005", subject: '<script>alert("x")</script>',
        case_stage: null, client_portal_status: null, service_gate_status: null,
      },
    }));
    expect(html).not.toContain('<script>alert');
    expect(html).toContain("&lt;script&gt;");
  });

  it("contains no script, no image, no link, no external URL", () => {
    const html = renderSubmissionRecordHtml(build());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<a\s/i);
    expect(html).not.toMatch(/src=/i);
    expect(html).not.toMatch(/href=/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/@import|url\(/i);
  });

  it("carries its own print stylesheet and the staff-only notice", () => {
    const html = renderSubmissionRecordHtml(build());
    expect(html).toContain("@media print");
    expect(html).toMatch(/internal to the reporting\s*entity/i);
    expect(html).toMatch(/must not be provided to the client/i);
  });
});

describe("timestamps are locale-independent and named UTC", () => {
  it("formats one instant one way, wherever it renders", () => {
    expect(formatUtc("2026-08-16T02:59:52Z")).toBe("16 Aug 2026, 02:59 UTC");
    expect(formatUtc(null)).toBe("—");
    expect(formatUtc("not-a-date")).toBe("—");
  });
});

describe("questionnaire flattening is the shared rule", () => {
  it("labels, joins arrays, spells booleans, and never emits raw JSON", () => {
    expect(payloadEntries({ full_name: "A", pep: false, citizenships: ["AU", "ZA"] })).toEqual([
      { label: "full name", value: "A" },
      { label: "pep", value: "No" },
      { label: "citizenships", value: "AU, ZA" },
    ]);
    expect(payloadEntries(null)).toEqual([]);
    expect(payloadEntries([1, 2])).toEqual([]);
  });

  it("valueText renders empties as a dash, never as 'undefined'", () => {
    expect(valueText(undefined)).toBe("—");
    expect(valueText("")).toBe("—");
    expect(valueText({ a: null })).toBe("a: —");
  });
});

describe("a document is named for the reader", () => {
  it("falls back display name → requirement label → filename", () => {
    const record = build({
      requirements: [{ id: "req1", code: "identity_document", label: "Identity document" }],
      documents: [
        { filename: "17868164409098814737826021437062.jpg", display_name: null, requirement_id: "req1", version_number: 1, status: "accepted", client_safe_rejection_reason: null },
        { filename: "b.jpg", display_name: "Chosen name", requirement_id: "req1", version_number: 1, status: "accepted", client_safe_rejection_reason: null },
        { filename: "c.jpg", display_name: null, requirement_id: null, version_number: 1, status: "uploaded", client_safe_rejection_reason: null },
      ],
    });
    const rows = record.sections.find((s) => s.key === "documents")!.blocks[0].table!.rows;
    // The requirement's label is what the client was shown when asked for
    // the file; a 32-digit camera filename identifies nothing on a page.
    expect(rows[0][0]).toBe("Identity document");
    expect(rows[1][0]).toBe("Chosen name");
    expect(rows[2][0]).toBe("c.jpg");
  });

  it("the consent hash is carried in full, never a prefix", () => {
    const hash = "a".repeat(64);
    const record = build({
      consent_evidence: [{ kind: "privacy_notice", version: "1", accepted_at: "2026-08-16T02:10:00Z", document_hash: hash }],
    });
    const rows = record.sections.find((s) => s.key === "consent")!.blocks[0].table!.rows;
    expect(rows[0][3]).toBe(hash);
  });
});

describe("the filename is derived and safe", () => {
  it("keeps the reference and version, drops anything unsafe", () => {
    expect(submissionRecordFilename("AML-2026-00005", 2)).toBe("AML-2026-00005-submission-v2-record.html");
    expect(submissionRecordFilename("../..//etc", 1)).toBe("etc-submission-v1-record.html");
    expect(submissionRecordFilename("///", 1)).toBe("case-submission-v1-record.html");
  });

  it("names the client copy as what it is", () => {
    expect(submissionRecordFilename("AML-2026-00005", 2, "client"))
      .toBe("AML-2026-00005-submission-v2-client-copy.html");
  });
});

describe("the client copy structurally excludes internal readings", () => {
  // The fixture plants unmistakable internal vocabulary in the internal-only
  // fields, then asserts none of it can appear ANYWHERE in the client
  // record — the exclusion is structural, so no renderer can leak it.
  const clientRecord = () => buildSubmissionRecord(input({
    screening: [{ screened_name: "Sensitive Party", party_type: "beneficial_owner", state: "confirmed_match" }],
    risk: { latest_assessment_at: "2026-08-20T00:00:00Z", stale: true, stale_reasons: ["screening_adjudicated"] },
    missing_mandatory: ["screening:Sensitive Party"],
    submission: { ...input().submission, review_reason: "internal reviewer reasoning" },
  }), { generatedAt: "2026-08-26T03:00:00Z", generatedBy: null, audience: "client" });

  it("never builds the screening or risk sections", () => {
    const keys = clientRecord().sections.map((sec) => sec.key);
    expect(keys).toEqual(["decision", "differences", "consent", "answers", "parties", "documents", "verification", "requests"]);
  });

  it("no internal vocabulary survives anywhere in the structure or its HTML", () => {
    const record = clientRecord();
    const everything = JSON.stringify(record) + renderSubmissionRecordHtml(record);
    expect(everything).not.toContain("Sensitive Party");
    expect(everything).not.toContain("confirmed match");
    expect(everything).not.toMatch(/screening/i);
    expect(everything).not.toMatch(/risk/i);
    expect(everything).not.toMatch(/service gate/i);
    expect(everything).not.toContain("internal reviewer reasoning");
    expect(everything).not.toContain("case stage");
  });

  it("related parties keep the declaration, not the reconciliation workflow", () => {
    const record = buildSubmissionRecord(input({
      related_parties: [{ declared_name: "A Partner", declared_role: "co_purchaser", change_kind: "new", resolution_status: "open" }],
    }), { generatedAt: "2026-08-26T03:00:00Z", audience: "client" });
    const table = record.sections.find((sec) => sec.key === "parties")!.blocks[0].table!;
    expect(table.columns).toEqual(["Name", "Role"]);
    expect(table.rows).toEqual([["A Partner", "co purchaser"]]);
  });

  it("each audience carries its own notice, and says so in the file", () => {
    const internal = build();
    const client = clientRecord();
    expect(internal.notice).toMatch(/must not be provided to the client/);
    expect(client.notice).toMatch(/not part of this document/);
    expect(renderSubmissionRecordHtml(client)).toContain("Client submission copy");
    expect(client.filename).toBe("AML-2026-00005-submission-v1-client-copy.html");
  });

  it("the internal record is unchanged by the audience feature", () => {
    const record = build();
    expect(record.audience).toBe("internal");
    expect(record.sections.map((sec) => sec.key)).toContain("screening");
    expect(record.sections.map((sec) => sec.key)).toContain("risk");
  });

  it("is written for a lay reader, not the review screen", () => {
    const record = clientRecord();
    const decision = record.sections.find((sec) => sec.key === "decision")!.blocks[0].fields!;
    const labels = decision.map((f) => f.label);
    // "Review status" beside a bare "Status" read as a contradiction; and an
    // em dash for "not reviewed yet" reads as a field somebody forgot.
    expect(labels).toContain("Submission status");
    expect(labels).toContain("Case status");
    expect(decision.find((f) => f.label === "Reviewed")!.value).toBe("Not yet reviewed");
  });

  it("carries no evidence hashes, no internal column names, no staff email", () => {
    const record = buildSubmissionRecord(input(), {
      generatedAt: "2026-08-26T03:00:00Z",
      generatedBy: "a.reviewer@npcservices.com.au",
      audience: "client",
    });
    const consent = record.sections.find((sec) => sec.key === "consent")!.blocks[0].table!;
    expect(consent.columns).toEqual(["Consent", "Version", "Accepted"]);
    const documents = record.sections.find((sec) => sec.key === "documents")!.blocks[0].table!;
    expect(documents.columns[3]).toBe("Note");
    // Structural: no renderer can print what the record does not hold.
    expect(record.generatedBy).toBeNull();
    expect(renderSubmissionRecordHtml(record)).not.toContain("a.reviewer@npcservices.com.au");
  });
});
