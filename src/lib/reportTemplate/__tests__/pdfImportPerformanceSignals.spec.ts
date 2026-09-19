import { describe, expect, it } from 'vitest';
import {
  coercePdfImportPerformanceBoolean,
  coercePdfImportPerformanceNumber,
  readPdfImportPerformancePath,
  extractPdfImportPerformanceSignals,
  countKnownArtifactPaths,
  countGoldenHistoryRuns,
  countWarningsAndFailures,
} from '../ingestion/performance';

function snap(overrides: Record<string, unknown> = {}) {
  return {
    importId: 'import-1',
    templateId: 'template-1',
    sourceFilename: 'golden-simple-001.pdf',
    importStatus: 'completed',
    engineVersion: 'docling-1.0',
    importPageCount: 3,
    templatePageCount: 3,
    visualQaArtifactPath: 'import-1/visual-quality.json',
    visualQaScore: 0.95,
    repairArtifactPath: 'import-1/repair/repair-loop.json',
    repairStatus: 'completed',
    repairFinalScore: 0.96,
    exportParityArtifactPath: 'import-1/export-parity/export-parity.json',
    exportParityStatus: 'completed',
    exportVsSourceScore: 0.94,
    ...overrides,
  };
}

describe('performance signal coercion helpers', () => {
  it('coerces booleans and strings', () => {
    expect(coercePdfImportPerformanceBoolean(true)).toBe(true);
    expect(coercePdfImportPerformanceBoolean('false')).toBe(false);
    expect(coercePdfImportPerformanceBoolean('nope')).toBeNull();
  });
  it('coerces numbers and numeric strings', () => {
    expect(coercePdfImportPerformanceNumber(12)).toBe(12);
    expect(coercePdfImportPerformanceNumber('3.5')).toBe(3.5);
    expect(coercePdfImportPerformanceNumber('x')).toBeNull();
  });
  it('reads nested paths', () => {
    expect(readPdfImportPerformancePath({ a: { b: { c: 7 } } }, ['a', 'b', 'c'])).toBe(7);
    expect(readPdfImportPerformancePath({ a: 1 }, ['a', 'b'])).toBeUndefined();
  });
});

describe('extractPdfImportPerformanceSignals', () => {
  it('extracts import/template identity from snapshot', () => {
    const { signals } = extractPdfImportPerformanceSignals({ snapshot: snap() });
    expect(signals.importId).toBe('import-1');
    expect(signals.templateId).toBe('template-1');
    expect(signals.sourceFilename).toBe('golden-simple-001.pdf');
  });
  it('detects hasVisualQuality', () => {
    expect(extractPdfImportPerformanceSignals({ snapshot: snap() }).signals.hasVisualQuality).toBe(true);
    expect(extractPdfImportPerformanceSignals({ snapshot: snap({ visualQaArtifactPath: null, visualQaScore: null }) }).signals.hasVisualQuality).toBe(false);
  });
  it('detects hasRepairAudit', () => {
    expect(extractPdfImportPerformanceSignals({ snapshot: snap() }).signals.hasRepairAudit).toBe(true);
  });
  it('detects hasExportParity', () => {
    expect(extractPdfImportPerformanceSignals({ snapshot: snap() }).signals.hasExportParity).toBe(true);
  });
  it('detects import profile presence/category/risk', () => {
    const { signals } = extractPdfImportPerformanceSignals({
      snapshot: snap(),
      importIntelligenceProfile: { profileCategory: 'digital_text', riskLevel: 'low', generatedAt: '2026-07-01T00:00:00Z' },
    });
    expect(signals.hasImportProfile).toBe(true);
    expect(signals.importProfileCategory).toBe('digital_text');
    expect(signals.importRiskLevel).toBe('low');
  });
  it('detects repair pattern presence/primary/severity', () => {
    const { signals } = extractPdfImportPerformanceSignals({
      snapshot: snap(),
      repairPatternAnalysis: { primaryPatternId: 'table_grid_drift', overallSeverity: 'medium' },
    });
    expect(signals.hasRepairPatternAnalysis).toBe(true);
    expect(signals.primaryRepairPatternId).toBe('table_grid_drift');
    expect(signals.repairPatternSeverity).toBe('medium');
  });
  it('detects adaptive policy presence/decision/aiBlocked', () => {
    const { signals } = extractPdfImportPerformanceSignals({
      snapshot: snap(),
      adaptiveReconciliationPolicy: { decision: 'blocked', flags: { aiBlocked: true } },
    });
    expect(signals.hasAdaptiveReconciliationPolicy).toBe(true);
    expect(signals.adaptiveDecision).toBe('blocked');
    expect(signals.adaptiveAiBlocked).toBe(true);
  });
  it('detects self-healing audit presence/status', () => {
    const { signals } = extractPdfImportPerformanceSignals({
      snapshot: snap(),
      selfHealingRetryAudit: { status: 'planned', executedAt: null },
    });
    expect(signals.hasSelfHealingAudit).toBe(true);
    expect(signals.selfHealingStatus).toBe('planned');
  });
  it('detects golden regression status', () => {
    const { signals } = extractPdfImportPerformanceSignals({
      snapshot: snap(),
      goldenRegressionSummary: { qualityGateStatus: 'pass', generatedAt: '2026-07-02T00:00:00Z', persistedAt: '2026-07-02T00:00:00Z' },
    });
    expect(signals.hasGoldenRegression).toBe(true);
    expect(signals.goldenQualityGateStatus).toBe('pass');
  });
  it('detects PDF job duration/status/failed', () => {
    const { signals } = extractPdfImportPerformanceSignals({
      snapshot: snap(),
      pdfImportJob: { duration_ms: 90000, status: 'failed' },
    });
    expect(signals.pdfJobDurationMs).toBe(90000);
    expect(signals.pdfJobStatus).toBe('failed');
    expect(signals.pdfJobFailed).toBe(true);
  });
  it('counts known artifact paths', () => {
    const r = countKnownArtifactPaths({ snapshot: snap() });
    expect(r.artifactPathCount).toBeGreaterThanOrEqual(3);
  });
  it('counts missing artifact paths', () => {
    const r = countKnownArtifactPaths({ snapshot: snap({ visualQaArtifactPath: null, exportParityArtifactPath: null }) });
    expect(r.missingArtifactPathCount).toBeGreaterThanOrEqual(2);
  });
  it('counts golden history runs', () => {
    expect(countGoldenHistoryRuns([{}, {}, {}])).toBe(3);
    expect(countGoldenHistoryRuns(undefined)).toBeNull();
  });
  it('counts warnings/failures', () => {
    const r = countWarningsAndFailures({
      goldenRegressionSummary: { warnings: ['a', 'b'], failures: ['c'] },
      selfHealingRetryAudit: { warnings: ['d'], blockers: ['e'] },
    });
    expect(r.warningCount).toBe(3);
    expect(r.failureCount).toBe(2);
  });
  it('long-running PDF job creates evidence', () => {
    const { evidence, warnings } = extractPdfImportPerformanceSignals({
      snapshot: snap(), pdfImportJob: { duration_ms: 120000, status: 'completed' },
    });
    expect(warnings).toContain('long_running_pdf_job');
    expect(evidence.some((e) => e.code === 'long_running_pdf_job')).toBe(true);
  });
  it('missing engine version creates warning', () => {
    const { warnings } = extractPdfImportPerformanceSignals({ snapshot: snap({ engineVersion: null }) });
    expect(warnings).toContain('missing_engine_version');
  });
  it('import_id_missing blocker appears when import ID missing', () => {
    const { blockers } = extractPdfImportPerformanceSignals({ snapshot: snap({ importId: null }) });
    expect(blockers).toContain('import_id_missing');
  });
  it('missing optional metadata does not block', () => {
    const { blockers } = extractPdfImportPerformanceSignals({ snapshot: snap() });
    expect(blockers).toEqual([]);
  });
});
