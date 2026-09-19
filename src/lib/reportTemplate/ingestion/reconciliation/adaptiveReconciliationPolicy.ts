/**
 * adaptiveReconciliationPolicy — Phase 10D.
 *
 * Deterministic evaluation of whether AI reconciliation is not_needed / optional
 * / recommended / manual_review / blocked, from import intelligence, repair
 * patterns, and QA signals. Never calls AI, never applies reconciliation.
 */
import {
  ADAPTIVE_RECONCILIATION_POLICY_VERSION,
  type AdaptiveReconciliationDecision,
  type AdaptiveReconciliationEvidence,
  type AdaptiveReconciliationFlags,
  type AdaptiveReconciliationPolicy,
  type AdaptiveReconciliationRecommendedAction,
  type AdaptiveReconciliationSeverity,
  type AdaptiveReconciliationSignals,
  type AdaptiveReconciliationSourceSummary,
  type BuildAdaptiveReconciliationPolicyOptions,
} from './adaptiveReconciliationTypes';
import { extractAdaptiveReconciliationSignals } from './adaptiveReconciliationSignals';

const VALID_DECISIONS: AdaptiveReconciliationDecision[] = ['not_needed', 'optional', 'recommended', 'manual_review', 'blocked'];
const VALID_SEVERITIES: AdaptiveReconciliationSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
const VALID_ACTIONS: AdaptiveReconciliationRecommendedAction[] = [
  'no_action', 'allow_operator_choice', 'run_ai_reconciliation', 'run_ai_reconciliation_with_review',
  'require_manual_review', 'block_ai_reconciliation', 'rerun_visual_qa_first', 'rerun_repair_first',
  'rerun_export_parity_first', 'inspect_template_editor', 'inspect_repair_patterns', 'inspect_import_profile',
];

const BLOCKING_GATE_KEYWORDS = ['template_missing', 'import_failed', 'visual_quality', 'repair_audit'];

function lower(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return Math.round(v * 1000) / 1000;
}

function num(v: number | null): number {
  return v === null ? 0 : v;
}

/** 0..1 confidence based on evidence coverage. */
export function calculateAdaptiveReconciliationConfidence(input: {
  signals: AdaptiveReconciliationSignals;
  evidence?: AdaptiveReconciliationEvidence[];
}): number {
  const s = input.signals;
  let coverage = 0;
  if (s.profileCategory !== null) coverage += 0.2;
  if (s.primaryRepairPatternId !== null || s.repairPatternSeverity !== null) coverage += 0.2;
  if (s.visualQaScore !== null) coverage += 0.15;
  if (s.repairStatus !== null || s.repairFinalScore !== null) coverage += 0.15;
  if (s.exportParityStatus !== null) coverage += 0.15;
  if (s.goldenQualityGateStatus !== null) coverage += 0.1;
  if (s.qualityGateFailures.length > 0 || s.triageFailureCodes.length > 0) coverage += 0.05;
  if (input.evidence && input.evidence.length >= 3) coverage += 0.05;
  if (s.importId !== null) coverage = Math.max(coverage, 0.2);
  return clamp01(Math.min(coverage, 0.98));
}

function isBlocked(s: AdaptiveReconciliationSignals): boolean {
  if (!s.importId) return true;
  if (lower(s.deterministicRepairStrategy) === 'blocked') return true;
  if (lower(s.repairPatternAiUsefulness) === 'blocked') return true;
  if (lower(s.repairPatternOperatorReviewRequirement) === 'block_until_review') return true;
  if (lower(s.goldenQualityGateStatus) === 'blocked') return true;
  if (num(s.automationRiskScore) >= 0.85) return true;
  if (lower(s.profileCategory) === 'scanned_ocr' && num(s.ocrRiskScore) >= 0.85 && num(s.manualReviewLikelihood) >= 0.75) return true;
  if (s.qualityGateFailures.some((f) => BLOCKING_GATE_KEYWORDS.some((k) => f.toLowerCase().includes(k)))) return true;
  return false;
}

function isManualReview(s: AdaptiveReconciliationSignals): boolean {
  if (s.primaryRepairPatternId === 'manual_review_only') return true;
  if (s.primaryRepairPatternId === 'ocr_text_fragments') return true;
  if (s.primaryRepairPatternId === 'missing_major_visual_element') return true;
  if (s.visualQaManualReviewRequired === true) return true;
  if (s.repairRequiresManualReview === true) return true;
  if (lower(s.exportParityStatus) === 'manual_required') return true;
  if (['high', 'critical'].includes(lower(s.importRiskLevel))) return true;
  if (num(s.manualReviewLikelihood) >= 0.75) return true;
  if (lower(s.goldenQualityGateStatus) === 'fail') return true;
  if (lower(s.baselineOutcome) === 'degraded') return true;
  if (lower(s.profileCategory) === 'scanned_ocr') return true;
  return false;
}

function isRecommended(s: AdaptiveReconciliationSignals): boolean {
  if (lower(s.repairPatternAiUsefulness) === 'high') return true;
  if (s.visualQaScore !== null && s.visualQaScore < 0.85) return true;
  if (s.repairFinalScore !== null && s.repairFinalScore < 0.85 && lower(s.repairStatus) !== 'failed') return true;
  if (lower(s.repairStatus) === 'failed') return true;
  if (lower(s.exportParityStatus) === 'failed') return true;
  if (s.exportVsSourceScore !== null && s.exportVsSourceScore < 0.85) return true;
  if (lower(s.goldenQualityGateStatus) === 'warning') return true;
  return false;
}

function isOptional(s: AdaptiveReconciliationSignals): boolean {
  if (lower(s.repairPatternAiUsefulness) === 'medium') return true;
  if (s.visualQaScore !== null && s.visualQaScore >= 0.85 && s.visualQaScore < 0.92) return true;
  if (s.repairFinalScore !== null && s.repairFinalScore >= 0.85 && s.repairFinalScore < 0.92) return true;
  for (const r of [s.designRiskScore, s.tableRiskScore, s.imageRiskScore]) {
    if (r !== null && r >= 0.35 && r < 0.65) return true;
  }
  return false;
}

function decide(s: AdaptiveReconciliationSignals): AdaptiveReconciliationDecision {
  if (isBlocked(s)) return 'blocked';
  if (isManualReview(s)) return 'manual_review';
  if (isRecommended(s)) return 'recommended';
  if (isOptional(s)) return 'optional';
  return 'not_needed';
}

/** Base severity for a decision, with limited risk-based escalation. */
export function resolveAdaptiveReconciliationSeverity(input: {
  decision: AdaptiveReconciliationDecision;
  signals: AdaptiveReconciliationSignals;
}): AdaptiveReconciliationSeverity {
  const { decision, signals: s } = input;
  switch (decision) {
    case 'blocked':
      return 'critical';
    case 'manual_review':
      return 'high';
    case 'recommended':
      return (num(s.automationRiskScore) >= 0.65 || ['high', 'critical'].includes(lower(s.importRiskLevel))) ? 'high' : 'medium';
    case 'optional':
      return num(s.manualReviewLikelihood) >= 0.6 ? 'medium' : 'low';
    case 'not_needed':
    default:
      return 'info';
  }
}

/** Base recommended action for a decision. */
export function resolveAdaptiveReconciliationAction(input: {
  decision: AdaptiveReconciliationDecision;
  signals: AdaptiveReconciliationSignals;
}): AdaptiveReconciliationRecommendedAction {
  const { decision, signals: s } = input;
  switch (decision) {
    case 'blocked':
      return 'block_ai_reconciliation';
    case 'manual_review':
      return 'require_manual_review';
    case 'recommended':
      if (lower(s.repairStatus) === 'failed') return 'rerun_repair_first';
      if (lower(s.exportParityStatus) === 'failed') return 'rerun_export_parity_first';
      return 'run_ai_reconciliation';
    case 'optional':
      return 'allow_operator_choice';
    case 'not_needed':
    default:
      return 'no_action';
  }
}

/** Flags for a decision. */
export function buildAdaptiveReconciliationFlags(input: {
  decision: AdaptiveReconciliationDecision;
  signals: AdaptiveReconciliationSignals;
}): AdaptiveReconciliationFlags {
  const { decision, signals: s } = input;
  const repairMissingOrFailed = lower(s.repairStatus) === 'failed' || s.repairStatus === null;
  switch (decision) {
    case 'not_needed':
      return {
        requiresOperatorConfirmation: false,
        requiresManualReview: false,
        requiresVisualQaAfterReconciliation: false,
        requiresExportParityAfterReconciliation: false,
        shouldRerunRepairBeforeReconciliation: false,
        aiAllowed: true,
        aiBlocked: false,
        canProceedWithoutAi: true,
      };
    case 'optional':
      return {
        requiresOperatorConfirmation: true,
        requiresManualReview: s.visualQaManualReviewRequired === true || s.repairRequiresManualReview === true,
        requiresVisualQaAfterReconciliation: true,
        requiresExportParityAfterReconciliation: true,
        shouldRerunRepairBeforeReconciliation: false,
        aiAllowed: true,
        aiBlocked: false,
        canProceedWithoutAi: true,
      };
    case 'recommended':
      return {
        requiresOperatorConfirmation: true,
        requiresManualReview: false,
        requiresVisualQaAfterReconciliation: true,
        requiresExportParityAfterReconciliation: true,
        shouldRerunRepairBeforeReconciliation: repairMissingOrFailed,
        aiAllowed: true,
        aiBlocked: false,
        canProceedWithoutAi: false,
      };
    case 'manual_review':
      return {
        requiresOperatorConfirmation: true,
        requiresManualReview: true,
        requiresVisualQaAfterReconciliation: true,
        requiresExportParityAfterReconciliation: true,
        shouldRerunRepairBeforeReconciliation: false,
        aiAllowed: true,
        aiBlocked: false,
        canProceedWithoutAi: false,
      };
    case 'blocked':
    default:
      return {
        requiresOperatorConfirmation: true,
        requiresManualReview: true,
        requiresVisualQaAfterReconciliation: false,
        requiresExportParityAfterReconciliation: false,
        shouldRerunRepairBeforeReconciliation: false,
        aiAllowed: false,
        aiBlocked: true,
        canProceedWithoutAi: false,
      };
  }
}

/** Evaluate the deterministic adaptive reconciliation decision. */
export function evaluateAdaptiveReconciliationDecision(input: {
  signals: AdaptiveReconciliationSignals;
  evidence?: AdaptiveReconciliationEvidence[];
}): {
  decision: AdaptiveReconciliationDecision;
  severity: AdaptiveReconciliationSeverity;
  confidence: number;
  recommendedAction: AdaptiveReconciliationRecommendedAction;
  flags: AdaptiveReconciliationFlags;
  reasons: string[];
  warnings: string[];
  blockers: string[];
} {
  const s = input.signals;
  const decision = decide(s);
  const severity = resolveAdaptiveReconciliationSeverity({ decision, signals: s });
  const recommendedAction = resolveAdaptiveReconciliationAction({ decision, signals: s });
  const flags = buildAdaptiveReconciliationFlags({ decision, signals: s });
  const confidence = calculateAdaptiveReconciliationConfidence({ signals: s, evidence: input.evidence });

  const reasons: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (!s.importId) blockers.push('import_id_missing');
  if (decision === 'blocked') {
    if (lower(s.deterministicRepairStrategy) === 'blocked') { reasons.push('repair_pattern_strategy_blocked'); blockers.push('ai_blocked_by_repair_pattern'); }
    if (lower(s.repairPatternAiUsefulness) === 'blocked') { reasons.push('repair_pattern_ai_blocked'); blockers.push('ai_blocked_by_repair_pattern'); }
    if (num(s.automationRiskScore) >= 0.85) { reasons.push('automation_risk_too_high'); }
    if (lower(s.profileCategory) === 'scanned_ocr' && num(s.ocrRiskScore) >= 0.85) { reasons.push('ocr_risk_too_high'); blockers.push('ai_blocked_by_high_risk_ocr'); }
    if (lower(s.goldenQualityGateStatus) === 'blocked') { reasons.push('quality_gate_blocked'); }
    if (s.qualityGateFailures.some((f) => BLOCKING_GATE_KEYWORDS.some((k) => f.toLowerCase().includes(k)))) { reasons.push('blocking_quality_gate_failure'); blockers.push('missing_required_context'); }
  } else if (decision === 'manual_review') {
    reasons.push('manual_review_preferred');
  } else if (decision === 'recommended') {
    reasons.push('ai_reconciliation_recommended');
  } else if (decision === 'optional') {
    reasons.push('ai_reconciliation_optional');
  } else {
    reasons.push('ai_reconciliation_not_needed');
  }

  if (lower(s.existingAiReconciliationStatus) === 'failed') warnings.push('prior_ai_reconciliation_failed');

  return {
    decision,
    severity,
    confidence,
    recommendedAction,
    flags,
    reasons: reasons.filter((r, i, a) => a.indexOf(r) === i),
    warnings: warnings.filter((w, i, a) => a.indexOf(w) === i),
    blockers: blockers.filter((b, i, a) => a.indexOf(b) === i),
  };
}

function dedupe(...sets: Array<string[] | null | undefined>): string[] {
  const out: string[] = [];
  for (const set of sets) {
    if (!set) continue;
    for (const v of set) if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Build a complete, deterministic AdaptiveReconciliationPolicy. */
export function buildAdaptiveReconciliationPolicy(
  options: BuildAdaptiveReconciliationPolicyOptions,
): AdaptiveReconciliationPolicy {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();

  const extracted = extractAdaptiveReconciliationSignals({
    importId: options.importId,
    templateId: options.templateId,
    sourceFilename: options.sourceFilename,
    snapshot: options.snapshot,
    importIntelligenceProfile: options.importIntelligenceProfile,
    repairPatternAnalysis: options.repairPatternAnalysis,
    visualQualitySummary: options.visualQualitySummary,
    repairSummary: options.repairSummary,
    exportParitySummary: options.exportParitySummary,
    goldenRegressionSummary: options.goldenRegressionSummary,
    qualityGateReport: options.qualityGateReport,
    triageSummary: options.triageSummary,
    existingAiReconciliationSummary: options.existingAiReconciliationSummary,
  });

  const { signals } = extracted;
  const evaluated = evaluateAdaptiveReconciliationDecision({ signals, evidence: extracted.evidence });

  const sourceSummary: AdaptiveReconciliationSourceSummary = {
    profileCategory: signals.profileCategory,
    importRiskLevel: signals.importRiskLevel,
    primaryRepairPatternId: signals.primaryRepairPatternId,
    repairPatternSeverity: signals.repairPatternSeverity,
    visualQaScore: signals.visualQaScore,
    repairStatus: signals.repairStatus,
    exportParityStatus: signals.exportParityStatus,
    goldenQualityGateStatus: signals.goldenQualityGateStatus,
  };

  return {
    version: ADAPTIVE_RECONCILIATION_POLICY_VERSION,
    importId: signals.importId,
    templateId: signals.templateId,
    sourceFilename: signals.sourceFilename,
    decision: evaluated.decision,
    severity: evaluated.severity,
    confidence: evaluated.confidence,
    recommendedAction: evaluated.recommendedAction,
    reasons: evaluated.reasons,
    evidence: extracted.evidence,
    flags: evaluated.flags,
    sourceSummary,
    warnings: dedupe(extracted.warnings, evaluated.warnings),
    blockers: dedupe(extracted.blockers, evaluated.blockers),
    generatedAt,
  };
}

/** Structural validation of a built policy. Non-throwing. */
export function validateAdaptiveReconciliationPolicy(
  policy: AdaptiveReconciliationPolicy,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!policy || typeof policy !== 'object') {
    return { ok: false, errors: ['policy_missing'], warnings: [] };
  }
  if (policy.version !== ADAPTIVE_RECONCILIATION_POLICY_VERSION) errors.push('invalid_version');
  if (!VALID_DECISIONS.includes(policy.decision)) errors.push('invalid_decision');
  if (!VALID_SEVERITIES.includes(policy.severity)) errors.push('invalid_severity');
  if (!VALID_ACTIONS.includes(policy.recommendedAction)) errors.push('invalid_action');
  if (typeof policy.confidence !== 'number' || policy.confidence < 0 || policy.confidence > 1) errors.push('invalid_confidence');
  if (!policy.flags || typeof policy.flags !== 'object') errors.push('missing_flags');
  if (!policy.sourceSummary || typeof policy.sourceSummary !== 'object') errors.push('missing_source_summary');
  if (!Array.isArray(policy.reasons)) errors.push('invalid_reasons');
  if (!Array.isArray(policy.evidence)) warnings.push('missing_evidence');
  if (!Array.isArray(policy.warnings)) errors.push('invalid_warnings');
  if (!Array.isArray(policy.blockers)) errors.push('invalid_blockers');

  return { ok: errors.length === 0, errors, warnings };
}
