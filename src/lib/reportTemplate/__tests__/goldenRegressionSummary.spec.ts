import { describe, expect, it } from 'vitest';
import {
  buildGoldenRegressionSummary,
  buildEmptyGoldenCorpusSnapshot,
  getGoldenCorpusItem,
  summarizeGoldenRegressionForMeta,
  withGoldenRegressionPersistedAt,
  type GoldenCorpusImportQualitySnapshot,
  type GoldenCorpusRunEvaluation,
} from '../ingestion/goldenCorpus';
import type {
  PdfImportQualityGate,
  PdfImportQualityGateReport,
  PdfImportQualityGateStatus,
} from '../ingestion/qualityGates';

const NOW = () => new Date('2026-07-04T00:00:00.000Z');

function snap(overrides: Partial<GoldenCorpusImportQualitySnapshot> = {}): GoldenCorpusImportQualitySnapshot {
  return {
    ...buildEmptyGoldenCorpusSnapshot('imp-1'),
    templateId: 'tpl-1',
    sourceFilename: 'golden-simple-001.pdf',
    importStatus: 'completed',
    engineVersion: 'docling-1.0',
    importPageCount: 1,
    templatePageCount: 1,
    visualQaScore: 0.95,
    repairStatus: 'completed',
    repairFinalScore: 0.96,
    exportParityStatus: 'completed',
    exportParityMode: 'manual',
    exportVsSourceScore: 0.94,
    ...overrides,
  };
}

function mockRunEval(overrides: Partial<GoldenCorpusRunEvaluation> = {}): GoldenCorpusRunEvaluation {
  const corpusId = overrides.corpusId ?? 'golden-simple-001';
  const corpus = getGoldenCorpusItem(corpusId)!;
  return {
    version: 'pdf-import-golden-run-v1',
    runId: 'run-1',
    corpusId,
    category: corpus.category,
    status: 'validated',
    decision: 'pass',
    warnings: [],
    failures: [],
    snapshot: snap(),
    corpus,
    evaluatedAt: NOW().toISOString(),
    ...overrides,
  };
}

function mkGate(id: string, status: PdfImportQualityGateStatus, message: string): PdfImportQualityGate {
  return { id, category: 'import', label: id, status, severity: 'info', message, blocking: status === 'blocked' };
}

function mockGateReport(overrides: Partial<PdfImportQualityGateReport> = {}): PdfImportQualityGateReport {
  return {
    version: 'pdf-import-quality-gates-v1',
    corpusId: 'golden-simple-001',
    importId: 'imp-1',
    templateId: 'tpl-1',
    overallStatus: 'pass',
    gates: [],
    summary: { total: 0, pass: 0, warning: 0, fail: 0, blocked: 0, notEvaluated: 0 },
    generatedAt: NOW().toISOString(),
    ...overrides,
  };
}

describe('buildGoldenRegressionSummary', () => {
  it('throws when runEvaluation is missing', () => {
    expect(() =>
      buildGoldenRegressionSummary({ runEvaluation: undefined as any, qualityGateReport: mockGateReport() }),
    ).toThrow('runEvaluation is required.');
  });

  it('throws when qualityGateReport is missing', () => {
    expect(() =>
      buildGoldenRegressionSummary({ runEvaluation: mockRunEval(), qualityGateReport: undefined as any }),
    ).toThrow('qualityGateReport is required.');
  });

  it('throws when importId cannot be resolved', () => {
    const runEvaluation = mockRunEval({ snapshot: snap({ importId: null }) });
    const qualityGateReport = mockGateReport({ importId: null });
    expect(() => buildGoldenRegressionSummary({ runEvaluation, qualityGateReport })).toThrow(
      'importId is required to build a golden regression summary.',
    );
  });

  it('throws on a corpus ID mismatch', () => {
    const runEvaluation = mockRunEval({ corpusId: 'golden-simple-001' });
    const qualityGateReport = mockGateReport({ corpusId: 'golden-design-001' });
    expect(() => buildGoldenRegressionSummary({ runEvaluation, qualityGateReport })).toThrow(
      'Corpus ID mismatch',
    );
  });

  it('builds a summary with the pinned version', () => {
    const summary = buildGoldenRegressionSummary({
      runEvaluation: mockRunEval(),
      qualityGateReport: mockGateReport(),
      summaryOptions: { now: NOW },
    });
    expect(summary.version).toBe('pdf-import-golden-regression-summary-v1');
    expect(summary.importId).toBe('imp-1');
    expect(summary.corpusId).toBe('golden-simple-001');
  });

  it('uses qualityGateReport.overallStatus and summary', () => {
    const gateSummary = { total: 3, pass: 2, warning: 1, fail: 0, blocked: 0, notEvaluated: 0 };
    const summary = buildGoldenRegressionSummary({
      runEvaluation: mockRunEval(),
      qualityGateReport: mockGateReport({ overallStatus: 'warning', summary: gateSummary }),
      summaryOptions: { now: NOW },
    });
    expect(summary.qualityGateStatus).toBe('warning');
    expect(summary.gateSummary).toEqual(gateSummary);
  });

  it('defaults operatorDecision from the gate status', () => {
    const cases: Array<[PdfImportQualityGateStatus, string]> = [
      ['pass', 'accepted'],
      ['warning', 'accepted_with_warnings'],
      ['fail', 'rejected'],
      ['blocked', 'needs_rerun'],
      ['not_evaluated', 'not_reviewed'],
    ];
    for (const [status, expected] of cases) {
      const summary = buildGoldenRegressionSummary({
        runEvaluation: mockRunEval(),
        qualityGateReport: mockGateReport({ overallStatus: status }),
        summaryOptions: { now: NOW },
      });
      expect(summary.operatorDecision).toBe(expected);
    }
  });

  it('honors an explicit operatorDecision override', () => {
    const summary = buildGoldenRegressionSummary({
      runEvaluation: mockRunEval(),
      qualityGateReport: mockGateReport({ overallStatus: 'fail' }),
      summaryOptions: { now: NOW, operatorDecision: 'accepted_with_warnings' },
    });
    expect(summary.operatorDecision).toBe('accepted_with_warnings');
  });

  it('combines run warnings with warning gates', () => {
    const summary = buildGoldenRegressionSummary({
      runEvaluation: mockRunEval({ warnings: ['run_warn'] }),
      qualityGateReport: mockGateReport({
        overallStatus: 'warning',
        gates: [mkGate('g1', 'warning', 'm1'), mkGate('g2', 'pass', 'ok')],
      }),
      summaryOptions: { now: NOW },
    });
    expect(summary.warnings).toContain('run_warn');
    expect(summary.warnings).toContain('g1:m1');
    expect(summary.warnings).not.toContain('g2:ok');
  });

  it('combines run failures with failing and blocked gates', () => {
    const summary = buildGoldenRegressionSummary({
      runEvaluation: mockRunEval({ failures: ['run_fail'] }),
      qualityGateReport: mockGateReport({
        overallStatus: 'fail',
        gates: [mkGate('g2', 'fail', 'm2'), mkGate('g3', 'blocked', 'm3'), mkGate('g4', 'warning', 'w')],
      }),
      summaryOptions: { now: NOW },
    });
    expect(summary.failures).toEqual(expect.arrayContaining(['run_fail', 'g2:m2', 'g3:m3']));
    expect(summary.failures).not.toContain('g4:w');
  });

  it('deduplicates warnings and failures', () => {
    const summary = buildGoldenRegressionSummary({
      runEvaluation: mockRunEval({ warnings: ['dup', 'dup'], failures: ['df', 'df'] }),
      qualityGateReport: mockGateReport(),
      summaryOptions: { now: NOW },
    });
    expect(summary.warnings.filter((w) => w === 'dup')).toHaveLength(1);
    expect(summary.failures.filter((f) => f === 'df')).toHaveLength(1);
  });

  it('uses the provided now() for generatedAt and leaves persistedAt null', () => {
    const summary = buildGoldenRegressionSummary({
      runEvaluation: mockRunEval(),
      qualityGateReport: mockGateReport(),
      summaryOptions: { now: NOW },
    });
    expect(summary.generatedAt).toBe('2026-07-04T00:00:00.000Z');
    expect(summary.persistedAt).toBeNull();
  });
});

describe('golden regression summary helpers', () => {
  const base = () =>
    buildGoldenRegressionSummary({
      runEvaluation: mockRunEval(),
      qualityGateReport: mockGateReport(),
      summaryOptions: { now: NOW },
    });

  it('withGoldenRegressionPersistedAt sets persistedAt without mutating the original', () => {
    const summary = base();
    const persisted = withGoldenRegressionPersistedAt(summary, '2026-07-04T01:00:00.000Z');
    expect(persisted.persistedAt).toBe('2026-07-04T01:00:00.000Z');
    expect(summary.persistedAt).toBeNull();
  });

  it('summarizeGoldenRegressionForMeta preserves the core fields', () => {
    const summary = base();
    const forMeta = summarizeGoldenRegressionForMeta(summary);
    expect(forMeta.version).toBe(summary.version);
    expect(forMeta.importId).toBe(summary.importId);
    expect(forMeta.qualityGateStatus).toBe(summary.qualityGateStatus);
    expect(forMeta.gateSummary).toEqual(summary.gateSummary);
  });
});
