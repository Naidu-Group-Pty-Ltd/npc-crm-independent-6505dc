import { describe, expect, it } from 'vitest';
import {
  getPdfImportCostLevelScore,
  resolvePdfImportCostLevelFromScore,
  estimatePdfImportStepCosts,
  estimateOverallCostScore,
  estimateOverallCostLevel,
  shouldRequireConfirmationForStep,
  type PdfImportPerformanceSignals,
} from '../ingestion/performance';

function signals(overrides: Partial<PdfImportPerformanceSignals> = {}): PdfImportPerformanceSignals {
  return {
    importId: 'import-1', templateId: 'template-1', sourceFilename: 'f.pdf',
    importStatus: 'completed', pageCount: 3, engineVersion: 'docling-1.0',
    hasVisualQuality: true, visualQaScore: 0.95, visualQaGeneratedAt: null,
    hasRepairAudit: true, repairStatus: 'completed', repairFinalScore: 0.96, repairGeneratedAt: null,
    hasExportParity: true, exportParityStatus: 'completed', exportVsSourceScore: 0.94, exportParityGeneratedAt: null,
    hasGoldenRegression: true, goldenQualityGateStatus: 'pass', goldenGeneratedAt: null, goldenPersistedAt: null,
    hasGoldenHistory: false, goldenHistoryRunCount: null,
    hasImportProfile: true, importProfileCategory: 'digital_text', importRiskLevel: 'low', importProfileGeneratedAt: null,
    hasRepairPatternAnalysis: true, primaryRepairPatternId: null, repairPatternSeverity: 'low', repairPatternGeneratedAt: null,
    hasAdaptiveReconciliationPolicy: true, adaptiveDecision: 'not_needed', adaptiveAiBlocked: false, adaptiveGeneratedAt: null,
    hasSelfHealingAudit: true, selfHealingStatus: 'no_action', selfHealingGeneratedAt: null, selfHealingExecutedAt: null,
    pdfJobDurationMs: null, pdfJobStatus: null, pdfJobFailed: null,
    artifactPathCount: 4, missingArtifactPathCount: 0,
    warningCount: 0, failureCount: 0,
    ...overrides,
  };
}

describe('cost model level scores', () => {
  it('maps cost level scores correctly', () => {
    expect(getPdfImportCostLevelScore('negligible')).toBe(0.05);
    expect(getPdfImportCostLevelScore('low')).toBe(0.2);
    expect(getPdfImportCostLevelScore('medium')).toBe(0.45);
    expect(getPdfImportCostLevelScore('high')).toBe(0.7);
    expect(getPdfImportCostLevelScore('very_high')).toBe(0.95);
    expect(getPdfImportCostLevelScore('unknown')).toBe(0.5);
  });
  it('resolves negligible from score', () => { expect(resolvePdfImportCostLevelFromScore(0.05)).toBe('negligible'); });
  it('resolves low from score', () => { expect(resolvePdfImportCostLevelFromScore(0.2)).toBe('low'); });
  it('resolves medium from score', () => { expect(resolvePdfImportCostLevelFromScore(0.45)).toBe('medium'); });
  it('resolves high from score', () => { expect(resolvePdfImportCostLevelFromScore(0.7)).toBe('high'); });
  it('resolves very_high from score', () => { expect(resolvePdfImportCostLevelFromScore(0.95)).toBe('very_high'); });
  it('resolves unknown for null score', () => { expect(resolvePdfImportCostLevelFromScore(null)).toBe('unknown'); });
});

describe('estimatePdfImportStepCosts', () => {
  it('includes load_snapshot', () => {
    expect(estimatePdfImportStepCosts(signals()).some((s) => s.stepId === 'load_snapshot')).toBe(true);
  });
  it('includes run_visual_qa', () => {
    expect(estimatePdfImportStepCosts(signals()).some((s) => s.stepId === 'run_visual_qa')).toBe(true);
  });
  it('includes run_ai_reconciliation', () => {
    expect(estimatePdfImportStepCosts(signals()).some((s) => s.stepId === 'run_ai_reconciliation')).toBe(true);
  });
  it('AI step is very_high and requires confirmation', () => {
    const ai = estimatePdfImportStepCosts(signals()).find((s) => s.stepId === 'run_ai_reconciliation')!;
    expect(ai.costLevel).toBe('very_high');
    expect(ai.shouldRequireConfirmation).toBe(true);
  });
  it('pageCount > 10 escalates Visual QA/export parity cost', () => {
    const steps = estimatePdfImportStepCosts(signals({ pageCount: 15 }));
    expect(steps.find((s) => s.stepId === 'run_visual_qa')!.costLevel).toBe('very_high');
    expect(steps.find((s) => s.stepId === 'run_export_parity')!.costLevel).toBe('very_high');
  });
  it('high import risk escalates repair cost', () => {
    const repair = estimatePdfImportStepCosts(signals({ importRiskLevel: 'high' })).find((s) => s.stepId === 'run_repair')!;
    expect(repair.costLevel).toBe('high');
  });
  it('overall cost score averages step costs', () => {
    const steps = estimatePdfImportStepCosts(signals());
    const manual = steps.reduce((a, s) => a + s.estimatedCostScore, 0) / steps.length;
    expect(estimateOverallCostScore(steps)).toBeCloseTo(Number(manual.toFixed(4)), 4);
  });
  it('overall cost level resolves from score', () => {
    expect(['negligible', 'low', 'medium', 'high', 'very_high', 'unknown'])
      .toContain(estimateOverallCostLevel(estimatePdfImportStepCosts(signals())));
  });
});

describe('shouldRequireConfirmationForStep', () => {
  it('requires confirmation for AI', () => {
    expect(shouldRequireConfirmationForStep('run_ai_reconciliation', signals())).toBe(true);
  });
  it('requires confirmation for large-page Visual QA', () => {
    expect(shouldRequireConfirmationForStep('run_visual_qa', signals({ pageCount: 20 }))).toBe(true);
    expect(shouldRequireConfirmationForStep('run_visual_qa', signals({ pageCount: 3 }))).toBe(false);
  });
  it('requires confirmation for high-risk repair', () => {
    expect(shouldRequireConfirmationForStep('run_repair', signals({ importRiskLevel: 'critical' }))).toBe(true);
  });
});
