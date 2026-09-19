import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getGoldenRunHistory,
  getLatestGoldenRunBaselines,
  listGoldenRunHistory,
  saveGoldenRunHistory,
  type GoldenRunHistoryInput,
} from '../ingestion/goldenCorpus';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(),
}));

function input(overrides: Partial<GoldenRunHistoryInput> = {}): GoldenRunHistoryInput {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(invokeSecureFunction).mockReset();
});

describe('saveGoldenRunHistory', () => {
  it('returns error without a network call when importId is missing', async () => {
    const res = await saveGoldenRunHistory(input({ importId: '' }));
    expect(res.kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('invokes template-import-pdf with operation save_golden_run_history and import_id + history', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { ok: true, history_id: 'hist-1', history: { id: 'hist-1', runId: 'run-1', corpusId: 'c', importId: 'import-1', qualityGateStatus: 'pass', operatorDecision: 'accepted' } },
      error: null,
    } as any);

    const res = await saveGoldenRunHistory(input());
    expect(res.kind).toBe('ok');
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'save_golden_run_history',
          import_id: 'import-1',
          history: expect.objectContaining({ runId: 'run-1' }),
        }),
      }),
    );
  });

  it('returns kind ok with historyId and a normalized record on success', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { ok: true, history_id: 'hist-1', history: { id: 'hist-1', run_id: 'run-1', corpus_id: 'c', import_id: 'import-1', quality_gate_status: 'pass', operator_decision: 'accepted', visual_qa_score: '0.95' } },
      error: null,
    } as any);
    const res = await saveGoldenRunHistory(input());
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') {
      expect(res.historyId).toBe('hist-1');
      expect(res.history?.visualQaScore).toBe(0.95);
    }
  });

  it('maps a backend rejection to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'forbidden' }, error: null } as any);
    const res = await saveGoldenRunHistory(input());
    expect(res.kind).toBe('error');
  });
});

describe('listGoldenRunHistory', () => {
  it('sends operation list_golden_run_history with filters and limit', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { ok: true, history: [] },
      error: null,
    } as any);
    await listGoldenRunHistory({ corpusId: 'golden-simple-001', importId: 'import-1', limit: 25 });
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'list_golden_run_history',
          corpus_id: 'golden-simple-001',
          import_id: 'import-1',
          limit: 25,
        }),
      }),
    );
  });

  it('normalizes returned rows', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { ok: true, history: [
        { id: 'h1', run_id: 'r1', corpus_id: 'c', import_id: 'i', quality_gate_status: 'pass', operator_decision: 'accepted' },
        { id: 'h2', run_id: 'r2', corpus_id: 'c', import_id: 'i', quality_gate_status: 'warning', operator_decision: 'accepted_with_warnings' },
      ] },
      error: null,
    } as any);
    const res = await listGoldenRunHistory({ corpusId: 'c' });
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.history.map((r) => r.id)).toEqual(['h1', 'h2']);
  });

  it('maps a backend error to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'boom' }, error: null } as any);
    const res = await listGoldenRunHistory({});
    expect(res.kind).toBe('error');
  });
});

describe('getGoldenRunHistory', () => {
  it('sends operation get_golden_run_history', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { ok: true, history: { id: 'hist-1', run_id: 'run-1', corpus_id: 'c', import_id: 'i', quality_gate_status: 'pass', operator_decision: 'accepted' } },
      error: null,
    } as any);
    const res = await getGoldenRunHistory('hist-1');
    expect(res.kind).toBe('ok');
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({ body: expect.objectContaining({ operation: 'get_golden_run_history', history_id: 'hist-1' }) }),
    );
  });

  it('returns missing for a not-found shape', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'not found' }, error: null } as any);
    const res = await getGoldenRunHistory('nope');
    expect(res.kind).toBe('missing');
  });

  it('returns ok for a found row', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { ok: true, history: { id: 'hist-1', run_id: 'run-1', corpus_id: 'c', import_id: 'i', quality_gate_status: 'pass', operator_decision: 'accepted' } },
      error: null,
    } as any);
    const res = await getGoldenRunHistory('hist-1');
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.history.id).toBe('hist-1');
  });

  it('maps a backend error to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'db down' }, error: null } as any);
    const res = await getGoldenRunHistory('hist-1');
    expect(res.kind).toBe('error');
  });
});

describe('getLatestGoldenRunBaselines', () => {
  it('sends operation get_latest_golden_run_baselines with corpus_id', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { ok: true, baselines: [] }, error: null } as any);
    await getLatestGoldenRunBaselines('golden-simple-001');
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({ body: expect.objectContaining({ operation: 'get_latest_golden_run_baselines', corpus_id: 'golden-simple-001' }) }),
    );
  });

  it('normalizes returned baselines', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { ok: true, baselines: [{ id: 'b1', run_id: 'r1', corpus_id: 'c', import_id: 'i', quality_gate_status: 'pass', operator_decision: 'accepted', visual_qa_score: '0.9' }] },
      error: null,
    } as any);
    const res = await getLatestGoldenRunBaselines('c');
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') {
      expect(res.baselines[0].id).toBe('b1');
      expect(res.baselines[0].visualQaScore).toBe(0.9);
    }
  });

  it('maps a backend error to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'boom' }, error: null } as any);
    const res = await getLatestGoldenRunBaselines();
    expect(res.kind).toBe('error');
  });
});
