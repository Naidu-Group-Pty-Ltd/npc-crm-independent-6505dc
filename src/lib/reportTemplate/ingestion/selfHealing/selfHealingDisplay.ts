/**
 * selfHealingDisplay — Phase 10E.
 *
 * UI-safe labels, Badge tones, and formatting for the Self-Healing Retry Audit.
 * Pure; no network.
 */
import type {
  SelfHealingActionId,
  SelfHealingActionStatus,
  SelfHealingMode,
  SelfHealingPlanStatus,
  SelfHealingRetryAudit,
  SelfHealingSafetyLevel,
} from './selfHealingTypes';

export type SelfHealingDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const MODE_LABELS: Record<string, string> = {
  dry_run: 'Dry run',
  audit_only: 'Audit only',
  execute_safe: 'Execute safe actions',
  execute_confirmed: 'Execute confirmed actions',
};

const PLAN_STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  completed: 'Completed',
  completed_with_warnings: 'Completed with warnings',
  partial: 'Partial',
  blocked: 'Blocked',
  failed: 'Failed',
  no_action: 'No action',
};

const SAFETY_LABELS: Record<string, string> = {
  safe_automatic: 'Safe automatic',
  operator_confirmed: 'Operator confirmed',
  manual_only: 'Manual only',
  blocked: 'Blocked',
};

const ACTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  skipped: 'Skipped',
  completed: 'Completed',
  failed: 'Failed',
  blocked: 'Blocked',
  manual_required: 'Manual required',
  not_supported: 'Not supported',
};

const ACTION_LABELS: Record<string, string> = {
  reload_snapshot: 'Reload snapshot',
  build_import_intelligence_profile: 'Build import intelligence profile',
  persist_import_intelligence_profile: 'Persist import intelligence profile',
  build_repair_pattern_analysis: 'Build repair pattern analysis',
  persist_repair_pattern_analysis: 'Persist repair pattern analysis',
  build_adaptive_reconciliation_policy: 'Build adaptive reconciliation policy',
  persist_adaptive_reconciliation_policy: 'Persist adaptive reconciliation policy',
  run_export_parity_automation: 'Run export parity automation',
  persist_export_parity_summary: 'Persist export parity summary',
  rerun_golden_regression: 'Rerun golden regression',
  persist_golden_regression_summary: 'Persist golden regression summary',
  save_golden_run_history: 'Save golden run history',
  rerun_visual_qa: 'Rerun Visual QA',
  rerun_repair: 'Rerun repair',
  run_ai_reconciliation: 'Run AI reconciliation',
  rerun_export_parity_manual: 'Rerun export parity (manual)',
  rerun_import: 'Rerun PDF import',
  inspect_template_editor: 'Inspect template editor',
  inspect_storage_artifacts: 'Inspect storage artifacts',
  inspect_pdf_import_jobs: 'Inspect PDF import jobs',
  inspect_supabase_function_logs: 'Inspect Supabase function logs',
  inspect_cloud_run_logs: 'Inspect Cloud Run logs',
  block_until_manual_review: 'Block until manual review',
};

export function getSelfHealingModeLabel(mode: SelfHealingMode | string | null | undefined): string {
  if (!mode) return 'Dry run';
  return MODE_LABELS[mode] ?? 'Dry run';
}

export function getSelfHealingPlanStatusLabel(status: SelfHealingPlanStatus | string | null | undefined): string {
  if (!status) return 'No action';
  return PLAN_STATUS_LABELS[status] ?? 'No action';
}

export function getSelfHealingPlanStatusTone(status: SelfHealingPlanStatus | string | null | undefined): SelfHealingDisplayTone {
  switch (status) {
    case 'completed':
      return 'default';
    case 'completed_with_warnings':
    case 'partial':
    case 'planned':
      return 'secondary';
    case 'blocked':
    case 'failed':
      return 'destructive';
    case 'no_action':
    default:
      return 'outline';
  }
}

export function getSelfHealingSafetyLevelLabel(safetyLevel: SelfHealingSafetyLevel | string | null | undefined): string {
  if (!safetyLevel) return 'Manual only';
  return SAFETY_LABELS[safetyLevel] ?? 'Manual only';
}

export function getSelfHealingSafetyLevelTone(safetyLevel: SelfHealingSafetyLevel | string | null | undefined): SelfHealingDisplayTone {
  switch (safetyLevel) {
    case 'safe_automatic':
      return 'default';
    case 'operator_confirmed':
    case 'manual_only':
      return 'secondary';
    case 'blocked':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function getSelfHealingActionStatusLabel(status: SelfHealingActionStatus | string | null | undefined): string {
  if (!status) return 'Pending';
  return ACTION_STATUS_LABELS[status] ?? 'Pending';
}

export function getSelfHealingActionStatusTone(status: SelfHealingActionStatus | string | null | undefined): SelfHealingDisplayTone {
  switch (status) {
    case 'completed':
      return 'default';
    case 'pending':
    case 'skipped':
    case 'manual_required':
    case 'not_supported':
      return 'secondary';
    case 'failed':
    case 'blocked':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function getSelfHealingActionLabel(actionId: SelfHealingActionId | string | null | undefined): string {
  if (!actionId) return 'Unknown';
  return ACTION_LABELS[actionId] ?? 'Unknown';
}

export function getSelfHealingHeadline(audit: SelfHealingRetryAudit | null | undefined): string {
  if (!audit) return 'No self-healing retry plan';
  return `Self-healing ${getSelfHealingPlanStatusLabel(audit.status).toLowerCase()} · ${getSelfHealingModeLabel(audit.mode)}`;
}

export function summarizeSelfHealingAudit(
  audit: SelfHealingRetryAudit | null | undefined,
): {
  label: string;
  tone: SelfHealingDisplayTone;
  modeLabel: string;
  executableLabel: string;
  manualLabel: string;
  blockedLabel: string;
} {
  if (!audit) {
    return {
      label: 'No self-healing retry plan',
      tone: 'outline',
      modeLabel: 'Dry run',
      executableLabel: '0',
      manualLabel: '0',
      blockedLabel: '0',
    };
  }
  return {
    label: getSelfHealingPlanStatusLabel(audit.status),
    tone: getSelfHealingPlanStatusTone(audit.status),
    modeLabel: getSelfHealingModeLabel(audit.mode),
    executableLabel: String(audit.summary.executableActions),
    manualLabel: String(audit.summary.manualActions),
    blockedLabel: String(audit.summary.blockedActions),
  };
}
