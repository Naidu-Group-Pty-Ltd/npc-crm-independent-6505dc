import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOLDEN_RUN_SCORE_DROP_TOLERANCE,
  compareGoldenRunToBaseline,
  rankOperatorDecision,
  rankQualityGateStatus,
  type GoldenRunHistoryRecord,
} from '../ingestion/goldenCorpus';

const NOW = () => new Date('2026-07-05T00:00:00.000Z');

function record(overrides: Partial<GoldenRunHistoryRecord> = {}): GoldenRunHistoryRecord {
  return {
    id: 'rec-1',
    runId: 'run-1',
    runBatchId: null,
    corpusId: 'golden-simple-001',
    category: 'simple_one_page',
    importId: 'import-1',
    templateId: 'template-1',
    sourceFilename: 'golden-simple-001.pdf',
    engineVersion: 'docling-1.0',
    orchestratorVersion: 'orch-v1',
    summaryVersion: 'summary-v1',
    importStatus: 'completed',
    runStatus: 'validated',
    runDecision: 'pass',
    qualityGateStatus: 'pass',
    operatorDecision: 'accepted',
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
    warningCount: 0,
    failureCount: 0,
    warnings: [],
    failures: [],
    gateSummary: {},
    triageSummary: {},
    goldenRegressionSummary: {},
    baselineComparison: null,
    createdBy: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function metric(c: ReturnType<typeof compareGoldenRunToBaseline>, name: string) {
  return c.metrics.find((m) => m.metric === name);
}

describe('compareGoldenRunToBaseline', () => {
  it('returns no_baseline when previous is null', () => {
    const c = compareGoldenRunToBaseline({ previous: null, current: record(), now: NOW });
    expect(c.outcome).toBe('no_baseline');
    expect(c.previousHistoryId).toBeNull();
    expect(c.messages.join(' ')).toMatch(/No previous baseline/);
  });

  it('is improved when quality gate goes warning -> pass', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ qualityGateStatus: 'warning' }),
      current: record({ qualityGateStatus: 'pass' }),
      now: NOW,
    });
    expect(c.qualityGateStatus.outcome).toBe('improved');
    expect(c.outcome).toBe('improved');
  });

  it('is degraded when quality gate goes pass -> warning', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ qualityGateStatus: 'pass' }),
      current: record({ qualityGateStatus: 'warning' }),
      now: NOW,
    });
    expect(c.qualityGateStatus.outcome).toBe('degraded');
    expect(c.outcome).toBe('degraded');
  });

  it('is degraded when quality gate goes warning -> fail', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ qualityGateStatus: 'warning' }),
      current: record({ qualityGateStatus: 'fail' }),
      now: NOW,
    });
    expect(c.outcome).toBe('degraded');
  });

  it('is stable when the quality gate is unchanged', () => {
    const c = compareGoldenRunToBaseline({ previous: record(), current: record(), now: NOW });
    expect(c.qualityGateStatus.outcome).toBe('stable');
    expect(c.outcome).toBe('stable');
  });

  it('is improved when decision goes accepted_with_warnings -> accepted', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ operatorDecision: 'accepted_with_warnings' }),
      current: record({ operatorDecision: 'accepted' }),
      now: NOW,
    });
    expect(c.operatorDecision.outcome).toBe('improved');
    expect(c.outcome).toBe('improved');
  });

  it('is degraded when decision goes accepted -> rejected', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ operatorDecision: 'accepted' }),
      current: record({ operatorDecision: 'rejected' }),
      now: NOW,
    });
    expect(c.operatorDecision.outcome).toBe('degraded');
    expect(c.outcome).toBe('degraded');
  });

  it('treats a visual score drop within tolerance as stable', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ visualQaScore: 0.95 }),
      current: record({ visualQaScore: 0.94 }),
      now: NOW,
    });
    expect(metric(c, 'visualQaScore')?.outcome).toBe('stable');
    expect(c.outcome).toBe('stable');
  });

  it('flags a visual score drop beyond tolerance as degraded', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ visualQaScore: 0.95 }),
      current: record({ visualQaScore: 0.90 }),
      now: NOW,
    });
    expect(metric(c, 'visualQaScore')?.outcome).toBe('degraded');
    expect(c.outcome).toBe('degraded');
  });

  it('flags a visual score rise beyond tolerance as improved', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ visualQaScore: 0.90 }),
      current: record({ visualQaScore: 0.99 }),
      now: NOW,
    });
    expect(metric(c, 'visualQaScore')?.outcome).toBe('improved');
    expect(c.outcome).toBe('improved');
  });

  it('detects a repair score degradation', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ repairFinalScore: 0.96 }),
      current: record({ repairFinalScore: 0.90 }),
      now: NOW,
    });
    expect(metric(c, 'repairFinalScore')?.outcome).toBe('degraded');
    expect(c.outcome).toBe('degraded');
  });

  it('detects an export score degradation', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ exportVsSourceScore: 0.94 }),
      current: record({ exportVsSourceScore: 0.85 }),
      now: NOW,
    });
    expect(metric(c, 'exportVsSourceScore')?.outcome).toBe('degraded');
    expect(c.outcome).toBe('degraded');
  });

  it('degrades when the failure count increases', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ failureCount: 0 }),
      current: record({ failureCount: 2 }),
      now: NOW,
    });
    expect(c.failureCountDelta).toBe(2);
    expect(c.outcome).toBe('degraded');
  });

  it('degrades when the warning count increases by more than two', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ warningCount: 0 }),
      current: record({ warningCount: 3 }),
      now: NOW,
    });
    expect(c.warningCountDelta).toBe(3);
    expect(c.outcome).toBe('degraded');
  });

  it('is improved when one metric improves and nothing degrades', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ visualQaScore: 0.90 }),
      current: record({ visualQaScore: 0.99 }),
      now: NOW,
    });
    expect(c.outcome).toBe('improved');
  });

  it('is stable when nothing changes', () => {
    const c = compareGoldenRunToBaseline({ previous: record(), current: record(), now: NOW });
    expect(c.outcome).toBe('stable');
  });

  it('produces an unknown metric outcome when the current score is missing', () => {
    const c = compareGoldenRunToBaseline({
      previous: record({ visualQaScore: 0.9 }),
      current: record({ visualQaScore: null }),
      now: NOW,
    });
    expect(metric(c, 'visualQaScore')?.outcome).toBe('unknown');
  });

  it('records comparedAt from the provided now', () => {
    const c = compareGoldenRunToBaseline({ previous: record(), current: record(), now: NOW });
    expect(c.comparedAt).toBe('2026-07-05T00:00:00.000Z');
  });

  it('exposes the default score-drop tolerance', () => {
    expect(DEFAULT_GOLDEN_RUN_SCORE_DROP_TOLERANCE).toBe(0.02);
  });
});

describe('rank helpers', () => {
  it('rankQualityGateStatus orders blocked < fail < not_evaluated < warning < pass', () => {
    expect(rankQualityGateStatus('blocked')).toBe(0);
    expect(rankQualityGateStatus('fail')).toBe(1);
    expect(rankQualityGateStatus('not_evaluated')).toBe(2);
    expect(rankQualityGateStatus('warning')).toBe(3);
    expect(rankQualityGateStatus('pass')).toBe(4);
    expect(rankQualityGateStatus('mystery')).toBeNull();
  });

  it('rankOperatorDecision orders rejected < needs_rerun < not_reviewed < accepted_with_warnings < accepted', () => {
    expect(rankOperatorDecision('rejected')).toBe(0);
    expect(rankOperatorDecision('needs_rerun')).toBe(1);
    expect(rankOperatorDecision('not_reviewed')).toBe(2);
    expect(rankOperatorDecision('accepted_with_warnings')).toBe(3);
    expect(rankOperatorDecision('accepted')).toBe(4);
    expect(rankOperatorDecision('mystery')).toBeNull();
  });
});
