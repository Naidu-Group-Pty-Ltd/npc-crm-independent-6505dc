import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: vi.fn() }));

import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  PDF_IMPORT_CLIENT_REPORT_FUNCTION,
  generatePdfImportClientReportPreview,
  listPdfImportClientReports,
  savePdfImportClientReportDraft,
  updatePdfImportClientReportStatus,
} from '../ingestion/clientReports';

const mockInvoke = invokeSecureFunction as unknown as ReturnType<typeof vi.fn>;

describe('pdfImportClientReportPersistence', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('generate preview invokes generate_preview', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, report: { title: 't' } }, error: null });
    const r = await generatePdfImportClientReportPreview({ reportType: 'import_status_summary', importId: 'imp-1' });
    expect(mockInvoke).toHaveBeenCalledWith(PDF_IMPORT_CLIENT_REPORT_FUNCTION, expect.objectContaining({
      body: expect.objectContaining({ operation: 'generate_preview', report_type: 'import_status_summary', import_id: 'imp-1' }),
    }));
    expect(r.kind).toBe('ok');
  });

  it('save draft invokes save_draft', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, report: { id: 'r1' } }, error: null });
    await savePdfImportClientReportDraft({ title: 't' } as any);
    expect(mockInvoke.mock.calls[0][1].body.operation).toBe('save_draft');
  });

  it('list invokes list_reports with filters', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, reports: [] }, error: null });
    await listPdfImportClientReports({ status: 'approved', audience: 'external_client', reportType: 'import_status_summary', limit: 9999 });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.operation).toBe('list_reports');
    expect(body.status).toBe('approved');
    expect(body.limit).toBeLessThanOrEqual(500);
  });

  it('maps lifecycle actions to operations', async () => {
    const cases: Array<[any, string]> = [
      ['review', 'review_report'],
      ['approve', 'approve_report'],
      ['reject', 'reject_report'],
      ['mark_exported', 'mark_exported'],
      ['supersede', 'supersede_report'],
    ];
    for (const [action, op] of cases) {
      mockInvoke.mockReset();
      mockInvoke.mockResolvedValue({ data: { ok: true, report: { id: 'r1' } }, error: null });
      await updatePdfImportClientReportStatus({ reportId: 'r1', action, note: 'n', exportFormat: 'markdown' });
      expect(mockInvoke.mock.calls[0][1].body).toMatchObject({ operation: op, report_id: 'r1' });
    }
  });

  it('requires a report id', async () => {
    const r = await updatePdfImportClientReportStatus({ reportId: '', action: 'approve' });
    expect(r.kind).toBe('error');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('surfaces edge-function errors', async () => {
    mockInvoke.mockResolvedValue({ data: { error: 'permission denied' }, error: null });
    const r = await generatePdfImportClientReportPreview({ reportType: 'import_status_summary' });
    expect(r.kind).toBe('error');
  });

  it('exposes no send/email/public-link operation', async () => {
    const map = (await import('../ingestion/clientReports')) as Record<string, unknown>;
    const names = Object.keys(map).join(' ').toLowerCase();
    expect(names).not.toContain('sendemail');
    expect(names).not.toContain('publiclink');
    expect(names).not.toContain('publish');
  });
});
