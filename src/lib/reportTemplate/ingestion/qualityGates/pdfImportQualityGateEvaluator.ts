/**
 * pdfImportQualityGateEvaluator — Phase 8C.
 *
 * Consumes a Phase 8B `GoldenCorpusRunEvaluation` (which already carries the
 * registry `corpus` item and the Phase 7 metadata `snapshot`) and produces a
 * structured quality-gate report. This is the "formalized threshold" layer:
 * below-registry-minimum scores and missing required artifacts are hard `fail`s
 * here, whereas Phase 8B treated them as warnings. No persistence (Phase 8D).
 */
import type { GoldenCorpusRunEvaluation } from '../goldenCorpus/goldenCorpusRunTypes';
import {
  PDF_IMPORT_QUALITY_GATE_VERSION,
  resolveOverallQualityGateStatus,
  summarizeQualityGates,
  type PdfImportQualityGate,
  type PdfImportQualityGateCategory,
  type PdfImportQualityGateReport,
  type PdfImportQualityGateSeverity,
  type PdfImportQualityGateStatus,
} from './pdfImportQualityGateTypes';

export interface EvaluatePdfImportQualityGatesOptions {
  evaluation: GoldenCorpusRunEvaluation;
  now?: () => Date;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const STATUS_SEVERITY: Record<PdfImportQualityGateStatus, PdfImportQualityGateSeverity> = {
  pass: 'info',
  warning: 'warning',
  fail: 'error',
  blocked: 'blocking',
  not_evaluated: 'info',
};

function gate(
  id: string,
  category: PdfImportQualityGateCategory,
  label: string,
  status: PdfImportQualityGateStatus,
  message: string,
  details?: Record<string, unknown>,
): PdfImportQualityGate {
  return {
    id,
    category,
    label,
    status,
    severity: STATUS_SEVERITY[status],
    message,
    blocking: status === 'blocked',
    details,
  };
}

export function evaluatePdfImportQualityGates(
  options: EvaluatePdfImportQualityGatesOptions,
): PdfImportQualityGateReport {
  const { evaluation } = options;
  const now = (options.now ?? (() => new Date()))();
  const generatedAt = now.toISOString();

  const { corpus, snapshot, corpusId } = evaluation;
  const importId = snapshot.importId ?? null;
  const templateId = snapshot.templateId ?? null;
  const outcomes = corpus.expectedOutcomes;
  const thresholds = corpus.scoreThresholds;

  const report = (gates: PdfImportQualityGate[]): PdfImportQualityGateReport => ({
    version: PDF_IMPORT_QUALITY_GATE_VERSION,
    corpusId,
    importId,
    templateId,
    overallStatus: resolveOverallQualityGateStatus(gates),
    gates,
    summary: summarizeQualityGates(gates),
    generatedAt,
  });

  // If the operator never captured an import ID, there is nothing to gate.
  if (!importId) {
    return report([
      gate('import_completed', 'import', 'Import completed', 'not_evaluated', 'Import ID is missing.'),
    ]);
  }

  const gates: PdfImportQualityGate[] = [];

  // 1. Import completed.
  if (snapshot.importStatus === 'completed') {
    gates.push(gate('import_completed', 'import', 'Import completed', 'pass', 'Import completed.'));
  } else if (snapshot.importStatus === 'failed') {
    gates.push(gate('import_completed', 'import', 'Import completed', 'fail', 'Import failed.'));
  } else {
    gates.push(
      gate('import_completed', 'import', 'Import completed', 'blocked', 'Import is not completed.', {
        importStatus: snapshot.importStatus,
      }),
    );
  }

  // 2. Template created.
  gates.push(
    templateId
      ? gate('template_created', 'template', 'Template created', 'pass', 'Template exists.')
      : gate('template_created', 'template', 'Template created', 'fail', 'Template is missing.'),
  );

  // 3. Template page count match.
  if (!outcomes.templatePageCountShouldMatch) {
    gates.push(
      gate('template_page_count_match', 'template', 'Template page count match', 'not_evaluated',
        'Page count match is not required for this corpus item.'),
    );
  } else if (!isFiniteNumber(snapshot.importPageCount) || !isFiniteNumber(snapshot.templatePageCount)) {
    gates.push(
      gate('template_page_count_match', 'template', 'Template page count match', 'blocked',
        'Page count is unavailable.'),
    );
  } else if (snapshot.importPageCount === snapshot.templatePageCount) {
    gates.push(
      gate('template_page_count_match', 'template', 'Template page count match', 'pass',
        'Template page count matches import page count.', {
          importPageCount: snapshot.importPageCount,
          templatePageCount: snapshot.templatePageCount,
        }),
    );
  } else {
    gates.push(
      gate('template_page_count_match', 'template', 'Template page count match', 'fail',
        'Template page count does not match import page count.', {
          importPageCount: snapshot.importPageCount,
          templatePageCount: snapshot.templatePageCount,
        }),
    );
  }

  // 4. Visual QA artifact present.
  if (!outcomes.visualQaShouldRun) {
    gates.push(gate('visual_quality_artifact_present', 'visual_quality', 'Visual QA artifact present', 'not_evaluated',
      'Visual QA is not required for this corpus item.'));
  } else {
    gates.push(
      snapshot.visualQaArtifactPath
        ? gate('visual_quality_artifact_present', 'visual_quality', 'Visual QA artifact present', 'pass', 'Visual QA artifact exists.')
        : gate('visual_quality_artifact_present', 'visual_quality', 'Visual QA artifact present', 'fail', 'Visual QA artifact is missing.'),
    );
  }

  // 5. Visual QA score threshold (below threshold is a FAIL in Phase 8C).
  if (!outcomes.visualQaShouldRun) {
    gates.push(gate('visual_quality_score_threshold', 'visual_quality', 'Visual QA score threshold', 'not_evaluated',
      'Visual QA is not required for this corpus item.'));
  } else if (!isFiniteNumber(snapshot.visualQaScore)) {
    gates.push(gate('visual_quality_score_threshold', 'visual_quality', 'Visual QA score threshold', 'warning',
      'Visual QA score is missing.'));
  } else if (snapshot.visualQaScore >= thresholds.visualQaMinimum) {
    gates.push(gate('visual_quality_score_threshold', 'visual_quality', 'Visual QA score threshold', 'pass',
      'Visual QA score meets registry threshold.', { score: snapshot.visualQaScore, minimum: thresholds.visualQaMinimum }));
  } else {
    gates.push(gate('visual_quality_score_threshold', 'visual_quality', 'Visual QA score threshold', 'fail',
      'Visual QA score is below registry threshold.', { score: snapshot.visualQaScore, minimum: thresholds.visualQaMinimum }));
  }

  // 6. Repair audit present.
  if (!outcomes.repairShouldRunOrSkipSafely) {
    gates.push(gate('repair_audit_present', 'repair', 'Repair audit present', 'not_evaluated',
      'Repair is not required for this corpus item.'));
  } else {
    gates.push(
      snapshot.repairArtifactPath
        ? gate('repair_audit_present', 'repair', 'Repair audit present', 'pass', 'Repair audit exists.')
        : gate('repair_audit_present', 'repair', 'Repair audit present', 'fail', 'Repair audit is missing.'),
    );
  }

  // 7. Repair status acceptable.
  if (!outcomes.repairShouldRunOrSkipSafely) {
    gates.push(gate('repair_status_acceptable', 'repair', 'Repair status acceptable', 'not_evaluated',
      'Repair is not required for this corpus item.'));
  } else if (snapshot.repairStatus === 'completed') {
    gates.push(gate('repair_status_acceptable', 'repair', 'Repair status acceptable', 'pass', 'Repair completed.'));
  } else if (snapshot.repairStatus === 'skipped') {
    gates.push(gate('repair_status_acceptable', 'repair', 'Repair status acceptable', 'warning',
      'Repair skipped safely or no eligible pages.'));
  } else if (snapshot.repairStatus === 'failed') {
    gates.push(gate('repair_status_acceptable', 'repair', 'Repair status acceptable', 'fail', 'Repair failed.'));
  } else {
    gates.push(gate('repair_status_acceptable', 'repair', 'Repair status acceptable', 'blocked',
      'Repair status is missing or unknown.', { repairStatus: snapshot.repairStatus }));
  }

  // 8. Repair final score threshold (skipped repair does not enforce the threshold).
  if (!outcomes.repairShouldRunOrSkipSafely) {
    gates.push(gate('repair_final_score_threshold', 'repair', 'Repair final score threshold', 'not_evaluated',
      'Repair is not required for this corpus item.'));
  } else if (snapshot.repairStatus === 'skipped') {
    gates.push(gate('repair_final_score_threshold', 'repair', 'Repair final score threshold', 'warning',
      'Repair skipped; final score threshold not enforced.'));
  } else if (!isFiniteNumber(snapshot.repairFinalScore)) {
    gates.push(gate('repair_final_score_threshold', 'repair', 'Repair final score threshold', 'warning',
      'Repair final score is missing.'));
  } else if (snapshot.repairFinalScore >= thresholds.repairFinalMinimum) {
    gates.push(gate('repair_final_score_threshold', 'repair', 'Repair final score threshold', 'pass',
      'Repair final score meets registry threshold.', { score: snapshot.repairFinalScore, minimum: thresholds.repairFinalMinimum }));
  } else {
    gates.push(gate('repair_final_score_threshold', 'repair', 'Repair final score threshold', 'fail',
      'Repair final score is below registry threshold.', { score: snapshot.repairFinalScore, minimum: thresholds.repairFinalMinimum }));
  }

  // 9. Manual review policy.
  const manualReviewRequired =
    snapshot.visualQaManualReviewRequired === true || snapshot.repairRequiresManualReview === true;
  if (!manualReviewRequired) {
    gates.push(gate('manual_review_policy', 'visual_quality', 'Manual review policy', 'pass', 'Manual review not required.'));
  } else if (outcomes.manualReviewAllowed) {
    gates.push(gate('manual_review_policy', 'visual_quality', 'Manual review policy', 'warning',
      'Manual review required and allowed by registry.'));
  } else {
    gates.push(gate('manual_review_policy', 'visual_quality', 'Manual review policy', 'fail',
      'Manual review required but not allowed by registry.'));
  }

  // 10. Fallback policy.
  if (snapshot.repairRequiresFallback !== true) {
    gates.push(gate('fallback_policy', 'repair', 'Fallback policy', 'pass', 'Fallback not required.'));
  } else if (outcomes.fallbackAllowed) {
    gates.push(gate('fallback_policy', 'repair', 'Fallback policy', 'warning', 'Fallback required and allowed by registry.'));
  } else {
    gates.push(gate('fallback_policy', 'repair', 'Fallback policy', 'fail', 'Fallback required but not allowed by registry.'));
  }

  // 11. AI reconciliation policy (never a hard fail in Phase 8C).
  const aiStatus = snapshot.aiReconciliationStatus;
  const aiRec = snapshot.aiReconciliationRecommendation;
  if (aiStatus === 'completed') {
    gates.push(gate('ai_reconciliation_policy', 'ai_reconciliation', 'AI reconciliation policy', 'pass', 'AI reconciliation completed.'));
  } else if (aiStatus === 'failed') {
    gates.push(gate('ai_reconciliation_policy', 'ai_reconciliation', 'AI reconciliation policy', 'warning',
      'AI reconciliation failed but is non-blocking in Phase 8C.'));
  } else if (aiRec === 'recommended') {
    gates.push(gate('ai_reconciliation_policy', 'ai_reconciliation', 'AI reconciliation policy', 'warning',
      'AI reconciliation was recommended but not completed.'));
  } else if (aiRec === 'manual_review' && !aiStatus) {
    gates.push(gate('ai_reconciliation_policy', 'ai_reconciliation', 'AI reconciliation policy', 'warning',
      'AI reconciliation manual review was recommended but not completed.'));
  } else if (aiRec === 'not_needed') {
    gates.push(gate('ai_reconciliation_policy', 'ai_reconciliation', 'AI reconciliation policy', 'pass', 'AI reconciliation not needed.'));
  } else {
    gates.push(gate('ai_reconciliation_policy', 'ai_reconciliation', 'AI reconciliation policy', 'not_evaluated',
      'AI reconciliation was not evaluated.'));
  }

  // 12. Export parity artifact present (missing is a FAIL in Phase 8C).
  if (!outcomes.exportParityShouldBeRecordable) {
    gates.push(gate('export_parity_artifact_present', 'export_parity', 'Export parity artifact present', 'not_evaluated',
      'Export parity is not required for this corpus item.'));
  } else {
    gates.push(
      snapshot.exportParityArtifactPath
        ? gate('export_parity_artifact_present', 'export_parity', 'Export parity artifact present', 'pass', 'Export parity artifact exists.')
        : gate('export_parity_artifact_present', 'export_parity', 'Export parity artifact present', 'fail', 'Export parity artifact is missing.'),
    );
  }

  // 13. Export parity status acceptable.
  if (!outcomes.exportParityShouldBeRecordable) {
    gates.push(gate('export_parity_status_acceptable', 'export_parity', 'Export parity status acceptable', 'not_evaluated',
      'Export parity is not required for this corpus item.'));
  } else if (snapshot.exportParityStatus === 'completed') {
    gates.push(gate('export_parity_status_acceptable', 'export_parity', 'Export parity status acceptable', 'pass', 'Export parity completed.'));
  } else if (snapshot.exportParityStatus === 'manual_required') {
    gates.push(gate('export_parity_status_acceptable', 'export_parity', 'Export parity status acceptable', 'warning', 'Export parity requires manual review.'));
  } else if (snapshot.exportParityStatus === 'failed') {
    gates.push(gate('export_parity_status_acceptable', 'export_parity', 'Export parity status acceptable', 'fail', 'Export parity failed.'));
  } else {
    gates.push(gate('export_parity_status_acceptable', 'export_parity', 'Export parity status acceptable', 'blocked',
      'Export parity status is missing or unknown.', { exportParityStatus: snapshot.exportParityStatus }));
  }

  // 14. Export parity score threshold.
  if (!outcomes.exportParityShouldBeRecordable) {
    gates.push(gate('export_parity_score_threshold', 'export_parity', 'Export parity score threshold', 'not_evaluated',
      'Export parity is not required for this corpus item.'));
  } else {
    const scoreCandidates = [snapshot.exportVsSourceScore, snapshot.editorVsSourceScore, snapshot.exportVsEditorScore];
    const score = scoreCandidates.find((s): s is number => isFiniteNumber(s));
    if (!isFiniteNumber(score)) {
      gates.push(gate('export_parity_score_threshold', 'export_parity', 'Export parity score threshold', 'warning',
        snapshot.exportParityStatus === 'manual_required'
          ? 'Export parity score missing because manual review is required.'
          : 'Export parity score is missing.'));
    } else if (score >= thresholds.exportParityMinimum) {
      gates.push(gate('export_parity_score_threshold', 'export_parity', 'Export parity score threshold', 'pass',
        'Export parity score meets registry threshold.', { score, minimum: thresholds.exportParityMinimum }));
    } else {
      gates.push(gate('export_parity_score_threshold', 'export_parity', 'Export parity score threshold', 'fail',
        'Export parity score is below registry threshold.', { score, minimum: thresholds.exportParityMinimum }));
    }
  }

  // 15. Engine version present.
  gates.push(
    snapshot.engineVersion
      ? gate('engine_version_present', 'diagnostics', 'Engine version present', 'pass', 'Engine version is present.')
      : gate('engine_version_present', 'diagnostics', 'Engine version present', 'warning', 'Engine version is missing.'),
  );

  // 16. Required metadata present (clear metadata summary; overlaps earlier gates by design).
  if (!templateId) {
    gates.push(gate('required_metadata_present', 'metadata', 'Required metadata present', 'fail', 'Required metadata is missing: templateId.'));
  } else if (!snapshot.visualQaArtifactPath) {
    gates.push(gate('required_metadata_present', 'metadata', 'Required metadata present', 'fail', 'Required metadata is missing: visualQaArtifactPath.'));
  } else if (!snapshot.repairArtifactPath) {
    gates.push(gate('required_metadata_present', 'metadata', 'Required metadata present', 'fail', 'Required metadata is missing: repairArtifactPath.'));
  } else if (!isFiniteNumber(snapshot.importPageCount) || !isFiniteNumber(snapshot.templatePageCount)) {
    gates.push(gate('required_metadata_present', 'metadata', 'Required metadata present', 'warning', 'Page counts are incomplete.'));
  } else {
    gates.push(gate('required_metadata_present', 'metadata', 'Required metadata present', 'pass', 'All required metadata is present.'));
  }

  return report(gates);
}
