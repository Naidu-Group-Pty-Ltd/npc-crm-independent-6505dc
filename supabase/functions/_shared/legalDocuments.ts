/**
 * Shared Legal Document / Search / Requisition / Disbursement helpers
 * (Solicitor Portal — Phase 5).
 *
 * Used by both `solicitor-portal-documents` (portal-facing) and
 * `legal-matters-admin` (Command Centre) so the two surfaces can never drift.
 * Nothing here touches financial-position or AML-restricted data.
 */
import { cleanDate, cleanEnum, cleanNumber, cleanText } from './legalMatters.ts';

export const LEGAL_DOCUMENT_BUCKET = 'legal-matter-documents';

export const LEGAL_DOCUMENT_CATEGORIES = [
  'contract', 'title', 'plan', 'disclosure_statement', 'strata_report', 'building_pest',
  'identity_voi', 'transfer', 'stamp_duty', 'settlement_statement', 'discharge',
  'trust_receipt', 'correspondence', 'search_result', 'requisition', 'authority', 'other',
] as const;

export const LEGAL_DOCUMENT_STATUSES = [
  'requested', 'uploaded', 'under_review', 'accepted', 'rejected', 'superseded', 'not_required',
] as const;

export const LEGAL_DOCUMENT_OWNERS = [
  'client', 'solicitor', 'npc', 'other_side', 'lender', 'builder', 'agent', 'other',
] as const;

export const LEGAL_SEARCH_TYPES = [
  'title_search', 'plan_search', 'council_certificate', 'water_certificate',
  'land_tax_clearance', 'strata_inspection', 'owners_corp', 'planning_certificate',
  'sewer_diagram', 'company_search', 'bankruptcy_search', 'asic_search',
  'pexa_verification', 'rates_certificate', 'other',
] as const;

export const LEGAL_SEARCH_STATUSES = [
  'not_ordered', 'ordered', 'received', 'reviewed', 'issue', 'not_required',
] as const;

export const LEGAL_REQUISITION_DIRECTIONS = ['sent', 'received'] as const;

export const LEGAL_REQUISITION_STATUSES = [
  'draft', 'sent', 'received', 'answered', 'satisfied', 'disputed', 'withdrawn',
] as const;

export const LEGAL_DISBURSEMENT_STATUSES = [
  'estimated', 'incurred', 'invoiced', 'paid', 'waived',
] as const;

export const DOCUMENT_SELECT = `
  id, legal_matter_id, category, label, description, status, owner, due_date,
  storage_bucket, storage_path, file_name, mime_type, file_size, version,
  supersedes_document_id, visible_to_client, visible_to_npc, requested_at,
  uploaded_at, uploaded_by_type, reviewed_at, review_notes, source,
  created_at, updated_at
`;

export const SEARCH_SELECT = `
  id, legal_matter_id, search_type, label, provider, reference, status,
  ordered_at, received_at, due_date, cost_amount, issue_flag, result_summary,
  notes, document_id, visible_to_client, created_at, updated_at
`;

export const REQUISITION_SELECT = `
  id, legal_matter_id, direction, reference, subject, detail, response, status,
  raised_on, response_due, answered_at, is_blocking, visible_to_client,
  document_id, notes, created_at, updated_at
`;

export const DISBURSEMENT_SELECT = `
  id, legal_matter_id, label, category, amount, gst_amount, payable_to, status,
  incurred_on, paid_on, invoice_reference, include_in_settlement,
  visible_to_client, search_id, notes, created_at, updated_at
`;

export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  contract: 'Contract of sale',
  title: 'Title',
  plan: 'Plan / survey',
  disclosure_statement: 'Disclosure statement',
  strata_report: 'Strata / owners corp report',
  building_pest: 'Building & pest report',
  identity_voi: 'Identity / VOI',
  transfer: 'Transfer',
  stamp_duty: 'Stamp duty',
  settlement_statement: 'Settlement statement',
  discharge: 'Discharge of mortgage',
  trust_receipt: 'Trust receipt',
  correspondence: 'Correspondence',
  search_result: 'Search result',
  requisition: 'Requisition',
  authority: 'Authority / instruction',
  other: 'Other',
};

export const SEARCH_TYPE_LABELS: Record<string, string> = {
  title_search: 'Title search',
  plan_search: 'Plan search',
  council_certificate: 'Council certificate',
  water_certificate: 'Water certificate',
  land_tax_clearance: 'Land tax clearance',
  strata_inspection: 'Strata inspection',
  owners_corp: 'Owners corporation',
  planning_certificate: 'Planning certificate',
  sewer_diagram: 'Sewer diagram',
  company_search: 'Company search',
  bankruptcy_search: 'Bankruptcy search',
  asic_search: 'ASIC search',
  pexa_verification: 'PEXA verification',
  rates_certificate: 'Rates certificate',
  other: 'Other search',
};

/** Statuses that mean a document is still outstanding. */
export const OPEN_DOCUMENT_STATUSES = new Set(['requested', 'uploaded', 'under_review', 'rejected']);

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_PREFIXES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/tiff',
  'text/plain',
  'text/csv',
];

export function isAllowedMime(mime: unknown): boolean {
  const m = String(mime ?? '').toLowerCase().trim();
  if (!m) return false;
  return ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p));
}

export function isAllowedSize(size: unknown): boolean {
  const n = Number(size);
  return Number.isFinite(n) && n > 0 && n <= MAX_FILE_BYTES;
}

/** Strip anything path-like or unsafe out of a client supplied file name. */
export function safeFileName(value: unknown): string {
  const raw = String(value ?? '').trim().split(/[\\/]/).pop() || 'document';
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return cleaned.replace(/^\.+/, '') || 'document';
}

export function buildStoragePath(matterId: string, documentId: string, fileName: string): string {
  return `matters/${matterId}/${documentId}/${Date.now()}-${safeFileName(fileName)}`;
}

export function buildDocumentPayload(
  body: Record<string, any>,
  { isCreate }: { isCreate: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if ('category' in body || isCreate) {
    payload.category = cleanEnum(body.category, LEGAL_DOCUMENT_CATEGORIES, 'other');
  }
  if ('label' in body || isCreate) payload.label = cleanText(body.label, 200);
  if ('description' in body) payload.description = cleanText(body.description, 4000);
  if ('owner' in body || isCreate) {
    payload.owner = cleanEnum(body.owner, LEGAL_DOCUMENT_OWNERS, 'solicitor');
  }
  if ('due_date' in body) payload.due_date = cleanDate(body.due_date);
  if ('visible_to_client' in body) payload.visible_to_client = !!body.visible_to_client;
  if ('visible_to_npc' in body) payload.visible_to_npc = !!body.visible_to_npc;
  if ('review_notes' in body) payload.review_notes = cleanText(body.review_notes, 4000);

  if (isCreate && !payload.label) {
    payload.label = DOCUMENT_CATEGORY_LABELS[String(payload.category || 'other')] || 'Document';
  }
  return payload;
}

export function buildSearchPayload(
  body: Record<string, any>,
  { isCreate }: { isCreate: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if ('search_type' in body || isCreate) {
    payload.search_type = cleanEnum(body.search_type, LEGAL_SEARCH_TYPES, 'other');
  }
  if ('label' in body || isCreate) payload.label = cleanText(body.label, 200);
  if ('provider' in body) payload.provider = cleanText(body.provider, 200);
  if ('reference' in body) payload.reference = cleanText(body.reference, 160);
  if ('status' in body) {
    payload.status = cleanEnum(body.status, LEGAL_SEARCH_STATUSES, 'not_ordered');
  }
  if ('ordered_at' in body) payload.ordered_at = cleanDate(body.ordered_at);
  if ('received_at' in body) payload.received_at = cleanDate(body.received_at);
  if ('due_date' in body) payload.due_date = cleanDate(body.due_date);
  if ('cost_amount' in body) payload.cost_amount = cleanNumber(body.cost_amount);
  if ('issue_flag' in body) payload.issue_flag = !!body.issue_flag;
  if ('result_summary' in body) payload.result_summary = cleanText(body.result_summary, 4000);
  if ('notes' in body) payload.notes = cleanText(body.notes, 4000);
  if ('visible_to_client' in body) payload.visible_to_client = !!body.visible_to_client;

  if (isCreate && !payload.label) {
    payload.label = SEARCH_TYPE_LABELS[String(payload.search_type || 'other')] || 'Search';
  }
  return payload;
}

export function buildRequisitionPayload(
  body: Record<string, any>,
  { isCreate }: { isCreate: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if ('direction' in body || isCreate) {
    payload.direction = cleanEnum(body.direction, LEGAL_REQUISITION_DIRECTIONS, 'sent');
  }
  if ('reference' in body) payload.reference = cleanText(body.reference, 160);
  if ('subject' in body || isCreate) payload.subject = cleanText(body.subject, 300);
  if ('detail' in body) payload.detail = cleanText(body.detail, 8000);
  if ('response' in body) payload.response = cleanText(body.response, 8000);
  if ('status' in body) {
    payload.status = cleanEnum(body.status, LEGAL_REQUISITION_STATUSES, 'draft');
  }
  if ('raised_on' in body) payload.raised_on = cleanDate(body.raised_on);
  if ('response_due' in body) payload.response_due = cleanDate(body.response_due);
  if ('is_blocking' in body) payload.is_blocking = !!body.is_blocking;
  if ('visible_to_client' in body) payload.visible_to_client = !!body.visible_to_client;
  if ('notes' in body) payload.notes = cleanText(body.notes, 4000);
  return payload;
}

export function buildDisbursementPayload(
  body: Record<string, any>,
  { isCreate }: { isCreate: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if ('label' in body || isCreate) payload.label = cleanText(body.label, 200);
  if ('category' in body) payload.category = cleanText(body.category, 120);
  if ('amount' in body || isCreate) payload.amount = cleanNumber(body.amount) ?? 0;
  if ('gst_amount' in body) payload.gst_amount = cleanNumber(body.gst_amount) ?? 0;
  if ('payable_to' in body) payload.payable_to = cleanText(body.payable_to, 200);
  if ('status' in body) {
    payload.status = cleanEnum(body.status, LEGAL_DISBURSEMENT_STATUSES, 'estimated');
  }
  if ('incurred_on' in body) payload.incurred_on = cleanDate(body.incurred_on);
  if ('paid_on' in body) payload.paid_on = cleanDate(body.paid_on);
  if ('invoice_reference' in body) payload.invoice_reference = cleanText(body.invoice_reference, 160);
  if ('include_in_settlement' in body) payload.include_in_settlement = !!body.include_in_settlement;
  if ('visible_to_client' in body) payload.visible_to_client = !!body.visible_to_client;
  if ('notes' in body) payload.notes = cleanText(body.notes, 4000);
  return payload;
}

export interface DocumentRegisterSummary {
  documents_total: number;
  documents_outstanding: number;
  documents_overdue: number;
  searches_total: number;
  searches_outstanding: number;
  searches_with_issues: number;
  requisitions_total: number;
  requisitions_open: number;
  requisitions_blocking: number;
  disbursements_total_amount: number;
  disbursements_unpaid_amount: number;
}

export function summariseRegisters(
  documents: any[],
  searches: any[],
  requisitions: any[],
  disbursements: any[],
): DocumentRegisterSummary {
  const today = new Date().toISOString().slice(0, 10);
  const openReq = new Set(['draft', 'sent', 'received', 'disputed']);
  const openSearch = new Set(['not_ordered', 'ordered']);

  const money = (v: unknown) => Number(v ?? 0) || 0;
  const totalAmount = disbursements.reduce((s, d) => s + money(d.amount) + money(d.gst_amount), 0);
  const unpaidAmount = disbursements
    .filter((d) => d.status !== 'paid' && d.status !== 'waived')
    .reduce((s, d) => s + money(d.amount) + money(d.gst_amount), 0);

  return {
    documents_total: documents.length,
    documents_outstanding: documents.filter((d) => OPEN_DOCUMENT_STATUSES.has(d.status)).length,
    documents_overdue: documents.filter(
      (d) => OPEN_DOCUMENT_STATUSES.has(d.status) && d.due_date && d.due_date < today,
    ).length,
    searches_total: searches.length,
    searches_outstanding: searches.filter((s) => openSearch.has(s.status)).length,
    searches_with_issues: searches.filter((s) => s.issue_flag || s.status === 'issue').length,
    requisitions_total: requisitions.length,
    requisitions_open: requisitions.filter((r) => openReq.has(r.status)).length,
    requisitions_blocking: requisitions.filter(
      (r) => r.is_blocking && openReq.has(r.status),
    ).length,
    disbursements_total_amount: Math.round(totalAmount * 100) / 100,
    disbursements_unpaid_amount: Math.round(unpaidAmount * 100) / 100,
  };
}
