/**
 * goldenRunHistorySummary — Phase 9C.
 *
 * Pure transforms for the history ledger:
 *   - `buildGoldenRunHistoryRecordInput`: a Phase 8D `GoldenRegressionSummary`
 *     (+ triage + baseline) → an insert payload for `pdf_import_golden_runs`.
 *   - `normalizeGoldenRunHistoryRecord`: a loosely-typed edge/DB payload (snake
 *     or camel case) → a `GoldenRunHistoryRecord`.
 * No I/O here — persistence lives in `goldenRunHistoryPersistence.ts`.
 */
import type {
  GoldenRegressionSummary,
} from './goldenRegressionTypes';

import type {
  PdfImportFailureTriageSummary,
} from '../failureTriage/pdfImportFailureTriageTypes';

import type {
  BuildGoldenRunHistoryRecordInput,
  GoldenRunHistoryInput,
  GoldenRunHistoryRecord,
} from './goldenRunHistoryTypes';

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function toScoreOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toBoolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function toStringList(value: unknown): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const s = String(raw ?? '').trim();
    if (s) out.push(s);
  }
  return out;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Count a warnings payload defensively: array → length, anything else → 0. */
export function countGoldenRunWarnings(warnings: unknown): number {
  return Array.isArray(warnings) ? warnings.length : 0;
}

/** Count a failures payload defensively: array → length, anything else → 0. */
export function countGoldenRunFailures(failures: unknown): number {
  return Array.isArray(failures) ? failures.length : 0;
}

/**
 * Build a persistable history input from a golden regression summary. Warning /
 * failure counts are derived from the summary's arrays so the row and its
 * embedded summary can never disagree.
 */
export function buildGoldenRunHistoryRecordInput(
  input: BuildGoldenRunHistoryRecordInput,
): GoldenRunHistoryInput {
  const summary = input?.goldenRegressionSummary as GoldenRegressionSummary | undefined;

  if (!summary) throw new Error('goldenRegressionSummary is required.');
  if (!summary.importId) throw new Error('importId is required for golden run history.');
  if (!summary.runId) throw new Error('runId is required for golden run history.');
  if (!summary.corpusId) throw new Error('corpusId is required for golden run history.');

  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  const failures = Array.isArray(summary.failures) ? summary.failures : [];

  return {
    runId: summary.runId,
    runBatchId: summary.runBatchId ?? null,

    corpusId: summary.corpusId,
    category: summary.category,

    importId: summary.importId,
    templateId: summary.templateId ?? null,

    sourceFilename: summary.sourceFilename ?? null,
    engineVersion: summary.engineVersion ?? null,

    orchestratorVersion: input.orchestratorVersion ?? null,
    summaryVersion: summary.version ?? null,

    importStatus: summary.importStatus ?? null,
    runStatus: summary.runStatus ?? null,
    runDecision: summary.runDecision ?? null,

    qualityGateStatus: summary.qualityGateStatus,
    operatorDecision: summary.operatorDecision,

    importPageCount: summary.importPageCount ?? null,
    templatePageCount: summary.templatePageCount ?? null,

    visualQaScore: summary.visualQaScore ?? null,
    visualQaManualReviewRequired: summary.visualQaManualReviewRequired ?? null,

    repairStatus: summary.repairStatus ?? null,
    repairFinalScore: summary.repairFinalScore ?? null,
    repairRequiresFallback: summary.repairRequiresFallback ?? null,
    repairRequiresManualReview: summary.repairRequiresManualReview ?? null,

    aiReconciliationStatus: summary.aiReconciliationStatus ?? null,
    aiReconciliationRecommendation: summary.aiReconciliationRecommendation ?? null,

    exportParityStatus: summary.exportParityStatus ?? null,
    exportParityMode: summary.exportParityMode ?? null,
    exportVsSourceScore: summary.exportVsSourceScore ?? null,
    editorVsSourceScore: summary.editorVsSourceScore ?? null,
    exportVsEditorScore: summary.exportVsEditorScore ?? null,

    warningCount: warnings.length,
    failureCount: failures.length,

    warnings: warnings.map((w) => String(w)),
    failures: failures.map((f) => String(f)),

    gateSummary: summary.gateSummary ?? {},
    triageSummary: (input.triageSummary as unknown as Record<string, unknown> | null | undefined) ?? {},
    goldenRegressionSummary: summary,

    baselineComparison: input.baselineComparison ?? null,
  };
}

/** Read either a camelCase or snake_case key from a loose record. */
function pick(raw: Record<string, unknown>, camel: string, snake: string): unknown {
  return raw[camel] !== undefined ? raw[camel] : raw[snake];
}

/**
 * Coerce a loosely-typed history payload (edge function response or a raw DB
 * row, either casing) into a `GoldenRunHistoryRecord`. Throws when a required
 * identity field is missing.
 */
export function normalizeGoldenRunHistoryRecord(raw: unknown): GoldenRunHistoryRecord {
  const r = toObject(raw);

  const id = toStringOrNull(r.id);
  const runId = toStringOrNull(pick(r, 'runId', 'run_id'));
  const corpusId = toStringOrNull(pick(r, 'corpusId', 'corpus_id'));
  const importId = toStringOrNull(pick(r, 'importId', 'import_id'));
  const qualityGateStatus = toStringOrNull(pick(r, 'qualityGateStatus', 'quality_gate_status'));
  const operatorDecision = toStringOrNull(pick(r, 'operatorDecision', 'operator_decision'));

  if (!id) throw new Error('Golden run history record is missing id.');
  if (!runId) throw new Error('Golden run history record is missing runId.');
  if (!corpusId) throw new Error('Golden run history record is missing corpusId.');
  if (!importId) throw new Error('Golden run history record is missing importId.');
  if (!qualityGateStatus) throw new Error('Golden run history record is missing qualityGateStatus.');
  if (!operatorDecision) throw new Error('Golden run history record is missing operatorDecision.');

  const warnings = toStringList(pick(r, 'warnings', 'warnings'));
  const failures = toStringList(pick(r, 'failures', 'failures'));
  const rawWarningCount = pick(r, 'warningCount', 'warning_count');
  const rawFailureCount = pick(r, 'failureCount', 'failure_count');
  const baseline = pick(r, 'baselineComparison', 'baseline_comparison');

  return {
    id,
    runId,
    runBatchId: toStringOrNull(pick(r, 'runBatchId', 'run_batch_id')),

    corpusId,
    category: toStringOrNull(pick(r, 'category', 'category')) ?? 'unknown',

    importId,
    templateId: toStringOrNull(pick(r, 'templateId', 'template_id')),

    sourceFilename: toStringOrNull(pick(r, 'sourceFilename', 'source_filename')),
    engineVersion: toStringOrNull(pick(r, 'engineVersion', 'engine_version')),

    orchestratorVersion: toStringOrNull(pick(r, 'orchestratorVersion', 'orchestrator_version')),
    summaryVersion: toStringOrNull(pick(r, 'summaryVersion', 'summary_version')),

    importStatus: toStringOrNull(pick(r, 'importStatus', 'import_status')),
    runStatus: toStringOrNull(pick(r, 'runStatus', 'run_status')),
    runDecision: toStringOrNull(pick(r, 'runDecision', 'run_decision')),

    qualityGateStatus,
    operatorDecision,

    importPageCount: toIntOrNull(pick(r, 'importPageCount', 'import_page_count')),
    templatePageCount: toIntOrNull(pick(r, 'templatePageCount', 'template_page_count')),

    visualQaScore: toScoreOrNull(pick(r, 'visualQaScore', 'visual_qa_score')),
    visualQaManualReviewRequired: toBoolOrNull(pick(r, 'visualQaManualReviewRequired', 'visual_qa_manual_review_required')),

    repairStatus: toStringOrNull(pick(r, 'repairStatus', 'repair_status')),
    repairFinalScore: toScoreOrNull(pick(r, 'repairFinalScore', 'repair_final_score')),
    repairRequiresFallback: toBoolOrNull(pick(r, 'repairRequiresFallback', 'repair_requires_fallback')),
    repairRequiresManualReview: toBoolOrNull(pick(r, 'repairRequiresManualReview', 'repair_requires_manual_review')),

    aiReconciliationStatus: toStringOrNull(pick(r, 'aiReconciliationStatus', 'ai_reconciliation_status')),
    aiReconciliationRecommendation: toStringOrNull(pick(r, 'aiReconciliationRecommendation', 'ai_reconciliation_recommendation')),

    exportParityStatus: toStringOrNull(pick(r, 'exportParityStatus', 'export_parity_status')),
    exportParityMode: toStringOrNull(pick(r, 'exportParityMode', 'export_parity_mode')),
    exportVsSourceScore: toScoreOrNull(pick(r, 'exportVsSourceScore', 'export_vs_source_score')),
    editorVsSourceScore: toScoreOrNull(pick(r, 'editorVsSourceScore', 'editor_vs_source_score')),
    exportVsEditorScore: toScoreOrNull(pick(r, 'exportVsEditorScore', 'export_vs_editor_score')),

    warningCount: rawWarningCount === undefined || rawWarningCount === null
      ? warnings.length
      : (Number.isFinite(Number(rawWarningCount)) ? Math.max(0, Math.trunc(Number(rawWarningCount))) : warnings.length),
    failureCount: rawFailureCount === undefined || rawFailureCount === null
      ? failures.length
      : (Number.isFinite(Number(rawFailureCount)) ? Math.max(0, Math.trunc(Number(rawFailureCount))) : failures.length),

    warnings,
    failures,

    gateSummary: toObject(pick(r, 'gateSummary', 'gate_summary')),
    triageSummary: toObject(pick(r, 'triageSummary', 'triage_summary')),
    goldenRegressionSummary: toObject(pick(r, 'goldenRegressionSummary', 'golden_regression_summary')),

    baselineComparison: baseline && typeof baseline === 'object'
      ? (baseline as GoldenRunHistoryRecord['baselineComparison'])
      : null,

    createdBy: toStringOrNull(pick(r, 'createdBy', 'created_by')),
    createdAt: toStringOrNull(pick(r, 'createdAt', 'created_at')) ?? '',
    updatedAt: toStringOrNull(pick(r, 'updatedAt', 'updated_at')) ?? '',
  };
}
