/**
 * pdfImportQualityGateTypes — Phase 8C quality-gate data model.
 *
 * Phase 8A defines *what* to test; Phase 8B evaluates *how a run went*; Phase 8C
 * decides *whether the run passes quality thresholds*. The gate layer consumes a
 * Phase 8B `GoldenCorpusRunEvaluation` and produces a structured gate report.
 * Below-threshold scores and missing required artifacts are hard failures here
 * (unlike Phase 8B, where they were warnings). Nothing is persisted (Phase 8D).
 */

export const PDF_IMPORT_QUALITY_GATE_VERSION = 'pdf-import-quality-gates-v1';

export type PdfImportQualityGateStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'blocked'
  | 'not_evaluated';

export type PdfImportQualityGateSeverity =
  | 'info'
  | 'warning'
  | 'error'
  | 'blocking';

export type PdfImportQualityGateCategory =
  | 'import'
  | 'template'
  | 'artifact'
  | 'visual_quality'
  | 'repair'
  | 'ai_reconciliation'
  | 'export_parity'
  | 'diagnostics'
  | 'metadata';

export interface PdfImportQualityGate {
  id: string;
  category: PdfImportQualityGateCategory;
  label: string;
  status: PdfImportQualityGateStatus;
  severity: PdfImportQualityGateSeverity;
  message: string;
  blocking: boolean;
  details?: Record<string, unknown>;
}

export interface PdfImportQualityGateSummary {
  total: number;
  pass: number;
  warning: number;
  fail: number;
  blocked: number;
  notEvaluated: number;
}

export interface PdfImportQualityGateReport {
  version: typeof PDF_IMPORT_QUALITY_GATE_VERSION;
  corpusId: string;
  importId: string | null;
  templateId: string | null;
  overallStatus: PdfImportQualityGateStatus;
  gates: PdfImportQualityGate[];
  summary: PdfImportQualityGateSummary;
  generatedAt: string;
}

/** A gate is "failing" for confidence purposes when it is a hard fail or a blocked prerequisite. */
export function isFailingQualityGate(gate: PdfImportQualityGate): boolean {
  return gate.status === 'fail' || gate.status === 'blocked';
}

/** Count gate statuses into a summary. */
export function summarizeQualityGates(
  gates: PdfImportQualityGate[],
): PdfImportQualityGateSummary {
  const summary: PdfImportQualityGateSummary = {
    total: gates.length,
    pass: 0,
    warning: 0,
    fail: 0,
    blocked: 0,
    notEvaluated: 0,
  };
  for (const gate of gates) {
    switch (gate.status) {
      case 'pass':
        summary.pass += 1;
        break;
      case 'warning':
        summary.warning += 1;
        break;
      case 'fail':
        summary.fail += 1;
        break;
      case 'blocked':
        summary.blocked += 1;
        break;
      case 'not_evaluated':
        summary.notEvaluated += 1;
        break;
    }
  }
  return summary;
}

/**
 * Overall status precedence: blocked > fail > warning > pass, with all-not_evaluated
 * collapsing to not_evaluated.
 */
export function resolveOverallQualityGateStatus(
  gates: PdfImportQualityGate[],
): PdfImportQualityGateStatus {
  if (gates.length === 0) return 'not_evaluated';
  if (gates.some((g) => g.status === 'blocked')) return 'blocked';
  if (gates.some((g) => g.status === 'fail')) return 'fail';
  if (gates.some((g) => g.status === 'warning')) return 'warning';
  if (gates.every((g) => g.status === 'not_evaluated')) return 'not_evaluated';
  return 'pass';
}
