import { describe, expect, it } from 'vitest';
import {
  SELF_HEALING_ACTION_DEFINITIONS,
  getSelfHealingActionDefinition,
  listSelfHealingActionDefinitions,
  resolveSelfHealingSafetyLevel,
  deriveSelfHealingActionsFromSignals,
  buildSelfHealingActionPlan,
} from '../ingestion/selfHealing';
import type { SelfHealingSignals } from '../ingestion/selfHealing';

function sig(overrides: Partial<SelfHealingSignals> = {}): SelfHealingSignals {
  return {
    importId: 'import-1', templateId: 'template-1', sourceFilename: 'doc.pdf',
    importStatus: 'completed', templateExists: true,
    hasVisualQuality: true, visualQaScore: 0.95, visualQaManualReviewRequired: false,
    hasRepairAudit: true, repairStatus: 'completed', repairFinalScore: 0.95, repairRequiresFallback: false, repairRequiresManualReview: false,
    hasExportParity: true, exportParityStatus: 'completed', exportVsSourceScore: 0.95,
    hasImportIntelligenceProfile: true, importProfileCategory: 'simple_document', importRiskLevel: 'low',
    hasRepairPatternAnalysis: true, primaryRepairPatternId: null, repairPatternSeverity: 'info', deterministicRepairStrategy: 'safe', repairPatternOperatorReviewRequirement: 'not_required',
    hasAdaptiveReconciliationPolicy: true, adaptiveDecision: 'not_needed', adaptiveRecommendedAction: 'no_action', adaptiveAiBlocked: false, adaptiveRequiresManualReview: false, adaptiveShouldRerunRepairFirst: false,
    goldenQualityGateStatus: 'pass', goldenOperatorDecision: 'accepted', goldenFailureCount: 0, goldenWarningCount: 0,
    triageOutcome: 'resolved', triagePrimaryAction: null, triageSeverity: 'info',
    baselineOutcome: 'stable',
    failureCodes: [], warningCodes: [],
    previousAuditActionCounts: {},
    ...overrides,
  };
}

const REQUIRED_ACTIONS = [
  'reload_snapshot', 'build_import_intelligence_profile', 'persist_import_intelligence_profile',
  'build_repair_pattern_analysis', 'persist_repair_pattern_analysis', 'build_adaptive_reconciliation_policy',
  'persist_adaptive_reconciliation_policy', 'run_export_parity_automation', 'persist_export_parity_summary',
  'rerun_golden_regression', 'persist_golden_regression_summary', 'save_golden_run_history',
  'rerun_visual_qa', 'rerun_repair', 'run_ai_reconciliation', 'rerun_export_parity_manual', 'rerun_import',
  'inspect_template_editor', 'inspect_storage_artifacts', 'inspect_pdf_import_jobs',
  'inspect_supabase_function_logs', 'inspect_cloud_run_logs', 'block_until_manual_review',
];

function idsOf(signals: SelfHealingSignals): string[] {
  return deriveSelfHealingActionsFromSignals({ signals }).map((a) => a.actionId);
}

describe('action definitions', () => {
  it('include all canonical actions', () => {
    const ids = SELF_HEALING_ACTION_DEFINITIONS.map((d) => d.actionId);
    for (const a of REQUIRED_ACTIONS) expect(ids).toContain(a);
  });
  it('have no duplicate IDs', () => {
    const ids = listSelfHealingActionDefinitions().map((d) => d.actionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('map safety levels correctly', () => {
    const s = sig();
    expect(resolveSelfHealingSafetyLevel({ actionId: 'reload_snapshot', signals: s })).toBe('safe_automatic');
    expect(resolveSelfHealingSafetyLevel({ actionId: 'build_import_intelligence_profile', signals: s })).toBe('safe_automatic');
    expect(resolveSelfHealingSafetyLevel({ actionId: 'persist_import_intelligence_profile', signals: s })).toBe('operator_confirmed');
    expect(resolveSelfHealingSafetyLevel({ actionId: 'rerun_visual_qa', signals: s })).toBe('manual_only');
    expect(resolveSelfHealingSafetyLevel({ actionId: 'rerun_repair', signals: s })).toBe('manual_only');
    expect(resolveSelfHealingSafetyLevel({ actionId: 'run_ai_reconciliation', signals: s })).toBe('manual_only');
    expect(resolveSelfHealingSafetyLevel({ actionId: 'block_until_manual_review', signals: s })).toBe('blocked');
  });
});

describe('deriveSelfHealingActionsFromSignals', () => {
  it('derives build/persist profile actions when profile missing', () => {
    const ids = idsOf(sig({ hasImportIntelligenceProfile: false }));
    expect(ids).toContain('build_import_intelligence_profile');
    expect(ids).toContain('persist_import_intelligence_profile');
  });
  it('derives build/persist repair pattern actions when missing', () => {
    const ids = idsOf(sig({ hasRepairPatternAnalysis: false }));
    expect(ids).toContain('build_repair_pattern_analysis');
    expect(ids).toContain('persist_repair_pattern_analysis');
  });
  it('derives build/persist adaptive policy actions when missing', () => {
    const ids = idsOf(sig({ hasAdaptiveReconciliationPolicy: false }));
    expect(ids).toContain('build_adaptive_reconciliation_policy');
    expect(ids).toContain('persist_adaptive_reconciliation_policy');
  });
  it('derives export parity automation when missing', () => {
    const ids = idsOf(sig({ hasExportParity: false }));
    expect(ids).toContain('run_export_parity_automation');
  });
  it('derives manual rerun_visual_qa when Visual QA missing', () => {
    const plans = deriveSelfHealingActionsFromSignals({ signals: sig({ hasVisualQuality: false }) });
    const vq = plans.find((p) => p.actionId === 'rerun_visual_qa');
    expect(vq?.safetyLevel).toBe('manual_only');
    expect(vq?.status).toBe('manual_required');
  });
  it('derives manual rerun_repair when repair audit missing', () => {
    const plans = deriveSelfHealingActionsFromSignals({ signals: sig({ hasRepairAudit: false }) });
    expect(plans.find((p) => p.actionId === 'rerun_repair')?.safetyLevel).toBe('manual_only');
  });
  it('derives block_until_manual_review when adaptive policy blocked', () => {
    const plans = deriveSelfHealingActionsFromSignals({ signals: sig({ adaptiveAiBlocked: true, adaptiveDecision: 'blocked' }) });
    const block = plans.find((p) => p.actionId === 'block_until_manual_review');
    expect(block).toBeTruthy();
    expect(block?.status).toBe('blocked');
  });
  it('derives block_until_manual_review for manual_review_only repair pattern', () => {
    const ids = idsOf(sig({ primaryRepairPatternId: 'manual_review_only', deterministicRepairStrategy: 'blocked' }));
    expect(ids).toContain('block_until_manual_review');
  });
  it('derives run_ai_reconciliation as manual_only when AI recommended not run', () => {
    const plans = deriveSelfHealingActionsFromSignals({ signals: sig({ adaptiveDecision: 'recommended', adaptiveAiBlocked: false }) });
    const ai = plans.find((p) => p.actionId === 'run_ai_reconciliation');
    expect(ai?.safetyLevel).toBe('manual_only');
    expect(ai?.status).toBe('manual_required');
  });
  it('skips an action when attempt count >= max attempts', () => {
    const def = getSelfHealingActionDefinition('build_import_intelligence_profile');
    const plan = buildSelfHealingActionPlan({
      actionId: 'build_import_intelligence_profile',
      signals: sig({ hasImportIntelligenceProfile: false, previousAuditActionCounts: { build_import_intelligence_profile: def!.maxAttempts } }),
      priority: 10, reasonCodes: ['missing_profile'],
    });
    expect(plan.status).toBe('skipped');
    expect(plan.reasonCodes).toContain('max_attempts_reached');
  });
});
