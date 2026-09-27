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
vi.mock('@/lib/desktopMessageAlerts', () => ({ playMessagePing: vi.fn() }));
const toast = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toast(...args) }));

import { BuilderMessagePopups } from '../BuilderMessagePopups';
import { BUILDER_MESSAGE_POPUP_POLL_MS } from '@/lib/builderMessagePopups.pure';
import { BUILDER_CONVERSATION_POLL_MS, builderMessageArrivalKeys, marketplaceStockKeys } from '@/lib/marketplaceBuilderStock';

const arrival = (id: string, conversationId = 'conv-1') => ({
  message_id: id, conversation_id: conversationId, builder_name: 'Bob The Builder Pty Ltd', sender_display_name: 'Bobby',
  lot_number: '1629', address: '12 Example Street', received_at: '2026-09-27T12:00:00Z',
});

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  toast.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

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
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><BuilderMessagePopups /></MemoryRouter>
      </QueryClientProvider>,
    );
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
