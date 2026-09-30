/**
 * What the export dialog's Preview asks the report service for, and what it
 * makes of the answer.
 *
 * The owner's request (30 Sep 2026): see the whole document in the chosen
 * template, and edit it, before downloading. So the preview asks the SAME
 * route the export asks, with the SAME design resolution (`standardDesignFor`,
 * the person's own choice for the Hub format), and marks the request a
 * preview — which is what makes the route keep nothing — carrying the editor's
 * text only when it is an edit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  selections: vi.fn(),
}));

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: h.invoke }));
vi.mock('@/lib/reportTemplate/templateSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reportTemplate/templateSelection')>();
  return { ...actual, fetchTemplateSelections: h.selections };
});

const { requestReportQaPreview, PREVIEW_UNSUPPORTED_MESSAGE, pdfFromBase64 } = await import('../requestReportQaPdf');

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00, 0x80]);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const answered = (over: Record<string, unknown> = {}) => ({
  data: {
    preview: true,
    pdf: base64(PDF),
    fileName: 'Intelligence Hub Summary - Suburb Shortlist - 30 Sep 2026.pdf',
    bytes: PDF.length,
    pageCount: 9,
    brandGaps: [],
    sections: ['Executive Summary', 'Suburb Shortlist'],
    subject: 'answer',
    turnCount: 1,
    turnsShown: 1,
    truncated: false,
    durationMs: 812,
    design: { applied: { label: 'Dark Executive — Obsidian', code: 'de-01', colourway: 'obsidian' } },
    ...over,
  },
  error: null,
});

beforeEach(() => {
  h.invoke.mockReset();
  h.selections.mockReset();
  h.selections.mockResolvedValue([{ id: 'sel-1', report_type: 'qa', template_id: 'tpl-obsidian' }]);
});

describe('requestReportQaPreview', () => {
  it('asks the export\'s own route, in the person\'s chosen template, and marks it a preview', async () => {
    h.invoke.mockResolvedValue(answered());
    await requestReportQaPreview('conv-1', 'answer', { messageId: 'msg-1' });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    const [fn, body, opts] = h.invoke.mock.calls[0];
    expect(fn).toBe('render-report-qa-pdf');
    expect(body).toEqual({
      conversationId: 'conv-1',
      subject: 'answer',
      messageId: 'msg-1',
      preview: true,
      draft: null,
      design: { templateId: 'tpl-obsidian' },
    });
    expect(opts).toEqual({ timeoutMs: 120_000 });
  });

  it('carries a draft only when given one, and sends no design where none is chosen', async () => {
    h.invoke.mockResolvedValue(answered({ design: undefined }));
    h.selections.mockResolvedValue([]);
    const result = await requestReportQaPreview('conv-1', 'structured', { draft: '# Edited\n\nWords.' });
    const body = h.invoke.mock.calls[0][1];
    expect(body.draft).toBe('# Edited\n\nWords.');
    expect(body.subject).toBe('structured');
    expect('design' in body).toBe(false);
    expect(result.design.outcome).toBe('none');
  });

  it('hands back the drawn document byte for byte, with what the route said about it', async () => {
    h.invoke.mockResolvedValue(answered());
    const result = await requestReportQaPreview('conv-1', 'answer', { messageId: 'msg-1' });
    expect(result.pdf).toEqual(PDF);
    expect(result.pageCount).toBe(9);
    expect(result.sections).toEqual(['Executive Summary', 'Suburb Shortlist']);
    expect(result.design).toEqual({ outcome: 'applied', label: 'Dark Executive — Obsidian', message: null });
  });

  it('says so when the chosen template was not used, in the route\'s own words', async () => {
    h.invoke.mockResolvedValue(answered({
      design: { refusal: 'template_unavailable', message: 'That template has been retired.' },
    }));
    const result = await requestReportQaPreview('conv-1', 'answer', { messageId: 'msg-1' });
    expect(result.design).toEqual({ outcome: 'refused', label: null, message: 'That template has been retired.' });
  });

  /**
   * A route deployed before previews ignores `preview` and makes an ordinary
   * export of the STORED record. Showing that as the preview would present
   * the words the person replaced as the words they typed.
   */
  it('refuses to show an older route\'s ordinary export as the preview', async () => {
    h.invoke.mockResolvedValue({
      data: { url: 'https://signed.example/x.pdf', fileName: 'x.pdf', bytes: 10, pageCount: 3 },
      error: null,
    });
    await expect(requestReportQaPreview('conv-1', 'answer', { messageId: 'msg-1' }))
      .rejects.toThrow(PREVIEW_UNSUPPORTED_MESSAGE);
  });

  it('names the deployment when no route answered, and passes any other refusal through', async () => {
    h.invoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch', network: true, code: 'network_error' },
    });
    await expect(requestReportQaPreview('conv-1', 'answer', { messageId: 'msg-1' }))
      .rejects.toThrow(/has not been deployed/);

    h.invoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'You do not have permission to edit this conversation.', status: 403 },
    });
    await expect(requestReportQaPreview('conv-1', 'answer', { messageId: 'msg-1', draft: 'x' }))
      .rejects.toThrow('You do not have permission to edit this conversation.');
  });
});

describe('pdfFromBase64', () => {
  it('restores every byte value, the high ones included', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(pdfFromBase64(base64(all))).toEqual(all);
  });
});
