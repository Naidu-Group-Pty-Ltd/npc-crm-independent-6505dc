/**
 * releaseGateTypes — Phase 11D release gate / CI integration data model.
 *
 * The release gate answers "can this branch/deployment proceed?" for the PDF
 * import production system. It is a *release safety layer*: local/CI-safe by
 * default, secret-free, non-mutating. It never calls AI, mutates templates,
 * applies repairs/reconciliation, runs imports, or requires production secrets
 * in its default (static) mode.
 *
 * These types are pure data — no I/O.
 */
export const PDF_IMPORT_RELEASE_GATE_VERSION = 'pdf-import-release-gate-v1';

/** static = local/CI-safe only; live = optional Supabase/Cloud Run; full = both. */
export type PdfImportReleaseGateMode = 'static' | 'live' | 'full';

export type PdfImportReleaseGateDecision =
  | 'pass'
  | 'pass_with_warnings'
  | 'fail'
  | 'skipped';

export type PdfImportReleaseGateDomain =
  | 'source_integrity'
  | 'documentation'
  | 'schemas'
  | 'sql'
  | 'tests'
  | 'build'
  | 'private_artifacts'
  | 'security_safety'
  | 'permissions'
  | 'monitoring'
  | 'golden_regression'
  | 'export_parity'
  | 'phase10_intelligence'
  | 'rollout_readiness'
  | 'ci_configuration'
  | 'live_environment';

export const PDF_IMPORT_RELEASE_GATE_DOMAINS: PdfImportReleaseGateDomain[] = [
  'source_integrity',
  'documentation',
  'schemas',
  'sql',
  'tests',
  'build',
  'private_artifacts',
  'security_safety',
  'permissions',
  'monitoring',
  'golden_regression',
  'export_parity',
  'phase10_intelligence',
  'rollout_readiness',
  'ci_configuration',
  'live_environment',
];

export type PdfImportReleaseGateSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

export const PDF_IMPORT_RELEASE_GATE_SEVERITIES: PdfImportReleaseGateSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

export type PdfImportReleaseGateCheckStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'skipped'
  | 'unknown';

export const PDF_IMPORT_RELEASE_GATE_CHECK_STATUSES: PdfImportReleaseGateCheckStatus[] = [
  'pass',
  'warning',
  'fail',
  'skipped',
  'unknown',
];

export interface PdfImportReleaseGateCheck {
  id: string;
  domain: PdfImportReleaseGateDomain;
  severity: PdfImportReleaseGateSeverity;
  status: PdfImportReleaseGateCheckStatus;
  title: string;
  message: string;
  evidence: string[];
  remediation: string;
}

export interface PdfImportReleaseGateSummary {
  total: number;
  pass: number;
  warning: number;
  fail: number;
  skipped: number;
  unknown: number;
  criticalFailures: number;
  highFailures: number;
}

export interface PdfImportReleaseGateReport {
  version: typeof PDF_IMPORT_RELEASE_GATE_VERSION;
  mode: PdfImportReleaseGateMode;
  decision: PdfImportReleaseGateDecision;
  score: number;
  checks: PdfImportReleaseGateCheck[];
  summary: PdfImportReleaseGateSummary;
  generatedAt: string;
  branch: string | null;
  commit: string | null;
}

export interface EvaluatePdfImportReleaseGateOptions {
  mode?: PdfImportReleaseGateMode;
  checks: PdfImportReleaseGateCheck[];
  now?: () => Date;
  branch?: string | null;
  commit?: string | null;
}
