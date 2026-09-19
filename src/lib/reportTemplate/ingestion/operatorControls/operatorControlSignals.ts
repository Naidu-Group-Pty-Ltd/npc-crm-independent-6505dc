/**
 * operatorControlSignals — Phase 10G.
 *
 * Deterministic extraction of the signals needed to evaluate operator control
 * availability from all existing Phase 8/9/10 metadata. Never reads or stores
 * raw PDF/OCR text or rasters.
 */
import type {
  OperatorControlEvidence,
  OperatorControlSignals,
  OperatorDecisionState,
} from './operatorControlTypes';

export function coerceOperatorControlBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

export function coerceOperatorControlNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function readOperatorControlPath(source: unknown, path: string[]): unknown {
  let cur: any = source;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

const read = readOperatorControlPath;

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function pickString(cands: unknown[]): string | null {
  for (const c of cands) {
    const r = coerceString(c);
    if (r !== null) return r;
  }
  return null;
}

function pickNumber(cands: unknown[]): number | null {
  for (const c of cands) {
    const r = coerceOperatorControlNumber(c);
    if (r !== null) return r;
  }
  return null;
}

function arrayLen(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function stringCodes(value: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = coerceString((item as any)?.code ?? (item as any)?.rule?.code ?? item);
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

const DECISIONS = new Set<OperatorDecisionState>([
  'not_reviewed', 'accepted', 'accepted_with_warnings', 'rejected', 'needs_rerun', 'manual_review_required', 'blocked',
]);

function coerceDecision(value: unknown): OperatorDecisionState | null {
  const s = coerceString(value);
  return s && DECISIONS.has(s as OperatorDecisionState) ? (s as OperatorDecisionState) : null;
}

export function extractOperatorFailureCodes(input: {
  goldenRegressionSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
}): string[] {
  const out: string[] = [];
  const add = (codes: string[]) => { for (const c of codes) if (!out.includes(c)) out.push(c); };
  add(stringCodes(read(input.goldenRegressionSummary, ['failures'])));
  const gates = read(input.qualityGateReport, ['gates']);
  if (Array.isArray(gates)) {
    for (const g of gates) {
      if ((g as any)?.status === 'fail' || (g as any)?.status === 'blocked') {
        const id = coerceString((g as any)?.id);
        if (id && !out.includes(id)) out.push(id);
      }
    }
  }
  add(stringCodes(read(input.triageSummary, ['recommendations'])));
  return out;
}

export function extractOperatorWarningCodes(input: {
  goldenRegressionSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
}): string[] {
  const out: string[] = [];
  const add = (codes: string[]) => { for (const c of codes) if (!out.includes(c)) out.push(c); };
  add(stringCodes(read(input.goldenRegressionSummary, ['warnings'])));
  const gates = read(input.qualityGateReport, ['gates']);
  if (Array.isArray(gates)) {
    for (const g of gates) {
      if ((g as any)?.status === 'warning') {
        const id = coerceString((g as any)?.id);
        if (id && !out.includes(id)) out.push(id);
      }
    }
  }
  return out;
}

export function extractOperatorControlSignals(input: {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  snapshot?: unknown;
  goldenRegressionSummary?: unknown;
  importIntelligenceProfile?: unknown;
  repairPatternAnalysis?: unknown;
  adaptiveReconciliationPolicy?: unknown;
  selfHealingRetryAudit?: unknown;
  performanceCostAudit?: unknown;
  exportParitySummary?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  previousOperatorControlAudit?: unknown;
}): {
  signals: OperatorControlSignals;
  evidence: OperatorControlEvidence[];
  warnings: string[];
  blockers: string[];
} {
  const evidence: OperatorControlEvidence[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const addWarning = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };
  const addBlocker = (b: string) => { if (!blockers.includes(b)) blockers.push(b); };
  const addEvidence = (e: OperatorControlEvidence) => evidence.push(e);

  const snapshot = input.snapshot;
  const golden = input.goldenRegressionSummary;
  const profile = input.importIntelligenceProfile;
  const pattern = input.repairPatternAnalysis;
  const policy = input.adaptiveReconciliationPolicy;
  const selfHealing = input.selfHealingRetryAudit;
  const perf = input.performanceCostAudit;
  const prevAudit = input.previousOperatorControlAudit;

  const importId = pickString([input.importId, read(snapshot, ['importId']), read(golden, ['importId'])]);
  const templateId = pickString([input.templateId, read(snapshot, ['templateId']), read(golden, ['templateId'])]);
  const sourceFilename = pickString([input.sourceFilename, read(snapshot, ['sourceFilename']), read(golden, ['sourceFilename'])]);

  const importStatus = pickString([read(snapshot, ['importStatus'])]);
  const templateExists = templateId !== null ? true : (importStatus === 'completed' ? false : null);

  // Golden regression
  const qualityGateStatus = pickString([read(golden, ['qualityGateStatus']), read(input.qualityGateReport, ['overallStatus'])]);
  const operatorDecision = pickString([read(golden, ['operatorDecision'])]);
  const goldenFailureCount = pickNumber([arrayLen(read(golden, ['failures']))]);
  const goldenWarningCount = pickNumber([arrayLen(read(golden, ['warnings']))]);

  // Import profile
  const hasImportProfile = profile != null;
  const importProfileCategory = pickString([read(profile, ['profileCategory'])]);
  const importRiskLevel = pickString([read(profile, ['riskLevel'])]);

  // Repair pattern
  const hasRepairPatternAnalysis = pattern != null;
  const primaryRepairPatternId = pickString([read(pattern, ['primaryPatternId'])]);
  const repairPatternSeverity = pickString([read(pattern, ['overallSeverity'])]);
  const operatorReviewRequirement = pickString([read(pattern, ['operatorReviewRequirement'])]);
  const deterministicRepairStrategy = pickString([read(pattern, ['deterministicRepairStrategy'])]);

  // Adaptive policy
  const hasAdaptivePolicy = policy != null;
  const adaptiveDecision = pickString([read(policy, ['decision'])]);
  const adaptiveAction = pickString([read(policy, ['recommendedAction'])]);
  const adaptiveAiBlocked = coerceOperatorControlBoolean(read(policy, ['flags', 'aiBlocked']));
  const adaptiveRequiresManualReview = coerceOperatorControlBoolean(read(policy, ['flags', 'requiresManualReview']));

  // Self-healing
  const hasSelfHealingAudit = selfHealing != null;
  const selfHealingStatus = pickString([read(selfHealing, ['status'])]);
  const selfHealingBlockedActions = pickNumber([read(selfHealing, ['summary', 'blockedActions'])]);
  const selfHealingManualActions = pickNumber([read(selfHealing, ['summary', 'manualActions'])]);

  // Performance
  const hasPerformanceAudit = perf != null;
  const performanceRiskLevel = pickString([read(perf, ['overallRiskLevel'])]);
  const performanceCostLevel = pickString([read(perf, ['overallCostLevel'])]);

  // Export parity
  const exportParityStatus = pickString([read(snapshot, ['exportParityStatus']), read(input.exportParitySummary, ['status'])]);
  const hasExportParity = read(snapshot, ['exportParityArtifactPath']) != null || exportParityStatus !== null || input.exportParitySummary != null;

  // Visual QA
  const visualQaManualReviewRequired = coerceOperatorControlBoolean(
    read(snapshot, ['visualQaManualReviewRequired']) ?? read(input.visualQualitySummary, ['manualReviewRequired']));
  const hasVisualQuality = read(snapshot, ['visualQaArtifactPath']) != null || read(snapshot, ['visualQaScore']) != null || input.visualQualitySummary != null;

  // Repair audit
  const repairStatus = pickString([read(snapshot, ['repairStatus']), read(input.repairSummary, ['repairStatus'])]);
  const repairRequiresManualReview = coerceOperatorControlBoolean(
    read(snapshot, ['repairRequiresManualReview']) ?? read(input.repairSummary, ['requiresManualReview']));
  const repairRequiresFallback = coerceOperatorControlBoolean(
    read(snapshot, ['repairRequiresFallback']) ?? read(input.repairSummary, ['requiresFallback']));
  const hasRepairAudit = read(snapshot, ['repairArtifactPath']) != null || repairStatus !== null || input.repairSummary != null;

  // Previous operator audit
  const previousOperatorAuditDecision = coerceDecision(read(prevAudit, ['operatorState', 'decision']));
  const previousOperatorAuditBlocked = coerceOperatorControlBoolean(read(prevAudit, ['operatorState', 'blocked']));

  const failureCodes = extractOperatorFailureCodes({
    goldenRegressionSummary: golden, qualityGateReport: input.qualityGateReport, triageSummary: input.triageSummary,
  });
  const warningCodes = extractOperatorWarningCodes({
    goldenRegressionSummary: golden, qualityGateReport: input.qualityGateReport, triageSummary: input.triageSummary,
  });

  const signals: OperatorControlSignals = {
    importId,
    templateId,
    sourceFilename,
    importStatus,
    templateExists,
    qualityGateStatus,
    operatorDecision,
    goldenFailureCount,
    goldenWarningCount,
    hasImportProfile,
    importProfileCategory,
    importRiskLevel,
    hasRepairPatternAnalysis,
    primaryRepairPatternId,
    repairPatternSeverity,
    operatorReviewRequirement,
    deterministicRepairStrategy,
    hasAdaptivePolicy,
    adaptiveDecision,
    adaptiveAction,
    adaptiveAiBlocked,
    adaptiveRequiresManualReview,
    hasSelfHealingAudit,
    selfHealingStatus,
    selfHealingBlockedActions,
    selfHealingManualActions,
    hasPerformanceAudit,
    performanceRiskLevel,
    performanceCostLevel,
    hasExportParity,
    exportParityStatus,
    hasVisualQuality,
    visualQaManualReviewRequired,
    hasRepairAudit,
    repairStatus,
    repairRequiresManualReview,
    repairRequiresFallback,
    previousOperatorAuditDecision,
    previousOperatorAuditBlocked,
    failureCodes,
    warningCodes,
  };

  // Evidence for notable states
  if (qualityGateStatus) {
    addEvidence({ code: `quality_gate_${qualityGateStatus}`, label: 'Quality gate', value: qualityGateStatus, weight: 0.6, message: `Quality gate status is ${qualityGateStatus}.` });
  }
  if (adaptiveAiBlocked === true) {
    addEvidence({ code: 'adaptive_policy_blocked', label: 'Adaptive policy', value: 'ai_blocked', weight: 0.6, message: 'Adaptive policy blocks AI reconciliation.' });
  }
  if (adaptiveDecision === 'recommended') {
    addEvidence({ code: 'adaptive_policy_recommended', label: 'Adaptive policy', value: 'recommended', weight: 0.4, message: 'Adaptive policy recommends AI reconciliation.' });
  }
  if (operatorReviewRequirement === 'block_until_review') {
    addEvidence({ code: 'repair_pattern_block_until_review', label: 'Repair pattern review', value: operatorReviewRequirement, weight: 0.6, message: 'Repair pattern requires review before acceptance.' });
  }
  if (performanceRiskLevel === 'high' || performanceRiskLevel === 'critical') {
    addEvidence({ code: 'high_performance_risk', label: 'Performance risk', value: performanceRiskLevel, weight: 0.5, message: `Performance risk is ${performanceRiskLevel}.` });
  }
  if (!hasExportParity) {
    addEvidence({ code: 'export_parity_missing', label: 'Export parity', value: false, weight: 0.4, message: 'Export parity result is missing.' });
  }
  if (!hasImportProfile) {
    addEvidence({ code: 'profile_missing', label: 'Import profile', value: false, weight: 0.3, message: 'Import intelligence profile is missing.' });
  }
  if ((selfHealingBlockedActions ?? 0) > 0) {
    addEvidence({ code: 'self_healing_blocked_actions', label: 'Self-healing blocked actions', value: selfHealingBlockedActions, weight: 0.5, message: 'Self-healing plan has blocked actions.' });
  }

  // Warnings for missing optional intelligence (never blocking)
  if (golden == null && qualityGateStatus == null) addWarning('missing_golden_regression_summary');
  if (!hasImportProfile) addWarning('missing_import_profile');
  if (!hasRepairPatternAnalysis) addWarning('missing_repair_pattern_analysis');
  if (!hasAdaptivePolicy) addWarning('missing_adaptive_policy');
  if (!hasSelfHealingAudit) addWarning('missing_self_healing_audit');
  if (!hasPerformanceAudit) addWarning('missing_performance_audit');

  // Blockers
  if (!importId) addBlocker('import_id_missing');

  return { signals, evidence, warnings, blockers };
}
