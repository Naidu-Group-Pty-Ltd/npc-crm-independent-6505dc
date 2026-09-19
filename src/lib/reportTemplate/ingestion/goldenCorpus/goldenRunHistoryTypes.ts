/**
 * goldenRunHistoryTypes — Phase 9C regression-history data model.
 *
 * Phase 8D persists only the latest golden regression summary onto
 * `template_imports.meta.golden_regression_summary`. Phase 9C adds a durable
 * historical ledger — one row per persisted golden run in
 * `public.pdf_import_golden_runs` — so history, trends, and baseline
 * comparisons survive beyond that latest summary. Nothing here performs I/O.
 */
import type {
  GoldenCorpusCategory,
} from './goldenCorpusTypes';

import type {
  GoldenRegressionSummary,
  GoldenRegressionOperatorDecision,
} from './goldenRegressionTypes';

import type {
  GoldenCorpusRunDecision,
  GoldenCorpusRunStatus,
} from './goldenCorpusRunTypes';

import type {
  PdfImportQualityGateStatus,
  PdfImportQualityGateSummary,
} from '../qualityGates/pdfImportQualityGateTypes';

import type {
  PdfImportFailureTriageSummary,
} from '../failureTriage/pdfImportFailureTriageTypes';

export const GOLDEN_RUN_HISTORY_VERSION =
  'pdf-import-golden-run-history-v1';

export type GoldenRunBaselineComparisonOutcome =
  | 'improved'
  | 'stable'
  | 'degraded'
  | 'no_baseline'
  | 'unknown';

export type GoldenRunMetricComparisonDirection =
  | 'up'
  | 'down'
  | 'same'
  | 'unknown';

export interface GoldenRunMetricComparison {
  metric: string;
  previous: number | null;
  current: number | null;
  delta: number | null;
  direction: GoldenRunMetricComparisonDirection;
  tolerance: number;
  outcome: GoldenRunBaselineComparisonOutcome;
  message: string;
}

export interface GoldenRunStatusComparison {
  previous: string | null;
  current: string | null;
  outcome: GoldenRunBaselineComparisonOutcome;
  message: string;
}

export interface GoldenRunBaselineComparison {
  version: typeof GOLDEN_RUN_HISTORY_VERSION;
  corpusId: string;
  previousHistoryId: string | null;
  previousRunId: string | null;
  currentRunId: string;
  outcome: GoldenRunBaselineComparisonOutcome;
  qualityGateStatus: GoldenRunStatusComparison;
  operatorDecision: GoldenRunStatusComparison;
  metrics: GoldenRunMetricComparison[];
  warningCountDelta: number | null;
  failureCountDelta: number | null;
  messages: string[];
  comparedAt: string;
}

export interface GoldenRunHistoryRecord {
  id: string;
  runId: string;
  runBatchId: string | null;

  corpusId: string;
  category: GoldenCorpusCategory | string;

  importId: string;
  templateId: string | null;

  sourceFilename: string | null;
  engineVersion: string | null;

  orchestratorVersion: string | null;
  summaryVersion: string | null;

  importStatus: string | null;
  runStatus: GoldenCorpusRunStatus | string | null;
  runDecision: GoldenCorpusRunDecision | string | null;

  qualityGateStatus: PdfImportQualityGateStatus | string;
  operatorDecision: GoldenRegressionOperatorDecision | string;

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

  warningCount: number;
  failureCount: number;

  warnings: string[];
  failures: string[];

  gateSummary: PdfImportQualityGateSummary | Record<string, unknown>;
  triageSummary: PdfImportFailureTriageSummary | Record<string, unknown>;
  goldenRegressionSummary: GoldenRegressionSummary | Record<string, unknown>;

  baselineComparison: GoldenRunBaselineComparison | null;

  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildGoldenRunHistoryRecordInput {
  goldenRegressionSummary: GoldenRegressionSummary;
  triageSummary?: PdfImportFailureTriageSummary | null;
  orchestratorVersion?: string | null;
  baselineComparison?: GoldenRunBaselineComparison | null;
}

export type GoldenRunHistoryInput = Omit<
  GoldenRunHistoryRecord,
  'id' | 'createdBy' | 'createdAt' | 'updatedAt'
>;

export type SaveGoldenRunHistoryResult =
  | { kind: 'ok'; historyId: string; history: GoldenRunHistoryRecord | null }
  | { kind: 'error'; message: string };

export type ListGoldenRunHistoryResult =
  | { kind: 'ok'; history: GoldenRunHistoryRecord[] }
  | { kind: 'error'; message: string };

export type GetGoldenRunHistoryResult =
  | { kind: 'ok'; history: GoldenRunHistoryRecord }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export type GetGoldenRunBaselinesResult =
  | { kind: 'ok'; baselines: GoldenRunHistoryRecord[] }
  | { kind: 'error'; message: string };

export interface GoldenRunHistoryListOptions {
  corpusId?: string | null;
  importId?: string | null;
  limit?: number;
}

export interface GoldenRunBaselineComparisonOptions {
  previous: GoldenRunHistoryRecord | null;
  current: GoldenRunHistoryRecord;
  now?: () => Date;
  scoreDropTolerance?: number;
}
