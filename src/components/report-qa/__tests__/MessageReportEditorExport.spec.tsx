/**
 * The Intelligence Hub's export dialog: choose a template, then export in it.
 *
 * The owner's report (28 Sep 2026): the dialog offered "Typeset PDF" beside
 * "Export PDF", and Export PDF "should export the chosen template, however
 * it's generating it in the old legacy format". Both halves were true — Export
 * PDF was the in-browser jsPDF layout and never read the choice. So the choice
 * is its own control ("Choose template"), and Export PDF is the typeset route,
 * in that choice, over the answer as edited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  deliver: vi.fn(),
  invoke: vi.fn(),
  jspdf: vi.fn(),
}));

vi.mock('@/lib/reports/reportQa/deliverReportQaPdf', () => ({ deliverReportQaPdf: h.deliver }));
vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: h.invoke }));
vi.mock('jspdf', () => ({ default: h.jspdf }));
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

import { MessageReportEditor } from '../MessageReportEditor';

const ANSWER = '# Investment Property Suburb Shortlist Report\n\n## 1. Executive recommendation\n\nText.';

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

beforeEach(() => {
  cleanup();
  h.deliver.mockReset();
  h.invoke.mockReset();
  h.jspdf.mockReset();
  // No stored edit: the dialog opens on the answer as written.
  h.invoke.mockImplementation(async (_fn: string, body: Record<string, unknown>) =>
    body.operation === 'list' ? { data: { records: [] }, error: null } : { data: {}, error: null });
  h.deliver.mockResolvedValue({
    fileName: 'Intelligence Hub Summary - Investment Property Suburb Shortlist Report - 28 Sep 2026.pdf',
    pageCount: 8, brandGaps: [], sections: [], subject: 'answer', turnCount: 1, turnsShown: 1,
    truncated: false, generated: false, attachment: null, blob: new Blob(['%PDF']),
  });
});

describe('the export dialog', () => {
  it('offers "Choose template" and no second PDF button', async () => {
    open();
    expect(await screen.findByRole('button', { name: /Choose template/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Typeset PDF/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /PDF/ }).map((b) => b.textContent?.trim()))
      .toEqual(['Export PDF']);
  });

  it('says which template the export will use', async () => {
    open();
    expect(await screen.findByText(/Template: Meridian 03/)).toBeTruthy();
  });

  it('exports the answer through the typeset route, never the in-browser layout', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(h.deliver).toHaveBeenCalledTimes(1));
    expect(h.deliver).toHaveBeenCalledWith('conv-1', 'answer', expect.objectContaining({
      messageId: 'msg-1',
      save: true,
      attachToConversation: false,
    }));
    expect(h.jspdf).not.toHaveBeenCalled();
  });

  it('stores the edits before the route reads them, and stops if they were not stored', async () => {
    open();
    const editor = await screen.findByLabelText('PDF report content editor');
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe(ANSWER));
    fireEvent.change(editor, { target: { value: `${ANSWER}\n\nEdited.` } });

    // The write is refused: nothing is exported, because the route would print
    // the words the person just replaced.
    h.invoke.mockImplementation(async (_fn: string, body: Record<string, unknown>) =>
      body.operation === 'update'
        ? { data: null, error: { message: 'permission denied' } }
        : { data: { records: [] }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('manage-client-data', expect.objectContaining({
      operation: 'update', table: 'report_qa_messages', id: 'msg-1',
    })));
    expect(h.deliver).not.toHaveBeenCalled();

    // Stored: the export follows, in that order.
    h.invoke.mockImplementation(async () => ({ data: {}, error: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(h.deliver).toHaveBeenCalledTimes(1));
    const updateCall = h.invoke.mock.calls.findIndex(([, b]) => (b as { operation?: string }).operation === 'update');
    expect(updateCall).toBeGreaterThanOrEqual(0);
  });

  it('keeps the in-browser layout only where there is no conversation for the route to read', async () => {
    open({ conversationId: null });
    expect(screen.queryByRole('button', { name: /Choose template/ })).toBeNull();
  });
});
