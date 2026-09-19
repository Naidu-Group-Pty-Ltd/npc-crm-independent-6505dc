import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_RECONCILIATION_POLICY_VERSION,
  buildAdaptiveReconciliationPolicy,
  validateAdaptiveReconciliationPolicy,
  evaluateAdaptiveReconciliationDecision,
  calculateAdaptiveReconciliationConfidence,
  resolveAdaptiveReconciliationSeverity,
  resolveAdaptiveReconciliationAction,
  buildAdaptiveReconciliationFlags,
} from '../ingestion/reconciliation';
import type { AdaptiveReconciliationSignals } from '../ingestion/reconciliation';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

function sig(overrides: Partial<AdaptiveReconciliationSignals> = {}): AdaptiveReconciliationSignals {
  return {
    importId: 'import-1', templateId: 'template-1', sourceFilename: 'doc.pdf',
    profileCategory: null, importRiskLevel: null, importConfidence: null,
    automationRiskScore: null, manualReviewLikelihood: null, ocrRiskScore: null,
    tableRiskScore: null, imageRiskScore: null, designRiskScore: null,
    primaryRepairPatternId: null, repairPatternSeverity: null, deterministicRepairStrategy: null,
    repairPatternAiUsefulness: null, repairPatternOperatorReviewRequirement: null,
    repairPatternExportParityRequirement: null, repairPatternConfidence: null,
    visualQaScore: null, visualQaManualReviewRequired: null,
    repairStatus: null, repairFinalScore: null, repairRequiresFallback: null, repairRequiresManualReview: null,
    exportParityStatus: null, exportVsSourceScore: null, editorVsSourceScore: null, exportVsEditorScore: null,
    existingAiReconciliationStatus: null, existingAiReconciliationRecommendation: null,
    goldenQualityGateStatus: null, goldenWarningCount: null, goldenFailureCount: null, baselineOutcome: null,
    qualityGateFailures: [], qualityGateWarnings: [], triageFailureCodes: [], triageWarningCodes: [],
    ...overrides,
  };
}

function decisionOf(overrides: Partial<AdaptiveReconciliationSignals>) {
  return evaluateAdaptiveReconciliationDecision({ signals: sig(overrides) }).decision;
}

describe('adaptive reconciliation decisions', () => {
  it('low-risk simple document with high scores returns not_needed', () => {
    const p = buildAdaptiveReconciliationPolicy({
      importId: 'import-1',
      importIntelligenceProfile: { profileCategory: 'simple_document', riskLevel: 'low', confidence: 0.9, scores: { automationRiskScore: 0.05, manualReviewLikelihood: 0.05, ocrRiskScore: 0 } },
      snapshot: { importId: 'import-1', visualQaScore: 0.95, repairStatus: 'completed', repairFinalScore: 0.95, exportParityStatus: 'completed', exportVsSourceScore: 0.95 },
      goldenRegressionSummary: { qualityGateStatus: 'pass' },
      now: NOW,
    });
    expect(p.decision).toBe('not_needed');
  });

  it('medium complexity with moderate scores returns optional', () => {
    expect(decisionOf({
      profileCategory: 'design_heavy', importRiskLevel: 'medium', designRiskScore: 0.5,
      repairPatternAiUsefulness: 'medium', visualQaScore: 0.88, repairFinalScore: 0.88,
      exportParityStatus: 'completed', exportVsSourceScore: 0.9,
    })).toBe('optional');
  });

  it('table-heavy repair pattern with high AI usefulness returns recommended', () => {
    expect(decisionOf({
      profileCategory: 'table_heavy', importRiskLevel: 'medium', tableRiskScore: 0.9,
      primaryRepairPatternId: 'table_grid_drift', repairPatternAiUsefulness: 'high',
      deterministicRepairStrategy: 'constrained',
    })).toBe('recommended');
  });

  it('design-heavy with manual review required returns manual_review', () => {
    expect(decisionOf({ profileCategory: 'design_heavy', visualQaManualReviewRequired: true })).toBe('manual_review');
  });

  it('scanned OCR high risk returns manual_review or blocked', () => {
    const d = decisionOf({ profileCategory: 'scanned_ocr', ocrRiskScore: 0.9, manualReviewLikelihood: 0.8 });
    expect(['manual_review', 'blocked']).toContain(d);
  });

  it('manual_review_only repair pattern returns manual_review', () => {
    expect(decisionOf({
      primaryRepairPatternId: 'manual_review_only', deterministicRepairStrategy: 'manual_only',
      repairPatternAiUsefulness: 'manual_review_only', repairPatternOperatorReviewRequirement: 'required',
    })).toBe('manual_review');
  });

  it('block_automation repair pattern returns blocked', () => {
    expect(decisionOf({
      deterministicRepairStrategy: 'blocked', repairPatternAiUsefulness: 'blocked',
      repairPatternOperatorReviewRequirement: 'block_until_review',
    })).toBe('blocked');
  });

  it('missing importId returns blocked', () => {
    expect(decisionOf({ importId: null })).toBe('blocked');
  });

  it('quality gate blocked returns blocked', () => {
    expect(decisionOf({ goldenQualityGateStatus: 'blocked' })).toBe('blocked');
  });

  it('missing visual QA prerequisite returns blocked or manual_review', () => {
    const d = decisionOf({ qualityGateFailures: ['visual_quality_artifact_present'] });
    expect(['blocked', 'manual_review']).toContain(d);
  });

  it('repair failed rerunnable returns recommended with rerun_repair_first', () => {
    const e = evaluateAdaptiveReconciliationDecision({ signals: sig({ repairStatus: 'failed', visualQaScore: 0.8 }) });
    expect(e.decision).toBe('recommended');
    expect(e.recommendedAction).toBe('rerun_repair_first');
    expect(e.flags.shouldRerunRepairBeforeReconciliation).toBe(true);
  });

  it('export parity failed returns recommended/manual_review and requires export parity after AI', () => {
    const e = evaluateAdaptiveReconciliationDecision({ signals: sig({ exportParityStatus: 'failed' }) });
    expect(['recommended', 'manual_review']).toContain(e.decision);
    expect(e.flags.requiresExportParityAfterReconciliation).toBe(true);
  });

  it('missing_major_visual_element returns manual_review or blocked', () => {
    const d = decisionOf({ primaryRepairPatternId: 'missing_major_visual_element', deterministicRepairStrategy: 'constrained' });
    expect(['manual_review', 'blocked']).toContain(d);
  });

  it('high automation risk >= 0.85 returns blocked', () => {
    expect(decisionOf({ automationRiskScore: 0.9 })).toBe('blocked');
  });

  it('manualReviewLikelihood >= 0.75 returns manual_review', () => {
    expect(decisionOf({ manualReviewLikelihood: 0.8 })).toBe('manual_review');
  });

  it('existing AI completed leads to not_needed/optional', () => {
    const p = buildAdaptiveReconciliationPolicy({
      importId: 'import-1',
      importIntelligenceProfile: { profileCategory: 'simple_document', riskLevel: 'low', scores: {} },
      snapshot: { importId: 'import-1', visualQaScore: 0.95, repairStatus: 'completed', repairFinalScore: 0.95, exportParityStatus: 'completed', exportVsSourceScore: 0.95, aiReconciliationStatus: 'completed' },
      now: NOW,
    });
    expect(['not_needed', 'optional']).toContain(p.decision);
  });

  it('existing AI failed creates a warning', () => {
    const e = evaluateAdaptiveReconciliationDecision({ signals: sig({ existingAiReconciliationStatus: 'failed', visualQaScore: 0.9 }) });
    expect(e.warnings).toContain('prior_ai_reconciliation_failed');
  });

  it('decision precedence: blocked wins over manual_review/recommended', () => {
    expect(decisionOf({
      profileCategory: 'high_risk', importRiskLevel: 'critical', automationRiskScore: 0.9,
      visualQaManualReviewRequired: true, visualQaScore: 0.5,
    })).toBe('blocked');
  });
});

describe('severity / action / flags mapping', () => {
  it('severity maps correctly for every decision', () => {
    const s = sig();
    expect(resolveAdaptiveReconciliationSeverity({ decision: 'blocked', signals: s })).toBe('critical');
    expect(resolveAdaptiveReconciliationSeverity({ decision: 'manual_review', signals: s })).toBe('high');
    expect(resolveAdaptiveReconciliationSeverity({ decision: 'recommended', signals: s })).toBe('medium');
    expect(resolveAdaptiveReconciliationSeverity({ decision: 'optional', signals: s })).toBe('low');
    expect(resolveAdaptiveReconciliationSeverity({ decision: 'not_needed', signals: s })).toBe('info');
  });

  it('recommended action maps correctly', () => {
    const s = sig();
    expect(resolveAdaptiveReconciliationAction({ decision: 'blocked', signals: s })).toBe('block_ai_reconciliation');
    expect(resolveAdaptiveReconciliationAction({ decision: 'manual_review', signals: s })).toBe('require_manual_review');
    expect(resolveAdaptiveReconciliationAction({ decision: 'recommended', signals: s })).toBe('run_ai_reconciliation');
    expect(resolveAdaptiveReconciliationAction({ decision: 'optional', signals: s })).toBe('allow_operator_choice');
    expect(resolveAdaptiveReconciliationAction({ decision: 'not_needed', signals: s })).toBe('no_action');
  });

  it('flags for not_needed allow proceeding without AI', () => {
    const f = buildAdaptiveReconciliationFlags({ decision: 'not_needed', signals: sig() });
    expect(f.canProceedWithoutAi).toBe(true);
    expect(f.aiAllowed).toBe(true);
    expect(f.aiBlocked).toBe(false);
  });

  it('flags for recommended require operator confirmation and post-AI QA/export parity', () => {
    const f = buildAdaptiveReconciliationFlags({ decision: 'recommended', signals: sig() });
    expect(f.requiresOperatorConfirmation).toBe(true);
    expect(f.requiresVisualQaAfterReconciliation).toBe(true);
    expect(f.requiresExportParityAfterReconciliation).toBe(true);
  });

  it('flags for blocked set aiBlocked true and aiAllowed false', () => {
    const f = buildAdaptiveReconciliationFlags({ decision: 'blocked', signals: sig() });
    expect(f.aiBlocked).toBe(true);
    expect(f.aiAllowed).toBe(false);
  });
});

describe('confidence, validation, timestamp', () => {
  it('confidence increases when more evidence exists', () => {
    const sparse = calculateAdaptiveReconciliationConfidence({ signals: sig() });
    const rich = calculateAdaptiveReconciliationConfidence({ signals: sig({
      profileCategory: 'table_heavy', primaryRepairPatternId: 'table_grid_drift', visualQaScore: 0.8,
      repairStatus: 'completed', exportParityStatus: 'completed', goldenQualityGateStatus: 'pass',
    }) });
    expect(rich).toBeGreaterThan(sparse);
  });

  it('validate returns ok for a valid policy', () => {
    const p = buildAdaptiveReconciliationPolicy({ importId: 'import-1', importIntelligenceProfile: { profileCategory: 'simple_document', riskLevel: 'low', scores: {} }, snapshot: { importId: 'import-1', visualQaScore: 0.95 }, now: NOW });
    expect(validateAdaptiveReconciliationPolicy(p).ok).toBe(true);
  });
  it('validate returns error for invalid decision', () => {
    const p = buildAdaptiveReconciliationPolicy({ importId: 'import-1', snapshot: { importId: 'import-1' }, now: NOW });
    expect(validateAdaptiveReconciliationPolicy({ ...p, decision: 'nope' as any }).errors).toContain('invalid_decision');
  });
  it('validate returns error for invalid confidence', () => {
    const p = buildAdaptiveReconciliationPolicy({ importId: 'import-1', snapshot: { importId: 'import-1' }, now: NOW });
    expect(validateAdaptiveReconciliationPolicy({ ...p, confidence: 5 }).errors).toContain('invalid_confidence');
  });
  it('builds with the version and generatedAt uses now', () => {
    const p = buildAdaptiveReconciliationPolicy({ importId: 'import-1', snapshot: { importId: 'import-1' }, now: NOW });
    expect(p.version).toBe(ADAPTIVE_RECONCILIATION_POLICY_VERSION);
    expect(p.generatedAt).toBe('2026-07-08T00:00:00.000Z');
  });
});
