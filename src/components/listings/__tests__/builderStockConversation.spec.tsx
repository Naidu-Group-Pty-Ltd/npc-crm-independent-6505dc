import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitFor, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE BUILDER CONVERSATION ON A PROPERTY PAGE.
 *
 * Data is mocked at the hook; what is asserted is what the card does with it:
 * the thread in the order it was written with the actual sender on every
 * message, the delivery state of what the Command Centre sent, a failed
 * message kept visible with "Send again" for its writer, one idempotency key
 * per message, a composer only for someone who may write, and a property that
 * is not activated saying how to open the conversation rather than hiding it.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const code = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const state: { conversation: any; error: unknown; inboxError?: unknown; inviteesError?: unknown } = { conversation: null, error: null };
const sent: Array<{ clientMessageId: string; body: string }> = [];
const sendFailures = { remaining: 0 };
const retried: string[] = [];
const retryAnswer: { message?: unknown } = {};

const scrolled: unknown[] = [];
const earlierAsked: string[] = [];
const earlierPages: Record<string, any> = {};
vi.mock('@/lib/marketplaceBuilderStock', async () => ({
  arrivalScrollTarget: (await vi.importActual<typeof import('@/lib/marketplaceBuilderStock')>('@/lib/marketplaceBuilderStock')).arrivalScrollTarget,
  conversationAccessLost: (await vi.importActual<typeof import('@/lib/marketplaceBuilderStock')>('@/lib/marketplaceBuilderStock')).conversationAccessLost,
  mergeConversationPages: (await vi.importActual<typeof import('@/lib/marketplaceBuilderStock')>('@/lib/marketplaceBuilderStock')).mergeConversationPages,
  useEarlierConversationMessages: () => ({
    isPending: false,
    mutateAsync: vi.fn(async (cursor: string) => { earlierAsked.push(cursor); return earlierPages[cursor]; }),
  }),
  scrollLogToEnd: (log: unknown) => { scrolled.push(log); },
  scrollMessageIntoView: (_log: unknown, id: string) => { scrolled.push(`message:${id}`); },
  useParticipantConversation: () => ({
    data: state.conversation ?? undefined, error: state.error, isLoading: false, isFetching: false,
  }),
  useSendConversationMessage: () => ({
    isPending: false,
    mutateAsync: vi.fn(async (input: { clientMessageId: string; body: string }) => {
      sent.push(input);
      if (sendFailures.remaining > 0) { sendFailures.remaining -= 1; throw new Error('network'); }
      return {};
    }),
  }),
  useRetryConversationMessage: () => ({
    isPending: false,
    mutateAsync: vi.fn(async (id: string) => { retried.push(id); return retryAnswer.message ? { message: retryAnswer.message } : {}; }),
  }),
  useConversationInvitees: () => ({ data: state.inviteesError ? undefined : [], isLoading: false, error: state.inviteesError ?? null, refetch: vi.fn() }),
  useInviteConversationParticipant: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useLeaveConversation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useMyBuilderConversations: () => ({ data: state.inboxError ? undefined : { conversations: [] }, isLoading: false, error: state.inboxError ?? null }),
}));

import { MemoryRouter } from 'react-router-dom';
import { BuilderConversationThread, BuilderStockConversations } from '../BuilderStockConversation';

const MESSAGE = (overrides: Record<string, unknown>) => ({
  id: 'm', side: 'command_centre', sender_display_name: 'Olive Owner', body: 'Hello',
  sent_at: '2026-09-25T10:00:00Z', delivery_state: 'delivered', delivered_at: '2026-09-25T10:00:05Z',
  failure_reason: null, mine: true, can_retry: false, ...overrides,
});

beforeEach(() => {
  state.conversation = null;
  state.error = null;
  delete state.inboxError;
  delete state.inviteesError;
  sent.length = 0;
  sendFailures.remaining = 0;
  retried.length = 0;
  delete retryAnswer.message;
  earlierAsked.length = 0;
  for (const key of Object.keys(earlierPages)) delete earlierPages[key];
});

const renderCard = () => render(<BuilderConversationThread conversationId="conv-1" builderName="Proof Homes" />);

describe('the builder conversation card', () => {
  it('names the builder it is with', () => {
    state.conversation = { conversation_id: null, open: true, can_send: true, messages: [] };
    renderCard();
    expect(screen.getByRole('heading', { name: /messages with proof homes/i })).toBeInTheDocument();
  });

  it('an activated property with no messages invites the first one', () => {
    state.conversation = { conversation_id: null, open: true, can_send: true, messages: [] };
    renderCard();
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /message/i })).not.toBeDisabled();
  });

  it('a poll that fails after the thread was read keeps the history and says it may be behind', () => {
    state.conversation = {
      conversation_id: 'c', open: true, can_send: true,
      messages: [MESSAGE({ id: 'a', body: 'Already read.', delivery_state: 'delivered' })],
    };
    state.error = new Error('poll failed');
    renderCard();
    expect(within(screen.getByRole('log')).getByText('Already read.')).toBeInTheDocument();
    expect(screen.getByText(/could not be refreshed/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded just now/i)).toBeNull();
  });

  it.each([
    ['access revoked', Object.assign(new Error('Listings access required'), { status: 403 })],
    ['signed out', Object.assign(new Error('Authentication required'), { status: 401 })],
    ['feature switched off', Object.assign(new Error('Builder Stock is switched off for this workspace.'), { status: 403, code: 'builder_stock_disabled' })],
  ])('a poll refused because %s withdraws the history and the composer', (_why, error) => {
    state.conversation = {
      conversation_id: 'c', open: true, can_send: true,
      messages: [MESSAGE({ id: 'a', body: 'Already read.', delivery_state: 'delivered' })],
    };
    state.error = error;
    renderCard();
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.queryByText('Already read.')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /message/i })).toBeNull();
    expect(screen.queryByText(/could not be refreshed/i)).toBeNull();
    expect(screen.getByText(/no longer available to you/i)).toBeInTheDocument();
  });

  it('a first read that fails says the conversation could not be loaded', () => {
    state.error = new Error('first read failed');
    renderCard();
    expect(screen.getByText(/could not be loaded just now/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be refreshed/i)).toBeNull();
  });

  it('shows the thread in order, with the actual sender, and delivery only for ours', () => {
    state.conversation = {
      conversation_id: 'c', open: true, can_send: true,
      messages: [
        MESSAGE({ id: 'a', body: 'Question?', delivery_state: 'delivered' }),
        MESSAGE({ id: 'b', side: 'builder', sender_display_name: 'Avery Builder', body: 'Answer.', delivery_state: null, mine: false }),
        MESSAGE({ id: 'c', sender_display_name: 'Casey Colleague', body: 'Thanks.', delivery_state: 'queued', mine: false }),
      ],
    };
    renderCard();
    const items = within(screen.getByRole('log')).getAllByRole('article');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Olive Owner'), expect.stringContaining('Avery Builder'), expect.stringContaining('Casey Colleague'),
    ]);
    expect(within(items[0]).getByText('Delivered')).toBeInTheDocument();
    expect(within(items[1]).queryByText(/delivered|sending/i)).toBeNull();
    expect(within(items[2]).getByText('Sending')).toBeInTheDocument();
  });

  it('a failed message stays visible, and its writer can send it again', () => {
    state.conversation = {
      conversation_id: 'c', open: true, can_send: true,
      messages: [MESSAGE({ id: 'failed-1', body: 'Did this arrive?', delivery_state: 'failed', failure_reason: 'not_delivered', can_retry: true })],
    };
    renderCard();
    expect(screen.getByText('Did this arrive?')).toBeInTheDocument();
    expect(screen.getByText('Not delivered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send again/i }));
    expect(retried).toEqual(['failed-1']);
  });

  it('sends the trimmed text under one fresh idempotency key', async () => {
    state.conversation = { conversation_id: null, open: true, can_send: true, messages: [] };
    renderCard();
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: '  Is it available?  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await screen.findByRole('textbox', { name: /message/i });
    expect(sent).toEqual([{ clientMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/), body: 'Is it available?' }]);
  });

  it('repeats a send that failed in flight under the same key, and mints a new key once the text changes', async () => {
    state.conversation = { conversation_id: null, open: true, can_send: true, messages: [] };
    sendFailures.remaining = 2;
    renderCard();
    const box = screen.getByRole('textbox', { name: /message/i });
    fireEvent.change(box, { target: { value: 'Is lot 12 still available?' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].clientMessageId).toBe(sent[0].clientMessageId);
    fireEvent.change(box, { target: { value: 'Is lot 14 still available?' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2].clientMessageId).not.toBe(sent[0].clientMessageId);
  });

  it('a message whose confirmation never came back says so, and its writer can send it again', () => {
    state.conversation = {
      conversation_id: 'c', open: true, can_send: true,
      messages: [MESSAGE({ id: 'm-unconfirmed', body: 'Price still current?', delivery_state: 'failed', failure_reason: 'confirmation_timeout', can_retry: true })],
    };
    renderCard();
    expect(screen.getByText('Not confirmed')).toBeInTheDocument();
    expect(screen.queryByText('Not delivered')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /send again/i }));
    expect(retried).toEqual(['m-unconfirmed']);
  });

  it('offers no "Send again" where the reader cannot write, even on their own failed message', () => {
    state.conversation = {
      conversation_id: 'c', open: false, can_send: false,
      messages: [MESSAGE({ id: 'failed-1', body: 'Did this arrive?', delivery_state: 'failed', failure_reason: 'not_delivered', can_retry: true })],
    };
    renderCard();
    expect(screen.getByText('Did this arrive?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send again/i })).toBeNull();
  });

  it('someone without Listings edit reads the thread but has no composer', () => {
    state.conversation = { conversation_id: 'c', open: true, can_send: false, messages: [MESSAGE({})] };
    renderCard();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).toBeNull();
  });

  it('a property that is not activated says how the conversation opens', () => {
    state.conversation = { conversation_id: null, open: false, can_send: false, messages: [] };
    renderCard();
    expect(screen.getByText(/activate this property to message/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).toBeNull();
  });

  it('a paused connection says so, rather than asking to activate a property that is activated', () => {
    state.conversation = {
      conversation_id: 'c', open: false, closed_reason: 'connection_paused', can_send: false, messages: [MESSAGE({})],
    };
    renderCard();
    expect(screen.getByText(/paused while the connection/i)).toBeInTheDocument();
    expect(screen.queryByText(/no longer activated|activate this property/i)).toBeNull();
  });

  it('a property the builder stopped listing says that, and keeps its history', () => {
    state.conversation = {
      conversation_id: 'c', open: false, closed_reason: 'delisted', can_send: false, messages: [MESSAGE({})],
    };
    renderCard();
    expect(screen.getByText(/no longer lists this property/i)).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('an empty open thread promises delivery only to somebody who can write', () => {
    state.conversation = { conversation_id: null, open: true, can_send: false, messages: [] };
    renderCard();
    expect(screen.queryByText(/goes to/i)).toBeNull();
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot write to it here/i)).toBeInTheDocument();
  });

  it('no model and no email: a message is text between people', () => {
    const source = code('src/components/listings/BuilderStockConversation.tsx');
    expect(source).not.toMatch(/openrouter|anthropic|openai|claude|resend|sendEmail/i);
  });
});

describe('a read that failed is never shown as an absence', () => {
  it('the property card says its conversations could not be loaded, not that there are none', () => {
    state.inboxError = Object.assign(new Error('unavailable'), { status: 503 });
    render(<MemoryRouter><BuilderStockConversations stockItemId="item-1" builderName="Proof Homes" /></MemoryRouter>);
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/you are not in a conversation/i)).toBeNull();
  });

  it('Add user says the colleagues could not be loaded, not that there is nobody', () => {
    state.inviteesError = Object.assign(new Error('unavailable'), { status: 503 });
    state.conversation = { conversation_id: 'conv-1', open: true, can_send: true, can_invite: true, can_leave: true,
      participants: [], messages: [] };
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    expect(screen.getByText(/colleagues could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/nobody else/i)).toBeNull();
  });
});

describe('the conversation log follows its newest message', () => {
  it('opens at the end, and moves to the end again when a poll brings in a message', () => {
    scrolled.length = 0;
    state.conversation = { conversation_id: 'c', open: true, can_send: true, messages: [MESSAGE({ id: 'm1', body: 'First.' })] };
    const card = () => <BuilderConversationThread conversationId="conv-1" builderName="Proof Homes" />;
    const view = render(card());
    expect(scrolled).toContain(screen.getByRole('log'));
    const before = scrolled.length;
    state.conversation = { ...state.conversation, messages: [...state.conversation.messages, MESSAGE({ id: 'm2', body: 'Arrived by poll.' })] };
    view.rerender(card());
    expect(scrolled.length).toBeGreaterThan(before);
  });

  it('brings a late message into view when the poll sorts it above the newest one', () => {
    scrolled.length = 0;
    state.conversation = { conversation_id: 'c', open: true, can_send: true,
      messages: [MESSAGE({ id: 'm1', body: 'First.' }), MESSAGE({ id: 'm3', body: 'Newest.' })] };
    const card = () => <BuilderConversationThread conversationId="conv-1" builderName="Proof Homes" />;
    const view = render(card());
    state.conversation = { ...state.conversation, messages: [state.conversation.messages[0],
      MESSAGE({ id: 'm2', body: 'Arrived late.' }), state.conversation.messages[1]] };
    view.rerender(card());
    expect(scrolled[scrolled.length - 1]).toBe('message:m2');
  });
});

describe('a draft belongs to the conversation it was written in', () => {
  it('moving to another conversation clears the composer rather than carrying the text to another builder', () => {
    state.conversation = { conversation_id: 'c', open: true, can_send: true, messages: [] };
    const view = render(<BuilderConversationThread conversationId="conv-1" builderName="Proof Homes" />);
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: 'For the first property only.' } });
    view.rerender(<BuilderConversationThread conversationId="conv-2" builderName="Other Homes" />);
    expect((screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement).value).toBe('');
  });
});

describe('the whole history can be read', () => {
  const conversation = (overrides: Record<string, unknown> = {}) => ({
    conversation_id: 'conv-1', open: true, can_send: true, participants: [],
    messages: [MESSAGE({ id: 'newest', body: 'Newest message', sent_at: '2026-09-25T12:00:00Z' })],
    has_earlier: true, earlier_cursor: 'newest', ...overrides,
  });

  it('offers earlier messages while there are any, and adds each page above the window it already shows', async () => {
    state.conversation = conversation();
    earlierPages.newest = { messages: [MESSAGE({ id: 'older', body: 'Older message', sent_at: '2026-09-20T12:00:00Z' })],
      has_earlier: true, earlier_cursor: 'older' };
    earlierPages.older = { messages: [MESSAGE({ id: 'oldest', body: 'Oldest message', sent_at: '2026-09-10T12:00:00Z' })],
      has_earlier: false, earlier_cursor: null };
    render(<MemoryRouter><BuilderConversationThread conversationId="conv-1" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /show earlier messages/i }));
    expect(await screen.findByText('Older message')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show earlier messages/i }));
    expect(await screen.findByText('Oldest message')).toBeInTheDocument();
    expect(earlierAsked).toEqual(['newest', 'older']);
    const log = screen.getByRole('log');
    expect(within(log).getAllByText(/message$/).map((n) => n.textContent)).toEqual(['Oldest message', 'Older message', 'Newest message']);
    expect(screen.queryByRole('button', { name: /show earlier messages/i })).toBeNull();
  });

  it('a message that slides out of the polled window after an earlier page was read stays in the history', async () => {
    // A real window is 500 messages and moves by the few that arrived, so
    // consecutive windows overlap; two-message windows stand in for that.
    const w = (a: [string, string, string], b: [string, string, string], cursor: string) => conversation({
      messages: [MESSAGE({ id: a[0], body: a[1], sent_at: a[2] }), MESSAGE({ id: b[0], body: b[1], sent_at: b[2] })],
      earlier_cursor: cursor,
    });
    const NEWEST: [string, string, string] = ['newest', 'Newest message', '2026-09-25T12:00:00Z'];
    const MID: [string, string, string] = ['mid', 'Mid message', '2026-09-25T13:00:00Z'];
    const ARRIVED: [string, string, string] = ['arrived', 'Arrived message', '2026-09-26T12:00:00Z'];
    const LATEST: [string, string, string] = ['latest', 'Latest message', '2026-09-27T12:00:00Z'];
    state.conversation = w(NEWEST, MID, 'newest');
    earlierPages.newest = { messages: [MESSAGE({ id: 'older', body: 'Older message', sent_at: '2026-09-20T12:00:00Z' })],
      has_earlier: false, earlier_cursor: null };
    const view = render(<MemoryRouter><BuilderConversationThread conversationId="conv-1" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /show earlier messages/i }));
    expect(await screen.findByText('Older message')).toBeInTheDocument();
    // New messages arrive and the window moves on twice: the message the page
    // was read from, and then the one after it, leave the window.
    state.conversation = w(MID, ARRIVED, 'mid');
    view.rerender(<MemoryRouter><BuilderConversationThread conversationId="conv-1" /></MemoryRouter>);
    state.conversation = w(ARRIVED, LATEST, 'arrived');
    view.rerender(<MemoryRouter><BuilderConversationThread conversationId="conv-1" /></MemoryRouter>);
    const log = screen.getByRole('log');
    expect(within(log).getAllByText(/message$/).map((n) => n.textContent))
      .toEqual(['Older message', 'Newest message', 'Mid message', 'Arrived message', 'Latest message']);
  });

  it('a failed message from an earlier page that is sent again shows what the server now says of it', async () => {
    state.conversation = conversation();
    earlierPages.newest = { messages: [MESSAGE({ id: 'older', body: 'Older message', sent_at: '2026-09-20T12:00:00Z',
      delivery_state: 'failed', failure_reason: 'not_delivered', can_retry: true })], has_earlier: false, earlier_cursor: null };
    retryAnswer.message = MESSAGE({ id: 'older', body: 'Older message', sent_at: '2026-09-20T12:00:00Z',
      delivery_state: 'queued', can_retry: false });
    render(<MemoryRouter><BuilderConversationThread conversationId="conv-1" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /show earlier messages/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send again/i }));
    expect(retried).toEqual(['older']);
    await waitFor(() => expect(screen.queryByRole('button', { name: /send again/i })).toBeNull());
  });

  it('a poll window that no longer touches what was kept pages again from the new window, so nothing between is unreachable', async () => {
    state.conversation = conversation();
    earlierPages.newest = { messages: [MESSAGE({ id: 'older', body: 'Older message', sent_at: '2026-09-20T12:00:00Z' })],
      has_earlier: false, earlier_cursor: null };
    const view = render(<MemoryRouter><BuilderConversationThread conversationId="conv-1" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /show earlier messages/i }));
    expect(await screen.findByText('Older message')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show earlier messages/i })).toBeNull();
    // A whole window's worth arrived while the tab slept: the new window
    // shares nothing with the one kept, and there are messages between.
    state.conversation = conversation({
      messages: [MESSAGE({ id: 'far', body: 'Far later message', sent_at: '2026-09-30T12:00:00Z' })],
      has_earlier: true, earlier_cursor: 'far',
    });
    view.rerender(<MemoryRouter><BuilderConversationThread conversationId="conv-1" /></MemoryRouter>);
    earlierPages.far = { messages: [MESSAGE({ id: 'between', body: 'Between message', sent_at: '2026-09-28T12:00:00Z' })],
      has_earlier: true, earlier_cursor: 'between' };
    fireEvent.click(await screen.findByRole('button', { name: /show earlier messages/i }));
    expect(await screen.findByText('Between message')).toBeInTheDocument();
    expect(earlierAsked).toEqual(['newest', 'far']);
  });

  it('says nothing about earlier messages when there are none', () => {
    state.conversation = conversation({ has_earlier: false, earlier_cursor: null });
    render(<MemoryRouter><BuilderConversationThread conversationId="conv-1" /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /show earlier messages/i })).toBeNull();
  });
});
