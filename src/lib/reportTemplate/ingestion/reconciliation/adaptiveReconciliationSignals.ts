/**
 * adaptiveReconciliationSignals — Phase 10D.
 *
 * Deterministic extraction of the signals the adaptive reconciliation policy
 * consumes: import intelligence, repair pattern analysis, Visual QA, repair,
 * export parity, existing AI reconciliation, golden regression, quality gates,
 * and triage. Never reads or stores raw PDF/OCR text.
 */
import type {
  AdaptiveReconciliationEvidence,
  AdaptiveReconciliationSignals,
} from './adaptiveReconciliationTypes';

export function clampAdaptiveReconciliationScore(value: unknown): number | null {
  const n = coerceAdaptiveReconciliationNumber(value);
  if (n === null) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function coerceAdaptiveReconciliationBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

export function coerceAdaptiveReconciliationNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function readAdaptiveReconciliationPath(source: unknown, path: string[]): unknown {
  let cur: any = source;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function pick<T>(coerce: (v: unknown) => T | null, cands: unknown[]): T | null {
  for (const c of cands) {
    const r = coerce(c);
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

function collectGateCodes(report: unknown, status: 'fail' | 'warning'): string[] {
  const gates = readAdaptiveReconciliationPath(report, ['gates']);
  const out: string[] = [];
  if (Array.isArray(gates)) {
    for (const g of gates) {
      const s = coerceString((g as any)?.status);
      const id = coerceString((g as any)?.id);
      if (s === status && id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function extractAdaptiveQualityGateFailures(report: unknown): string[] {
  return collectGateCodes(report, 'fail');
}

export function extractAdaptiveQualityGateWarnings(report: unknown): string[] {
  return collectGateCodes(report, 'warning');
}

function collectTriageCodes(triage: unknown, keys: string[]): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = coerceString(v);
    if (s && !out.includes(s)) out.push(s);
  };
  for (const key of keys) {
    const arr = readAdaptiveReconciliationPath(triage, [key]);
    if (Array.isArray(arr)) for (const item of arr) push((item as any)?.code ?? (item as any)?.action ?? item);
  }
  return out;
}

export function extractAdaptiveTriageFailureCodes(triage: unknown): string[] {
  return collectTriageCodes(triage, ['failures', 'signals']);
}

export function extractAdaptiveTriageWarningCodes(triage: unknown): string[] {
  return collectTriageCodes(triage, ['warnings']);
}

function pushEvidence(
  list: AdaptiveReconciliationEvidence[],
  code: string,
  label: string,
  value: string | number | boolean | null,
  weight: number,
  message: string,
): void {
  list.push({ code, label, value, weight, message });
}

/** Extract deterministic adaptive-reconciliation signals + evidence from all inputs. */
export function extractAdaptiveReconciliationSignals(input: {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  snapshot?: unknown;
  importIntelligenceProfile?: unknown;
  repairPatternAnalysis?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  existingAiReconciliationSummary?: unknown;
}): {
  signals: AdaptiveReconciliationSignals;
  evidence: AdaptiveReconciliationEvidence[];
  warnings: string[];
  blockers: string[];
} {
  const snap = input.snapshot;
  const profile = input.importIntelligenceProfile;
  const repairPattern = input.repairPatternAnalysis;
  const vq = input.visualQualitySummary;
  const repair = input.repairSummary;
  const exportParity = input.exportParitySummary;
  const golden = input.goldenRegressionSummary;
  const existingAi = input.existingAiReconciliationSummary;

  const evidence: AdaptiveReconciliationEvidence[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  const importId = coerceString(input.importId)
    ?? coerceString(readAdaptiveReconciliationPath(snap, ['importId']))
    ?? coerceString(readAdaptiveReconciliationPath(profile, ['importId']));
  const templateId = coerceString(input.templateId)
    ?? coerceString(readAdaptiveReconciliationPath(snap, ['templateId']))
    ?? coerceString(readAdaptiveReconciliationPath(profile, ['templateId']));
  const sourceFilename = coerceString(input.sourceFilename)
    ?? coerceString(readAdaptiveReconciliationPath(snap, ['sourceFilename']))
    ?? coerceString(readAdaptiveReconciliationPath(profile, ['sourceFilename']));

  const hasProfile = profile !== undefined && profile !== null;
  const hasRepairPattern = repairPattern !== undefined && repairPattern !== null;
  if (!hasProfile) warnings.push('missing_import_intelligence_profile');
  if (!hasRepairPattern) warnings.push('missing_repair_pattern_analysis');
  if (vq === undefined || vq === null) warnings.push('missing_visual_quality_summary');
  if (repair === undefined || repair === null) warnings.push('missing_repair_summary');
  if (exportParity === undefined || exportParity === null) warnings.push('missing_export_parity_summary');

  if (!importId) blockers.push('import_id_missing');
  if (!hasProfile && !hasRepairPattern && !snap) blockers.push('missing_required_context');

  // Import intelligence
  const profileCategory = coerceString(readAdaptiveReconciliationPath(profile, ['profileCategory']));
  const importRiskLevel = coerceString(readAdaptiveReconciliationPath(profile, ['riskLevel']));
  const importConfidence = coerceAdaptiveReconciliationNumber(readAdaptiveReconciliationPath(profile, ['confidence']));
  const automationRiskScore = clampAdaptiveReconciliationScore(readAdaptiveReconciliationPath(profile, ['scores', 'automationRiskScore']));
  const manualReviewLikelihood = clampAdaptiveReconciliationScore(readAdaptiveReconciliationPath(profile, ['scores', 'manualReviewLikelihood']));
  const ocrRiskScore = clampAdaptiveReconciliationScore(readAdaptiveReconciliationPath(profile, ['scores', 'ocrRiskScore']));
  const tableRiskScore = clampAdaptiveReconciliationScore(readAdaptiveReconciliationPath(profile, ['scores', 'tableRiskScore']));
  const imageRiskScore = clampAdaptiveReconciliationScore(readAdaptiveReconciliationPath(profile, ['scores', 'imageRiskScore']));
  const designRiskScore = clampAdaptiveReconciliationScore(readAdaptiveReconciliationPath(profile, ['scores', 'designRiskScore']));

  // Repair pattern analysis
  const primaryRepairPatternId = coerceString(readAdaptiveReconciliationPath(repairPattern, ['primaryPatternId']));
  const repairPatternSeverity = coerceString(readAdaptiveReconciliationPath(repairPattern, ['overallSeverity']));
  const deterministicRepairStrategy = coerceString(readAdaptiveReconciliationPath(repairPattern, ['deterministicRepairStrategy']));
  const repairPatternAiUsefulness = coerceString(readAdaptiveReconciliationPath(repairPattern, ['aiReconciliationUsefulness']));
  const repairPatternOperatorReviewRequirement = coerceString(readAdaptiveReconciliationPath(repairPattern, ['operatorReviewRequirement']));
  const repairPatternExportParityRequirement = coerceString(readAdaptiveReconciliationPath(repairPattern, ['exportParityRequirement']));
  const repairPatternConfidence = clampAdaptiveReconciliationScore(readAdaptiveReconciliationPath(repairPattern, ['overallConfidence']));

  // Visual QA
  const visualQaScore = pick(coerceAdaptiveReconciliationNumber, [
    readAdaptiveReconciliationPath(snap, ['visualQaScore']),
    readAdaptiveReconciliationPath(vq, ['overallScore']),
  ]);
  const visualQaManualReviewRequired = pick(coerceAdaptiveReconciliationBoolean, [
    readAdaptiveReconciliationPath(snap, ['visualQaManualReviewRequired']),
    readAdaptiveReconciliationPath(vq, ['manualReviewRequired']),
  ]);

  // Repair
  const repairStatus = pick(coerceString, [
    readAdaptiveReconciliationPath(snap, ['repairStatus']),
    readAdaptiveReconciliationPath(repair, ['repairStatus']),
  ]);
  const repairFinalScore = pick(coerceAdaptiveReconciliationNumber, [
    readAdaptiveReconciliationPath(snap, ['repairFinalScore']),
    readAdaptiveReconciliationPath(repair, ['finalScore']),
  ]);
  const repairRequiresFallback = pick(coerceAdaptiveReconciliationBoolean, [
    readAdaptiveReconciliationPath(snap, ['repairRequiresFallback']),
    readAdaptiveReconciliationPath(repair, ['requiresFallback']),
  ]);
  const repairRequiresManualReview = pick(coerceAdaptiveReconciliationBoolean, [
    readAdaptiveReconciliationPath(snap, ['repairRequiresManualReview']),
    readAdaptiveReconciliationPath(repair, ['requiresManualReview']),
  ]);

  // Export parity
  const exportParityStatus = pick(coerceString, [
    readAdaptiveReconciliationPath(snap, ['exportParityStatus']),
    readAdaptiveReconciliationPath(exportParity, ['status']),
  ]);
  const exportVsSourceScore = pick(coerceAdaptiveReconciliationNumber, [
    readAdaptiveReconciliationPath(snap, ['exportVsSourceScore']),
    readAdaptiveReconciliationPath(exportParity, ['exportVsSourceScore']),
  ]);
  const editorVsSourceScore = pick(coerceAdaptiveReconciliationNumber, [
    readAdaptiveReconciliationPath(snap, ['editorVsSourceScore']),
    readAdaptiveReconciliationPath(exportParity, ['editorVsSourceScore']),
  ]);
  const exportVsEditorScore = pick(coerceAdaptiveReconciliationNumber, [
    readAdaptiveReconciliationPath(snap, ['exportVsEditorScore']),
    readAdaptiveReconciliationPath(exportParity, ['exportVsEditorScore']),
  ]);

  // Existing AI reconciliation
  const existingAiReconciliationStatus = pick(coerceString, [
    readAdaptiveReconciliationPath(snap, ['aiReconciliationStatus']),
    readAdaptiveReconciliationPath(existingAi, ['status']),
  ]);
  const existingAiReconciliationRecommendation = pick(coerceString, [
    readAdaptiveReconciliationPath(snap, ['aiReconciliationRecommendation']),
    readAdaptiveReconciliationPath(existingAi, ['recommendation']),
  ]);

  // Golden regression
  const goldenQualityGateStatus = coerceString(readAdaptiveReconciliationPath(golden, ['qualityGateStatus']));
  const goldenFailures = readAdaptiveReconciliationPath(golden, ['failures']);
  const goldenWarnings = readAdaptiveReconciliationPath(golden, ['warnings']);
  const goldenFailureCount = Array.isArray(goldenFailures) ? goldenFailures.length : null;
  const goldenWarningCount = Array.isArray(goldenWarnings) ? goldenWarnings.length : null;
  const baselineOutcome = coerceString(readAdaptiveReconciliationPath(golden, ['baselineComparison', 'outcome']));

  const qualityGateFailures = extractAdaptiveQualityGateFailures(input.qualityGateReport);
  const qualityGateWarnings = extractAdaptiveQualityGateWarnings(input.qualityGateReport);
  const triageFailureCodes = extractAdaptiveTriageFailureCodes(input.triageSummary);
  const triageWarningCodes = extractAdaptiveTriageWarningCodes(input.triageSummary);

  // Evidence
  if (visualQaScore !== null && visualQaScore < 0.85) {
    pushEvidence(evidence, 'low_visual_qa_score', 'Low Visual QA score', visualQaScore, 0.5, `Visual QA score is ${visualQaScore}.`);
  }
  if ((repairStatus ?? '').toLowerCase() === 'failed') {
    pushEvidence(evidence, 'repair_failed', 'Repair failed', repairStatus, 0.7, 'Repair failed.');
  }
  if (repairRequiresFallback === true) {
    pushEvidence(evidence, 'repair_fallback_required', 'Repair fallback required', true, 0.5, 'Repair requires a fallback.');
  }
  if ((exportParityStatus ?? '').toLowerCase() === 'failed') {
    pushEvidence(evidence, 'export_parity_failed', 'Export parity failed', exportParityStatus, 0.5, 'Export parity failed.');
  }
  if (ocrRiskScore !== null && ocrRiskScore >= 0.65) {
    pushEvidence(evidence, 'high_ocr_risk', 'High OCR risk', ocrRiskScore, 0.6, 'OCR risk is high.');
  }
  if (automationRiskScore !== null && automationRiskScore >= 0.65) {
    pushEvidence(evidence, 'high_automation_risk', 'High automation risk', automationRiskScore, 0.6, 'Automation risk is high.');
  }
  if (manualReviewLikelihood !== null && manualReviewLikelihood >= 0.75) {
    pushEvidence(evidence, 'manual_review_likelihood_high', 'Manual review likelihood high', manualReviewLikelihood, 0.6, 'Manual review is very likely.');
  }
  if (visualQaManualReviewRequired === true || repairRequiresManualReview === true) {
    pushEvidence(evidence, 'manual_review_required', 'Manual review required', true, 0.6, 'A manual review flag is set.');
  }
  if (primaryRepairPatternId === 'manual_review_only') {
    pushEvidence(evidence, 'repair_pattern_manual_review_only', 'Repair pattern manual review only', primaryRepairPatternId, 0.8, 'Repair pattern requires manual review only.');
  }
  if (repairPatternAiUsefulness === 'high') {
    pushEvidence(evidence, 'repair_pattern_ai_high', 'Repair pattern AI usefulness high', repairPatternAiUsefulness, 0.6, 'Repair pattern indicates AI reconciliation could help.');
  }
  if ((goldenQualityGateStatus ?? '').toLowerCase() === 'fail' || (goldenQualityGateStatus ?? '').toLowerCase() === 'blocked') {
    pushEvidence(evidence, 'golden_gate_failed', 'Golden quality gate failed', goldenQualityGateStatus, 0.6, `Golden quality gate is ${goldenQualityGateStatus}.`);
  }
  if ((baselineOutcome ?? '').toLowerCase() === 'degraded') {
    pushEvidence(evidence, 'baseline_degraded', 'Baseline degraded', baselineOutcome, 0.5, 'Baseline comparison degraded.');
  }
  if ((existingAiReconciliationStatus ?? '').toLowerCase() === 'completed') {
    pushEvidence(evidence, 'existing_ai_completed', 'Existing AI reconciliation completed', existingAiReconciliationStatus, 0.4, 'AI reconciliation already completed.');
  }
  if ((existingAiReconciliationStatus ?? '').toLowerCase() === 'failed') {
    pushEvidence(evidence, 'existing_ai_failed', 'Existing AI reconciliation failed', existingAiReconciliationStatus, 0.5, 'A prior AI reconciliation failed.');
  }

  if (evidence.length === 0) warnings.push('insufficient_reconciliation_evidence');

  const signals: AdaptiveReconciliationSignals = {
    importId,
    templateId,
    sourceFilename,
    profileCategory,
    importRiskLevel,
    importConfidence,
    automationRiskScore,
    manualReviewLikelihood,
    ocrRiskScore,
    tableRiskScore,
    imageRiskScore,
    designRiskScore,
    primaryRepairPatternId,
    repairPatternSeverity,
    deterministicRepairStrategy,
    repairPatternAiUsefulness,
    repairPatternOperatorReviewRequirement,
    repairPatternExportParityRequirement,
    repairPatternConfidence,
    visualQaScore,
    visualQaManualReviewRequired,
    repairStatus,
    repairFinalScore,
    repairRequiresFallback,
    repairRequiresManualReview,
    exportParityStatus,
    exportVsSourceScore,
    editorVsSourceScore,
    exportVsEditorScore,
    existingAiReconciliationStatus,
    existingAiReconciliationRecommendation,
    goldenQualityGateStatus,
    goldenWarningCount,
    goldenFailureCount,
    baselineOutcome,
    qualityGateFailures,
    qualityGateWarnings,
    triageFailureCodes,
    triageWarningCodes,
  };

  return {
    signals,
    evidence,
    warnings: warnings.filter((w, i, a) => a.indexOf(w) === i),
    blockers: blockers.filter((b, i, a) => a.indexOf(b) === i),
  };
}
