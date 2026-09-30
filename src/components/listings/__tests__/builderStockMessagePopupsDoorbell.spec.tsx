import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE POPUP'S CHECK IS THE OPEN THREAD'S DOORBELL.
 *
 * Driven through the real polling loop with fake timers. A builder message
 * that lands makes the conversation it arrived in, and the reader's
 * conversation lists, re-read at once — so a thread on screen shows it within
 * one five-second check instead of on its own ten-second cadence. The popup
 * itself is unchanged: first read takes the cursor only, then one popup per
 * message with an Open button.
 */

const invoke = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: (...args: unknown[]) => invoke(...args) }));
vi.mock('@/hooks/useModulePermissions', () => ({ useModulePermissions: () => ({ canView: true, loading: false }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuthUserIdOptional: () => 'user-me' }));
const deliverPageAlert = vi.fn(async (..._args: unknown[]) => 'shown');
const playMessagePing = vi.fn();
vi.mock('@/lib/desktopMessageAlerts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/desktopMessageAlerts')>()),
  deliverPageAlert: (...args: unknown[]) => deliverPageAlert(...args),
  playMessagePing: () => playMessagePing(),
}));
const toast = vi.fn();
vi.mock('sonner', () => ({ toast: Object.assign((...args: unknown[]) => toast(...args), { success: vi.fn(), message: vi.fn() }) }));

import { BuilderMessagePopups } from '../BuilderMessagePopups';
import { BUILDER_MESSAGE_POPUP_POLL_MS, forgetBuilderMessageChecks } from '@/lib/builderMessagePopups.pure';
import { BUILDER_CONVERSATION_POLL_MS, builderMessageArrivalKeys, marketplaceStockKeys } from '@/lib/marketplaceBuilderStock';
import { resetMessageAlertClaims } from '@/lib/desktopMessageAlerts';

let clock = 0;
const arrival = (id: string, conversationId = 'conv-1') => ({
  message_id: id, conversation_id: conversationId, builder_name: 'Bob The Builder Pty Ltd', sender_display_name: 'Bobby',
  lot_number: '1629', address: '12 Example Street',
  // Every arrival is later than the one before, as on the server.
  received_at: new Date(Date.UTC(2026, 8, 27, 12, 0, clock++)).toISOString(),
});

let visibility: 'visible' | 'hidden' = 'visible';
beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  toast.mockReset();
  deliverPageAlert.mockClear();
  playMessagePing.mockReset();
  localStorage.clear();
  resetMessageAlertClaims();
  forgetBuilderMessageChecks();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  document.title = 'Command Centre';
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function mount(path = '/admin/listings') {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}><BuilderMessagePopups /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidate, view };
}

const setVisibility = (next: 'visible' | 'hidden') => {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('the new-message check', () => {
  it('asks every five seconds, more often than an open conversation re-reads itself', () => {
    expect(BUILDER_MESSAGE_POPUP_POLL_MS).toBe(5_000);
    expect(BUILDER_MESSAGE_POPUP_POLL_MS).toBeLessThan(BUILDER_CONVERSATION_POLL_MS);
  });

  it('names the reader\'s own conversation and every one of their conversation lists as stale', () => {
    const root = [...marketplaceStockKeys.root(), 'private', 'user-me'];
    expect(builderMessageArrivalKeys('user-me', 'conv-1')).toEqual([
      [...root, 'conversation', 'conv-1'],
      [...root, 'my-conversations'],
    ]);
  });

  it('refreshes the conversation a message landed in, and still raises one popup for it', async () => {
    invoke
      .mockResolvedValueOnce({ data: { cursor: 'c1', messages: [] }, error: null })
      .mockResolvedValueOnce({ data: { cursor: 'c2', messages: [arrival('m1')] }, error: null });
    const { invalidate } = mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenNthCalledWith(1, 'builder-stock-marketplace', { operation: 'list_new_builder_messages' });
    expect(invalidate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(BUILDER_MESSAGE_POPUP_POLL_MS);
    expect(invoke).toHaveBeenNthCalledWith(2, 'builder-stock-marketplace', { operation: 'list_new_builder_messages', since: 'c1' });
    for (const queryKey of builderMessageArrivalKeys('user-me', 'conv-1')) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe('New message from Bob The Builder Pty Ltd');
  });
});

describe('where the message reaches the reader', () => {
  const answers = (...batches: unknown[][]) => {
    invoke.mockResolvedValueOnce({ data: { cursor: 'c1', messages: [] }, error: null });
    for (const batch of batches) invoke.mockResolvedValueOnce({ data: { cursor: 'c2', messages: batch }, error: null });
    invoke.mockResolvedValue({ data: { cursor: 'c2', messages: [] }, error: null });
  };

  it('tells a conversation once, however many messages it received', async () => {
    answers([arrival('m1'), arrival('m2'), arrival('m3', 'conv-2')]);
    mount();
    await vi.advanceTimersByTimeAsync(BUILDER_MESSAGE_POPUP_POLL_MS);
    expect(toast.mock.calls.map((call) => call[0])).toEqual([
      '2 new messages from Bob The Builder Pty Ltd', 'New message from Bob The Builder Pty Ltd',
    ]);
    expect((toast.mock.calls[0][1] as { id: string }).id).toBe('builder-conversation-conv-1');
  });

  it('raises nothing over the conversation the reader has open, and still refreshes it', async () => {
    answers([arrival('m1', 'conv-1'), arrival('m2', 'conv-2')]);
    const { invalidate } = mount('/admin/builder-portal/messaging/conv-1');
    await vi.advanceTimersByTimeAsync(BUILDER_MESSAGE_POPUP_POLL_MS);
    expect(toast).toHaveBeenCalledTimes(1);
    expect((toast.mock.calls[0][1] as { id: string }).id).toBe('builder-conversation-conv-2');
    for (const queryKey of builderMessageArrivalKeys('user-me', 'conv-1')) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('keeps asking while the tab is hidden — every thirty seconds, where it used to ask nothing', async () => {
    visibility = 'hidden';
    invoke.mockResolvedValue({ data: { cursor: 'c1', messages: [] }, error: null });
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('reaches a reader in another tab: the desktop, the tab title, and the popup when they come back', async () => {
    answers([], [arrival('m1')]);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(toast).not.toHaveBeenCalled();
    expect(deliverPageAlert).toHaveBeenCalledTimes(1);
    expect(deliverPageAlert.mock.calls[0][0]).toMatchObject({
      key: 'builder-message:conv-1',
      heading: 'New message from Bob The Builder Pty Ltd',
      body: 'Bobby · Lot 1629, 12 Example Street',
      path: '/admin/builder-portal/messaging/conv-1',
    });
    expect(playMessagePing).toHaveBeenCalledTimes(1);
    expect(document.title).toBe('(1) Command Centre');

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe('New message from Bob The Builder Pty Ltd');
    expect(document.title).toBe('Command Centre');
  });

  it('notifies the desktop once and shows the popup once, across every open tab', async () => {
    invoke
      .mockResolvedValueOnce({ data: { cursor: 'c1', messages: [] }, error: null })
      .mockResolvedValueOnce({ data: { cursor: 'c1', messages: [] }, error: null })
      .mockResolvedValue({ data: { cursor: 'c2', messages: [arrival('m1')] }, error: null });
    // Two tabs of the same browser share the ledger; two readers would not.
    mount();
    forgetBuilderMessageChecks();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deliverPageAlert).toHaveBeenCalledTimes(1);
    expect(playMessagePing).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('keeps its cursor through the desktop-to-mobile layout swap, so nothing in between is skipped', async () => {
    invoke.mockResolvedValueOnce({ data: { cursor: 'c1', messages: [] }, error: null });
    const first = mount();
    await vi.advanceTimersByTimeAsync(0);
    first.view.unmount();
    invoke.mockResolvedValueOnce({ data: { cursor: 'c2', messages: [arrival('m1')] }, error: null });
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenLastCalledWith('builder-stock-marketplace', { operation: 'list_new_builder_messages', since: 'c1' });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('stops asking once refused, and keeps asking through a transient failure', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { status: 403 } });
    mount();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
