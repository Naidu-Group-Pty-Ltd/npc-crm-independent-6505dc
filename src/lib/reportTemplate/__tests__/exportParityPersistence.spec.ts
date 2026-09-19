import { describe, expect, it, vi } from 'vitest';
import {
  buildManualExportParitySummary,
  exportParityPaths,
  loadExportParitySummary,
  saveExportParitySummary,
} from '../ingestion/exportParity';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(),
}));

function summary() {
  return buildManualExportParitySummary({
    importId: 'import_123',
    templateId: 'template_123',
    sourcePageCount: 2,
    editorPageCount: 2,
    exportedPageCount: 2,
    exportVsSourceScore: 0.9,
    now: () => new Date('2026-07-04T00:00:00.000Z'),
  });
}

describe('exportParityPersistence', () => {
  it('exposes the canonical artifact paths', () => {
    expect(exportParityPaths.bucket).toBe('template-import-artifacts');
    expect(exportParityPaths.summary('import_123')).toBe('import_123/export-parity/export-parity.json');
    expect(exportParityPaths.folder('import_123')).toBe('import_123/export-parity');
  });

  it('saves through template-import-pdf with the operation envelope', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { ok: true, summary_path: 'import_123/export-parity/export-parity.json' },
      error: null,
    } as any);

    const result = await saveExportParitySummary('import_123', summary());

    expect(result).toEqual({ kind: 'ok', summaryPath: 'import_123/export-parity/export-parity.json' });
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'save_export_parity',
          import_id: 'import_123',
        }),
      }),
    );
  });

  it('returns error when importId is blank (no network call)', async () => {
    const result = await saveExportParitySummary('', summary());
    expect(result.kind).toBe('error');
  });

  it('maps a backend save rejection to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { error: 'forbidden' },
      error: { message: 'forbidden' },
    } as any);

    const result = await saveExportParitySummary('import_123', summary());
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toContain('forbidden');
  });

  it('loads a persisted summary through template-import-pdf', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: {
        importId: 'import_123',
        summary: summary(),
        artifactPaths: { summary: exportParityPaths.summary('import_123') },
      },
      error: null,
    } as any);

    const result = await loadExportParitySummary('import_123');

    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'get_export_parity',
          import_id: 'import_123',
        }),
      }),
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.summaryPath).toBe('import_123/export-parity/export-parity.json');
      expect(result.payload.exportVsSourceScore).toBe(0.9);
    }
  });

  it('returns kind missing when the backend returns null', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: null, error: null } as any);
    const result = await loadExportParitySummary('import_123');
    expect(result.kind).toBe('missing');
  });

  it('treats an unknown-operation error as missing (backward compatibility)', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { error: 'unknown operation: get_export_parity' },
      error: { message: 'unknown operation: get_export_parity' },
    } as any);

    const result = await loadExportParitySummary('import_123');
    expect(result.kind).toBe('missing');
  });

  it('returns kind error when the response lacks a summary', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { importId: 'import_123' },
      error: null,
    } as any);

    const result = await loadExportParitySummary('import_123');
    expect(result.kind).toBe('error');
  });
});
