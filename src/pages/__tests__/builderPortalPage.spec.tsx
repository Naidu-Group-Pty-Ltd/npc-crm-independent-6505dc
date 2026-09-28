import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PORTALS → BUILDER PORTAL (docs/builder-portal/52).
 *
 * Data is mocked at the hook; the server decides every fact on the page.
 * What is asserted is what the page does with it:
 *
 * - two routable tabs, Activated Properties and Messaging;
 * - one row per activation, with the builder company's contacts, who
 *   activated it and who acknowledged it, its status, a link to the property
 *   page, and a link to the conversation only where the server gave one;
 * - the inbox lists what the server listed (only the viewer's own), and a
 *   selected conversation shows its thread, both sides' participants, a reply
 *   box only where it can be written to, Add user and Leave chat;
 * - a refused read shows nothing of the conversation.
 */

const state: Record<string, any> = {};
const invited: string[] = [];
const left: string[] = [];
const sent: Array<{ clientMessageId: string; body: string }> = [];
const serverMarked: string[] = [];

const markOnServer = (asOf: string) => { serverMarked.push(asOf); };
vi.mock('@/lib/marketplaceBuilderStock', async () => {
  const actual = await vi.importActual<typeof import('@/lib/marketplaceBuilderStock')>('@/lib/marketplaceBuilderStock');
  return {
    ...actual,
    scrollLogToEnd: () => undefined,
    scrollMessageIntoView: () => undefined,
    marketplaceStockImageUrl: async (id: string) => {
      const signed = state.imageUrls?.[id];
      if (signed instanceof Error) throw signed;
      return signed ?? null;
    },
    useBuilderPortalActivations: () => ({
      data: state.activationsError && !state.keepData ? undefined : state.activations, error: state.activationsError ?? null,
      isLoading: false, isSuccess: !state.activationsError,
      isFetchedAfterMount: !state.cachedOnly, isFetching: !!state.cachedOnly,
    }),
    useMarkActivationAcknowledgementsRead: () => ({ mutate: markOnServer }),
    useEarlierConversationMessages: () => ({ isPending: false, mutateAsync: vi.fn(async () => ({ messages: [] })) }),
    useMyBuilderConversations: () => ({ data: state.inboxError ? undefined : state.inbox, error: state.inboxError ?? null, isLoading: false }),
    useParticipantConversation: () => ({ data: state.conversation, error: state.conversationError ?? null, isLoading: false, isFetching: false }),
    useSendConversationMessage: () => ({
      isPending: false,
      mutateAsync: vi.fn(async (input: { clientMessageId: string; body: string }) => { sent.push(input); return {}; }),
    }),
    useRetryConversationMessage: () => ({ isPending: false, mutateAsync: vi.fn(async () => ({})) }),
    useConversationInvitees: () => ({ data: state.invitees ?? [], error: null, isLoading: false }),
    useInviteConversationParticipant: () => ({
      isPending: false, mutateAsync: vi.fn(async (userId: string) => { invited.push(userId); return { result: 'joined' }; }),
    }),
    useLeaveConversation: () => ({
      isPending: false, mutateAsync: vi.fn(async () => { left.push('left'); return { result: 'left' }; }),
    }),
  };
});

const flag = { loading: false, enabled: true };
vi.mock('@/hooks/useBuilderStockMarketplaceFlag', () => ({ useBuilderStockMarketplaceFlag: () => flag }));

const markedRead: string[] = [];
vi.mock('@/contexts/NotificationsContext', () => ({
  useNotificationsOptional: () => ({
    notifications: [
      { id: 'n1', read: false, type: 'builder_activation_acknowledged', timestamp: new Date('2026-09-26T04:59:00.000Z') },
      // Arrived after the list was read: it was not shown, so it stays unread.
      { id: 'n2', read: false, type: 'builder_activation_acknowledged', timestamp: new Date('2026-09-26T05:01:00.000Z') },
    ],
    markAsRead: (id: string) => { markedRead.push(id); },
  }),
}));

import BuilderPortal from '../BuilderPortal';

const ACTIVATION = (overrides: Record<string, unknown> = {}) => ({
  activation_key: 'k1', stock_item_id: 'item-1', address: '1 Private Street', suburb: 'Kellyville', lot_number: '101',
  house_design: 'Aspen 28', primary_image_id: null, builder_name: 'Check Homes Pty Ltd',
  builder_email: 'sales@checkhomes.example', builder_phone: '02 9000 0000', builder_website: 'https://checkhomes.example',
  activated_by: 'Olive Owner', activated_at: '2026-09-25T01:00:00Z', acknowledged_by: 'Avery Builder',
  acknowledged_at: '2026-09-25T02:00:00Z', status: 'acknowledged', conversation_id: 'conv-1', ...overrides,
});
const MESSAGE = (overrides: Record<string, unknown>) => ({
  id: 'm', side: 'command_centre', sender_display_name: 'Olive Owner', body: 'Hello', sent_at: '2026-09-25T10:00:00Z',
  delivery_state: 'delivered', delivered_at: '2026-09-25T10:00:05Z', failure_reason: null, mine: true, can_retry: false, ...overrides,
});
const CONVERSATION = (overrides: Record<string, unknown> = {}) => ({
  conversation_id: 'conv-1', stock_item_id: 'item-1', address: '1 Private Street', builder_name: 'Check Homes Pty Ltd',
  open: true, closed_reason: null, can_send: true, can_invite: true, can_leave: true,
  participants: [
    { participant_ref: 'r1', side: 'command_centre', display_name: 'Olive Owner', is_me: true },
    { participant_ref: 'r2', side: 'builder', display_name: 'Avery Builder', is_me: false },
  ],
  messages: [MESSAGE({ id: 'a', body: 'Is it available?' }),
    MESSAGE({ id: 'b', side: 'builder', sender_display_name: 'Avery Builder', body: 'Yes.', delivery_state: null, mine: false })],
  ...overrides,
});

beforeEach(() => {
  for (const key of Object.keys(state)) delete state[key];
  markedRead.length = 0;
  serverMarked.length = 0;
  delete state.keepData;
  delete state.activationsError;
  flag.loading = false; flag.enabled = true;
  state.activations = { as_of: '2026-09-26T05:00:00.000Z', activations: [ACTIVATION(), ACTIVATION({
    activation_key: 'k2', activated_by: 'Otto Other', acknowledged_by: null, acknowledged_at: null,
    status: 'awaiting_acknowledgement', conversation_id: null,
  })] };
  state.inbox = { conversations: [{ conversation_id: 'conv-1', stock_item_id: 'item-1', address: '1 Private Street',
    lot_number: '101', builder_name: 'Check Homes Pty Ltd', status: 'acknowledged', last_message_at: '2026-09-25T10:00:00Z' }] };
  state.conversation = CONVERSATION();
  invited.length = 0; left.length = 0; sent.length = 0;
});

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/builder-portal" element={<BuilderPortal />} />
      <Route path="/admin/builder-portal/:tab" element={<BuilderPortal />} />
      <Route path="/admin/builder-portal/:tab/:conversationId" element={<BuilderPortal />} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);

describe('the Builder Portal area', () => {
  it('has two tabs, Activated Properties and Messaging, and opens on the one its route names', () => {
    renderAt('/admin/builder-portal/messaging');
    expect(screen.getByRole('tab', { name: /activated properties/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /messaging/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('Activated Properties: one row per activation, with the company, both people and a status', () => {
    renderAt('/admin/builder-portal/activated');
    const rows = screen.getAllByRole('article');
    expect(rows).toHaveLength(2);
    const first = within(rows[0]);
    expect(first.getByText('1 Private Street', { exact: false })).toBeInTheDocument();
    expect(first.getByText(/lot 101/i)).toBeInTheDocument();
    expect(first.getByText(/aspen 28/i)).toBeInTheDocument();
    expect(first.getByText('Check Homes Pty Ltd')).toBeInTheDocument();
    expect(first.getByRole('link', { name: /sales@checkhomes\.example/ })).toHaveAttribute('href', 'mailto:sales@checkhomes.example');
    expect(first.getByRole('link', { name: /02 9000 0000/ })).toHaveAttribute('href', 'tel:0290000000');
    expect(first.getByRole('link', { name: /website/i })).toHaveAttribute('href', 'https://checkhomes.example');
    expect(first.getByText(/olive owner/i)).toBeInTheDocument();
    expect(first.getByText(/avery builder/i)).toBeInTheDocument();
    expect(first.getByText('Acknowledged')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Awaiting acknowledgement')).toBeInTheDocument();
  });

  it('each row links to the property page, and to the conversation only where the viewer is in it', () => {
    renderAt('/admin/builder-portal/activated');
    const [first, second] = screen.getAllByRole('article');
    expect(within(first).getByRole('link', { name: /view property/i })).toHaveAttribute('href', '/listings/builder-stock/item-1');
    expect(within(first).getByRole('link', { name: /open conversation/i }))
      .toHaveAttribute('href', '/admin/builder-portal/messaging/conv-1');
    expect(within(second).queryByRole('link', { name: /open conversation/i })).toBeNull();
  });

  it('an acknowledgement recorded before names were sent reads "Acknowledged", naming nobody', () => {
    state.activations = { activations: [ACTIVATION({ acknowledged_by: null })] };
    renderAt('/admin/builder-portal/activated');
    const row = screen.getByRole('article');
    expect(within(row).getByText('Acknowledged')).toBeInTheDocument();
    expect(within(row).queryByText(/acknowledged by/i)).toBeNull();
  });
});

describe('Messaging', () => {
  it('lists the viewer\'s conversations, and shows the selected one with both sides\' participants', () => {
    renderAt('/admin/builder-portal/messaging/conv-1');
    expect(screen.getByRole('link', { name: /1 private street/i })).toBeInTheDocument();
    const people = screen.getByRole('list', { name: /participants/i });
    expect(within(people).getByText('Olive Owner')).toBeInTheDocument();
    expect(within(people).getByText('Avery Builder')).toBeInTheDocument();
    const log = screen.getByRole('log');
    expect(within(log).getByText('Is it available?')).toBeInTheDocument();
    expect(within(log).getByText('Yes.')).toBeInTheDocument();
  });

  it('a participant writes, adds a colleague and leaves', async () => {
    state.invitees = [{ user_id: 'u-casey', display_name: 'Casey Colleague' }];
    renderAt('/admin/builder-portal/messaging/conv-1');
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: ' Settlement in June. ' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await vi.waitFor(() => expect(sent).toEqual([{ clientMessageId: expect.any(String), body: 'Settlement in June.' }]));

    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    fireEvent.click(await screen.findByRole('button', { name: /add casey colleague/i }));
    await vi.waitFor(() => expect(invited).toEqual(['u-casey']));

    fireEvent.click(screen.getByRole('button', { name: /leave chat/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^leave$/i }));
    await vi.waitFor(() => expect(left).toEqual(['left']));
  });

  it('the last participant on this side is told to add a colleague before leaving', () => {
    state.conversation = CONVERSATION({ can_leave: false });
    renderAt('/admin/builder-portal/messaging/conv-1');
    expect(screen.getByRole('button', { name: /leave chat/i })).toBeDisabled();
    expect(screen.getByText(/add a colleague before you leave/i)).toBeInTheDocument();
  });

  it('a withdrawn activation\'s conversation keeps its history and takes no reply and no new user', () => {
    state.conversation = CONVERSATION({ open: false, closed_reason: 'withdrawn', can_send: false, can_invite: false });
    renderAt('/admin/builder-portal/messaging/conv-1');
    expect(screen.getByText('Is it available?')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add user/i })).toBeNull();
    expect(screen.getByText(/activation was withdrawn/i)).toBeInTheDocument();
  });

  it('a conversation the viewer is not in shows nothing of it', () => {
    state.conversation = undefined;
    state.conversationError = Object.assign(new Error('You are not in this conversation.'), { status: 403, code: 'not_a_participant' });
    renderAt('/admin/builder-portal/messaging/conv-other');
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.queryByRole('list', { name: /participants/i })).toBeNull();
    expect(screen.getByText(/not in this conversation/i)).toBeInTheDocument();
  });

  it('a background refresh that fails keeps the activations already read, and says they may be behind', () => {
    state.activationsError = Object.assign(new Error('unavailable'), { status: 503 });
    state.keepData = true;
    renderAt('/admin/builder-portal/activated');
    expect(screen.getByText(/otto other/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/could not be refreshed/i);
  });

  it('a background refresh that fails over an empty list says it may be behind, not only that nothing is activated', () => {
    state.activations = { activations: [] };
    state.activationsError = Object.assign(new Error('unavailable'), { status: 503 });
    state.keepData = true;
    renderAt('/admin/builder-portal/activated');
    expect(screen.getByRole('status')).toHaveTextContent(/could not be refreshed/i);
  });

  it('a refusal after activations were read withdraws them', () => {
    state.activationsError = Object.assign(new Error('forbidden'), { status: 403 });
    state.keepData = true;
    renderAt('/admin/builder-portal/activated');
    expect(screen.queryByText(/otto other/i)).toBeNull();
    expect(screen.getByText(/not available to you/i)).toBeInTheDocument();
  });

  it('the acknowledgement badge clears once the list has been read, and not when the read failed', () => {
    state.activationsError = Object.assign(new Error('unavailable'), { status: 503 });
    const failed = renderAt('/admin/builder-portal/activated');
    expect(markedRead).toEqual([]);
    expect(serverMarked).toEqual([]);
    failed.unmount();
    delete state.activationsError;
    renderAt('/admin/builder-portal/activated');
    // The server marks every acknowledgement of the reader's, beyond the bell's window; the bell's copy follows.
    expect(serverMarked).toEqual(['2026-09-26T05:00:00.000Z']);
    expect(markedRead).toEqual(['n1']);
  });

  it('a list shown from an earlier visit\'s cache, still being refetched, does not clear the badge', () => {
    state.cachedOnly = true;
    renderAt('/admin/builder-portal/activated');
    expect(markedRead).toEqual([]);
    expect(serverMarked).toEqual([]);
  });

  it('with nothing activated, says where a property is activated', () => {
    state.activations = { activations: [] };
    renderAt('/admin/builder-portal/activated');
    expect(screen.getByRole('link', { name: /builder stock/i })).toHaveAttribute('href', '/listings?section=builder-stock');
  });

  it('a conversation list that could not be read says so, and never that there are none', () => {
    state.inboxError = Object.assign(new Error('unavailable'), { status: 503 });
    renderAt('/admin/builder-portal/messaging');
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no conversations yet/i)).toBeNull();
  });

  it('a direct visit while Builder Stock is off shows nothing of the portal', () => {
    flag.enabled = false;
    renderAt('/admin/builder-portal/messaging/conv-1');
    expect(screen.getByText(/not switched on/i)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('log')).toBeNull();
  });

  it('an empty inbox says how a conversation starts', () => {
    state.inbox = { conversations: [] };
    renderAt('/admin/builder-portal/messaging');
    expect(screen.getByText(/when a builder acknowledges an activation/i)).toBeInTheDocument();
    // And what to do next: activate a property, or see what is waiting on a builder.
    expect(screen.getByRole('link', { name: /builder stock/i })).toHaveAttribute('href', '/listings?section=builder-stock');
    expect(screen.getByRole('link', { name: /activated properties/i })).toHaveAttribute('href', '/admin/builder-portal/activated');
  });
});

describe('an activation\'s photograph follows the image the server selected', () => {
  const tree = () => (
    <MemoryRouter initialEntries={['/admin/builder-portal/activated']}>
      <Routes>
        <Route path="/admin/builder-portal/:tab" element={<BuilderPortal />} />
      </Routes>
    </MemoryRouter>
  );
  const photos = (container: HTMLElement) => Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'));

  it('drops the old photograph when the image is withdrawn or replaced by one that cannot be signed', async () => {
    state.imageUrls = { 'img-1': 'https://signed.example/img-1', 'img-2': new Error('refused') };
    state.activations = { activations: [ACTIVATION({ primary_image_id: 'img-1' })] };
    const { container, rerender } = render(tree());
    await waitFor(() => expect(photos(container)).toEqual(['https://signed.example/img-1']));

    state.activations = { activations: [ACTIVATION({ primary_image_id: null })] };
    await act(async () => { rerender(tree()); });
    expect(photos(container)).toEqual([]);

    state.activations = { activations: [ACTIVATION({ primary_image_id: 'img-1' })] };
    await act(async () => { rerender(tree()); });
    await waitFor(() => expect(photos(container)).toEqual(['https://signed.example/img-1']));

    state.activations = { activations: [ACTIVATION({ primary_image_id: 'img-2' })] };
    await act(async () => { rerender(tree()); });
    expect(photos(container)).toEqual([]);
  });
});
