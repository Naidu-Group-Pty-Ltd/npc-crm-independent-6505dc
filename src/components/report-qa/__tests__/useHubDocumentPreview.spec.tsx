/**
 * When the export dialog's Preview is drawn.
 *
 * A draw is a round trip to the report engine — several seconds, and a run of
 * the engine — so it happens when it is useful and never on a keystroke: the
 * first time the preview is shown, when the chosen template changes while it
 * is shown, and when it comes back into view after the text was edited. An
 * edit made while it is on screen (side by side) marks it stale and waits to
 * be asked. A failure is shown, never retried in a loop.
 *
 * And the one rule with a consequence beyond speed: the editor's text goes up
 * as a draft only when it is an EDIT. A draft takes the rights the edit's Save
 * takes; the stored record can be previewed by anybody who can read it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/reports/reportQa/requestReportQaPdf', () => ({ requestReportQaPreview: h.request }));

import { useHubDocumentPreview } from '../useHubDocumentPreview';

type Props = Parameters<typeof useHubDocumentPreview>[0];

const BASE: Props = {
  conversationId: 'conv-1',
  subject: 'answer',
  messageId: 'msg-1',
  text: '# Stored answer',
  edited: false,
  templateKey: 'selected:tpl-1',
  visible: false,
};

const result = (label: string) => ({
  pdf: new Uint8Array([1, 2, 3]),
  fileName: `${label}.pdf`,
  pageCount: 4,
  sections: ['One'],
  brandGaps: [],
  design: { outcome: 'applied', label: 'Obsidian', message: null },
  durationMs: 10,
});

/** A request the test answers when it chooses. */
const deferred = () => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const mount = (props: Partial<Props> = {}) =>
  renderHook((p: Props) => useHubDocumentPreview(p), { initialProps: { ...BASE, ...props } });

beforeEach(() => {
  h.request.mockReset();
  h.request.mockImplementation(async () => result('drawn'));
});

describe('useHubDocumentPreview', () => {
  it('draws nothing until it is on screen, then once', async () => {
    const hook = mount();
    expect(h.request).not.toHaveBeenCalled();

    hook.rerender({ ...BASE, visible: true });
    await waitFor(() => expect(hook.result.current.preview?.fileName).toBe('drawn.pdf'));
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.request).toHaveBeenCalledWith('conv-1', 'answer', { messageId: 'msg-1', draft: null });

    hook.rerender({ ...BASE, visible: true });
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(hook.result.current.stale).toBe(false);
  });

  it('sends the editor\'s text only when it is an edit', async () => {
    const hook = mount({ visible: true, edited: true, text: '# Edited answer' });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    expect(h.request.mock.calls[0][2]).toEqual({ messageId: 'msg-1', draft: '# Edited answer' });
    await waitFor(() => expect(hook.result.current.drawing).toBe(false));
  });

  it('marks itself stale on an edit made while it is shown, and redraws when asked', async () => {
    const hook = mount({ visible: true });
    await waitFor(() => expect(hook.result.current.preview).not.toBeNull());

    hook.rerender({ ...BASE, visible: true, text: '# Stored answer, edited', edited: true });
    expect(hook.result.current.stale).toBe(true);
    expect(h.request).toHaveBeenCalledTimes(1);

    await act(async () => { await hook.result.current.refresh(); });
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.request.mock.calls[1][2]).toEqual({ messageId: 'msg-1', draft: '# Stored answer, edited' });
    expect(hook.result.current.stale).toBe(false);
  });

  it('is not stale once an edit it already drew is saved', async () => {
    const hook = mount({ visible: true, edited: true, text: '# Edited' });
    await waitFor(() => expect(hook.result.current.preview).not.toBeNull());
    hook.rerender({ ...BASE, visible: true, edited: false, text: '# Edited' });
    expect(hook.result.current.stale).toBe(false);
    expect(h.request).toHaveBeenCalledTimes(1);
  });

  it('redraws by itself when the chosen template changes while it is shown', async () => {
    const hook = mount({ visible: true });
    await waitFor(() => expect(hook.result.current.preview).not.toBeNull());
    hook.rerender({ ...BASE, visible: true, templateKey: 'selected:tpl-2' });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
  });

  it('redraws on coming back into view after an edit, and not otherwise', async () => {
    const hook = mount({ visible: true });
    await waitFor(() => expect(hook.result.current.preview).not.toBeNull());

    // Away and back with nothing changed: the pages on screen are still right.
    hook.rerender({ ...BASE, visible: false });
    hook.rerender({ ...BASE, visible: true });
    await waitFor(() => expect(hook.result.current.drawing).toBe(false));
    expect(h.request).toHaveBeenCalledTimes(1);

    // Away, edited, back: drawn again with the edit.
    hook.rerender({ ...BASE, visible: false });
    hook.rerender({ ...BASE, visible: false, text: '# Changed', edited: true });
    hook.rerender({ ...BASE, visible: true, text: '# Changed', edited: true });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    expect(h.request.mock.calls[1][2]).toEqual({ messageId: 'msg-1', draft: '# Changed' });
  });

  it('shows a failure and does not retry it by itself', async () => {
    h.request.mockRejectedValueOnce(new Error('The report service is unavailable.'));
    const hook = mount({ visible: true });
    await waitFor(() => expect(hook.result.current.error).toBe('The report service is unavailable.'));
    expect(hook.result.current.preview).toBeNull();

    hook.rerender({ ...BASE, visible: true });
    hook.rerender({ ...BASE, visible: false });
    hook.rerender({ ...BASE, visible: true });
    await waitFor(() => expect(hook.result.current.drawing).toBe(false));
    expect(h.request).toHaveBeenCalledTimes(1);

    await act(async () => { await hook.result.current.refresh(); });
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.preview?.fileName).toBe('drawn.pdf');
  });

  it('keeps the newest draw when an older one answers last', async () => {
    const first = deferred();
    const second = deferred();
    h.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = mount({ visible: true });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));

    let refreshed!: Promise<void>;
    act(() => { refreshed = hook.result.current.refresh(); });
    await act(async () => {
      second.resolve(result('newer'));
      await refreshed;
    });
    await act(async () => {
      first.resolve(result('older'));
      await first.promise;
    });
    expect(hook.result.current.preview?.fileName).toBe('newer.pdf');
    expect(hook.result.current.drawing).toBe(false);
  });

  it('draws a template chosen during a draw once that draw is done', async () => {
    const first = deferred();
    h.request.mockReturnValueOnce(first.promise);
    const hook = mount({ visible: true });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));

    hook.rerender({ ...BASE, visible: true, templateKey: 'selected:tpl-2' });
    expect(h.request).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve(result('first'));
      await first.promise;
    });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
  });

  it('is not offered where the route has nothing it can read', async () => {
    const noConversation = mount({ conversationId: null, visible: true });
    const noMessage = mount({ messageId: null, visible: true });
    expect(noConversation.result.current.available).toBe(false);
    expect(noMessage.result.current.available).toBe(false);
    await act(async () => { await noConversation.result.current.refresh(); });
    expect(h.request).not.toHaveBeenCalled();
    // A write-up needs no message.
    expect(mount({ subject: 'structured', messageId: null }).result.current.available).toBe(true);
  });
});
