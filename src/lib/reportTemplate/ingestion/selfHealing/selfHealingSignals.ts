/**
 * selfHealingSignals — Phase 10E.
 *
 * Deterministic extraction of retry-planning signals from all existing Phase
 * 8/9/10 metadata (snapshot, import intelligence, repair patterns, adaptive
 * policy, QA/repair/export, golden, quality gates, triage, previous audit).
 * Never reads or stores raw PDF/OCR text.
 */
import type {
  SelfHealingEvidence,
  SelfHealingSignals,
} from './selfHealingTypes';

export function coerceSelfHealingBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

export function coerceSelfHealingNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function readSelfHealingPath(source: unknown, path: string[]): unknown {
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

function gateCodes(report: unknown, status: 'fail' | 'warning'): string[] {
  const gates = readSelfHealingPath(report, ['gates']);
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

function stringArray(value: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = coerceString((item as any)?.code ?? (item as any)?.action ?? item);
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

/** Failure codes aggregated across quality gates, triage, golden, export, repair. */
export function extractSelfHealingFailureCodes(input: {
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  goldenRegressionSummary?: unknown;
  exportParitySummary?: unknown;
  repairSummary?: unknown;
}): string[] {
  const out: string[] = [];
  const add = (arr: string[]) => { for (const c of arr) if (!out.includes(c)) out.push(c); };
  add(gateCodes(input.qualityGateReport, 'fail'));
  add(stringArray(readSelfHealingPath(input.triageSummary, ['failures'])));
  add(stringArray(readSelfHealingPath(input.triageSummary, ['signals'])));
  add(stringArray(readSelfHealingPath(input.goldenRegressionSummary, ['failures'])));
  add(stringArray(readSelfHealingPath(input.exportParitySummary, ['blockers'])));
  if ((coerceString(readSelfHealingPath(input.repairSummary, ['repairStatus'])) ?? '').toLowerCase() === 'failed') {
    add(['repair_failed']);
  }
  return out;
}

/** Warning codes aggregated across quality gates, triage, golden, export. */
export function extractSelfHealingWarningCodes(input: {
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  goldenRegressionSummary?: unknown;
  exportParitySummary?: unknown;
  repairSummary?: unknown;
}): string[] {
  const out: string[] = [];
  const add = (arr: string[]) => { for (const c of arr) if (!out.includes(c)) out.push(c); };
  add(gateCodes(input.qualityGateReport, 'warning'));
  add(stringArray(readSelfHealingPath(input.triageSummary, ['warnings'])));
  add(stringArray(readSelfHealingPath(input.goldenRegressionSummary, ['warnings'])));
  add(stringArray(readSelfHealingPath(input.exportParitySummary, ['warnings'])));
  return out;
}

/** Per-action attempt counts recorded in a previous audit's actions[]. */
export function extractPreviousAuditActionCounts(previousAudit: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const actions = readSelfHealingPath(previousAudit, ['actions']);
  if (Array.isArray(actions)) {
    for (const a of actions) {
      const id = coerceString((a as any)?.actionId);
      const count = coerceSelfHealingNumber((a as any)?.attemptCount);
      if (id) out[id] = (out[id] ?? 0) + (count ?? 0);
    }
  }
  return out;
}

function pushEvidence(
  list: SelfHealingEvidence[],
  code: string,
  label: string,
  value: string | number | boolean | null,
  weight: number,
  message: string,
): void {
  list.push({ code, label, value, weight, message });
}

/** Extract deterministic self-healing signals + evidence from all inputs. */
export function extractSelfHealingSignals(input: {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  snapshot?: unknown;
  importIntelligenceProfile?: unknown;
  repairPatternAnalysis?: unknown;
  adaptiveReconciliationPolicy?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  previousAudit?: unknown;
}): {
  signals: SelfHealingSignals;
  evidence: SelfHealingEvidence[];
  warnings: string[];
  blockers: string[];
} {
  const snap = input.snapshot;
  const profile = input.importIntelligenceProfile;
  const repairPattern = input.repairPatternAnalysis;
  const adaptive = input.adaptiveReconciliationPolicy;
  const vq = input.visualQualitySummary;
  const repair = input.repairSummary;
  const exportParity = input.exportParitySummary;
  const golden = input.goldenRegressionSummary;
  const triage = input.triageSummary;

  const evidence: SelfHealingEvidence[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  const importId = coerceString(input.importId)
    ?? coerceString(readSelfHealingPath(snap, ['importId']))
    ?? coerceString(readSelfHealingPath(profile, ['importId']));
  const templateId = coerceString(input.templateId)
    ?? coerceString(readSelfHealingPath(snap, ['templateId']))
    ?? coerceString(readSelfHealingPath(profile, ['templateId']));
  const sourceFilename = coerceString(input.sourceFilename)
    ?? coerceString(readSelfHealingPath(snap, ['sourceFilename']))
    ?? coerceString(readSelfHealingPath(profile, ['sourceFilename']));

  const importStatus = coerceString(readSelfHealingPath(snap, ['importStatus']));
  const templateExists = templateId !== null ? true : null;

  // Visual QA
  const visualQaScore = pick(coerceSelfHealingNumber, [
    readSelfHealingPath(snap, ['visualQaScore']),
    readSelfHealingPath(vq, ['overallScore']),
  ]);
  const visualQaManualReviewRequired = pick(coerceSelfHealingBoolean, [
    readSelfHealingPath(snap, ['visualQaManualReviewRequired']),
    readSelfHealingPath(vq, ['manualReviewRequired']),
  ]);
  const hasVisualQuality = visualQaScore !== null || visualQaManualReviewRequired !== null
    || coerceString(readSelfHealingPath(snap, ['visualQaArtifactPath'])) !== null;
  if (!hasVisualQuality) {
    pushEvidence(evidence, 'missing_visual_quality', 'Missing Visual QA', false, 0.6, 'No Visual QA evidence is present.');
  }

  // Repair
  const repairStatus = pick(coerceString, [
    readSelfHealingPath(snap, ['repairStatus']),
    readSelfHealingPath(repair, ['repairStatus']),
  ]);
  const repairFinalScore = pick(coerceSelfHealingNumber, [
    readSelfHealingPath(snap, ['repairFinalScore']),
    readSelfHealingPath(repair, ['finalScore']),
  ]);
  const repairRequiresFallback = pick(coerceSelfHealingBoolean, [
    readSelfHealingPath(snap, ['repairRequiresFallback']),
    readSelfHealingPath(repair, ['requiresFallback']),
  ]);
  const repairRequiresManualReview = pick(coerceSelfHealingBoolean, [
    readSelfHealingPath(snap, ['repairRequiresManualReview']),
    readSelfHealingPath(repair, ['requiresManualReview']),
  ]);
  const hasRepairAudit = repairStatus !== null || repairFinalScore !== null
    || coerceString(readSelfHealingPath(snap, ['repairArtifactPath'])) !== null;
  if (!hasRepairAudit) {
    pushEvidence(evidence, 'missing_repair_audit', 'Missing repair audit', false, 0.6, 'No repair audit evidence is present.');
  }
  if ((repairStatus ?? '').toLowerCase() === 'failed') {
    pushEvidence(evidence, 'repair_failed', 'Repair failed', repairStatus, 0.7, 'Repair failed.');
  }

  // Export parity
  const exportParityStatus = pick(coerceString, [
    readSelfHealingPath(snap, ['exportParityStatus']),
    readSelfHealingPath(exportParity, ['status']),
  ]);
  const exportVsSourceScore = pick(coerceSelfHealingNumber, [
    readSelfHealingPath(snap, ['exportVsSourceScore']),
    readSelfHealingPath(exportParity, ['exportVsSourceScore']),
  ]);
  const hasExportParity = exportParityStatus !== null || exportVsSourceScore !== null
    || coerceString(readSelfHealingPath(snap, ['exportParityArtifactPath'])) !== null;
  if (!hasExportParity) {
    pushEvidence(evidence, 'missing_export_parity', 'Missing export parity', false, 0.5, 'No export parity evidence is present.');
  }
  if ((exportParityStatus ?? '').toLowerCase() === 'manual_required') {
    pushEvidence(evidence, 'export_parity_manual_required', 'Export parity manual required', exportParityStatus, 0.5, 'Export parity needs manual review.');
  }

  // Import intelligence
  const hasImportIntelligenceProfile = profile !== undefined && profile !== null;
  const importProfileCategory = coerceString(readSelfHealingPath(profile, ['profileCategory']));
  const importRiskLevel = coerceString(readSelfHealingPath(profile, ['riskLevel']));
  if (!hasImportIntelligenceProfile) warnings.push('missing_profile');
  if (['high', 'critical'].includes((importRiskLevel ?? '').toLowerCase())) {
    pushEvidence(evidence, 'import_high_risk', 'Import high risk', importRiskLevel, 0.6, 'Import risk level is high/critical.');
  }

  // Repair pattern
  const hasRepairPatternAnalysis = repairPattern !== undefined && repairPattern !== null;
  const primaryRepairPatternId = coerceString(readSelfHealingPath(repairPattern, ['primaryPatternId']));
  const repairPatternSeverity = coerceString(readSelfHealingPath(repairPattern, ['overallSeverity']));
  const deterministicRepairStrategy = coerceString(readSelfHealingPath(repairPattern, ['deterministicRepairStrategy']));
  const repairPatternOperatorReviewRequirement = coerceString(readSelfHealingPath(repairPattern, ['operatorReviewRequirement']));
  if (!hasRepairPatternAnalysis) warnings.push('missing_repair_pattern_analysis');
  if ((deterministicRepairStrategy ?? '').toLowerCase() === 'blocked') {
    pushEvidence(evidence, 'repair_pattern_blocked', 'Repair pattern blocked', deterministicRepairStrategy, 0.7, 'Repair pattern strategy is blocked.');
  }

  // Adaptive reconciliation
  const hasAdaptiveReconciliationPolicy = adaptive !== undefined && adaptive !== null;
  const adaptiveDecision = coerceString(readSelfHealingPath(adaptive, ['decision']));
  const adaptiveRecommendedAction = coerceString(readSelfHealingPath(adaptive, ['recommendedAction']));
  const adaptiveAiBlocked = coerceSelfHealingBoolean(readSelfHealingPath(adaptive, ['flags', 'aiBlocked']));
  const adaptiveRequiresManualReview = coerceSelfHealingBoolean(readSelfHealingPath(adaptive, ['flags', 'requiresManualReview']));
  const adaptiveShouldRerunRepairFirst = coerceSelfHealingBoolean(readSelfHealingPath(adaptive, ['flags', 'shouldRerunRepairBeforeReconciliation']));
  if (!hasAdaptiveReconciliationPolicy) warnings.push('missing_adaptive_policy');
  if (adaptiveAiBlocked === true || (adaptiveDecision ?? '').toLowerCase() === 'blocked') {
    pushEvidence(evidence, 'adaptive_policy_blocked', 'Adaptive policy blocked', adaptiveDecision, 0.7, 'Adaptive reconciliation policy blocks AI.');
  }
  if ((adaptiveDecision ?? '').toLowerCase() === 'recommended') {
    pushEvidence(evidence, 'ai_recommended_not_run', 'AI recommended', adaptiveDecision, 0.5, 'Adaptive policy recommends AI reconciliation.');
  }

  // Golden regression
  const goldenQualityGateStatus = coerceString(readSelfHealingPath(golden, ['qualityGateStatus']));
  const goldenOperatorDecision = coerceString(readSelfHealingPath(golden, ['operatorDecision']));
  const goldenFailures = readSelfHealingPath(golden, ['failures']);
  const goldenWarnings = readSelfHealingPath(golden, ['warnings']);
  const goldenFailureCount = Array.isArray(goldenFailures) ? goldenFailures.length : null;
  const goldenWarningCount = Array.isArray(goldenWarnings) ? goldenWarnings.length : null;
  if (['fail', 'blocked'].includes((goldenQualityGateStatus ?? '').toLowerCase())) {
    pushEvidence(evidence, 'golden_gate_failed', 'Golden gate failed', goldenQualityGateStatus, 0.6, `Golden quality gate is ${goldenQualityGateStatus}.`);
  }

  // Triage
  const triageOutcome = coerceString(readSelfHealingPath(triage, ['outcome']));
  const triagePrimaryAction = coerceString(readSelfHealingPath(triage, ['primaryAction'])
    ?? readSelfHealingPath(triage, ['recommendations', '0', 'action']));
  const triageSeverity = coerceString(readSelfHealingPath(triage, ['severity']));

  // Baseline
  const baselineOutcome = coerceString(readSelfHealingPath(golden, ['baselineComparison', 'outcome']));
  if ((baselineOutcome ?? '').toLowerCase() === 'degraded') {
    pushEvidence(evidence, 'baseline_degraded', 'Baseline degraded', baselineOutcome, 0.5, 'Baseline comparison degraded.');
  }
  if (visualQaManualReviewRequired === true || repairRequiresManualReview === true) {
    pushEvidence(evidence, 'visual_review_required', 'Manual review required', true, 0.5, 'A manual review flag is set.');
  }

  const failureCodes = extractSelfHealingFailureCodes(input);
  const warningCodes = extractSelfHealingWarningCodes(input);
  const previousAuditActionCounts = extractPreviousAuditActionCounts(input.previousAudit);

  if (!importId) blockers.push('import_id_missing');
  if (importId && (importStatus ?? '').toLowerCase() === 'not_found') blockers.push('import_not_found_or_missing');
  if (evidence.length === 0 && warnings.length === 0) warnings.push('insufficient_self_healing_context');

  const signals: SelfHealingSignals = {
    importId,
    templateId,
    sourceFilename,
    importStatus,
    templateExists,
    hasVisualQuality,
    visualQaScore,
    visualQaManualReviewRequired,
    hasRepairAudit,
    repairStatus,
    repairFinalScore,
    repairRequiresFallback,
    repairRequiresManualReview,
    hasExportParity,
    exportParityStatus,
    exportVsSourceScore,
    hasImportIntelligenceProfile,
    importProfileCategory,
    importRiskLevel,
    hasRepairPatternAnalysis,
    primaryRepairPatternId,
    repairPatternSeverity,
    deterministicRepairStrategy,
    repairPatternOperatorReviewRequirement,
    hasAdaptiveReconciliationPolicy,
    adaptiveDecision,
    adaptiveRecommendedAction,
    adaptiveAiBlocked,
    adaptiveRequiresManualReview,
    adaptiveShouldRerunRepairFirst,
    goldenQualityGateStatus,
    goldenOperatorDecision,
    goldenFailureCount,
    goldenWarningCount,
    triageOutcome,
    triagePrimaryAction,
    triageSeverity,
    baselineOutcome,
    failureCodes,
    warningCodes,
    previousAuditActionCounts,
  };

  return {
    signals,
    evidence,
    warnings: warnings.filter((w, i, a) => a.indexOf(w) === i),
    blockers: blockers.filter((b, i, a) => a.indexOf(b) === i),
  };
}
