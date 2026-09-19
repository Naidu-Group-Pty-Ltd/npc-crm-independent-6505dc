/**
 * pdfImportRunbookTypes — Phase 11F production runbook + SOP registry model.
 *
 * Phase 11F is the human operating layer. It adds NO runtime behaviour, calls no
 * AI, mutates no templates, deletes nothing, and deploys nothing. These types
 * describe the runbook registry and a readiness evaluator so the team can verify
 * that production operations are documented.
 */
export const PDF_IMPORT_RUNBOOK_REGISTRY_VERSION = 'pdf-import-runbook-registry-v1';

export type PdfImportRunbookDomain =
  | 'orientation'
  | 'daily_operations'
  | 'weekly_operations'
  | 'import_workflow'
  | 'visual_quality'
  | 'repair'
  | 'adaptive_reconciliation'
  | 'self_healing'
  | 'export_parity'
  | 'golden_regression'
  | 'monitoring_alerts'
  | 'permissions'
  | 'retention'
  | 'release_gate'
  | 'incident_response'
  | 'rollback'
  | 'client_communication'
  | 'escalation'
  | 'training';

export const PDF_IMPORT_RUNBOOK_DOMAINS: PdfImportRunbookDomain[] = [
  'orientation',
  'daily_operations',
  'weekly_operations',
  'import_workflow',
  'visual_quality',
  'repair',
  'adaptive_reconciliation',
  'self_healing',
  'export_parity',
  'golden_regression',
  'monitoring_alerts',
  'permissions',
  'retention',
  'release_gate',
  'incident_response',
  'rollback',
  'client_communication',
  'escalation',
  'training',
];

export type PdfImportRunbookAudience =
  | 'pdf_viewer'
  | 'pdf_operator'
  | 'pdf_qa_operator'
  | 'pdf_admin'
  | 'developer_admin'
  | 'business_stakeholder';

export type PdfImportRunbookCriticality = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const PDF_IMPORT_RUNBOOK_CRITICALITIES: PdfImportRunbookCriticality[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

export type PdfImportRunbookReadinessStatus =
  | 'ready'
  | 'missing'
  | 'incomplete'
  | 'needs_review'
  | 'unknown';

export interface PdfImportRunbookDefinition {
  id: string;
  title: string;
  path: string;
  domain: PdfImportRunbookDomain;
  audience: PdfImportRunbookAudience[];
  criticality: PdfImportRunbookCriticality;
  requiredRoles: string[];
  relatedRoutes: string[];
  relatedAlerts: string[];
  relatedCapabilities: string[];
  requiredSections: string[];
}

export interface PdfImportRunbookRegistry {
  version: typeof PDF_IMPORT_RUNBOOK_REGISTRY_VERSION;
  runbooks: PdfImportRunbookDefinition[];
  generatedAt: string;
}

export interface PdfImportRunbookReadinessResult {
  id: string;
  title: string;
  path: string;
  domain: PdfImportRunbookDomain;
  criticality: PdfImportRunbookCriticality;
  status: PdfImportRunbookReadinessStatus;
  missingSections: string[];
  warnings: string[];
}

export interface PdfImportRunbookReadinessReport {
  version: typeof PDF_IMPORT_RUNBOOK_REGISTRY_VERSION;
  results: PdfImportRunbookReadinessResult[];
  total: number;
  ready: number;
  missing: number;
  incomplete: number;
  needsReview: number;
  criticalMissing: number;
  highMissing: number;
  score: number;
  generatedAt: string;
}
