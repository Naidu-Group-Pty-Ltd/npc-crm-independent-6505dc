/**
 * goldenCorpusRunEvaluator — Phase 8B evaluation logic.
 *
 * Given a golden run reference (corpusId + operator-captured importId/templateId)
 * and a Phase 7 metadata snapshot for that import, decide whether the run is a
 * valid golden candidate: pass / warning / fail / not_evaluated. This layer does
 * NOT persist results (Phase 8D) and does NOT enforce hard production gates
 * (Phase 8C) — a below-threshold score is a warning here, never a hard failure.
 */
import { getGoldenCorpusItem } from './goldenCorpusRegistry';
import type { GoldenCorpusRegistry } from './goldenCorpusTypes';
import {
  GOLDEN_CORPUS_RUN_VERSION,
  type GoldenCorpusImportQualitySnapshot,
  type GoldenCorpusRunBatch,
  type GoldenCorpusRunBatchEvaluation,
  type GoldenCorpusRunDecision,
  type GoldenCorpusRunEvaluation,
  type GoldenCorpusRunReference,
  type GoldenCorpusRunStatus,
} from './goldenCorpusRunTypes';

/** Build a fully-null snapshot (all metadata absent) carrying only the importId. */
export function buildEmptyGoldenCorpusSnapshot(
  importId?: string | null,
): GoldenCorpusImportQualitySnapshot {
  return {
    importId: importId ?? null,
    templateId: null,
    sourceFilename: null,
    importStatus: null,
    engineVersion: null,
    importPageCount: null,
    templatePageCount: null,
    visualQaArtifactPath: null,
    visualQaScore: null,
    visualQaManualReviewRequired: null,
    repairArtifactPath: null,
    repairStatus: null,
    repairFinalScore: null,
    repairRequiresFallback: null,
    repairRequiresManualReview: null,
    aiReconciliationStatus: null,
    aiReconciliationRecommendation: null,
    exportParityArtifactPath: null,
    exportParityStatus: null,
    exportParityMode: null,
    exportVsSourceScore: null,
    editorVsSourceScore: null,
    exportVsEditorScore: null,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pushUnique(list: string[], code: string): void {
  if (!list.includes(code)) list.push(code);
}

export function evaluateGoldenCorpusRun(options: {
  run: GoldenCorpusRunReference;
  snapshot: GoldenCorpusImportQualitySnapshot;
  registry?: GoldenCorpusRegistry;
  now?: () => Date;
}): GoldenCorpusRunEvaluation {
  const { run, snapshot, registry } = options;
  const now = (options.now ?? (() => new Date()))();
  const evaluatedAt = now.toISOString();

  const corpus = getGoldenCorpusItem(run.corpusId, registry);
  if (!corpus) {
    throw new Error(`Unknown golden corpus ID: ${run.corpusId}`);
  }

  const warnings: string[] = [];
  const failures: string[] = [];

  const base = (status: GoldenCorpusRunStatus, decision: GoldenCorpusRunDecision): GoldenCorpusRunEvaluation => ({
    version: GOLDEN_CORPUS_RUN_VERSION,
    runId: run.runId,
    corpusId: run.corpusId,
    category: corpus.category,
    status,
    decision,
    warnings,
    failures,
    snapshot,
    corpus,
    evaluatedAt,
  });

  // 2. Missing importId → not evaluated.
  if (!run.importId) {
    pushUnique(warnings, 'import_id_missing');
    return base('not_started', 'not_evaluated');
  }

  // 3. Import failed → hard fail.
  if (snapshot.importStatus === 'failed') {
    pushUnique(failures, 'import_failed');
    return base('failed', 'fail');
  }

  // 4. Import not completed → not evaluated (nothing meaningful to validate yet).
  if (snapshot.importStatus !== 'completed') {
    pushUnique(warnings, 'import_not_completed');
    return base('import_recorded', 'not_evaluated');
  }

  const outcomes = corpus.expectedOutcomes;
  const thresholds = corpus.scoreThresholds;

  // 5. Missing template.
  const hasTemplate = !!snapshot.templateId;
  if (!hasTemplate) {
    pushUnique(failures, 'template_missing');
  }

  // 6. Template page count expectation (only when a template exists and match is required).
  if (hasTemplate && outcomes.templatePageCountShouldMatch) {
    if (isFiniteNumber(snapshot.importPageCount) && isFiniteNumber(snapshot.templatePageCount)) {
      if (snapshot.importPageCount !== snapshot.templatePageCount) {
        pushUnique(failures, 'template_page_count_mismatch');
      }
    } else {
      pushUnique(failures, 'template_page_count_unavailable');
    }
  }

  // 7. Visual QA requirement.
  if (outcomes.visualQaShouldRun) {
    if (!snapshot.visualQaArtifactPath) {
      pushUnique(failures, 'visual_quality_missing');
    } else if (!isFiniteNumber(snapshot.visualQaScore)) {
      pushUnique(warnings, 'visual_quality_score_missing');
    } else if (snapshot.visualQaScore < thresholds.visualQaMinimum) {
      pushUnique(warnings, 'visual_quality_below_registry_minimum');
    }
  }

  // 8. Repair requirement.
  if (outcomes.repairShouldRunOrSkipSafely) {
    if (!snapshot.repairArtifactPath) {
      pushUnique(failures, 'repair_audit_missing');
    } else if (snapshot.repairStatus === 'failed') {
      pushUnique(failures, 'repair_failed');
    } else if (snapshot.repairStatus === 'skipped') {
      pushUnique(warnings, 'repair_skipped_no_eligible_pages');
    } else if (!isFiniteNumber(snapshot.repairFinalScore)) {
      pushUnique(warnings, 'repair_final_score_missing');
    } else if (snapshot.repairFinalScore < thresholds.repairFinalMinimum) {
      pushUnique(warnings, 'repair_final_below_registry_minimum');
    }
  }

  // 9. Manual review and fallback.
  if (snapshot.visualQaManualReviewRequired === true) {
    if (outcomes.manualReviewAllowed) pushUnique(warnings, 'manual_review_required');
    else pushUnique(failures, 'manual_review_not_allowed');
  }
  if (snapshot.repairRequiresManualReview === true) {
    if (outcomes.manualReviewAllowed) pushUnique(warnings, 'repair_manual_review_required');
    else pushUnique(failures, 'repair_manual_review_not_allowed');
  }
  if (snapshot.repairRequiresFallback === true) {
    if (outcomes.fallbackAllowed) pushUnique(warnings, 'fallback_used');
    else pushUnique(failures, 'fallback_not_allowed');
  }

  // 10. AI reconciliation (optional in Phase 8B — never a failure here).
  const aiStatus = snapshot.aiReconciliationStatus;
  const aiRecommendation = snapshot.aiReconciliationRecommendation;
  if (aiStatus !== 'completed') {
    if (aiRecommendation === 'recommended' && !aiStatus) {
      pushUnique(warnings, 'ai_reconciliation_recommended_not_run');
    } else if (aiRecommendation === 'manual_review' && !aiStatus) {
      pushUnique(warnings, 'ai_reconciliation_manual_review_not_run');
    }
  }

  // 11. Export parity (recordable-but-not-hard-required in Phase 8B).
  if (outcomes.exportParityShouldBeRecordable) {
    if (snapshot.exportParityStatus === 'failed') {
      pushUnique(failures, 'export_parity_failed');
    } else if (!snapshot.exportParityArtifactPath) {
      pushUnique(warnings, 'export_parity_not_recorded');
    } else {
      if (snapshot.exportParityStatus === 'manual_required') {
        pushUnique(warnings, 'export_parity_manual_required');
      }
      if (isFiniteNumber(snapshot.exportVsSourceScore) && snapshot.exportVsSourceScore < thresholds.exportParityMinimum) {
        pushUnique(warnings, 'export_parity_below_registry_minimum');
      }
    }
  }

  // 12. Decision + status.
  let decision: GoldenCorpusRunDecision;
  if (failures.length > 0) decision = 'fail';
  else if (warnings.length > 0) decision = 'warning';
  else decision = 'pass';

  const status: GoldenCorpusRunStatus = decision === 'fail' ? 'failed' : 'validated';

  return base(status, decision);
}

export function evaluateGoldenCorpusRunBatch(options: {
  batch: GoldenCorpusRunBatch;
  snapshotsByImportId: Record<string, GoldenCorpusImportQualitySnapshot>;
  registry?: GoldenCorpusRegistry;
  now?: () => Date;
}): GoldenCorpusRunBatchEvaluation {
  const { batch, snapshotsByImportId, registry } = options;
  const now = options.now ?? (() => new Date());
  const evaluatedAt = now().toISOString();

  const evaluations: GoldenCorpusRunEvaluation[] = batch.runs.map((run) => {
    const snapshot =
      (run.importId ? snapshotsByImportId[run.importId] : undefined) ??
      buildEmptyGoldenCorpusSnapshot(run.importId);
    return evaluateGoldenCorpusRun({ run, snapshot, registry, now });
  });

  const summary = {
    total: evaluations.length,
    pass: evaluations.filter((e) => e.decision === 'pass').length,
    warning: evaluations.filter((e) => e.decision === 'warning').length,
    fail: evaluations.filter((e) => e.decision === 'fail').length,
    notEvaluated: evaluations.filter((e) => e.decision === 'not_evaluated').length,
  };

  return {
    version: GOLDEN_CORPUS_RUN_VERSION,
    runBatchId: batch.runBatchId,
    mode: batch.mode,
    evaluations,
    summary,
    evaluatedAt,
  };
}
