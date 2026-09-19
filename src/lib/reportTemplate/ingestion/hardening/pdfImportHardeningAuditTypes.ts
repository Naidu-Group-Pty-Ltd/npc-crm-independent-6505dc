// PDF Import Phase 10A — Production Readiness Hardening Audit types.
//
// These types describe a STRUCTURED, DETERMINISTIC hardening checklist and its
// evaluation. This is an audit baseline (a fixed catalogue of production-safety
// checks with recorded status/evidence), not a live scanner. Nothing here reads
// the database, storage, or the running app; the evaluator only summarises the
// checks it is given.

export const PDF_IMPORT_HARDENING_AUDIT_VERSION =
  'pdf-import-hardening-audit-v1';

/** Audit domains covered by Phase 10A. */
export type PdfImportHardeningDomain =
  | 'security_auth'
  | 'rls_database'
  | 'storage'
  | 'edge_functions'
  | 'sidecar'
  | 'data_privacy'
  | 'operator_console'
  | 'golden_regression'
  | 'export_parity'
  | 'observability'
  | 'performance_cost'
  | 'rollout';

/** Risk severity for a hardening check. */
export type PdfImportHardeningSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

/** Likelihood a risk materialises if the check is not satisfied. */
export type PdfImportHardeningLikelihood =
  | 'frequent'
  | 'likely'
  | 'possible'
  | 'unlikely'
  | 'rare';

/** Current status of a hardening check. */
export type PdfImportHardeningStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'unknown'
  | 'not_applicable';

/** Overall production readiness decision. */
export type PdfImportHardeningReadiness =
  | 'ready'
  | 'ready_with_warnings'
  | 'not_ready';

/** A single hardening check in the audit baseline. */
export interface PdfImportHardeningCheck {
  id: string;
  domain: PdfImportHardeningDomain;
  title: string;
  description: string;
  severity: PdfImportHardeningSeverity;
  likelihood: PdfImportHardeningLikelihood;
  status: PdfImportHardeningStatus;
  owner: string;
  evidence: string[];
  recommendation: string;
  targetPhase: string;
}

/** Aggregated result of evaluating a set of hardening checks. */
export interface PdfImportHardeningAuditSummary {
  version: typeof PDF_IMPORT_HARDENING_AUDIT_VERSION;
  total: number;
  pass: number;
  warning: number;
  fail: number;
  unknown: number;
  notApplicable: number;
  criticalFailures: number;
  highFailures: number;
  readiness: PdfImportHardeningReadiness;
  score: number;
  generatedAt: string;
}

/** Full audit report: the evaluated checks plus their summary. */
export interface PdfImportHardeningAuditReport {
  version: typeof PDF_IMPORT_HARDENING_AUDIT_VERSION;
  checks: PdfImportHardeningCheck[];
  summary: PdfImportHardeningAuditSummary;
}

/** Options passed to the evaluator. */
export interface PdfImportHardeningEvaluationOptions {
  checks: PdfImportHardeningCheck[];
  now?: () => Date;
}
