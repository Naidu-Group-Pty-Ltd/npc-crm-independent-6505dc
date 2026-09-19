import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  SELF_HEALING_RETRY_AUDIT_VERSION,
  saveSelfHealingRetryAudit,
  loadSelfHealingRetryAudit,
  buildSelfHealingRetryPlan,
  type SelfHealingRetryAudit,
} from '../ingestion/selfHealing';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: vi.fn() }));

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

function auditFor(): SelfHealingRetryAudit {
  return buildSelfHealingRetryPlan({ importId: 'import-1', snapshot: { importId: 'import-1', importStatus: 'failed' }, now: NOW });
}

beforeEach(() => {
  vi.mocked(invokeSecureFunction).mockReset();
});

describe('saveSelfHealingRetryAudit', () => {
  it('returns error when importId missing', async () => {
    expect((await saveSelfHealingRetryAudit('', auditFor())).kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('returns error when audit missing', async () => {
    expect((await saveSelfHealingRetryAudit('import-1', undefined as any)).kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('calls append_meta and sets persistedAt', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { ok: true }, error: null } as any);
    const res = await saveSelfHealingRetryAudit('import-1', auditFor());
    expect(res.kind).toBe('ok');
    const call = vi.mocked(invokeSecureFunction).mock.calls[0][1] as any;
    expect(call.body.operation).toBe('append_meta');
    expect(call.body.import_id).toBe('import-1');
    expect(call.body.meta_patch.self_healing_retry_audit.persistedAt).toBeTruthy();
  });
  it('maps a backend error to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'forbidden' }, error: null } as any);
    expect((await saveSelfHealingRetryAudit('import-1', auditFor())).kind).toBe('error');
  });
});

describe('loadSelfHealingRetryAudit', () => {
  it('returns error when importId missing', async () => {
    expect((await loadSelfHealingRetryAudit('')).kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('calls get_status', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    await loadSelfHealingRetryAudit('import-1');
    expect(invokeSecureFunction).toHaveBeenCalledWith('template-import-pdf', expect.objectContaining({ body: expect.objectContaining({ operation: 'get_status', import_id: 'import-1' }) }));
  });
  it('returns missing when audit absent', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    expect((await loadSelfHealingRetryAudit('import-1')).kind).toBe('missing');
  });
  it('returns ok when audit present', async () => {
    const a = auditFor();
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: { self_healing_retry_audit: a } } }, error: null } as any);
    const res = await loadSelfHealingRetryAudit('import-1');
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.audit.version).toBe(SELF_HEALING_RETRY_AUDIT_VERSION);
  });
  it('returns error for a wrong version', async () => {
    const a = { ...auditFor(), version: 'old' };
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: { self_healing_retry_audit: a } } }, error: null } as any);
    expect((await loadSelfHealingRetryAudit('import-1')).kind).toBe('error');
  });
});
