/**
 * goldenRegressionSummary — Phase 8D builder.
 *
 * Combines a Phase 8B `GoldenCorpusRunEvaluation` and a Phase 8C
 * `PdfImportQualityGateReport` into a compact, persistable `GoldenRegressionSummary`.
 * No I/O here — persistence lives in `goldenRegressionPersistence.ts`.
 */
import type { GoldenCorpusRunEvaluation } from './goldenCorpusRunTypes';
import type { PdfImportQualityGateReport } from '../qualityGates/pdfImportQualityGateTypes';
import {
  GOLDEN_REGRESSION_SUMMARY_VERSION,
  type BuildGoldenRegressionSummaryOptions,
  type GoldenRegressionOperatorDecision,
  type GoldenRegressionSummary,
} from './goldenRegressionTypes';
import type { PdfImportQualityGateStatus } from '../qualityGates/pdfImportQualityGateTypes';

const DEFAULT_DECISION_BY_GATE_STATUS: Record<PdfImportQualityGateStatus, GoldenRegressionOperatorDecision> = {
  pass: 'accepted',
  warning: 'accepted_with_warnings',
  fail: 'rejected',
  blocked: 'needs_rerun',
  not_evaluated: 'not_reviewed',
};

/** Trim, drop blanks, dedupe (order-preserving). */
function normalizeStringList(values: unknown): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const s = String(raw ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function buildGoldenRegressionSummary(options: {
  runEvaluation: GoldenCorpusRunEvaluation;
  qualityGateReport: PdfImportQualityGateReport;
  summaryOptions?: BuildGoldenRegressionSummaryOptions;
}): GoldenRegressionSummary {
  const { runEvaluation, qualityGateReport, summaryOptions } = options ?? ({} as typeof options);

  if (!runEvaluation) throw new Error('runEvaluation is required.');
  if (!qualityGateReport) throw new Error('qualityGateReport is required.');

  const importId = runEvaluation.snapshot?.importId ?? qualityGateReport.importId ?? null;
  if (!importId) {
    throw new Error('importId is required to build a golden regression summary.');
  }

  if (runEvaluation.corpusId !== qualityGateReport.corpusId) {
    throw new Error('Corpus ID mismatch between run evaluation and quality gate report.');
  }

  const now = (summaryOptions?.now ?? (() => new Date()))();
  const snapshot = runEvaluation.snapshot;
  const qualityGateStatus = qualityGateReport.overallStatus;

  // Warnings: run-level warnings + warning gates (id:message), deduped.
  const warnings = normalizeStringList([
    ...runEvaluation.warnings,
    ...qualityGateReport.gates
      .filter((g) => g.status === 'warning')
      .map((g) => `${g.id}:${g.message}`),
  ]);

  // Failures: run-level failures + fail/blocked gates (id:message), deduped.
  const failures = normalizeStringList([
    ...runEvaluation.failures,
    ...qualityGateReport.gates
      .filter((g) => g.status === 'fail' || g.status === 'blocked')
      .map((g) => `${g.id}:${g.message}`),
  ]);

  const operatorDecision =
    summaryOptions?.operatorDecision ?? DEFAULT_DECISION_BY_GATE_STATUS[qualityGateStatus] ?? 'not_reviewed';

  return {
    version: GOLDEN_REGRESSION_SUMMARY_VERSION,

    runId: runEvaluation.runId,
    runBatchId: summaryOptions?.runBatchId ?? null,

    corpusId: runEvaluation.corpusId,
    category: runEvaluation.category,

    importId,
    templateId: snapshot.templateId ?? null,
    sourceFilename: snapshot.sourceFilename ?? null,

    engineVersion: snapshot.engineVersion ?? null,
    importStatus: snapshot.importStatus ?? null,
    runStatus: runEvaluation.status,
    runDecision: runEvaluation.decision,

    importPageCount: snapshot.importPageCount ?? null,
    templatePageCount: snapshot.templatePageCount ?? null,

    visualQaScore: snapshot.visualQaScore ?? null,
    visualQaManualReviewRequired: snapshot.visualQaManualReviewRequired ?? null,

    repairStatus: snapshot.repairStatus ?? null,
    repairFinalScore: snapshot.repairFinalScore ?? null,
    repairRequiresFallback: snapshot.repairRequiresFallback ?? null,
    repairRequiresManualReview: snapshot.repairRequiresManualReview ?? null,

    aiReconciliationStatus: snapshot.aiReconciliationStatus ?? null,
    aiReconciliationRecommendation: snapshot.aiReconciliationRecommendation ?? null,

    exportParityStatus: snapshot.exportParityStatus ?? null,
    exportParityMode: snapshot.exportParityMode ?? null,
    exportVsSourceScore: snapshot.exportVsSourceScore ?? null,
    editorVsSourceScore: snapshot.editorVsSourceScore ?? null,
    exportVsEditorScore: snapshot.exportVsEditorScore ?? null,

    qualityGateStatus,
    gateSummary: qualityGateReport.summary,

    warnings,
    failures,

    operatorDecision,
    notes: normalizeStringList(summaryOptions?.notes),

    generatedAt: now.toISOString(),
    persistedAt: null,
  };
}

/** Return a copy of the summary with `persistedAt` set. */
export function withGoldenRegressionPersistedAt(
  summary: GoldenRegressionSummary,
  persistedAt: string,
): GoldenRegressionSummary {
  return { ...summary, persistedAt };
}

/**
 * Shape the summary for storage in `template_imports.meta`. Currently a pass-through;
 * kept as a seam so a future phase can compact the persisted shape without touching callers.
 */
export function summarizeGoldenRegressionForMeta(
  summary: GoldenRegressionSummary,
): GoldenRegressionSummary {
  return summary;
}
