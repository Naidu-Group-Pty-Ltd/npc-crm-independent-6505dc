/**
 * selfHealingRules — Phase 10E.
 *
 * Action definitions and the deterministic mapping from signals to planned
 * recovery actions with explicit safety gates. No I/O, no AI, no mutation.
 */
import type {
  SelfHealingActionDefinition,
  SelfHealingActionId,
  SelfHealingActionPlan,
  SelfHealingEvidence,
  SelfHealingSafetyLevel,
  SelfHealingSignals,
} from './selfHealingTypes';

export const SELF_HEALING_MAX_TOTAL_ACTIONS = 10;
export const SELF_HEALING_MAX_EXECUTABLE_ACTIONS = 5;
export const SELF_HEALING_DEFAULT_MAX_ATTEMPTS = 2;

const D = (
  actionId: SelfHealingActionId,
  label: string,
  description: string,
  defaultSafetyLevel: SelfHealingSafetyLevel,
  manualReason: string | null = null,
  blockedReason: string | null = null,
  maxAttempts = SELF_HEALING_DEFAULT_MAX_ATTEMPTS,
): SelfHealingActionDefinition => ({ actionId, label, description, defaultSafetyLevel, maxAttempts, manualReason, blockedReason });

export const SELF_HEALING_ACTION_DEFINITIONS: SelfHealingActionDefinition[] = [
  D('reload_snapshot', 'Reload snapshot', 'Re-evaluate import status/metadata before deciding next step.', 'safe_automatic'),
  D('build_import_intelligence_profile', 'Build import intelligence profile', 'Generate the Phase 10B import profile if missing or stale.', 'safe_automatic'),
  D('persist_import_intelligence_profile', 'Persist import intelligence profile', 'Save the import profile metadata.', 'operator_confirmed'),
  D('build_repair_pattern_analysis', 'Build repair pattern analysis', 'Generate the Phase 10C repair pattern analysis if missing or stale.', 'safe_automatic'),
  D('persist_repair_pattern_analysis', 'Persist repair pattern analysis', 'Save the repair pattern analysis metadata.', 'operator_confirmed'),
  D('build_adaptive_reconciliation_policy', 'Build adaptive reconciliation policy', 'Generate the Phase 10D adaptive reconciliation policy if missing or stale.', 'safe_automatic'),
  D('persist_adaptive_reconciliation_policy', 'Persist adaptive reconciliation policy', 'Save the adaptive reconciliation policy metadata.', 'operator_confirmed'),
  D('run_export_parity_automation', 'Run export parity automation', 'Run the Phase 9D export parity automation (persist off).', 'safe_automatic'),
  D('persist_export_parity_summary', 'Persist export parity summary', 'Persist the export parity summary the runner produced.', 'operator_confirmed'),
  D('rerun_golden_regression', 'Rerun golden regression', 'Rerun the Phase 9A golden corpus evaluation.', 'operator_confirmed'),
  D('persist_golden_regression_summary', 'Persist golden regression summary', 'Persist the latest golden regression summary.', 'operator_confirmed'),
  D('save_golden_run_history', 'Save golden run history', 'Append a golden run history row.', 'operator_confirmed'),
  D('rerun_visual_qa', 'Rerun Visual QA', 'Rerun Visual QA (browser/render-capture dependent).', 'manual_only', 'Visual QA requires browser render capture.'),
  D('rerun_repair', 'Rerun repair', 'Rerun deterministic repair (depends on editor/draft state).', 'manual_only', 'Repair depends on current editor/draft state.'),
  D('run_ai_reconciliation', 'Run AI reconciliation', 'Run AI reconciliation (never automatic in Phase 10E).', 'manual_only', 'AI reconciliation is operator-triggered only.'),
  D('rerun_export_parity_manual', 'Rerun export parity (manual)', 'Operator manually records export parity.', 'manual_only', 'Manual export parity recording is operator-driven.'),
  D('rerun_import', 'Rerun PDF import', 'Reimport the source PDF.', 'manual_only', 'Reimport is operator-driven.'),
  D('inspect_template_editor', 'Inspect template editor', 'Human inspection of the template editor.', 'manual_only', 'Human inspection required.'),
  D('inspect_storage_artifacts', 'Inspect storage artifacts', 'Operator checks storage artifacts.', 'manual_only', 'Operator inspection required.'),
  D('inspect_pdf_import_jobs', 'Inspect PDF import jobs', 'Operator checks diagnostics jobs.', 'manual_only', 'Operator inspection required.'),
  D('inspect_supabase_function_logs', 'Inspect Supabase function logs', 'Developer checks Edge Function logs.', 'manual_only', 'Developer inspection required.'),
  D('inspect_cloud_run_logs', 'Inspect Cloud Run logs', 'Developer checks Cloud Run logs.', 'manual_only', 'Developer inspection required.'),
  D('block_until_manual_review', 'Block until manual review', 'Stop automated healing until human review.', 'blocked', null, 'Automated healing is blocked pending manual review.'),
];

const PRIORITY: Record<SelfHealingActionId, number> = {
  block_until_manual_review: 2,
  reload_snapshot: 3,
  build_import_intelligence_profile: 10,
  persist_import_intelligence_profile: 11,
  build_repair_pattern_analysis: 12,
  persist_repair_pattern_analysis: 13,
  build_adaptive_reconciliation_policy: 14,
  persist_adaptive_reconciliation_policy: 15,
  run_export_parity_automation: 20,
  persist_export_parity_summary: 21,
  rerun_golden_regression: 30,
  persist_golden_regression_summary: 31,
  save_golden_run_history: 32,
  rerun_export_parity_manual: 40,
  rerun_visual_qa: 41,
  rerun_repair: 42,
  run_ai_reconciliation: 50,
  rerun_import: 60,
  inspect_pdf_import_jobs: 70,
  inspect_supabase_function_logs: 71,
  inspect_cloud_run_logs: 72,
  inspect_storage_artifacts: 73,
  inspect_template_editor: 74,
};

const DEF_MAP = new Map(SELF_HEALING_ACTION_DEFINITIONS.map((d) => [d.actionId, d]));

export function getSelfHealingActionDefinition(
  actionId: SelfHealingActionId | string,
): SelfHealingActionDefinition | null {
  return DEF_MAP.get(actionId as SelfHealingActionId) ?? null;
}

export function listSelfHealingActionDefinitions(): SelfHealingActionDefinition[] {
  return [...SELF_HEALING_ACTION_DEFINITIONS];
}

function lower(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/** Returns a block reason string when the action must not proceed, else null. */
export function shouldBlockSelfHealingAction(input: {
  actionId: SelfHealingActionId;
  signals: SelfHealingSignals;
}): string | null {
  const { actionId, signals: s } = input;
  const def = getSelfHealingActionDefinition(actionId);
  if (def?.defaultSafetyLevel === 'blocked') return def.blockedReason ?? 'blocked';
  if (actionId === 'run_ai_reconciliation') {
    if (s.adaptiveAiBlocked === true || lower(s.adaptiveDecision) === 'blocked') return 'ai_blocked_by_adaptive_policy';
    if (lower(s.deterministicRepairStrategy) === 'blocked') return 'ai_blocked_by_repair_pattern';
  }
  if (actionId === 'rerun_repair' && lower(s.deterministicRepairStrategy) === 'blocked') {
    return 'repair_blocked_by_pattern';
  }
  return null;
}

/** Returns a skip reason string when the action is unnecessary, else null. */
export function shouldSkipSelfHealingAction(input: {
  actionId: SelfHealingActionId;
  signals: SelfHealingSignals;
}): string | null {
  const { actionId, signals: s } = input;
  if (actionId === 'build_import_intelligence_profile' && s.hasImportIntelligenceProfile) return 'profile_already_present';
  if (actionId === 'build_repair_pattern_analysis' && s.hasRepairPatternAnalysis) return 'repair_pattern_already_present';
  if (actionId === 'build_adaptive_reconciliation_policy' && s.hasAdaptiveReconciliationPolicy) return 'adaptive_policy_already_present';
  if (actionId === 'run_export_parity_automation' && s.hasExportParity
    && lower(s.exportParityStatus) === 'completed' && (s.exportVsSourceScore ?? 0) >= 0.85) {
    return 'export_parity_acceptable';
  }
  if (actionId === 'rerun_golden_regression' && lower(s.goldenQualityGateStatus) === 'pass') return 'golden_pass';
  return null;
}

/** Base safety level for an action (blocked when a block reason applies). */
export function resolveSelfHealingSafetyLevel(input: {
  actionId: SelfHealingActionId;
  signals: SelfHealingSignals;
}): SelfHealingSafetyLevel {
  if (shouldBlockSelfHealingAction(input)) return 'blocked';
  return getSelfHealingActionDefinition(input.actionId)?.defaultSafetyLevel ?? 'manual_only';
}

/** Build a single action plan with resolved safety level and status. */
export function buildSelfHealingActionPlan(input: {
  actionId: SelfHealingActionId;
  signals: SelfHealingSignals;
  evidence?: SelfHealingEvidence[];
  priority: number;
  reasonCodes: string[];
  safetyLevel?: SelfHealingSafetyLevel;
  message?: string;
}): SelfHealingActionPlan {
  const { actionId, signals } = input;
  const def = getSelfHealingActionDefinition(actionId);
  const label = def?.label ?? actionId;
  const maxAttempts = def?.maxAttempts ?? SELF_HEALING_DEFAULT_MAX_ATTEMPTS;
  const attemptCount = signals.previousAuditActionCounts[actionId] ?? 0;
  const reasonCodes = [...input.reasonCodes];

  const blockReason = shouldBlockSelfHealingAction({ actionId, signals });
  const skipReason = shouldSkipSelfHealingAction({ actionId, signals });
  let safetyLevel: SelfHealingSafetyLevel = input.safetyLevel ?? resolveSelfHealingSafetyLevel({ actionId, signals });
  let status: SelfHealingActionPlan['status'];

  if (blockReason || safetyLevel === 'blocked') {
    safetyLevel = 'blocked';
    status = 'blocked';
    if (blockReason && !reasonCodes.includes(blockReason)) reasonCodes.push(blockReason);
  } else if (attemptCount >= maxAttempts) {
    status = 'skipped';
    if (!reasonCodes.includes('max_attempts_reached')) reasonCodes.push('max_attempts_reached');
  } else if (safetyLevel === 'manual_only') {
    status = 'manual_required';
  } else if (skipReason) {
    status = 'skipped';
    if (!reasonCodes.includes(skipReason)) reasonCodes.push(skipReason);
  } else {
    status = 'pending';
  }

  return {
    actionId,
    label,
    safetyLevel,
    status,
    priority: input.priority,
    reasonCodes,
    prerequisites: [],
    evidence: input.evidence ? [...input.evidence] : [],
    maxAttempts,
    attemptCount,
    message: input.message ?? def?.description ?? label,
    resultMessage: null,
  };
}

/** Deterministically derive planned actions from signals. Deduped, priority-sorted. */
export function deriveSelfHealingActionsFromSignals(input: {
  signals: SelfHealingSignals;
  evidence?: SelfHealingEvidence[];
}): SelfHealingActionPlan[] {
  const s = input.signals;
  const acc = new Map<SelfHealingActionId, string[]>();
  const add = (actionId: SelfHealingActionId, reason: string) => {
    const list = acc.get(actionId) ?? [];
    if (!list.includes(reason)) list.push(reason);
    acc.set(actionId, list);
  };

  // 1-3. Missing derived-metadata layers → build (+ persist).
  if (!s.hasImportIntelligenceProfile) { add('build_import_intelligence_profile', 'missing_profile'); add('persist_import_intelligence_profile', 'missing_profile'); }
  if (!s.hasRepairPatternAnalysis) { add('build_repair_pattern_analysis', 'missing_repair_pattern_analysis'); add('persist_repair_pattern_analysis', 'missing_repair_pattern_analysis'); }
  if (!s.hasAdaptiveReconciliationPolicy) { add('build_adaptive_reconciliation_policy', 'missing_adaptive_policy'); add('persist_adaptive_reconciliation_policy', 'missing_adaptive_policy'); }

  // 4. Export parity.
  if (!s.hasExportParity) { add('run_export_parity_automation', 'missing_export_parity'); add('persist_export_parity_summary', 'missing_export_parity'); }
  if (lower(s.exportParityStatus) === 'manual_required' || lower(s.exportParityStatus) === 'failed') {
    add('rerun_export_parity_manual', 'export_parity_manual_required');
  }

  // 5-6. Visual QA / repair audit missing → manual.
  if (!s.hasVisualQuality) add('rerun_visual_qa', 'missing_visual_quality');
  if (!s.hasRepairAudit) add('rerun_repair', 'missing_repair_audit');

  // 7. Repair failed.
  if (lower(s.repairStatus) === 'failed') {
    add('build_repair_pattern_analysis', 'repair_failed');
    add('build_adaptive_reconciliation_policy', 'repair_failed');
    add('rerun_repair', 'repair_failed');
    if (lower(s.adaptiveDecision) === 'recommended' && s.adaptiveAiBlocked !== true) add('run_ai_reconciliation', 'ai_recommended_not_run');
  }

  // 8. AI recommended.
  if (lower(s.adaptiveDecision) === 'recommended') {
    add('build_adaptive_reconciliation_policy', 'ai_recommended_not_run');
    add('run_ai_reconciliation', 'ai_recommended_not_run');
  }

  // 9. Adaptive policy blocked.
  if (s.adaptiveAiBlocked === true || lower(s.adaptiveDecision) === 'blocked') {
    add('block_until_manual_review', 'adaptive_policy_blocked');
    add('inspect_template_editor', 'adaptive_policy_blocked');
  }

  // 10. Repair pattern manual-review-only / block.
  if (s.primaryRepairPatternId === 'manual_review_only'
    || lower(s.repairPatternOperatorReviewRequirement) === 'block_until_review'
    || lower(s.deterministicRepairStrategy) === 'blocked') {
    add('block_until_manual_review', 'repair_pattern_blocked');
    add('inspect_template_editor', 'repair_pattern_blocked');
  }

  // 11. Golden regression fail/blocked.
  if (['fail', 'blocked'].includes(lower(s.goldenQualityGateStatus))) {
    add('rerun_golden_regression', 'golden_gate_failed');
    add('persist_golden_regression_summary', 'golden_gate_failed');
  }

  // 12. Baseline degraded.
  if (lower(s.baselineOutcome) === 'degraded') {
    add('build_repair_pattern_analysis', 'baseline_degraded');
    add('build_adaptive_reconciliation_policy', 'baseline_degraded');
    add('rerun_golden_regression', 'baseline_degraded');
    add('inspect_template_editor', 'baseline_degraded');
  }

  // 13. Import failed/stale.
  if (['failed', 'stale', 'error'].includes(lower(s.importStatus))) {
    add('inspect_pdf_import_jobs', 'import_failed');
    add('inspect_supabase_function_logs', 'import_failed');
    add('inspect_cloud_run_logs', 'import_failed');
    add('rerun_import', 'import_failed');
  }

  const plans: SelfHealingActionPlan[] = [];
  for (const [actionId, reasonCodes] of acc.entries()) {
    plans.push(buildSelfHealingActionPlan({
      actionId,
      signals: s,
      evidence: input.evidence,
      priority: PRIORITY[actionId] ?? 99,
      reasonCodes,
    }));
  }
  plans.sort((a, b) => a.priority - b.priority);
  return plans;
}
