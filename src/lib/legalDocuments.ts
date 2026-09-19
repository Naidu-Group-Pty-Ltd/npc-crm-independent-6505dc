/**
 * Legal document / search / requisition / disbursement domain constants shared
 * by the Solicitor Portal UI and Command Centre admin surfaces.
 * Mirrors `_shared/legalDocuments.ts` on the edge side — keep the two in step.
 */

export type LegalDocumentCategory =
  | 'contract' | 'title' | 'plan' | 'disclosure_statement' | 'strata_report'
  | 'building_pest' | 'identity_voi' | 'transfer' | 'stamp_duty'
  | 'settlement_statement' | 'discharge' | 'trust_receipt' | 'correspondence'
  | 'search_result' | 'requisition' | 'authority' | 'other';

export type LegalDocumentStatus =
  | 'requested' | 'uploaded' | 'under_review' | 'accepted' | 'rejected'
  | 'superseded' | 'not_required';

export type LegalDocumentOwner =
  | 'client' | 'solicitor' | 'npc' | 'other_side' | 'lender' | 'builder' | 'agent' | 'other';

export type LegalSearchType =
  | 'title_search' | 'plan_search' | 'council_certificate' | 'water_certificate'
  | 'land_tax_clearance' | 'strata_inspection' | 'owners_corp' | 'planning_certificate'
  | 'sewer_diagram' | 'company_search' | 'bankruptcy_search' | 'asic_search'
  | 'pexa_verification' | 'rates_certificate' | 'other';

export type LegalSearchStatus =
  | 'not_ordered' | 'ordered' | 'received' | 'reviewed' | 'issue' | 'not_required';

export type LegalRequisitionDirection = 'sent' | 'received';

export type LegalRequisitionStatus =
  | 'draft' | 'sent' | 'received' | 'answered' | 'satisfied' | 'disputed' | 'withdrawn';

export type LegalDisbursementStatus =
  | 'estimated' | 'incurred' | 'invoiced' | 'paid' | 'waived';

export interface LegalMatterDocument {
  id: string;
  legal_matter_id: string;
  category: LegalDocumentCategory;
  label: string;
  description: string | null;
  status: LegalDocumentStatus;
  owner: LegalDocumentOwner;
  due_date: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  version: number;
  supersedes_document_id: string | null;
  visible_to_client: boolean;
  visible_to_npc: boolean;
  requested_at: string | null;
  uploaded_at: string | null;
  uploaded_by_type: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  row_version?: number;
  current_version_id?: string | null;
  malware_scan_status?: 'pending' | 'scanning' | 'clean' | 'infected' | 'error' | 'legacy_unverified' | null;
  lifecycle_status?: string | null;
  allow_external_ai?: boolean;
}

export interface LegalMatterSearch {
  id: string;
  legal_matter_id: string;
  search_type: LegalSearchType;
  label: string;
  provider: string | null;
  reference: string | null;
  status: LegalSearchStatus;
  ordered_at: string | null;
  received_at: string | null;
  due_date: string | null;
  cost_amount: number | null;
  issue_flag: boolean;
  result_summary: string | null;
  notes: string | null;
  document_id: string | null;
  visible_to_client: boolean;
  created_at: string;
  updated_at: string;
}

export interface LegalMatterRequisition {
  id: string;
  legal_matter_id: string;
  direction: LegalRequisitionDirection;
  reference: string | null;
  subject: string;
  detail: string | null;
  response: string | null;
  status: LegalRequisitionStatus;
  raised_on: string | null;
  response_due: string | null;
  answered_at: string | null;
  is_blocking: boolean;
  visible_to_client: boolean;
  document_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LegalMatterDisbursement {
  id: string;
  legal_matter_id: string;
  label: string;
  category: string | null;
  amount: number;
  gst_amount: number;
  payable_to: string | null;
  status: LegalDisbursementStatus;
  incurred_on: string | null;
  paid_on: string | null;
  invoice_reference: string | null;
  include_in_settlement: boolean;
  visible_to_client: boolean;
  search_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
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

export const DOCUMENT_CATEGORY_LABELS: Record<LegalDocumentCategory, string> = {
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

export const DOCUMENT_STATUS_LABELS: Record<LegalDocumentStatus, string> = {
  requested: 'Requested',
  uploaded: 'Uploaded',
  under_review: 'Under review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  superseded: 'Superseded',
  not_required: 'Not required',
};

/** Semantic token classes only — never raw palette utilities. */
export const DOCUMENT_STATUS_CLASSES: Record<LegalDocumentStatus, string> = {
  requested: 'border-warning/40 bg-warning/10 text-warning',
  uploaded: 'border-primary/30 bg-primary/10 text-primary',
  under_review: 'border-primary/40 bg-primary/15 text-primary',
  accepted: 'border-success/40 bg-success/10 text-success',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
  superseded: 'border-border bg-muted text-muted-foreground',
  not_required: 'border-border bg-muted text-muted-foreground',
};

export const DOCUMENT_OWNER_LABELS: Record<LegalDocumentOwner, string> = {
  client: 'Client',
  solicitor: 'Our practice',
  npc: 'NPC',
  other_side: 'Other side',
  lender: 'Lender',
  builder: 'Builder',
  agent: 'Agent',
  other: 'Other',
};

export const SEARCH_TYPE_LABELS: Record<LegalSearchType, string> = {
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

export const SEARCH_STATUS_LABELS: Record<LegalSearchStatus, string> = {
  not_ordered: 'Not ordered',
  ordered: 'Ordered',
  received: 'Received',
  reviewed: 'Reviewed',
  issue: 'Issue found',
  not_required: 'Not required',
};

export const SEARCH_STATUS_CLASSES: Record<LegalSearchStatus, string> = {
  not_ordered: 'border-border bg-muted text-muted-foreground',
  ordered: 'border-warning/40 bg-warning/10 text-warning',
  received: 'border-primary/30 bg-primary/10 text-primary',
  reviewed: 'border-success/40 bg-success/10 text-success',
  issue: 'border-destructive/40 bg-destructive/10 text-destructive',
  not_required: 'border-border bg-muted text-muted-foreground',
};

export const REQUISITION_DIRECTION_LABELS: Record<LegalRequisitionDirection, string> = {
  sent: 'Raised by us',
  received: 'Received from other side',
};

export const REQUISITION_STATUS_LABELS: Record<LegalRequisitionStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  received: 'Received',
  answered: 'Answered',
  satisfied: 'Satisfied',
  disputed: 'Disputed',
  withdrawn: 'Withdrawn',
};

export const REQUISITION_STATUS_CLASSES: Record<LegalRequisitionStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  sent: 'border-primary/30 bg-primary/10 text-primary',
  received: 'border-warning/40 bg-warning/10 text-warning',
  answered: 'border-primary/40 bg-primary/15 text-primary',
  satisfied: 'border-success/40 bg-success/10 text-success',
  disputed: 'border-destructive/40 bg-destructive/10 text-destructive',
  withdrawn: 'border-border bg-muted text-muted-foreground',
};

export const DISBURSEMENT_STATUS_LABELS: Record<LegalDisbursementStatus, string> = {
  estimated: 'Estimated',
  incurred: 'Incurred',
  invoiced: 'Invoiced',
  paid: 'Paid',
  waived: 'Waived',
};

export const DISBURSEMENT_STATUS_CLASSES: Record<LegalDisbursementStatus, string> = {
  estimated: 'border-border bg-muted text-muted-foreground',
  incurred: 'border-warning/40 bg-warning/10 text-warning',
  invoiced: 'border-primary/30 bg-primary/10 text-primary',
  paid: 'border-success/40 bg-success/10 text-success',
  waived: 'border-border bg-muted text-muted-foreground',
};

export const DOCUMENT_CATEGORY_OPTIONS = Object.keys(DOCUMENT_CATEGORY_LABELS) as LegalDocumentCategory[];
export const DOCUMENT_STATUS_OPTIONS = Object.keys(DOCUMENT_STATUS_LABELS) as LegalDocumentStatus[];
export const DOCUMENT_OWNER_OPTIONS = Object.keys(DOCUMENT_OWNER_LABELS) as LegalDocumentOwner[];
export const SEARCH_TYPE_OPTIONS = Object.keys(SEARCH_TYPE_LABELS) as LegalSearchType[];
export const SEARCH_STATUS_OPTIONS = Object.keys(SEARCH_STATUS_LABELS) as LegalSearchStatus[];
export const REQUISITION_STATUS_OPTIONS = Object.keys(REQUISITION_STATUS_LABELS) as LegalRequisitionStatus[];
export const DISBURSEMENT_STATUS_OPTIONS = Object.keys(DISBURSEMENT_STATUS_LABELS) as LegalDisbursementStatus[];

export const OPEN_DOCUMENT_STATUSES = new Set<LegalDocumentStatus>([
  'requested', 'uploaded', 'under_review', 'rejected',
]);

/** 50 MB — mirrors the edge-side cap. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isDocumentOverdue(doc: Pick<LegalMatterDocument, 'due_date' | 'status'>): boolean {
  if (!doc.due_date || !OPEN_DOCUMENT_STATUSES.has(doc.status)) return false;
  return doc.due_date < new Date().toISOString().slice(0, 10);
}
