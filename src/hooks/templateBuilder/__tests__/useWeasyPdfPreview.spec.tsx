/**
 * Rehaul Phase 3 — render-on-demand PDF preview.
 *
 * Invariants:
 * - nothing renders while the tab is closed,
 * - opening the tab renders exactly once,
 * - edits while open do NOT auto re-render; they flip `stale`,
 * - `refresh()` re-renders and clears `stale`,
 * - a failed render does not auto-retry.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWeasyPdfPreview } from '../useWeasyPdfPreview';
import { makeBlankTemplate, type ReportTemplate } from '@/lib/reportTemplate/templateSchema';

const { renderHtmlToPdfUrl } = vi.hoisted(() => {
  let n = 0;
  return { renderHtmlToPdfUrl: vi.fn(async () => `blob:pdf-${++n}`) };
});

vi.mock('@/lib/reportTemplate/imagePreloader', () => ({
  preloadImages: vi.fn(async (t: unknown) => t),
  // The compiler calls the reporting form, so it can tell a caller which assets
  // it had to leave out rather than carrying an unreachable URL into the render
  // boundary and having the whole document refused for it.
  preloadImagesWithReport: vi.fn(async (t: unknown) => ({ template: t, dropped: [] })),
}));

vi.mock('@/lib/reportTemplate/weasyRenderClient', () => ({
  renderHtmlToPdfUrl,
  pdfFileNameFor: () => 'preview.pdf',
}));

const makeDoc = (label: string): ReportTemplate => ({
  ...makeBlankTemplate(),
  name: label,
}) as ReportTemplate;

const baseArgs = (template: ReportTemplate, enabled: boolean) => ({
  enabled,
  template,
  sampleData: {},
  name: 'Spec template',
  templateId: 'tpl-1',
});

describe('useWeasyPdfPreview', () => {
  beforeEach(() => {
    renderHtmlToPdfUrl.mockClear();
  });

  it('does not render while disabled, renders once when enabled', async () => {
    const doc = makeDoc('a');
    const { result, rerender } = renderHook(
      (props: { enabled: boolean; template: ReportTemplate }) =>
        useWeasyPdfPreview(baseArgs(props.template, props.enabled)),
      { initialProps: { enabled: false, template: doc } },
    );

    expect(renderHtmlToPdfUrl).not.toHaveBeenCalled();
    expect(result.current.previewUrl).toBeNull();

    rerender({ enabled: true, template: doc });
    await waitFor(() => expect(result.current.previewUrl).not.toBeNull());
    expect(renderHtmlToPdfUrl).toHaveBeenCalledTimes(1);
    expect(result.current.stale).toBe(false);
  });

  it('edits flip stale without auto re-rendering; refresh re-renders', async () => {
    const doc = makeDoc('a');
    const { result, rerender } = renderHook(
      (props: { template: ReportTemplate }) => useWeasyPdfPreview(baseArgs(props.template, true)),
      { initialProps: { template: doc } },
    );
    await waitFor(() => expect(result.current.previewUrl).not.toBeNull());
    expect(renderHtmlToPdfUrl).toHaveBeenCalledTimes(1);

    // Simulate an edit: new template object with different content.
    const edited = { ...doc, name: 'b' } as ReportTemplate;
    rerender({ template: edited });
    expect(result.current.stale).toBe(true);
    // Give any (incorrect) auto-render a chance to fire.
    await new Promise((r) => setTimeout(r, 30));
    expect(renderHtmlToPdfUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(renderHtmlToPdfUrl).toHaveBeenCalledTimes(2);
    expect(result.current.stale).toBe(false);
  });

  it('a failed render reports the error and does not retry automatically', async () => {
    renderHtmlToPdfUrl.mockRejectedValueOnce(new Error('edge function down'));
    const doc = makeDoc('a');
    const { result } = renderHook(() => useWeasyPdfPreview(baseArgs(doc, true)));

    await waitFor(() => expect(result.current.previewError).toBe('edge function down'));
    expect(renderHtmlToPdfUrl).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(renderHtmlToPdfUrl).toHaveBeenCalledTimes(1);
    expect(result.current.previewing).toBe(false);
  });
});
