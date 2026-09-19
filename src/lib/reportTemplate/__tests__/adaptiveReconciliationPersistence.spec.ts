import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ADAPTIVE_RECONCILIATION_POLICY_VERSION,
  saveAdaptiveReconciliationPolicy,
  loadAdaptiveReconciliationPolicy,
  buildAdaptiveReconciliationPolicy,
  type AdaptiveReconciliationPolicy,
} from '../ingestion/reconciliation';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(),
}));

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

function policy(): AdaptiveReconciliationPolicy {
  return buildAdaptiveReconciliationPolicy({
    importId: 'import-1',
    importIntelligenceProfile: { profileCategory: 'table_heavy', riskLevel: 'medium', scores: { tableRiskScore: 0.9 } },
    repairPatternAnalysis: { primaryPatternId: 'table_grid_drift', aiReconciliationUsefulness: 'high' },
    snapshot: { importId: 'import-1', visualQaScore: 0.8 },
    now: NOW,
  });
}

beforeEach(() => {
  vi.mocked(invokeSecureFunction).mockReset();
});

describe('saveAdaptiveReconciliationPolicy', () => {
  it('returns error when importId missing', async () => {
    const res = await saveAdaptiveReconciliationPolicy('', policy());
    expect(res.kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('returns error when policy missing', async () => {
    const res = await saveAdaptiveReconciliationPolicy('import-1', undefined as any);
    expect(res.kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('calls template-import-pdf append_meta with the policy', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { ok: true }, error: null } as any);
    const p = policy();
    const res = await saveAdaptiveReconciliationPolicy('import-1', p);
    expect(res.kind).toBe('ok');
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'append_meta',
          import_id: 'import-1',
          meta_patch: expect.objectContaining({ adaptive_reconciliation_policy: p }),
        }),
      }),
    );
  });
  it('maps a backend error to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'forbidden' }, error: null } as any);
    expect((await saveAdaptiveReconciliationPolicy('import-1', policy())).kind).toBe('error');
  });
});

describe('loadAdaptiveReconciliationPolicy', () => {
  it('returns error when importId missing', async () => {
    expect((await loadAdaptiveReconciliationPolicy('')).kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('calls get_status', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    await loadAdaptiveReconciliationPolicy('import-1');
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({ body: expect.objectContaining({ operation: 'get_status', import_id: 'import-1' }) }),
    );
  });
  it('returns missing when policy absent', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    expect((await loadAdaptiveReconciliationPolicy('import-1')).kind).toBe('missing');
  });
  it('returns ok when policy present', async () => {
    const p = policy();
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: { adaptive_reconciliation_policy: p } } }, error: null } as any);
    const res = await loadAdaptiveReconciliationPolicy('import-1');
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.policy.version).toBe(ADAPTIVE_RECONCILIATION_POLICY_VERSION);
  });
  it('returns error for a wrong version', async () => {
    const p = { ...policy(), version: 'old' };
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: { adaptive_reconciliation_policy: p } } }, error: null } as any);
    expect((await loadAdaptiveReconciliationPolicy('import-1')).kind).toBe('error');
  });
});
