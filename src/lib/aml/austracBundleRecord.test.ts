/**
 * The AUSTRAC bundle as a document — what it says, and what it must never
 * leave out.
 */
import { describe, it, expect } from "vitest";
import {
  austracBundleFilename, austracBundleIdentity, buildAustracBundleRecord,
  type AustracBundle,
} from "./austracBundleRecord.pure";
import { resolveRecordBrand, AURIXA_FALLBACK_NAME } from "./submissionRecordBrand";

const NOW = new Date("2026-08-30T05:00:00.000Z");

const bundle = (over: Partial<AustracBundle["report"]> = {}, rest: Partial<AustracBundle> = {}): AustracBundle => ({
  report: {
    id: "5bb2c2dc-b556-4148-8549-6bbcee72a581",
    kind: "smr",
    case_id: "8b668f2f-0132-436f-b32c-d6709ea69526",
    reference_code: "1234567",
    title: "Unexplained third-party funds",
    status: "draft",
    narrative: "Funds arrived from a third party with no explained connection to the buyer.",
    reporting_period_start: null,
    reporting_period_end: null,
    mlro_signed_at: null,
    submitted_at: null,
    acknowledged_at: null,
    metadata: { obligation_at: "2026-08-27T09:00:00.000Z", terrorism_financing: false },
    created_at: "2026-08-30T07:28:37.000Z",
    updated_at: "2026-08-30T07:28:37.000Z",
    ...over,
  },
  versions: [{ version: 1, author_label: "R Naidu", change_note: "Draft created", created_at: "2026-08-30T07:28:37.000Z", content_hash: "abc123def4567890aa" }],
  submissions: [],
  exported_at: "2026-08-30T05:00:00.000Z",
  exported_by: "R Naidu",
  ...rest,
});

const build = (b = bundle()) => buildAustracBundleRecord({
  bundle: b, contentHash: "f".repeat(64),
  subjectLabel: "Rugesh Naidu", caseReference: "AML-2026-00005",
  issuedBy: "Aurixa Systems", now: NOW,
});

const allText = (r: ReturnType<typeof build>) =>
  JSON.stringify([r.headerFields, r.sections, r.notice, r.subject]);

describe("the document says what it is", () => {
  it("names the obligation, the customer and the deadline", () => {
    const text = allText(build());
    expect(text).toContain("Suspicious Matter Report");
    expect(text).toContain("AML/CTF Act 2006 (Cth) s.41");
    expect(text).toContain("Rugesh Naidu");
    expect(text).toContain("AML-2026-00005");
    // 27 August 2026 is a Thursday; three business days is Tuesday 1 September.
    expect(text).toContain("1 Sep 2026");
  });

  it("carries the narrative in full", () => {
    expect(allText(build())).toContain("no explained connection to the buyer");
  });

  it("says the platform never lodges, when nothing has been lodged", () => {
    const lodgement = build().sections.find((s) => s.key === "lodgement");
    expect(JSON.stringify(lodgement)).toMatch(/holds no AUSTRAC credentials/i);
  });

  it("carries the server's hash rather than computing one of its own", () => {
    expect(allText(build())).toContain("f".repeat(64));
  });

  it("never renders a database identifier as a label", () => {
    /* `awaiting_mlro` is vocabulary the schema uses and an operator does
       not. A test in the Passport register pins the same rule. */
    const b = bundle({ status: "awaiting_mlro" });
    const rendered = JSON.stringify([build(b).headerFields, build(b).sections.map((s) => s.blocks)]);
    expect(rendered).not.toMatch(/awaiting_mlro/);
    expect(rendered).toContain("Awaiting mlro");
  });
});

describe("tipping off travels with the document", () => {
  /* The rule is that the prohibition is ON the page — not that it sits in
     any particular field. It moved out of the closing colophon and into a
     leading section, and this asserts the rule rather than the location. */
  const rendered = (r: ReturnType<typeof build>) => JSON.stringify([r.sections, r.notice]);

  it("warns on a suspicious matter report", () => {
    /* This document is printable, e-mailable and leaveable on a desk. */
    expect(rendered(build())).toMatch(/s\.123/);
    expect(rendered(build())).toMatch(/Do not provide this document to the customer/i);
  });

  it("puts the restriction before the report rather than after it", () => {
    /* By the time a reader reaches the foot of the last page they may have
       already forwarded it. */
    const keys = build().sections.map((s) => s.key);
    expect(keys[0]).toBe("handling");
  });

  it("states the offence once", () => {
    /* A prohibition printed twice is one an operator learns to skim. */
    const hits = rendered(build()).match(/s\.123/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("does not warn on a threshold transaction report", () => {
    /* s.123 attaches to the suspicious matter alone. Carrying it everywhere
       is how an operator learns to read past it. */
    const ttr = build(bundle({ kind: "ttr" }));
    expect(rendered(ttr)).not.toMatch(/s\.123/);
    expect(ttr.sections.some((s) => s.key === "handling")).toBe(false);
  });
});

describe("the identity and the filename", () => {
  it("calls itself an AUSTRAC record, not a submission", () => {
    /* The shared renderer used to write "Submission v1" across every
       document it drew, which is wrong for a report that is not a
       submission and has no submission version. */
    const record = build();
    const identity = austracBundleIdentity(record, { kind: "smr" });
    expect(identity.title).toBe("AUSTRAC report record");
    expect(identity.identityLine).toContain("Suspicious Matter Report");
    expect(identity.identityLine).not.toMatch(/Submission v/);
    expect(identity.footLine).not.toMatch(/Submission v/);
  });

  it("names the file by the customer's reference, not a uuid", () => {
    expect(austracBundleFilename({ id: "uuid-x", kind: "smr" }, "AML-2026-00005"))
      .toBe("austrac-smr-AML-2026-00005.html");
    // No case linked: the report id is all there is, and it still downloads.
    expect(austracBundleFilename({ id: "uuid-x", kind: "ttr" }, null))
      .toBe("austrac-ttr-uuid-x.html");
  });
});

describe("white labelling", () => {
  it("falls back to Aurixa Systems when the workspace has no brand", () => {
    const brand = resolveRecordBrand({ companyName: "Dashboard", brandColor: null } as never);
    expect(brand.name).toBe(AURIXA_FALLBACK_NAME);
    expect(brand.tenantBranded).toBe(false);
    expect(allText(build())).toContain("Aurixa Systems");
  });

  it("issues under the workspace's own name when it has one", () => {
    const brand = resolveRecordBrand({
      companyName: "Naidu Property Consulting Services", brandColor: null,
    } as never);
    expect(brand.name).toBe("Naidu Property Consulting Services");
    expect(brand.tenantBranded).toBe(true);
    const record = buildAustracBundleRecord({
      bundle: bundle(), contentHash: "x", subjectLabel: null, caseReference: null,
      issuedBy: brand.name, now: NOW,
    });
    expect(allText(record)).toContain("Naidu Property Consulting Services");
  });
});

describe("it survives a thin bundle", () => {
  it("renders with no versions, no submissions and no narrative", () => {
    const thin = bundle({ narrative: null, title: null, metadata: {} }, { versions: [], submissions: [] });
    const record = build(thin);
    expect(record.sections.length).toBeGreaterThan(3);
    expect(allText(record)).toContain("No narrative was recorded");
    expect(allText(record)).toContain("No versions have been recorded");
  });

  it("does not throw on a kind the obligation table cannot place", () => {
    /* `reports.kind` accepts five values and the table is keyed by four. */
    const record = build(bundle({ kind: "annual" }));
    expect(record.subject).toBeTruthy();
    expect(austracBundleIdentity(record, { kind: "annual" }).title).toBe("AUSTRAC report record");
  });
});

describe("it explains the obligation before it states the facts", () => {
  /* A reader who has not met a Threshold Transaction Report before used to
     learn its label and nothing else. Every party who picks this up — the
     MLRO, an auditor, an independent reviewer, a regulator asking to see
     the file — is told what the report is for and what obliges it. */
  it("states what the report is for and what requires it", () => {
    const section = build().sections.find((s) => s.key === "obligation");
    const text = JSON.stringify(section);
    expect(text).toMatch(/reasonable grounds/i);
    expect(text).toContain("AML/CTF Act 2006 (Cth) s.41");
    expect(text).toContain("3 business days");
    expect(text).toContain("the day the suspicion was formed");
  });

  it("names the tighter window when the suspicion concerns terrorism financing", () => {
    const b = bundle({ metadata: { obligation_at: "2026-08-27T09:00:00.000Z", terrorism_financing: true } });
    expect(JSON.stringify(build(b).sections.find((s) => s.key === "obligation")))
      .toContain("24 hours");
  });

  it("says the report is due and it is required, on a report with no clock", () => {
    /* The annual compliance report carries no per-report deadline; a
       sentence promising "due within null business days" is worse than the
       one this writes instead. */
    const text = JSON.stringify(build(bundle({ kind: "compliance_report" })).sections);
    expect(text).toContain("AML/CTF Act 2006 (Cth) s.47");
    expect(text).not.toMatch(/null business days/);
  });
});

describe("the compliance perspective is on the page", () => {
  it("lists what was owed before lodgement, and where each item stood", () => {
    const checks = build().sections.find((s) => s.key === "checks");
    const text = JSON.stringify(checks);
    expect(checks?.title).toBe("Pre-lodgement checks");
    expect(text).toContain("MLRO approval");
    expect(text).toContain("Lodged at AUSTRAC Online");
    expect(text).toContain("Receipt on file");
    // Vocabulary a reader can act on, never the CheckState enum.
    expect(text).not.toMatch(/"attention"|"blocked"|"ready"|"done"/);
  });

  it("names who approved it, under a heading of its own", () => {
    /* The MLRO decision used to appear only as a version-table note reading
       "MLRO sign-off". It is what authorises lodgement. */
    const signed = bundle({ mlro_signed_at: "2026-08-30T08:39:00.000Z", status: "approved" }, {
      versions: [
        { version: 1, author_label: "R Naidu", change_note: "Draft created", created_at: "2026-08-30T07:28:37.000Z" },
        {
          version: 2, author_label: "M Officer", change_note: "MLRO sign-off",
          created_at: "2026-08-30T08:39:00.000Z", snapshot: { snapshot: "mlro_signoff" },
        },
      ],
    });
    const approval = build(signed).sections.find((s) => s.key === "approval");
    expect(JSON.stringify(approval)).toContain("M Officer");
    expect(JSON.stringify(approval)).toContain("30 Aug 2026");
  });

  it("says so plainly when nobody has approved it", () => {
    expect(JSON.stringify(build().sections.find((s) => s.key === "approval")))
      .toMatch(/has not been approved/i);
  });

  it("never calls a late lodgement a deadline that was met", () => {
    /* `submitted_at` alone is not evidence of timeliness, and this is the
       one document in the file that would be saying so. */
    const late = bundle({
      submitted_at: "2026-09-30T00:00:00.000Z",
      metadata: { obligation_at: "2026-08-27T09:00:00.000Z" },
    });
    const text = JSON.stringify(build(late).sections.find((s) => s.key === "report"));
    expect(text).toMatch(/Lodged after the window closed/);
    expect(text).not.toMatch(/Met —/);
  });

  it("calls an on-time lodgement met", () => {
    const ontime = bundle({
      submitted_at: "2026-08-31T00:00:00.000Z",
      metadata: { obligation_at: "2026-08-27T09:00:00.000Z" },
    });
    expect(JSON.stringify(build(ontime).sections.find((s) => s.key === "report")))
      .toMatch(/Met — lodged within the window/);
  });
});

describe("the plumbing is out of the reader's way", () => {
  it("keeps the row's uuid out of the body of the document", () => {
    /* A database key means nothing to any party this document is for, and
       it led the section a reader reaches last. The document already
       carries the two references a person uses. */
    const record = build();
    expect(JSON.stringify([record.headerFields, record.sections]))
      .not.toContain("5bb2c2dc-b556-4148-8549-6bbcee72a581");
  });

  it("keeps it findable, in the running foot", () => {
    /* Out of the body is not out of the document: a re-export, a support
       request or "which record is this printout" all need it. */
    const record = build();
    const identity = austracBundleIdentity(record, { kind: "smr", id: "5bb2c2dc-b556-4148-8549-6bbcee72a581" });
    expect(identity.footLine).toContain("doc 5bb2c2dc");
    // Not in the identity line under the title, where the reference belongs.
    expect(identity.identityLine).not.toMatch(/doc /);
  });

  it("carries the hash in full, after the sentence that says what it is for", () => {
    /* Truncating a hash destroys the only thing it is for, so it stays
       whole — demoted below an explanation rather than led with. */
    const integrity = build().sections.find((s) => s.key === "integrity");
    expect(JSON.stringify(integrity)).toContain("f".repeat(64));
    const blocks = integrity?.blocks ?? [];
    const hashAt = blocks.findIndex((b) => JSON.stringify(b).includes("f".repeat(64)));
    const proseAt = blocks.findIndex((b) => "paragraph" in b);
    expect(hashAt).toBeGreaterThan(proseAt);
  });

  it("states how long the record has to be kept", () => {
    expect(JSON.stringify(build().sections)).toContain("s.107");
  });

  it("omits a field it has nothing to say in, rather than printing a dash", () => {
    /* "YOUR REFERENCE —" and "REPORTING PERIOD —" were two of eleven rows
       on the first page and neither carried a fact. */
    const b = bundle({ reference_code: null, reporting_period_start: null, reporting_period_end: null });
    const report = build(b).sections.find((s) => s.key === "report");
    const fields = report?.blocks[0].fields ?? [];
    expect(fields.some((f) => f.label === "Entity's own reference")).toBe(false);
    expect(fields.some((f) => f.label === "Reporting period")).toBe(false);
    expect(fields.every((f) => f.value.trim() !== "\u2014")).toBe(true);
  });
});
