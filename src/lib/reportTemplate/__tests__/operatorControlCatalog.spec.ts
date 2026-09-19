import { describe, expect, it } from 'vitest';
import {
  OPERATOR_CONTROL_CATALOG,
  listOperatorControlDefinitions,
  getOperatorControlDefinition,
  assertOperatorControlCatalogIntegrity,
} from '../ingestion/operatorControls';

const CANONICAL = [
  'mark_not_reviewed', 'mark_accepted', 'mark_accepted_with_warnings', 'mark_rejected', 'mark_needs_rerun',
  'mark_manual_review_required', 'mark_blocked', 'add_operator_note', 'build_import_intelligence_profile',
  'build_repair_pattern_analysis', 'build_adaptive_reconciliation_policy', 'build_self_healing_plan',
  'build_performance_cost_audit', 'run_export_parity_automation', 'rerun_golden_regression',
  'persist_golden_regression_summary', 'save_golden_run_history', 'run_self_healing_execute_safe',
  'open_template_editor', 'open_template_import_quality', 'rerun_visual_qa_manual', 'rerun_repair_manual',
  'run_ai_reconciliation_manual', 'apply_repair_manual', 'apply_reconciliation_manual', 'rerun_import_manual',
  'inspect_storage_artifacts', 'inspect_pdf_import_jobs', 'inspect_logs', 'clear_operator_control_audit',
];

describe('operator control catalog', () => {
  it('includes all canonical control IDs', () => {
    const ids = OPERATOR_CONTROL_CATALOG.map((d) => d.controlId);
    for (const id of CANONICAL) expect(ids).toContain(id);
  });
  it('has no duplicate control IDs', () => {
    const ids = OPERATOR_CONTROL_CATALOG.map((d) => d.controlId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('mark_accepted is metadata_write', () => {
    expect(getOperatorControlDefinition('mark_accepted')?.safetyLevel).toBe('metadata_write');
  });
  it('build_import_intelligence_profile is orchestrator_safe', () => {
    expect(getOperatorControlDefinition('build_import_intelligence_profile')?.safetyLevel).toBe('orchestrator_safe');
  });
  it('run_ai_reconciliation_manual is manual_workflow', () => {
    expect(getOperatorControlDefinition('run_ai_reconciliation_manual')?.safetyLevel).toBe('manual_workflow');
  });
  it('clear_operator_control_audit is blocked', () => {
    expect(getOperatorControlDefinition('clear_operator_control_audit')?.safetyLevel).toBe('blocked');
  });
  it('every definition has a label', () => {
    expect(listOperatorControlDefinitions().every((d) => !!d.label)).toBe(true);
  });
  it('every definition has a description', () => {
    expect(listOperatorControlDefinitions().every((d) => !!d.description)).toBe(true);
  });
  it('every definition has a safety level', () => {
    expect(listOperatorControlDefinitions().every((d) => !!d.safetyLevel)).toBe(true);
  });
  it('every definition has a default state', () => {
    expect(listOperatorControlDefinitions().every((d) => !!d.defaultState)).toBe(true);
  });
  it('confirmation required for mark_accepted', () => {
    expect(getOperatorControlDefinition('mark_accepted')?.requiresConfirmation).toBe(true);
  });
  it('confirmation required for mark_rejected', () => {
    expect(getOperatorControlDefinition('mark_rejected')?.requiresConfirmation).toBe(true);
  });
  it('confirmation required for mark_blocked', () => {
    expect(getOperatorControlDefinition('mark_blocked')?.requiresConfirmation).toBe(true);
  });
  it('catalog integrity passes', () => {
    const r = assertOperatorControlCatalogIntegrity();
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
