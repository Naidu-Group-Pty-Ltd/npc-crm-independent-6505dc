/**
 * The AUSTRAC bundle as a document somebody can actually keep.
 *
 * ── What "Bundle" used to do ──────────────────────────────────────────
 * It downloaded the edge function's JSON response, `JSON.stringify`d with
 * two-space indentation, as `austrac-smr-<uuid>.json`. It opened in a text
 * editor. It carried no identity, no branding, no statement of what it was,
 * and nothing an auditor, a colleague or a regulator's file could use — the
 * archive record for a report to a regulator was a developer artefact.
 *
 * This turns the same bundle into the same kind of document every other
 * white-labelled export in this product produces, and it does it by
 * projecting onto `SubmissionRecord` — the structure the submission-record
 * download already renders. There is no second PDF generator, no second
 * masthead, no second brand resolver: `generateSubmissionRecordPdf` draws
 * this, under the workspace's own brand or the Aurixa Systems fallback.
 *
 * ── Nothing here is a second source ───────────────────────────────────
 * Every value comes from the bundle the SERVER assembled and hashed. This
 * module formats; it does not read the database, does not recompute a
 * deadline the report did not carry, and cannot state anything the export
 * did not contain.
 */
import {
  formatUtc, type RecordField, type RecordSection, type SubmissionRecord,
} from "@/lib/aml/submissionRecord";
import type { RecordDocumentIdentity } from "@/lib/aml/submissionRecordPdf";
import {
  AUSTRAC_OBLIGATIONS, TERRORISM_FINANCING_HOURS, austracReadiness, lodgementClock,
} from "@/lib/aml/austracReportPath.pure";
import {
  AUSTRAC_KIND_LABEL, KIND_GUIDANCE, toObligationKind,
} from "@/lib/aml/austracDraftGuidance.pure";

export interface BundleReport {
  id: string;
  kind: string;
  case_id: string | null;
  reference_code: string | null;
  title: string | null;
  status: string;
  narrative: string | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  mlro_signed_at: string | null;
  submitted_at: string | null;
  acknowledged_at: string | null;
  metadata?: unknown;
  created_at: string | null;
  updated_at: string | null;
}

export interface BundleVersion {
  version: number;
  author_label?: string | null;
  change_note?: string | null;
  created_at?: string | null;
  content_hash?: string | null;
  /**
   * `mlro_signoff` writes `{ snapshot: "mlro_signoff", ... }` here, which is
   * the only place the record says WHO approved the report — `reports`
   * carries `mlro_signed_by` as an id and no label. Reading it is following
   * a link the server writes, not inferring one from a note somebody typed.
   */
  snapshot?: unknown;
}

export interface BundleReceipt {
  receipt_reference?: string | null;
  status?: string | null;
  received_at?: string | null;
  created_at?: string | null;
}

export interface BundleSubmission {
  channel?: string | null;
  external_reference?: string | null;
  export_bundle_path?: string | null;
  submitted_at?: string | null;
  submitted_by_label?: string | null;
  status?: string | null;
  evidence_source?: string | null;
  receipts?: BundleReceipt[] | null;
}

export interface AustracBundle {
  report: BundleReport;
  versions?: BundleVersion[] | null;
  submissions?: BundleSubmission[] | null;
  exported_at?: string | null;
  exported_by?: string | null;
}

/** A field, kept only when it has something to say. */
function field(label: string, value: string | null | undefined): RecordField[] {
  const t = (value ?? "").toString().trim();
  return t.length > 0 && t !== "\u2014" ? [{ label, value: t }] : [];
}

const dash = (v: string | null | undefined) => {
  const t = (v ?? "").toString().trim();
  return t.length > 0 ? t : "—";
};

/** Database vocabulary never reaches the page: `awaiting_mlro` → "Awaiting mlro". */
function readable(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  if (!t) return "—";
  const words = t.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The archive document for one AUSTRAC report.
 *
 * `subjectLabel` and `caseReference` are passed in rather than read: the
 * bundle carries `case_id` and nothing else about the customer, and a
 * document that named a customer this export did not identify would be
 * asserting a link nobody recorded.
 */
export function buildAustracBundleRecord(args: {
  bundle: AustracBundle;
  /** The hash the server computed over the bundle it returned. */
  contentHash: string;
  subjectLabel: string | null;
  caseReference: string | null;
  /** Who the document is issued by — the white-label identity. */
  issuedBy: string;
  generatedBy?: string | null;
  now?: Date;
}): SubmissionRecord {
  const { bundle, contentHash, subjectLabel, caseReference, issuedBy } = args;
  const r = bundle.report;
  const kind = toObligationKind(r.kind);
  const obligation = kind ? AUSTRAC_OBLIGATIONS[kind] : null;
  const meta = (r.metadata as Record<string, unknown> | undefined) ?? {};
  const obligationAt = meta.obligation_at ? String(meta.obligation_at) : null;
  const terrorismFinancing = meta.terrorism_financing === true;

  const clock = kind
    ? lodgementClock({ kind, obligationAt, terrorismFinancing, now: args.now })
    : null;

  const headerFields: RecordField[] = [
    { label: "Obligation", value: AUSTRAC_KIND_LABEL[r.kind as keyof typeof AUSTRAC_KIND_LABEL] ?? readable(r.kind) },
    { label: "Status", value: readable(r.status) },
    { label: "Customer", value: dash(subjectLabel ?? caseReference) },
  ];

  const lodgedLate = r.submitted_at && clock?.dueAt
    ? new Date(r.submitted_at).getTime() > new Date(clock.dueAt).getTime()
    : false;

  const versions = bundle.versions ?? [];

  const sections: RecordSection[] = [];

  /*
    ── The prohibition a reader must meet BEFORE they act ───────────────
    s.123 makes it an offence to disclose that a suspicious matter report
    has been made. It travelled only in the closing notice — 8.5pt grey, at
    the foot of the last page, below a centimetre of white space. A
    restriction on what somebody may do with a document is not a colophon:
    it is the first thing they need, because by the time they reach the
    bottom of page two they may already have forwarded it.

    It is stated ONCE. The closing notice keeps the "this is a record, not
    the lodgement" statement and no longer repeats the offence, because a
    prohibition printed twice is one an operator learns to skim.
  */
  if (kind === "smr") {
    sections.push({
      key: "handling",
      title: "Handling restriction",
      blocks: [{
        paragraph: "Disclosing to the customer, or to anyone else, that this report has been made "
          + "or considered — or that the information behind it has been given to AUSTRAC — is an "
          + "offence under s.123 of the AML/CTF Act 2006 (Cth). Do not provide this document to "
          + "the customer. Inside the reporting entity, share it only with those who need it.",
      }],
    });
  }

  /*
    ── What this report is, before what it says ────────────────────────
    The document opened on a field list. A reader who has not met a
    Threshold Transaction Report before learned the label and nothing else —
    not what obliges it, not what the threshold is, not what the clock is
    counted from. This states the obligation in one paragraph, from
    `AUSTRAC_OBLIGATIONS` and `KIND_GUIDANCE`, so the record explains itself
    to whoever picks it up: the MLRO, an auditor, an independent reviewer,
    or a regulator asking to see the file.
  */
  if (obligation && kind) {
    const g = KIND_GUIDANCE[kind];
    sections.push({
      key: "obligation",
      title: "The obligation",
      blocks: [
        /* `obligation.purpose` and `g.why` are two statements of the same
           thing — the TTR record opened by saying "Physical currency of
           A$10,000 or more moved as part of a designated service" twice in
           consecutive sentences. `why` is the fuller of the two. */
        { paragraph: g.why },
        {
          paragraph: obligation.businessDays === null
            ? `It is required by ${obligation.basis}.`
            : `It is required by ${obligation.basis}, and is due within `
              + `${obligation.businessDays} business days of ${obligation.clockStarts}`
              + `${kind === "smr" && terrorismFinancing
                ? ` — tightened to ${TERRORISM_FINANCING_HOURS} hours because the suspicion concerns `
                  + "terrorism financing"
                : ""}.`,
        },
      ],
    });
  }

  sections.push({
    key: "report",
    title: "The report",
    blocks: [{
      fields: [
        { label: "Reporting entity", value: issuedBy },
        { label: "Obligation", value: obligation ? `${obligation.label} — ${obligation.basis}` : readable(r.kind) },
        ...field("Title", r.title),
        ...field("Customer", subjectLabel),
        ...field("Compliance case", caseReference),
        ...field("Entity's own reference", r.reference_code),
        { label: "Status", value: readable(r.status) },
        ...field("Obligation arose", obligationAt ? formatUtc(obligationAt) : null),
        ...(terrorismFinancing
          ? [{ label: "Terrorism financing", value: `Yes — the ${TERRORISM_FINANCING_HOURS}-hour window applies` }]
          : []),
        ...(clock?.dueAt
          ? [
            { label: "Due", value: `${formatUtc(clock.dueAt)} (${clock.window})` },
            /* The standing, not just the date. "Due 17 Sep" tells a reader
               nothing they can act on without also knowing today's date and
               whether it has been lodged. */
            {
              label: "Deadline",
              value: r.submitted_at
                ? lodgedLate
                  /* Never assert "met" from the mere fact of a lodgement.
                     A report lodged a week after the window closed is still
                     lodged, and a record that called that "met" would be
                     the one document in the file saying so. */
                  ? "Lodged after the window closed. The lateness is itself a matter of record."
                  : "Met — lodged within the window."
                : clock.overdue
                  ? "Past the window. The lateness is itself a matter of record: lodge it and "
                    + "record why it was late."
                  : "Within the window.",
            },
          ]
          : []),
        ...field("Reporting period", r.reporting_period_start || r.reporting_period_end
          ? `${formatUtc(r.reporting_period_start)} to ${formatUtc(r.reporting_period_end)}`
          : null),
        { label: "Drafted", value: formatUtc(r.created_at) },
        ...field("Last changed", r.updated_at !== r.created_at ? formatUtc(r.updated_at) : null),
      ],
    }],
  });

  sections.push({
    key: "narrative",
    /* An annual compliance report is about the business's own programme, so
       "What happened" asks it the wrong question. */
    title: kind === "compliance_report" ? "What is reported" : "What happened",
    blocks: [{
      paragraph: (r.narrative ?? "").trim() || "No narrative was recorded on this report.",
    }],
  });

  /*
    ── The compliance perspective, on the page ──────────────────────────
    The same pre-lodgement checks the register shows, rendered from the same
    module. A record that lists what was done without what was owed cannot
    be reviewed: an auditor's first question is not "what does it say" but
    "was anything outstanding when it went".
  */
  if (kind) {
    const checks = austracReadiness({
      kind,
      status: r.status,
      caseId: r.case_id,
      subjectLabel,
      title: r.title,
      narrative: r.narrative,
      periodStart: r.reporting_period_start,
      periodEnd: r.reporting_period_end,
      mlroSignedAt: r.mlro_signed_at,
      submittedAt: r.submitted_at,
      externalReference: (bundle.submissions ?? [])[0]?.external_reference ?? null,
      receiptReference: (bundle.submissions ?? [])[0]?.receipts?.[0]?.receipt_reference
        ?? (r.acknowledged_at ? "recorded" : null),
      obligationAt,
      terrorismFinancing,
    });
    sections.push({
      key: "checks",
      title: "Pre-lodgement checks",
      blocks: [{
        paragraph: "What this report owed before it could be lodged, and where each item stood "
          + "when this record was exported.",
      }, {
        table: {
          columns: ["Check", "Standing", "Detail"],
          rows: checks.map((c) => [
            c.label,
            c.state === "done" ? "Met" : c.state === "blocked" ? "Blocked" : c.state === "ready" ? "Ready" : "Outstanding",
            c.detail,
          ]),
        },
      }],
    });
  }

  /*
    ── Who authorised it ────────────────────────────────────────────────
    The record showed the MLRO decision only as a line in the version table
    reading "MLRO sign-off". The decision that authorises lodgement is the
    single most important fact in an AUSTRAC record and it belongs under a
    heading of its own, with the name of the person who made it.

    `reports.mlro_signed_by` is an id and carries no label, so the approver
    is read from the version row the sign-off itself writes.
    */
  const approvalVersion = versions.find(
    (v) => (v.snapshot as { snapshot?: string } | undefined)?.snapshot === "mlro_signoff",
  );
  sections.push({
    key: "approval",
    title: "MLRO approval",
    blocks: r.mlro_signed_at
      ? [{
        fields: [
          { label: "Approved", value: formatUtc(r.mlro_signed_at) },
          ...field("Approved by", approvalVersion?.author_label),
          {
            label: "Effect",
            value: "The MLRO's decision is what authorises lodgement. Nothing in this platform "
              + "lodges on their behalf.",
          },
        ],
      }]
      : [{
        paragraph: "This report has not been approved. The MLRO's decision is what authorises "
          + "lodgement, and it has not yet been made.",
      }],
  });

  const submissions = bundle.submissions ?? [];
  sections.push({
    key: "lodgement",
    title: "Lodgement",
    blocks: submissions.length
      ? [{
        table: {
          columns: ["Lodged", "Channel", "AUSTRAC reference", "By", "Evidence"],
          rows: submissions.map((sub) => [
            formatUtc(sub.submitted_at),
            readable(sub.channel),
            dash(sub.external_reference),
            dash(sub.submitted_by_label),
            dash(sub.export_bundle_path ? "Export bundle" : readable(sub.evidence_source)),
          ]),
        },
      }]
      : [{
        paragraph: "This report has not been lodged. Lodgement is made in the reporting entity's "
          + "own AUSTRAC Online account; this platform holds no AUSTRAC credentials and submits "
          + "nothing on anybody's behalf.",
      }],
  });

  const receipts = submissions.flatMap((sub) => sub.receipts ?? []);
  if (receipts.length) {
    sections.push({
      key: "receipts",
      title: "AUSTRAC acknowledgement",
      blocks: [{
        table: {
          columns: ["Receipt", "Status", "Received"],
          rows: receipts.map((rc) => [
            dash(rc.receipt_reference),
            readable(rc.status),
            formatUtc(rc.received_at ?? rc.created_at),
          ]),
        },
      }],
    });
  }

  sections.push({
    key: "versions",
    title: "Version history",
    blocks: versions.length
      ? [{
        table: {
          columns: ["Version", "Recorded", "By", "Note", "Content hash"],
          rows: versions.map((v) => [
            `v${v.version}`,
            formatUtc(v.created_at),
            dash(v.author_label),
            dash(v.change_note),
            (v.content_hash ?? "").slice(0, 16) || "—",
          ]),
        },
      }]
      : [{ paragraph: "No versions have been recorded against this report." }],
  });

  /*
    ── Integrity, without the plumbing ─────────────────────────────────
    The row's uuid was the FIRST field a reader met in this section, and it
    means nothing to any of them: it is a database key, and the document
    already carries the two references a person actually uses — the
    customer's compliance case and the entity's own reference. It is gone
    from the body; the running foot carries a short document id so a printed
    copy can still be tied back to its source.

    The hash stays, in full, because truncating a hash destroys the only
    thing it is for. It is demoted out of the field list into a closing
    verification line, where a 64-character string is a footnote rather than
    the answer to a question nobody asked.
  */
  sections.push({
    key: "integrity",
    title: "Integrity",
    blocks: [{
      fields: [
        { label: "Exported", value: formatUtc(bundle.exported_at) },
        ...field("Exported by", bundle.exported_by),
        /* The retention period is the reason a record like this is kept at
           all, and it was nowhere on the document. It is stated rather than
           counted: the clock runs from the day the report was MADE, which
           is a lodgement date this platform may not hold. */
        {
          label: "Retention",
          value: "A record of a report must be kept for 7 years from the day the report was made "
            + "— AML/CTF Act 2006 (Cth) s.107.",
        },
      ],
    }, {
      paragraph: "This copy can be checked against the record it came from. The reporting entity's "
        + "server computed the following digest over the exported bundle at the moment of export; "
        + "a later copy that differs by one character will not reproduce it.",
    }, {
      fields: [{ label: "SHA-256", value: contentHash || "\u2014" }],
    }],
  });

  const notice = kind === "smr"
    // The offence is stated under "Handling restriction", where a reader
    // meets it first. What is left here is what a colophon is for: what
    // this document is, and what it is not.
    ? "This is an internal record of a Suspicious Matter Report held by the reporting entity. It "
      + "is not the lodgement: lodgement is made in the entity's own AUSTRAC Online account, and "
      + "this platform holds no AUSTRAC credentials. The handling restriction on the first page "
      + "applies to every copy of it."
    : "This is an internal record of an AUSTRAC report held by the reporting entity. It is not "
      + "the lodgement: lodgement is made in the entity's own AUSTRAC Online account, and this "
      + "platform holds no AUSTRAC credentials.";

  return {
    reference: caseReference ?? r.reference_code ?? r.id,
    subject: (r.title ?? "").trim() || (obligation?.label ?? "AUSTRAC report"),
    version: versions.length ? Math.max(...versions.map((v) => v.version)) : 1,
    audience: "internal",
    generatedAt: formatUtc((args.now ?? new Date()).toISOString()),
    generatedBy: args.generatedBy ?? bundle.exported_by ?? null,
    headerFields,
    sections,
    notice,
    filename: austracBundleFilename(r, caseReference),
  };
}

/** `austrac-smr-AML-2026-00005.html` — the `.pdf` swap is the shared rule's. */
export function austracBundleFilename(
  report: Pick<BundleReport, "id" | "kind">,
  caseReference: string | null,
): string {
  const slug = (caseReference ?? report.id).replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `austrac-${report.kind.toLowerCase()}-${slug || report.id}.html`;
}

/**
 * What the bundle document calls itself, for the shared PDF renderer.
 *
 * The row's uuid left the body of the document; it did not leave the
 * document. A support request, a re-export or a question about which record
 * a printed copy came from all need it, so the first eight characters ride
 * in the running foot where a reference belongs — small, on every page, and
 * out of the reader's way. Eight is enough to find one row among the
 * hundreds a reporting entity will ever hold, and it is not offered as
 * something anybody should read aloud.
 */
export function austracBundleIdentity(
  record: Pick<SubmissionRecord, "reference" | "generatedAt">,
  report: Pick<BundleReport, "kind"> & { id?: string | null },
): RecordDocumentIdentity {
  const kind = toObligationKind(report.kind);
  const label = kind ? AUSTRAC_OBLIGATIONS[kind].label : "AUSTRAC report";
  const docId = (report.id ?? "").replace(/-/g, "").slice(0, 8);
  return {
    title: "AUSTRAC report record",
    identityLine: `${record.reference}  ·  ${label}`,
    footLine: `${record.reference} · ${label} · ${record.generatedAt}`
      + (docId ? ` · doc ${docId}` : ""),
  };
}
