import { describe, expect, it, vi } from 'vitest';
import {
  GOLDEN_REGRESSION_META_KEY,
  loadGoldenRegressionSummary,
  saveGoldenRegressionSummary,
  type GoldenRegressionSummary,
} from '../ingestion/goldenCorpus';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(),
}));

function summary(overrides: Partial<GoldenRegressionSummary> = {}): GoldenRegressionSummary {
  return {
    version: 'pdf-import-golden-regression-summary-v1',
    runId: 'run-1',
    runBatchId: null,
    corpusId: 'golden-simple-001',
    category: 'simple_one_page',
    importId: 'imp-1',
    templateId: 'tpl-1',
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
    editorVsSourceScore: null,
    exportVsEditorScore: null,
    qualityGateStatus: 'pass',
    gateSummary: { total: 16, pass: 16, warning: 0, fail: 0, blocked: 0, notEvaluated: 0 },
    warnings: [],
    failures: [],
    operatorDecision: 'accepted',
    notes: [],
    generatedAt: '2026-07-04T00:00:00.000Z',
    persistedAt: null,
    ...overrides,
  };
}

describe('saveGoldenRegressionSummary', () => {
  it('returns error when importId is missing (no network call)', async () => {
    const result = await saveGoldenRegressionSummary('', summary());
    expect(result.kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('returns error when the summary is missing', async () => {
    const result = await saveGoldenRegressionSummary('imp-1', undefined as any);
    expect(result.kind).toBe('error');
  });

  it('sends operation append_meta with a golden_regression_summary patch that has persistedAt set', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { ok: true }, error: null } as any);

    const result = await saveGoldenRegressionSummary('imp-1', summary());
    expect(result).toEqual({ kind: 'ok' });

    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'append_meta',
          import_id: 'imp-1',
          meta_patch: expect.objectContaining({
            [GOLDEN_REGRESSION_META_KEY]: expect.objectContaining({ persistedAt: expect.any(String) }),
          }),
        }),
      }),
    );
  });

  it('returns kind error when the backend rejects the save', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { error: 'forbidden' },
      error: { message: 'forbidden' },
    } as any);

    const result = await saveGoldenRegressionSummary('imp-1', summary());
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toContain('forbidden');
  });

  it('returns kind error when append_meta does not return ok', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: {}, error: null } as any);
    const result = await saveGoldenRegressionSummary('imp-1', summary());
    expect(result.kind).toBe('error');
  });
});

describe('loadGoldenRegressionSummary', () => {
  it('sends operation get_status', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { record: { meta: { [GOLDEN_REGRESSION_META_KEY]: summary({ persistedAt: '2026-07-04T01:00:00.000Z' }) } } },
      error: null,
    } as any);

    await loadGoldenRegressionSummary('imp-1');

    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({ operation: 'get_status', import_id: 'imp-1' }),
      }),
    );
  });

  it('returns missing when the meta has no golden_regression_summary', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { record: { meta: { something_else: true } } },
      error: null,
    } as any);
    const result = await loadGoldenRegressionSummary('imp-1');
    expect(result.kind).toBe('missing');
  });

  it('returns ok with the summary when present', async () => {
    const persistedSummary = summary({ persistedAt: '2026-07-04T01:00:00.000Z' });
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { record: { meta: { [GOLDEN_REGRESSION_META_KEY]: persistedSummary } } },
      error: null,
    } as any);

    const result = await loadGoldenRegressionSummary('imp-1');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.summary.corpusId).toBe('golden-simple-001');
      expect(result.summary.persistedAt).toBe('2026-07-04T01:00:00.000Z');
    }
  });

  it('returns error when the loaded summary has an invalid/missing version', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { record: { meta: { [GOLDEN_REGRESSION_META_KEY]: { ...summary(), version: 'bogus' } } } },
      error: null,
    } as any);
    const result = await loadGoldenRegressionSummary('imp-1');
    expect(result.kind).toBe('error');
  });

  it('returns error on a backend error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: null,
      error: { message: 'boom' },
    } as any);
    const result = await loadGoldenRegressionSummary('imp-1');
    expect(result.kind).toBe('error');
  });

  it('returns missing when the record is not found', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { error: 'Import record not found' },
      error: { message: 'Import record not found' },
    } as any);
    const result = await loadGoldenRegressionSummary('imp-1');
    expect(result.kind).toBe('missing');
  });
});
