/**
 * operatorControlCatalog — Phase 10G.
 *
 * The canonical catalog of production operator controls with their fixed safety
 * levels, confirmation requirements, and default states. Availability/recommend/
 * block decisions are resolved dynamically in operatorControlRules; this file is
 * the static contract.
 */
import type {
  OperatorControlDefinition,
  OperatorControlId,
  OperatorControlSafetyLevel,
  OperatorControlState,
} from './operatorControlTypes';

interface Def {
  id: OperatorControlId;
  label: string;
  description: string;
  safety: OperatorControlSafetyLevel;
  confirm: boolean;
  defaultState: OperatorControlState;
  manualReason?: string | null;
  blockedReason?: string | null;
}

function D(d: Def): OperatorControlDefinition {
  return {
    controlId: d.id,
    label: d.label,
    description: d.description,
    safetyLevel: d.safety,
    requiresConfirmation: d.confirm,
    defaultState: d.defaultState,
    manualReason: d.manualReason ?? null,
    blockedReason: d.blockedReason ?? null,
  };
}

export const OPERATOR_CONTROL_CATALOG: OperatorControlDefinition[] = [
  // Metadata decision controls
  D({ id: 'mark_not_reviewed', label: 'Mark not reviewed', description: 'Reset the import to a not-reviewed operator state.', safety: 'metadata_write', confirm: false, defaultState: 'available' }),
  D({ id: 'mark_accepted', label: 'Mark accepted', description: 'Operator accepts the import/regression result.', safety: 'metadata_write', confirm: true, defaultState: 'available' }),
  D({ id: 'mark_accepted_with_warnings', label: 'Mark accepted with warnings', description: 'Operator accepts the result with known warnings.', safety: 'metadata_write', confirm: true, defaultState: 'available' }),
  D({ id: 'mark_rejected', label: 'Mark rejected', description: 'Operator rejects the import/regression result.', safety: 'metadata_write', confirm: true, defaultState: 'available' }),
  D({ id: 'mark_needs_rerun', label: 'Mark needs rerun', description: 'Operator marks the import/regression for rerun.', safety: 'metadata_write', confirm: true, defaultState: 'available' }),
  D({ id: 'mark_manual_review_required', label: 'Mark manual review required', description: 'Operator marks the import as requiring manual review.', safety: 'metadata_write', confirm: true, defaultState: 'available' }),
  D({ id: 'mark_blocked', label: 'Mark blocked', description: 'Operator blocks progress until the issue is resolved.', safety: 'metadata_write', confirm: true, defaultState: 'available' }),
  D({ id: 'add_operator_note', label: 'Add operator note', description: 'Append an operator note to the control audit.', safety: 'metadata_write', confirm: false, defaultState: 'available' }),

  // Orchestrator-safe controls (run existing orchestrator in safe modes)
  D({ id: 'build_import_intelligence_profile', label: 'Build import intelligence profile', description: 'Run the Phase 10B deterministic profile build via the orchestrator.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),
  D({ id: 'build_repair_pattern_analysis', label: 'Build repair pattern analysis', description: 'Run the Phase 10C repair pattern analysis via the orchestrator.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),
  D({ id: 'build_adaptive_reconciliation_policy', label: 'Build adaptive reconciliation policy', description: 'Run the Phase 10D adaptive policy build via the orchestrator.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),
  D({ id: 'build_self_healing_plan', label: 'Build self-healing plan', description: 'Run the Phase 10E self-healing dry-run plan via the orchestrator.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),
  D({ id: 'build_performance_cost_audit', label: 'Build performance/cost audit', description: 'Run the Phase 10F advisory performance/cost audit via the orchestrator.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),
  D({ id: 'run_export_parity_automation', label: 'Run export parity automation', description: 'Run the Phase 9D export parity automation via the orchestrator.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),
  D({ id: 'rerun_golden_regression', label: 'Rerun golden regression', description: 'Run the Phase 9A golden regression evaluation via the orchestrator.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),
  D({ id: 'persist_golden_regression_summary', label: 'Persist golden regression summary', description: 'Persist the latest golden regression summary.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),
  D({ id: 'save_golden_run_history', label: 'Save golden run history', description: 'Append a golden run history row.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),
  D({ id: 'run_self_healing_execute_safe', label: 'Run self-healing (execute safe)', description: 'Run the Phase 10E self-healing execute_safe mode via the orchestrator.', safety: 'orchestrator_safe', confirm: true, defaultState: 'available' }),

  // Read-only navigation
  D({ id: 'open_template_editor', label: 'Open template editor', description: 'Navigate to the Template Builder/editor for this template.', safety: 'read_only', confirm: false, defaultState: 'available', manualReason: 'Opens the template editor manually.' }),
  D({ id: 'open_template_import_quality', label: 'Open template import quality', description: 'Navigate to the Template Import Quality diagnostics page.', safety: 'read_only', confirm: false, defaultState: 'available' }),
  D({ id: 'inspect_pdf_import_jobs', label: 'Inspect PDF import jobs', description: 'Inspect diagnostics for the PDF import jobs.', safety: 'read_only', confirm: false, defaultState: 'available' }),

  // Manual workflows (never executed automatically by Phase 10G)
  D({ id: 'rerun_visual_qa_manual', label: 'Rerun Visual QA (manual)', description: 'Operator manually reruns Visual QA through the existing UI.', safety: 'manual_workflow', confirm: false, defaultState: 'manual_only', manualReason: 'Visual QA is browser-dependent and must be run manually.' }),
  D({ id: 'rerun_repair_manual', label: 'Rerun repair (manual)', description: 'Operator manually reruns repair through the existing UI.', safety: 'manual_workflow', confirm: false, defaultState: 'manual_only', manualReason: 'Repair is browser-dependent and must be run manually.' }),
  D({ id: 'run_ai_reconciliation_manual', label: 'Run AI reconciliation (manual)', description: 'Operator manually triggers AI reconciliation through the governed UI.', safety: 'manual_workflow', confirm: false, defaultState: 'manual_only', manualReason: 'AI reconciliation is manual-only and respects the adaptive policy.' }),
  D({ id: 'apply_repair_manual', label: 'Apply repair (manual)', description: 'Operator manually applies repair through the existing UI.', safety: 'manual_workflow', confirm: false, defaultState: 'manual_only', manualReason: 'Applying repair mutates the template and must be done manually.' }),
  D({ id: 'apply_reconciliation_manual', label: 'Apply reconciliation (manual)', description: 'Operator manually applies reconciliation through the existing UI.', safety: 'manual_workflow', confirm: false, defaultState: 'manual_only', manualReason: 'Applying reconciliation mutates the template and must be done manually.' }),
  D({ id: 'rerun_import_manual', label: 'Rerun import (manual)', description: 'Operator manually reimports the PDF through the existing UI.', safety: 'manual_workflow', confirm: false, defaultState: 'manual_only', manualReason: 'Reimport uploads a PDF and must be done manually.' }),
  D({ id: 'inspect_storage_artifacts', label: 'Inspect storage artifacts', description: 'Operator/developer inspects storage artifacts.', safety: 'manual_workflow', confirm: false, defaultState: 'manual_only', manualReason: 'Storage inspection is a manual/developer workflow.' }),
  D({ id: 'inspect_logs', label: 'Inspect logs', description: 'Developer inspects Supabase/Cloud Run logs.', safety: 'manual_workflow', confirm: false, defaultState: 'manual_only', manualReason: 'Log inspection is a manual/developer workflow.' }),

  // Blocked in Phase 10G
  D({ id: 'clear_operator_control_audit', label: 'Clear operator control audit', description: 'Clear/reset the operator control audit trail.', safety: 'blocked', confirm: true, defaultState: 'blocked', blockedReason: 'Clearing the operator control audit is disabled in Phase 10G.' }),
];

const CANONICAL_IDS: OperatorControlId[] = OPERATOR_CONTROL_CATALOG.map((d) => d.controlId);

const SAFETY_LEVELS = new Set<OperatorControlSafetyLevel>(['read_only', 'metadata_write', 'orchestrator_safe', 'manual_workflow', 'blocked']);
const STATES = new Set<OperatorControlState>(['available', 'recommended', 'requires_confirmation', 'manual_only', 'blocked', 'disabled', 'completed', 'failed']);

export function listOperatorControlDefinitions(): OperatorControlDefinition[] {
  return OPERATOR_CONTROL_CATALOG.slice();
}

export function getOperatorControlDefinition(
  controlId: OperatorControlId | string,
): OperatorControlDefinition | null {
  return OPERATOR_CONTROL_CATALOG.find((d) => d.controlId === controlId) ?? null;
}

export function assertOperatorControlCatalogIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const seen = new Set<string>();
  for (const def of OPERATOR_CONTROL_CATALOG) {
    if (seen.has(def.controlId)) errors.push(`duplicate_control_id:${def.controlId}`);
    seen.add(def.controlId);
    if (!def.label) errors.push(`missing_label:${def.controlId}`);
    if (!def.description) errors.push(`missing_description:${def.controlId}`);
    if (!SAFETY_LEVELS.has(def.safetyLevel)) errors.push(`invalid_safety_level:${def.controlId}`);
    if (!STATES.has(def.defaultState)) errors.push(`invalid_default_state:${def.controlId}`);
  }

  // All canonical IDs must be present exactly once.
  const expected = new Set(CANONICAL_IDS);
  if (expected.size !== CANONICAL_IDS.length) warnings.push('canonical_id_list_has_duplicates');
  if (OPERATOR_CONTROL_CATALOG.length !== 30) warnings.push(`unexpected_catalog_size:${OPERATOR_CONTROL_CATALOG.length}`);

  return { ok: errors.length === 0, errors, warnings };
}
