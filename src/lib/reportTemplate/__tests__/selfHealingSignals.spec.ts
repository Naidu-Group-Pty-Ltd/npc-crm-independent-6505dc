import { describe, expect, it } from 'vitest';
import {
  coerceSelfHealingBoolean,
  coerceSelfHealingNumber,
  readSelfHealingPath,
  extractSelfHealingSignals,
  extractSelfHealingFailureCodes,
  extractSelfHealingWarningCodes,
  extractPreviousAuditActionCounts,
} from '../ingestion/selfHealing';

const snapshot = {
  importId: 'import-1', templateId: 'template-1', sourceFilename: 'doc.pdf',
  importStatus: 'completed',
  visualQaScore: 0.8, visualQaManualReviewRequired: true, visualQaArtifactPath: 'a.json',
  repairStatus: 'failed', repairFinalScore: 0.7, repairRequiresFallback: true, repairArtifactPath: 'r.json',
  exportParityStatus: 'manual_required', exportVsSourceScore: 0.7, exportParityArtifactPath: 'e.json',
};

const profile = { profileCategory: 'table_heavy', riskLevel: 'high', scores: {} };
const repairPattern = { primaryPatternId: 'table_grid_drift', overallSeverity: 'high', deterministicRepairStrategy: 'constrained', operatorReviewRequirement: 'required' };
const adaptive = { decision: 'blocked', recommendedAction: 'block_ai_reconciliation', flags: { aiBlocked: true, requiresManualReview: true, shouldRerunRepairBeforeReconciliation: false } };

describe('helpers', () => {
  it('boolean coercion handles booleans and strings', () => {
    expect(coerceSelfHealingBoolean(true)).toBe(true);
    expect(coerceSelfHealingBoolean('false')).toBe(false);
  });
  it('number coercion handles numbers and numeric strings', () => {
    expect(coerceSelfHealingNumber(0.5)).toBe(0.5);
    expect(coerceSelfHealingNumber('0.9')).toBe(0.9);
    expect(coerceSelfHealingNumber('x')).toBeNull();
  });
  it('path reader reads nested values', () => {
    expect(readSelfHealingPath({ a: { b: 2 } }, ['a', 'b'])).toBe(2);
  });
});

describe('extractSelfHealingSignals', () => {
  it('extracts import/template identity from snapshot', () => {
    const { signals } = extractSelfHealingSignals({ importId: 'import-1', snapshot });
    expect(signals.importId).toBe('import-1');
    expect(signals.templateId).toBe('template-1');
    expect(signals.templateExists).toBe(true);
    expect(signals.importStatus).toBe('completed');
  });
  it('detects missing Visual QA / repair / export parity', () => {
    const { signals } = extractSelfHealingSignals({ importId: 'import-1', snapshot: { importId: 'import-1' } });
    expect(signals.hasVisualQuality).toBe(false);
    expect(signals.hasRepairAudit).toBe(false);
    expect(signals.hasExportParity).toBe(false);
  });
  it('detects import intelligence / repair pattern / adaptive policy presence', () => {
    const { signals } = extractSelfHealingSignals({ importId: 'import-1', importIntelligenceProfile: profile, repairPatternAnalysis: repairPattern, adaptiveReconciliationPolicy: adaptive });
    expect(signals.hasImportIntelligenceProfile).toBe(true);
    expect(signals.hasRepairPatternAnalysis).toBe(true);
    expect(signals.hasAdaptiveReconciliationPolicy).toBe(true);
  });
  it('extracts adaptive aiBlocked flag and repair pattern strategy', () => {
    const { signals } = extractSelfHealingSignals({ importId: 'import-1', adaptiveReconciliationPolicy: adaptive, repairPatternAnalysis: repairPattern });
    expect(signals.adaptiveAiBlocked).toBe(true);
    expect(signals.deterministicRepairStrategy).toBe('constrained');
  });
  it('extracts golden quality gate status/counts', () => {
    const { signals } = extractSelfHealingSignals({ importId: 'import-1', goldenRegressionSummary: { qualityGateStatus: 'fail', failures: ['a', 'b'], warnings: ['w'] } });
    expect(signals.goldenQualityGateStatus).toBe('fail');
    expect(signals.goldenFailureCount).toBe(2);
    expect(signals.goldenWarningCount).toBe(1);
  });
  it('extracts triage outcome and primary action', () => {
    const { signals } = extractSelfHealingSignals({ importId: 'import-1', triageSummary: { outcome: 'action_required', primaryAction: 'rerun_export_parity', severity: 'high' } });
    expect(signals.triageOutcome).toBe('action_required');
    expect(signals.triagePrimaryAction).toBe('rerun_export_parity');
    expect(signals.triageSeverity).toBe('high');
  });
  it('adds import_id_missing blocker when import ID missing', () => {
    const { blockers } = extractSelfHealingSignals({ snapshot: {} });
    expect(blockers).toContain('import_id_missing');
  });
  it('missing profile/pattern/policy produce warnings, not blockers', () => {
    const { warnings, blockers } = extractSelfHealingSignals({ importId: 'import-1', snapshot });
    expect(warnings).toContain('missing_profile');
    expect(warnings).toContain('missing_repair_pattern_analysis');
    expect(warnings).toContain('missing_adaptive_policy');
    expect(blockers).not.toContain('import_id_missing');
  });
  it('produces evidence for major missing/failure signals', () => {
    const { evidence } = extractSelfHealingSignals({ importId: 'import-1', snapshot, adaptiveReconciliationPolicy: adaptive });
    const codes = evidence.map((e) => e.code);
    expect(codes).toContain('repair_failed');
    expect(codes).toContain('adaptive_policy_blocked');
  });
  it('extracts previous audit action counts', () => {
    const counts = extractPreviousAuditActionCounts({ actions: [{ actionId: 'reload_snapshot', attemptCount: 2 }, { actionId: 'reload_snapshot', attemptCount: 1 }] });
    expect(counts.reload_snapshot).toBe(3);
  });
});

describe('code extractors', () => {
  it('extracts failure codes from quality gates and warnings from golden', () => {
    const failures = extractSelfHealingFailureCodes({ qualityGateReport: { gates: [{ id: 'visual_quality_score_threshold', status: 'fail' }] } });
    expect(failures).toContain('visual_quality_score_threshold');
    const warnings = extractSelfHealingWarningCodes({ goldenRegressionSummary: { warnings: ['export_parity_drift'] } });
    expect(warnings).toContain('export_parity_drift');
  });
});
