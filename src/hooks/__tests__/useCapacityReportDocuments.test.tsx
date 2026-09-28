/**
 * What Generate report leaves behind, whichever route drew the document.
 *
 * A Capacity Report drawn through a report template used to leave no
 * `report_generated` event, and no screen re-read the assessment's documents
 * after a render. These pin both: a document the print engine stored through a
 * template is reported to the server for its audit event (and one the browser
 * drew as a stand-in, which nothing stored, is not); and the caller hears the
 * render end whatever happened, because a failed render is a ledger row too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const requestCapacityReport = vi.fn();
const downloadCapacityReport = vi.fn();
const tryTemplateDocument = vi.fn();
const saveTemplateDocument = vi.fn();
const recordTemplateDocument = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/reports/commercialCapacity/requestCapacityReport', () => ({
  requestCapacityReport: (...args: unknown[]) => requestCapacityReport(...args),
  downloadCapacityReport: (...args: unknown[]) => downloadCapacityReport(...args),
}));
vi.mock('@/lib/reportTemplate/templateDocument', () => ({
  tryTemplateDocument: (...args: unknown[]) => tryTemplateDocument(...args),
  saveTemplateDocument: (...args: unknown[]) => saveTemplateDocument(...args),
  hasTemplateSelection: vi.fn(async () => false),
  notifySelectionNotUsed: vi.fn(),
}));
vi.mock('@/hooks/useCiAssessments', () => ({
  ciAssessmentApi: { recordTemplateDocument: (...args: unknown[]) => recordTemplateDocument(...args) },
}));
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));

const { useCapacityReport } = await import('@/hooks/useCapacityReport');

const TEMPLATED = {
  blob: new Blob(['%PDF']),
  fileName: 'commercial_capacity-CI-1-11111111.pdf',
  templateId: 'tpl-1',
  renderer: 'weasyprint_final',
  storagePath: 'template-builder/2026-09-23/abc-commercial_capacity-CI-1.pdf',
  degradedFrom: null,
};

beforeEach(() => {
  requestCapacityReport.mockReset().mockResolvedValue({
    url: 'https://example.test/signed', fileName: 'Commercial_Capacity_Report_CI_1.pdf', bytes: 1, pageCount: 9,
    brandGaps: [], hasAnalysis: true, analysisNote: null,
  });
  downloadCapacityReport.mockReset().mockResolvedValue(undefined);
  tryTemplateDocument.mockReset().mockResolvedValue(null);
  saveTemplateDocument.mockReset();
  recordTemplateDocument.mockReset().mockResolvedValue({ data: { recorded: true }, error: null });
  toast.mockReset();
});

afterEach(cleanup);

describe('a document drawn through a report template', () => {
  it('is reported for its audit event, by the path the print engine stored it at', async () => {
    tryTemplateDocument.mockResolvedValue(TEMPLATED);
    const { result } = renderHook(() => useCapacityReport());
    await act(() => result.current.generate('a1'));

    expect(saveTemplateDocument).toHaveBeenCalledWith(TEMPLATED);
    expect(recordTemplateDocument).toHaveBeenCalledWith({ assessmentId: 'a1', storagePath: TEMPLATED.storagePath });
    expect(requestCapacityReport).not.toHaveBeenCalled();
  });

  it('is not reported when the browser drew it and nothing stored it', async () => {
    tryTemplateDocument.mockResolvedValue({ ...TEMPLATED, storagePath: null, renderer: 'browser_template_jspdf' });
    const { result } = renderHook(() => useCapacityReport());
    await act(() => result.current.generate('a1'));

    expect(saveTemplateDocument).toHaveBeenCalled();
    expect(recordTemplateDocument).not.toHaveBeenCalled();
  });

  it('still hands over the document when the record cannot be written', async () => {
    tryTemplateDocument.mockResolvedValue(TEMPLATED);
    recordTemplateDocument.mockResolvedValue({ data: null, error: 'Assessment request failed' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useCapacityReport());
    await act(() => result.current.generate('a1'));

    expect(saveTemplateDocument).toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Capacity report ready' }));
    warn.mockRestore();
  });
});

describe('the end of a render', () => {
  it('is announced after a document arrives', async () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useCapacityReport({ onFinished }));
    await act(() => result.current.generate('a1'));
    expect(onFinished).toHaveBeenCalledWith('a1');
  });

  it('is announced after a failure too — a failed render is a ledger row', async () => {
    requestCapacityReport.mockRejectedValue(new Error('WeasyPrint is not configured'));
    const onFinished = vi.fn();
    const { result } = renderHook(() => useCapacityReport({ onFinished }));
    await act(() => result.current.generate('a1'));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'destructive' }));
    expect(onFinished).toHaveBeenCalledWith('a1');
  });
});
