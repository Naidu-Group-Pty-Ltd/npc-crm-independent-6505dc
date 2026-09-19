/**
 * The submission record — the entirety of one client submission review, as a
 * single document.
 *
 * ── Why one module, shared by browser and edge function ───────────────
 * The record exists in three presentations: read on screen as one continuous
 * document, downloaded as a file, and stored on the case as evidence that a
 * review happened over this exact content. All three are projections of the
 * SAME structure built here — the on-screen reading view renders
 * `SubmissionRecord` with React, the download and the stored copy render it
 * with `renderSubmissionRecordHtml` — so what the reviewer read, what they
 * downloaded and what the case retains cannot disagree. The client and the
 * edge functions deploy separately; a rule written twice is two rules.
 *
 * ── The artefact is inert by construction ─────────────────────────────
 * The rendered HTML is fully self-contained: inline styles only, no
 * `<script>`, no external URL in any attribute, no fonts, no images. Every
 * interpolated string passes through one escaper. A compliance record gets
 * opened years later, from storage, possibly outside this platform — it must
 * carry nothing that runs and fetch nothing from anywhere. (Same posture as
 * the report render boundary, applied at authoring time rather than at a
 * gate.)
 *
 * ── Vocabulary is preserved, never paraphrased ────────────────────────
 * The record repeats the screen's readings exactly: a simulation check is
 * "Test simulation — not compliance evidence", a provider error is "attempt
 * not consumed", a first submission has no differences WHATEVER the payload's
 * `differences` array says (an old server diffs a first submission against an
 * empty snapshot — same defence as `differencesBadge`), and screening states
 * appear verbatim. Nothing here may summarise a state into "clear".
 */

/** `aml.documents.metadata.kind` for a stored record. The client portal
 *  refuses to list or sign documents carrying it: the record includes
 *  screening states and risk readings — staff-only, a tipping-off hazard in
 *  a client's hands. Clients can never write `metadata`, so the mark is
 *  trustworthy as a gate. */
export const SUBMISSION_RECORD_DOCUMENT_KIND = 'submission_review_record';

/* ── Input: the structural subset of the review payload the record reads ── */

export interface SubmissionRecordInput {
  case: {
    reference: string; subject: string;
    case_stage: string | null; client_portal_status: string | null;
    service_gate_status: string | null;
  };
  submission: {
    version_number: number; review_status: string; submitted_at: string;
    submitted_by_type: string | null; review_reason: string | null;
    reviewed_at: string | null; questionnaire_version: string | null;
    consent_version: string | null;
    sections: Array<{ section: string; payload?: unknown }>;
    superseded_at: string | null;
  };
  previous_version: { version_number: number } | null;
  differences: Array<{ section: string; field: string; previous: unknown; current: unknown }>;
  consent_evidence: Array<{ kind: string; version: string; accepted_at: string; document_hash: string | null }>;
  related_parties: Array<{ declared_name: string; declared_role: string; change_kind: string; resolution_status: string }>;
  documents: Array<{ filename: string; display_name?: string | null; requirement_id?: string | null; version_number?: number; status: string; client_safe_rejection_reason?: string | null }>;
  /** Used only to name documents by the requirement they answered. */
  requirements?: Array<{ id: string; code?: string | null; label?: string | null }>;
  verification: Array<{
    party_label: string | null; check_type: string; status: string;
    execution_mode: string | null; provider_error_category: string | null;
  }>;
  screening: Array<{ screened_name: string; party_type: string; state: string }>;
  open_requests: Array<{ subject: string; action_code?: string | null; status: string }>;
  missing_mandatory: string[];
  risk: { latest_assessment_at: string | null; stale: boolean; stale_reasons: string[] };
}

/* ── The record structure both renderers draw from ── */

/**
 * Who a record presentation is FOR — and therefore what it may contain.
 *
 * `internal` is the review record: everything, including screening states,
 * risk readings and review reasoning. `client` is the shareable copy for the
 * client or a portal partner: it is built WITHOUT the internal sections —
 * screening, risk & completeness, the service gate, review reasons and the
 * reconciliation workflow never enter the structure, so no renderer of a
 * client record can leak them. Handing a client a document that names who
 * was screened and what came back is a tipping-off hazard; the exclusion is
 * structural, not a rendering choice.
 */
export type RecordAudience = 'internal' | 'client';

export interface RecordField { label: string; value: string }
export interface RecordTable { columns: string[]; rows: string[][] }
export interface RecordBlock {
  heading?: string;
  fields?: RecordField[];
  table?: RecordTable;
  paragraph?: string;
}
export interface RecordSection { key: string; title: string; blocks: RecordBlock[] }

export interface SubmissionRecord {
  reference: string;
  subject: string;
  version: number;
  audience: RecordAudience;
  /** Formatted, locale-independent, explicitly UTC — the browser and the
   *  edge function must stamp identically for the same instant. */
  generatedAt: string;
  generatedBy: string | null;
  headerFields: RecordField[];
  sections: RecordSection[];
  /** The closing notice every renderer carries verbatim — it states what the
   *  document is and, for the client copy, what was deliberately left out. */
  notice: string;
  filename: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "16 Aug 2026, 02:59 UTC". Deliberately not `toLocaleString`: Deno and the
 * browser carry different locale data, and the stored copy and the downloaded
 * copy must format one instant one way. UTC is named on its face so nobody
 * mistakes it for local time.
 */
export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

const words = (s: string) => s.replace(/_/g, ' ');
/** Headings read as prose; VALUES never pass through this — a screening
 *  state or review status prints verbatim, casing and all. */
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** One scalar-to-text rule for questionnaire values and diff cells. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map((v) => valueText(v)).join(', ') || '—';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${words(k)}: ${valueText(v)}`).join('; ') || '—';
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** Questionnaire payload → labelled fields. The panel's answer grid and the
 *  record's answer section both flatten through here. */
export function payloadEntries(payload: unknown): RecordField[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return Object.entries(payload as Record<string, unknown>)
    .map(([key, value]) => ({ label: words(key), value: valueText(value) }));
}

/**
 * The one reading of a verification row, in the screen's exact words. A
 * simulation is never an outcome and a provider error never consumed the
 * attempt — collapsing either into its `status` is how a test pass would
 * enter the record as compliance evidence.
 */
export function verificationOutcomeText(v: {
  status: string; execution_mode: string | null; provider_error_category: string | null;
}): string {
  if (v.execution_mode === 'simulation') return 'Test simulation — not compliance evidence';
  if (v.provider_error_category) return `${words(v.provider_error_category)} — attempt not consumed`;
  return v.status;
}

/** `AML-2026-00005` → `AML-2026-00005-submission-v1-record.html` (internal)
 *  or `…-v1-client-copy.html` — the filename says which document this is
 *  before anybody opens it. Anything outside [A-Za-z0-9-] in the reference is
 *  dropped, never encoded. */
export function submissionRecordFilename(
  reference: string, version: number, audience: RecordAudience = 'internal',
): string {
  const safe = reference.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
    || 'case';
  return `${safe}-submission-v${version}-${audience === 'client' ? 'client-copy' : 'record'}.html`;
}

export const INTERNAL_RECORD_NOTICE =
  'This record is a point-in-time export of the client submission review. It is internal to the reporting '
  + 'entity: it includes screening states and risk readings and must not be provided to the client.';

/** Deliberately does not enumerate WHAT was excluded: naming the categories
 *  on a page a client reads is itself a disclosure. A test bans the internal
 *  vocabulary from every string of a client record, this one included. */
export const CLIENT_COPY_NOTICE =
  'This document is a copy of the information the client submitted, prepared for sharing with the client '
  + "or an authorised partner. The reporting entity's internal compliance readings and review workings "
  + 'are not part of this document.';

export function buildSubmissionRecord(
  input: SubmissionRecordInput,
  opts: { generatedAt: string; generatedBy?: string | null; audience?: RecordAudience },
): SubmissionRecord {
  const s = input.submission;
  const audience = opts.audience ?? 'internal';
  const internal = audience === 'internal';
  const sections: RecordSection[] = [];

  /* 1 · The decision facts first: what a reader opening this record years
   *     later needs before any evidence — what was decided, when, by which
   *     route, and what the case looked like around it. The client copy
   *     keeps the client-visible facts alone: no review reasoning, no case
   *     stage, no service gate — those are the reporting entity's workings. */
  /* On the client copy the labels are written for a lay reader: "Submission
   * status" and "Case status" hold apart where "Review status"/"Status"
   * read as a contradiction, and an unreviewed submission says "Not yet
   * reviewed" — an em dash on a client's page reads as a field somebody
   * forgot, where on the internal record it correctly means "not recorded". */
  const decisionFields: RecordField[] = internal
    ? [
        { label: 'Review status', value: words(s.review_status) },
        { label: 'Submitted', value: `${formatUtc(s.submitted_at)} by ${s.submitted_by_type ?? 'client'}` },
        { label: 'Reviewed', value: formatUtc(s.reviewed_at) },
        { label: 'Review reason', value: s.review_reason ?? '—' },
        { label: 'Questionnaire version', value: s.questionnaire_version ?? '—' },
        { label: 'Consent version', value: s.consent_version ?? '—' },
        { label: 'Case stage', value: words(input.case.case_stage ?? '—') },
        { label: 'Client-visible status', value: words(input.case.client_portal_status ?? '—') },
        // Context only, exactly as the screen says: acceptance never moves it.
        { label: 'Service gate (read-only)', value: words(input.case.service_gate_status ?? '—') },
      ]
    : [
        { label: 'Submission status', value: words(s.review_status) },
        { label: 'Submitted', value: formatUtc(s.submitted_at) },
        { label: 'Reviewed', value: s.reviewed_at ? formatUtc(s.reviewed_at) : 'Not yet reviewed' },
        { label: 'Questionnaire version', value: s.questionnaire_version ?? '—' },
        { label: 'Consent version', value: s.consent_version ?? '—' },
        { label: 'Case status', value: words(input.case.client_portal_status ?? '—') },
      ];
  if (s.superseded_at) {
    decisionFields.push({ label: 'Superseded', value: formatUtc(s.superseded_at) });
  }
  sections.push({
    key: 'decision',
    title: internal ? 'Review decision' : 'Submission',
    blocks: [{ fields: decisionFields }],
  });

  /* 2 · Risk and completeness — part of what the reviewer had in front of
   *     them, so part of the INTERNAL record. Never built for the client
   *     copy: the standing names screening obligations and the missing list
   *     spells `screening:<name>`. */
  if (internal) {
    sections.push({
      key: 'risk', title: 'Risk & completeness at generation time', blocks: [
        {
          fields: [
            { label: 'Latest risk assessment', value: formatUtc(input.risk.latest_assessment_at) },
            {
              label: 'Risk assessment standing',
              value: input.risk.stale
                ? `Stale: ${input.risk.stale_reasons.map(words).join(', ')}`
                : 'Current',
            },
          ],
        },
        input.missing_mandatory.length === 0
          ? { paragraph: 'No mandatory information was missing.' }
          : {
              heading: 'Missing mandatory information',
              table: {
                columns: ['Item'],
                rows: input.missing_mandatory.map((m) => [m.replace(/:/g, ': ')]),
              },
            },
      ],
    });
  }

  /* 3 · Changes — derived from previous_version, never from the differences
   *     array alone: an old server diffs a FIRST submission against an empty
   *     snapshot and fabricates a change for every answered field. */
  sections.push({
    key: 'differences', title: 'Changes since previous submission', blocks: [
      input.previous_version === null
        ? { paragraph: 'This is the first submission — there is no previous version to differ from.' }
        : input.differences.length === 0
          ? { paragraph: `No field changes since v${input.previous_version.version_number}.` }
          : {
              table: {
                columns: ['Section', 'Field', 'Before', 'After'],
                rows: input.differences.map((d) => [
                  words(d.section), d.field, valueText(d.previous), valueText(d.current),
                ]),
              },
            },
    ],
  });

  /* 4 · Consent evidence. The hash column is the reporting entity's
   * evidence chain and appears on the INTERNAL record alone — in full,
   * never a prefix: a 16-hex cut can be verified against nothing.
   * Renderers wrap it; they do not trim it. On the client copy the hash is
   * machine exhaust the reader cannot use, and the most database-looking
   * thing on their page. */
  sections.push({
    key: 'consent', title: 'Consent evidence', blocks: [
      input.consent_evidence.length === 0
        ? { paragraph: 'No consent records.' }
        : {
            table: internal
              ? {
                  columns: ['Consent', 'Version', 'Accepted', 'Document hash'],
                  rows: input.consent_evidence.map((c) => [
                    words(c.kind), c.version, formatUtc(c.accepted_at), c.document_hash ?? '—',
                  ]),
                }
              : {
                  columns: ['Consent', 'Version', 'Accepted'],
                  rows: input.consent_evidence.map((c) => [
                    words(c.kind), c.version, formatUtc(c.accepted_at),
                  ]),
                },
          },
    ],
  });

  /* 5 · The answers themselves — every section, every field. */
  sections.push({
    key: 'answers', title: 'Questionnaire answers', blocks:
      s.sections.length === 0
        ? [{ paragraph: 'No questionnaire sections were submitted.' }]
        : s.sections.map((sec) => {
            const fields = payloadEntries(sec.payload);
            return fields.length === 0
              ? { heading: sentence(words(sec.section)), paragraph: 'No answers recorded.' }
              : { heading: sentence(words(sec.section)), fields };
          }),
  });

  /* 6 · Related parties. The client copy carries what the client declared —
   *     name and role — and not the reconciliation workflow, which is the
   *     reporting entity's processing of the declaration. */
  sections.push({
    key: 'parties', title: 'Related parties', blocks: [
      input.related_parties.length === 0
        ? { paragraph: 'No declared related parties for this case.' }
        : {
            table: internal
              ? {
                  columns: ['Name', 'Role', 'Change', 'Resolution'],
                  rows: input.related_parties.map((p) => [
                    p.declared_name, words(p.declared_role), words(p.change_kind), words(p.resolution_status),
                  ]),
                }
              : {
                  columns: ['Name', 'Role'],
                  rows: input.related_parties.map((p) => [
                    p.declared_name, words(p.declared_role),
                  ]),
                },
          },
    ],
  });

  /* 7 · Documents. A document is named for the reader: the chosen display
   * name, else the requirement it answered — the words the client was shown
   * when asked for the file — else the filename. A phone camera's 32-digit
   * name identifies nothing on a page; the platform filename remains the
   * register's record in Documents & Evidence, named beside, never erased
   * (same rule as rename_document). */
  const requirementName = new Map(
    (input.requirements ?? []).map((r) => [r.id, r.label || r.code || null]),
  );
  sections.push({
    key: 'documents', title: 'Documents', blocks: [
      input.documents.length === 0
        ? { paragraph: 'No documents uploaded.' }
        : {
            table: {
              // "Client-safe note" is INTERNAL vocabulary: printed on the
              // client's own page it announces that a note about them
              // exists which is not client-safe. Their copy says "Note".
              columns: ['Document', 'Version', 'Status', internal ? 'Client-safe note' : 'Note'],
              rows: input.documents.map((d) => [
                d.display_name
                  || (d.requirement_id ? requirementName.get(d.requirement_id) ?? null : null)
                  || d.filename,
                `v${d.version_number ?? 1}`,
                d.status,
                d.client_safe_rejection_reason ?? '—',
              ]),
            },
          },
    ],
  });

  /* 8 · Identity verification, in the screen's exact vocabulary. */
  sections.push({
    key: 'verification', title: 'Identity verification by party', blocks: [
      input.verification.length === 0
        ? { paragraph: 'No verification checks recorded.' }
        : {
            table: {
              columns: ['Party', 'Check', 'Outcome'],
              rows: input.verification.map((v) => [
                v.party_label ?? 'Case subject', words(v.check_type), verificationOutcomeText(v),
              ]),
            },
          },
    ],
  });

  /* 9 · Screening — states verbatim, and INTERNAL ONLY. A document that
   *     names who was screened and what came back, in a client's hands, is
   *     a tipping-off hazard; the section is never built for the client
   *     copy, so no renderer of one can leak it. */
  if (internal) {
    sections.push({
      key: 'screening', title: 'Screening by party', blocks: [
        input.screening.length === 0
          ? { paragraph: 'No party screening work yet — the declared parties had not been reconciled.' }
          : {
              table: {
                columns: ['Party', 'Type', 'State'],
                rows: input.screening.map((sc) => [
                  sc.screened_name, words(sc.party_type), words(sc.state),
                ]),
              },
            },
      ],
    });
  }

  /* 10 · Open client requests. */
  sections.push({
    key: 'requests', title: 'Open client requests', blocks: [
      input.open_requests.length === 0
        ? { paragraph: 'No open requests.' }
        : {
            table: {
              columns: ['Request', 'Action', 'Status'],
              rows: input.open_requests.map((r) => [
                r.subject, r.action_code ? words(r.action_code) : '—', r.status,
              ]),
            },
          },
    ],
  });

  return {
    reference: input.case.reference,
    subject: input.case.subject,
    version: s.version_number,
    audience,
    generatedAt: formatUtc(opts.generatedAt),
    // A staff member's work email is for the internal record alone — on a
    // document handed to an external party it is a disclosure, decided here
    // once so no renderer can print it.
    generatedBy: internal ? opts.generatedBy ?? null : null,
    headerFields: [
      { label: 'Case', value: input.case.reference },
      { label: 'Subject', value: input.case.subject },
      { label: 'Submission', value: `Version ${s.version_number}` },
    ],
    sections,
    notice: internal ? INTERNAL_RECORD_NOTICE : CLIENT_COPY_NOTICE,
    filename: submissionRecordFilename(input.case.reference, s.version_number, audience),
  };
}

/* ── The self-contained HTML rendering ── */

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* System faces only. A stored record must not fetch a typeface — or anything
 * else — from anywhere, and print keeps its own contrast rules: black on
 * white, no tints that die on paper. */
const RECORD_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 32px 40px; max-width: 860px;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111; background: #fff;
  }
  header { border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .ident { margin: 0; font-size: 15px; color: #333; }
  h2 { font-size: 15px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #999; }
  h3 { font-size: 13px; margin: 14px 0 6px; }
  dl.fields { display: grid; grid-template-columns: 240px 1fr; gap: 4px 16px; margin: 0; }
  dl.fields dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; padding-top: 2px; }
  dl.fields dd { margin: 0; overflow-wrap: anywhere; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; }
  th, td { text-align: left; padding: 5px 10px 5px 0; vertical-align: top; overflow-wrap: anywhere; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; border-bottom: 1px solid #999; }
  td { border-bottom: 1px solid #ddd; }
  p.note { color: #444; margin: 4px 0; }
  footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #999; font-size: 12px; color: #444; }
  @media print {
    body { padding: 0; max-width: none; }
    h2 { break-after: avoid; }
    tr, dl.fields > div { break-inside: avoid; }
  }
  @page { margin: 18mm; }
`;

function renderBlock(block: RecordBlock): string {
  const parts: string[] = [];
  if (block.heading) parts.push(`<h3>${esc(block.heading)}</h3>`);
  if (block.paragraph) parts.push(`<p class="note">${esc(block.paragraph)}</p>`);
  if (block.fields && block.fields.length > 0) {
    parts.push(
      `<dl class="fields">${block.fields.map((f) =>
        `<div style="display:contents"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`,
      ).join('')}</dl>`,
    );
  }
  if (block.table) {
    parts.push(
      `<table><thead><tr>${block.table.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>`
      + `<tbody>${block.table.rows.map((r) =>
        `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`,
      ).join('')}</tbody></table>`,
    );
  }
  return parts.join('\n');
}

/**
 * The complete record as one inert HTML document: inline styles, no scripts,
 * no external URL in any attribute, everything escaped. Suitable to store,
 * to email, to open from a cold archive, and to print (the print stylesheet
 * is inside it — the browser's own "save as PDF" produces the paper copy).
 */
export function recordDocumentTitle(record: Pick<SubmissionRecord, 'audience'>): string {
  return record.audience === 'client' ? 'Client submission copy' : 'Client submission record';
}

export function renderSubmissionRecordHtml(record: SubmissionRecord): string {
  const title = `${record.reference} — submission v${record.version} `
    + (record.audience === 'client' ? 'client copy' : 'record');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${RECORD_CSS}</style>
</head>
<body>
<header>
<h1>${esc(recordDocumentTitle(record))}</h1>
<p class="ident">${record.headerFields.map((f) => esc(f.value)).join(' · ')}</p>
</header>
${record.sections.map((sec) =>
  `<section>\n<h2>${esc(sec.title)}</h2>\n${sec.blocks.map(renderBlock).join('\n')}\n</section>`,
).join('\n')}
<footer>
<p>Generated ${esc(record.generatedAt)}${record.generatedBy ? ` by ${esc(record.generatedBy)}` : ''} · Case ${esc(record.reference)}.</p>
<p>${esc(record.notice)}</p>
</footer>
</body>
</html>
`;
}
