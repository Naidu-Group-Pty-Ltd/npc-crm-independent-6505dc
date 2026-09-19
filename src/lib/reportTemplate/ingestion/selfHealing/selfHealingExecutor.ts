/**
 * selfHealingExecutor — Phase 10E.
 *
 * Conservative executor: enforces safety gates and updates action statuses. It
 * only "executes" reload_snapshot (state evaluation); every other build/persist/
 * run action is marked not_supported in the standalone executor — the golden
 * corpus orchestrator performs real generation/persistence with full context.
 * It NEVER runs AI reconciliation, reruns imports, or mutates templates.
 */
import type {
  ExecuteSelfHealingPlanOptions,
  SelfHealingActionPlan,
  SelfHealingPlanStatus,
  SelfHealingRetryAudit,
} from './selfHealingTypes';
import { summarizeSelfHealingActions } from './selfHealingPlanner';

/** Whether an action may be executed under the given mode/confirmation. */
export function canExecuteSelfHealingAction(input: {
  action: SelfHealingActionPlan;
  mode: ExecuteSelfHealingPlanOptions['mode'];
  operatorConfirmed?: boolean;
}): { canExecute: boolean; reason?: string } {
  const { action, mode, operatorConfirmed } = input;
  if (mode === 'dry_run') return { canExecute: false, reason: 'dry_run' };
  if (mode === 'audit_only') return { canExecute: false, reason: 'audit_only' };
  if (action.safetyLevel === 'blocked') return { canExecute: false, reason: 'blocked' };
  if (action.safetyLevel === 'manual_only') return { canExecute: false, reason: 'manual_only' };
  if (action.status !== 'pending') return { canExecute: false, reason: `status_${action.status}` };

  if (action.safetyLevel === 'safe_automatic') return { canExecute: true };
  if (action.safetyLevel === 'operator_confirmed') {
    if (mode === 'execute_confirmed' && operatorConfirmed === true) return { canExecute: true };
    return { canExecute: false, reason: 'operator_confirmation_required' };
  }
  return { canExecute: false, reason: 'not_executable' };
}

/**
 * Execute a single supported action. Only reload_snapshot is executable in the
 * standalone executor; all other actions are marked not_supported. Never runs AI,
 * reruns imports, or mutates templates.
 */
export async function executeSelfHealingAction(input: {
  action: SelfHealingActionPlan;
  audit: SelfHealingRetryAudit;
  now?: () => Date;
}): Promise<SelfHealingActionPlan> {
  const { action } = input;
  // Hard guardrail: these are never executed by the self-healing layer.
  const NEVER_AUTO = new Set(['run_ai_reconciliation', 'rerun_import', 'rerun_visual_qa', 'rerun_repair', 'rerun_export_parity_manual']);
  if (NEVER_AUTO.has(action.actionId)) {
    return { ...action, status: 'manual_required', resultMessage: 'Requires manual/operator action; never automated.' };
  }

  if (action.actionId === 'reload_snapshot') {
    return {
      ...action,
      status: 'completed',
      attemptCount: action.attemptCount + 1,
      resultMessage: 'Snapshot state evaluated.',
    };
  }

  return {
    ...action,
    status: 'not_supported',
    resultMessage: 'Execution handled by the orchestrator with full context; not supported standalone.',
  };
}

function resolveExecutedStatus(actions: SelfHealingActionPlan[], warnings: string[]): SelfHealingPlanStatus {
  if (actions.length === 0) return 'no_action';
  if (actions.some((a) => a.status === 'failed')) return 'failed';
  if (actions.some((a) => a.status === 'blocked')) return 'blocked';
  const completed = actions.filter((a) => a.status === 'completed').length;
  const manualish = actions.filter((a) => a.status === 'manual_required' || a.status === 'not_supported' || a.status === 'skipped').length;
  const pending = actions.filter((a) => a.status === 'pending').length;
  if (completed > 0 && manualish > 0) return 'partial';
  if (completed > 0 && manualish === 0 && pending === 0) {
    return warnings.length > 0 ? 'completed_with_warnings' : 'completed';
  }
  if (completed === 0 && manualish > 0) return 'partial';
  return 'planned';
}

/** Execute the plan under the given mode. Non-destructive by default. */
export async function executeSelfHealingRetryPlan(
  options: ExecuteSelfHealingPlanOptions,
): Promise<SelfHealingRetryAudit> {
  const now = options.now ?? (() => new Date());
  const { mode, operatorConfirmed } = options;
  const audit: SelfHealingRetryAudit = {
    ...options.audit,
    actions: options.audit.actions.map((a) => ({ ...a })),
  };

  if (mode === 'dry_run' || mode === 'audit_only') {
    const message = mode === 'dry_run' ? 'Dry run only.' : 'Audit only.';
    audit.actions = audit.actions.map((a) =>
      a.status === 'pending' ? { ...a, status: 'skipped', resultMessage: message } : a);
    audit.summary = summarizeSelfHealingActions(audit.actions);
    audit.executedAt = null;
    return audit;
  }

  const executed: SelfHealingActionPlan[] = [];
  for (const action of audit.actions) {
    const gate = canExecuteSelfHealingAction({ action, mode, operatorConfirmed });
    if (gate.canExecute) {
      executed.push(await executeSelfHealingAction({ action, audit, now }));
      continue;
    }
    // Not executed — reflect the gate reason without hallucinating completion.
    if (action.safetyLevel === 'manual_only') {
      executed.push({ ...action, status: 'manual_required', resultMessage: action.resultMessage ?? 'Manual/operator action required.' });
    } else if (action.safetyLevel === 'blocked') {
      executed.push({ ...action, status: 'blocked', resultMessage: action.resultMessage ?? 'Blocked pending manual review.' });
    } else if (action.status === 'pending') {
      executed.push({ ...action, status: 'skipped', resultMessage: gate.reason === 'operator_confirmation_required' ? 'Operator confirmation required.' : `Not executed (${gate.reason}).` });
    } else {
      executed.push({ ...action });
    }
  }

  audit.actions = executed;
  audit.summary = summarizeSelfHealingActions(executed);
  audit.status = resolveExecutedStatus(executed, audit.warnings);
  audit.executedAt = now().toISOString();
  return audit;
}
