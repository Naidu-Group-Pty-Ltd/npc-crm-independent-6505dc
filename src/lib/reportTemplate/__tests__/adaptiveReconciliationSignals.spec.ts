import { describe, expect, it } from 'vitest';
import {
  clampAdaptiveReconciliationScore,
  coerceAdaptiveReconciliationBoolean,
  readAdaptiveReconciliationPath,
  extractAdaptiveReconciliationSignals,
  extractAdaptiveQualityGateFailures,
  extractAdaptiveQualityGateWarnings,
  extractAdaptiveTriageFailureCodes,
  extractAdaptiveTriageWarningCodes,
} from '../ingestion/reconciliation';

const profile = {
  importId: 'import-1', templateId: 'template-1', sourceFilename: 'doc.pdf',
  profileCategory: 'table_heavy', riskLevel: 'high', confidence: 0.8,
  scores: { automationRiskScore: 0.7, manualReviewLikelihood: 0.6, ocrRiskScore: 0.1, tableRiskScore: 0.9, imageRiskScore: 0.2, designRiskScore: 0.3 },
};

const repairPattern = {
  primaryPatternId: 'table_grid_drift', overallSeverity: 'high', deterministicRepairStrategy: 'constrained',
  aiReconciliationUsefulness: 'high', operatorReviewRequirement: 'required', exportParityRequirement: 'required', overallConfidence: 0.75,
};

const snapshot = {
  importId: 'import-1', visualQaScore: 0.8, visualQaManualReviewRequired: true,
  repairStatus: 'completed', repairFinalScore: 0.86, repairRequiresFallback: true, repairRequiresManualReview: false,
  exportParityStatus: 'completed', exportVsSourceScore: 0.82, editorVsSourceScore: 0.9, exportVsEditorScore: 0.88,
  aiReconciliationStatus: 'not_run', aiReconciliationRecommendation: 'optional',
};

describe('helpers', () => {
  it('clampAdaptiveReconciliationScore accepts 0.5 and clamps', () => {
    expect(clampAdaptiveReconciliationScore(0.5)).toBe(0.5);
    expect(clampAdaptiveReconciliationScore(-1)).toBe(0);
    expect(clampAdaptiveReconciliationScore(2)).toBe(1);
    expect(clampAdaptiveReconciliationScore('x')).toBeNull();
  });
  it('boolean coercion handles true/false strings', () => {
    expect(coerceAdaptiveReconciliationBoolean('true')).toBe(true);
    expect(coerceAdaptiveReconciliationBoolean('false')).toBe(false);
  });
  it('path reader reads nested values', () => {
    expect(readAdaptiveReconciliationPath({ a: { b: 2 } }, ['a', 'b'])).toBe(2);
  });
});

describe('extractAdaptiveReconciliationSignals', () => {
  it('extracts profile category/risk/scores from the import intelligence profile', () => {
    const { signals } = extractAdaptiveReconciliationSignals({ importId: 'import-1', importIntelligenceProfile: profile });
    expect(signals.profileCategory).toBe('table_heavy');
    expect(signals.importRiskLevel).toBe('high');
    expect(signals.automationRiskScore).toBe(0.7);
    expect(signals.tableRiskScore).toBe(0.9);
  });
  it('extracts repair pattern primary/severity/strategy/AI usefulness', () => {
    const { signals } = extractAdaptiveReconciliationSignals({ importId: 'import-1', repairPatternAnalysis: repairPattern });
    expect(signals.primaryRepairPatternId).toBe('table_grid_drift');
    expect(signals.repairPatternSeverity).toBe('high');
    expect(signals.deterministicRepairStrategy).toBe('constrained');
    expect(signals.repairPatternAiUsefulness).toBe('high');
  });
  it('extracts visual QA + repair + export parity signals from snapshot', () => {
    const { signals } = extractAdaptiveReconciliationSignals({ importId: 'import-1', snapshot });
    expect(signals.visualQaScore).toBe(0.8);
    expect(signals.visualQaManualReviewRequired).toBe(true);
    expect(signals.repairRequiresFallback).toBe(true);
    expect(signals.exportParityStatus).toBe('completed');
    expect(signals.exportVsSourceScore).toBe(0.82);
  });
  it('extracts existing AI reconciliation summary', () => {
    const { signals } = extractAdaptiveReconciliationSignals({
      importId: 'import-1', existingAiReconciliationSummary: { status: 'completed', recommendation: 'optional' },
    });
    expect(signals.existingAiReconciliationStatus).toBe('completed');
    expect(signals.existingAiReconciliationRecommendation).toBe('optional');
  });
  it('extracts golden quality gate status and counts', () => {
    const { signals } = extractAdaptiveReconciliationSignals({
      importId: 'import-1', goldenRegressionSummary: { qualityGateStatus: 'fail', failures: ['a', 'b'], warnings: ['w'] },
    });
    expect(signals.goldenQualityGateStatus).toBe('fail');
    expect(signals.goldenFailureCount).toBe(2);
    expect(signals.goldenWarningCount).toBe(1);
  });
  it('adds missing_import_intelligence_profile warning when profile missing', () => {
    const { warnings } = extractAdaptiveReconciliationSignals({ importId: 'import-1', snapshot });
    expect(warnings).toContain('missing_import_intelligence_profile');
  });
  it('adds missing_repair_pattern_analysis warning when repair pattern missing', () => {
    const { warnings } = extractAdaptiveReconciliationSignals({ importId: 'import-1', importIntelligenceProfile: profile });
    expect(warnings).toContain('missing_repair_pattern_analysis');
  });
  it('adds blocker import_id_missing when no import ID', () => {
    const { blockers } = extractAdaptiveReconciliationSignals({ importIntelligenceProfile: {} });
    expect(blockers).toContain('import_id_missing');
  });
  it('evidence includes high automation risk and manual review requirement when present', () => {
    const { evidence } = extractAdaptiveReconciliationSignals({ importId: 'import-1', importIntelligenceProfile: profile, snapshot });
    const codes = evidence.map((e) => e.code);
    expect(codes).toContain('high_automation_risk');
    expect(codes).toContain('manual_review_required');
  });
});

describe('code extractors', () => {
  const report = { gates: [{ id: 'visual_quality_score_threshold', status: 'fail' }, { id: 'ai_reconciliation_policy', status: 'warning' }] };
  it('extracts failure/warning IDs from a quality gate report', () => {
    expect(extractAdaptiveQualityGateFailures(report)).toContain('visual_quality_score_threshold');
    expect(extractAdaptiveQualityGateWarnings(report)).toContain('ai_reconciliation_policy');
  });
  it('extracts failure/warning codes from a triage summary', () => {
    const triage = { failures: ['export_parity_failed'], signals: [{ code: 'repair_regressed' }], warnings: [{ code: 'manual_review' }] };
    expect(extractAdaptiveTriageFailureCodes(triage)).toContain('export_parity_failed');
    expect(extractAdaptiveTriageWarningCodes(triage)).toContain('manual_review');
  });
});
