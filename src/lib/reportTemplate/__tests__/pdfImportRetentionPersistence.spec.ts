import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: vi.fn() }));

import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  PDF_IMPORT_RETENTION_FUNCTION,
  listPdfImportRetentionEvents,
  runPdfImportRetentionScan,
  updatePdfImportRetentionEventStatus,
} from '../ingestion/retention';

const mockInvoke = invokeSecureFunction as unknown as ReturnType<typeof vi.fn>;

describe('pdfImportRetentionPersistence', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('runs a scan via run_scan', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, result: { events: [] }, persistedCount: 3 }, error: null });
    const res = await runPdfImportRetentionScan();
    expect(mockInvoke).toHaveBeenCalledWith(PDF_IMPORT_RETENTION_FUNCTION, expect.objectContaining({ body: { operation: 'run_scan' } }));
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.persistedCount).toBe(3);
  });

  it('lists via list_events with filters', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, events: [] }, error: null });
    await listPdfImportRetentionEvents({ status: 'candidate', decision: 'delete_candidate', domain: 'storage_orphan', limit: 9999 });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.operation).toBe('list_events');
    expect(body.status).toBe('candidate');
    expect(body.decision).toBe('delete_candidate');
    expect(body.domain).toBe('storage_orphan');
    expect(body.limit).toBeLessThanOrEqual(500);
  });

  it('maps each lifecycle action to its operation', async () => {
    const cases: Array<[any, string]> = [
      ['review', 'review_event'],
      ['approve_for_future_cleanup', 'approve_for_future_cleanup'],
      ['reject', 'reject_event'],
      ['block', 'block_event'],
      ['supersede', 'supersede_event'],
    ];
    for (const [action, op] of cases) {
      mockInvoke.mockReset();
      mockInvoke.mockResolvedValue({ data: { ok: true, event: { id: 'e1' } }, error: null });
      const res = await updatePdfImportRetentionEventStatus({ eventId: 'e1', action, note: 'n' });
      expect(mockInvoke.mock.calls[0][1].body).toMatchObject({ operation: op, event_id: 'e1', note: 'n' });
      expect(res.kind).toBe('ok');
    }
  });

  it('requires an event id', async () => {
    const res = await updatePdfImportRetentionEventStatus({ eventId: '', action: 'review' });
    expect(res.kind).toBe('error');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns error shape on edge-function error', async () => {
    mockInvoke.mockResolvedValue({ data: { error: 'permission denied' }, error: null });
    const res = await runPdfImportRetentionScan();
    expect(res.kind).toBe('error');
  });

  it('exposes no delete operation', async () => {
    const map = (await import('../ingestion/retention')) as Record<string, unknown>;
    const names = Object.keys(map).join(' ').toLowerCase();
    expect(names).not.toContain('deleteretention');
    // the action union has no 'delete' member exercised by the helper
    mockInvoke.mockResolvedValue({ data: { ok: true, event: {} }, error: null });
    const res = await updatePdfImportRetentionEventStatus({ eventId: 'e1', action: 'delete' as never });
    expect(res.kind).toBe('error');
  });
});
