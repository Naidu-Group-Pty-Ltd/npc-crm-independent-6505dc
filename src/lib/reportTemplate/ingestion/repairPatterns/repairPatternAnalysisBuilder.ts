/**
 * repairPatternAnalysisBuilder — Phase 10C.
 *
 * Assembles a complete RepairPatternAnalysis from available input by extracting
 * signals, matching patterns, and resolving the overall strategy. Deterministic
 * and non-throwing.
 */
import {
  REPAIR_PATTERN_ANALYSIS_VERSION,
  type BuildRepairPatternAnalysisOptions,
  type RepairPatternAnalysis,
  type RepairPatternDeterministicRepairStrategy,
  type RepairPatternAiReconciliationUsefulness,
  type RepairPatternExportParityRequirement,
  type RepairPatternOperatorReviewRequirement,
  type RepairPatternSeverity,
} from './repairPatternTypes';
import { extractRepairPatternSignals } from './repairPatternSignals';
import {
  matchRepairPatterns,
  resolveAiReconciliationUsefulness,
  resolveDeterministicRepairStrategy,
  resolveExportParityRequirement,
  resolveOperatorReviewRequirement,
  resolveOverallRepairPatternConfidence,
  resolveOverallRepairPatternSeverity,
  resolvePrimaryRepairPattern,
} from './repairPatternMatcher';

const VALID_SEVERITIES: RepairPatternSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
const VALID_REPAIR_STRATEGIES: RepairPatternDeterministicRepairStrategy[] = ['safe', 'safe_with_review', 'constrained', 'manual_only', 'blocked', 'unknown'];
const VALID_AI: RepairPatternAiReconciliationUsefulness[] = ['not_needed', 'low', 'medium', 'high', 'manual_review_only', 'blocked'];
const VALID_EXPORT: RepairPatternExportParityRequirement[] = ['not_required', 'recommended', 'required', 'rerun_required', 'manual_required'];
const VALID_REVIEW: RepairPatternOperatorReviewRequirement[] = ['not_required', 'recommended', 'required', 'block_until_review'];

function dedupe(...sets: Array<string[] | null | undefined>): string[] {
  const out: string[] = [];
  for (const set of sets) {
    if (!set) continue;
    for (const v of set) if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function mergeRepairPatternWarnings(...sets: Array<string[] | null | undefined>): string[] {
  return dedupe(...sets);
}

export function mergeRepairPatternBlockers(...sets: Array<string[] | null | undefined>): string[] {
  return dedupe(...sets);
}

/** Build a complete, deterministic RepairPatternAnalysis. */
export function buildRepairPatternAnalysis(
  options: BuildRepairPatternAnalysisOptions,
): RepairPatternAnalysis {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();

  const extracted = extractRepairPatternSignals({
    importId: options.importId,
    templateId: options.templateId,
    sourceFilename: options.sourceFilename,
    snapshot: options.snapshot,
    importIntelligenceProfile: options.importIntelligenceProfile,
    visualQualitySummary: options.visualQualitySummary,
    repairSummary: options.repairSummary,
    exportParitySummary: options.exportParitySummary,
    goldenRegressionSummary: options.goldenRegressionSummary,
    qualityGateReport: options.qualityGateReport,
    triageSummary: options.triageSummary,
    templateSchema: options.templateSchema,
  });

  const { signals } = extracted;
  const allMatches = matchRepairPatterns({ signals, evidence: extracted.evidence });
  const matchedPatterns = allMatches.filter((m) => m.matched);

  const primary = resolvePrimaryRepairPattern(allMatches);
  const warnings = mergeRepairPatternWarnings(extracted.warnings);
  const blockers = mergeRepairPatternBlockers(extracted.blockers);

  if (matchedPatterns.length === 0) warnings.push('no_repair_patterns_matched');

  const analysis: RepairPatternAnalysis = {
    version: REPAIR_PATTERN_ANALYSIS_VERSION,
    importId: signals.importId,
    templateId: signals.templateId,
    sourceFilename: signals.sourceFilename,
    profileCategory: signals.profileCategory,
    importRiskLevel: signals.importRiskLevel,
    matchedPatterns,
    primaryPatternId: primary ? primary.patternId : null,
    overallSeverity: resolveOverallRepairPatternSeverity(allMatches),
    overallConfidence: resolveOverallRepairPatternConfidence(allMatches),
    deterministicRepairStrategy: matchedPatterns.length === 0
      ? 'unknown'
      : resolveDeterministicRepairStrategy(allMatches, signals),
    aiReconciliationUsefulness: resolveAiReconciliationUsefulness(allMatches, signals),
    exportParityRequirement: resolveExportParityRequirement(allMatches, signals),
    operatorReviewRequirement: resolveOperatorReviewRequirement(allMatches, signals),
    evidence: extracted.evidence,
    warnings: mergeRepairPatternWarnings(warnings),
    blockers,
    generatedAt,
  };

  return analysis;
}

/** Structural validation of a built analysis. Non-throwing. */
export function validateRepairPatternAnalysis(
  analysis: RepairPatternAnalysis,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!analysis || typeof analysis !== 'object') {
    return { ok: false, errors: ['analysis_missing'], warnings: [] };
  }
  if (analysis.version !== REPAIR_PATTERN_ANALYSIS_VERSION) errors.push('invalid_version');
  if (!Array.isArray(analysis.matchedPatterns)) errors.push('invalid_matched_patterns');
  if (typeof analysis.overallConfidence !== 'number' || analysis.overallConfidence < 0 || analysis.overallConfidence > 1) {
    errors.push('invalid_overall_confidence');
  }
  if (!VALID_SEVERITIES.includes(analysis.overallSeverity)) errors.push('invalid_severity');
  if (!VALID_REPAIR_STRATEGIES.includes(analysis.deterministicRepairStrategy)) errors.push('invalid_repair_strategy');
  if (!VALID_AI.includes(analysis.aiReconciliationUsefulness)) errors.push('invalid_ai_usefulness');
  if (!VALID_EXPORT.includes(analysis.exportParityRequirement)) errors.push('invalid_export_parity_requirement');
  if (!VALID_REVIEW.includes(analysis.operatorReviewRequirement)) errors.push('invalid_operator_review_requirement');
  if (!Array.isArray(analysis.evidence)) warnings.push('missing_evidence');
  if (!Array.isArray(analysis.warnings)) errors.push('invalid_warnings');
  if (!Array.isArray(analysis.blockers)) errors.push('invalid_blockers');

  if (Array.isArray(analysis.matchedPatterns)) {
    for (const m of analysis.matchedPatterns) {
      if (typeof m.score !== 'number' || m.score < 0 || m.score > 1) errors.push(`invalid_match_score_${m.patternId}`);
      if (typeof m.confidence !== 'number' || m.confidence < 0 || m.confidence > 1) errors.push(`invalid_match_confidence_${m.patternId}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
