/**
 * goldenCorpusRunTypes — Phase 8B run/evaluation data model.
 *
 * Phase 8A defined *what* the golden corpus is. Phase 8B defines *how a run is
 * recorded and validated*: an operator manually imports a golden PDF through the
 * browser, captures the resulting importId/templateId, and the evaluator checks
 * the resulting Phase 7 metadata snapshot against the corresponding registry item.
 * Nothing here uploads PDFs, automates the browser, or persists results.
 */
import type { GoldenCorpusCategory, GoldenCorpusItem } from './goldenCorpusTypes';

export const GOLDEN_CORPUS_RUN_VERSION = 'pdf-import-golden-run-v1';

export type GoldenCorpusRunMode =
  | 'manual_operator'
  | 'semi_automated_validation'
  | 'future_automated_browser';

export type GoldenCorpusRunStatus =
  | 'not_started'
  | 'import_recorded'
  | 'validation_ready'
  | 'validated'
  | 'blocked'
  | 'failed';

export type GoldenCorpusRunDecision =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'not_evaluated';

export interface GoldenCorpusRunReference {
  runId: string;
  corpusId: string;
  sourceFilename: string | null;
  importId: string | null;
  templateId: string | null;
  notes?: string | null;
}

export interface GoldenCorpusImportQualitySnapshot {
  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;
  importStatus: string | null;
  engineVersion: string | null;
  importPageCount: number | null;
  templatePageCount: number | null;

  visualQaArtifactPath: string | null;
  visualQaScore: number | null;
  visualQaManualReviewRequired: boolean | null;

  repairArtifactPath: string | null;
  repairStatus: string | null;
  repairFinalScore: number | null;
  repairRequiresFallback: boolean | null;
  repairRequiresManualReview: boolean | null;

  aiReconciliationStatus: string | null;
  aiReconciliationRecommendation: string | null;

  exportParityArtifactPath: string | null;
  exportParityStatus: string | null;
  exportParityMode: string | null;
  exportVsSourceScore: number | null;
  editorVsSourceScore: number | null;
  exportVsEditorScore: number | null;
}

export interface GoldenCorpusRunEvaluation {
  version: typeof GOLDEN_CORPUS_RUN_VERSION;
  runId: string;
  corpusId: string;
  category: GoldenCorpusCategory;
  status: GoldenCorpusRunStatus;
  decision: GoldenCorpusRunDecision;
  warnings: string[];
  failures: string[];
  snapshot: GoldenCorpusImportQualitySnapshot;
  corpus: GoldenCorpusItem;
  evaluatedAt: string;
}

export interface GoldenCorpusRunBatch {
  version: typeof GOLDEN_CORPUS_RUN_VERSION;
  runBatchId: string;
  description: string;
  createdAt: string;
  operator: string;
  mode: GoldenCorpusRunMode;
  runs: GoldenCorpusRunReference[];
}

export interface GoldenCorpusRunBatchEvaluation {
  version: typeof GOLDEN_CORPUS_RUN_VERSION;
  runBatchId: string;
  mode: GoldenCorpusRunMode;
  evaluations: GoldenCorpusRunEvaluation[];
  summary: {
    total: number;
    pass: number;
    warning: number;
    fail: number;
    notEvaluated: number;
  };
  evaluatedAt: string;
}
