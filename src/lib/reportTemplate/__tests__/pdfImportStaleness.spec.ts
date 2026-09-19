import { describe, expect, it } from 'vitest';
import {
  evaluatePdfImportMetadataStaleness,
  isMetadataMissingOrStale,
  resolveMetadataStalenessStatus,
  type PdfImportPerformanceSignals,
} from '../ingestion/performance';

function signals(overrides: Partial<PdfImportPerformanceSignals> = {}): PdfImportPerformanceSignals {
  return {
    importId: 'import-1', templateId: 'template-1', sourceFilename: 'f.pdf',
    importStatus: 'completed', pageCount: 3, engineVersion: 'docling-1.0',
    hasVisualQuality: true, visualQaScore: 0.95, visualQaGeneratedAt: '2026-07-01T00:00:00Z',
    hasRepairAudit: true, repairStatus: 'completed', repairFinalScore: 0.96, repairGeneratedAt: '2026-07-01T00:00:00Z',
    hasExportParity: true, exportParityStatus: 'completed', exportVsSourceScore: 0.94, exportParityGeneratedAt: '2026-07-01T00:00:00Z',
    hasGoldenRegression: true, goldenQualityGateStatus: 'pass', goldenGeneratedAt: '2026-07-05T00:00:00Z', goldenPersistedAt: null,
    hasGoldenHistory: false, goldenHistoryRunCount: null,
    hasImportProfile: true, importProfileCategory: 'digital_text', importRiskLevel: 'low', importProfileGeneratedAt: '2026-07-02T00:00:00Z',
    hasRepairPatternAnalysis: true, primaryRepairPatternId: null, repairPatternSeverity: 'low', repairPatternGeneratedAt: '2026-07-03T00:00:00Z',
    hasAdaptiveReconciliationPolicy: true, adaptiveDecision: 'not_needed', adaptiveAiBlocked: false, adaptiveGeneratedAt: '2026-07-04T00:00:00Z',
    hasSelfHealingAudit: true, selfHealingStatus: 'no_action', selfHealingGeneratedAt: '2026-07-06T00:00:00Z', selfHealingExecutedAt: null,
    pdfJobDurationMs: null, pdfJobStatus: null, pdfJobFailed: null,
    artifactPathCount: 4, missingArtifactPathCount: 0,
    warningCount: 0, failureCount: 0,
    ...overrides,
  };
}

function statusOf(s: ReturnType<typeof evaluatePdfImportMetadataStaleness>, key: string) {
  return s.find((x) => x.metadataKey === key)?.status;
}

describe('evaluatePdfImportMetadataStaleness', () => {
  it('missing import profile returns missing', () => {
    expect(statusOf(evaluatePdfImportMetadataStaleness(signals({ hasImportProfile: false, importProfileGeneratedAt: null })), 'import_intelligence_profile')).toBe('missing');
  });
  it('missing repair pattern returns missing', () => {
    expect(statusOf(evaluatePdfImportMetadataStaleness(signals({ hasRepairPatternAnalysis: false, repairPatternGeneratedAt: null })), 'repair_pattern_analysis')).toBe('missing');
  });
  it('missing adaptive policy returns missing', () => {
    expect(statusOf(evaluatePdfImportMetadataStaleness(signals({ hasAdaptiveReconciliationPolicy: false, adaptiveGeneratedAt: null })), 'adaptive_reconciliation_policy')).toBe('missing');
  });
  it('existing generatedAt at/after dependencies returns fresh', () => {
    // adaptive policy at 07-04 is after profile 07-02, pattern 07-03 → fresh
    expect(statusOf(evaluatePdfImportMetadataStaleness(signals()), 'adaptive_reconciliation_policy')).toBe('fresh');
  });
  it('metadata generated before dependency returns stale', () => {
    // profile older than repair/export/golden dependency
    const s = signals({ importProfileGeneratedAt: '2026-06-01T00:00:00Z' });
    expect(statusOf(evaluatePdfImportMetadataStaleness(s), 'import_intelligence_profile')).toBe('stale');
  });
  it('missing generatedAt returns unknown', () => {
    expect(statusOf(evaluatePdfImportMetadataStaleness(signals({ importProfileGeneratedAt: null })), 'import_intelligence_profile')).toBe('unknown');
  });
  it('export parity missing returns missing', () => {
    expect(statusOf(evaluatePdfImportMetadataStaleness(signals({ hasExportParity: false, exportParityGeneratedAt: null })), 'export_parity_summary')).toBe('missing');
  });
  it('golden regression generated before export parity returns stale', () => {
    const s = signals({ goldenGeneratedAt: '2026-06-15T00:00:00Z', exportParityGeneratedAt: '2026-07-01T00:00:00Z' });
    expect(statusOf(evaluatePdfImportMetadataStaleness(s), 'golden_regression_summary')).toBe('stale');
  });
  it('self-healing generated before adaptive policy returns stale', () => {
    const s = signals({ selfHealingGeneratedAt: '2026-07-03T00:00:00Z', adaptiveGeneratedAt: '2026-07-04T00:00:00Z', goldenGeneratedAt: null, repairPatternGeneratedAt: null });
    expect(statusOf(evaluatePdfImportMetadataStaleness(s), 'self_healing_retry_audit')).toBe('stale');
  });
});

describe('isMetadataMissingOrStale', () => {
  it('returns true for missing', () => {
    const s = [resolveMetadataStalenessStatus({ metadataKey: 'x', present: false })];
    expect(isMetadataMissingOrStale(s, 'x')).toBe(true);
  });
  it('returns true for stale', () => {
    const s = [resolveMetadataStalenessStatus({ metadataKey: 'x', present: true, generatedAt: '2026-01-01T00:00:00Z', dependsOnGeneratedAt: ['2026-02-01T00:00:00Z'] })];
    expect(isMetadataMissingOrStale(s, 'x')).toBe(true);
  });
  it('returns false for fresh', () => {
    const s = [resolveMetadataStalenessStatus({ metadataKey: 'x', present: true, generatedAt: '2026-03-01T00:00:00Z', dependsOnGeneratedAt: ['2026-02-01T00:00:00Z'] })];
    expect(isMetadataMissingOrStale(s, 'x')).toBe(false);
  });
});
