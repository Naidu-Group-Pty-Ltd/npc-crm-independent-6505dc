/**
 * pdfImportPerformanceOptimizer — Phase 10F.
 *
 * Builds the full advisory Performance + Cost audit: it composes signals, step
 * costs, staleness, and duplicate-work detection into optimization
 * recommendations, a cost score, a waste score, and an overall risk level. It is
 * advisory only — nothing here skips gates, calls AI, or mutates templates.
 */
import {
  PDF_IMPORT_PERFORMANCE_AUDIT_VERSION,
  type BuildPdfImportPerformanceAuditOptions,
  type PdfImportCostLevel,
  type PdfImportDuplicateWorkSignal,
  type PdfImportMetadataStaleness,
  type PdfImportOptimizationRecommendation,
  type PdfImportPerformanceCostAudit,
  type PdfImportPerformanceEvidence,
  type PdfImportPerformanceRiskLevel,
  type PdfImportPerformanceSignals,
  type PdfImportStepCost,
} from './pdfImportPerformanceTypes';
import { extractPdfImportPerformanceSignals } from './pdfImportPerformanceSignals';
import {
  estimateOverallCostLevel,
  estimateOverallCostScore,
  estimatePdfImportStepCosts,
} from './pdfImportCostModel';
import {
  evaluatePdfImportMetadataStaleness,
  isMetadataMissingOrStale,
} from './pdfImportStaleness';

const COST_LEVELS: PdfImportCostLevel[] = ['negligible', 'low', 'medium', 'high', 'very_high', 'unknown'];
const RISK_LEVELS: PdfImportPerformanceRiskLevel[] = ['low', 'medium', 'high', 'critical', 'unknown'];
const ACTIONS = new Set([
  'no_action', 'reuse_existing_result', 'rebuild_stale_metadata', 'defer_expensive_step',
  'require_operator_confirmation', 'compact_metadata', 'limit_query_scope', 'cache_artifact_lookup',
  'rerun_only_if_inputs_changed', 'avoid_ai_reconciliation', 'require_manual_review_before_costly_step',
  'inspect_long_running_job', 'inspect_storage_artifacts', 'archive_or_prune_old_history', 'document_manual_gap',
]);

function ev(code: string, label: string, value: string | number | boolean | null, weight: number, message: string): PdfImportPerformanceEvidence {
  return { code, label, value, weight, message };
}

function detectDuplicateWork(
  signals: PdfImportPerformanceSignals,
  staleness: PdfImportMetadataStaleness[],
): PdfImportDuplicateWorkSignal[] {
  const out: PdfImportDuplicateWorkSignal[] = [];

  if ((signals.goldenHistoryRunCount ?? 0) > 20) {
    out.push({ code: 'repeated_golden_regression_runs', count: signals.goldenHistoryRunCount ?? 0,
      message: 'Golden regression has been run many times; consider only rerunning when inputs change.' });
  }
  if (signals.exportParityStatus === 'manual_required') {
    out.push({ code: 'repeated_export_parity_manual_required', count: 1,
      message: 'Export parity is repeatedly manual_required; document the manual gap instead of rerunning.' });
  }
  const staleCount = staleness.filter((s) => s.status === 'stale').length;
  if (staleCount > 0) {
    out.push({ code: 'stale_metadata_present', count: staleCount,
      message: `${staleCount} metadata summary(ies) appear stale and may cause repeated rebuilds.` });
  }
  if (signals.hasExportParity && signals.exportParityStatus === 'completed') {
    out.push({ code: 'reusable_export_parity', count: 1,
      message: 'A completed export parity result exists and can be reused unless the template changed.' });
  }
  return out;
}

export function generatePdfImportOptimizationRecommendations(input: {
  signals: PdfImportPerformanceSignals;
  stepCosts: PdfImportStepCost[];
  staleness: PdfImportMetadataStaleness[];
  evidence: PdfImportPerformanceEvidence[];
}): PdfImportOptimizationRecommendation[] {
  const { signals, staleness } = input;
  const out: PdfImportOptimizationRecommendation[] = [];
  let seq = 0;
  const push = (r: Omit<PdfImportOptimizationRecommendation, 'id'>) => {
    seq += 1;
    out.push({ id: `perf-${r.domain}-${r.action}-${seq}`, ...r });
  };

  // 1-4: missing metadata → rebuild
  if (!signals.hasImportProfile) {
    push({ domain: 'metadata', action: 'rebuild_stale_metadata', severity: 'medium', costLevel: 'negligible', confidence: 0.9,
      message: 'Build import intelligence profile before advanced decisioning.',
      evidence: [ev('missing_profile', 'Import profile', false, 0.5, 'No import intelligence profile present.')] });
  }
  if (!signals.hasRepairPatternAnalysis) {
    push({ domain: 'metadata', action: 'rebuild_stale_metadata', severity: 'low', costLevel: 'negligible', confidence: 0.85,
      message: 'Build repair pattern analysis to classify recurring repair issues.',
      evidence: [ev('missing_repair_pattern', 'Repair pattern analysis', false, 0.4, 'No repair pattern analysis present.')] });
  }
  if (!signals.hasAdaptiveReconciliationPolicy) {
    push({ domain: 'metadata', action: 'rebuild_stale_metadata', severity: 'low', costLevel: 'negligible', confidence: 0.85,
      message: 'Build adaptive reconciliation policy to govern AI reconciliation decisions.',
      evidence: [ev('missing_adaptive_policy', 'Adaptive policy', false, 0.4, 'No adaptive reconciliation policy present.')] });
  }
  if (!signals.hasSelfHealingAudit && (signals.failureCount > 0 || signals.warningCount > 0)) {
    push({ domain: 'metadata', action: 'rebuild_stale_metadata', severity: 'medium', costLevel: 'negligible', confidence: 0.8,
      message: 'Build a self-healing retry plan; failures/warnings exist without a recovery plan.',
      evidence: [ev('missing_self_healing_audit', 'Self-healing audit', false, 0.5, 'Failures/warnings exist but no self-healing plan is present.')] });
  }

  // 5: stale metadata → rebuild
  for (const s of staleness) {
    if (s.status === 'stale') {
      push({ domain: 'metadata', action: 'rebuild_stale_metadata', severity: 'medium', costLevel: 'negligible', confidence: 0.7,
        message: `Rebuild stale metadata: ${s.metadataKey}.`,
        evidence: [ev('stale_metadata', s.metadataKey, s.generatedAt, 0.5, s.reason)] });
    }
  }

  // 6-7: export parity reuse / missing
  if (signals.hasExportParity && signals.exportParityStatus === 'completed' && (signals.exportVsSourceScore ?? 0) >= 0.85) {
    push({ domain: 'export_parity', action: 'reuse_existing_result', severity: 'info', costLevel: 'high', confidence: 0.8,
      message: 'Existing export parity can be reused unless template changed.',
      evidence: [ev('export_parity_reusable', 'Export vs source', signals.exportVsSourceScore, 0.5, 'Completed export parity with acceptable score.')] });
  } else if (!signals.hasExportParity) {
    if (signals.exportParityStatus === 'manual_required') {
      push({ domain: 'export_parity', action: 'document_manual_gap', severity: 'low', costLevel: 'high', confidence: 0.6,
        message: 'Export rasterization unavailable; document the manual export parity gap.',
        evidence: [ev('export_parity_manual_gap', 'Export parity', 'manual_required', 0.4, 'Export parity is manual_required.')] });
    } else {
      push({ domain: 'export_parity', action: 'require_operator_confirmation', severity: 'low', costLevel: 'high', confidence: 0.6,
        message: 'Export parity is missing; confirm before running an expensive parity pass.',
        evidence: [ev('export_parity_missing', 'Export parity', false, 0.4, 'No export parity result present.')] });
    }
  } else if (signals.exportParityStatus === 'manual_required') {
    push({ domain: 'export_parity', action: 'document_manual_gap', severity: 'low', costLevel: 'high', confidence: 0.6,
      message: 'Export parity repeatedly manual_required; document the manual gap rather than rerunning.',
      evidence: [ev('export_parity_manual_loop', 'Export parity', 'manual_required', 0.4, 'Export parity is manual_required.')] });
  }

  // 8-9: AI reconciliation cost decisions (respect adaptive policy)
  if (signals.adaptiveDecision === 'not_needed' || signals.adaptiveDecision === 'blocked' || signals.adaptiveAiBlocked === true) {
    push({ domain: 'ai_reconciliation', action: 'avoid_ai_reconciliation', severity: 'medium', costLevel: 'very_high', confidence: 0.85,
      message: 'Avoid AI reconciliation; adaptive policy indicates it is not needed or blocked.',
      evidence: [ev('ai_avoidable', 'Adaptive decision', signals.adaptiveDecision, 0.6, 'Adaptive policy does not warrant AI reconciliation.')] });
  } else if (signals.adaptiveDecision === 'recommended' || signals.adaptiveDecision === 'manual_review') {
    push({ domain: 'ai_reconciliation', action: 'require_operator_confirmation', severity: 'medium', costLevel: 'very_high', confidence: 0.7,
      message: 'AI reconciliation is expensive; require operator confirmation before running.',
      evidence: [ev('ai_confirm', 'Adaptive decision', signals.adaptiveDecision, 0.6, 'Adaptive policy recommends AI but it is costly.')] });
    if (signals.adaptiveDecision === 'manual_review') {
      push({ domain: 'ai_reconciliation', action: 'require_manual_review_before_costly_step', severity: 'high', costLevel: 'very_high', confidence: 0.7,
        message: 'Require manual review before the costly AI reconciliation step.',
        evidence: [ev('ai_manual_review', 'Adaptive decision', signals.adaptiveDecision, 0.6, 'Manual review required first.')] });
    }
  }

  // 10: high page count → confirm expensive steps
  if ((signals.pageCount ?? 0) > 10) {
    push({ domain: 'visual_qa', action: 'require_operator_confirmation', severity: 'medium', costLevel: 'very_high', confidence: 0.7,
      message: 'High page count makes Visual QA/export parity very expensive; confirm before rerunning.',
      evidence: [ev('high_page_count', 'Page count', signals.pageCount, 0.6, 'Large page count escalates render/raster cost.')] });
  }

  // 11: golden history high → archive/prune
  if ((signals.goldenHistoryRunCount ?? 0) > 20) {
    push({ domain: 'golden_regression', action: 'archive_or_prune_old_history', severity: 'low', costLevel: 'low', confidence: 0.6,
      message: 'Golden history is large; archive or prune old runs and rerun only when inputs change.',
      evidence: [ev('golden_history_large', 'History runs', signals.goldenHistoryRunCount, 0.5, 'Excessive golden history rows.')] });
    push({ domain: 'golden_regression', action: 'rerun_only_if_inputs_changed', severity: 'low', costLevel: 'medium', confidence: 0.6,
      message: 'Rerun golden regression only when inputs have changed.',
      evidence: [ev('golden_rerun_guard', 'History runs', signals.goldenHistoryRunCount, 0.4, 'Repeated golden evaluations detected.')] });
  }

  // 12: long-running job → inspect
  if (signals.pdfJobDurationMs !== null && signals.pdfJobDurationMs > 60000) {
    push({ domain: 'diagnostics', action: 'inspect_long_running_job', severity: 'medium', costLevel: 'medium', confidence: 0.7,
      message: 'PDF import job ran long; inspect the job for stalls or retries.',
      evidence: [ev('long_job', 'Duration ms', signals.pdfJobDurationMs, 0.6, 'Long-running PDF import job.')] });
  }
  if (signals.pdfJobFailed === true) {
    push({ domain: 'diagnostics', action: 'inspect_long_running_job', severity: 'high', costLevel: 'medium', confidence: 0.7,
      message: 'PDF import job failed; inspect diagnostics before costly reruns.',
      evidence: [ev('failed_job', 'Job status', signals.pdfJobStatus, 0.6, 'Failed PDF import job.')] });
  }

  // 13: missing storage artifacts → inspect
  if (signals.missingArtifactPathCount > 0 && signals.importStatus === 'completed') {
    push({ domain: 'storage', action: 'inspect_storage_artifacts', severity: 'medium', costLevel: 'medium', confidence: 0.6,
      message: 'Expected storage artifacts are missing; inspect storage to avoid repeated failed fetches.',
      evidence: [ev('missing_artifacts', 'Missing paths', signals.missingArtifactPathCount, 0.5, 'Missing high-value artifact paths.')] });
    push({ domain: 'artifact_fetch', action: 'cache_artifact_lookup', severity: 'low', costLevel: 'medium', confidence: 0.5,
      message: 'Cache artifact lookups to avoid repeated fetch attempts for missing objects.',
      evidence: [ev('artifact_cache', 'Missing paths', signals.missingArtifactPathCount, 0.4, 'Repeated artifact fetches likely.')] });
  }

  // 14: large UI payload risk → limit query scope
  if ((signals.goldenHistoryRunCount ?? 0) > 20 || (signals.pageCount ?? 0) > 10) {
    push({ domain: 'ui_dashboard', action: 'limit_query_scope', severity: 'low', costLevel: 'medium', confidence: 0.6,
      message: 'Bound dashboard queries and lists to keep UI payloads small.',
      evidence: [ev('ui_payload', 'History/pages', signals.goldenHistoryRunCount ?? signals.pageCount, 0.4, 'Large row/history payloads.')] });
  }

  if (out.length === 0) {
    push({ domain: 'metadata', action: 'no_action', severity: 'info', costLevel: 'negligible', confidence: 0.9,
      message: 'No optimization action needed; metadata is complete and no expensive rerun is indicated.',
      evidence: [] });
  }

  return out;
}

export function estimatePdfImportWasteScore(input: {
  signals: PdfImportPerformanceSignals;
  staleness: PdfImportMetadataStaleness[];
  recommendations: PdfImportOptimizationRecommendation[];
}): number {
  const { signals, staleness, recommendations } = input;
  let score = 0;

  const staleCount = staleness.filter((s) => s.status === 'stale').length;
  score += Math.min(0.3, staleCount * 0.15);

  if ((signals.goldenHistoryRunCount ?? 0) > 20) score += 0.2;
  if (signals.exportParityStatus === 'manual_required') score += 0.15;
  if (signals.pdfJobDurationMs !== null && signals.pdfJobDurationMs > 60000) score += 0.1;
  if (signals.pdfJobFailed === true) score += 0.1;

  const reuseDespite = recommendations.some((r) => r.action === 'reuse_existing_result');
  if (reuseDespite) score += 0.1;

  const aiWaste = recommendations.some((r) => r.action === 'avoid_ai_reconciliation');
  if (aiWaste) score += 0.15;

  const duplicateRecs = recommendations.filter((r) =>
    r.action === 'rerun_only_if_inputs_changed' || r.action === 'archive_or_prune_old_history').length;
  score += Math.min(0.15, duplicateRecs * 0.075);

  return Number(Math.min(1, score).toFixed(4));
}

export function resolvePdfImportPerformanceRiskLevel(input: {
  signals: PdfImportPerformanceSignals;
  recommendations: PdfImportOptimizationRecommendation[];
  estimatedWasteScore: number;
}): PdfImportPerformanceRiskLevel {
  const { signals, recommendations, estimatedWasteScore } = input;

  // Insufficient evidence → unknown.
  if (!signals.importId && !signals.hasGoldenRegression && !signals.hasImportProfile) {
    return 'unknown';
  }

  const hasCriticalBlocker = signals.failureCount > 3;
  if (estimatedWasteScore > 0.85 || hasCriticalBlocker) return 'critical';

  const hasVeryHighCostRec = recommendations.some((r) => r.costLevel === 'very_high' && r.severity !== 'info');
  if (estimatedWasteScore > 0.65 || hasVeryHighCostRec) return 'high';

  if (estimatedWasteScore > 0.35) return 'medium';
  return 'low';
}

export function validatePdfImportPerformanceCostAudit(
  audit: PdfImportPerformanceCostAudit,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (audit.version !== PDF_IMPORT_PERFORMANCE_AUDIT_VERSION) errors.push('invalid_version');
  if (!COST_LEVELS.includes(audit.overallCostLevel)) errors.push('invalid_cost_level');
  if (!RISK_LEVELS.includes(audit.overallRiskLevel)) errors.push('invalid_risk_level');
  if (typeof audit.estimatedCostScore !== 'number' || audit.estimatedCostScore < 0 || audit.estimatedCostScore > 1) {
    errors.push('invalid_cost_score');
  }
  if (typeof audit.estimatedWasteScore !== 'number' || audit.estimatedWasteScore < 0 || audit.estimatedWasteScore > 1) {
    errors.push('invalid_waste_score');
  }
  if (!Array.isArray(audit.recommendations)) errors.push('missing_recommendations');
  else {
    for (const r of audit.recommendations) {
      if (!ACTIONS.has(r.action)) { errors.push('invalid_recommendation_action'); break; }
    }
  }
  if (!Array.isArray(audit.stepCosts)) errors.push('missing_step_costs');
  if (!Array.isArray(audit.staleness)) errors.push('missing_staleness');
  if (!audit.generatedAt) warnings.push('missing_generated_at');

  return { ok: errors.length === 0, errors, warnings };
}

export function buildPdfImportPerformanceCostAudit(
  options: BuildPdfImportPerformanceAuditOptions,
): PdfImportPerformanceCostAudit {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();

  const extracted = extractPdfImportPerformanceSignals({
    importId: options.importId,
    templateId: options.templateId,
    sourceFilename: options.sourceFilename,
    snapshot: options.snapshot,
    importIntelligenceProfile: options.importIntelligenceProfile,
    repairPatternAnalysis: options.repairPatternAnalysis,
    adaptiveReconciliationPolicy: options.adaptiveReconciliationPolicy,
    selfHealingRetryAudit: options.selfHealingRetryAudit,
    visualQualitySummary: options.visualQualitySummary,
    repairSummary: options.repairSummary,
    exportParitySummary: options.exportParitySummary,
    goldenRegressionSummary: options.goldenRegressionSummary,
    goldenHistory: options.goldenHistory,
    pdfImportJob: options.pdfImportJob,
  });

  const signals = extracted.signals;
  const stepCosts = estimatePdfImportStepCosts(signals);
  const staleness = evaluatePdfImportMetadataStaleness(signals);
  const recommendations = generatePdfImportOptimizationRecommendations({
    signals, stepCosts, staleness, evidence: extracted.evidence,
  });
  const duplicateWork = detectDuplicateWork(signals, staleness);

  const estimatedCostScore = estimateOverallCostScore(stepCosts);
  const overallCostLevel = estimateOverallCostLevel(stepCosts);
  const estimatedWasteScore = estimatePdfImportWasteScore({ signals, staleness, recommendations });
  const overallRiskLevel = resolvePdfImportPerformanceRiskLevel({ signals, recommendations, estimatedWasteScore });

  const audit: PdfImportPerformanceCostAudit = {
    version: PDF_IMPORT_PERFORMANCE_AUDIT_VERSION,
    importId: signals.importId,
    templateId: signals.templateId,
    sourceFilename: signals.sourceFilename,
    overallCostLevel,
    overallRiskLevel,
    estimatedCostScore,
    estimatedWasteScore,
    signals,
    stepCosts,
    staleness,
    duplicateWork,
    recommendations,
    evidence: extracted.evidence,
    warnings: extracted.warnings,
    blockers: extracted.blockers,
    generatedAt,
    persistedAt: null,
  };

  return audit;
}

export { isMetadataMissingOrStale };
