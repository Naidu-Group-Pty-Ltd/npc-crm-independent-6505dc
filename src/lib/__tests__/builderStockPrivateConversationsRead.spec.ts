/**
 * ONE ACTIVATION, ONE PRIVATE CONVERSATION — WHAT A COMMAND CENTRE USER IS
 * SERVED (docs/builder-portal/52).
 *
 * The rows are proved by builderStockPrivateConversations.spec.ts. This pins
 * what stands in front of them, on the server, because nothing here may rely
 * on a page hiding something:
 *
 * - a conversation is read only by a current participant; anyone else learns
 *   that it exists and nothing else — no body, no participant, no delivery
 *   state — and the read of its messages is never even made;
 * - the inbox lists only the viewer's own conversations;
 * - Activated Properties is one row per activation, carries the builder
 *   company's public contact details and who activated and acknowledged it,
 *   and links to a conversation only for a participant;
 * - nothing about the client, and no user id, reaches a browser;
 * - the edge operations take the sender and the actor from the session, and
 *   there is no operation that removes anybody.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agencyDedupeKeyFor, agencyMessageRefusal, agencyPayloadContractViolation,
} from '../../../supabase/functions/_shared/builderStock/agencyMessages.pure';
import {
  acknowledgementEmail, activationStatus, projectParticipants,
} from '../../../supabase/functions/_shared/builderStock/privateConversations.pure';
import { sendActivationAcknowledgedEmail } from '../../../supabase/functions/_shared/builderStock/acknowledgementEmailJob';
import { OutboxDeferral, outboxFailureDisposition } from '../../../supabase/functions/_shared/outboxDeferral.pure';
import {
  countUnreadAcknowledgementNotices, listActivatedProperties, listMyConversations, listPropertyConversations,
  markAcknowledgementNoticesRead, newBuilderMessages, readParticipantConversation,
} from '../../../supabase/functions/_shared/builderStock/privateConversations';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const readCode = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

type Row = Record<string, any>;
function standIn(tables: Record<string, Row[]>, options: { maxRows?: number } = {}) {
  const log: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const from = (table: string) => {
    const entry = { table, filters: [] as Array<[string, string, unknown]> };
    log.push(entry);
    let orders: Array<[string, boolean]> = [];
    // PostgREST's own ceiling on an unbounded read, where a test sets one.
    let cap = options.maxRows ?? Infinity;
    let offset = 0;
    const builder: any = {
      select() { return builder; },
      eq(col: string, v: unknown) { entry.filters.push(['eq', col, v]); return builder; },
      neq(col: string, v: unknown) { entry.filters.push(['neq', col, v]); return builder; },
      in(col: string, v: unknown[]) { entry.filters.push(['in', col, v]); return builder; },
      is(col: string, v: unknown) { entry.filters.push(['is', col, v]); return builder; },
      lt(col: string, v: unknown) { entry.filters.push(['lt', col, v]); return builder; },
      gt(col: string, v: unknown) { entry.filters.push(['gt', col, v]); return builder; },
      order(col: string, o?: { ascending?: boolean }) { orders = [...orders, [col, o?.ascending !== false]]; return builder; },
      limit(n: number) { cap = n; return builder; },
      range(a: number, b: number) { offset = a; cap = Math.min(b - a + 1, options.maxRows ?? Infinity); return builder; },
      maybeSingle() { return builder.then((r: any) => ({ data: r.data[0] ?? null, error: null })); },
      then(resolve: (v: unknown) => unknown) {
        let rows = (tables[table] ?? []).filter((row) => entry.filters.every(([op, col, v]) =>
          op === 'eq' ? row[col] === v : op === 'neq' ? row[col] !== v
            : op === 'is' ? (row[col] ?? null) === v
            : op === 'lt' ? String(row[col]) < String(v)
            : op === 'gt' ? String(row[col]) > String(v)
            : (v as unknown[]).includes(row[col])));
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

const ME = 'user-me';
const COLLEAGUE = 'user-colleague';
const OUTSIDER = 'user-outsider';
const ORG = 'org-a';
const ITEM = '00000000-0000-4000-8000-0000000000a1';

function world() {
  return {
    builder_stock_selections: [
      { id: 's1', stock_item_id: ITEM, organisation_id: ORG, selected_by_user_id: ME, status: 'builder_acknowledged',
        selected_at: '2026-09-25T01:00:00Z', acknowledged_at: '2026-09-25T02:00:00Z', acknowledged_by_display_name: 'Avery Builder',
        client_id: 'private-client', internal_notes: 'Private note about the client' },
      { id: 's2', stock_item_id: ITEM, organisation_id: ORG, selected_by_user_id: COLLEAGUE, status: 'selected',
        selected_at: '2026-09-25T03:00:00Z', acknowledged_at: null, acknowledged_by_display_name: null,
        client_id: 'other-client', internal_notes: null },
      { id: 's3', stock_item_id: ITEM, organisation_id: ORG, selected_by_user_id: ME, status: 'withdrawn',
        selected_at: '2026-09-20T03:00:00Z', acknowledged_at: '2026-09-20T04:00:00Z', acknowledged_by_display_name: null,
        client_id: 'third-client', internal_notes: null },
    ],
    builder_network_stock_items: [
      { id: ITEM, organisation_id: ORG, address_line: '1 Private Street', suburb: 'Kellyville', lot_number: '101', lifecycle_status: 'active',
        primary_image_id: 'img-1', source_row: { house_design: 'Aspen 28' }, house_design: 'Aspen 28' },
    ],
    builder_network_stock_organisations: [
      { id: ORG, legal_name: 'Check Homes Pty Ltd', trading_name: null, contact_email: 'sales@checkhomes.example',
        contact_phone: '02 9000 0000', website: 'https://checkhomes.example' },
    ],
    custom_users: [
      { id: ME, username: 'olive', first_name: 'Olive', last_name: 'Owner', email: 'olive@example.test', is_active: true },
      { id: COLLEAGUE, username: 'Casey Colleague', first_name: null, last_name: null, email: 'casey@example.test', is_active: true },
    ],
    builder_network_conversations: [
      { id: 'conv-1', selection_ref: 's1', stock_item_id: ITEM, builder_organisation_id: ORG, connection_id: 'conn-a', last_message_at: '2026-09-25T05:00:00Z' },
      { id: 'conv-3', selection_ref: 's3', stock_item_id: ITEM, builder_organisation_id: ORG, connection_id: 'conn-a', last_message_at: '2026-09-21T05:00:00Z' },
    ],
    builder_network_conversation_participants: [
      { conversation_id: 'conv-1', participant_ref: 'ref-me', side: 'command_centre', local_user_id: ME, display_name: 'Olive Owner', state: 'joined', version: 1 },
      { conversation_id: 'conv-1', participant_ref: 'ref-avery', side: 'builder', local_user_id: null, display_name: 'Avery Builder', state: 'joined', version: 1 },
      { conversation_id: 'conv-1', participant_ref: 'ref-left', side: 'builder', local_user_id: null, display_name: 'Former Builder', state: 'left', version: 2 },
      { conversation_id: 'conv-3', participant_ref: 'ref-me-3', side: 'command_centre', local_user_id: ME, display_name: 'Olive Owner', state: 'left', version: 2 },
    ],
    builder_network_connections: [
      { id: 'conn-a', builder_organisation_id: ORG, state: 'active', scopes: ['stock:publish'], identity_mismatch_since: null, accepted_at: '2026-09-01' },
    ],
    builder_network_messages: [
      { id: 'm1', conversation_id: 'conv-1', side: 'command_centre', sender_user_id: ME, sender_display_name: 'Olive Owner',
        body: 'Is it available?', sent_at: '2026-09-25T04:00:00Z', created_at: '2026-09-25T04:00:00Z',
        delivery_state: 'failed', delivered_at: null, failure_reason: 'not_delivered' },
      { id: 'm2', conversation_id: 'conv-1', side: 'builder', sender_user_id: null, sender_display_name: 'Avery Builder',
        body: 'Yes.', sent_at: '2026-09-25T05:00:00Z', created_at: '2026-09-25T05:00:00Z',
        delivery_state: null, delivered_at: null, failure_reason: null },
    ],
  } as Record<string, Row[]>;
}

describe('reading a conversation is for its participants', () => {
  it('a participant past the server\'s row ceiling is still recognised, and the whole roster is read', async () => {
    const tables = world();
    for (let i = 0; i < 1201; i += 1) {
      tables.builder_network_conversation_participants.unshift({ conversation_id: 'conv-1', participant_ref: `bulk-${String(i).padStart(4, '0')}`,
        side: 'builder', local_user_id: null, display_name: `Builder ${i}`, state: 'joined', version: 1 });
    }
    const read = await readParticipantConversation(standIn(tables, { maxRows: 1000 }).client, { conversationId: 'conv-1', viewerUserId: ME });
    if (!read.ok) throw new Error(`refused: ${(read as { reason?: string }).reason}`);
    expect(read.participants.length).toBe(1203);
  });

  it('the whole history is reachable: the newest 500 first, then earlier pages by cursor, each message exactly once', async () => {
    const tables = world();
    // 1,203 more, two to a timestamp, so page boundaries fall inside ties.
    for (let i = 0; i < 1203; i += 1) {
      const at = new Date(Date.UTC(2026, 8, 1) + Math.floor(i / 2) * 60_000).toISOString();
      tables.builder_network_messages.push({ id: `h-${String(i).padStart(4, '0')}`, conversation_id: 'conv-1', side: 'builder',
        sender_user_id: null, sender_display_name: 'Avery Builder', body: `History ${i}`, sent_at: at, created_at: at,
        delivery_state: null, delivered_at: null, failure_reason: null });
    }
    const client = standIn(tables, { maxRows: 1000 }).client;
    const first = await readParticipantConversation(client, { conversationId: 'conv-1', viewerUserId: ME });
    if (!first.ok) throw new Error('refused');
    expect(first.messages).toHaveLength(500);
    expect(first.has_earlier).toBe(true);
    const seen = new Set(first.messages.map((m) => m.id));
    let cursor = first.earlier_cursor;
    let pages = 0;
    while (cursor) {
      const page = await readParticipantConversation(client, { conversationId: 'conv-1', viewerUserId: ME, beforeMessageId: cursor });
      if (!page.ok) throw new Error('refused');
      for (const m of page.messages) {
        expect(seen.has(m.id)).toBe(false);
        seen.add(m.id);
      }
      cursor = page.has_earlier ? page.earlier_cursor : null;
      pages += 1;
      expect(pages).toBeLessThan(5);
    }
    expect(seen.size).toBe(1205);
  });

  it('a history cursor from another conversation reaches nothing, and a non-participant is refused with one', async () => {
    const tables = world();
    tables.builder_network_messages.push({ id: 'other-conv-message', conversation_id: 'conv-3', side: 'builder', sender_user_id: null,
      sender_display_name: 'X', body: 'Not yours', sent_at: '2026-09-26T00:00:00Z', created_at: '2026-09-26T00:00:00Z',
      delivery_state: null, delivered_at: null, failure_reason: null });
    const page = await readParticipantConversation(standIn(tables).client,
      { conversationId: 'conv-1', viewerUserId: ME, beforeMessageId: 'other-conv-message' });
    if (!page.ok) throw new Error('refused');
    expect(page.messages).toEqual([]);
    expect(page.has_earlier).toBe(false);
    const outsider = await readParticipantConversation(standIn(tables).client,
      { conversationId: 'conv-1', viewerUserId: COLLEAGUE, beforeMessageId: 'm2' });
    expect(outsider).toEqual({ ok: false, reason: 'not_a_participant' });
  });

  it('R38/R18. a participant reads the whole thread and both sides\' current participants', async () => {
    const read = await readParticipantConversation(standIn(world()).client, { conversationId: 'conv-1', viewerUserId: ME });
    if (!read.ok) throw new Error(`refused: ${(read as { reason?: string }).reason}`);
    expect(read.messages.map((m) => m.body)).toEqual(['Is it available?', 'Yes.']);
    expect(read.participants.map((p) => `${p.side}:${p.display_name}`).sort())
      .toEqual(['builder:Avery Builder', 'command_centre:Olive Owner']);
    expect(read.participants.find((p) => p.is_me)?.display_name).toBe('Olive Owner');
    expect(read.open).toBe(true);
    expect(read.messages[0].can_retry).toBe(true);
  });

  it('R9/R37. a Listings user who is not a participant is told it exists, and nothing else is read', async () => {
    const { client, log } = standIn(world());
    const read = await readParticipantConversation(client, { conversationId: 'conv-1', viewerUserId: COLLEAGUE });
    expect(read).toEqual({ ok: false, reason: 'not_a_participant' });
    expect(log.some((entry) => entry.table === 'builder_network_messages')).toBe(false);
  });

  it('R25. someone who has left is refused like anyone else, even on a conversation they wrote in', async () => {
    const read = await readParticipantConversation(standIn(world()).client, { conversationId: 'conv-3', viewerUserId: ME });
    expect(read).toEqual({ ok: false, reason: 'not_a_participant' });
  });

  it('R12. an unknown conversation is not found', async () => {
    const read = await readParticipantConversation(standIn(world()).client, { conversationId: 'conv-x', viewerUserId: ME });
    expect(read).toEqual({ ok: false, reason: 'not_found' });
  });

  it('R30. a withdrawn activation\'s conversation is closed to writing', async () => {
    const tables = world();
    tables.builder_network_conversation_participants.push(
      { conversation_id: 'conv-3', participant_ref: 'ref-col-3', side: 'command_centre', local_user_id: COLLEAGUE, display_name: 'Casey Colleague', state: 'joined', version: 1 });
    const read = await readParticipantConversation(standIn(tables).client, { conversationId: 'conv-3', viewerUserId: COLLEAGUE });
    if (!read.ok) throw new Error('refused');
    expect(read.open).toBe(false);
    expect(read.closed_reason).toBe('withdrawn');
  });

  it('R36. never carries a user id, the client, or the activation\'s own id', async () => {
    const read = await readParticipantConversation(standIn(world()).client, { conversationId: 'conv-1', viewerUserId: ME });
    const text = JSON.stringify(read);
    for (const secret of [ME, 'private-client', 'Private note', 'olive@example.test', 's1', 'local_user_id']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('the inbox', () => {
  it('R38. lists only the conversations the viewer is in now', async () => {
    const mine = await listMyConversations(standIn(world()).client, { viewerUserId: ME });
    if (!mine.ok) throw new Error('failed');
    expect(mine.conversations.map((c) => c.conversation_id)).toEqual(['conv-1']);
    expect(mine.conversations[0]).toMatchObject({
      address: '1 Private Street', lot_number: '101', builder_name: 'Check Homes Pty Ltd', status: 'acknowledged',
    });
    const theirs = await listMyConversations(standIn(world()).client, { viewerUserId: OUTSIDER });
    expect(theirs.ok && theirs.conversations).toEqual([]);
  });

  it('lists every conversation the viewer is in, past the server\'s row ceiling', async () => {
    const tables = world();
    for (let i = 0; i < 1201; i += 1) {
      tables.builder_network_conversations.push({ id: `bulk-${i}`, selection_ref: null, stock_item_id: ITEM,
        builder_organisation_id: ORG, connection_id: 'conn-a', last_message_at: null });
      tables.builder_network_conversation_participants.push({ conversation_id: `bulk-${i}`, participant_ref: `r-${i}`,
        side: 'command_centre', local_user_id: ME, display_name: 'Olive Owner', state: 'joined', version: 1 });
    }
    const stand = standIn(tables, { maxRows: 1000 });
    const mine = await listMyConversations(stand.client, { viewerUserId: ME });
    if (!mine.ok) throw new Error('failed');
    expect(mine.conversations).toHaveLength(1202);
    const inSizes = stand.log.flatMap((e) => e.filters.filter(([op]) => op === 'in').map(([, , v]) => (v as unknown[]).length));
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(200);
  });
});

describe('Activated Properties', () => {
  it('one row per activation, with the builder company\'s contacts and who activated and acknowledged it', async () => {
    const rows = await listActivatedProperties(standIn(world()).client, { viewerUserId: ME });
    if (!rows.ok) throw new Error('failed');
    expect(rows.activations).toHaveLength(3);
    const first = rows.activations.find((r) => r.activated_at === '2026-09-25T01:00:00Z')!;
    expect(first).toMatchObject({
      stock_item_id: ITEM, address: '1 Private Street', lot_number: '101', house_design: 'Aspen 28', primary_image_id: 'img-1',
      builder_name: 'Check Homes Pty Ltd', builder_email: 'sales@checkhomes.example', builder_phone: '02 9000 0000',
      builder_website: 'https://checkhomes.example', activated_by: 'Olive Owner', acknowledged_by: 'Avery Builder',
      acknowledged_at: '2026-09-25T02:00:00Z', status: 'acknowledged', conversation_id: 'conv-1',
    });
  });

  it('statuses: awaiting acknowledgement, acknowledged, withdrawn; an old acknowledgement names nobody', async () => {
    const rows = await listActivatedProperties(standIn(world()).client, { viewerUserId: ME });
    if (!rows.ok) throw new Error('failed');
    expect(rows.activations.map((r) => r.status).sort()).toEqual(['acknowledged', 'awaiting_acknowledgement', 'withdrawn']);
    const withdrawn = rows.activations.find((r) => r.status === 'withdrawn')!;
    expect(withdrawn.acknowledged_by).toBeNull();
  });

  it('every activation is listed however many there are, and every lookup is asked in bounded chunks', async () => {
    const tables = world();
    for (let i = 0; i < 1201; i += 1) {
      tables.builder_stock_selections.push({
        id: `bulk-${i}`, stock_item_id: `item-${i}`, organisation_id: ORG, selected_by_user_id: ME, status: 'selected',
        selected_at: '2026-01-01T00:00:00Z', acknowledged_at: null, acknowledged_by_display_name: null,
      } as never);
    }
    const stand = standIn(tables);
    const rows = await listActivatedProperties(stand.client, { viewerUserId: ME });
    if (!rows.ok) throw new Error('failed');
    expect(rows.activations).toHaveLength(1204);
    const inSizes = stand.log.flatMap((e) => e.filters.filter(([op]) => op === 'in').map(([, , v]) => (v as unknown[]).length));
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(200);
  });

  it('links every conversation the viewer is in, past the server\'s row ceiling', async () => {
    const tables = world();
    for (let i = 0; i < 1201; i += 1) {
      // Ahead of the real row, so a single capped read cannot reach it.
      tables.builder_network_conversation_participants.unshift({ conversation_id: `other-${i}`, participant_ref: `o-${i}`,
        side: 'command_centre', local_user_id: ME, display_name: 'Olive Owner', state: 'joined', version: 1 });
    }
    const rows = await listActivatedProperties(standIn(tables, { maxRows: 1000 }).client, { viewerUserId: ME });
    if (!rows.ok) throw new Error('failed');
    expect(rows.activations.filter((r) => r.conversation_id).map((r) => r.conversation_id)).toEqual(['conv-1']);
  });

  it('R37. links to a conversation only for a current participant', async () => {
    const colleague = await listActivatedProperties(standIn(world()).client, { viewerUserId: COLLEAGUE });
    if (!colleague.ok) throw new Error('failed');
    expect(colleague.activations.every((r) => r.conversation_id === null)).toBe(true);
    const me = await listActivatedProperties(standIn(world()).client, { viewerUserId: ME });
    if (!me.ok) throw new Error('failed');
    // conv-3 is one I have left.
    expect(me.activations.filter((r) => r.conversation_id).map((r) => r.conversation_id)).toEqual(['conv-1']);
  });

  it('R36. no client, no note, no activation id and no user id reaches the page', async () => {
    const rows = await listActivatedProperties(standIn(world()).client, { viewerUserId: ME });
    const text = JSON.stringify(rows);
    for (const secret of ['private-client', 'other-client', 'Private note', ME, COLLEAGUE, 'olive@example.test', '"s1"', '"s2"']) {
      expect(text).not.toContain(secret);
    }
  });

  it('pure: the status of an activation is read from its own fields', () => {
    expect(activationStatus({ status: 'selected', acknowledged_at: null })).toBe('awaiting_acknowledgement');
    expect(activationStatus({ status: 'builder_acknowledged', acknowledged_at: '2026-09-25' })).toBe('acknowledged');
    expect(activationStatus({ status: 'progressed', acknowledged_at: '2026-09-25' })).toBe('acknowledged');
    expect(activationStatus({ status: 'withdrawn', acknowledged_at: '2026-09-25' })).toBe('withdrawn');
  });
});

describe('the property page\'s card', () => {
  it('R37. lists only the viewer\'s own conversations for that property', async () => {
    const mine = await listPropertyConversations(standIn(world()).client, { stockItemId: ITEM, viewerUserId: ME });
    expect(mine.ok && mine.conversations.map((c) => c.conversation_id)).toEqual(['conv-1']);
    const theirs = await listPropertyConversations(standIn(world()).client, { stockItemId: ITEM, viewerUserId: COLLEAGUE });
    expect(theirs.ok && theirs.conversations).toEqual([]);
  });
});

describe('participants, as a browser is shown them', () => {
  it('R26. two people with one name are two entries, told apart by reference, never by user id', () => {
    const view = projectParticipants([
      { participant_ref: 'a', side: 'builder', display_name: 'Sam Site', state: 'joined', local_user_id: null },
      { participant_ref: 'b', side: 'builder', display_name: 'Sam Site', state: 'joined', local_user_id: null },
      { participant_ref: 'c', side: 'command_centre', display_name: 'Olive Owner', state: 'joined', local_user_id: ME },
      { participant_ref: 'd', side: 'builder', display_name: 'Gone', state: 'left', local_user_id: null },
    ], ME);
    expect(view.map((p) => p.participant_ref)).toEqual(['c', 'a', 'b']);
    expect(view.find((p) => p.participant_ref === 'c')?.is_me).toBe(true);
    expect(JSON.stringify(view)).not.toContain(ME);
  });
});

describe('the participant event contract, at the door', () => {
  const good = {
    schema_version: 1, conversation_id: '00000000-0000-4000-8000-000000000001', stock_item_id: ITEM,
    participant_ref: '00000000-0000-4000-8000-000000000002', display_name: 'Avery Builder',
    side: 'builder', state: 'joined', version: 1,
  };
  it('accepts exactly its keys and types', () => {
    expect(agencyPayloadContractViolation('agency.message.participant', good)).toBeNull();
  });
  it('refuses any other key, a wrong type, an unknown side or state, and a version that is not a positive whole number', () => {
    expect(agencyPayloadContractViolation('agency.message.participant', { ...good, email: 'x@example.test' })?.unexpected).toEqual(['email']);
    for (const bad of [{ side: 'admin' }, { state: 'removed' }, { version: 0 }, { version: 1.5 }, { display_name: '' },
      { display_name: 'x'.repeat(201) }, { participant_ref: 'not-a-uuid' }, { schema_version: 2 }]) {
      expect(agencyPayloadContractViolation('agency.message.participant', { ...good, ...bad })).not.toBeNull();
    }
  });
  it('its dedupe key is bound to the conversation, the reference and the version', () => {
    expect(agencyDedupeKeyFor('agency.message.participant', good))
      .toBe(`agency.participant:${good.conversation_id}:${good.participant_ref}:1`);
  });
  it('the door knows it as a message-lane event', () => {
    expect(readCode('supabase/functions/builder-network-inbound/index.ts')).toMatch(/'agency\.message\.participant'/);
  });
});

describe('refusals', () => {
  it('a non-participant, the last participant, an ineligible invitee and a closed conversation are each named', () => {
    expect(agencyMessageRefusal('AGENCY_NOT_A_PARTICIPANT')).toMatchObject({ status: 403, code: 'not_a_participant' });
    expect(agencyMessageRefusal('AGENCY_LAST_PARTICIPANT')).toMatchObject({ status: 409, code: 'last_participant' });
    expect(agencyMessageRefusal('AGENCY_INVITEE_NOT_ELIGIBLE')).toMatchObject({ status: 422, code: 'invitee_not_eligible' });
    expect(agencyMessageRefusal('AGENCY_CONVERSATION_NOT_OPEN')).toMatchObject({ status: 409, code: 'conversation_not_open' });
  });
});

describe('the acknowledgement email', () => {
  it('R5. names the builder company, the property and the acknowledger, and nothing about the client', () => {
    const email = acknowledgementEmail({
      builderName: 'Check Homes Pty Ltd', address: '1 Private Street', lotNumber: '101',
      acknowledgedBy: 'Avery Builder', link: 'https://cc.example/admin/builder-portal/activated',
    });
    expect(`${email.subject} ${email.text}`).toMatch(/Check Homes Pty Ltd/);
    expect(email.text).toMatch(/1 Private Street/);
    expect(email.text).toMatch(/Avery Builder/);
    const historical = acknowledgementEmail({
      builderName: 'Check Homes Pty Ltd', address: '1 Private Street', lotNumber: null, acknowledgedBy: null, link: null,
    });
    expect(historical.text).not.toMatch(/null|undefined/);
  });

  it('carries nothing the builder wrote into the email as markup', () => {
    const email = acknowledgementEmail({
      builderName: '<a href="https://evil.example">Evil</a> Homes', address: '<img src=x onerror=alert(1)>',
      lotNumber: '1"2', acknowledgedBy: '<b>Avery</b>', link: null,
    });
    expect(email.html).not.toMatch(/<a |<img|<b>/);
    expect(email.html).toContain('&lt;a href=');
    expect(email.title).not.toMatch(/Evil|Avery/);
  });

  it('the existing portal email helper forwards a caller\'s idempotency key to the provider, and sends none otherwise', () => {
    const helper = readCode('supabase/functions/_shared/portal-notification-email.ts');
    expect(helper).toMatch(/idempotencyKey\?: string/);
    expect(helper).toMatch(/\.\.\.\(idempotencyKey \? \{ 'Idempotency-Key': idempotencyKey \} : \{\}\)/);
  });

  it('the worker hands the job the existing portal email helper', () => {
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    expect(worker).toMatch(/sendActivationAcknowledgedEmail\(db,\s*event,\s*sendPortalNotificationEmail\)/);
  });

  it('is sent by the existing worker through the workspace\'s own email identity, once per activation', () => {
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    expect(worker).toMatch(/builder_activation_acknowledged/);
    expect(worker).toMatch(/sendPortalNotificationEmail/);
    const migration = readCode('supabase/migrations/20261224090000_one_activation_one_private_conversation.sql');
    expect(migration).toMatch(/enqueue_integration_event/);
    expect(migration).toMatch(/'builder_activation_acknowledged:' \|\|/);
  });
});

describe('the Builder Portal badge counts the server, not the bell\'s window', () => {
  /** Records every filter a notices read or write applies, so its scope can be asserted. */
  function noticesDb(options: { error?: boolean; count?: number } = {}) {
    const calls: Array<{ op: string; filters: Array<[string, string, unknown]>; values?: unknown; head?: boolean }> = [];
    const from = (table: string) => {
      expect(table).toBe('notifications');
      const call: { op: string; filters: Array<[string, string, unknown]>; values?: unknown; head?: boolean } = { op: '', filters: [] };
      calls.push(call);
      const q: any = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) { call.op = call.op || 'select'; call.head = !!opts?.head; return q; },
        update(values: unknown) { call.op = 'update'; call.values = values; return q; },
        eq(col: string, val: unknown) { call.filters.push(['eq', col, val]); return q; },
        lte(col: string, val: unknown) { call.filters.push(['lte', col, val]); return q; },
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve(options.error
            ? { data: null, count: null, error: { message: 'x' } }
            : { data: null, count: options.count ?? 0, error: null }).then(resolve);
        },
      };
      return q;
    };
    return { db: { from }, calls };
  }
  const scopedToViewer = (filters: Array<[string, string, unknown]>) => {
    expect(filters).toContainEqual(['eq', 'target_user_id', 'viewer-1']);
    expect(filters).toContainEqual(['eq', 'type', 'builder_activation_acknowledged']);
    expect(filters).toContainEqual(['eq', 'read', false]);
  };

  it('counts every unread acknowledgement the viewer holds, however old', async () => {
    const { db, calls } = noticesDb({ count: 73 });
    expect(await countUnreadAcknowledgementNotices(db, { viewerUserId: 'viewer-1' })).toEqual({ ok: true, count: 73 });
    expect(calls).toHaveLength(1);
    expect(calls[0].head).toBe(true);
    scopedToViewer(calls[0].filters);
  });

  it('a count that cannot be read is not a count of zero', async () => {
    const { db } = noticesDb({ error: true });
    expect(await countUnreadAcknowledgementNotices(db, { viewerUserId: 'viewer-1' })).toEqual({ ok: false });
  });

  it('marking read reaches the viewer\'s unread acknowledgements up to the list the viewer was shown, and nobody else\'s', async () => {
    const asOf = '2026-09-26T05:00:00.000Z';
    const { db, calls } = noticesDb();
    expect(await markAcknowledgementNoticesRead(db, { viewerUserId: 'viewer-1', asOf })).toEqual({ ok: true });
    expect(calls[0].op).toBe('update');
    expect(calls[0].values).toEqual({ read: true });
    scopedToViewer(calls[0].filters);
    // An acknowledgement that arrived after the list was read is left unread.
    expect(calls[0].filters).toContainEqual(['lte', 'created_at', asOf]);
    expect((await markAcknowledgementNoticesRead(noticesDb({ error: true }).db, { viewerUserId: 'viewer-1', asOf })).ok).toBe(false);
  });

  it('marking read without a readable cutoff marks nothing', async () => {
    for (const asOf of ['', 'not a time', undefined as unknown as string]) {
      const { db, calls } = noticesDb();
      expect(await markAcknowledgementNoticesRead(db, { viewerUserId: 'viewer-1', asOf })).toEqual({ ok: false });
      expect(calls).toHaveLength(0);
    }
  });

  it('both are operations on the edge function, for the session\'s user only', () => {
    const code = readCode('supabase/functions/builder-stock-marketplace/index.ts');
    expect(code).toMatch(/'count_activation_acknowledgements'[\s\S]{0,300}countUnreadAcknowledgementNotices\(supabase, \{ viewerUserId: userId \}\)/);
    expect(code).toMatch(/'mark_activation_acknowledgements_read'[\s\S]{0,400}markAcknowledgementNoticesRead\(supabase, \{ viewerUserId: userId, asOf \}\)/);
    // The list says when it was read, and that time is taken before the read.
    expect(code).toMatch(/'list_builder_portal_activations'[\s\S]{0,200}const asOf = new Date\(\)\.toISOString\(\);[\s\S]{0,200}listActivatedProperties[\s\S]{0,300}as_of: asOf/);
  });
});

describe('a deferred outbox job does not spend its retry budget', () => {
  const now = Date.parse('2026-09-26T05:00:00.000Z');

  it('a deferral is never terminal, even on the last attempt, and waits until the time it names', () => {
    const d = outboxFailureDisposition(new OutboxDeferral('acknowledgement_email_in_progress', '2026-09-26T05:10:00.000Z'), 10, now);
    expect(d).toEqual({ terminal: false, availableAt: '2026-09-26T05:10:00.000Z', deferred: true, attempts: 9 });
    expect(outboxFailureDisposition(new OutboxDeferral('x', '2026-09-26T05:10:00.000Z'), 25, now).terminal).toBe(false);
  });

  it('a deferral naming no usable time waits a minute rather than spinning', () => {
    expect(outboxFailureDisposition(new OutboxDeferral('x', 'not a time'), 3, now).availableAt).toBe('2026-09-26T05:01:00.000Z');
    expect(outboxFailureDisposition(new OutboxDeferral('x', '2026-09-26T04:00:00.000Z'), 3, now).availableAt).toBe('2026-09-26T05:01:00.000Z');
  });

  it('an ordinary failure keeps the existing backoff and is terminal at the tenth attempt', () => {
    expect(outboxFailureDisposition(new Error('down'), 3, now)).toEqual({
      terminal: false, availableAt: new Date(now + 8_000).toISOString(), deferred: false, attempts: 3,
    });
    expect(outboxFailureDisposition(new Error('down'), 10, now).terminal).toBe(true);
    expect(outboxFailureDisposition(new Error('down'), 12, now).availableAt).toBe(new Date(now + 3_600_000).toISOString());
  });

  it('the attempt a deferred claim consumed is given back, so ten real deliveries are still allowed', () => {
    // Every claim counts an attempt. A claim that found the lease held did not
    // try to deliver, so the count it added is returned; an ordinary failure
    // keeps its count.
    expect(outboxFailureDisposition(new OutboxDeferral('x', '2026-09-26T05:10:00.000Z'), 4, now).attempts).toBe(3);
    expect(outboxFailureDisposition(new OutboxDeferral('x', '2026-09-26T05:10:00.000Z'), 0, now).attempts).toBe(0);
    expect(outboxFailureDisposition(new Error('down'), 4, now).attempts).toBe(4);
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    expect(worker).toMatch(/update\(\{attempts:disposition\.attempts,available_at:/);
  });

  it('a deferred claim leaves no attempt in the ledger, so the number it gives back is free for the next claim', () => {
    // integration_delivery_attempts is unique on (outbox, consumer, attempt
    // number). A deferral gives its number back, so its "started" row is
    // removed rather than left "failed" for the next claim to collide with.
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    expect(worker).toMatch(/if\(disposition\.deferred\)await db\.from\('integration_delivery_attempts'\)\.delete\(\)\.eq\('outbox_id',event\.id\)\.eq\('consumer_name',consumer\)\.eq\('attempt_number',event\.attempts\);\s*else await db\.from\('integration_delivery_attempts'\)\.update\(\{status:'failed'/);
  });

  it('the cross-portal worker decides every failure through it', () => {
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    expect(worker).toMatch(/outboxFailureDisposition\(error,\s*event\.attempts,\s*Date\.now\(\)\)/);
    expect(worker).not.toMatch(/const terminal=event\.attempts>=10;/);
  });
});

describe('the edge operations', () => {
  const source = () => readCode('supabase/functions/builder-stock-marketplace/index.ts');

  it('each is named, and reads from the shared participant module', () => {
    for (const op of ['list_builder_portal_activations', 'list_my_builder_conversations', 'get_builder_conversation',
      'send_builder_message', 'retry_builder_message', 'list_builder_conversation_invitees',
      'invite_builder_conversation_participant', 'leave_builder_conversation']) {
      expect(source()).toContain(`'${op}'`);
    }
    expect(source()).toMatch(/readParticipantConversation/);
  });

  it('a conversation read takes a history cursor, and says whether there is more', () => {
    const code = source();
    expect(code).toMatch(/'get_builder_conversation'[\s\S]{0,400}beforeMessageId:\s*uuidOf\(body\.before_message_id\)/);
    expect(code).toMatch(/has_earlier:\s*read\.has_earlier/);
    expect(code).toMatch(/earlier_cursor:\s*read\.earlier_cursor/);
  });

  it('adding somebody is offered only while the network is on, as sending is', () => {
    expect(source()).toMatch(/can_invite:\s*read\.open && listingsEdit\.ok && networkOn/);
  });

  it('R21. there is no operation that removes somebody else', () => {
    expect(source()).not.toMatch(/'(remove|kick|evict)_builder/);
  });

  it('the sender and the actor are the session\'s user; the request names only a conversation and an invitee', () => {
    const code = source();
    expect(code).toMatch(/builder_network_post_message[\s\S]{0,300}_sender_user_id:\s*userId/);
    expect(code).toMatch(/builder_network_invite_participant[\s\S]{0,300}_actor_user_id:\s*userId/);
    expect(code).toMatch(/builder_network_leave_conversation[\s\S]{0,300}_actor_user_id:\s*userId/);
    expect(code).not.toMatch(/_sender_user_id:\s*body\./);
    expect(code).not.toMatch(/_actor_user_id:\s*body\./);
  });

  it('no model and no email is called from the operations', () => {
    expect(source()).not.toMatch(/openrouter|anthropic|openai|resend/i);
  });
});

describe('the Command Centre navigation', () => {
  it('Portals → Builder Portal, behind Listings, with its two tabs routable', () => {
    const registry = readCode('src/lib/navigation/registry.ts');
    expect(registry).toMatch(/Builder Portal[\s\S]{0,400}\/admin\/builder-portal/);
    const app = readCode('src/App.tsx');
    expect(app).toMatch(/admin\/builder-portal\/:tab/);
  });
});

describe('the acknowledgement email job: once, on a lease, never finalised before it is sent', () => {
  const SEL = '11111111-1111-4111-8111-111111111111';
  const LEASE = 600;
  /**
   * The ledger, as the two SQL functions keep it: a claim is a lease that
   * expires, and only the holder of the current lease can record a send.
   * `clock` stands in for the database's now().
   */
  function jobDb(options: { claimError?: boolean; settleError?: boolean; readError?: 'custom_users' | null; stamped?: boolean } = {}) {
    const notice = {
      selection_id: SEL, outcome: 'notified',
      email_sent_at: options.stamped ? '2026-09-26T00:00:00Z' : null as string | null,
      token: null as string | null, claimed_at: null as number | null,
    };
    const state = { clock: 0, seq: 0 };
    const rows: Record<string, Row> = {
      builder_stock_selections: { id: SEL, selected_by_user_id: 'u1', stock_item_id: 'i1', organisation_id: 'o1', acknowledged_by_display_name: 'Avery <b>Builder</b>' },
      custom_users: { id: 'u1', email: 'olive@example.test', first_name: 'Olive', is_active: true, deleted_at: null },
      builder_network_stock_items: { id: 'i1', address_line: '1 Private Street', lot_number: '101' },
      builder_network_stock_organisations: { id: 'o1', legal_name: 'Check Homes Pty Ltd', trading_name: null },
    };
    const from = (table: string) => {
      const q: any = {
        select() { return q; }, eq() { return q; },
        maybeSingle: async () => table === 'builder_network_acknowledgement_notices'
          ? { data: { outcome: notice.outcome, email_sent_at: notice.email_sent_at }, error: null }
          : options.readError === table ? { data: null, error: { message: 'x' } } : { data: rows[table], error: null },
        update() { throw new Error('the ledger is written only through its functions'); },
      };
      return q;
    };
    const rpc = async (name: string, args: any) => {
      if (name === 'builder_network_claim_acknowledgement_email') {
        if (options.claimError) return { data: null, error: { message: 'x' } };
        expect(args._selection_id).toBe(SEL);
        if (notice.outcome !== 'notified') return { data: { state: 'not_owed' }, error: null };
        if (notice.email_sent_at) return { data: { state: 'sent' }, error: null };
        if (notice.token && notice.claimed_at !== null && state.clock - notice.claimed_at < args._lease_seconds) {
          return { data: { state: 'held', until: '2026-09-26T05:10:00.000Z' }, error: null };
        }
        notice.token = `token-${++state.seq}`; notice.claimed_at = state.clock;
        return { data: { state: 'claimed', token: notice.token }, error: null };
      }
      if (name === 'builder_network_settle_acknowledgement_email') {
        if (options.settleError) return { data: null, error: { message: 'x' } };
        if (notice.token !== args._token) return { data: false, error: null };
        if (args._sent) notice.email_sent_at = new Date().toISOString();
        notice.token = null; notice.claimed_at = null;
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    };
    return { db: { from, rpc }, notice, state };
  }
  const event = { payload: { selection_id: SEL } };
  const ok = (sent: any[]) => async (input: any) => { sent.push(input); return { success: true }; };

  it('sends once, escaped, under the fixed title, and the ledger records it', async () => {
    const { db, notice } = jobDb();
    const sent: any[] = [];
    await sendActivationAcknowledgedEmail(db, event, ok(sent));
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('Activation acknowledged');
    expect(sent[0].message).not.toMatch(/<b>/);
    expect(notice.email_sent_at).not.toBeNull();
    await sendActivationAcknowledgedEmail(db, event, ok(sent));
    expect(sent).toHaveLength(1);
  });

  it('every send carries the same provider idempotency key, so a re-send after a lost stamp is not a second email', async () => {
    const { db } = jobDb();
    const sent: any[] = [];
    await sendActivationAcknowledgedEmail(db, event, ok(sent));
    expect(sent[0].idempotencyKey).toBe(`builder-activation-acknowledged/${SEL}`);
  });

  it('a claim that cannot be recorded sends nothing and throws, so the outbox retries', async () => {
    const { db } = jobDb({ claimError: true });
    const sent: any[] = [];
    await expect(sendActivationAcknowledgedEmail(db, event, ok(sent))).rejects.toThrow(/claim_failed/);
    expect(sent).toHaveLength(0);
  });

  it('a claim another worker holds is not taken as done: it defers the job until the lease runs out', async () => {
    const { db, notice } = jobDb();
    notice.token = 'someone-else'; notice.claimed_at = 0;
    const sent: any[] = [];
    const failure = await sendActivationAcknowledgedEmail(db, event, ok(sent)).then(() => null, (e) => e);
    expect(failure).toBeInstanceOf(OutboxDeferral);
    expect(failure.message).toMatch(/in_progress/);
    expect(failure.retryAt).toBe('2026-09-26T05:10:00.000Z');
    expect(sent).toHaveLength(0);
  });

  it('a worker that died after claiming leaves an email a later retry still sends', async () => {
    const { db, notice, state } = jobDb();
    notice.token = 'dead-worker'; notice.claimed_at = 0;   // claimed, never sent, never released
    const sent: any[] = [];
    await expect(sendActivationAcknowledgedEmail(db, event, ok(sent))).rejects.toThrow(/in_progress/);
    state.clock = LEASE + 1;                               // the lease runs out
    await sendActivationAcknowledgedEmail(db, event, ok(sent));
    expect(sent).toHaveLength(1);
    expect(notice.email_sent_at).not.toBeNull();
  });

  it('a send that fails releases the claim and throws, so the retry can send it', async () => {
    const { db, notice } = jobDb();
    await expect(sendActivationAcknowledgedEmail(db, event, async () => ({ success: false, error: 'down' })))
      .rejects.toThrow(/not_sent/);
    expect(notice.email_sent_at).toBeNull();
    expect(notice.token).toBeNull();
  });

  it('a send that throws releases the claim too, and the error reaches the outbox', async () => {
    const { db, notice } = jobDb();
    await expect(sendActivationAcknowledgedEmail(db, event, async () => { throw new Error('socket hang up'); }))
      .rejects.toThrow(/not_sent/);
    expect(notice.email_sent_at).toBeNull();
    expect(notice.token).toBeNull();
    const sent: any[] = [];
    await sendActivationAcknowledgedEmail(db, event, ok(sent));
    expect(sent).toHaveLength(1);
  });

  it('a send whose stamp cannot be recorded throws, and the retry re-sends under the same key', async () => {
    const { db } = jobDb({ settleError: true });
    const sent: any[] = [];
    await expect(sendActivationAcknowledgedEmail(db, event, ok(sent))).rejects.toThrow(/sent_not_recorded/);
    expect(sent).toHaveLength(1);
  });

  it('a failed read of what the email needs throws before anything is claimed or sent', async () => {
    const { db, notice } = jobDb({ readError: 'custom_users' });
    const sent: any[] = [];
    await expect(sendActivationAcknowledgedEmail(db, event, ok(sent))).rejects.toThrow(/facts_unreadable/);
    expect(sent).toHaveLength(0);
    expect(notice.token).toBeNull();
  });

  it('an email already recorded is not sent again', async () => {
    const { db } = jobDb({ stamped: true });
    const sent: any[] = [];
    await sendActivationAcknowledgedEmail(db, event, ok(sent));
    expect(sent).toHaveLength(0);
  });
});


describe('the "new message from <builder>" popup read', () => {
  it('a first read takes the cursor and names nothing, so opening the Command Centre replays no message', async () => {
    const read = await newBuilderMessages(standIn(world()).client, { viewerUserId: ME, since: null });
    if (!read.ok) throw new Error('failed');
    expect(read.messages).toEqual([]);
    expect(read.cursor).toBe('2026-09-25T05:00:00Z');
  });

  it('names each builder message that arrived after the cursor, with the builder company and the property', async () => {
    const read = await newBuilderMessages(standIn(world()).client, { viewerUserId: ME, since: '2026-09-25T04:30:00Z' });
    if (!read.ok) throw new Error('failed');
    expect(read.messages).toEqual([{
      message_id: 'm2', conversation_id: 'conv-1', builder_name: 'Check Homes Pty Ltd', sender_display_name: 'Avery Builder',
      lot_number: '101', address: '1 Private Street', received_at: '2026-09-25T05:00:00Z',
    }]);
    expect(read.cursor).toBe('2026-09-25T05:00:00Z');
  });

  it('never names the reader\'s own side, a message already seen, or a conversation the reader is not in', async () => {
    const tables = world();
    tables.builder_network_messages.push({ id: 'm9', conversation_id: 'conv-3', side: 'builder', sender_display_name: 'Avery Builder',
      body: 'Where the reader has left.', sent_at: '2026-09-25T06:00:00Z', created_at: '2026-09-25T06:00:00Z',
      delivery_state: null, delivered_at: null, failure_reason: null });
    const mine = await newBuilderMessages(standIn(tables).client, { viewerUserId: ME, since: '2026-09-25T00:00:00Z' });
    if (!mine.ok) throw new Error('failed');
    expect(mine.messages.map((m) => m.message_id)).toEqual(['m2']);
    const after = await newBuilderMessages(standIn(tables).client, { viewerUserId: ME, since: mine.cursor });
    if (!after.ok) throw new Error('failed');
    expect(after.messages).toEqual([]);
    const outsider = await newBuilderMessages(standIn(tables).client, { viewerUserId: OUTSIDER, since: '2026-09-25T00:00:00Z' });
    if (!outsider.ok) throw new Error('failed');
    expect(outsider.messages).toEqual([]);
  });

  it('carries no message body and no user id to the browser', async () => {
    const read = await newBuilderMessages(standIn(world()).client, { viewerUserId: ME, since: '2026-09-25T00:00:00Z' });
    expect(JSON.stringify(read)).not.toMatch(/Yes\.|user-me|sender_user_id|private-client/);
  });

  it('is a read-only operation on the marketplace function, and the worker admits the conversations\' own kick', () => {
    const fn = readCode('supabase/functions/builder-stock-marketplace/index.ts');
    const at = fn.indexOf("operation === 'list_new_builder_messages'");
    expect(at).toBeGreaterThan(-1);
    const block = fn.slice(at, fn.indexOf('if (operation ===', at + 10));
    expect(block).toContain('newBuilderMessages(supabase, { viewerUserId: userId, since })');
    expect(block).not.toMatch(/\.rpc\(|insert|update|delete/i);
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    expect(worker).toContain("allowedCallers:['pg_cron','agency_message']");
  });
});
