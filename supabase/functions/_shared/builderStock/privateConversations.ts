/**
 * The reads behind Portals → Builder Portal and the property page's
 * conversations (docs/builder-portal/52).
 *
 * Membership is the authority. A conversation's messages and participants are
 * read only after the viewer is found among its CURRENT participants; for
 * anyone else the answer is `not_a_participant` and the messages are never
 * queried. Listings access, the property, the organisation and the id in the
 * request decide nothing.
 */
import { projectConversationMessages, type ConversationMessageView } from './agencyMessages.pure.ts';
import {
  activationKey, activationStatus, conversationClosedReason, projectParticipants, userDisplayName,
  type ActivatedPropertyRow, type ConversationClosedReason, type ConversationSummary, type ParticipantView,
} from './privateConversations.pure.ts';

export type { ActivatedPropertyRow, ConversationSummary } from './privateConversations.pure.ts';

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, any>;

/** How many participant rows one read asks for. */
const ROSTER_PAGE = 500;

const builderName = (org: Row | undefined) =>
  (typeof org?.trading_name === 'string' && org.trading_name.trim()) || org?.legal_name || null;
const designOf = (item: Row | undefined) =>
  item?.house_design ?? (item?.source_row && typeof item.source_row === 'object' ? item.source_row.house_design : null) ?? null;

export type ParticipantConversationRead =
  | {
    ok: true; conversation_id: string; stock_item_id: string; address: string | null; lot_number: string | null;
    builder_name: string | null; open: boolean; closed_reason: ConversationClosedReason | null;
    participants: ParticipantView[]; messages: ConversationMessageView[];
    /** Older messages exist before this page; ask again with `earlier_cursor`. */
    has_earlier: boolean; earlier_cursor: string | null;
  }
  | { ok: false; reason: 'not_found' | 'not_a_participant' | 'unavailable' };

export async function readParticipantConversation(
  supabase: Client, args: { conversationId: string; viewerUserId: string; beforeMessageId?: string | null },
): Promise<ParticipantConversationRead> {
  const { data: conversation, error } = await supabase.from('builder_network_conversations')
    .select('id, connection_id, stock_item_id, builder_organisation_id, selection_ref')
    .eq('id', args.conversationId).maybeSingle();
  if (error) return { ok: false, reason: 'unavailable' };
  if (!conversation) return { ok: false, reason: 'not_found' };

  // The whole roster, a page at a time, before membership is decided: a
  // response ceiling must never refuse somebody who is in the conversation.
  const rows: Row[] = [];
  for (let from = 0; ; from += ROSTER_PAGE) {
    const { data: people, error: peopleError } = await supabase.from('builder_network_conversation_participants')
      .select('participant_ref, side, local_user_id, display_name, state')
      .eq('conversation_id', conversation.id)
      .order('participant_ref', { ascending: true })
      .range(from, from + ROSTER_PAGE - 1);
    if (peopleError) return { ok: false, reason: 'unavailable' };
    const page = (people ?? []) as Row[];
    rows.push(...page);
    if (page.length < ROSTER_PAGE) break;
  }
  if (!rows.some((row) => row.local_user_id === args.viewerUserId && row.state === 'joined' && row.side === 'command_centre')) {
    return { ok: false, reason: 'not_a_participant' };
  }

  const [connection, selection, item, org] = await Promise.all([
    supabase.from('builder_network_connections').select('state, scopes, identity_mismatch_since')
      .eq('id', conversation.connection_id).maybeSingle(),
    conversation.selection_ref
      ? supabase.from('builder_stock_selections').select('status, acknowledged_at')
        .eq('id', conversation.selection_ref).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('builder_network_stock_items').select('lifecycle_status, address_line, lot_number, organisation_id')
      .eq('id', conversation.stock_item_id).maybeSingle(),
    supabase.from('builder_network_stock_organisations').select('legal_name, trading_name')
      .eq('id', conversation.builder_organisation_id).maybeSingle(),
  ]);
  if (connection.error || selection.error || item.error || org.error) return { ok: false, reason: 'unavailable' };

  const closed_reason = conversationClosedReason({
    connection: connection.data, selectionRef: conversation.selection_ref ?? null,
    selection: selection.data, item: item.data && item.data.organisation_id === conversation.builder_organisation_id ? item.data : null,
  });

  // A page is 500 messages by ARRIVAL here (Step 5's window), drawn in the
  // order written. The first read is the newest page; every earlier page is
  // reached by its cursor, so the whole history can be read however long it
  // grows — an invited colleague sees all of it.
  const history = await readMessagePage(supabase, String(conversation.id), args.beforeMessageId ?? null);
  if (!history.ok) return { ok: false, reason: 'unavailable' };
  const messages = history.rows;

  const open = closed_reason === null;
  return {
    ok: true,
    conversation_id: String(conversation.id),
    stock_item_id: String(conversation.stock_item_id),
    address: item.data?.address_line ?? null,
    lot_number: item.data?.lot_number ?? null,
    builder_name: builderName(org.data ?? undefined),
    open,
    closed_reason,
    participants: projectParticipants(rows, args.viewerUserId),
    messages: projectConversationMessages(messages, args.viewerUserId)
      .map((message) => ({ ...message, can_retry: message.can_retry && open })),
    has_earlier: history.hasEarlier,
    earlier_cursor: history.hasEarlier ? history.cursor : null,
  };
}

/** One page of a conversation's messages, by arrival. */
const MESSAGE_PAGE = 500;
const MESSAGE_COLUMNS = 'id, side, sender_user_id, sender_display_name, body, sent_at, delivery_state, delivered_at, failure_reason, created_at';
const byArrivalDesc = (a: Row, b: Row) =>
  (a.created_at === b.created_at ? (String(a.id) < String(b.id) ? 1 : -1) : (String(a.created_at) < String(b.created_at) ? 1 : -1));

/**
 * The page of messages that arrived before `beforeMessageId` (or the newest
 * page without one), newest first, and whether any arrived earlier still.
 * The cursor is a message of THIS conversation; one from anywhere else reaches
 * nothing. Arrival order is (created_at, id), so ties at a page boundary are
 * split by id: earlier timestamps in one read, the same timestamp with a
 * smaller id in another. No filter is composed as a string.
 */
async function readMessagePage(
  supabase: Client, conversationId: string, beforeMessageId: string | null,
): Promise<{ ok: true; rows: Row[]; hasEarlier: boolean; cursor: string | null } | { ok: false }> {
  let rows: Row[];
  if (!beforeMessageId) {
    const { data, error } = await supabase.from('builder_network_messages').select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(MESSAGE_PAGE + 1);
    if (error) return { ok: false };
    rows = (data ?? []) as Row[];
  } else {
    const { data: cursor, error: cursorError } = await supabase.from('builder_network_messages')
      .select('id, created_at').eq('id', beforeMessageId).eq('conversation_id', conversationId).maybeSingle();
    if (cursorError) return { ok: false };
    if (!cursor) return { ok: true, rows: [], hasEarlier: false, cursor: null };
    const [earlier, tied] = await Promise.all([
      supabase.from('builder_network_messages').select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId).lt('created_at', cursor.created_at)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(MESSAGE_PAGE + 1),
      supabase.from('builder_network_messages').select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId).eq('created_at', cursor.created_at).lt('id', cursor.id)
        .order('id', { ascending: false })
        .limit(MESSAGE_PAGE + 1),
    ]);
    if (earlier.error || tied.error) return { ok: false };
    rows = [...((tied.data ?? []) as Row[]), ...((earlier.data ?? []) as Row[])].sort(byArrivalDesc);
  }
  const hasEarlier = rows.length > MESSAGE_PAGE;
  const page = rows.slice(0, MESSAGE_PAGE);
  return { ok: true, rows: page, hasEarlier, cursor: page.length ? String(page[page.length - 1].id) : null };
}

const ACTIVATION_PAGE = 500;
const IN_CHUNK = 200;

/** A `.in()` lookup over any number of ids, asked in bounded chunks. */
async function readIn(
  supabase: Client, table: string, columns: string, column: string, values: unknown[],
): Promise<{ data: Row[]; error: unknown }> {
  const ids = [...new Set(values.map(String))];
  const data: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data: rows, error } = await supabase.from(table).select(columns).in(column, ids.slice(i, i + IN_CHUNK));
    if (error) return { data: [], error };
    data.push(...((rows ?? []) as Row[]));
  }
  return { data, error: null };
}

/**
 * Every conversation the viewer is in now, a page at a time: a response cap
 * would otherwise drop some with nothing saying so. `null` when a read failed.
 */
async function joinedConversationIds(supabase: Client, viewerUserId: string): Promise<string[] | null> {
  const ids: string[] = [];
  for (let from = 0; ; from += ACTIVATION_PAGE) {
    const { data, error } = await supabase.from('builder_network_conversation_participants')
      .select('conversation_id')
      .eq('local_user_id', viewerUserId).eq('side', 'command_centre').eq('state', 'joined')
      .order('conversation_id', { ascending: true })
      .range(from, from + ACTIVATION_PAGE - 1);
    if (error) return null;
    const page = (data ?? []) as Row[];
    ids.push(...page.map((row) => String(row.conversation_id)));
    if (page.length < ACTIVATION_PAGE) return ids;
  }
}

/** The conversations one person is in now — the inbox. */
async function summaries(
  supabase: Client, viewerUserId: string, filter: { stockItemId?: string },
): Promise<{ ok: true; conversations: ConversationSummary[] } | { ok: false }> {
  const ids = await joinedConversationIds(supabase, viewerUserId);
  if (!ids) return { ok: false };
  if (!ids.length) return { ok: true, conversations: [] };

  const conversations = await readIn(supabase, 'builder_network_conversations',
    'id, stock_item_id, builder_organisation_id, selection_ref, last_message_at', 'id', ids);
  if (conversations.error) return { ok: false };
  const list = conversations.data.filter((c) => !filter.stockItemId || c.stock_item_id === filter.stockItemId);
  if (!list.length) return { ok: true, conversations: [] };

  const [items, orgs, selections] = await Promise.all([
    readIn(supabase, 'builder_network_stock_items', 'id, address_line, lot_number',
      'id', list.map((c) => c.stock_item_id)),
    readIn(supabase, 'builder_network_stock_organisations', 'id, legal_name, trading_name',
      'id', list.map((c) => c.builder_organisation_id)),
    readIn(supabase, 'builder_stock_selections', 'id, status, acknowledged_at',
      'id', list.map((c) => c.selection_ref).filter(Boolean)),
  ]);
  if (items.error || orgs.error || selections.error) return { ok: false };
  const itemById = new Map(((items.data ?? []) as Row[]).map((row) => [row.id, row]));
  const orgById = new Map(((orgs.data ?? []) as Row[]).map((row) => [row.id, row]));
  const selectionById = new Map(((selections.data ?? []) as Row[]).map((row) => [row.id, row]));

  return {
    ok: true,
    conversations: list.map((c) => {
      const selection = c.selection_ref ? selectionById.get(c.selection_ref) : undefined;
      return {
        conversation_id: String(c.id),
        stock_item_id: String(c.stock_item_id),
        address: itemById.get(c.stock_item_id)?.address_line ?? null,
        lot_number: itemById.get(c.stock_item_id)?.lot_number ?? null,
        builder_name: builderName(orgById.get(c.builder_organisation_id)),
        status: selection ? activationStatus(selection) : null,
        last_message_at: c.last_message_at ?? null,
      };
    }).sort((a, b) => String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? ''))
      || a.conversation_id.localeCompare(b.conversation_id)),
  };
}

/** One message a builder wrote, as the new-message popup names it. */
export interface NewBuilderMessage {
  message_id: string;
  conversation_id: string;
  builder_name: string | null;
  sender_display_name: string;
  lot_number: string | null;
  address: string | null;
  received_at: string;
}

/** How many new messages one read returns: a popup names a few, never a flood. */
const NEW_MESSAGE_LIMIT = 20;

/**
 * The builder-side messages that arrived after `since`, in the conversations
 * the viewer is in now — what the Command Centre's "new message" popup shows.
 * The cursor is the arrival clock of THIS database (`created_at`, stamped when
 * the message landed), never a browser's, so no clock skew can hide or repeat
 * one. With no `since`, it answers only the cursor: a session that has just
 * opened is told nothing about messages it arrived after.
 */
export async function newBuilderMessages(
  supabase: Client, args: { viewerUserId: string; since: string | null },
): Promise<{ ok: true; cursor: string; messages: NewBuilderMessage[] } | { ok: false }> {
  const ids = await joinedConversationIds(supabase, args.viewerUserId);
  if (!ids) return { ok: false };
  const now = new Date().toISOString();
  if (!ids.length) return { ok: true, cursor: args.since ?? now, messages: [] };

  const found: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    let query = supabase.from('builder_network_messages')
      .select('id, conversation_id, sender_display_name, created_at')
      .in('conversation_id', ids.slice(i, i + IN_CHUNK))
      .eq('side', 'builder');
    query = args.since
      ? query.gt('created_at', args.since).order('created_at', { ascending: true }).limit(NEW_MESSAGE_LIMIT)
      : query.order('created_at', { ascending: false }).limit(1);
    const { data, error } = await query;
    if (error) return { ok: false };
    found.push(...((data ?? []) as Row[]));
  }
  const latest = found.reduce<string | null>(
    (max, row) => (!max || String(row.created_at) > max ? String(row.created_at) : max), null);
  if (!args.since) return { ok: true, cursor: latest ?? now, messages: [] };

  const fresh = found.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .slice(0, NEW_MESSAGE_LIMIT);
  if (!fresh.length) return { ok: true, cursor: args.since, messages: [] };

  const conversations = await readIn(supabase, 'builder_network_conversations',
    'id, stock_item_id, builder_organisation_id', 'id', [...new Set(fresh.map((m) => m.conversation_id))]);
  if (conversations.error) return { ok: false };
  const conversationById = new Map(((conversations.data ?? []) as Row[]).map((row) => [row.id, row]));
  const [items, orgs] = await Promise.all([
    readIn(supabase, 'builder_network_stock_items', 'id, address_line, lot_number',
      'id', [...conversationById.values()].map((c) => c.stock_item_id)),
    readIn(supabase, 'builder_network_stock_organisations', 'id, legal_name, trading_name',
      'id', [...conversationById.values()].map((c) => c.builder_organisation_id)),
  ]);
  if (items.error || orgs.error) return { ok: false };
  const itemById = new Map(((items.data ?? []) as Row[]).map((row) => [row.id, row]));
  const orgById = new Map(((orgs.data ?? []) as Row[]).map((row) => [row.id, row]));

  return {
    ok: true,
    // The newest arrival returned: the next read starts after it. When the
    // limit was reached, the rest are returned by the next read.
    cursor: String(fresh[fresh.length - 1].created_at),
    messages: fresh.map((m) => {
      const conversation = conversationById.get(m.conversation_id);
      const item = conversation ? itemById.get(conversation.stock_item_id) : undefined;
      return {
        message_id: String(m.id),
        conversation_id: String(m.conversation_id),
        builder_name: conversation ? builderName(orgById.get(conversation.builder_organisation_id)) : null,
        sender_display_name: String(m.sender_display_name),
        lot_number: item?.lot_number ?? null,
        address: item?.address_line ?? null,
        received_at: String(m.created_at),
      };
    }),
  };
}

export function listMyConversations(supabase: Client, args: { viewerUserId: string }) {
  return summaries(supabase, args.viewerUserId, {});
}

/** On a property's page: only the viewer's own conversations about it. */
export function listPropertyConversations(supabase: Client, args: { stockItemId: string; viewerUserId: string }) {
  return summaries(supabase, args.viewerUserId, { stockItemId: args.stockItemId });
}

/** One row per activation: the property, the builder company, and the people. */
export async function listActivatedProperties(
  supabase: Client, args: { viewerUserId: string },
): Promise<{ ok: true; activations: ActivatedPropertyRow[] } | { ok: false }> {
  // Every activation, read a page at a time: a fixed cap would silently drop
  // the oldest ones and their conversation links from the portal.
  const list: Row[] = [];
  for (let from = 0; ; from += ACTIVATION_PAGE) {
    const { data, error } = await supabase.from('builder_stock_selections')
      .select('id, stock_item_id, organisation_id, selected_by_user_id, selected_at, status, acknowledged_at, acknowledged_by_display_name')
      .order('selected_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + ACTIVATION_PAGE - 1);
    if (error) return { ok: false };
    const page = (data ?? []) as Row[];
    list.push(...page);
    if (page.length < ACTIVATION_PAGE) break;
  }
  if (!list.length) return { ok: true, activations: [] };

  const [items, orgs, users, conversations, mine] = await Promise.all([
    readIn(supabase, 'builder_network_stock_items', 'id, address_line, suburb, lot_number, primary_image_id, source_row',
      'id', list.map((s) => s.stock_item_id)),
    readIn(supabase, 'builder_network_stock_organisations', 'id, legal_name, trading_name, contact_email, contact_phone, website',
      'id', list.map((s) => s.organisation_id)),
    readIn(supabase, 'custom_users', 'id, username, first_name, last_name',
      'id', list.map((s) => s.selected_by_user_id).filter(Boolean)),
    readIn(supabase, 'builder_network_conversations', 'id, selection_ref',
      'selection_ref', list.map((s) => s.id)),
    joinedConversationIds(supabase, args.viewerUserId),
  ]);
  if (items.error || orgs.error || users.error || conversations.error || !mine) return { ok: false };
  const itemById = new Map(((items.data ?? []) as Row[]).map((row) => [row.id, row]));
  const orgById = new Map(((orgs.data ?? []) as Row[]).map((row) => [row.id, row]));
  const userById = new Map(((users.data ?? []) as Row[]).map((row) => [row.id, row]));
  const conversationBySelection = new Map(((conversations.data ?? []) as Row[]).map((row) => [row.selection_ref, String(row.id)]));
  const joined = new Set(mine);

  return {
    ok: true,
    activations: list.map((s) => {
      const item = itemById.get(s.stock_item_id);
      const org = orgById.get(s.organisation_id);
      const conversation = conversationBySelection.get(s.id) ?? null;
      return {
        activation_key: activationKey(String(s.id)),
        stock_item_id: String(s.stock_item_id),
        address: item?.address_line ?? null,
        suburb: item?.suburb ?? null,
        lot_number: item?.lot_number ?? null,
        house_design: designOf(item),
        primary_image_id: item?.primary_image_id ?? null,
        builder_name: builderName(org),
        builder_email: org?.contact_email ?? null,
        builder_phone: org?.contact_phone ?? null,
        builder_website: org?.website ?? null,
        activated_by: userDisplayName(userById.get(s.selected_by_user_id)),
        activated_at: s.selected_at ?? null,
        acknowledged_by: s.acknowledged_by_display_name ?? null,
        acknowledged_at: s.acknowledged_at ?? null,
        status: activationStatus(s),
        conversation_id: conversation && joined.has(conversation) ? conversation : null,
      };
    }),
  };
}

/**
 * The Builder Portal badge. The bell reads only its newest fifty
 * notifications, so an unread acknowledgement older than that would drop out
 * of any count taken there; this counts every one the viewer holds, and only
 * the viewer's. A count that could not be read is not a count of zero.
 */
const ACKNOWLEDGEMENT_NOTICE = 'builder_activation_acknowledged';

export async function countUnreadAcknowledgementNotices(
  supabase: Client, args: { viewerUserId: string },
): Promise<{ ok: true; count: number } | { ok: false }> {
  const { count, error } = await supabase.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('target_user_id', args.viewerUserId)
    .eq('type', ACKNOWLEDGEMENT_NOTICE)
    .eq('read', false);
  if (error || typeof count !== 'number') return { ok: false };
  return { ok: true, count };
}

/**
 * Seeing Activated Properties is seeing the acknowledgements — the ones that
 * list could have shown. `asOf` is the server's time taken before that list
 * was read; an acknowledgement created after it was not on the screen and
 * stays unread. Without a readable cutoff nothing is marked.
 */
export async function markAcknowledgementNoticesRead(
  supabase: Client, args: { viewerUserId: string; asOf: string },
): Promise<{ ok: boolean }> {
  if (typeof args.asOf !== 'string' || !Number.isFinite(Date.parse(args.asOf))) return { ok: false };
  const { error } = await supabase.from('notifications')
    .update({ read: true })
    .eq('target_user_id', args.viewerUserId)
    .eq('type', ACKNOWLEDGEMENT_NOTICE)
    .eq('read', false)
    .lte('created_at', new Date(Date.parse(args.asOf)).toISOString());
  return { ok: !error };
}
