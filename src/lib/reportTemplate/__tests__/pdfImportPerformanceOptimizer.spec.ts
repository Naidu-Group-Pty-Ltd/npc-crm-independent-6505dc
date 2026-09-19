import { describe, expect, it } from 'vitest';
import {
  buildPdfImportPerformanceCostAudit,
  generatePdfImportOptimizationRecommendations,
  estimatePdfImportWasteScore,
  resolvePdfImportPerformanceRiskLevel,
  validatePdfImportPerformanceCostAudit,
  estimatePdfImportStepCosts,
  evaluatePdfImportMetadataStaleness,
  PDF_IMPORT_PERFORMANCE_AUDIT_VERSION,
  type PdfImportPerformanceSignals,
} from '../ingestion/performance';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

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
    hasAdaptiveReconciliationPolicy: true, adaptiveDecision: 'optional', adaptiveAiBlocked: false, adaptiveGeneratedAt: null,
    hasSelfHealingAudit: true, selfHealingStatus: 'no_action', selfHealingGeneratedAt: null, selfHealingExecutedAt: null,
    pdfJobDurationMs: null, pdfJobStatus: null, pdfJobFailed: null,
    artifactPathCount: 4, missingArtifactPathCount: 0,
    warningCount: 0, failureCount: 0,
    ...overrides,
  };
}

function recs(s: PdfImportPerformanceSignals) {
  return generatePdfImportOptimizationRecommendations({
    signals: s,
    stepCosts: estimatePdfImportStepCosts(s),
    staleness: evaluatePdfImportMetadataStaleness(s),
    evidence: [],
  });
}

function actions(s: PdfImportPerformanceSignals) {
  return recs(s).map((r) => r.action);
}

describe('buildPdfImportPerformanceCostAudit', () => {
  it('builds audit with version', () => {
    const audit = buildPdfImportPerformanceCostAudit({ snapshot: { importId: 'import-1', importStatus: 'completed' }, now: NOW });
    expect(audit.version).toBe(PDF_IMPORT_PERFORMANCE_AUDIT_VERSION);
  });
  it('generatedAt uses now', () => {
    const audit = buildPdfImportPerformanceCostAudit({ snapshot: { importId: 'import-1' }, now: NOW });
    expect(audit.generatedAt).toBe('2026-07-09T00:00:00.000Z');
    expect(audit.persistedAt).toBeNull();
  });
});

describe('recommendation rules', () => {
  it('missing profile creates rebuild_stale_metadata recommendation', () => {
    expect(actions(signals({ hasImportProfile: false }))).toContain('rebuild_stale_metadata');
  });
  it('missing repair pattern creates rebuild recommendation', () => {
    expect(actions(signals({ hasRepairPatternAnalysis: false }))).toContain('rebuild_stale_metadata');
  });
  it('missing adaptive policy creates rebuild recommendation', () => {
    expect(actions(signals({ hasAdaptiveReconciliationPolicy: false }))).toContain('rebuild_stale_metadata');
  });
  it('missing export parity creates a recommendation', () => {
    const a = actions(signals({ hasExportParity: false, exportParityStatus: null }));
    expect(a.some((x) => x === 'require_operator_confirmation' || x === 'document_manual_gap')).toBe(true);
  });
  it('acceptable export parity creates reuse_existing_result recommendation', () => {
    expect(actions(signals())).toContain('reuse_existing_result');
  });
  it('adaptive decision not_needed creates avoid_ai_reconciliation recommendation', () => {
    expect(actions(signals({ adaptiveDecision: 'not_needed' }))).toContain('avoid_ai_reconciliation');
  });
  it('adaptive decision blocked creates avoid_ai_reconciliation recommendation', () => {
    expect(actions(signals({ adaptiveDecision: 'blocked' }))).toContain('avoid_ai_reconciliation');
  });
  it('adaptive decision recommended creates require_operator_confirmation recommendation', () => {
    expect(actions(signals({ adaptiveDecision: 'recommended' }))).toContain('require_operator_confirmation');
  });
  it('high page count creates confirmation recommendation', () => {
    expect(actions(signals({ pageCount: 20 }))).toContain('require_operator_confirmation');
  });
  it('long-running PDF job creates inspect_long_running_job recommendation', () => {
    expect(actions(signals({ pdfJobDurationMs: 120000 }))).toContain('inspect_long_running_job');
  });
  it('high golden history count creates archive/prune recommendation', () => {
    expect(actions(signals({ goldenHistoryRunCount: 30, hasGoldenHistory: true }))).toContain('archive_or_prune_old_history');
  });
});

describe('waste score and risk level', () => {
  it('waste score increases with stale metadata', () => {
    const clean = signals();
    const stale = signals({ importProfileGeneratedAt: '2026-01-01T00:00:00Z', goldenGeneratedAt: '2026-06-01T00:00:00Z' });
    const cleanScore = estimatePdfImportWasteScore({ signals: clean, staleness: evaluatePdfImportMetadataStaleness(clean), recommendations: recs(clean) });
    const staleScore = estimatePdfImportWasteScore({ signals: stale, staleness: evaluatePdfImportMetadataStaleness(stale), recommendations: recs(stale) });
    expect(staleScore).toBeGreaterThan(cleanScore);
  });
  it('waste score increases with repeated work', () => {
    const base = signals();
    const repeated = signals({ goldenHistoryRunCount: 30, hasGoldenHistory: true, exportParityStatus: 'manual_required' });
    const baseScore = estimatePdfImportWasteScore({ signals: base, staleness: evaluatePdfImportMetadataStaleness(base), recommendations: recs(base) });
    const repScore = estimatePdfImportWasteScore({ signals: repeated, staleness: evaluatePdfImportMetadataStaleness(repeated), recommendations: recs(repeated) });
    expect(repScore).toBeGreaterThan(baseScore);
  });
  it('risk level critical for high waste', () => {
    const s = signals({
      goldenHistoryRunCount: 30, hasGoldenHistory: true, exportParityStatus: 'manual_required',
      pdfJobDurationMs: 120000, pdfJobFailed: true, adaptiveDecision: 'not_needed',
      importProfileGeneratedAt: '2026-01-01T00:00:00Z', goldenGeneratedAt: '2026-06-01T00:00:00Z',
    });
    const r = recs(s);
    const waste = estimatePdfImportWasteScore({ signals: s, staleness: evaluatePdfImportMetadataStaleness(s), recommendations: r });
    expect(resolvePdfImportPerformanceRiskLevel({ signals: s, recommendations: r, estimatedWasteScore: waste })).toBe('critical');
  });
  it('risk level high for high-cost recommendations', () => {
    const s = signals({ adaptiveDecision: 'not_needed' });
    const r = recs(s);
    expect(resolvePdfImportPerformanceRiskLevel({ signals: s, recommendations: r, estimatedWasteScore: 0.2 })).toBe('high');
  });
});

describe('validatePdfImportPerformanceCostAudit', () => {
  it('validation passes for a valid audit', () => {
    const audit = buildPdfImportPerformanceCostAudit({ snapshot: { importId: 'import-1', importStatus: 'completed' }, now: NOW });
    expect(validatePdfImportPerformanceCostAudit(audit).ok).toBe(true);
  });
  it('validation fails invalid cost level', () => {
    const audit = buildPdfImportPerformanceCostAudit({ snapshot: { importId: 'import-1' }, now: NOW });
    const bad = { ...audit, overallCostLevel: 'nope' as any };
    const r = validatePdfImportPerformanceCostAudit(bad);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('invalid_cost_level');
  });
  it('validation fails invalid recommendation action', () => {
    const audit = buildPdfImportPerformanceCostAudit({ snapshot: { importId: 'import-1' }, now: NOW });
    const bad = { ...audit, recommendations: [{ ...(audit.recommendations[0] ?? { id: 'x', domain: 'metadata', severity: 'info', costLevel: 'low', confidence: 1, message: '', evidence: [] }), action: 'bogus' }] as any };
    const r = validatePdfImportPerformanceCostAudit(bad);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('invalid_recommendation_action');
  });
});
