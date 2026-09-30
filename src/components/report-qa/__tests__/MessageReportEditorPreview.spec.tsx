/**
 * The export dialog's Preview is the document, in the chosen template.
 *
 * The owner's request (30 Sep 2026, over a screenshot of this dialog in the
 * Dark Executive — Obsidian design): "inject the chosen template so they can
 * see the entirety of how the document's layout will be from a preview
 * perspective", and edit it in the interface before downloading. The Preview
 * tab used to render the editor's Markdown as a web page — a different
 * typeface, no cover, no contents, none of the template — so what was
 * previewed was never what was exported.
 *
 * These drive the dialog as a person would, with the report service and the
 * PDF engine in the browser stood in: what is asked for, what is drawn, and
 * how a page leads back to the words that made it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: h.invoke }));
vi.mock('@/lib/pdf/pdfjs', () => ({ loadPdfjs: async () => ({ getDocument: h.getDocument }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/reportTemplate/templateSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reportTemplate/templateSelection')>();
  return {
    ...actual,
    fetchActiveReportTemplates: async () => ([{
      id: 'tpl-1', name: 'Dark Executive — Obsidian', report_type: 'qa', engine: 'weasyprint', is_active: true,
    }]),
    fetchTemplateSelections: async () => ([{ id: 'sel-1', report_type: 'qa', template_id: 'tpl-1' }]),
  };
});

import { MessageReportEditor } from '../MessageReportEditor';

const ANSWER = [
  '# Investment Property Suburb Shortlist Report',
  '',
  '## 1. Executive Summary',
  '',
  'Three suburbs meet the brief.',
  '',
  '## 2. Suburb Shortlist',
  '',
  'Rouse Hill, Kellyville and Box Hill.',
].join('\n');

/** A three-page document whose bookmarks place the two sections on pages 2 and 3. */
const PAGES = 3;
const OUTLINE = [
  { title: 'Contents', page: 2 },
  { title: 'Executive Summary', page: 2 },
  { title: 'Suburb Shortlist', page: 3 },
];
const fakeDocument = () => ({
  numPages: PAGES,
  getOutline: async () => OUTLINE.map((o) => ({ title: o.title, dest: [{ num: o.page }] })),
  getDestination: async () => null,
  getPageIndex: async (ref: { num: number }) => ref.num - 1,
  getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: () => {},
  }),
  destroy: async () => {},
});

const PREVIEW_ANSWER = {
  preview: true,
  pdf: btoa('%PDF-1.7 preview'),
  fileName: 'Intelligence Hub Summary - Investment Property Suburb Shortlist Report - 30 Sep 2026.pdf',
  bytes: 16,
  pageCount: PAGES,
  brandGaps: [],
  sections: ['Executive Summary', 'Suburb Shortlist'],
  subject: 'answer',
  turnCount: 1,
  turnsShown: 1,
  truncated: false,
  durationMs: 900,
  design: { applied: { label: 'Dark Executive — Obsidian', code: 'de-01', colourway: 'obsidian' } },
};

const previewCalls = () => h.invoke.mock.calls.filter(([fn]) => fn === 'render-report-qa-pdf');

const open = (props: Record<string, unknown> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MessageReportEditor
      isOpen
      onClose={() => {}}
      content={ANSWER}
      messageId="msg-1"
      conversationId="conv-1"
      title="Property Investment Analysis"
      reportNames={[]}
      {...props}
    />
  </QueryClientProvider>,
);

/** Radix tabs change on mouse-down, as a pointer does. */
const openTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });

const original = {
  getContext: HTMLCanvasElement.prototype.getContext,
  toBlob: HTMLCanvasElement.prototype.toBlob,
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

beforeAll(() => {
  // jsdom draws nothing; the page images are stood in by blobs.
  HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback) { cb(new Blob(['png'])); };
  let n = 0;
  URL.createObjectURL = () => `blob:page-${(n += 1)}`;
  URL.revokeObjectURL = () => {};
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = original.getContext;
  HTMLCanvasElement.prototype.toBlob = original.toBlob;
  URL.createObjectURL = original.createObjectURL;
  URL.revokeObjectURL = original.revokeObjectURL;
});

beforeEach(() => {
  cleanup();
  h.invoke.mockReset();
  h.getDocument.mockReset();
  h.getDocument.mockImplementation(() => ({ promise: Promise.resolve(fakeDocument()) }));
  h.invoke.mockImplementation(async (fn: string, body: Record<string, unknown>) => {
    if (fn === 'render-report-qa-pdf') return { data: PREVIEW_ANSWER, error: null };
    return body.operation === 'list' ? { data: { records: [] }, error: null } : { data: {}, error: null };
  });
});

describe('the export dialog\'s Preview', () => {
  it('draws every page of the document in the chosen template, not the text as a web page', async () => {
    open();
    await screen.findByText(/Template: Dark Executive — Obsidian/);
    expect(previewCalls()).toHaveLength(0);

    openTab(/Preview/);
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    expect(previewCalls()[0][1]).toEqual({
      conversationId: 'conv-1',
      subject: 'answer',
      messageId: 'msg-1',
      preview: true,
      draft: null,
      design: { templateId: 'tpl-1' },
    });

    const document = await screen.findByRole('region', { name: 'The document as it will be exported' });
    await waitFor(() => expect(within(document).getAllByRole('img')).toHaveLength(PAGES));
    expect(within(document).getByAltText('Page 1 of 3')).toBeTruthy();
    // The Markdown rendering is not the preview any more.
    expect(screen.queryByLabelText('PDF report preview')).toBeNull();
  });

  it('places each section on its page, from the document\'s own bookmarks', async () => {
    open();
    openTab(/Preview/);
    const sections = await screen.findByRole('navigation', { name: 'Sections' });
    await waitFor(() => expect(within(sections).getByText('p.3')).toBeTruthy());
    expect(within(sections).getByText('p.2')).toBeTruthy();
    expect(within(sections).getByText('Suburb Shortlist')).toBeTruthy();
  });

  /**
   * "The entirety of how the document's layout will be": every page at once,
   * small, so where a section starts and how the pages fill is seen at a
   * glance — and a page chosen there opens where it is.
   */
  it('shows every page at a glance, and opens the one chosen', async () => {
    const scrolledTo: number[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolledTo.push(Number(this.closest('[data-page]')?.getAttribute('data-page')));
    };
    try {
      open();
      openTab(/Preview/);
      const document = await screen.findByRole('region', { name: 'The document as it will be exported' });
      await waitFor(() => expect(within(document).getAllByRole('img')).toHaveLength(PAGES));

      fireEvent.click(screen.getByRole('button', { name: 'Every page at a glance' }));
      expect(screen.getByRole('button', { name: 'Every page at a glance' }).getAttribute('aria-pressed')).toBe('true');
      // Zoom is a property of the page-by-page view.
      expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true);
      const thumbnails = within(document).getAllByRole('button', { name: /^Open page \d of 3$/ });
      expect(thumbnails).toHaveLength(PAGES);

      fireEvent.click(within(document).getByRole('button', { name: 'Open page 3 of 3' }));
      await waitFor(() => expect(scrolledTo).toContain(3));
      expect(screen.getByRole('button', { name: 'Page by page' }).getAttribute('aria-pressed')).toBe('true');
      expect(within(document).getByAltText('Page 3 of 3')).toBeTruthy();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('previews an unsaved edit as it would print, without saving it', async () => {
    open();
    const editor = await screen.findByLabelText('PDF report content editor');
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe(ANSWER));
    const edited = `${ANSWER}\n\nBox Hill carries the most supply risk.`;
    fireEvent.change(editor, { target: { value: edited } });

    openTab(/Preview/);
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    expect(previewCalls()[0][1]).toMatchObject({ preview: true, draft: edited });
    // Nothing was written on the way: a preview is not a save.
    expect(h.invoke.mock.calls.some(([, b]) => (b as { operation?: string }).operation === 'update')).toBe(false);
  });

  it('takes the person from a section to its heading in the editor', async () => {
    open();
    openTab(/Preview/);
    const sections = await screen.findByRole('navigation', { name: 'Sections' });
    fireEvent.click(await within(sections).findByRole('button', { name: 'Edit Suburb Shortlist' }));

    const editor = await screen.findByLabelText('PDF report content editor') as HTMLTextAreaElement;
    await waitFor(() => {
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe('## 2. Suburb Shortlist');
    });
    expect(screen.getByRole('tab', { name: /Edit Content/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('redraws from the editor on Ctrl + Enter', async () => {
    open();
    openTab(/Preview/);
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    openTab(/Edit Content/);
    const editor = await screen.findByLabelText('PDF report content editor');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(previewCalls()).toHaveLength(2));
  });

  it('says what went wrong when the service cannot draw, with the text one click away', async () => {
    h.invoke.mockImplementation(async (fn: string, body: Record<string, unknown>) => {
      if (fn === 'render-report-qa-pdf') return { data: null, error: { message: 'The report service is busy.' } };
      return body.operation === 'list' ? { data: { records: [] }, error: null } : { data: {}, error: null };
    });
    open();
    openTab(/Preview/);
    expect(await screen.findByRole('alert')).toHaveTextContent('The report service is busy.');

    fireEvent.click(screen.getByRole('button', { name: 'Show the text instead' }));
    expect(await screen.findByLabelText('PDF report preview')).toHaveTextContent('Three suburbs meet the brief.');

    fireEvent.click(screen.getByRole('button', { name: 'Back to the preview in your chosen template' }));
    expect(await screen.findByRole('region', { name: 'The document as it will be exported' })).toBeTruthy();
    // Coming back does not ask again by itself: the failure was already shown.
    expect(previewCalls()).toHaveLength(1);
  });

  it('keeps the text preview where there is no conversation for the service to read', async () => {
    open({ conversationId: null });
    openTab(/Preview/);
    expect(await screen.findByLabelText('PDF report preview')).toHaveTextContent('Three suburbs meet the brief.');
    expect(previewCalls()).toHaveLength(0);
  });
});
