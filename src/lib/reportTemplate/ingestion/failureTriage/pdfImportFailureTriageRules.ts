/**
 * pdfImportFailureTriageRules — Phase 8F rule catalog.
 *
 * Maps a normalized failure/warning code to a triage rule (category, severity,
 * owner, recovery actions, outcome, playbook anchor). An unknown code resolves
 * to the default `unknown` rule so triage never throws on unexpected input.
 */
import type {
  PdfImportFailureTriageRule,
  PdfImportRecoveryAction,
} from './pdfImportFailureTriageTypes';

const RECOVERY_ACTION_LABELS: Record<PdfImportRecoveryAction, string> = {
  no_action: 'No action',
  accept_warning: 'Accept warning',
  manual_review: 'Manual review',
  rerun_import: 'Rerun import',
  rerun_visual_qa: 'Rerun Visual QA',
  rerun_repair: 'Rerun repair',
  run_ai_reconciliation: 'Run AI reconciliation',
  rerun_export_parity: 'Rerun export parity',
  reapply_template: 'Reapply template',
  inspect_template_editor: 'Inspect template editor',
  inspect_storage_artifacts: 'Inspect storage artifacts',
  inspect_pdf_import_jobs: 'Inspect PDF import jobs',
  inspect_supabase_function_logs: 'Inspect Supabase function logs',
  inspect_cloud_run_logs: 'Inspect Cloud Run logs',
  patch_frontend: 'Patch frontend',
  patch_supabase_function: 'Patch Supabase function',
  patch_sidecar: 'Patch sidecar',
  patch_renderer: 'Patch renderer',
  rerun_golden_regression: 'Rerun golden regression',
  escalate_to_developer: 'Escalate to developer',
};

export function getRecoveryActionLabel(action: PdfImportRecoveryAction): string {
  return RECOVERY_ACTION_LABELS[action] ?? action;
}

/** Rule seed without the auto-derivable text fields. */
type RuleSeed = Omit<PdfImportFailureTriageRule, 'operatorSummary' | 'developerSummary' | 'playbookAnchor'> & {
  operatorSummary?: string;
  developerSummary?: string;
  playbookAnchor?: string;
};

function seed(
  code: string,
  category: PdfImportFailureTriageRule['category'],
  severity: PdfImportFailureTriageRule['severity'],
  owner: PdfImportFailureTriageRule['owner'],
  primaryAction: PdfImportRecoveryAction,
  secondaryActions: PdfImportRecoveryAction[],
  outcome: PdfImportFailureTriageRule['outcome'],
  title: string,
  extra?: Partial<Pick<PdfImportFailureTriageRule, 'operatorSummary' | 'developerSummary' | 'playbookAnchor'>>,
): RuleSeed {
  return { code, category, severity, owner, primaryAction, secondaryActions, outcome, title, ...extra };
}

const RULE_SEEDS: RuleSeed[] = [
  seed('import_failed', 'import', 'error', 'developer_fullstack', 'inspect_pdf_import_jobs',
    ['inspect_supabase_function_logs', 'inspect_cloud_run_logs', 'rerun_import'], 'action_required', 'Import failed',
    { playbookAnchor: 'import-failed' }),
  seed('import_not_completed', 'import', 'warning', 'operator', 'rerun_import',
    ['inspect_pdf_import_jobs'], 'action_required', 'Import not completed'),
  seed('finalization_failed', 'import', 'error', 'developer_backend', 'inspect_supabase_function_logs',
    ['inspect_pdf_import_jobs', 'rerun_import'], 'action_required', 'Finalization failed'),
  seed('sidecar_unavailable', 'sidecar', 'critical', 'developer_sidecar', 'inspect_cloud_run_logs',
    ['patch_sidecar', 'rerun_import'], 'escalate', 'Sidecar unavailable'),
  seed('sidecar_timeout', 'sidecar', 'error', 'developer_sidecar', 'inspect_cloud_run_logs',
    ['rerun_import', 'patch_sidecar'], 'action_required', 'Sidecar timeout'),
  seed('docling_parse_failed', 'sidecar', 'error', 'developer_sidecar', 'inspect_cloud_run_logs',
    ['inspect_pdf_import_jobs', 'rerun_import'], 'action_required', 'Docling parse failed'),
  seed('engine_version_missing', 'diagnostics', 'warning', 'developer_backend', 'inspect_pdf_import_jobs',
    ['inspect_supabase_function_logs'], 'monitor', 'Engine version missing'),
  seed('source_rasters_missing', 'artifact', 'error', 'developer_backend', 'inspect_storage_artifacts',
    ['rerun_import', 'inspect_pdf_import_jobs'], 'action_required', 'Source rasters missing'),
  seed('visual_quality_artifact_missing', 'visual_quality', 'error', 'developer_frontend', 'rerun_visual_qa',
    ['inspect_storage_artifacts', 'inspect_template_editor'], 'action_required', 'Visual QA artifact missing'),
  seed('visual_quality_below_threshold', 'visual_quality', 'error', 'qa', 'manual_review',
    ['run_ai_reconciliation', 'rerun_visual_qa'], 'action_required', 'Visual QA below threshold'),
  seed('visual_quality_manual_review_required', 'visual_quality', 'warning', 'manual_review', 'manual_review',
    ['run_ai_reconciliation'], 'action_required', 'Visual QA manual review required'),
  seed('repair_audit_missing', 'repair', 'error', 'developer_backend', 'rerun_repair',
    ['inspect_supabase_function_logs', 'inspect_storage_artifacts'], 'action_required', 'Repair audit missing'),
  seed('repair_failed', 'repair', 'error', 'developer_frontend', 'rerun_repair',
    ['run_ai_reconciliation', 'inspect_template_editor'], 'action_required', 'Repair failed'),
  seed('repair_below_threshold', 'repair', 'error', 'qa', 'run_ai_reconciliation',
    ['rerun_visual_qa', 'manual_review'], 'action_required', 'Repair score below threshold'),
  seed('repair_skipped_no_eligible_pages', 'repair', 'warning', 'qa', 'accept_warning',
    ['manual_review'], 'monitor', 'Repair skipped'),
  seed('fallback_not_allowed', 'repair', 'error', 'developer_frontend', 'patch_renderer',
    ['manual_review', 'run_ai_reconciliation'], 'action_required', 'Fallback not allowed'),
  seed('fallback_used', 'repair', 'warning', 'qa', 'manual_review',
    ['accept_warning'], 'action_required', 'Fallback used'),
  seed('manual_review_not_allowed', 'visual_quality', 'error', 'qa', 'manual_review',
    ['run_ai_reconciliation', 'patch_renderer'], 'action_required', 'Manual review not allowed'),
  seed('ai_reconciliation_recommended_not_run', 'ai_reconciliation', 'warning', 'operator', 'run_ai_reconciliation',
    ['manual_review'], 'action_required', 'AI reconciliation recommended but not run'),
  seed('ai_reconciliation_failed', 'ai_reconciliation', 'warning', 'developer_frontend', 'inspect_supabase_function_logs',
    ['run_ai_reconciliation', 'manual_review'], 'action_required', 'AI reconciliation failed'),
  seed('export_parity_artifact_missing', 'export_parity', 'error', 'operator', 'rerun_export_parity',
    ['inspect_storage_artifacts'], 'action_required', 'Export parity artifact missing'),
  seed('export_parity_failed', 'export_parity', 'error', 'developer_frontend', 'rerun_export_parity',
    ['patch_renderer', 'inspect_template_editor'], 'action_required', 'Export parity failed'),
  seed('export_parity_below_threshold', 'export_parity', 'error', 'developer_frontend', 'patch_renderer',
    ['rerun_export_parity', 'inspect_template_editor'], 'action_required', 'Export parity below threshold'),
  seed('export_parity_manual_required', 'export_parity', 'warning', 'manual_review', 'manual_review',
    ['accept_warning'], 'action_required', 'Export parity manual review required'),
  seed('template_missing', 'template', 'error', 'developer_backend', 'inspect_supabase_function_logs',
    ['rerun_import'], 'action_required', 'Template missing'),
  seed('template_page_count_mismatch', 'template', 'error', 'developer_frontend', 'inspect_template_editor',
    ['rerun_import', 'patch_renderer'], 'action_required', 'Template page count mismatch'),
  seed('template_empty', 'template', 'critical', 'developer_frontend', 'patch_renderer',
    ['rerun_import'], 'escalate', 'Generated template empty'),
  seed('apply_repair_failed', 'template', 'error', 'developer_backend', 'reapply_template',
    ['inspect_supabase_function_logs', 'patch_supabase_function'], 'action_required', 'Apply repair failed'),
  seed('version_snapshot_missing', 'template', 'warning', 'developer_backend', 'inspect_supabase_function_logs',
    ['reapply_template'], 'monitor', 'Version snapshot missing'),
  seed('golden_regression_missing', 'golden_regression', 'warning', 'operator', 'rerun_golden_regression',
    ['accept_warning'], 'action_required', 'Golden regression summary missing'),
  seed('quality_gate_failed', 'golden_regression', 'error', 'qa', 'manual_review',
    ['rerun_golden_regression'], 'action_required', 'Quality gate failed'),
  seed('quality_gate_blocked', 'golden_regression', 'error', 'operator', 'rerun_golden_regression',
    ['inspect_storage_artifacts'], 'blocked', 'Quality gate blocked'),
  seed('operator_rejected', 'golden_regression', 'error', 'qa', 'manual_review',
    ['rerun_golden_regression'], 'action_required', 'Operator rejected run'),
  seed('operator_needs_rerun', 'golden_regression', 'warning', 'operator', 'rerun_golden_regression',
    ['rerun_import'], 'action_required', 'Operator marked run for rerun'),
  seed('unauthorized', 'auth_security', 'error', 'developer_backend', 'inspect_supabase_function_logs',
    ['patch_supabase_function'], 'action_required', 'Unauthorized request'),
  seed('forbidden', 'auth_security', 'error', 'developer_backend', 'inspect_supabase_function_logs',
    ['patch_supabase_function'], 'action_required', 'Forbidden request'),
  seed('template_locked_for_review', 'auth_security', 'warning', 'operator', 'manual_review',
    ['reapply_template'], 'action_required', 'Template locked for review'),
  seed('version_conflict', 'auth_security', 'warning', 'operator', 'reapply_template',
    ['manual_review'], 'action_required', 'Version conflict'),
  seed('backend_unknown_operation', 'backend_contract', 'critical', 'developer_backend', 'patch_supabase_function',
    ['inspect_supabase_function_logs'], 'escalate', 'Backend unknown operation'),
  seed('response_shape_invalid', 'backend_contract', 'error', 'developer_backend', 'patch_supabase_function',
    ['inspect_supabase_function_logs'], 'action_required', 'Backend response shape invalid'),
];

function materialize(s: RuleSeed): PdfImportFailureTriageRule {
  const secondaryLabels = s.secondaryActions.map(getRecoveryActionLabel);
  const operatorSummary = s.operatorSummary
    ?? `${s.title}. Recommended: ${getRecoveryActionLabel(s.primaryAction)}${secondaryLabels.length ? ` (or: ${secondaryLabels.join(', ')})` : ''}.`;
  const developerSummary = s.developerSummary
    ?? `${s.title} — ${s.category}/${s.severity}, owner ${s.owner}. Primary action: ${getRecoveryActionLabel(s.primaryAction)}.`;
  const playbookAnchor = s.playbookAnchor ?? s.code.replace(/_/g, '-');
  return {
    code: s.code,
    category: s.category,
    severity: s.severity,
    owner: s.owner,
    primaryAction: s.primaryAction,
    secondaryActions: s.secondaryActions,
    outcome: s.outcome,
    title: s.title,
    operatorSummary,
    developerSummary,
    playbookAnchor,
  };
}

export const PDF_IMPORT_FAILURE_TRIAGE_RULES: PdfImportFailureTriageRule[] = RULE_SEEDS.map(materialize);

export const PDF_IMPORT_FAILURE_TRIAGE_DEFAULT_RULE: PdfImportFailureTriageRule = materialize(
  seed('unknown', 'unknown', 'warning', 'unknown', 'escalate_to_developer', [], 'action_required', 'Unknown failure',
    { playbookAnchor: 'unknown-failure' }),
);

const RULE_BY_CODE = new Map<string, PdfImportFailureTriageRule>(
  PDF_IMPORT_FAILURE_TRIAGE_RULES.map((rule) => [rule.code, rule]),
);

/** Return the exact rule for a code, or the default `unknown` rule. */
export function getPdfImportFailureTriageRule(code: string): PdfImportFailureTriageRule {
  return RULE_BY_CODE.get(code) ?? PDF_IMPORT_FAILURE_TRIAGE_DEFAULT_RULE;
}

/** Alias of {@link getPdfImportFailureTriageRule} for call-site clarity. */
export function getPdfImportFailureTriageRuleOrDefault(code: string): PdfImportFailureTriageRule {
  return getPdfImportFailureTriageRule(code);
}
