import { describe, expect, it } from 'vitest';
import {
  evaluateOperatorControls,
  evaluateOperatorControl,
  isOperatorControlBlockedByPolicy,
  isOperatorControlRecommended,
  listOperatorControlDefinitions,
  type OperatorControlSignals,
} from '../ingestion/operatorControls';

function signals(overrides: Partial<OperatorControlSignals> = {}): OperatorControlSignals {
  return {
    importId: 'import-1', templateId: 'template-1', sourceFilename: 'f.pdf',
    importStatus: 'completed', templateExists: true,
    qualityGateStatus: 'pass', operatorDecision: null, goldenFailureCount: 0, goldenWarningCount: 0,
    hasImportProfile: true, importProfileCategory: 'digital_text', importRiskLevel: 'low',
    hasRepairPatternAnalysis: true, primaryRepairPatternId: null, repairPatternSeverity: 'low', operatorReviewRequirement: 'not_required', deterministicRepairStrategy: 'safe',
    hasAdaptivePolicy: true, adaptiveDecision: 'not_needed', adaptiveAction: 'no_action', adaptiveAiBlocked: false, adaptiveRequiresManualReview: false,
    hasSelfHealingAudit: true, selfHealingStatus: 'no_action', selfHealingBlockedActions: 0, selfHealingManualActions: 0,
    hasPerformanceAudit: true, performanceRiskLevel: 'low', performanceCostLevel: 'medium',
    hasExportParity: true, exportParityStatus: 'completed',
    hasVisualQuality: true, visualQaManualReviewRequired: false,
    hasRepairAudit: true, repairStatus: 'completed', repairRequiresManualReview: false, repairRequiresFallback: false,
    previousOperatorAuditDecision: null, previousOperatorAuditBlocked: null,
    failureCodes: [], warningCodes: [],
    ...overrides,
  };
}

function ctrl(controls: ReturnType<typeof evaluateOperatorControls>, id: string) {
  return controls.find((c) => c.controlId === id)!;
}

describe('operator control rules', () => {
  it('missing importId disables write controls', () => {
    const controls = evaluateOperatorControls({ signals: signals({ importId: null }) });
    expect(ctrl(controls, 'mark_accepted').state).toBe('disabled');
    expect(ctrl(controls, 'build_import_intelligence_profile').state).toBe('disabled');
    // read-only remains available
    expect(ctrl(controls, 'open_template_import_quality').state).toBe('available');
  });
  it('qualityGateStatus pass recommends mark_accepted', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals({ qualityGateStatus: 'pass' }) }), 'mark_accepted').state).toBe('recommended');
  });
  it('qualityGateStatus warning recommends mark_accepted_with_warnings', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals({ qualityGateStatus: 'warning' }) }), 'mark_accepted_with_warnings').state).toBe('recommended');
  });
  it('qualityGateStatus fail recommends mark_rejected and mark_needs_rerun', () => {
    const controls = evaluateOperatorControls({ signals: signals({ qualityGateStatus: 'fail' }) });
    expect(ctrl(controls, 'mark_rejected').state).toBe('recommended');
    expect(ctrl(controls, 'mark_needs_rerun').state).toBe('recommended');
    // accepted blocked when failing
    expect(ctrl(controls, 'mark_accepted').state).toBe('blocked');
  });
  it('qualityGateStatus blocked recommends mark_blocked', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals({ qualityGateStatus: 'blocked' }) }), 'mark_blocked').state).toBe('recommended');
  });
  it('adaptive aiBlocked blocks run_ai_reconciliation_manual', () => {
    const controls = evaluateOperatorControls({ signals: signals({ adaptiveAiBlocked: true }) });
    expect(ctrl(controls, 'run_ai_reconciliation_manual').state).toBe('blocked');
    expect(ctrl(controls, 'run_ai_reconciliation_manual').blockedReason).toBe('adaptive_policy_blocks_ai');
  });
  it('adaptive recommended makes run_ai_reconciliation_manual manual_only and recommended', () => {
    const c = ctrl(evaluateOperatorControls({ signals: signals({ adaptiveDecision: 'recommended', adaptiveAiBlocked: false }) }), 'run_ai_reconciliation_manual');
    expect(c.state).toBe('manual_only');
    expect(c.recommended).toBe(true);
  });
  it('repair pattern block_until_review blocks accept and recommends manual review', () => {
    const controls = evaluateOperatorControls({ signals: signals({ operatorReviewRequirement: 'block_until_review' }) });
    expect(ctrl(controls, 'mark_accepted').state).toBe('blocked');
    expect(ctrl(controls, 'mark_manual_review_required').state).toBe('recommended');
  });
  it('missing profile recommends build_import_intelligence_profile', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals({ hasImportProfile: false }) }), 'build_import_intelligence_profile').state).toBe('recommended');
  });
  it('missing repair pattern recommends build_repair_pattern_analysis', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals({ hasRepairPatternAnalysis: false }) }), 'build_repair_pattern_analysis').state).toBe('recommended');
  });
  it('missing adaptive policy recommends build_adaptive_reconciliation_policy', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals({ hasAdaptivePolicy: false }) }), 'build_adaptive_reconciliation_policy').state).toBe('recommended');
  });
  it('missing self-healing with failures recommends build_self_healing_plan', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals({ hasSelfHealingAudit: false, goldenFailureCount: 2 }) }), 'build_self_healing_plan').state).toBe('recommended');
  });
  it('missing performance audit recommends build_performance_cost_audit', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals({ hasPerformanceAudit: false }) }), 'build_performance_cost_audit').state).toBe('recommended');
  });
  it('missing export parity recommends run_export_parity_automation', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals({ hasExportParity: false, exportParityStatus: null }) }), 'run_export_parity_automation').state).toBe('recommended');
  });
  it('high performance risk requires confirmation for expensive controls', () => {
    const c = ctrl(evaluateOperatorControls({ signals: signals({ hasExportParity: true, performanceRiskLevel: 'critical' }) }), 'run_export_parity_automation');
    expect(c.requiresConfirmation).toBe(true);
    expect(['requires_confirmation', 'recommended', 'available']).toContain(c.state);
  });
  it('clear_operator_control_audit is always blocked', () => {
    expect(ctrl(evaluateOperatorControls({ signals: signals() }), 'clear_operator_control_audit').state).toBe('blocked');
    expect(isOperatorControlBlockedByPolicy({ controlId: 'clear_operator_control_audit', signals: signals() })).toBeTruthy();
  });
  it('read-only controls remain available', () => {
    const controls = evaluateOperatorControls({ signals: signals() });
    expect(ctrl(controls, 'open_template_editor').state).toBe('available');
    expect(ctrl(controls, 'inspect_pdf_import_jobs').state).toBe('available');
  });
  it('manual workflow controls are marked manual_only', () => {
    const controls = evaluateOperatorControls({ signals: signals() });
    expect(ctrl(controls, 'rerun_visual_qa_manual').state).toBe('manual_only');
    expect(ctrl(controls, 'apply_repair_manual').state).toBe('manual_only');
  });
  it('evaluateOperatorControls returns all catalog controls', () => {
    const controls = evaluateOperatorControls({ signals: signals() });
    expect(controls.length).toBe(listOperatorControlDefinitions().length);
  });
  it('recommended flag matches isOperatorControlRecommended for a sample', () => {
    const s = signals({ qualityGateStatus: 'pass' });
    expect(isOperatorControlRecommended({ controlId: 'mark_accepted', signals: s })).toBe(true);
    const a = evaluateOperatorControl({ controlId: 'mark_accepted', signals: s });
    expect(a.recommended).toBe(true);
  });
});

import { getRequiredCapabilityForOperatorControl } from '../ingestion/operatorControls';
import { resolvePdfImportOperatorRole } from '../ingestion/operatorPermissions';

describe('Phase 11B — operator control permission overlay', () => {
  const adminRole = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'admin' } });
  const operatorRole = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'operator' } });
  const noAccessRole = resolvePdfImportOperatorRole({ isAuthenticated: false });

  it('maps controls to required capabilities', () => {
    expect(getRequiredCapabilityForOperatorControl('mark_accepted')).toBe('pdf_import.operator.mark_accepted');
    expect(getRequiredCapabilityForOperatorControl('persist_golden_regression_summary')).toBe('pdf_import.persist_golden_summary');
    expect(getRequiredCapabilityForOperatorControl('run_ai_reconciliation_manual')).toBe('pdf_import.manual.run_ai_reconciliation');
    expect(getRequiredCapabilityForOperatorControl('clear_operator_control_audit')).toBeNull();
  });

  it('admin keeps mark_accepted available (recommended) with allowedByPermission true', () => {
    const c = evaluateOperatorControl({ controlId: 'mark_accepted', signals: signals({ qualityGateStatus: 'pass' }), resolvedRole: adminRole });
    expect(c.allowedByPermission).toBe(true);
    expect(c.state).toBe('recommended');
    expect(c.requiredCapability).toBe('pdf_import.operator.mark_accepted');
  });

  it('operator role is denied mark_accepted (disabled)', () => {
    const c = evaluateOperatorControl({ controlId: 'mark_accepted', signals: signals({ qualityGateStatus: 'pass' }), resolvedRole: operatorRole });
    expect(c.allowedByPermission).toBe(false);
    expect(c.permissionDecision).toBe('denied');
    expect(c.state).toBe('disabled');
  });

  it('no_access is denied evaluate-related build control', () => {
    const c = evaluateOperatorControl({ controlId: 'build_import_intelligence_profile', signals: signals(), resolvedRole: noAccessRole });
    expect(c.allowedByPermission).toBe(false);
    expect(c.state).toBe('disabled');
  });

  it('safety-blocked control stays blocked even if permission would allow', () => {
    // clear_operator_control_audit is always safety-blocked.
    const c = evaluateOperatorControl({ controlId: 'clear_operator_control_audit', signals: signals(), resolvedRole: adminRole });
    expect(c.state).toBe('blocked');
  });

  it('AI manual control is manual_only for admin (permitted, still manual)', () => {
    const c = evaluateOperatorControl({ controlId: 'run_ai_reconciliation_manual', signals: signals(), resolvedRole: adminRole });
    expect(c.state).toBe('manual_only');
    expect(c.allowedByPermission).toBe(true);
    expect(c.permissionDecision).toBe('manual_only');
  });

  it('AI manual control denied for operator role', () => {
    const c = evaluateOperatorControl({ controlId: 'run_ai_reconciliation_manual', signals: signals(), resolvedRole: operatorRole });
    expect(c.allowedByPermission).toBe(false);
    expect(c.state).toBe('disabled');
  });

  it('without permission context the overlay is skipped (backward compatible)', () => {
    const c = evaluateOperatorControl({ controlId: 'mark_accepted', signals: signals({ qualityGateStatus: 'pass' }) });
    expect(c.allowedByPermission).toBeUndefined();
    expect(c.state).toBe('recommended');
  });
});
