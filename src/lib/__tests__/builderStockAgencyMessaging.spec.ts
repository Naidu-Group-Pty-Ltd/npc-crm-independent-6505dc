/**
 * AGENCY MESSAGING — THE COMMAND CENTRE'S HALF, ON A REAL SCHEMA.
 *
 * A Command Centre user writes to the builder about an activated property;
 * the builder's replies arrive over the signed network. These run the REAL
 * network migrations and `20261221120000` against a throwaway Postgres and
 * land envelopes exactly as the inbound door does, then assert the rows each
 * step leaves: one conversation per property, the actual sender on every
 * message, delivery that means ACCEPTED, idempotent sends and replays,
 * refusals across builders, connections and properties, a poison message that
 * does not block the next, and the order a thread settles in.
 *
 * The network's half is proved the same way in aurixa-builders
 * (`scripts/db/agency-messaging-check.mjs`); both implement one contract
 * (docs/builder-portal/51).
 */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  postgresAvailable, startThrowawayPostgres, type ThrowawayPostgres,
} from './support/throwawayPostgres';
import { assertPayloadCrossesClean } from '../../../supabase/functions/_shared/builderNetworkPrivacy.pure';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(REPO_ROOT, 'supabase', 'migrations');
export const MESSAGING_MIGRATION = '20261221120000_an_agency_and_a_builder_talk_over_the_network.sql';
const NETWORK = [
  '20261121000000_builder_network_mirror.sql',
  '20261122000000_builder_network_phase5_inbound_fk_release.sql',
  '20261123000000_builder_network_stock_mirror.sql',
  '20261124000000_builder_portal_decommission.sql',
  '20261124010000_builder_network_stock_selection_producer.sql',
  '20261201090000_builder_network_stock_consumer_and_agency_disclosure.sql',
  '20261201100000_agency_contact_name_falls_back_to_username.sql',
  '20261202090000_builder_marketplace_ranking.sql',
  '20261211000000_a_builder_route_installs_itself.sql',
  '20261221090000_a_property_brings_its_photographs_and_documents.sql',
  '20261221100000_a_media_diagnostic_never_breaks_the_sweep.sql',
  MESSAGING_MIGRATION,
];

const runs = postgresAvailable();
let db: ThrowawayPostgres;

const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const json = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;
const refusal = (statement: string): string | null => {
  try { db.sql(statement); return null; } catch (error) {
    return String((error as { stderr?: unknown }).stderr ?? (error as Error).message);
  }
};
const conversationId = (networkConnection: string, item: string) => {
  const hex = createHash('md5').update(`agency.conversation:${networkConnection}:${item}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// The world.
const ORG_A = randomUUID(); const ORG_B = randomUUID();
const NET_A = randomUUID(); const NET_B = randomUUID();
const ITEM_A1 = randomUUID(); const ITEM_A2 = randomUUID(); const ITEM_B1 = randomUUID();
const OWNER = randomUUID(); const COLLEAGUE = randomUUID(); const INACTIVE = randomUUID();
let CONN_A = ''; let CONN_B = '';

const post = (item: string, user: string, clientId: string, body: string) => db.sql(`
  SELECT id FROM public.builder_network_post_message(${lit(item)}, ${lit(user)}, ${lit(clientId)}, ${lit(body)})`);
const outbox = (where: string) => db.sql(`SELECT count(*) FROM public.builder_network_outbox WHERE ${where}`);
const land = (connection: string, eventType: string, dedupe: string, payload: unknown) => db.sql(`
  INSERT INTO public.builder_network_inbound_events(connection_id, event_type, dedupe_key, payload, source_version)
  VALUES (${lit(connection)}, ${lit(eventType)}, ${lit(dedupe)}, ${json(payload)}, 1)`);
const sweep = () => db.sql('SELECT * FROM public.builder_network_apply_message_events(50)');
const mainSweep = () => db.sql('SELECT * FROM public.builder_network_apply_inbound_events(50)');
const builderMessage = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 1,
  conversation_id: conversationId(NET_A, ITEM_A1),
  message_id: randomUUID(),
  stock_item_id: ITEM_A1,
  body: 'Lot 101 is available; the deposit is 5%.',
  sender_display_name: 'Avery Builder',
  sent_at: '2026-09-25T10:00:00.000000Z',
  generation: 1,
  ...overrides,
});
const receipt = (message: string, generation: number, outcome: string, reason?: string, connection = CONN_A) =>
  land(connection, 'agency.message.receipt', `agency.receipt:${message}:${generation}:${randomUUID()}`, {
    schema_version: 1, message_id: message, conversation_id: conversationId(NET_A, ITEM_A1),
    generation, outcome, ...(reason ? { reason } : {}),
  });

describe.skipIf(!runs)('agency messaging (Command Centre)', () => {
  beforeAll(() => {
    db = startThrowawayPostgres();
    db.file(join(__dirname, 'support', 'builderNetworkStandins.sql'));
    for (const file of NETWORK) db.file(join(MIGRATIONS, file));
    db.sql(`
      INSERT INTO public.feature_flags(key, value) VALUES ('builder_network_enabled', 'true'::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
      INSERT INTO public.custom_users(id, username, first_name, last_name, is_active)
      VALUES (${lit(OWNER)}, 'owner', 'Olive', 'Owner', true),
             (${lit(COLLEAGUE)}, 'Casey Colleague', NULL, NULL, true),
             (${lit(INACTIVE)}, 'gone', 'Gone', 'User', false);
      INSERT INTO public.builder_network_stock_items(id, organisation_id, address_line, lot_number, lifecycle_status)
      VALUES (${lit(ITEM_A1)}, ${lit(ORG_A)}, '1 Check Street', '101', 'active'),
             (${lit(ITEM_A2)}, ${lit(ORG_A)}, '2 Check Street', '102', 'active'),
             (${lit(ITEM_B1)}, ${lit(ORG_B)}, '9 Other Road', '9', 'active');`);
    CONN_A = db.sql(`INSERT INTO public.builder_network_connections(network_connection_id, state, scopes,
        outbound_hmac_secret, network_inbound_url, builder_organisation_id, accepted_at)
      VALUES (${lit(NET_A)}, 'active', ARRAY['stock:publish'], 's', 'https://network.example/functions/v1/builder-network-inbound', ${lit(ORG_A)}, now())
      RETURNING id`);
    CONN_B = db.sql(`INSERT INTO public.builder_network_connections(network_connection_id, state, scopes,
        outbound_hmac_secret, network_inbound_url, builder_organisation_id, accepted_at)
      VALUES (${lit(NET_B)}, 'active', ARRAY['stock:publish'], 's', 'https://network.example/functions/v1/builder-network-inbound', ${lit(ORG_B)}, now())
      RETURNING id`);
    const client = db.sql(`INSERT INTO public.clients(primary_first_name, primary_surname) VALUES ('Private', 'Client') RETURNING id`);
    db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status, internal_notes)
            VALUES (${lit(ITEM_A1)}, ${lit(ORG_A)}, ${lit(client)}, ${lit(OWNER)}, 'selected', 'Private note about the client')`);
    db.sql('DELETE FROM public.builder_network_outbox');
  }, 120_000);
  afterAll(() => db?.stop());

  describe('starting and writing', () => {
    let first = '';
    it('1. a Command Centre user writes about an activated property; it is queued and named', () => {
      first = post(ITEM_A1, OWNER, randomUUID(), '  Is lot 101 still available?  ');
      expect(db.sql(`SELECT conversation_id || '|' || side || '|' || delivery_state || '|' || body || '|' || sender_display_name
                     FROM public.builder_network_messages WHERE id = ${lit(first)}`))
        .toBe(`${conversationId(NET_A, ITEM_A1)}|command_centre|queued|Is lot 101 still available?|Olive Owner`);
      expect(db.sql(`SELECT owner_user_id || '|' || started_by_user_id FROM public.builder_network_conversations
                     WHERE id = ${lit(conversationId(NET_A, ITEM_A1))}`)).toBe(`${OWNER}|${OWNER}`);
    });

    it('2. exactly one signed-network event carries it, naming no user, client or note', () => {
      const payload = JSON.parse(db.sql(`SELECT payload FROM public.builder_network_outbox
                                         WHERE dedupe_key = 'agency.message:${first}:1'`));
      expect(Object.keys(payload).sort()).toEqual([
        'body', 'conversation_id', 'generation', 'message_id', 'schema_version', 'sender_display_name', 'sent_at', 'stock_item_id',
      ]);
      const text = JSON.stringify(payload);
      for (const secret of [OWNER, 'Private', 'Client', 'Private note']) expect(text).not.toContain(secret);
      expect(() => assertPayloadCrossesClean(payload)).not.toThrow();
    });

    it('6. a second authorised user writes into the same conversation as themselves', () => {
      const second = post(ITEM_A1, COLLEAGUE, randomUUID(), 'Adding: settlement in June.');
      expect(db.sql(`SELECT count(DISTINCT conversation_id) || '|' || string_agg(sender_display_name, ',' ORDER BY sent_at)
                     FROM public.builder_network_messages WHERE id IN (${lit(first)}, ${lit(second)})`))
        .toBe('1|Olive Owner,Casey Colleague');
    });

    it('17. conversation creation is idempotent: one row for the pair however often it is written to', () => {
      post(ITEM_A1, OWNER, randomUUID(), 'Third.');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_conversations WHERE connection_id = ${lit(CONN_A)}`)).toBe('1');
    });

    it('11/12. the same send again (replay, or a retry after an ambiguous timeout) is one message and one event', () => {
      const key = randomUUID();
      const a = post(ITEM_A1, OWNER, key, 'Only once please.');
      const b = post(ITEM_A1, OWNER, key, 'Only once please.');
      expect(a).toBe(b);
      expect(outbox(`dedupe_key LIKE 'agency.message:${a}:%'`)).toBe('1');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE body = 'Only once please.'`)).toBe('1');
    });

    it('the same key with different text is refused, never answered with the original', () => {
      const key = randomUUID();
      post(ITEM_A1, OWNER, key, 'Is lot 101 available?');
      expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(OWNER)}, ${lit(key)}, 'Is lot 102 available?')`))
        .toMatch(/AGENCY_MESSAGE_ID_REUSED/);
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE client_message_id = ${lit(key)}`)).toBe('1');
    });
  });

  describe('who may write where', () => {
    it('10. a property nobody here activated has no conversation', () => {
      expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A2)}, ${lit(OWNER)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
    });
    it('8. a property of a builder with no activation here is refused', () => {
      expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_B1)}, ${lit(OWNER)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
    });
    it('7. an inactive user cannot write', () => {
      expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(INACTIVE)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_SENDER_NOT_A_MEMBER/);
    });
    it('an unknown property and an empty body are refused', () => {
      expect(refusal(`SELECT public.builder_network_post_message(gen_random_uuid(), ${lit(OWNER)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_CONVERSATION_NOT_FOUND/);
      expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(OWNER)}, gen_random_uuid(), '   ')`))
        .toMatch(/AGENCY_MESSAGE_INVALID/);
    });
    it('nothing is written while the network is switched off', () => {
      db.sql(`UPDATE public.feature_flags SET value = 'false'::jsonb WHERE key = 'builder_network_enabled'`);
      expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(OWNER)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_NETWORK_DISABLED/);
      db.sql(`UPDATE public.feature_flags SET value = 'true'::jsonb WHERE key = 'builder_network_enabled'`);
    });
  });

  describe('the builder\'s replies arriving', () => {
    const reply = builderMessage();
    it('3/4/5. a reply lands out of the main sweep\'s lane and arrives once, as the builder\'s', () => {
      land(CONN_A, 'agency.message.posted', `agency.message:${reply.message_id}:1`, reply);
      mainSweep();
      expect(db.sql(`SELECT COALESCE(apply_error, 'none') FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${reply.message_id}:1'`)).toBe('none');
      sweep();
      expect(db.sql(`SELECT count(*) || '|' || max(side) || '|' || max(sender_display_name)
                     FROM public.builder_network_messages WHERE id = ${lit(reply.message_id)}`))
        .toBe('1|builder|Avery Builder');
      expect(outbox(`dedupe_key = 'agency.receipt:${reply.message_id}:1' AND payload->>'outcome' = 'accepted'`)).toBe('1');
    });

    it('11. a redelivery and a retry of it converge on one message', () => {
      land(CONN_A, 'agency.message.posted', `agency.message:${reply.message_id}:1:again`, reply);
      land(CONN_A, 'agency.message.posted', `agency.message:${reply.message_id}:2`, { ...reply, generation: 2 });
      sweep();
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(reply.message_id)}`)).toBe('1');
      expect(outbox(`dedupe_key LIKE 'agency.receipt:${reply.message_id}:%'`)).toBe('2');
    });

    it('a stored message id arriving with changed content is refused, and the stored message is untouched', () => {
      const original = builderMessage({ body: 'The original words.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${original.message_id}:1`, original);
      sweep();
      for (const [n, change] of [
        [2, { body: 'Different words.' }],
        [3, { sender_display_name: 'Someone Else' }],
        [4, { sent_at: '2026-09-24T09:00:00.000000Z' }],
      ] as Array<[number, Record<string, unknown>]>) {
        land(CONN_A, 'agency.message.posted', `agency.message:${original.message_id}:${n}`, { ...original, ...change, generation: n });
        sweep();
        expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${original.message_id}:${n}'`)).toBe('refused:message_conflict');
        expect(outbox(`dedupe_key = 'agency.receipt:${original.message_id}:${n}' AND payload->>'outcome' = 'refused'`)).toBe('1');
      }
      expect(db.sql(`SELECT body || '|' || sender_display_name FROM public.builder_network_messages WHERE id = ${lit(original.message_id)}`))
        .toBe('The original words.|Avery Builder');
    });

    it('two concurrent envelopes for one message id: the loser with different content is refused, not acknowledged', async () => {
      const racer = builderMessage({ body: 'Racer A.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${racer.message_id}:1`, racer);
      land(CONN_A, 'agency.message.posted', `agency.message:${racer.message_id}:2`, { ...racer, body: 'Racer B.', generation: 2 });
      const eventOf = (n: number) => db.sql(`SELECT id FROM public.builder_network_inbound_events
                                             WHERE dedupe_key = 'agency.message:${racer.message_id}:${n}'`);
      const [e1, e2] = [eventOf(1), eventOf(2)];
      const first = db.sqlAsync(`BEGIN; SELECT public.builder_network_apply_message_event('${e1}'); SELECT pg_sleep(1.5); COMMIT;`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const second = db.sqlAsync(`SELECT public.builder_network_apply_message_event('${e2}')`);
      const [a, b] = await Promise.all([first, second]);
      db.sql(`UPDATE public.builder_network_inbound_events SET message_applied_at = now() WHERE id IN ('${e1}', '${e2}')`);
      expect(a.split('\n')[0]).toBe('applied');
      expect(b).toBe('refused:message_conflict');
      expect(db.sql(`SELECT body FROM public.builder_network_messages WHERE id = ${lit(racer.message_id)}`)).toBe('Racer A.');
      expect(outbox(`dedupe_key = 'agency.receipt:${racer.message_id}:2' AND payload->>'outcome' = 'refused'`)).toBe('1');
    }, 20_000);

    it.each([
      ['9. a conversation computed for another connection (wrong workspace)', () => builderMessage({ conversation_id: conversationId(NET_B, ITEM_A1) }), 'conversation_mismatch'],
      ['8. another builder\'s property', () => builderMessage({ stock_item_id: ITEM_B1, conversation_id: conversationId(NET_A, ITEM_B1) }), 'stock_item_not_ours'],
      ['10. a property this workspace never activated', () => builderMessage({ stock_item_id: ITEM_A2, conversation_id: conversationId(NET_A, ITEM_A2) }), 'conversation_not_open'],
      ['a malformed message', () => builderMessage({ sender_display_name: '' }), 'invalid_message'],
    ])('%s is refused, stores nothing and is answered', (_label, make, reason) => {
      const message = make();
      land(CONN_A, 'agency.message.posted', `agency.message:${message.message_id}:1`, message);
      sweep();
      expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${message.message_id}:1'`)).toBe(`refused:${reason}`);
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(message.message_id)}`)).toBe('0');
      expect(outbox(`dedupe_key = 'agency.receipt:${message.message_id}:1' AND payload->>'outcome' = 'refused'`)).toBe('1');
    });

    it('a message over a connection to another builder cannot write into this builder\'s conversation', () => {
      const message = builderMessage();
      land(CONN_B, 'agency.message.posted', `agency.message:${message.message_id}:1`, message);
      sweep();
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(message.message_id)}`)).toBe('0');
    });
  });

  describe('delivery', () => {
    it('delivered means the builder accepted it — not that the envelope left', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Delivery check.');
      db.sql(`UPDATE public.builder_network_outbox SET status = 'delivered', delivered_at = now() WHERE dedupe_key = 'agency.message:${m}:1'`);
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(m)}`)).toBe('queued');
      receipt(m, 1, 'accepted');
      sweep();
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(m)}`)).toBe('delivered');
    });

    it('14/15. a failed delivery stays visible, and its writer\'s retry goes failed → delivered with no duplicate', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Retry check.');
      db.sql(`UPDATE public.builder_network_outbox SET status = 'dead' WHERE dedupe_key = 'agency.message:${m}:1'`);
      expect(db.sql(`SELECT delivery_state || '|' || failure_reason FROM public.builder_network_messages WHERE id = ${lit(m)}`))
        .toBe('failed|not_delivered');
      expect(refusal(`SELECT public.builder_network_retry_message(${lit(m)}, ${lit(COLLEAGUE)})`)).toMatch(/NOT_RETRYABLE/);
      db.sql(`SELECT public.builder_network_retry_message(${lit(m)}, ${lit(OWNER)})`);
      expect(outbox(`dedupe_key = 'agency.message:${m}:2'`)).toBe('1');
      receipt(m, 1, 'accepted');
      sweep();
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(m)}`)).toBe('queued');
      receipt(m, 2, 'accepted');
      sweep();
      expect(db.sql(`SELECT delivery_state || '|' || delivery_generation FROM public.builder_network_messages WHERE id = ${lit(m)}`))
        .toBe('delivered|2');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE body = 'Retry check.'`)).toBe('1');
    });

    it('a refused receipt fails the message with the builder\'s reason', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Refusal check.');
      receipt(m, 1, 'refused', 'conversation_not_open');
      sweep();
      expect(db.sql(`SELECT delivery_state || '|' || failure_reason FROM public.builder_network_messages WHERE id = ${lit(m)}`))
        .toBe('failed|refused:conversation_not_open');
    });

    it('a receipt with no outcome, or a null one, is refused and changes nothing', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'A receipt with no outcome must not fail me.');
      for (const extra of [{}, { outcome: null }]) {
        land(CONN_A, 'agency.message.receipt', `agency.receipt:${m}:1:${randomUUID()}`, {
          schema_version: 1, message_id: m, conversation_id: conversationId(NET_A, ITEM_A1), generation: 1, ...extra,
        });
        sweep();
        expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(m)}`)).toBe('queued');
      }
    });

    it('a receipt over another connection cannot touch this conversation\'s message', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Cross-connection receipt.');
      receipt(m, 1, 'accepted', undefined, CONN_B);
      sweep();
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(m)}`)).toBe('queued');
    });
  });

  describe('a relationship whose two ends disagree', () => {
    it('holds a builder message unconsumed while the connection is halted, and applies it once repaired', () => {
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = now() WHERE id = ${lit(CONN_A)}`);
      const held = builderMessage({ body: 'Held during the halt.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${held.message_id}:1`, held);
      sweep();
      expect(db.sql(`SELECT (message_applied_at IS NULL) || '|' || message_apply_attempts FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${held.message_id}:1'`)).toBe('true|0');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(held.message_id)}`)).toBe('0');
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
      sweep();
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(held.message_id)}`)).toBe('1');
    });
  });

  describe('a relationship whose two ends disagree — outbound', () => {
    it('nothing new is written to, or re-sent over, a halted connection', () => {
      const failed = post(ITEM_A1, OWNER, randomUUID(), 'Failed before the halt.');
      receipt(failed, 1, 'refused', 'x');
      sweep();
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = now() WHERE id = ${lit(CONN_A)}`);
      const before = outbox(`event_type = 'agency.message.posted'`);
      expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(OWNER)}, gen_random_uuid(), 'During the halt.')`))
        .toMatch(/AGENCY_CONNECTION_HALTED/);
      expect(refusal(`SELECT public.builder_network_retry_message(${lit(failed)}, ${lit(OWNER)})`)).toMatch(/AGENCY_CONNECTION_HALTED/);
      expect(outbox(`event_type = 'agency.message.posted'`)).toBe(before);
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE body = 'During the halt.'`)).toBe('0');
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
      expect(post(ITEM_A1, OWNER, randomUUID(), 'After the repair.')).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('a connection that stops being deliverable', () => {
    const heldOf = (m: string) => db.sql(`SELECT (available_at = 'infinity') FROM public.builder_network_outbox
                                          WHERE dedupe_key = 'agency.message:${m}:1'`);
    it('queued messages are held, not sent, while the identity is disputed — and released once it is repaired', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Queued just before the dispute.');
      expect(heldOf(m)).toBe('f');
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = now() WHERE id = ${lit(CONN_A)}`);
      expect(heldOf(m)).toBe('t');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_claim_outbox('spec', 100) WHERE dedupe_key = 'agency.message:${m}:1'`))
        .toBe('0');
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
      expect(heldOf(m)).toBe('f');
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(m)}`)).toBe('queued');
    });

    it('the same when stock:publish is withdrawn; a retry needs the scope; a builder message needs it too', () => {
      const queued = post(ITEM_A1, OWNER, randomUUID(), 'Queued just before the scope went.');
      const failed = post(ITEM_A1, OWNER, randomUUID(), 'Failed before the scope went.');
      receipt(failed, 1, 'refused', 'x');
      sweep();
      db.sql(`UPDATE public.builder_network_connections SET scopes = ARRAY[]::text[] WHERE id = ${lit(CONN_A)}`);
      try {
        expect(heldOf(queued)).toBe('t');
        expect(refusal(`SELECT public.builder_network_retry_message(${lit(failed)}, ${lit(OWNER)})`)).toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
        expect(db.sql(`SELECT delivery_state || '|' || delivery_generation FROM public.builder_network_messages WHERE id = ${lit(failed)}`))
          .toBe('failed|1');
        const inbound = builderMessage({ body: 'Written after the scope went.' });
        land(CONN_A, 'agency.message.posted', `agency.message:${inbound.message_id}:1`, inbound);
        sweep();
        expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${inbound.message_id}:1'`)).toBe('refused:scope_revoked');
        // The builder is told, not left to time out.
        expect(outbox(`dedupe_key = 'agency.receipt:${inbound.message_id}:1' AND payload->>'outcome' = 'refused'
                       AND payload->>'reason' = 'scope_revoked'`)).toBe('1');
        expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(inbound.message_id)}`)).toBe('0');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET scopes = ARRAY['stock:publish'] WHERE id = ${lit(CONN_A)}`);
      }
      expect(heldOf(queued)).toBe('f');
    });

    const outboxIdOf = (m: string) => db.sql(`SELECT id FROM public.builder_network_outbox WHERE dedupe_key = 'agency.message:${m}:1'`);
    const claimOnly = (m: string, worker: string) => db.sql(`UPDATE public.builder_network_outbox
        SET locked_at = now(), locked_by = '${worker}', attempts = attempts + 1
      WHERE dedupe_key = 'agency.message:${m}:1' RETURNING attempts`);

    it('a worker that finds a claimed message held parks it without spending an attempt, and recovery releases it', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Claimed, then the dispute began.');
      expect(claimOnly(m, 'park-w')).toBe('1');
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = now() WHERE id = ${lit(CONN_A)}`);
      try {
        expect(db.sql(`SELECT public.builder_network_park_held_message('${outboxIdOf(m)}', 'park-w')`)).toBe('t');
        expect(db.sql(`SELECT (available_at = 'infinity') || '|' || (locked_by IS NULL) || '|' || attempts
                       FROM public.builder_network_outbox WHERE dedupe_key = 'agency.message:${m}:1'`)).toBe('true|true|0');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
      }
      expect(heldOf(m)).toBe('f');
    });

    it('a route that recovers while the worker is parking is not parked behind it for ever', async () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Claimed during a dispute that is ending.');
      claimOnly(m, 'park-race');
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = now() WHERE id = ${lit(CONN_A)}`);
      try {
        // The recovery holds the connection row, uncommitted, while the worker
        // (which read the route as held) tries to park the claimed row.
        const recovery = db.sqlAsync(`BEGIN; UPDATE public.builder_network_connections SET identity_mismatch_since = NULL
                                        WHERE id = ${lit(CONN_A)}; SELECT pg_sleep(1.5); COMMIT;`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const park = db.sqlAsync(`SELECT public.builder_network_park_held_message('${outboxIdOf(m)}', 'park-race')`);
        const [, parked] = await Promise.all([recovery, park]);
        expect(parked).toBe('f');
        expect(db.sql(`SELECT (available_at <> 'infinity') || '|' || (locked_by IS NULL)
                       FROM public.builder_network_outbox WHERE dedupe_key = 'agency.message:${m}:1'`)).toBe('true|true');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
      }
    }, 20_000);

    it('a worker cannot park a row it does not hold', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Claimed by somebody else.');
      claimOnly(m, 'other-w');
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = now() WHERE id = ${lit(CONN_A)}`);
      try {
        expect(db.sql(`SELECT public.builder_network_park_held_message('${outboxIdOf(m)}', 'park-w')`)).toBe('f');
        expect(db.sql(`SELECT locked_by || '|' || attempts FROM public.builder_network_outbox
                       WHERE dedupe_key = 'agency.message:${m}:1'`)).toBe('other-w|1');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
      }
    });
  });

  describe('after the activation is withdrawn', () => {
    it('a stored message\'s retry is still acknowledged; a new message is still refused', () => {
      const stored = builderMessage({ body: 'Stored before the withdrawal.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${stored.message_id}:1`, stored);
      sweep();
      db.sql(`UPDATE public.builder_stock_selections SET status = 'withdrawn' WHERE stock_item_id = ${lit(ITEM_A1)}`);
      try {
        land(CONN_A, 'agency.message.posted', `agency.message:${stored.message_id}:2`, { ...stored, generation: 2 });
        const fresh = builderMessage({ body: 'Written after the withdrawal.' });
        land(CONN_A, 'agency.message.posted', `agency.message:${fresh.message_id}:1`, fresh);
        sweep();
        expect(outbox(`dedupe_key = 'agency.receipt:${stored.message_id}:2' AND payload->>'outcome' = 'accepted'`)).toBe('1');
        expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(stored.message_id)}`)).toBe('1');
        expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${fresh.message_id}:1'`)).toBe('refused:conversation_not_open');
      } finally {
        db.sql(`UPDATE public.builder_stock_selections SET status = 'selected' WHERE stock_item_id = ${lit(ITEM_A1)}`);
      }
    });
  });

  describe('the network switched off', () => {
    it('a failed message cannot be sent again while the network is off', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Failed before the switch-off.');
      receipt(m, 1, 'refused', 'x');
      sweep();
      db.sql(`UPDATE public.feature_flags SET value = 'false'::jsonb WHERE key = 'builder_network_enabled'`);
      try {
        expect(refusal(`SELECT public.builder_network_retry_message(${lit(m)}, ${lit(OWNER)})`)).toMatch(/AGENCY_NETWORK_DISABLED/);
        expect(db.sql(`SELECT delivery_state || '|' || delivery_generation FROM public.builder_network_messages WHERE id = ${lit(m)}`))
          .toBe('failed|1');
      } finally {
        db.sql(`UPDATE public.feature_flags SET value = 'true'::jsonb WHERE key = 'builder_network_enabled'`);
      }
    });
  });

  describe('two sends of one message at once', () => {
    it('the one that loses the race returns the winner\'s message instead of failing', async () => {
      const key = randomUUID();
      const send = `SELECT id FROM public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(OWNER)}, ${lit(key)}, 'Raced send.')`;
      // Two real sessions. The first holds its message uncommitted; the second
      // misses it at the lookup, then waits on the unique index until the
      // first commits — the window a double click or a retried request shares.
      const first = db.sqlAsync(`BEGIN; ${send}; SELECT pg_sleep(1.5); COMMIT;`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const second = db.sqlAsync(send);
      const [a, b] = await Promise.all([first, second]);
      expect(a.split('\n')[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(b).toBe(a.split('\n')[0]);
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE client_message_id = ${lit(key)}`)).toBe('1');
      // One generation-1 event crosses, and no other.
      expect(outbox(`dedupe_key = 'agency.message:${b}:1'`)).toBe('1');
      expect(outbox(`dedupe_key LIKE 'agency.message:${b}:%'`)).toBe('1');
    }, 20_000);

    it('the same key against another conversation is refused, never answered with the first', () => {
      const key = randomUUID();
      post(ITEM_A1, OWNER, key, 'Bound to its first conversation.');
      expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A2)}, ${lit(OWNER)}, ${lit(key)}, 'Bound to its first conversation.')`))
        .toMatch(/AGENCY_MESSAGE_ID_REUSED/);
    });
  });

  describe('the last word on a disputed or unscoped connection', () => {
    it('a dispute that begins after the sweep selected an event still holds it, unconsumed', () => {
      const late = builderMessage({ body: 'Selected just before the dispute.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${late.message_id}:1`, late);
      const eventId = db.sql(`SELECT id FROM public.builder_network_inbound_events WHERE dedupe_key = 'agency.message:${late.message_id}:1'`);
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = now() WHERE id = ${lit(CONN_A)}`);
      try {
        expect(db.sql(`SELECT public.builder_network_apply_message_event('${eventId}')`)).toBe('held');
        expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(late.message_id)}`)).toBe('0');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
      }
      sweep();
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(late.message_id)}`)).toBe('1');
    });

    it('the sweep leaves a held event unstamped, without spending an attempt', () => {
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = now() WHERE id = ${lit(CONN_A)}`);
      try {
        const m = builderMessage({ body: 'Held at apply time.' });
        land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:1`, m);
        // The sweep's own predicate skips the halted connection; the apply-time
        // answer is the backstop, exercised directly above.
        sweep();
        expect(db.sql(`SELECT (message_applied_at IS NULL) || '|' || message_apply_attempts FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${m.message_id}:1'`)).toBe('true|0');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
        sweep();
      }
    });

    it('a refusal to a builder that withdrew stock:publish is sent, not held behind the scope it withdrew', () => {
      db.sql(`UPDATE public.builder_network_connections SET scopes = ARRAY[]::text[] WHERE id = ${lit(CONN_A)}`);
      try {
        const m = builderMessage({ body: 'After the scope went, again.' });
        land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:1`, m);
        sweep();
        expect(db.sql(`SELECT (available_at <> 'infinity') FROM public.builder_network_outbox
                       WHERE dedupe_key = 'agency.receipt:${m.message_id}:1'`)).toBe('t');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET scopes = ARRAY['stock:publish'] WHERE id = ${lit(CONN_A)}`);
      }
    });
  });

  describe('a lost response, retried after the relationship changed', () => {
    it.each([
      ['a dispute', `identity_mismatch_since = now()`, `identity_mismatch_since = NULL`],
      ['a withdrawn scope', `scopes = ARRAY[]::text[]`, `scopes = ARRAY['stock:publish']`],
      ['a revocation', `state = 'revoked', revoked_at = now()`, `state = 'active', revoked_at = NULL`],
    ])('after %s, the same send is answered with the message it already made; an edit is still refused', (_label, change, restore) => {
      const key = randomUUID();
      const original = post(ITEM_A1, OWNER, key, 'Sent just before the change.');
      db.sql(`UPDATE public.builder_network_connections SET ${change} WHERE id = ${lit(CONN_A)}`);
      try {
        expect(post(ITEM_A1, OWNER, key, 'Sent just before the change.')).toBe(original);
        expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(OWNER)}, ${lit(key)}, 'Edited after the change.')`))
          .toMatch(/AGENCY_MESSAGE_ID_REUSED/);
        expect(outbox(`dedupe_key LIKE 'agency.message:${original}:%'`)).toBe('1');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET ${restore} WHERE id = ${lit(CONN_A)}`);
      }
    });
  });

  describe('a held message on a connection that is then revoked', () => {
    it.each([
      ['a dispute', `identity_mismatch_since = now()`],
      ['a withdrawn scope', `scopes = ARRAY[]::text[]`],
    ])('held by %s, it fails visibly on revocation instead of waiting for ever', (_label, hold) => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Held, then the connection is revoked.');
      db.sql(`UPDATE public.builder_network_connections SET ${hold} WHERE id = ${lit(CONN_A)}`);
      try {
        expect(db.sql(`SELECT (available_at = 'infinity') FROM public.builder_network_outbox WHERE dedupe_key = 'agency.message:${m}:1'`)).toBe('t');
        db.sql(`UPDATE public.builder_network_connections SET state = 'revoked', revoked_at = now() WHERE id = ${lit(CONN_A)}`);
        expect(db.sql(`SELECT status FROM public.builder_network_outbox WHERE dedupe_key = 'agency.message:${m}:1'`)).toBe('dead');
        expect(db.sql(`SELECT delivery_state || '|' || failure_reason FROM public.builder_network_messages WHERE id = ${lit(m)}`))
          .toBe('failed|not_delivered');
      } finally {
        db.sql(`UPDATE public.builder_network_connections
                   SET state = 'active', revoked_at = NULL, identity_mismatch_since = NULL, scopes = ARRAY['stock:publish']
                 WHERE id = ${lit(CONN_A)}`);
      }
    });
  });

  describe('a message never overtakes the activation it depends on', () => {
    const claim = (dedupe: string, worker: string) => db.sql(`UPDATE public.builder_network_outbox
        SET locked_at = now(), locked_by = '${worker}', attempts = attempts + 1
      WHERE dedupe_key = '${dedupe}' RETURNING id`);
    // Earlier tests withdraw and restore selections, which leaves real pending
    // activation events on this connection; each test here sets them aside so
    // it measures only the rows it writes, and puts them back.
    let asideIds = '';
    beforeEach(() => {
      asideIds = db.sql(`WITH aside AS (
          UPDATE public.builder_network_outbox SET status = 'delivered', delivered_at = now()
           WHERE connection_id = ${lit(CONN_A)} AND event_type LIKE 'stock.selection.%' AND status = 'pending'
          RETURNING id)
        SELECT coalesce(string_agg(quote_literal(id::text), ','), '') FROM aside`);
    });
    afterEach(() => {
      if (asideIds) db.sql(`UPDATE public.builder_network_outbox SET status = 'pending', delivered_at = NULL WHERE id::text IN (${asideIds})`);
    });

    it('waits, spending no attempt, while an earlier activation on the connection is still undelivered', () => {
      const announce = `stock.selection:${randomUUID()}:1`;
      db.sql(`INSERT INTO public.builder_network_outbox(connection_id, event_type, dedupe_key, payload, source_version)
              VALUES (${lit(CONN_A)}, 'stock.selection.announced', '${announce}', '{}'::jsonb, 1)`);
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Written right after activating.');
      const row = claim(`agency.message:${m}:1`, 'order-w');
      try {
        expect(db.sql(`SELECT public.builder_network_defer_message_behind_activation('${row}', 'order-w')`)).toBe('t');
        expect(db.sql(`SELECT (available_at > now()) || '|' || (locked_by IS NULL) || '|' || attempts
                       FROM public.builder_network_outbox WHERE id = '${row}'`)).toBe('true|true|0');
        db.sql(`UPDATE public.builder_network_outbox SET status = 'delivered', delivered_at = now() WHERE dedupe_key = '${announce}'`);
        claim(`agency.message:${m}:1`, 'order-w');
        expect(db.sql(`SELECT public.builder_network_defer_message_behind_activation('${row}', 'order-w')`)).toBe('f');
      } finally {
        db.sql(`DELETE FROM public.builder_network_outbox WHERE dedupe_key = '${announce}'`);
      }
    });

    it('also waits while that activation is claimed and in flight: a claim does not make it delivered', () => {
      const announce = `stock.selection:${randomUUID()}:1`;
      db.sql(`INSERT INTO public.builder_network_outbox(connection_id, event_type, dedupe_key, payload, source_version)
              VALUES (${lit(CONN_A)}, 'stock.selection.announced', '${announce}', '{}'::jsonb, 1)`);
      claim(announce, 'other-worker');
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Written while the activation is in flight.');
      const row = claim(`agency.message:${m}:1`, 'order-w3');
      try {
        expect(db.sql(`SELECT public.builder_network_defer_message_behind_activation('${row}', 'order-w3')`)).toBe('t');
      } finally {
        db.sql(`DELETE FROM public.builder_network_outbox WHERE dedupe_key = '${announce}'`);
      }
    });

    it('is not held behind an activation that was written after it, or one that dead-lettered', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Written before the next activation.');
      const dead = `stock.selection:${randomUUID()}:1`;
      const later = `stock.selection:${randomUUID()}:1`;
      db.sql(`INSERT INTO public.builder_network_outbox(connection_id, event_type, dedupe_key, payload, source_version, status, created_at)
              VALUES (${lit(CONN_A)}, 'stock.selection.announced', '${dead}', '{}'::jsonb, 1, 'dead', now() - interval '1 minute'),
                     (${lit(CONN_A)}, 'stock.selection.announced', '${later}', '{}'::jsonb, 1, 'pending', now() + interval '1 minute')`);
      const row = claim(`agency.message:${m}:1`, 'order-w2');
      try {
        expect(db.sql(`SELECT public.builder_network_defer_message_behind_activation('${row}', 'order-w2')`)).toBe('f');
      } finally {
        db.sql(`DELETE FROM public.builder_network_outbox WHERE dedupe_key IN ('${dead}', '${later}')`);
      }
    });
  });

  describe('a property that changed hands', () => {
    const reassign = (org: string) => db.sql(`UPDATE public.builder_network_stock_items SET organisation_id = ${lit(org)} WHERE id = ${lit(ITEM_A1)}`);

    it('a failed message cannot be sent again to the builder who no longer holds the property', () => {
      const failed = post(ITEM_A1, OWNER, randomUUID(), 'Failed before the property changed hands.');
      receipt(failed, 1, 'refused', 'x');
      sweep();
      reassign(ORG_B);
      try {
        expect(refusal(`SELECT public.builder_network_retry_message(${lit(failed)}, ${lit(OWNER)})`)).toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
        expect(db.sql(`SELECT delivery_state || '|' || delivery_generation FROM public.builder_network_messages WHERE id = ${lit(failed)}`))
          .toBe('failed|1');
      } finally {
        reassign(ORG_A);
      }
    });

    it('a stored message redelivered after it changed hands is acknowledged again; new content from the former builder is refused', () => {
      const stored = builderMessage({ body: 'Stored before the property changed hands.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${stored.message_id}:1`, stored);
      sweep();
      reassign(ORG_B);
      try {
        land(CONN_A, 'agency.message.posted', `agency.message:${stored.message_id}:2`, { ...stored, generation: 2 });
        const fresh = builderMessage({ body: 'New from the former builder.' });
        land(CONN_A, 'agency.message.posted', `agency.message:${fresh.message_id}:1`, fresh);
        sweep();
        expect(outbox(`dedupe_key = 'agency.receipt:${stored.message_id}:2' AND payload->>'outcome' = 'accepted'`)).toBe('1');
        expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${fresh.message_id}:1'`)).toBe('refused:stock_item_not_ours');
      } finally {
        reassign(ORG_A);
      }
    });
  });

  describe('a stored builder message, redelivered after stock:publish was withdrawn', () => {
    it('is acknowledged again, while new content is still refused', () => {
      const stored = builderMessage({ body: 'Stored before the scope went.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${stored.message_id}:1`, stored);
      sweep();
      db.sql(`UPDATE public.builder_network_connections SET scopes = ARRAY[]::text[] WHERE id = ${lit(CONN_A)}`);
      try {
        land(CONN_A, 'agency.message.posted', `agency.message:${stored.message_id}:2`, { ...stored, generation: 2 });
        const fresh = builderMessage({ body: 'New after the scope went.' });
        land(CONN_A, 'agency.message.posted', `agency.message:${fresh.message_id}:1`, fresh);
        sweep();
        expect(outbox(`dedupe_key = 'agency.receipt:${stored.message_id}:2' AND payload->>'outcome' = 'accepted'`)).toBe('1');
        expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${fresh.message_id}:1'`)).toBe('refused:scope_revoked');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET scopes = ARRAY['stock:publish'] WHERE id = ${lit(CONN_A)}`);
      }
    });
  });

  describe('a value of the wrong JSON type', () => {
    it('a builder message whose body is an object is refused and stored nowhere', () => {
      const typed = { ...builderMessage(), body: { text: 'hello there' } };
      land(CONN_A, 'agency.message.posted', `agency.message:${typed.message_id}:1`, typed);
      sweep();
      expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${typed.message_id}:1'`)).toBe('refused:invalid_payload');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(typed.message_id)}`)).toBe('0');
    });
  });

  describe('a generation that is not a whole number', () => {
    it('a builder message with a fractional generation is refused and stored nowhere', () => {
      const fractional = builderMessage({ body: 'Generation one and a half.', generation: 1.5 });
      land(CONN_A, 'agency.message.posted', `agency.message:${fractional.message_id}:1.5`, fractional);
      sweep();
      expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${fractional.message_id}:1.5'`)).toBe('refused:invalid_payload');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(fractional.message_id)}`)).toBe('0');
    });
  });

  describe('a time that is not a time', () => {
    it.each(['infinity', '-infinity', 'now', 'today', 'epoch', '2026-09-25'])('a builder message sent at %s is refused as malformed and stored nowhere', (when) => {
      const odd = builderMessage({ body: `Sent at ${when}.`, sent_at: when });
      land(CONN_A, 'agency.message.posted', `agency.message:${odd.message_id}:1`, odd);
      sweep();
      expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${odd.message_id}:1'`)).toBe('refused:invalid_message');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(odd.message_id)}`)).toBe('0');
    });
  });

  describe('a time from the future', () => {
    it('refuses a message dated well past this side\'s clock, and stores one inside ordinary clock skew', () => {
      const future = builderMessage({ body: 'Dated a millennium ahead.', sent_at: '9999-01-01T00:00:00Z' });
      land(CONN_A, 'agency.message.posted', `agency.message:${future.message_id}:1`, future);
      const skewed = builderMessage({ body: 'A minute ahead: clock skew.',
        sent_at: db.sql(`SELECT to_char((now() + interval '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`) });
      land(CONN_A, 'agency.message.posted', `agency.message:${skewed.message_id}:1`, skewed);
      sweep();
      expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${future.message_id}:1'`)).toBe('refused:invalid_message');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(future.message_id)}`)).toBe('0');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(skewed.message_id)}`)).toBe('1');
    });
  });

  describe('the exact contract, at the apply step too', () => {
    it('refuses a message or a receipt carrying a key outside the contract', () => {
      const extra = { ...builderMessage({ body: 'Carrying a field the contract does not have.' }), customer_details: 'Jordan Buyer' };
      land(CONN_A, 'agency.message.posted', `agency.message:${extra.message_id}:1`, extra);
      const waiting = post(ITEM_A1, OWNER, randomUUID(), 'Waiting on a clean receipt.');
      land(CONN_A, 'agency.message.receipt', `agency.receipt:${waiting}:1:${randomUUID()}`,
        { schema_version: 1, message_id: waiting, conversation_id: conversationId(NET_A, ITEM_A1), generation: 1, outcome: 'accepted', client_id: 'x' });
      sweep();
      expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${extra.message_id}:1'`)).toBe('refused:invalid_payload');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(extra.message_id)}`)).toBe('0');
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(waiting)}`)).toBe('queued');
    });
  });

  describe('a property the builder stopped listing, while its activation stands', () => {
    const archive = (status: string) => db.sql(`UPDATE public.builder_network_stock_items SET lifecycle_status = '${status}' WHERE id = ${lit(ITEM_A1)}`);

    it('takes no new message and no retry from this side', () => {
      const failed = post(ITEM_A1, OWNER, randomUUID(), 'Failed before the property was archived.');
      receipt(failed, 1, 'refused', 'x');
      sweep();
      archive('archived');
      try {
        expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(OWNER)}, ${lit(randomUUID())}, 'After archiving.')`))
          .toMatch(/AGENCY_CONVERSATION_NOT_FOUND/);
        expect(refusal(`SELECT public.builder_network_retry_message(${lit(failed)}, ${lit(OWNER)})`)).toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
        expect(db.sql(`SELECT delivery_state || '|' || delivery_generation FROM public.builder_network_messages WHERE id = ${lit(failed)}`))
          .toBe('failed|1');
      } finally {
        archive('active');
      }
    });

    it('stores no new builder message, and still acknowledges one it already holds', () => {
      const stored = builderMessage({ body: 'Stored before archiving.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${stored.message_id}:1`, stored);
      sweep();
      archive('archived');
      try {
        land(CONN_A, 'agency.message.posted', `agency.message:${stored.message_id}:2`, { ...stored, generation: 2 });
        const fresh = builderMessage({ body: 'Written after archiving.' });
        land(CONN_A, 'agency.message.posted', `agency.message:${fresh.message_id}:1`, fresh);
        sweep();
        expect(outbox(`dedupe_key = 'agency.receipt:${stored.message_id}:2' AND payload->>'outcome' = 'accepted'`)).toBe('1');
        expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${fresh.message_id}:1'`)).toBe('refused:conversation_not_open');
        expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(fresh.message_id)}`)).toBe('0');
      } finally {
        archive('active');
      }
    });
  });

  describe('a check and the change it guards against, at the same moment', () => {
    const settled = (p: Promise<string>) => p.then((out) => out, (error) => `ERROR ${String((error as { stderr?: unknown }).stderr ?? error)}`);

    it('a message written while the activation is being withdrawn waits for it, and is refused', async () => {
      const withdrawal = db.sqlAsync(`BEGIN; UPDATE public.builder_stock_selections SET status = 'withdrawn'
                                       WHERE stock_item_id = ${lit(ITEM_A1)}; SELECT pg_sleep(1.5); COMMIT;`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const body = `Racing the withdrawal ${randomUUID()}`;
      const write = settled(db.sqlAsync(`SELECT id FROM public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(OWNER)}, ${lit(randomUUID())}, ${lit(body)})`));
      try {
        const [, result] = await Promise.all([withdrawal, write]);
        expect(result).toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
        expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE body = ${lit(body)}`)).toBe('0');
      } finally {
        db.sql(`UPDATE public.builder_stock_selections SET status = 'selected' WHERE stock_item_id = ${lit(ITEM_A1)}`);
      }
    }, 20_000);

    it('a builder message applied while its property is being reassigned waits, and is refused', async () => {
      const m = builderMessage({ body: 'Applied while the property changes hands.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:1`, m);
      const eventId = db.sql(`SELECT id FROM public.builder_network_inbound_events WHERE dedupe_key = 'agency.message:${m.message_id}:1'`);
      const reassign = db.sqlAsync(`BEGIN; UPDATE public.builder_network_stock_items SET organisation_id = ${lit(ORG_B)}
                                     WHERE id = ${lit(ITEM_A1)}; SELECT pg_sleep(1.5); COMMIT;`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const apply = settled(db.sqlAsync(`SELECT public.builder_network_apply_message_event('${eventId}')`));
      try {
        const [, result] = await Promise.all([reassign, apply]);
        expect(result).toBe('refused:stock_item_not_ours');
        expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(m.message_id)}`)).toBe('0');
      } finally {
        db.sql(`UPDATE public.builder_network_stock_items SET organisation_id = ${lit(ORG_A)} WHERE id = ${lit(ITEM_A1)}`);
        db.sql(`UPDATE public.builder_network_inbound_events SET message_applied_at = now() WHERE id = '${eventId}'`);
      }
    }, 20_000);

    it('a builder message applied while a dispute begins waits for it, and is held', async () => {
      const m = builderMessage({ body: 'Applied while the dispute begins.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:1`, m);
      const eventId = db.sql(`SELECT id FROM public.builder_network_inbound_events WHERE dedupe_key = 'agency.message:${m.message_id}:1'`);
      const dispute = db.sqlAsync(`BEGIN; UPDATE public.builder_network_connections SET identity_mismatch_since = now()
                                    WHERE id = ${lit(CONN_A)}; SELECT pg_sleep(1.5); COMMIT;`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const apply = settled(db.sqlAsync(`SELECT public.builder_network_apply_message_event('${eventId}')`));
      try {
        const [, result] = await Promise.all([dispute, apply]);
        expect(result).toBe('held');
        expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(m.message_id)}`)).toBe('0');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
        sweep();
      }
    }, 20_000);
  });

  describe('a receipt that landed before the connection was revoked', () => {
    it('still settles our message; new content that landed with it is still refused', () => {
      const ours = post(ITEM_A1, OWNER, randomUUID(), 'Sent just before the revocation.');
      db.sql(`UPDATE public.builder_network_outbox SET status = 'delivered', delivered_at = now() WHERE dedupe_key = 'agency.message:${ours}:1'`);
      receipt(ours, 1, 'accepted');
      const theirs = builderMessage({ body: 'Landed just before the revocation.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${theirs.message_id}:1`, theirs);
      db.sql(`UPDATE public.builder_network_connections SET state = 'revoked', revoked_at = now() WHERE id = ${lit(CONN_A)}`);
      try {
        sweep();
        expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(ours)}`)).toBe('delivered');
        expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${theirs.message_id}:1'`)).toBe('refused:connection_not_active');
        expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(theirs.message_id)}`)).toBe('0');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET state = 'active', revoked_at = NULL WHERE id = ${lit(CONN_A)}`);
      }
    });
  });

  describe('a receipt that never gets back', () => {
    it('as RECEIVER (1, 2, 8, 9): the message is stored once, and a retry of it is answered again', () => {
      const lostIn = builderMessage({ body: 'Did you get this one?' });
      land(CONN_A, 'agency.message.posted', `agency.message:${lostIn.message_id}:1`, lostIn);
      sweep();
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(lostIn.message_id)}`)).toBe('1');
      db.sql(`UPDATE public.builder_network_outbox SET status = 'dead', last_error = 'http_503'
              WHERE dedupe_key = 'agency.receipt:${lostIn.message_id}:1'`);
      expect(outbox(`dedupe_key = 'agency.receipt:${lostIn.message_id}:1' AND status = 'dead'`)).toBe('1');
      land(CONN_A, 'agency.message.posted', `agency.message:${lostIn.message_id}:2`, { ...lostIn, generation: 2 });
      sweep();
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(lostIn.message_id)}`)).toBe('1');
      expect(outbox(`dedupe_key = 'agency.receipt:${lostIn.message_id}:2' AND payload->>'outcome' = 'accepted' AND status = 'pending'`))
        .toBe('1');
    });

    it('as SENDER (3–7, 10–12): unconfirmed past the window fails truthfully, and its writer\'s retry is confirmed once', () => {
      const lost = post(ITEM_A1, OWNER, randomUUID(), 'Is the price still current?');
      const pending = post(ITEM_A1, OWNER, randomUUID(), 'Still in the outbox.');
      const fresh = post(ITEM_A1, COLLEAGUE, randomUUID(), 'Delivered a moment ago.');
      db.sql(`UPDATE public.builder_network_outbox SET status = 'delivered', delivered_at = now()
              WHERE dedupe_key IN ('agency.message:${lost}:1', 'agency.message:${fresh}:1')`);
      sweep();
      // 3. the transport succeeded; no receipt yet, so still queued.
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(lost)}`)).toBe('queued');
      db.sql(`UPDATE public.builder_network_outbox SET delivered_at = now() - interval '16 minutes'
              WHERE dedupe_key = 'agency.message:${lost}:1';
              UPDATE public.builder_network_outbox SET created_at = now() - interval '2 hours'
              WHERE dedupe_key = 'agency.message:${pending}:1'`);
      sweep();
      // 4. past the confirmation window it fails, and says why truthfully.
      expect(db.sql(`SELECT delivery_state || '|' || failure_reason FROM public.builder_network_messages WHERE id = ${lit(lost)}`))
        .toBe('failed|confirmation_timeout');
      // 12. neither the one still in transit nor the one just delivered is touched.
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(pending)}`)).toBe('queued');
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(fresh)}`)).toBe('queued');
      // 6. a colleague may not retry it.
      expect(refusal(`SELECT public.builder_network_retry_message(${lit(lost)}, ${lit(COLLEAGUE)})`)).toMatch(/NOT_RETRYABLE/);
      // 5, 7. its writer can, under generation 2, as the same message.
      db.sql(`SELECT public.builder_network_retry_message(${lit(lost)}, ${lit(OWNER)})`);
      expect(db.sql(`SELECT delivery_state || '|' || delivery_generation || '|' || (failure_reason IS NULL)
                     FROM public.builder_network_messages WHERE id = ${lit(lost)}`)).toBe('queued|2|true');
      expect(outbox(`dedupe_key = 'agency.message:${lost}:2'`)).toBe('1');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE body = 'Is the price still current?'`)).toBe('1');
      // 11. a late generation-1 receipt changes nothing.
      receipt(lost, 1, 'accepted');
      sweep();
      expect(db.sql(`SELECT delivery_state || '|' || delivery_generation FROM public.builder_network_messages WHERE id = ${lit(lost)}`))
        .toBe('queued|2');
      // 10. the generation-2 receipt makes it Delivered.
      receipt(lost, 2, 'accepted');
      sweep();
      expect(db.sql(`SELECT delivery_state || '|' || (delivered_at IS NOT NULL) FROM public.builder_network_messages WHERE id = ${lit(lost)}`))
        .toBe('delivered|true');
      receipt(lost, 1, 'refused', 'late');
      sweep();
      db.sql(`UPDATE public.builder_network_outbox SET delivered_at = now() - interval '16 minutes'
              WHERE dedupe_key = 'agency.message:${lost}:1'`);
      sweep();
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(lost)}`)).toBe('delivered');
    });

    it('a failed message cannot be sent again once the activation is withdrawn', () => {
      const m = post(ITEM_A1, OWNER, randomUUID(), 'Retry after withdrawal.');
      receipt(m, 1, 'refused', 'x');
      sweep();
      db.sql(`UPDATE public.builder_stock_selections SET status = 'withdrawn' WHERE stock_item_id = ${lit(ITEM_A1)}`);
      expect(refusal(`SELECT public.builder_network_retry_message(${lit(m)}, ${lit(OWNER)})`)).toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
      expect(db.sql(`SELECT delivery_state || '|' || delivery_generation FROM public.builder_network_messages WHERE id = ${lit(m)}`))
        .toBe('failed|1');
      db.sql(`UPDATE public.builder_stock_selections SET status = 'selected' WHERE stock_item_id = ${lit(ITEM_A1)}`);
    });
  });

  describe('robustness and order', () => {
    it('16. a poison message is retried then dead-lettered, and never blocks the next', () => {
      db.sql(`CREATE OR REPLACE FUNCTION public._spec_poison() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN IF NEW.body = 'poison' THEN RAISE EXCEPTION 'simulated fault'; END IF; RETURN NEW; END $$;
              CREATE TRIGGER _spec_poison BEFORE INSERT ON public.builder_network_messages
                FOR EACH ROW EXECUTE FUNCTION public._spec_poison();`);
      const poison = builderMessage({ body: 'poison' });
      const next = builderMessage({ body: 'After the poison.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${poison.message_id}:1`, poison);
      land(CONN_A, 'agency.message.posted', `agency.message:${next.message_id}:1`, next);
      sweep();
      expect(db.sql(`SELECT count(*) FROM public.builder_network_messages WHERE id = ${lit(next.message_id)}`)).toBe('1');
      for (let i = 0; i < 5; i += 1) sweep();
      expect(db.sql(`SELECT message_apply_attempts || '|' || left(message_apply_error, 5) FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${poison.message_id}:1'`)).toBe('5|dead:');
      expect(db.sql(`SELECT count(*) FROM public.portal_operational_events_log WHERE name = 'builder_network_message_apply_dead'`)).toBe('1');
      db.sql('DROP TRIGGER _spec_poison ON public.builder_network_messages; DROP FUNCTION public._spec_poison();');
    });

    it('13. messages that arrive out of order settle into the order they were written', () => {
      const later = builderMessage({ body: 'Second.', sent_at: '2026-09-25T12:00:00.000000Z' });
      const earlier = builderMessage({ body: 'First.', sent_at: '2026-09-25T11:00:00.000000Z' });
      land(CONN_A, 'agency.message.posted', `agency.message:${later.message_id}:1`, later);
      sweep();
      land(CONN_A, 'agency.message.posted', `agency.message:${earlier.message_id}:1`, earlier);
      sweep();
      expect(db.sql(`SELECT string_agg(body, ' / ' ORDER BY sent_at, id) FROM public.builder_network_messages
                     WHERE id IN (${lit(later.message_id)}, ${lit(earlier.message_id)})`)).toBe('First. / Second.');
    });

    it('21/22. a stock event still takes the main sweep, and media its own lane', () => {
      const item = randomUUID();
      land(CONN_A, 'stock.item.upserted', `stock:${randomUUID()}`, {
        id: item, organisation_id: ORG_A, lifecycle_status: 'active', availability_status: 'available',
        address_line: '3 Check Street', organisation: { id: ORG_A, legal_name: 'Check Homes' },
        media: { schema_version: 1, photos: [], documents: [] },
      });
      mainSweep();
      db.sql('SELECT * FROM public.builder_network_apply_stock_media(50)');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_stock_items WHERE id = ${lit(item)}`)).toBe('1');
      expect(db.sql(`SELECT count(*) FROM public.builder_network_inbound_events
                     WHERE event_type = 'stock.item.upserted' AND media_applied_at IS NULL`)).toBe('0');
    });

    it('23. activation behaviour is unchanged: withdrawing the activation closes the conversation to new messages', () => {
      db.sql(`UPDATE public.builder_stock_selections SET status = 'withdrawn' WHERE stock_item_id = ${lit(ITEM_A1)}`);
      expect(refusal(`SELECT public.builder_network_post_message(${lit(ITEM_A1)}, ${lit(OWNER)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
      db.sql(`UPDATE public.builder_stock_selections SET status = 'selected' WHERE stock_item_id = ${lit(ITEM_A1)}`);
    });

    it('20. no browser role reaches the tables or the functions', () => {
      for (const role of ['anon', 'authenticated']) {
        expect(db.sql(`SELECT has_table_privilege('${role}', 'public.builder_network_messages', 'SELECT')
                          OR has_table_privilege('${role}', 'public.builder_network_conversations', 'SELECT')
                          OR has_function_privilege('${role}', 'public.builder_network_post_message(uuid,uuid,uuid,text)', 'EXECUTE')
                          OR has_function_privilege('${role}', 'public.builder_network_apply_message_events(integer)', 'EXECUTE')`)).toBe('f');
      }
    });
  });
});
