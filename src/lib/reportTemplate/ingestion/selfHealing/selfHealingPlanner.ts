/**
 * selfHealingPlanner — Phase 10E.
 *
 * Builds a self-healing retry audit/plan from extracted signals and rules.
 * Deterministic; never executes anything (that is the executor's job).
 */
import {
  SELF_HEALING_RETRY_AUDIT_VERSION,
  type BuildSelfHealingPlanOptions,
  type SelfHealingActionPlan,
  type SelfHealingMode,
  type SelfHealingPlanStatus,
  type SelfHealingPlanSummary,
  type SelfHealingRetryAudit,
} from './selfHealingTypes';
import { extractSelfHealingSignals } from './selfHealingSignals';
import { deriveSelfHealingActionsFromSignals, SELF_HEALING_MAX_TOTAL_ACTIONS } from './selfHealingRules';

const VALID_MODES: SelfHealingMode[] = ['dry_run', 'audit_only', 'execute_safe', 'execute_confirmed'];
const VALID_PLAN_STATUSES: SelfHealingPlanStatus[] = ['planned', 'completed', 'completed_with_warnings', 'partial', 'blocked', 'failed', 'no_action'];
const VALID_ACTION_STATUSES = new Set(['pending', 'skipped', 'completed', 'failed', 'blocked', 'manual_required', 'not_supported']);

export function buildSelfHealingPlanId(input: {
  importId: string | null;
  now?: () => Date;
}): string {
  const ts = (input.now ?? (() => new Date()))().toISOString().replace(/[^a-zA-Z0-9_-]/g, '-');
  return `self-heal-${input.importId ?? 'unknown'}-${ts}`;
}

/** Dedupe by actionId (keeping earliest priority), sort, and cap to the max. */
export function limitSelfHealingActions(
  actions: SelfHealingActionPlan[],
): SelfHealingActionPlan[] {
  const seen = new Map<string, SelfHealingActionPlan>();
  for (const a of actions) {
    const existing = seen.get(a.actionId);
    if (!existing || a.priority < existing.priority) seen.set(a.actionId, a);
  }
  return [...seen.values()]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, SELF_HEALING_MAX_TOTAL_ACTIONS);
}

export function summarizeSelfHealingActions(
  actions: SelfHealingActionPlan[],
): SelfHealingPlanSummary {
  let executableActions = 0;
  let completedActions = 0;
  let failedActions = 0;
  let skippedActions = 0;
  let manualActions = 0;
  let blockedActions = 0;
  for (const a of actions) {
    if (a.status === 'pending') executableActions += 1;
    else if (a.status === 'completed') completedActions += 1;
    else if (a.status === 'failed') failedActions += 1;
    else if (a.status === 'skipped' || a.status === 'not_supported') skippedActions += 1;
    else if (a.status === 'manual_required') manualActions += 1;
    else if (a.status === 'blocked') blockedActions += 1;
  }
  return {
    totalActions: actions.length,
    executableActions,
    completedActions,
    failedActions,
    skippedActions,
    manualActions,
    blockedActions,
  };
}

export function resolveSelfHealingPlanStatus(
  actions: SelfHealingActionPlan[],
  blockers?: string[],
): SelfHealingPlanStatus {
  if (blockers && blockers.includes('import_id_missing')) return 'blocked';
  if (actions.length === 0) return 'no_action';
  if (actions.some((a) => a.actionId === 'block_until_manual_review' && a.status === 'blocked')) return 'blocked';
  return 'planned';
}

/** Build a self-healing retry plan (pre-execution). */
export function buildSelfHealingRetryPlan(
  options: BuildSelfHealingPlanOptions,
): SelfHealingRetryAudit {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const mode: SelfHealingMode = options.mode ?? 'dry_run';

  const extracted = extractSelfHealingSignals({
    importId: options.importId,
    templateId: options.templateId,
    sourceFilename: options.sourceFilename,
    snapshot: options.snapshot,
    importIntelligenceProfile: options.importIntelligenceProfile,
    repairPatternAnalysis: options.repairPatternAnalysis,
    adaptiveReconciliationPolicy: options.adaptiveReconciliationPolicy,
    visualQualitySummary: options.visualQualitySummary,
    repairSummary: options.repairSummary,
    exportParitySummary: options.exportParitySummary,
    goldenRegressionSummary: options.goldenRegressionSummary,
    qualityGateReport: options.qualityGateReport,
    triageSummary: options.triageSummary,
    previousAudit: options.previousAudit,
  });

  const { signals } = extracted;
  const derived = deriveSelfHealingActionsFromSignals({ signals, evidence: extracted.evidence });
  const actions = limitSelfHealingActions(derived);
  const summary = summarizeSelfHealingActions(actions);
  const status = resolveSelfHealingPlanStatus(actions, extracted.blockers);

  return {
    version: SELF_HEALING_RETRY_AUDIT_VERSION,
    importId: signals.importId,
    templateId: signals.templateId,
    sourceFilename: signals.sourceFilename,
    planId: buildSelfHealingPlanId({ importId: signals.importId, now }),
    mode,
    status,
    actions,
    summary,
    warnings: extracted.warnings,
    blockers: extracted.blockers,
    generatedAt,
    executedAt: null,
    persistedAt: null,
  };
}

/** Structural + summary-consistency validation of an audit. Non-throwing. */
export function validateSelfHealingRetryAudit(
  audit: SelfHealingRetryAudit,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!audit || typeof audit !== 'object') {
    return { ok: false, errors: ['audit_missing'], warnings: [] };
  }
  if (audit.version !== SELF_HEALING_RETRY_AUDIT_VERSION) errors.push('invalid_version');
  if (!audit.planId) errors.push('missing_plan_id');
  if (!VALID_MODES.includes(audit.mode)) errors.push('invalid_mode');
  if (!VALID_PLAN_STATUSES.includes(audit.status)) errors.push('invalid_status');
  if (!Array.isArray(audit.actions)) {
    errors.push('missing_actions');
  } else {
    for (const a of audit.actions) {
      if (!VALID_ACTION_STATUSES.has(a.status)) errors.push(`invalid_action_status_${a.actionId}`);
    }
    const recomputed = summarizeSelfHealingActions(audit.actions);
    if (!audit.summary || typeof audit.summary !== 'object') {
      errors.push('missing_summary');
    } else if (audit.summary.totalActions !== recomputed.totalActions) {
      errors.push('inconsistent_summary_total');
    }
  }
  if (!Array.isArray(audit.warnings)) warnings.push('missing_warnings_array');
  if (!Array.isArray(audit.blockers)) warnings.push('missing_blockers_array');
  if (!audit.importId) warnings.push('import_id_missing');

  return { ok: errors.length === 0, errors, warnings };
}
