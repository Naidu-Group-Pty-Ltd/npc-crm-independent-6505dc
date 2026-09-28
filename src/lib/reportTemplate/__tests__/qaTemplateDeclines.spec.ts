/**
 * Report Q&A: every subject is drawn by the route that knows which answer it
 * is, and "Add to this chat" says what actually happened (26 Sep 2026).
 *
 * Two defects, both found by rendering one conversation through both paths:
 *
 *   - **The chosen answer was not the answer printed.** Every content page of
 *     the Q&A masters draws `qa.answer`, and the adapter is never told WHICH
 *     answer, so it filled that slot with the conversation's FIRST reply. "This
 *     answer" printed the first answer whichever one was chosen, and the
 *     "transcript" carried the first answer and none of the others. The
 *     structured write-up already declined for the same reason
 *     (`qaStructuredNotTemplated.spec.ts`); now all three do, and
 *     `render-report-qa-pdf`, which is addressed by message, draws them.
 *   - **"Add to this chat" reported success over a chat that received
 *     nothing.** Only the route writes the attachment row. The templated branch
 *     answered `attachment: null` and the caller took that as attached.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  templateCalls: [] as Array<[string, string, unknown]>,
  routeCalls: [] as Array<[string, string, Record<string, unknown>]>,
  routeAttachment: null as null | { messageId: string; name: string; url: string; size: number },
  saved: [] as string[],
  toasts: [] as Array<[string, string]>,
}));

// ── The adapter, over a conversation with two answers ──────────────────────
// Real-shaped ids: the document builder refuses one that is not a uuid.
const CONV = '4b1c0e2a-8d1f-4c3e-9a2b-5f6d7e8a9b10';
const conversation = {
  id: CONV, title: 'Q&A: two questions', report_names: ['fixture.pdf'],
  structured_report: null, created_at: '2026-09-01T00:00:00Z',
};
const messages = [
  { id: '0a1b2c3d-0000-4000-8000-000000000001', role: 'user', content: 'What is the yield?', created_at: '2026-09-01T00:00:01Z' },
  { id: '0a1b2c3d-0000-4000-8000-000000000002', role: 'assistant', content: 'The FIRST answer.', created_at: '2026-09-01T00:00:02Z' },
  { id: '0a1b2c3d-0000-4000-8000-000000000003', role: 'user', content: 'And the vacancy rate?', created_at: '2026-09-01T00:00:03Z' },
  { id: '0a1b2c3d-0000-4000-8000-000000000004', role: 'assistant', content: 'The SECOND answer.', created_at: '2026-09-01T00:00:04Z' },
];

function builder(table: string) {
  const result = table === 'report_qa_messages'
    ? { data: messages, count: messages.filter((m) => m.role === 'assistant').length, error: null }
    : { data: [conversation], count: 1, error: null };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve({ data: conversation, error: null });
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return b;
}
vi.mock('@/hooks/useAuthenticatedSupabase', () => ({
  getAuthenticatedSupabaseClient: () => ({ from: (table: string) => builder(table) }),
}));

// The organisation read is not what this file is about.
vi.mock('@/lib/reportTemplate/adapters/organisation', () => ({
  applyOrganisationAndBrand: async (data: Record<string, unknown>) => data,
}));

// ── The delivery path, with the template route and the flowing route doubled ─
vi.mock('@/lib/reportTemplate/templateDocument', () => ({
  tryTemplateDocument: async (reportType: string, id: string, opts: unknown) => {
    h.templateCalls.push([reportType, id, opts]);
    return null;
  },
  saveTemplateDocument: (doc: { fileName: string }) => { h.saved.push(doc.fileName); },
}));

vi.mock('@/lib/reports/reportQa/requestReportQaPdf', () => ({
  requestReportQaPdf: async (id: string, subject: string, options: Record<string, unknown>) => {
    h.routeCalls.push([id, subject, options]);
    return {
      url: 'https://storage.example/qa.pdf', fileName: 'Q_and_A.pdf', bytes: 10, pageCount: 3,
      brandGaps: [], sections: [], subject, turnCount: 2, turnsShown: 2,
      truncated: false, generated: false, attachment: h.routeAttachment,
    };
  },
}));

vi.mock('sonner', () => {
  const record = (kind: string) => (title: string) => { h.toasts.push([kind, title]); };
  return {
    toast: Object.assign(record('default'), {
      info: record('info'), warning: record('warning'), error: record('error'), success: record('success'),
    }),
  };
});

const { qaAdapter } = await import('../adapters/qaAdapter');
const { deliverReportQaPdf } = await import('@/lib/reports/reportQa/deliverReportQaPdf');
const { useReportQaDelivery } = await import('@/components/report-qa/useReportQaDelivery');

beforeEach(() => {
  h.templateCalls = [];
  h.routeCalls = [];
  h.routeAttachment = null;
  h.saved = [];
  h.toasts = [];
  // The signed URL the route answers with, fetched back for its bytes.
  vi.stubGlobal('fetch', async () => ({
    ok: true, status: 200, blob: async () => new Blob(['%PDF-1.7 route'], { type: 'application/pdf' }),
  }));
  // The browser save the flowing branch performs.
  URL.createObjectURL = () => 'blob:qa';
  URL.revokeObjectURL = () => {};
});

describe('the template path for Report Q&A', () => {
  it('declines every subject, so the route that is addressed by message draws it', async () => {
    for (const variant of ['answer', 'transcript', 'structured', null]) {
      const routing = await qaAdapter.resolveRoutingContext({ reportId: CONV, variant });
      expect(routing, String(variant)).toBeNull();
    }
  });

  it('declines for the reason measured: its binding cannot be told which answer was chosen', async () => {
    // Asked for "an answer" on a conversation of two, the binding fills the
    // slot with the FIRST reply. That is the defect; declining is the repair.
    const ctx = await qaAdapter.buildBindingContext({ reportId: CONV, variant: 'answer' });
    const qa = (ctx?.data as { qa?: { answer?: string } }).qa;
    expect(qa?.answer).toBe('The FIRST answer.');
  });
});

describe('delivering a Report Q&A document', () => {
  it('asks the template path when the document is for download', async () => {
    await deliverReportQaPdf(CONV, 'answer', { messageId: '0a1b2c3d-0000-4000-8000-000000000004', save: false });
    expect(h.templateCalls).toHaveLength(1);
    expect(h.routeCalls[0]).toEqual([CONV, 'answer', expect.objectContaining({ messageId: '0a1b2c3d-0000-4000-8000-000000000004' })]);
  });

  it('never asks the template path when the document is to be added to the chat', async () => {
    h.routeAttachment = { messageId: 'att-1', name: 'Q_and_A.pdf', url: 'https://x', size: 10 };
    const result = await deliverReportQaPdf(CONV, 'transcript', {
      attachToConversation: true, save: false,
    });
    expect(h.templateCalls).toEqual([]);
    expect(h.routeCalls[0][2]).toMatchObject({ attachToConversation: true });
    expect(result.attachment?.messageId).toBe('att-1');
  });
});

describe('"Add to this chat"', () => {
  it('says it was added only when the route says a message now carries it', async () => {
    h.routeAttachment = { messageId: 'att-1', name: 'Q_and_A.pdf', url: 'https://x', size: 10 };
    const onAttached = vi.fn();
    const { result } = renderHook(() => useReportQaDelivery({ conversationId: CONV, onAttached }));
    await act(async () => { await result.current.run('transcript', { attach: true }); });
    expect(onAttached).toHaveBeenCalledTimes(1);
    expect(h.saved).toEqual([]);
    expect(h.toasts.map(([kind]) => kind)).toEqual(['success']);
  });

  it('keeps the file and says so when the chat message could not be written', async () => {
    h.routeAttachment = null;
    const onAttached = vi.fn();
    const { result } = renderHook(() => useReportQaDelivery({ conversationId: CONV, onAttached }));
    await act(async () => { await result.current.run('transcript', { attach: true }); });
    expect(onAttached).not.toHaveBeenCalled();
    expect(h.saved).toEqual(['Q_and_A.pdf']);
    expect(h.toasts).toEqual([['warning', 'The document could not be added to this chat']]);
  });
});
