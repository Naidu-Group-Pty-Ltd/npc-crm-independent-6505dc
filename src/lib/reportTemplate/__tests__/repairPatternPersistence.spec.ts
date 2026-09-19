import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  REPAIR_PATTERN_ANALYSIS_VERSION,
  saveRepairPatternAnalysis,
  loadRepairPatternAnalysis,
  buildRepairPatternAnalysis,
  type RepairPatternAnalysis,
} from '../ingestion/repairPatterns';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(),
}));

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

function analysis(): RepairPatternAnalysis {
  return buildRepairPatternAnalysis({
    importId: 'import-1',
    importIntelligenceProfile: { profileCategory: 'table_heavy', riskLevel: 'high', scores: { tableRiskScore: 0.9 } },
    snapshot: { importId: 'import-1', visualQaScore: 0.8, exportVsSourceScore: 0.8 },
    now: NOW,
  });
}

beforeEach(() => {
  vi.mocked(invokeSecureFunction).mockReset();
});

describe('saveRepairPatternAnalysis', () => {
  it('returns error when importId missing', async () => {
    const res = await saveRepairPatternAnalysis('', analysis());
    expect(res.kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('returns error when analysis missing', async () => {
    const res = await saveRepairPatternAnalysis('import-1', undefined as any);
    expect(res.kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('calls template-import-pdf append_meta with the analysis', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { ok: true }, error: null } as any);
    const a = analysis();
    const res = await saveRepairPatternAnalysis('import-1', a);
    expect(res.kind).toBe('ok');
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'append_meta',
          import_id: 'import-1',
          meta_patch: expect.objectContaining({ repair_pattern_analysis: a }),
        }),
      }),
    );
  });
  it('maps a backend error to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'forbidden' }, error: null } as any);
    expect((await saveRepairPatternAnalysis('import-1', analysis())).kind).toBe('error');
  });
});

describe('loadRepairPatternAnalysis', () => {
  it('returns error when importId missing', async () => {
    expect((await loadRepairPatternAnalysis('')).kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('calls get_status', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    await loadRepairPatternAnalysis('import-1');
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({ body: expect.objectContaining({ operation: 'get_status', import_id: 'import-1' }) }),
    );
  });
  it('returns missing when analysis absent', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    expect((await loadRepairPatternAnalysis('import-1')).kind).toBe('missing');
  });
  it('returns ok when analysis present', async () => {
    const a = analysis();
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: { repair_pattern_analysis: a } } }, error: null } as any);
    const res = await loadRepairPatternAnalysis('import-1');
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.analysis.version).toBe(REPAIR_PATTERN_ANALYSIS_VERSION);
  });
  it('returns error for a wrong version', async () => {
    const a = { ...analysis(), version: 'old' };
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: { repair_pattern_analysis: a } } }, error: null } as any);
    expect((await loadRepairPatternAnalysis('import-1')).kind).toBe('error');
  });
});
