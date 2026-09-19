/**
 * pdfImportReleaseGateTypes — Phase 9E release gate data model.
 *
 * A release gate is a single pre-release check with a status, a severity, and a
 * "required" flag. Gates are grouped into three classes by category: automated
 * local gates (files/json/tests/build/security/documentation), database/SQL gates
 * (sql/database), and manual/browser gates (browser/manual). The evaluator rolls
 * a set of gates into a single release decision. Nothing here performs I/O — the
 * caller (a release script or CI harness) supplies each gate's real status.
 */

export const PDF_IMPORT_RELEASE_GATE_VERSION = 'pdf-import-release-gates-v1';

export type PdfImportReleaseGateCategory =
  | 'files'
  | 'json'
  | 'tests'
  | 'build'
  | 'security'
  | 'sql'
  | 'browser'
  | 'database'
  | 'documentation'
  | 'manual';

export type PdfImportReleaseGateStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'not_run'
  | 'not_applicable';

export type PdfImportReleaseDecision =
  | 'release_ready'
  | 'release_ready_with_warnings'
  | 'release_blocked';

export type PdfImportReleaseGateSeverity =
  | 'info'
  | 'warning'
  | 'blocking';

export interface PdfImportReleaseGate {
  id: string;
  category: PdfImportReleaseGateCategory;
  label: string;
  status: PdfImportReleaseGateStatus;
  severity: PdfImportReleaseGateSeverity;
  required: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface PdfImportReleaseGateSummary {
  total: number;
  pass: number;
  warning: number;
  fail: number;
  notRun: number;
  notApplicable: number;
  requiredFailures: number;
  requiredNotRun: number;
}

export interface PdfImportReleaseGateReport {
  version: typeof PDF_IMPORT_RELEASE_GATE_VERSION;
  decision: PdfImportReleaseDecision;
  gates: PdfImportReleaseGate[];
  summary: PdfImportReleaseGateSummary;
  warnings: string[];
  blockers: string[];
  generatedAt: string;
}

export interface PdfImportReleaseGateInput {
  gates: PdfImportReleaseGate[];
  allowManualPending?: boolean;
  now?: () => Date;
}

export interface PdfImportReleaseChecklistStatus {
  requiredFilesPresent: boolean;
  registryJsonValid: boolean;
  testsPassed: boolean;
  buildPassed: boolean;
  privateArtifactsClear: boolean;
  sqlChecksRun: boolean;
  browserChecksRun: boolean;
}

/**
 * Categories that always block on a required fail / not_run, even when manual
 * checks are allowed to be pending (these are locally automatable).
 */
export const PDF_IMPORT_RELEASE_AUTOMATED_CATEGORIES: readonly PdfImportReleaseGateCategory[] = [
  'files',
  'json',
  'tests',
  'build',
  'security',
  'documentation',
];

/**
 * Categories whose required not_run gates may be downgraded from blocking to a
 * warning when `allowManualPending` is set (these require a human / DB / browser).
 */
export const PDF_IMPORT_RELEASE_MANUAL_CATEGORIES: readonly PdfImportReleaseGateCategory[] = [
  'sql',
  'database',
  'browser',
  'manual',
];
