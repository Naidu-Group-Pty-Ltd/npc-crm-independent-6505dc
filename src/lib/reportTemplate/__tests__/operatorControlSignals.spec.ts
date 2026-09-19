import { describe, expect, it } from 'vitest';
import {
  extractOperatorControlSignals,
  extractOperatorFailureCodes,
  extractOperatorWarningCodes,
} from '../ingestion/operatorControls';

function snap(overrides: Record<string, unknown> = {}) {
  return {
    importId: 'import-1',
    templateId: 'template-1',
    sourceFilename: 'golden-simple-001.pdf',
    importStatus: 'completed',
    visualQaArtifactPath: 'import-1/vq.json',
    visualQaScore: 0.95,
    visualQaManualReviewRequired: false,
    repairArtifactPath: 'import-1/repair.json',
    repairStatus: 'completed',
    repairRequiresManualReview: false,
    repairRequiresFallback: false,
    exportParityArtifactPath: 'import-1/ep.json',
    exportParityStatus: 'completed',
    ...overrides,
  };
}

describe('extractOperatorControlSignals', () => {
  it('extracts import identity from snapshot', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap() });
    expect(signals.importId).toBe('import-1');
    expect(signals.templateId).toBe('template-1');
    expect(signals.sourceFilename).toBe('golden-simple-001.pdf');
  });
  it('extracts golden quality gate status', () => {
    for (const s of ['pass', 'warning', 'fail', 'blocked']) {
      const { signals } = extractOperatorControlSignals({ snapshot: snap(), goldenRegressionSummary: { qualityGateStatus: s } });
      expect(signals.qualityGateStatus).toBe(s);
    }
  });
  it('extracts operator decision', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap(), goldenRegressionSummary: { operatorDecision: 'accepted' } });
    expect(signals.operatorDecision).toBe('accepted');
  });
  it('detects import profile presence', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap(), importIntelligenceProfile: { profileCategory: 'digital_text', riskLevel: 'low' } });
    expect(signals.hasImportProfile).toBe(true);
    expect(signals.importProfileCategory).toBe('digital_text');
  });
  it('detects repair pattern analysis presence', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap(), repairPatternAnalysis: { primaryPatternId: 'x', overallSeverity: 'medium', operatorReviewRequirement: 'block_until_review', deterministicRepairStrategy: 'manual_only' } });
    expect(signals.hasRepairPatternAnalysis).toBe(true);
    expect(signals.operatorReviewRequirement).toBe('block_until_review');
    expect(signals.deterministicRepairStrategy).toBe('manual_only');
  });
  it('detects adaptive policy presence and aiBlocked', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap(), adaptiveReconciliationPolicy: { decision: 'blocked', recommendedAction: 'block_ai_reconciliation', flags: { aiBlocked: true, requiresManualReview: true } } });
    expect(signals.hasAdaptivePolicy).toBe(true);
    expect(signals.adaptiveDecision).toBe('blocked');
    expect(signals.adaptiveAiBlocked).toBe(true);
    expect(signals.adaptiveRequiresManualReview).toBe(true);
  });
  it('detects self-healing audit blocked/manual counts', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap(), selfHealingRetryAudit: { status: 'blocked', summary: { blockedActions: 2, manualActions: 3 } } });
    expect(signals.hasSelfHealingAudit).toBe(true);
    expect(signals.selfHealingBlockedActions).toBe(2);
    expect(signals.selfHealingManualActions).toBe(3);
  });
  it('detects performance audit risk/cost', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap(), performanceCostAudit: { overallRiskLevel: 'high', overallCostLevel: 'very_high' } });
    expect(signals.hasPerformanceAudit).toBe(true);
    expect(signals.performanceRiskLevel).toBe('high');
    expect(signals.performanceCostLevel).toBe('very_high');
  });
  it('detects export parity status', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap({ exportParityStatus: 'manual_required' }) });
    expect(signals.exportParityStatus).toBe('manual_required');
    expect(signals.hasExportParity).toBe(true);
  });
  it('detects Visual QA manual review', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap({ visualQaManualReviewRequired: true }) });
    expect(signals.visualQaManualReviewRequired).toBe(true);
  });
  it('detects repair manual review/fallback', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap({ repairRequiresManualReview: true, repairRequiresFallback: true }) });
    expect(signals.repairRequiresManualReview).toBe(true);
    expect(signals.repairRequiresFallback).toBe(true);
  });
  it('extracts previous operator audit decision', () => {
    const { signals } = extractOperatorControlSignals({ snapshot: snap(), previousOperatorControlAudit: { operatorState: { decision: 'accepted_with_warnings', blocked: false } } });
    expect(signals.previousOperatorAuditDecision).toBe('accepted_with_warnings');
    expect(signals.previousOperatorAuditBlocked).toBe(false);
  });
  it('extracts failure codes', () => {
    const codes = extractOperatorFailureCodes({ goldenRegressionSummary: { failures: ['visual_quality_below_threshold'] } });
    expect(codes).toContain('visual_quality_below_threshold');
  });
  it('extracts warning codes', () => {
    const codes = extractOperatorWarningCodes({ goldenRegressionSummary: { warnings: ['ai_reconciliation_recommended'] } });
    expect(codes).toContain('ai_reconciliation_recommended');
  });
  it('import_id_missing blocker appears when import ID missing', () => {
    const { blockers } = extractOperatorControlSignals({ snapshot: snap({ importId: null }) });
    expect(blockers).toContain('import_id_missing');
  });
  it('optional missing intelligence produces warnings not blockers', () => {
    const { warnings, blockers } = extractOperatorControlSignals({ snapshot: { importId: 'import-1', importStatus: 'completed', templateId: 't' } });
    expect(warnings).toContain('missing_import_profile');
    expect(warnings).toContain('missing_performance_audit');
    expect(blockers).toEqual([]);
  });
  it('produces evidence for high-risk states', () => {
    const { evidence } = extractOperatorControlSignals({ snapshot: snap(), adaptiveReconciliationPolicy: { decision: 'blocked', flags: { aiBlocked: true } }, performanceCostAudit: { overallRiskLevel: 'critical' } });
    const codes = evidence.map((e) => e.code);
    expect(codes).toContain('adaptive_policy_blocked');
    expect(codes).toContain('high_performance_risk');
  });
});
