/**
 * The documents an assessment has issued, whichever route drew them.
 *
 * ## Two routes, two ledgers, one list
 *
 * A Commercial & Industrial Capacity Report reaches a client by one of two
 * routes, and each records what it drew in its own ledger:
 *
 *  - `render-commercial-capacity-pdf` writes `commercial_industrial_report_renders`
 *    and stores the PDF in `client-files`;
 *  - a report template drawn through `render-template-pdf` writes
 *    `template_render_jobs`, names the assessment in `metadata.report_id`, and
 *    stores the PDF in `investment-reports`.
 *
 * `useCapacityReport` tries the template route FIRST, so on a deployment with an
 * active template most documents were in the second ledger, and every reader of
 * the first one missed them (`MODULE_STRUCTURE.md` G4). Copying one ledger into
 * the other would record each templated document twice — `report_render_coverage`
 * counts both tables — so neither is copied. Each document is recorded ONCE,
 * where it was drawn, and this module is the one place that reads the two as a
 * single list. The assessment's Documents panel, the client's tabs and Generated
 * Reports all go through it.
 *
 * ## Which client a document belongs to
 *
 * Renders carry no client of their own. Reading them through the assessment's
 * CURRENT link moved a document's history to whichever client the assessment
 * was linked to next — while the PDF itself still names the client it was drawn
 * for (G7). The link history already says who that was: a document belongs to
 * the client whose link was open when it was drawn, and to nobody when none was.
 */

import { ABANDONED_RENDER_AFTER_MS, type RenderFact } from './deletion.pure.ts';

/** Which ledger recorded a document — the delete rule's own vocabulary. */
export type DocumentLedger = RenderFact['ledger'];

export const DOCUMENT_LEDGERS: readonly DocumentLedger[] = ['capacity_report', 'template'];

/**
 * Where each route stores its PDF.
 *
 * The direct route records its bucket on every row. The template route does
 * not, and its bucket is a literal in `render-template-pdf` — a spec reads that
 * function's source and fails if the two stop agreeing.
 */
export const CAPACITY_REPORT_BUCKET = 'client-files';
export const TEMPLATE_DOCUMENT_BUCKET = 'investment-reports';

/**
 * How long a download link lives.
 *
 * A signed URL is a bearer credential. It is minted for the one person who
 * asked, at the moment they asked, and it only has to outlive the fetch that
 * follows.
 */
export const DOCUMENT_LINK_TTL_SECONDS = 300;

/**
 * A render still marked running after this long has died without saying so.
 *
 * The delete rule's own number, imported rather than restated: an abandoned
 * row may not read as "in progress" here and as abandoned in the delete dialog.
 */
export const DID_NOT_FINISH_AFTER_MS = ABANDONED_RENDER_AFTER_MS;

export type DocumentState = 'ready' | 'in_progress' | 'failed' | 'did_not_finish';

/** A row of `commercial_industrial_report_renders`, as the reader selects it. */
export interface CapacityRenderRow {
  id: string;
  assessment_id: string;
  status: string;
  file_name: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  bytes: number | null;
  page_count: number | null;
  has_analysis: boolean | null;
  analysis_note: string | null;
  error: string | null;
  created_at: string;
}

/** A row of `template_render_jobs`, as the reader selects it. */
export interface TemplateJobRow {
  id: string;
  status: string;
  file_name: string | null;
  storage_path: string | null;
  bytes: number | null;
  page_count: number | null;
  template_name: string | null;
  error: string | null;
  created_at: string;
  requested_by: string | null;
  metadata: Record<string, unknown> | null;
}

/** A row of `commercial_industrial_assessment_client_links`. */
export interface ClientLinkRow {
  assessment_id: string;
  client_id: string;
  linked_at: string;
  unlinked_at: string | null;
}

export interface IssuedDocument {
  ledger: DocumentLedger;
  /** The ledger row's id. Unique within its ledger, not across both. */
  id: string;
  assessmentId: string;
  state: DocumentState;
  fileName: string;
  /** When the render was started. */
  createdAt: string;
  pageCount: number | null;
  bytes: number | null;
  /** The direct route only: whether the model-authored analysis was in it. */
  hasAnalysis: boolean | null;
  /** The direct route only: why there is no analysis, when there is none. */
  analysisNote: string | null;
  /** The template route only: the template it was drawn from. */
  templateName: string | null;
  /** Why it failed, in the route's own words. Null unless it failed. */
  error: string | null;
  /** The client linked when it was drawn, or null for a standalone document. */
  clientId: string | null;
  /** There is a stored file behind it. */
  downloadable: boolean;
}

/** The name a document is saved under when its ledger row recorded none. */
export const FALLBACK_DOCUMENT_FILE_NAME = 'Commercial_Capacity_Report.pdf';

/** The longest failure reason a list carries. The ledger keeps the rest. */
const MAX_ERROR_CHARS = 300;

function timeOf(iso: string | null | undefined): number {
  const value = Date.parse(String(iso ?? ''));
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * What a ledger status means to a reader.
 *
 * Both ledgers use `running` / `succeeded` / `failed`; `template_render_jobs`
 * also has `pending` as its column default. Anything else is read as a failure:
 * a status nobody recognises is not a document anybody can be handed.
 */
export function documentState(status: string, createdAt: string, now: number): DocumentState {
  if (status === 'succeeded') return 'ready';
  if (status === 'running' || status === 'pending') {
    const started = timeOf(createdAt);
    // An unreadable timestamp reads as fresh, the rule the delete dialog uses:
    // "still going" is never wrong for longer than the row stays unreadable.
    if (!Number.isFinite(started)) return 'in_progress';
    return now - started > DID_NOT_FINISH_AFTER_MS ? 'did_not_finish' : 'in_progress';
  }
  return 'failed';
}

/**
 * The client an assessment was linked to at a moment, or null.
 *
 * A link is open from `linked_at` until `unlinked_at`. Relinking through the
 * API used to leave the previous row open, so two rows can claim the same
 * moment; the later link is the one in force, because it was made second.
 */
export function clientLinkedAt(
  links: readonly ClientLinkRow[],
  assessmentId: string,
  at: string,
): string | null {
  const moment = timeOf(at);
  if (!Number.isFinite(moment)) return null;
  let best: { clientId: string; linkedAt: number } | null = null;
  for (const link of links) {
    if (link.assessment_id !== assessmentId) continue;
    const opened = timeOf(link.linked_at);
    if (!Number.isFinite(opened) || opened > moment) continue;
    const closed = link.unlinked_at == null ? Number.NaN : timeOf(link.unlinked_at);
    if (Number.isFinite(closed) && closed <= moment) continue;
    if (!best || opened >= best.linkedAt) best = { clientId: link.client_id, linkedAt: opened };
  }
  return best?.clientId ?? null;
}

/** The assessment a template job names, or null when it names none. */
export function templateJobAssessmentId(job: Pick<TemplateJobRow, 'metadata'>): string | null {
  const value = job.metadata?.report_id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Whether a template job is one of this assessment's documents.
 *
 * `render-template-pdf` accepts HTML and a report id from any signed-in caller,
 * so a job naming an assessment proves only that somebody sent its id. The
 * adapter that draws a Capacity Report reads the assessment through the
 * owner-scoped `get`, so a genuine job was requested by the assessment's owner.
 * Anything else is left out, rather than shown to the owner as their document.
 */
export function isGenuineTemplateJob(
  job: Pick<TemplateJobRow, 'requested_by' | 'metadata'>,
  assessment: { id: string; userId: string },
): boolean {
  return templateJobAssessmentId(job) === assessment.id && job.requested_by === assessment.userId;
}

/**
 * Who may download an issued document.
 *
 * The assessment's owner, always. Anyone else only by way of a client: the
 * client's Commercial / Industrial tab is reached under the clients module's
 * own rules, and whoever may see a client may read what was issued to them —
 * the rule `client_workspace` already applies to LISTING those documents.
 * Only a document drawn while the assessment was linked to that client
 * qualifies, so reaching one client never opens an assessment's other
 * documents.
 *
 * Rendering is not widened by this: generating a report stays with the owner.
 */
export function mayReadDocument(input: {
  callerOwnsAssessment: boolean;
  viaClientId: string | null;
  clientReachable: boolean;
  documentClientId: string | null;
}): boolean {
  if (input.callerOwnsAssessment) return true;
  if (!input.viaClientId || !input.clientReachable) return false;
  return input.documentClientId === input.viaClientId;
}

function reason(state: DocumentState, error: string | null): string | null {
  if (state === 'did_not_finish') return 'The render stopped before it finished and the document was never stored.';
  if (state !== 'failed') return null;
  const text = (error ?? '').trim();
  if (!text) return 'The render failed without recording why.';
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text;
}

function fromCapacityRender(
  row: CapacityRenderRow,
  links: readonly ClientLinkRow[],
  now: number,
): IssuedDocument {
  const state = documentState(String(row.status ?? ''), row.created_at, now);
  return {
    ledger: 'capacity_report',
    id: row.id,
    assessmentId: row.assessment_id,
    state,
    fileName: row.file_name?.trim() || FALLBACK_DOCUMENT_FILE_NAME,
    createdAt: row.created_at,
    pageCount: row.page_count ?? null,
    bytes: row.bytes ?? null,
    hasAnalysis: row.has_analysis ?? null,
    analysisNote: row.analysis_note ?? null,
    templateName: null,
    error: reason(state, row.error),
    clientId: clientLinkedAt(links, row.assessment_id, row.created_at),
    downloadable: state === 'ready' && Boolean(row.storage_path),
  };
}

function fromTemplateJob(
  row: TemplateJobRow,
  links: readonly ClientLinkRow[],
  now: number,
): IssuedDocument | null {
  const assessmentId = templateJobAssessmentId(row);
  if (!assessmentId) return null;
  const state = documentState(String(row.status ?? ''), row.created_at, now);
  return {
    ledger: 'template',
    id: row.id,
    assessmentId,
    state,
    fileName: row.file_name?.trim() || FALLBACK_DOCUMENT_FILE_NAME,
    createdAt: row.created_at,
    pageCount: row.page_count ?? null,
    bytes: row.bytes ?? null,
    hasAnalysis: null,
    analysisNote: null,
    templateName: row.template_name?.trim() || null,
    error: reason(state, row.error),
    clientId: clientLinkedAt(links, assessmentId, row.created_at),
    downloadable: state === 'ready' && Boolean(row.storage_path),
  };
}

/**
 * Both ledgers as one list, newest first.
 *
 * A template job that names no assessment is not one of these documents and is
 * left out, whatever else it says.
 */
export function projectIssuedDocuments(input: {
  renders: readonly CapacityRenderRow[];
  templateJobs: readonly TemplateJobRow[];
  links: readonly ClientLinkRow[];
  now?: number;
}): IssuedDocument[] {
  const now = input.now ?? Date.now();
  const documents: IssuedDocument[] = [
    ...input.renders.map((row) => fromCapacityRender(row, input.links, now)),
    ...input.templateJobs
      .map((row) => fromTemplateJob(row, input.links, now))
      .filter((doc): doc is IssuedDocument => doc !== null),
  ];
  return documents.sort((a, b) => {
    // An unreadable timestamp sorts as the oldest rather than poisoning the sort.
    const difference = (timeOf(b.createdAt) || 0) - (timeOf(a.createdAt) || 0);
    if (difference !== 0) return difference;
    return `${a.ledger}:${a.id}`.localeCompare(`${b.ledger}:${b.id}`);
  });
}

/**
 * Only documents drawn while the assessment was linked to this client.
 *
 * This is what stops a relink moving a client's history: a document drawn for
 * one client stays in that client's record, and never appears in the next
 * one's.
 */
export function documentsForClient(
  documents: readonly IssuedDocument[],
  clientId: string,
): IssuedDocument[] {
  return documents.filter((doc) => doc.clientId === clientId);
}

/** A document in a list that spans assessments, named by the assessment it came from. */
export interface ListedDocument extends IssuedDocument {
  assessmentReference: string;
  assessmentTitle: string;
}

/**
 * Name each document by its assessment.
 *
 * A document whose assessment is not in the list is dropped rather than shown
 * nameless: every caller reads the assessments it is allowed to list first, so
 * one missing here is one this caller was not given.
 */
export function labelDocuments(
  documents: readonly IssuedDocument[],
  assessments: ReadonlyArray<{ id: string; reference?: string | null; title?: string | null }>,
): ListedDocument[] {
  const byId = new Map(assessments.map((row) => [row.id, row]));
  const listed: ListedDocument[] = [];
  for (const doc of documents) {
    const assessment = byId.get(doc.assessmentId);
    if (!assessment) continue;
    listed.push({
      ...doc,
      assessmentReference: String(assessment.reference ?? ''),
      assessmentTitle: String(assessment.title ?? '') || 'Untitled assessment',
    });
  }
  return listed;
}

export function isDocumentLedger(value: unknown): value is DocumentLedger {
  return value === 'capacity_report' || value === 'template';
}

/**
 * Where a ready document's bytes are, or null when there are none to fetch.
 *
 * The direct route's own bucket column is honoured where it is set; the
 * template route has none, so its bucket is the one `render-template-pdf`
 * writes to.
 */
export function documentStorage(
  ledger: DocumentLedger,
  row: { status: string; storage_path: string | null; storage_bucket?: string | null },
): { bucket: string; path: string } | null {
  if (row.status !== 'succeeded') return null;
  const path = row.storage_path?.trim();
  if (!path) return null;
  const bucket = ledger === 'capacity_report'
    ? (row.storage_bucket?.trim() || CAPACITY_REPORT_BUCKET)
    : TEMPLATE_DOCUMENT_BUCKET;
  return { bucket, path };
}
