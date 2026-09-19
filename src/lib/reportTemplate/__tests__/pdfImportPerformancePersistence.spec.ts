import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  PDF_IMPORT_PERFORMANCE_AUDIT_VERSION,
  savePdfImportPerformanceAudit,
  loadPdfImportPerformanceAudit,
  buildPdfImportPerformanceCostAudit,
  type PdfImportPerformanceCostAudit,
} from '../ingestion/performance';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: vi.fn() }));

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

function auditFor(): PdfImportPerformanceCostAudit {
  return buildPdfImportPerformanceCostAudit({ snapshot: { importId: 'import-1', importStatus: 'completed' }, now: NOW });
}

beforeEach(() => {
  vi.mocked(invokeSecureFunction).mockReset();
});

describe('savePdfImportPerformanceAudit', () => {
  it('returns error when importId missing', async () => {
    expect((await savePdfImportPerformanceAudit('', auditFor())).kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('returns error when audit missing', async () => {
    expect((await savePdfImportPerformanceAudit('import-1', undefined as any)).kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('calls append_meta and sets persistedAt', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { ok: true }, error: null } as any);
    const res = await savePdfImportPerformanceAudit('import-1', auditFor());
    expect(res.kind).toBe('ok');
    const call = vi.mocked(invokeSecureFunction).mock.calls[0][1] as any;
    expect(call.body.operation).toBe('append_meta');
    expect(call.body.import_id).toBe('import-1');
    expect(call.body.meta_patch.performance_cost_audit.persistedAt).toBeTruthy();
  });
  it('maps a backend error to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'forbidden' }, error: null } as any);
    expect((await savePdfImportPerformanceAudit('import-1', auditFor())).kind).toBe('error');
  });
});

describe('loadPdfImportPerformanceAudit', () => {
  it('returns error when importId missing', async () => {
    expect((await loadPdfImportPerformanceAudit('')).kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
  it('calls get_status', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    await loadPdfImportPerformanceAudit('import-1');
    expect(invokeSecureFunction).toHaveBeenCalledWith('template-import-pdf', expect.objectContaining({ body: expect.objectContaining({ operation: 'get_status', import_id: 'import-1' }) }));
  });
  it('returns missing when audit absent', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    expect((await loadPdfImportPerformanceAudit('import-1')).kind).toBe('missing');
  });
  it('returns ok when audit present', async () => {
    const a = auditFor();
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: { performance_cost_audit: a } } }, error: null } as any);
    const res = await loadPdfImportPerformanceAudit('import-1');
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.audit.version).toBe(PDF_IMPORT_PERFORMANCE_AUDIT_VERSION);
  });
  it('returns error for a wrong version', async () => {
    const a = { ...auditFor(), version: 'old' };
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: { performance_cost_audit: a } } }, error: null } as any);
    expect((await loadPdfImportPerformanceAudit('import-1')).kind).toBe('error');
  });
});
