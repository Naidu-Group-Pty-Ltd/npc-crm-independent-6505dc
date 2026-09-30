/**
 * The conversation write-up's Preview draws what the editor holds.
 *
 * The write-up is generated in the browser and cached into the conversation
 * in the background, so for a moment — or for good, where the write is
 * refused — the editor holds text the conversation does not. A preview that
 * sent no draft in that moment would draw the stored write-up (an older one,
 * or none) under a dialog showing the new one. So the text goes up as a draft
 * until a write has SAID it is stored, and not after.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  cacheWrite: null as null | ((answer: unknown) => void),
  stored: null as string | null,
}));

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: h.invoke }));
vi.mock('@/lib/pdf/pdfjs', () => ({
  loadPdfjs: async () => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getOutline: async () => null,
        getDestination: async () => null,
        getPageIndex: async () => 0,
        getPage: async () => ({
          getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
          render: () => ({ promise: Promise.resolve() }),
          cleanup: () => {},
        }),
        destroy: async () => {},
      }),
    }),
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/reportTemplate/templateSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reportTemplate/templateSelection')>();
  return {
    ...actual,
    fetchActiveReportTemplates: async () => ([{
      id: 'tpl-1', name: 'Meridian 03', report_type: 'qa', engine: 'weasyprint', is_active: true,
    }]),
    fetchTemplateSelections: async () => ([{ id: 'sel-1', report_type: 'qa', template_id: 'tpl-1' }]),
  };
});

import { ConversationReportEditor } from '../ConversationReportEditor';

const WRITEUP = '# Suburb Shortlist\n\n## Findings\n\nThree suburbs meet the brief.';

const PREVIEW = {
  preview: true, pdf: btoa('%PDF-1.7'), fileName: 'x.pdf', bytes: 8, pageCount: 1, brandGaps: [],
  sections: ['Findings'], subject: 'structured', turnCount: 2, turnsShown: 2, truncated: false, durationMs: 5,
  design: { applied: { label: 'Meridian 03', code: 'mer-03', colourway: null } },
};

const previewDrafts = () => h.invoke.mock.calls
  .filter(([fn]) => fn === 'render-report-qa-pdf')
  .map(([, body]) => (body as { draft: string | null }).draft);

const open = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConversationReportEditor
      isOpen
      onClose={() => {}}
      messages={[
        { role: 'user', content: 'Which suburbs fit the brief?' },
        { role: 'assistant', content: 'Three do.' },
      ]}
      title="Suburb shortlist"
      reportNames={[]}
      conversationId="conv-1"
    />
  </QueryClientProvider>,
);

/** Generating swaps the editor for a spinner and back, so it is found afresh. */
const waitForWriteUp = () => waitFor(() =>
  expect((screen.getByLabelText('Report editor') as HTMLTextAreaElement).value).toBe(WRITEUP));

const openTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });

const original = { getContext: HTMLCanvasElement.prototype.getContext, toBlob: HTMLCanvasElement.prototype.toBlob, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback) { cb(new Blob(['png'])); };
  URL.createObjectURL = () => 'blob:page';
  URL.revokeObjectURL = () => {};
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = original.getContext;
  HTMLCanvasElement.prototype.toBlob = original.toBlob;
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

beforeEach(() => {
  cleanup();
  h.invoke.mockReset();
  h.cacheWrite = null;
  h.stored = null;
  h.invoke.mockImplementation((fn: string, body: Record<string, unknown>) => {
    if (fn === 'render-report-qa-pdf') return Promise.resolve({ data: PREVIEW, error: null });
    if (fn === 'report-qa') return Promise.resolve({ data: { structuredReport: WRITEUP }, error: null });
    if (body.operation === 'list') {
      return Promise.resolve({ data: { records: [{ id: 'conv-1', structured_report: h.stored }] }, error: null });
    }
    // The background cache write answers when the test says so.
    return new Promise((resolve) => { h.cacheWrite = resolve; });
  });
});

describe('the write-up\'s Preview', () => {
  it('draws a freshly generated write-up as a draft until the conversation has it', async () => {
    open();
    await waitForWriteUp();
    expect(h.cacheWrite).not.toBeNull();

    openTab(/Preview/);
    await waitFor(() => expect(previewDrafts()).toEqual([WRITEUP]));

    // Stored now: the same text is the record, and is drawn as the record.
    h.cacheWrite!({ data: {}, error: null });
    openTab(/Edit Report/);
    fireEvent.keyDown(await screen.findByLabelText('Report editor'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(previewDrafts()).toEqual([WRITEUP, null]));
  });

  it('keeps drawing the draft when the conversation refused it', async () => {
    open();
    await waitForWriteUp();
    h.cacheWrite!({ data: null, error: { message: 'permission denied' } });

    openTab(/Preview/);
    await waitFor(() => expect(previewDrafts()).toEqual([WRITEUP]));
  });

  it('draws a stored write-up as the record, with no draft', async () => {
    h.stored = WRITEUP;
    open();
    await waitForWriteUp();
    expect(h.invoke.mock.calls.some(([fn]) => fn === 'report-qa')).toBe(false);

    openTab(/Preview/);
    await waitFor(() => expect(previewDrafts()).toEqual([null]));
  });
});
