import { describe, expect, it } from 'vitest';
import {
  GOLDEN_REGRESSION_SUMMARY_VERSION,
  buildGoldenRunHistoryRecordInput,
  countGoldenRunFailures,
  countGoldenRunWarnings,
  normalizeGoldenRunHistoryRecord,
  type GoldenRegressionSummary,
} from '../ingestion/goldenCorpus';

function summary(overrides: Partial<GoldenRegressionSummary> = {}): GoldenRegressionSummary {
  return {
    version: GOLDEN_REGRESSION_SUMMARY_VERSION,
    runId: 'golden-run-simple-1',
    runBatchId: 'batch-1',
    corpusId: 'golden-simple-001',
    category: 'simple_one_page',
    importId: 'import-1',
    templateId: 'template-1',
    sourceFilename: 'golden-simple-001.pdf',
    engineVersion: 'docling-1.0',
    importStatus: 'completed',
    runStatus: 'validated',
    runDecision: 'pass',
    importPageCount: 1,
    templatePageCount: 1,
    visualQaScore: 0.95,
    visualQaManualReviewRequired: false,
    repairStatus: 'completed',
    repairFinalScore: 0.96,
    repairRequiresFallback: false,
    repairRequiresManualReview: false,
    aiReconciliationStatus: null,
    aiReconciliationRecommendation: 'not_needed',
    exportParityStatus: 'completed',
    exportParityMode: 'manual',
    exportVsSourceScore: 0.94,
    editorVsSourceScore: 0.93,
    exportVsEditorScore: 0.97,
    qualityGateStatus: 'pass',
    gateSummary: { total: 5, pass: 5 } as any,
    warnings: ['w1'],
    failures: [],
    operatorDecision: 'accepted',
    notes: ['note-1'],
    generatedAt: '2026-07-05T00:00:00.000Z',
    persistedAt: null,
    ...overrides,
  };
}

describe('buildGoldenRunHistoryRecordInput', () => {
  it('throws when the summary is missing', () => {
    expect(() => buildGoldenRunHistoryRecordInput({} as any)).toThrow(/goldenRegressionSummary is required/);
  });

  it('throws when importId is missing', () => {
    expect(() => buildGoldenRunHistoryRecordInput({ goldenRegressionSummary: summary({ importId: '' }) }))
      .toThrow(/importId is required/);
  });

  it('throws when runId is missing', () => {
    expect(() => buildGoldenRunHistoryRecordInput({ goldenRegressionSummary: summary({ runId: '' }) }))
      .toThrow(/runId is required/);
  });

  it('throws when corpusId is missing', () => {
    expect(() => buildGoldenRunHistoryRecordInput({ goldenRegressionSummary: summary({ corpusId: '' }) }))
      .toThrow(/corpusId is required/);
  });

  it('maps the core identity fields', () => {
    const input = buildGoldenRunHistoryRecordInput({ goldenRegressionSummary: summary() });
    expect(input.runId).toBe('golden-run-simple-1');
    expect(input.runBatchId).toBe('batch-1');
    expect(input.corpusId).toBe('golden-simple-001');
    expect(input.importId).toBe('import-1');
    expect(input.templateId).toBe('template-1');
    expect(input.summaryVersion).toBe(GOLDEN_REGRESSION_SUMMARY_VERSION);
  });

  it('maps the quality fields', () => {
    const input = buildGoldenRunHistoryRecordInput({ goldenRegressionSummary: summary() });
    expect(input.qualityGateStatus).toBe('pass');
    expect(input.operatorDecision).toBe('accepted');
    expect(input.visualQaScore).toBe(0.95);
    expect(input.repairStatus).toBe('completed');
    expect(input.repairFinalScore).toBe(0.96);
    expect(input.exportVsSourceScore).toBe(0.94);
  });

  it('maps warnings/failures and derives counts', () => {
    const input = buildGoldenRunHistoryRecordInput({
      goldenRegressionSummary: summary({ warnings: ['a', 'b', 'c'], failures: ['x'] }),
    });
    expect(input.warnings).toEqual(['a', 'b', 'c']);
    expect(input.failures).toEqual(['x']);
    expect(input.warningCount).toBe(3);
    expect(input.failureCount).toBe(1);
  });

  it('stores the gate summary', () => {
    const input = buildGoldenRunHistoryRecordInput({ goldenRegressionSummary: summary() });
    expect(input.gateSummary).toEqual({ total: 5, pass: 5 });
  });

  it('stores the triage summary when provided', () => {
    const input = buildGoldenRunHistoryRecordInput({
      goldenRegressionSummary: summary(),
      triageSummary: { outcome: 'resolved' } as any,
    });
    expect((input.triageSummary as any).outcome).toBe('resolved');
  });

  it('stores an empty object for triage summary when missing', () => {
    const input = buildGoldenRunHistoryRecordInput({ goldenRegressionSummary: summary() });
    expect(input.triageSummary).toEqual({});
  });

  it('stores the golden regression summary object', () => {
    const input = buildGoldenRunHistoryRecordInput({ goldenRegressionSummary: summary() });
    expect((input.goldenRegressionSummary as any).runId).toBe('golden-run-simple-1');
  });

  it('includes the baseline comparison when provided', () => {
    const input = buildGoldenRunHistoryRecordInput({
      goldenRegressionSummary: summary(),
      baselineComparison: { outcome: 'improved' } as any,
    });
    expect(input.baselineComparison).toEqual({ outcome: 'improved' });
  });
});

describe('normalizeGoldenRunHistoryRecord', () => {
  it('handles a snake_case DB row', () => {
    const record = normalizeGoldenRunHistoryRecord({
      id: 'hist-1',
      run_id: 'run-1',
      corpus_id: 'golden-simple-001',
      import_id: 'import-1',
      quality_gate_status: 'warning',
      operator_decision: 'accepted_with_warnings',
      visual_qa_score: '0.8',
      repair_status: 'completed',
      warning_count: 2,
      warnings: ['w1', 'w2'],
      failures: [],
      created_at: '2026-07-05T00:00:00.000Z',
    });
    expect(record.id).toBe('hist-1');
    expect(record.runId).toBe('run-1');
    expect(record.visualQaScore).toBe(0.8);
    expect(record.repairStatus).toBe('completed');
    expect(record.warningCount).toBe(2);
    expect(record.failureCount).toBe(0);
  });

  it('handles an already-camelCase row', () => {
    const record = normalizeGoldenRunHistoryRecord({
      id: 'hist-2',
      runId: 'run-2',
      corpusId: 'golden-simple-001',
      importId: 'import-2',
      qualityGateStatus: 'pass',
      operatorDecision: 'accepted',
      warnings: ['w'],
    });
    expect(record.runId).toBe('run-2');
    expect(record.qualityGateStatus).toBe('pass');
    expect(record.warningCount).toBe(1);
  });

  it('throws when id is missing', () => {
    expect(() => normalizeGoldenRunHistoryRecord({
      run_id: 'run-1', corpus_id: 'c', import_id: 'i', quality_gate_status: 'pass', operator_decision: 'accepted',
    })).toThrow(/missing id/);
  });
});

describe('countGoldenRunWarnings / countGoldenRunFailures', () => {
  it('counts warnings for array/null/object', () => {
    expect(countGoldenRunWarnings(['a', 'b'])).toBe(2);
    expect(countGoldenRunWarnings(null)).toBe(0);
    expect(countGoldenRunWarnings({} as any)).toBe(0);
  });

  it('counts failures for array/null/object', () => {
    expect(countGoldenRunFailures(['x'])).toBe(1);
    expect(countGoldenRunFailures(undefined)).toBe(0);
    expect(countGoldenRunFailures({ length: 5 } as any)).toBe(0);
  });
});
