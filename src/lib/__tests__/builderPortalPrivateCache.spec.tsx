import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A private conversation is somebody's. On a shared browser the app's one
 * QueryClient outlives a sign-out, so a key that does not name the reader
 * would hand the next person to sign in the previous person's inbox, threads
 * and activations straight from the cache. Every private read is keyed by the
 * signed-in user, and the Builder Portal badge is the server's count of the
 * reader's own unread acknowledgements, not the bell's newest fifty.
 */
const auth = { userId: 'user-a' as string | null };
vi.mock('@/hooks/useAuth', () => ({ useAuthUserIdOptional: () => auth.userId }));

const pending = { hang: false };
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(async (_name: string, body: { operation: string }) => {
    if (pending.hang) return new Promise(() => undefined);
    const owner = auth.userId;
    switch (body.operation) {
      case 'list_builder_portal_activations':
        return { data: { activations: [{ activation_key: `${owner}-activation` }] }, error: null };
      case 'list_my_builder_conversations':
        return { data: { conversations: [{ conversation_id: `${owner}-conversation` }] }, error: null };
      case 'get_builder_conversation':
        return { data: { conversation_id: 'c1', messages: [{ id: `${owner}-message` }] }, error: null };
      case 'count_activation_acknowledgements':
        return { data: { count: owner === 'user-a' ? 73 : 0 }, error: null };
      default:
        return { data: null, error: { message: 'unexpected', status: 400 } };
    }
  }),
}));

import {
  useActivationAcknowledgementCount, useBuilderPortalActivations, useMyBuilderConversations, useParticipantConversation,
} from '../marketplaceBuilderStock';
import { NavItemBadge } from '@/components/layout/NavItemBadge';

const client = () => new QueryClient({ defaultOptions: { queries: { gcTime: 30 * 60_000, staleTime: 30_000, retry: false } } });
const wrap = (qc: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => { auth.userId = 'user-a'; pending.hang = false; });

describe('the next person to sign in never sees the previous person\'s private reads', () => {
  const reads: Array<[string, () => { data?: unknown }]> = [
    ['Activated Properties', () => useBuilderPortalActivations()],
    ['the inbox', () => useMyBuilderConversations()],
    ['a conversation', () => useParticipantConversation('c1')],
  ];

  for (const [label, hook] of reads) {
    it(`${label}: B signing in on A's browser is shown nothing of A's, even while B's read is in flight`, async () => {
      const qc = client();
      const first = renderHook(hook, { wrapper: wrap(qc) });
      await waitFor(() => expect(JSON.stringify(first.result.current.data ?? null)).toContain('user-a'));
      first.unmount();

      auth.userId = 'user-b';
      pending.hang = true;
      const second = renderHook(hook, { wrapper: wrap(qc) });
      expect(second.result.current.data).toBeUndefined();
    });
  }
});

describe('the Builder Portal badge', () => {
  it('shows the server\'s count of the reader\'s unread acknowledgements, beyond any bell window', async () => {
    render(<QueryClientProvider client={client()}><NavItemBadge kind="builder_activations" /></QueryClientProvider>);
    expect(await screen.findByLabelText('73 new')).toHaveTextContent('9+');
  });

  it('draws nothing when there is nothing unread', async () => {
    auth.userId = 'user-b';
    const qc = client();
    const { container } = render(<QueryClientProvider client={qc}><NavItemBadge kind="builder_activations" /></QueryClientProvider>);
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(container).toBeEmptyDOMElement();
  });

  it('the count is keyed by the reader as well', async () => {
    const qc = client();
    const first = renderHook(() => useActivationAcknowledgementCount(), { wrapper: wrap(qc) });
    await waitFor(() => expect(first.result.current.data?.count).toBe(73));
    first.unmount();
    auth.userId = 'user-b';
    pending.hang = true;
    const second = renderHook(() => useActivationAcknowledgementCount(), { wrapper: wrap(qc) });
    expect(second.result.current.data).toBeUndefined();
  });
});
