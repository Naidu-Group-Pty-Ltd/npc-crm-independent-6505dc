/**
 * goldenRegressionTypes — Phase 8D persistence data model.
 *
 * A golden regression summary is a compact record of a single golden corpus run:
 * it combines the Phase 8B run evaluation (metadata snapshot + run status/decision)
 * with the Phase 8C quality-gate verdict, plus an operator decision. It is persisted
 * onto `template_imports.meta.golden_regression_summary` (no dedicated table in 8D).
 */
import type { GoldenCorpusCategory } from './goldenCorpusTypes';
import type { GoldenCorpusRunDecision, GoldenCorpusRunStatus } from './goldenCorpusRunTypes';
import type {
  PdfImportQualityGateStatus,
  PdfImportQualityGateSummary,
} from '../qualityGates/pdfImportQualityGateTypes';

export const GOLDEN_REGRESSION_SUMMARY_VERSION = 'pdf-import-golden-regression-summary-v1';

export type GoldenRegressionOperatorDecision =
  | 'accepted'
  | 'accepted_with_warnings'
  | 'rejected'
  | 'needs_rerun'
  | 'not_reviewed';

export interface GoldenRegressionSummary {
  version: typeof GOLDEN_REGRESSION_SUMMARY_VERSION;

  runId: string;
  runBatchId: string | null;

  corpusId: string;
  category: GoldenCorpusCategory;

  importId: string;
  templateId: string | null;
  sourceFilename: string | null;

  engineVersion: string | null;
  importStatus: string | null;
  runStatus: GoldenCorpusRunStatus;
  runDecision: GoldenCorpusRunDecision;

  importPageCount: number | null;
  templatePageCount: number | null;

  visualQaScore: number | null;
  visualQaManualReviewRequired: boolean | null;

  repairStatus: string | null;
  repairFinalScore: number | null;
  repairRequiresFallback: boolean | null;
  repairRequiresManualReview: boolean | null;

  aiReconciliationStatus: string | null;
  aiReconciliationRecommendation: string | null;

  exportParityStatus: string | null;
  exportParityMode: string | null;
  exportVsSourceScore: number | null;
  editorVsSourceScore: number | null;
  exportVsEditorScore: number | null;

  qualityGateStatus: PdfImportQualityGateStatus;
  gateSummary: PdfImportQualityGateSummary;

  warnings: string[];
  failures: string[];

  operatorDecision: GoldenRegressionOperatorDecision;
  notes: string[];

  generatedAt: string;
  persistedAt: string | null;
}

export interface BuildGoldenRegressionSummaryOptions {
  runBatchId?: string | null;
  operatorDecision?: GoldenRegressionOperatorDecision;
  notes?: string[];
  now?: () => Date;
}

export type SaveGoldenRegressionSummaryResult =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export type LoadGoldenRegressionSummaryResult =
  | { kind: 'ok'; summary: GoldenRegressionSummary }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };
