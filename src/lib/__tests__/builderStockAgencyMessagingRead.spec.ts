/**
 * AGENCY MESSAGING — WHAT THE COMMAND CENTRE PAGE READS AND WRITES.
 *
 * The rows are proved by builderStockAgencyMessaging.spec.ts. This pins what
 * stands in front of them: the conversation a property page reads is the one
 * its builder's authorised connection derives, it serves only what a person
 * may see (never a user id, the client key, or anything about the client),
 * writing needs Listings edit, and the sender is the session's user — never a
 * value in the request.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agencyMessageRefusal,
  projectConversationMessages,
} from '../../../supabase/functions/_shared/builderStock/agencyMessages.pure';
import { readParticipantConversation } from '../../../supabase/functions/_shared/builderStock/privateConversations';
import { conversationClosedReason } from '../../../supabase/functions/_shared/builderStock/privateConversations.pure';
import { agencyDedupeKeyFor, agencyMessageRouteHeld, agencyPayloadContractViolation, sameAgencyEnvelope } from '../../../supabase/functions/_shared/builderStock/agencyMessages.pure';
import {
  BUILDER_CONVERSATION_CLOSED_POLL_MS, BUILDER_CONVERSATION_POLL_MS, builderConversationPollInterval,
} from '../marketplaceBuilderStock';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const readCode = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

type Row = Record<string, any>;
function standIn(tables: Record<string, Row[]>) {
  const log: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const from = (table: string) => {
    const entry = { table, filters: [] as Array<[string, string, unknown]> };
    log.push(entry);
    let orders: Array<[string, boolean]> = [];
    let cap = Infinity;
    let offset = 0;
    const builder: any = {
      select() { return builder; },
      eq(col: string, v: unknown) { entry.filters.push(['eq', col, v]); return builder; },
      neq(col: string, v: unknown) { entry.filters.push(['neq', col, v]); return builder; },
      contains(col: string, v: unknown[]) { entry.filters.push(['contains', col, v]); return builder; },
      in(col: string, v: unknown[]) { entry.filters.push(['in', col, v]); return builder; },
      order(col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) { orders = [...orders, [col, o?.ascending !== false]]; return builder; },
      limit(n: number) { cap = n; return builder; },
      range(a: number, b: number) { offset = a; cap = b - a + 1; return builder; },
      maybeSingle() { return builder.then((r: any) => ({ data: r.data[0] ?? null, error: null })); },
      then(resolve: (v: unknown) => unknown) {
        let rows = (tables[table] ?? []).filter((row) => entry.filters.every(([op, col, v]) =>
          op === 'eq' ? row[col] === v : op === 'neq' ? row[col] !== v
            : op === 'in' ? (v as unknown[]).includes(row[col])
            : (v as unknown[]).every((x) => (row[col] ?? []).includes(x))));
        for (const [col, asc] of [...orders].reverse()) {
          rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
        }
        return Promise.resolve({ data: rows.slice(offset, offset + cap), error: null }).then(resolve);
      },
    };
    return builder;
  };
  return { client: { from }, log };
}

const ORG = 'org-a';
const ITEM = '00000000-0000-4000-8000-0000000000a1';
const NET = '00000000-0000-4000-8000-0000000000c1';
const ME = 'user-me';

function fixture() {
  const conversation = 'conv-a';
  return {
    conversation,
    tables: {
      builder_network_conversations: [
        { id: conversation, connection_id: 'conn-a', stock_item_id: ITEM, builder_organisation_id: ORG, selection_ref: 's1' },
        { id: 'conv-old', connection_id: 'conn-revoked', stock_item_id: ITEM, builder_organisation_id: ORG, selection_ref: null },
      ],
      // Since Step 6 a conversation is read by its participants (docs/builder-portal/52).
      builder_network_conversation_participants: [
        { conversation_id: conversation, participant_ref: 'ref-me', side: 'command_centre', local_user_id: ME, display_name: 'Olive Owner', state: 'joined' },
      ],
      builder_network_stock_items: [{ id: ITEM, organisation_id: ORG, lifecycle_status: 'active', address_line: '1 Check Street', lot_number: '101' }],
      builder_network_stock_organisations: [{ id: ORG, legal_name: 'Check Homes Pty Ltd', trading_name: null }],
      builder_network_connections: [
        { id: 'conn-a', network_connection_id: NET, builder_organisation_id: ORG, state: 'active', scopes: ['stock:publish'], accepted_at: '2026-09-01' },
        { id: 'conn-revoked', network_connection_id: 'net-old', builder_organisation_id: ORG, state: 'revoked', scopes: ['stock:publish'], accepted_at: '2026-10-01' },
      ],
      builder_stock_selections: [
        { id: 's1', stock_item_id: ITEM, organisation_id: ORG, status: 'builder_acknowledged', acknowledged_at: '2026-09-25T09:00:00Z',
          client_id: 'private-client', internal_notes: 'private' },
      ],
      builder_network_messages: [
        { id: 'm2', conversation_id: conversation, side: 'builder', sender_display_name: 'Avery Builder', body: 'Reply',
          sent_at: '2026-09-25T11:00:00Z', delivery_state: null, delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null },
        { id: 'm1', conversation_id: conversation, side: 'command_centre', sender_display_name: 'Olive Owner', body: 'Question',
          sent_at: '2026-09-25T10:00:00Z', delivery_state: 'failed', delivered_at: null, failure_reason: 'not_delivered', sender_user_id: ME, client_message_id: 'client-1' },
        { id: 'm3', conversation_id: conversation, side: 'command_centre', sender_display_name: 'Casey Colleague', body: 'Follow-up',
          sent_at: '2026-09-25T12:00:00Z', delivery_state: 'delivered', delivered_at: '2026-09-25T12:00:04Z', failure_reason: null, sender_user_id: 'user-colleague', client_message_id: 'client-2' },
        { id: 'other', conversation_id: 'another-conversation', side: 'builder', sender_display_name: 'X', body: 'Not this one',
          sent_at: '2026-09-25T09:00:00Z', delivery_state: null, delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null },
      ],
    } as Record<string, Row[]>,
  };
}

describe('reading an activation\'s conversation (a participant)', () => {
  it('reads the conversation on the builder\'s active connection, in the order it was written', async () => {
    const { tables } = fixture();
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages.map((m) => m.body)).toEqual(['Question', 'Reply', 'Follow-up']);
    expect(read.open).toBe(true);
    expect(read.closed_reason).toBeNull();
    expect(JSON.stringify(read)).not.toContain('Not this one');
  });

  it('past the cap, the thread shows the NEWEST messages, still in reading order', async () => {
    const { tables, conversation } = fixture();
    tables.builder_network_messages = Array.from({ length: 501 }, (_, i) => ({
      id: `m${String(i).padStart(4, '0')}`, conversation_id: conversation, side: 'builder',
      sender_display_name: 'Avery Builder', body: `Message ${i}`,
      sent_at: new Date(Date.UTC(2026, 8, 25, 0, 0, i)).toISOString(), delivery_state: null,
      delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null,
      created_at: new Date(Date.UTC(2026, 8, 25, 0, 0, i)).toISOString(),
    }));
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages).toHaveLength(500);
    expect(read.messages[0].body).toBe('Message 1');
    expect(read.messages[499].body).toBe('Message 500');
  });

  it('past the cap, a message that arrived late with an older time still reaches the thread, in its place', async () => {
    const { tables, conversation } = fixture();
    tables.builder_network_messages = Array.from({ length: 500 }, (_, i) => ({
      id: `m${String(i).padStart(4, '0')}`, conversation_id: conversation, side: 'builder',
      sender_display_name: 'Avery Builder', body: `Message ${i}`,
      sent_at: new Date(Date.UTC(2026, 8, 25, 1, 0, i)).toISOString(), created_at: new Date(Date.UTC(2026, 8, 25, 1, 0, i)).toISOString(),
      delivery_state: null, delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null,
    }));
    tables.builder_network_messages.push({
      id: 'late', conversation_id: conversation, side: 'builder', sender_display_name: 'Avery Builder', body: 'Written earlier, arrived late',
      sent_at: '2026-09-25T00:30:00.000Z', created_at: '2026-09-25T02:00:00.000Z',
      delivery_state: null, delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null,
    });
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages[0].body).toBe('Written earlier, arrived late');
    expect(read.messages.filter((m) => m.id === 'late')).toHaveLength(1);
    expect(read.messages[read.messages.length - 1].body).toBe('Message 499');
  });

  it('a late message stays in the thread while later messages arrive, until 500 newer ones have', async () => {
    const { tables, conversation } = fixture();
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 1, minute)).toISOString();
    const row = (id: string, sent: string, created: string) => ({
      id, conversation_id: conversation, side: 'builder', sender_display_name: 'Avery Builder', body: id, sent_at: sent, created_at: created,
      delivery_state: null, delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null,
    });
    tables.builder_network_messages = Array.from({ length: 500 }, (_, i) => row(`old${String(i).padStart(3, '0')}`, at(100 + i), at(100 + i)));
    tables.builder_network_messages.push(row('late', at(0), at(700)));
    for (let i = 0; i < 60; i += 1) tables.builder_network_messages.push(row(`after${String(i).padStart(2, '0')}`, at(800 + i), at(800 + i)));
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages).toHaveLength(500);
    expect(read.messages[0].id).toBe('late');
    expect(read.messages[read.messages.length - 1].id).toBe('after59');
  });

  it('a withdrawn activation\'s conversation is closed, and a conversation that does not exist is not found', async () => {
    const { tables } = fixture();
    tables.builder_stock_selections[0].status = 'withdrawn';
    const closed = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    expect(closed).toMatchObject({ ok: true, open: false, closed_reason: 'withdrawn' });
    tables.builder_network_conversations = [];
    const none = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    expect(none).toEqual({ ok: false, reason: 'not_found' });
  });

  it('18. polling refresh gets new messages: the next read carries what was written since the last', async () => {
    const { tables, conversation } = fixture();
    const first = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!first.ok) throw new Error('read failed');
    expect(first.messages.map((m) => m.id)).not.toContain('m-new');
    tables.builder_network_messages.push({
      id: 'm-new', conversation_id: conversation, side: 'builder', sender_display_name: 'Avery Builder', body: 'Just arrived',
      sent_at: '2026-09-25T13:00:00Z', delivery_state: null, delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null,
    });
    const next = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!next.ok) throw new Error('read failed');
    expect(next.messages.at(-1)?.body).toBe('Just arrived');
    expect(readCode('src/lib/marketplaceBuilderStock.ts'))
      .toMatch(/refetchInterval:\s*\(query\)\s*=>\s*conversationRefetchInterval\(query\.state\)/);
    expect(readCode('src/lib/marketplaceBuilderStock.ts'))
      .toMatch(/conversationAccessLost\(state\.error\)\s*\?\s*false\s*:\s*builderConversationPollInterval\(state\.data\)/);
  });

  it('polls an open conversation, and a closed one only slowly, so a re-activation elsewhere still reopens it', () => {
    expect(builderConversationPollInterval(undefined)).toBe(BUILDER_CONVERSATION_POLL_MS);
    expect(builderConversationPollInterval({ open: true })).toBe(BUILDER_CONVERSATION_POLL_MS);
    expect(builderConversationPollInterval({ open: false })).toBe(BUILDER_CONVERSATION_CLOSED_POLL_MS);
    expect(BUILDER_CONVERSATION_CLOSED_POLL_MS).toBeGreaterThanOrEqual(6 * BUILDER_CONVERSATION_POLL_MS);
    // Activating from this page invalidates the conversation, so a closed one
    // opens without having to be polled for.
    expect(readCode('src/lib/marketplaceBuilderStock.ts'))
      .toMatch(/useSelectBuilderStockForClient[\s\S]*?invalidateQueries\(\{ queryKey: marketplaceStockKeys\.root\(\) \}\)/);
  });

  it('a connection that has lost stock:publish keeps its history readable, and is closed to writing', async () => {
    const { tables } = fixture();
    tables.builder_network_connections[0].scopes = [];
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages.map((m) => m.body)).toEqual(['Question', 'Reply', 'Follow-up']);
    expect(read.open).toBe(false);
    // The activation stands: what is closed is the ROUTE, and the reader is
    // told that rather than sent to activate a property that is activated.
    expect(read.closed_reason).toBe('connection_paused');
  });

  it('with no live activation AND a paused route, the reason is the activation: restoring the route alone would not open it', async () => {
    const { tables } = fixture();
    tables.builder_network_connections[0].scopes = [];
    tables.builder_stock_selections[0].status = 'withdrawn';
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.closed_reason).toBe('withdrawn');
  });

  it('a disputed connection keeps its history readable, and is closed to writing', async () => {
    const { tables } = fixture();
    tables.builder_network_connections[0].identity_mismatch_since = '2026-09-25T00:00:00Z';
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages).toHaveLength(3);
    expect(read.open).toBe(false);
    expect(read.closed_reason).toBe('connection_halted');
  });

  it('a revoked connection keeps its history readable, and nothing can be sent or retried', async () => {
    const { tables } = fixture();
    tables.builder_network_connections[0].state = 'revoked';
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages.map((m) => m.body)).toEqual(['Question', 'Reply', 'Follow-up']);
    expect(read).toMatchObject({ open: false, closed_reason: 'not_connected' });
    expect(read.messages.some((m) => m.can_retry)).toBe(false);
  });

  it('a conversation belongs to the connection its activation was acknowledged over: another conversation\'s messages never join it', async () => {
    const { tables } = fixture();
    tables.builder_network_messages.push({ id: 'm4', conversation_id: 'conv-old', side: 'command_centre', sender_display_name: 'Olive Owner',
      body: 'On the old connection', sent_at: '2026-11-02T10:00:00Z', delivery_state: 'failed', delivered_at: null,
      failure_reason: 'not_delivered', sender_user_id: ME, client_message_id: 'client-4' });
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages.map((m) => m.body)).toEqual(['Question', 'Reply', 'Follow-up']);
  });

  it('20. someone who is not in the conversation reads nothing of it', async () => {
    const { tables } = fixture();
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: 'user-colleague' });
    expect(read).toEqual({ ok: false, reason: 'not_a_participant' });
  });

  it('never carries a user id, the client key, or anything about the client', async () => {
    const { tables } = fixture();
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-a', viewerUserId: ME });
    const text = JSON.stringify(read);
    for (const secret of [ME, 'user-colleague', 'client-1', 'private-client', 'private']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('what a message tells the reader', () => {
  const { tables, conversation } = fixture();
  const projected = projectConversationMessages(
    tables.builder_network_messages.filter((m) => m.conversation_id === conversation), ME);

  it('names the actual sender on every message', () => {
    expect(projected.map((m) => m.sender_display_name)).toEqual(['Olive Owner', 'Avery Builder', 'Casey Colleague']);
  });
  it('shows a delivery state only for what the Command Centre sent', () => {
    expect(projected.map((m) => m.delivery_state)).toEqual(['failed', null, 'delivered']);
  });
  it('offers a retry only to the writer of a failed message', () => {
    expect(projected.map((m) => [m.mine, m.can_retry])).toEqual([[true, true], [false, false], [false, false]]);
  });
});

describe('refusals', () => {
  it.each([
    ['AGENCY_CONVERSATION_NOT_FOUND', 404],
    ['AGENCY_CONVERSATION_NOT_OPEN', 409],
    ['AGENCY_MESSAGE_INVALID', 400],
    ['AGENCY_MESSAGE_NOT_RETRYABLE', 409],
    ['AGENCY_SENDER_NOT_A_MEMBER', 403],
    ['AGENCY_NETWORK_DISABLED', 409],
    ['AGENCY_CONNECTION_HALTED', 409],
  ])('%s → %i', (raw, status) => {
    expect(agencyMessageRefusal(`ERROR: ${raw}`)?.status).toBe(status);
  });
});

describe('the edge operations', () => {
  const market = readCode('supabase/functions/builder-stock-marketplace/index.ts');
  const op = (name: string) => {
    const start = market.indexOf(`operation === '${name}'`);
    const next = market.indexOf('operation ===', start + 20);
    return market.slice(start, next > 0 ? next : undefined);
  };

  it('7. reading sits behind the Listings view gate every operation passes through', () => {
    const gate = market.indexOf("requireModulePermission(supabase, actor, 'listings', 'can_view')");
    expect(gate).toBeGreaterThan(-1);
    for (const name of ['get_builder_conversation', 'send_builder_message', 'retry_builder_message']) {
      expect(market.indexOf(`operation === '${name}'`), name).toBeGreaterThan(gate);
    }
  });

  it('7. writing needs Listings edit', () => {
    for (const name of ['send_builder_message', 'retry_builder_message']) {
      expect(op(name)).toContain("requireModulePermission(supabase, actor, 'listings', 'can_edit')");
    }
  });

  it('the sender is the session\'s user; the request names no user or organisation', () => {
    expect(op('send_builder_message')).toContain('_sender_user_id: userId');
    expect(op('retry_builder_message')).toContain('_sender_user_id: userId');
    for (const name of ['get_builder_conversation', 'send_builder_message', 'retry_builder_message']) {
      expect(op(name), name).not.toMatch(/body\.(user_id|userId|sender|organisation_id|connection_id)/);
    }
  });

  it('no model and no email', () => {
    for (const name of ['send_builder_message', 'retry_builder_message', 'get_builder_conversation']) {
      expect(op(name)).not.toMatch(/openrouter|anthropic|openai|resend|sendEmail/i);
    }
  });
});

describe('the worker holds a message whose route stopped being deliverable', () => {
  it('holds agency messages on a disputed connection or one without stock:publish, and nothing else', () => {
    const healthy = { identity_mismatch_since: null, scopes: ['stock:publish'] };
    expect(agencyMessageRouteHeld(healthy, 'agency.message.posted')).toBe(false);
    expect(agencyMessageRouteHeld({ ...healthy, identity_mismatch_since: '2026-09-25T00:00:00Z' }, 'agency.message.posted')).toBe(true);
    expect(agencyMessageRouteHeld({ ...healthy, scopes: [] }, 'agency.message.posted')).toBe(true);
    expect(agencyMessageRouteHeld({ ...healthy, scopes: null }, 'agency.message.posted')).toBe(true);
    // A withdrawn scope holds new CONTENT, not a receipt: the refusal that
    // tells the builder why must reach it.
    expect(agencyMessageRouteHeld({ ...healthy, scopes: [] }, 'agency.message.receipt')).toBe(false);
    // An identity dispute holds everything.
    expect(agencyMessageRouteHeld({ ...healthy, identity_mismatch_since: '2026-09-25T00:00:00Z' }, 'agency.message.receipt')).toBe(true);
    // Stock events are not this module's to hold.
    expect(agencyMessageRouteHeld({ ...healthy, identity_mismatch_since: '2026-09-25T00:00:00Z' }, 'stock.selection.announced')).toBe(false);
  });

  it('the worker asks before it sends, and a hold spends no delivery attempt', () => {
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    const drain = worker.slice(worker.indexOf('async function drainBuilderNetworkOutbox'));
    expect(drain.indexOf('agencyMessageRouteHeld(')).toBeGreaterThan(-1);
    expect(drain.indexOf('agencyMessageRouteHeld(')).toBeLessThan(drain.indexOf('fetch('));
    // The park is one locked statement in the database, so a recovery that
    // lands between the check and the park cannot be overwritten by it.
    expect(drain).toMatch(/rpc\('builder_network_park_held_message'/);
    // A message never overtakes the activation it depends on.
    expect(drain.indexOf("rpc('builder_network_defer_message_behind_activation'")).toBeGreaterThan(-1);
    expect(drain.indexOf("rpc('builder_network_defer_message_behind_activation'")).toBeLessThan(drain.indexOf('fetch('));
    // A failed check is not a pass: the row is retried, never sent unchecked.
    expect(drain).toMatch(/error: deferError \} = await db\.rpc\('builder_network_defer_message_behind_activation'/);
    expect(drain).toMatch(/if \(deferError\) \{ await release\(event, 'activation_order_unchecked'\)/);
    expect(drain).not.toMatch(/available_at:\s*'infinity'/);
  });

  it('a park that fails releases the row, so a route that recovers is not left waiting on a stale lock', () => {
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    const drain = worker.slice(worker.indexOf('async function drainBuilderNetworkOutbox'));
    expect(drain).toMatch(/error: parkError \} = await db\.rpc\('builder_network_park_held_message'/);
    expect(drain).toMatch(/if \(parkError\) \{ await release\(event, 'route_hold_unrecorded'\)/);
  });
});

describe('a reader who may not write', () => {
  it('is never offered a button the server would refuse: send and retry follow edit, the activation and the network switch', () => {
    const market = readCode('supabase/functions/builder-stock-marketplace/index.ts');
    const start = market.indexOf("operation === 'get_builder_conversation'");
    const op = market.slice(start, market.indexOf('operation ===', start + 20));
    // Since Step 6 the reader decides openness, including a delisted property
    // (conversationClosedReason), and the page is offered nothing more.
    expect(op).toMatch(/const canSend = read\.open && listingsEdit\.ok && networkOn/);
    expect(op).toMatch(/open: read\.open,\s*\n\s*closed_reason: read\.closed_reason/);
    expect(op).toMatch(/can_send:\s*canSend/);
    expect(op).toMatch(/can_retry:\s*message\.can_retry\s*&&\s*canSend/);
  });
});

describe('a property the builder stopped listing', () => {
  const market = readCode('supabase/functions/builder-stock-marketplace/index.ts');
  const opOf = (name: string) => {
    const start = market.indexOf(`operation === '${name}'`);
    return market.slice(start, market.indexOf('operation ===', start + 20));
  };
  it('keeps its page and its conversation readable where this deployment activated it', () => {
    const loader = market.slice(market.indexOf('const loadReadableItem'), market.indexOf('// Reads'));
    expect(loader).toMatch(/lifecycle_status === 'active'/);
    expect(loader).toMatch(/from\('builder_stock_selections'\)/);
    expect(opOf('get_stock_item')).toMatch(/await loadReadableItem\(/);
    // The conversation is read by its participants whatever the listing, and
    // says it is delisted.
    expect(conversationClosedReason({
      connection: { state: 'active', scopes: ['stock:publish'] }, selectionRef: 's1',
      selection: { status: 'builder_acknowledged', acknowledged_at: '2026-09-25' }, item: { lifecycle_status: 'archived' },
    })).toBe('delisted');
  });
  it('writes nothing new to it: sending is refused by the database, and activating still needs active stock', () => {
    const sql = readCode('supabase/migrations/20261224090000_one_activation_one_private_conversation.sql');
    expect(sql).toMatch(/i\.lifecycle_status = 'active'[\s\S]{0,120}RETURN 'delisted'/);
    expect(opOf('select_for_client')).toMatch(/await loadItem\(/);
  });
});

describe('the exact message contract, at the door', () => {
  const posted = {
    schema_version: 1, conversation_id: '00000000-0000-4000-8000-00000000000c', message_id: '00000000-0000-4000-8000-00000000000d', stock_item_id: 'i', body: 'Hello',
    sender_display_name: 'Avery', sent_at: '2026-09-25T00:00:00Z', generation: 1,
  };
  const receipt = { schema_version: 1, message_id: '00000000-0000-4000-8000-00000000000d', conversation_id: '00000000-0000-4000-8000-00000000000c', generation: 1, outcome: 'accepted' };

  it('accepts exactly the contract\'s keys, and a receipt\'s optional reason', () => {
    expect(agencyPayloadContractViolation('agency.message.posted', posted)).toBeNull();
    expect(agencyPayloadContractViolation('agency.message.receipt', receipt)).toBeNull();
    expect(agencyPayloadContractViolation('agency.message.receipt', { ...receipt, outcome: 'refused', reason: 'x' })).toBeNull();
  });

  it('refuses any key outside the contract, naming the key and never its value', () => {
    const extra = agencyPayloadContractViolation('agency.message.posted', { ...posted, customer_details: 'Jordan Buyer, 0400 000 000' });
    expect(extra).toMatchObject({ unexpected: ['customer_details'], missing: [] });
    expect(JSON.stringify(extra)).not.toContain('Jordan');
    expect(agencyPayloadContractViolation('agency.message.receipt', { ...receipt, client_id: 'x' }))
      .toMatchObject({ unexpected: ['client_id'] });
  });

  it('refuses a payload missing a contract key, and one that is not an object', () => {
    const { body: _omit, ...short } = posted;
    expect(agencyPayloadContractViolation('agency.message.posted', short)).toMatchObject({ missing: ['body'] });
    expect(agencyPayloadContractViolation('agency.message.posted', null)).not.toBeNull();
    expect(agencyPayloadContractViolation('agency.message.posted', ['x'])).not.toBeNull();
  });

  it('has no opinion on event types that are not messages', () => {
    expect(agencyPayloadContractViolation('stock.selection.announced', { anything: 1 })).toBeNull();
  });

  it('the door checks the contract before it stores anything', () => {
    const door = readCode('supabase/functions/builder-network-inbound/index.ts');
    const check = door.indexOf('agencyPayloadContractViolation(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(door.indexOf(".from('builder_network_inbound_events')"));
  });
});

describe('the exact message contract: each value\'s JSON type', () => {
  const posted = {
    schema_version: 1, conversation_id: '00000000-0000-4000-8000-00000000000c', message_id: '00000000-0000-4000-8000-00000000000d', stock_item_id: 'i', body: 'Hello',
    sender_display_name: 'Avery', sent_at: '2026-09-25T00:00:00Z', generation: 1,
  };
  it('refuses a body, a name or an id that is not a string, and a generation that is not a number', () => {
    expect(agencyPayloadContractViolation('agency.message.posted', { ...posted, body: { text: 'hello' } }))
      .toMatchObject({ mistyped: ['body'] });
    expect(agencyPayloadContractViolation('agency.message.posted', { ...posted, sender_display_name: ['A'] }))
      .toMatchObject({ mistyped: ['sender_display_name'] });
    expect(agencyPayloadContractViolation('agency.message.posted', { ...posted, generation: '1' }))
      .toMatchObject({ mistyped: ['generation'] });
    expect(agencyPayloadContractViolation('agency.message.receipt',
      { schema_version: 1, message_id: '00000000-0000-4000-8000-00000000000d', conversation_id: '00000000-0000-4000-8000-00000000000c', generation: 1, outcome: 'refused', reason: 7 }))
      .toMatchObject({ mistyped: ['reason'] });
  });
  it('accepts a receipt whose reason is absent or null', () => {
    const receipt = { schema_version: 1, message_id: '00000000-0000-4000-8000-00000000000d', conversation_id: '00000000-0000-4000-8000-00000000000c', generation: 1, outcome: 'accepted' };
    expect(agencyPayloadContractViolation('agency.message.receipt', receipt)).toBeNull();
    expect(agencyPayloadContractViolation('agency.message.receipt', { ...receipt, reason: null })).toBeNull();
  });
});

describe('the conversation log', () => {
  it('is scrolled to its newest message', async () => {
    const { scrollLogToEnd } = await import('../marketplaceBuilderStock');
    const log = { scrollTop: 0, scrollHeight: 1840 };
    scrollLogToEnd(log);
    expect(log.scrollTop).toBe(1840);
    expect(() => scrollLogToEnd(null)).not.toThrow();
  });
});

describe('a refusal at the door says which keys were wrong', () => {
  it('names mistyped keys (a skewed schema_version) as well as unexpected and missing ones, and never a value', () => {
    const door = readCode('supabase/functions/builder-network-inbound/index.ts');
    const start = door.indexOf('message contract violation');
    const block = door.slice(start, door.indexOf("'message_contract_failed'", start));
    expect(block).toMatch(/mistyped:\s*contract\.mistyped\.slice\(0,\s*20\)/);
    expect(block).toMatch(/unexpected:\s*contract\.unexpected/);
    expect(block).toMatch(/missing:\s*contract\.missing/);
    expect(block).not.toMatch(/envelope\.payload\[/);
  });
});

describe('following what a poll brings in', () => {
  it('opens at the end, follows a new last message, brings a late one into view, and stays put otherwise', async () => {
    const { arrivalScrollTarget } = await import('../marketplaceBuilderStock');
    expect(arrivalScrollTarget(null, ['a', 'b'])).toBe('end');
    expect(arrivalScrollTarget(['a', 'b'], ['a', 'b', 'c'])).toBe('end');
    expect(arrivalScrollTarget(['a', 'c'], ['a', 'b', 'c'])).toBe('b');
    expect(arrivalScrollTarget(['a', 'b'], ['a', 'b'])).toBeNull();
    expect(arrivalScrollTarget(['a', 'b'], ['b'])).toBeNull();
    // A late message and a new last one in the same poll: the late one is
    // brought into view first, or it would be left above the reader unseen.
    expect(arrivalScrollTarget(['a', 'c'], ['a', 'b', 'c', 'd'])).toBe('b');
    expect(arrivalScrollTarget(['c'], ['a', 'b', 'c', 'd'])).toBe('a');
  });
});

describe('a message envelope\'s dedupe key is bound to its payload', () => {
  const posted = { schema_version: 1, conversation_id: 'c', message_id: 'm-1', stock_item_id: 'i', body: 'Hi',
    sender_display_name: 'A', sent_at: '2026-09-25T00:00:00Z', generation: 2 };
  it('names the key the payload implies, and nothing for other events', () => {
    expect(agencyDedupeKeyFor('agency.message.posted', posted)).toBe('agency.message:m-1:2');
    expect(agencyDedupeKeyFor('agency.message.receipt', { message_id: 'm-1', generation: 3 })).toBe('agency.receipt:m-1:3');
    expect(agencyDedupeKeyFor('stock.selection.announced', { message_id: 'm-1', generation: 1 })).toBeNull();
  });
  it('the door refuses a message envelope whose key is not that one, before it stores anything', () => {
    const door = readCode('supabase/functions/builder-network-inbound/index.ts');
    const check = door.indexOf('agencyDedupeKeyFor(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(door.indexOf(".from('builder_network_inbound_events')"));
    expect(door).toMatch(/message_dedupe_key_mismatch/);
  });
});

describe('a generation is a positive whole number', () => {
  const posted = { schema_version: 1, conversation_id: '00000000-0000-4000-8000-00000000000c', message_id: '00000000-0000-4000-8000-00000000000d', stock_item_id: 'i', body: 'Hi',
    sender_display_name: 'A', sent_at: '2026-09-25T00:00:00Z', generation: 1 };
  it('refuses a malformed message or conversation id, or an unknown receipt outcome, so a sweep never drops it silently', () => {
    const id = '00000000-0000-4000-8000-0000000000aa';
    const good = { ...posted, message_id: id, conversation_id: id };
    expect(agencyPayloadContractViolation('agency.message.posted', good)).toBeNull();
    expect(agencyPayloadContractViolation('agency.message.posted', { ...good, message_id: 'not-a-uuid' })).toMatchObject({ mistyped: ['message_id'] });
    expect(agencyPayloadContractViolation('agency.message.posted', { ...good, conversation_id: '' })).toMatchObject({ mistyped: ['conversation_id'] });
    const receipt = { schema_version: 1, message_id: id, conversation_id: id, generation: 1, outcome: 'accepted' };
    expect(agencyPayloadContractViolation('agency.message.receipt', receipt)).toBeNull();
    expect(agencyPayloadContractViolation('agency.message.receipt', { ...receipt, outcome: 'refused', reason: 'x' })).toBeNull();
    expect(agencyPayloadContractViolation('agency.message.receipt', { ...receipt, outcome: 'delivered' })).toMatchObject({ mistyped: ['outcome'] });
    expect(agencyPayloadContractViolation('agency.message.receipt', { ...receipt, message_id: 'm' })).toMatchObject({ mistyped: ['message_id'] });
  });
  it('refuses a schema version it cannot apply, so a skewed peer keeps retrying instead of being marked delivered', () => {
    for (const schema_version of [2, 0, 1.5]) {
      expect(agencyPayloadContractViolation('agency.message.posted', { ...posted, schema_version })).toMatchObject({ mistyped: ['schema_version'] });
      expect(agencyPayloadContractViolation('agency.message.receipt',
        { schema_version, message_id: '00000000-0000-4000-8000-00000000000d', conversation_id: '00000000-0000-4000-8000-00000000000c', generation: 1, outcome: 'accepted' })).toMatchObject({ mistyped: ['schema_version'] });
    }
    expect(agencyPayloadContractViolation('agency.message.posted', { ...posted, schema_version: 1 })).toBeNull();
  });
  it('refuses a fractional, zero, negative or out-of-range generation', () => {
    for (const generation of [1.5, 0, -1, 2 ** 31]) {
      expect(agencyPayloadContractViolation('agency.message.posted', { ...posted, generation })).toMatchObject({ mistyped: ['generation'] });
    }
    expect(agencyPayloadContractViolation('agency.message.posted', { ...posted, generation: 7 })).toBeNull();
  });
});

describe('a duplicate message key is a duplicate only if it is the same envelope', () => {
  const stored = { connection_id: 'conn', event_type: 'agency.message.posted',
    payload: { message_id: 'm', generation: 1, body: 'Hello', sent_at: '2026-09-25T00:00:00Z' } };
  it('matches the same envelope whatever the key order', () => {
    expect(sameAgencyEnvelope(stored, { ...stored, payload: { sent_at: '2026-09-25T00:00:00Z', body: 'Hello', generation: 1, message_id: 'm' } })).toBe(true);
  });
  it('does not match a changed body, another connection or another type', () => {
    expect(sameAgencyEnvelope(stored, { ...stored, payload: { ...stored.payload, body: 'Changed' } })).toBe(false);
    expect(sameAgencyEnvelope(stored, { ...stored, connection_id: 'other' })).toBe(false);
    expect(sameAgencyEnvelope(stored, { ...stored, event_type: 'agency.message.receipt' })).toBe(false);
  });
  it('the door compares a message duplicate before acknowledging it', () => {
    const door = readCode('supabase/functions/builder-network-inbound/index.ts');
    const dup = door.slice(door.indexOf("=== '23505'"));
    expect(dup.indexOf('sameAgencyEnvelope(')).toBeGreaterThan(-1);
    expect(dup.indexOf('sameAgencyEnvelope(')).toBeLessThan(dup.indexOf('duplicate: true'));
    expect(dup).toMatch(/error: 'message_conflict' \}, 409/);
  });
});

describe('a conversation the reader may no longer see', () => {
  it('is a 401, a 403 or the feature switched off, never a transient failure', async () => {
    const { conversationAccessLost } = await import('@/lib/marketplaceBuilderStock');
    expect(conversationAccessLost(Object.assign(new Error('x'), { status: 401 }))).toBe(true);
    expect(conversationAccessLost(Object.assign(new Error('x'), { status: 403 }))).toBe(true);
    expect(conversationAccessLost(Object.assign(new Error('x'), { code: 'builder_stock_disabled' }))).toBe(true);
    expect(conversationAccessLost(Object.assign(new Error('x'), { status: 503 }))).toBe(false);
    expect(conversationAccessLost(new Error('Failed to fetch'))).toBe(false);
    expect(conversationAccessLost(null)).toBe(false);
  });

  it('the function client carries the HTTP status onto the error it throws', () => {
    const src = readFileSync(join(__dirname, '..', 'marketplaceBuilderStock.ts'), 'utf8');
    expect(src).toMatch(/failure\.status\s*=\s*error\?\.status/);
  });
});

describe('a refused conversation read is not retried before it is shown', () => {
  it('retries a transient failure once and a refusal never', async () => {
    const { retryUnlessAccessLost } = await import('@/lib/marketplaceBuilderStock');
    expect(retryUnlessAccessLost(0, Object.assign(new Error('x'), { status: 503 }))).toBe(true);
    expect(retryUnlessAccessLost(1, Object.assign(new Error('x'), { status: 503 }))).toBe(false);
    expect(retryUnlessAccessLost(0, Object.assign(new Error('x'), { status: 403 }))).toBe(false);
    expect(retryUnlessAccessLost(0, Object.assign(new Error('x'), { code: 'builder_stock_disabled' }))).toBe(false);
  });

  it('the conversation poll uses it', () => {
    const src = readFileSync(join(__dirname, '..', 'marketplaceBuilderStock.ts'), 'utf8');
    const start = src.indexOf('export function useParticipantConversation(');
    const body = src.slice(start, src.indexOf('\nexport ', start + 10));
    expect(body).toMatch(/retry:\s*retryUnlessAccessLost/);
  });
});

describe('the conversation poll after a refusal', () => {
  it('stops, and keeps polling through a transient failure', async () => {
    const { conversationRefetchInterval, builderConversationPollInterval } = await import('@/lib/marketplaceBuilderStock');
    const data = { open: true };
    expect(conversationRefetchInterval({ data, error: Object.assign(new Error('x'), { status: 403 }) })).toBe(false);
    expect(conversationRefetchInterval({ data, error: Object.assign(new Error('x'), { status: 401 }) })).toBe(false);
    expect(conversationRefetchInterval({ data, error: Object.assign(new Error('x'), { code: 'builder_stock_disabled' }) })).toBe(false);
    expect(conversationRefetchInterval({ data, error: Object.assign(new Error('x'), { status: 503 }) })).toBe(builderConversationPollInterval(data));
    expect(conversationRefetchInterval({ data, error: null })).toBe(builderConversationPollInterval(data));
  });

  it('the poll reads it', () => {
    const src = readFileSync(join(__dirname, '..', 'marketplaceBuilderStock.ts'), 'utf8');
    expect(src).toMatch(/refetchInterval:\s*\(query\)\s*=>\s*conversationRefetchInterval\(query\.state\)/);
  });
});
