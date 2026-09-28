/**
 * ONE ACTIVATION, ONE PRIVATE CONVERSATION — THE COMMAND CENTRE'S HALF, ON A
 * REAL SCHEMA (docs/builder-portal/52).
 *
 * The real network migrations, Step 5's messaging migration and this step's
 * migration run against a throwaway Postgres. Envelopes are landed exactly as
 * the inbound door lands them and swept by the real sweeps. What is asserted
 * is what each step leaves behind:
 *
 * - a builder's acknowledgement opens exactly one conversation for exactly one
 *   activation, once, however often it is replayed;
 * - membership, not Listings access, decides who may read, write, retry,
 *   invite and leave;
 * - an invitation is decided by this side's own rows;
 * - leaving cannot strand a live conversation, and cannot erase history;
 * - the builder's participant events are display records that settle on their
 *   latest version and never grant anything;
 * - the conversation that existed before this step keeps its id and its
 *   messages when it is bound to its activation.
 *
 * The network's half is proved in aurixa-builders
 * (`scripts/db/agency-private-chat-check.mjs`).
 */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  postgresAvailable, startThrowawayPostgres, type ThrowawayPostgres,
} from './support/throwawayPostgres';
import { assertPayloadCrossesClean } from '../../../supabase/functions/_shared/builderNetworkPrivacy.pure';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(REPO_ROOT, 'supabase', 'migrations');
export const PRIVATE_MIGRATION = '20261224090000_one_activation_one_private_conversation.sql';
const BEFORE = [
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
  '20261221120000_an_agency_and_a_builder_talk_over_the_network.sql',
];

const runs = postgresAvailable();
let db: ThrowawayPostgres;

const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const json = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;
const uuidOf = (text: string) => {
  const hex = createHash('md5').update(text).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
/** Step 5's property derivation: the id the conversation that already existed was given. */
const propertyConversationId = (net: string, item: string) => uuidOf(`agency.conversation:${net}:${item}`);
/** This step's derivation: one conversation per activation. */
const activationConversationId = (net: string, ref: string) => uuidOf(`agency.activation:${net}:${ref}`);
const refusal = (statement: string): string | null => {
  try { db.sql(statement); return null; } catch (error) {
    return String((error as { stderr?: unknown }).stderr ?? (error as Error).message);
  }
};

// The world: two builders, one property of builder A activated twice (for
// two clients, by two Command Centre users), and a property already talked
// about before this step.
const ORG_A = randomUUID(); const ORG_B = randomUUID();
const NET_A = randomUUID(); const NET_B = randomUUID();
const ITEM = randomUUID(); const LEGACY_ITEM = randomUUID(); const QUIET_ITEM = randomUUID();
const OWNER = randomUUID(); const OWNER_2 = randomUUID(); const COLLEAGUE = randomUUID();
const NO_LISTINGS = randomUUID(); const INACTIVE = randomUUID(); const THIRD = randomUUID();
let CONN_A = ''; let CONN_B = '';
let S1 = ''; let S2 = ''; let S_LEGACY = ''; let S_QUIET = '';
let C1 = ''; let C2 = '';
let LEGACY_MESSAGES: string[] = [];

const land = (connection: string, eventType: string, dedupe: string, payload: unknown) => db.sql(`
  INSERT INTO public.builder_network_inbound_events(connection_id, event_type, dedupe_key, payload, source_version)
  VALUES (${lit(connection)}, ${lit(eventType)}, ${lit(dedupe)}, ${json(payload)}, 1)`);
const mainSweep = () => db.sql('SELECT * FROM public.builder_network_apply_inbound_events(50)');
const messageSweep = () => db.sql('SELECT * FROM public.builder_network_apply_message_events(50)');
const acknowledge = (connection: string, ref: string, item: string, name: string | null = 'Avery Builder') => {
  land(connection, 'stock.selection.acknowledged', `stock.selection.acknowledged:${connection}:${ref}:${randomUUID()}`, {
    remote_selection_ref: ref, stock_item_id: item, status: 'builder_acknowledged',
    acknowledged_at: '2026-09-26T01:00:00.000000Z',
    ...(name === null ? {} : { acknowledged_by_display_name: name }),
  });
  mainSweep();
};
const participantEvent = (connection: string, overrides: Record<string, unknown>) => {
  const payload = {
    schema_version: 1, conversation_id: C1, stock_item_id: ITEM, participant_ref: randomUUID(),
    display_name: 'Avery Builder', side: 'builder', state: 'joined', version: 1, ...overrides,
  };
  land(connection, 'agency.message.participant',
    `agency.participant:${payload.conversation_id}:${payload.participant_ref}:${payload.version}:${randomUUID()}`, payload);
  messageSweep();
  return payload;
};
const post = (conversation: string, user: string, body: string, key = randomUUID()) => db.sql(`
  SELECT id FROM public.builder_network_post_message(${lit(conversation)}, ${lit(user)}, ${lit(key)}, ${lit(body)})`);
const invite = (conversation: string, actor: string, invitee: string) => db.sql(`
  SELECT public.builder_network_invite_participant(${lit(conversation)}, ${lit(actor)}, ${lit(invitee)})`);
const leave = (conversation: string, actor: string) => db.sql(`
  SELECT public.builder_network_leave_conversation(${lit(conversation)}, ${lit(actor)})`);
const isParticipant = (conversation: string, user: string) => db.sql(`
  SELECT public.builder_network_is_participant(${lit(conversation)}, ${lit(user)})`);
const members = (conversation: string) => db.sql(`
  SELECT COALESCE(string_agg(side || ':' || display_name || ':' || state, ',' ORDER BY side, display_name, state), '')
    FROM public.builder_network_conversation_participants WHERE conversation_id = ${lit(conversation)}`);
const count = (sql: string) => db.sql(`SELECT count(*) FROM ${sql}`);
const notifications = (user: string) => count(`public.notifications
  WHERE target_user_id = ${lit(user)} AND type = 'builder_activation_acknowledged'`);
const emails = (selection: string) => count(`public.integration_outbox
  WHERE idempotency_key = ${lit(`builder_activation_acknowledged:${selection}`)}`);
const participantEvents = (conversation: string) => count(`public.builder_network_outbox
  WHERE event_type = 'agency.message.participant' AND payload->>'conversation_id' = ${lit(conversation)}`);

describe.skipIf(!runs)('one activation, one private conversation (Command Centre)', () => {
  beforeAll(() => {
    db = startThrowawayPostgres();
    db.file(join(__dirname, 'support', 'builderNetworkStandins.sql'));
    for (const file of BEFORE) db.file(join(MIGRATIONS, file));
    db.sql(`
      INSERT INTO public.feature_flags(key, value) VALUES ('builder_network_enabled', 'true'::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
      INSERT INTO public.custom_users(id, username, email, first_name, last_name, is_active)
      VALUES (${lit(OWNER)}, 'owner', 'owner@example.test', 'Olive', 'Owner', true),
             (${lit(OWNER_2)}, 'owner2', 'owner2@example.test', 'Otto', 'Other', true),
             (${lit(COLLEAGUE)}, 'Casey Colleague', 'casey@example.test', NULL, NULL, true),
             (${lit(THIRD)}, 'third', 'third@example.test', 'Olive', 'Owner', true),
             (${lit(NO_LISTINGS)}, 'nolist', 'nolist@example.test', 'Nora', 'Nolist', true),
             (${lit(INACTIVE)}, 'gone', 'gone@example.test', 'Gone', 'User', false);
      INSERT INTO public.dashboard_modules(id, module_key, is_active) VALUES (gen_random_uuid(), 'listings', true);
      INSERT INTO public.user_permissions(user_id, module_id, can_view, can_edit)
      SELECT u, (SELECT id FROM public.dashboard_modules WHERE module_key = 'listings'), true, true
        FROM unnest(ARRAY[${lit(OWNER)}, ${lit(OWNER_2)}, ${lit(COLLEAGUE)}, ${lit(THIRD)}, ${lit(INACTIVE)}]::uuid[]) u;
      INSERT INTO public.builder_network_stock_items(id, organisation_id, address_line, lot_number, lifecycle_status)
      VALUES (${lit(ITEM)}, ${lit(ORG_A)}, '1 Private Street', '101', 'active'),
             (${lit(LEGACY_ITEM)}, ${lit(ORG_A)}, '2 History Street', '102', 'active'),
             (${lit(QUIET_ITEM)}, ${lit(ORG_A)}, '3 Quiet Street', '103', 'active');
      INSERT INTO public.builder_network_stock_organisations(id, legal_name) VALUES (${lit(ORG_A)}, 'Check Homes Pty Ltd');`);
    CONN_A = db.sql(`INSERT INTO public.builder_network_connections(network_connection_id, state, scopes,
        outbound_hmac_secret, network_inbound_url, builder_organisation_id, accepted_at)
      VALUES (${lit(NET_A)}, 'active', ARRAY['stock:publish'], 's', 'https://network.example/functions/v1/builder-network-inbound', ${lit(ORG_A)}, now())
      RETURNING id`);
    CONN_B = db.sql(`INSERT INTO public.builder_network_connections(network_connection_id, state, scopes,
        outbound_hmac_secret, network_inbound_url, builder_organisation_id, accepted_at)
      VALUES (${lit(NET_B)}, 'active', ARRAY['stock:publish'], 's', 'https://network.example/functions/v1/builder-network-inbound', ${lit(ORG_B)}, now())
      RETURNING id`);
    const client1 = db.sql(`INSERT INTO public.clients(primary_first_name, primary_surname, primary_email)
                            VALUES ('Clientina', 'Hidden', 'clientina.hidden@example.test') RETURNING id`);
    const client2 = db.sql(`INSERT INTO public.clients(primary_first_name, primary_surname) VALUES ('Second', 'Client') RETURNING id`);
    const client3 = db.sql(`INSERT INTO public.clients(primary_first_name, primary_surname) VALUES ('Legacy', 'Client') RETURNING id`);
    S1 = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status, internal_notes)
                 VALUES (${lit(ITEM)}, ${lit(ORG_A)}, ${lit(client1)}, ${lit(OWNER)}, 'selected', 'Confidential note about the client') RETURNING id`);
    S2 = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status)
                 VALUES (${lit(ITEM)}, ${lit(ORG_A)}, ${lit(client2)}, ${lit(OWNER_2)}, 'selected') RETURNING id`);

    // Before this step: an acknowledged activation whose conversation was
    // created under Step 5's property derivation, holding three messages.
    S_LEGACY = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id,
                         status, acknowledged_at)
                       VALUES (${lit(LEGACY_ITEM)}, ${lit(ORG_A)}, ${lit(client3)}, ${lit(OWNER)}, 'builder_acknowledged', now())
                       RETURNING id`);
    S_QUIET = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id,
                        status, acknowledged_at)
                      VALUES (${lit(QUIET_ITEM)}, ${lit(ORG_A)}, ${lit(client3)}, ${lit(OWNER_2)}, 'builder_acknowledged', now())
                      RETURNING id`);
    const legacyConversation = propertyConversationId(NET_A, LEGACY_ITEM);
    db.sql(`INSERT INTO public.builder_network_conversations(id, connection_id, stock_item_id, builder_organisation_id,
              owner_user_id, started_by_user_id)
            VALUES (${lit(legacyConversation)}, ${lit(CONN_A)}, ${lit(LEGACY_ITEM)}, ${lit(ORG_A)}, ${lit(OWNER)}, ${lit(OWNER)})`);
    LEGACY_MESSAGES = [randomUUID(), randomUUID(), randomUUID()];
    db.sql(`INSERT INTO public.builder_network_messages(id, conversation_id, side, sender_user_id, client_message_id,
              sender_display_name, body, sent_at, delivery_state, delivered_at)
            VALUES (${lit(LEGACY_MESSAGES[0])}, ${lit(legacyConversation)}, 'command_centre', ${lit(OWNER)}, gen_random_uuid(),
                    'Olive Owner', 'Is lot 102 still available?', '2026-09-25T01:00:00Z', 'delivered', now()),
                   (${lit(LEGACY_MESSAGES[1])}, ${lit(legacyConversation)}, 'builder', NULL, NULL,
                    'Avery Builder', 'Yes, it is.', '2026-09-25T02:00:00Z', NULL, NULL),
                   (${lit(LEGACY_MESSAGES[2])}, ${lit(legacyConversation)}, 'command_centre', ${lit(OWNER)}, gen_random_uuid(),
                    'Olive Owner', 'Thank you.', '2026-09-25T03:00:00Z', 'delivered', now())`);

    db.file(join(MIGRATIONS, PRIVATE_MIGRATION));
    db.sql('DELETE FROM public.builder_network_outbox');
    C1 = activationConversationId(NET_A, S1);
    C2 = activationConversationId(NET_A, S2);
  }, 120_000);
  afterAll(() => db?.stop());

  describe('the acknowledgement opens the conversation', () => {
    it('R1. a builder acknowledgement creates exactly one private conversation, for that activation', () => {
      acknowledge(CONN_A, S1, ITEM);
      expect(count(`public.builder_network_conversations WHERE id = ${lit(C1)}
                    AND selection_ref = ${lit(S1)} AND connection_id = ${lit(CONN_A)} AND stock_item_id = ${lit(ITEM)}`)).toBe('1');
      expect(count(`public.builder_network_conversations WHERE stock_item_id = ${lit(ITEM)}`)).toBe('1');
      expect(db.sql(`SELECT acknowledged_by_display_name FROM public.builder_stock_selections WHERE id = ${lit(S1)}`))
        .toBe('Avery Builder');
    });

    it('R2. its initial participants are the activator here and, from the builder, the acknowledger', () => {
      expect(members(C1)).toBe('command_centre:Olive Owner:joined');
      expect(isParticipant(C1, OWNER)).toBe('t');
      // The builder announces its acknowledger; it is displayed and grants nothing.
      participantEvent(CONN_A, { conversation_id: C1, display_name: 'Avery Builder' });
      expect(members(C1)).toBe('builder:Avery Builder:joined,command_centre:Olive Owner:joined');
      expect(count(`public.builder_network_conversation_participants
                    WHERE conversation_id = ${lit(C1)} AND side = 'builder' AND local_user_id IS NOT NULL`)).toBe('0');
    });

    it('R4/R5. the activator is announced once, notified once and emailed once, naming no client', () => {
      expect(participantEvents(C1)).toBe('1');
      expect(notifications(OWNER)).toBe('1');
      expect(emails(S1)).toBe('1');
      const notice = JSON.parse(db.sql(`SELECT row_to_json(n) FROM public.notifications n
                                        WHERE target_user_id = ${lit(OWNER)} AND type = 'builder_activation_acknowledged'`));
      expect(notice.link).toBe('/admin/builder-portal/activated');
      expect(`${notice.title} ${notice.message}`).toMatch(/Check Homes Pty Ltd/);
      expect(`${notice.title} ${notice.message}`).toMatch(/1 Private Street/);
      expect(`${notice.title} ${notice.message}`).toMatch(/Avery Builder/);
      const outbound = db.sql(`SELECT string_agg(payload::text, ' ') FROM public.builder_network_outbox
                               WHERE event_type = 'agency.message.participant'`);
      const emailPayload = db.sql(`SELECT payload::text FROM public.integration_outbox
                                   WHERE idempotency_key = ${lit(`builder_activation_acknowledged:${S1}`)}`);
      for (const secret of ['Clientina', 'clientina.hidden', 'Confidential note', OWNER, S1]) {
        expect(outbound).not.toContain(secret);
        expect(`${notice.title} ${notice.message}`).not.toContain(secret === S1 ? '§' : secret);
      }
      // The email job carries only which activation to describe; the worker reads the rest at send time.
      expect(Object.keys(JSON.parse(emailPayload))).toEqual(['selection_id']);
    });

    it('R3/R4/R5/R6. a replayed acknowledgement adds no conversation, participant, notification or email', () => {
      acknowledge(CONN_A, S1, ITEM);
      acknowledge(CONN_A, S1, ITEM, 'Someone Else');
      db.sql(`SELECT public.builder_network_process_acknowledgements(50)`);
      expect(count(`public.builder_network_conversations WHERE stock_item_id = ${lit(ITEM)}`)).toBe('1');
      expect(count(`public.builder_network_conversation_participants WHERE conversation_id = ${lit(C1)} AND side = 'command_centre'`)).toBe('1');
      expect(notifications(OWNER)).toBe('1');
      expect(emails(S1)).toBe('1');
      expect(participantEvents(C1)).toBe('1');
      // The first acknowledger's name stands.
      expect(db.sql(`SELECT acknowledged_by_display_name FROM public.builder_stock_selections WHERE id = ${lit(S1)}`))
        .toBe('Avery Builder');
    });

    it('an acknowledgement over another builder\'s connection opens nothing', () => {
      const client = db.sql(`INSERT INTO public.clients(primary_first_name) VALUES ('Z') RETURNING id`);
      const stray = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status)
                            VALUES (${lit(QUIET_ITEM)}, ${lit(ORG_A)}, ${lit(client)}, ${lit(THIRD)}, 'selected') RETURNING id`);
      acknowledge(CONN_B, stray, QUIET_ITEM, 'Intruder');
      expect(count(`public.builder_network_conversations WHERE selection_ref = ${lit(stray)}`)).toBe('0');
      expect(notifications(THIRD)).toBe('0');
      expect(emails(stray)).toBe('0');
    });

    it('an acknowledgement made before this step carried no name, and none is invented', () => {
      expect(db.sql(`SELECT acknowledged_by_display_name IS NULL FROM public.builder_stock_selections WHERE id = ${lit(S_QUIET)}`))
        .toBe('t');
    });
  });

  describe('each activation is its own conversation', () => {
    it('R7. a second activation of the same property has a different conversation', () => {
      acknowledge(CONN_A, S2, ITEM, 'Bea Builder');
      expect(C2).not.toBe(C1);
      expect(count(`public.builder_network_conversations WHERE stock_item_id = ${lit(ITEM)}`)).toBe('2');
      expect(members(C2)).toBe('command_centre:Otto Other:joined');
      expect(notifications(OWNER_2)).toBe('1');
    });

    it('R8. activator A cannot read or write activator B\'s conversation, nor B A\'s', () => {
      expect(isParticipant(C2, OWNER)).toBe('f');
      expect(isParticipant(C1, OWNER_2)).toBe('f');
      expect(refusal(`SELECT public.builder_network_post_message(${lit(C2)}, ${lit(OWNER)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
      expect(refusal(`SELECT public.builder_network_invite_participant(${lit(C2)}, ${lit(OWNER)}, ${lit(OWNER)})`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
    });

    it('R9. a Listings user who is not a participant cannot read, write or invite', () => {
      expect(isParticipant(C1, COLLEAGUE)).toBe('f');
      expect(refusal(`SELECT public.builder_network_post_message(${lit(C1)}, ${lit(COLLEAGUE)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
      expect(refusal(`SELECT public.builder_network_leave_conversation(${lit(C1)}, ${lit(COLLEAGUE)})`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
    });

    it('R12. a conversation id from another workspace\'s derivation reaches nothing here', () => {
      const foreign = activationConversationId(randomUUID(), S1);
      expect(refusal(`SELECT public.builder_network_post_message(${lit(foreign)}, ${lit(OWNER)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_CONVERSATION_NOT_FOUND/);
      expect(isParticipant(foreign, OWNER)).toBe('f');
    });
  });

  describe('writing', () => {
    let first = '';
    it('R13. a participant writes; the event is Step 5\'s, unchanged, and names the activation\'s conversation', () => {
      first = post(C1, OWNER, 'Is lot 101 still available?');
      const payload = JSON.parse(db.sql(`SELECT payload FROM public.builder_network_outbox
                                         WHERE dedupe_key = 'agency.message:${first}:1'`));
      expect(Object.keys(payload).sort()).toEqual([
        'body', 'conversation_id', 'generation', 'message_id', 'schema_version', 'sender_display_name', 'sent_at', 'stock_item_id',
      ]);
      expect(payload.conversation_id).toBe(C1);
      expect(() => assertPayloadCrossesClean(payload)).not.toThrow();
    });

    it('R14. a non-participant cannot write', () => {
      expect(refusal(`SELECT public.builder_network_post_message(${lit(C1)}, ${lit(THIRD)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
    });

    it('R39. Step 5\'s idempotency holds: the same send again is one message and one event', () => {
      const key = randomUUID();
      expect(post(C1, OWNER, 'Only once.', key)).toBe(post(C1, OWNER, 'Only once.', key));
      expect(count(`public.builder_network_messages WHERE body = 'Only once.'`)).toBe('1');
      expect(refusal(`SELECT public.builder_network_post_message(${lit(C1)}, ${lit(OWNER)}, ${lit(key)}, 'Other text')`))
        .toMatch(/AGENCY_MESSAGE_ID_REUSED/);
    });

    it('posting takes the conversation before the participant, as leaving does, so the two cannot deadlock', async () => {
      // A leave holds the conversation and then needs the poster's participant
      // row. A post that locked the participant first and the conversation
      // second would be holding exactly what the leave needs next.
      const leaveSide = db.sqlAsync(`
        SELECT 1 FROM public.builder_network_conversations WHERE id = ${lit(C1)} FOR UPDATE;
        SELECT pg_sleep(1.5);
        SELECT 'participant row free' FROM public.builder_network_conversation_participants
         WHERE conversation_id = ${lit(C1)} AND local_user_id = ${lit(OWNER)} FOR UPDATE NOWAIT;`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const postSide = db.sqlAsync(`SELECT count(*) FROM public.builder_network_post_message(
        ${lit(C1)}, ${lit(OWNER)}, gen_random_uuid(), 'Posted while a leave was deciding')`);
      await expect(leaveSide).resolves.toContain('participant row free');
      await expect(postSide).resolves.toBe('1');
    });

    it('R15. a participant retries their own failed message', () => {
      db.sql(`UPDATE public.builder_network_messages SET delivery_state = 'failed', failure_reason = 'not_delivered' WHERE id = ${lit(first)}`);
      expect(db.sql(`SELECT delivery_generation FROM public.builder_network_retry_message(${lit(first)}, ${lit(OWNER)})`)).toBe('2');
    });

    it('a builder message for this activation lands in this activation\'s conversation only', () => {
      const message = randomUUID();
      land(CONN_A, 'agency.message.posted', `agency.message:${message}:1`, {
        schema_version: 1, conversation_id: C2, message_id: message, stock_item_id: ITEM,
        body: 'For the second activation.', sender_display_name: 'Bea Builder',
        sent_at: '2026-09-26T02:00:00.000000Z', generation: 1,
      });
      messageSweep();
      expect(db.sql(`SELECT conversation_id FROM public.builder_network_messages WHERE id = ${lit(message)}`)).toBe(C2);
    });

    it('a builder message naming a conversation that is not this property\'s activation is refused', () => {
      const message = randomUUID();
      land(CONN_A, 'agency.message.posted', `agency.message:${message}:1`, {
        schema_version: 1, conversation_id: activationConversationId(NET_A, randomUUID()), message_id: message,
        stock_item_id: ITEM, body: 'Where does this go?', sender_display_name: 'Bea Builder',
        sent_at: '2026-09-26T02:00:00.000000Z', generation: 1,
      });
      expect(messageSweep()).toMatch(/0\|1\|0|0 *\| *1/);
      expect(count(`public.builder_network_messages WHERE id = ${lit(message)}`)).toBe('0');
    });
  });

  describe('inviting a colleague', () => {
    it('R17. a participant invites an active colleague with Listings view; the colleague is announced once', () => {
      expect(invite(C1, OWNER, COLLEAGUE)).toBe('joined');
      expect(isParticipant(C1, COLLEAGUE)).toBe('t');
      expect(members(C1)).toBe('builder:Avery Builder:joined,command_centre:Casey Colleague:joined,command_centre:Olive Owner:joined');
      const event = JSON.parse(db.sql(`SELECT payload FROM public.builder_network_outbox
        WHERE event_type = 'agency.message.participant' AND payload->>'display_name' = 'Casey Colleague'`));
      expect(Object.keys(event).sort()).toEqual([
        'conversation_id', 'display_name', 'participant_ref', 'schema_version', 'side', 'state', 'stock_item_id', 'version',
      ]);
      expect(event).toMatchObject({ side: 'command_centre', state: 'joined', version: 1, conversation_id: C1 });
      expect(event.participant_ref).not.toBe(COLLEAGUE);
      expect(JSON.stringify(event)).not.toContain(COLLEAGUE);
      expect(JSON.stringify(event)).not.toContain('casey@example.test');
    });

    it('R18. the invited colleague writes into, and belongs to, the whole conversation', () => {
      const reply = post(C1, COLLEAGUE, 'Adding: settlement in June.');
      expect(db.sql(`SELECT sender_display_name FROM public.builder_network_messages WHERE id = ${lit(reply)}`)).toBe('Casey Colleague');
      expect(isParticipant(C1, COLLEAGUE)).toBe('t');
    });

    it('R19. inviting someone already in the conversation changes nothing', () => {
      const before = participantEvents(C1);
      expect(invite(C1, OWNER, COLLEAGUE)).toBe('already_participant');
      expect(participantEvents(C1)).toBe(before);
      expect(count(`public.builder_network_conversation_participants WHERE conversation_id = ${lit(C1)}
                    AND local_user_id = ${lit(COLLEAGUE)}`)).toBe('1');
    });

    it('R20. a user who is inactive, has no Listings view, or does not exist here cannot be invited', () => {
      for (const who of [INACTIVE, NO_LISTINGS, randomUUID()]) {
        expect(refusal(`SELECT public.builder_network_invite_participant(${lit(C1)}, ${lit(OWNER)}, ${lit(who)})`))
          .toMatch(/AGENCY_INVITEE_NOT_ELIGIBLE/);
      }
    });

    it('every eligible colleague is offered, however many there are', () => {
      expect(db.sql(`BEGIN;
        INSERT INTO public.custom_users(id, username, email, first_name, last_name, is_active)
        SELECT ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, 'bulk' || g, 'bulk' || g || '@example.test',
               'Bulk', 'Member ' || lpad(g::text, 4, '0'), true FROM generate_series(1, 501) g;
        INSERT INTO public.user_permissions(user_id, module_id, can_view, can_edit)
        SELECT ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid,
               (SELECT id FROM public.dashboard_modules WHERE module_key = 'listings'), true, false
          FROM generate_series(1, 501) g;
        SELECT count(*) FROM public.builder_network_invite_candidates(${lit(C1)}, ${lit(OWNER)})
         WHERE display_name LIKE 'Bulk Member %';
        ROLLBACK;`)).toBe('501');
    });

    it('R21. there is no way to remove somebody else', () => {
      expect(db.sql(`SELECT count(*) FROM pg_proc WHERE proname ~ 'builder_network_.*(remove|kick|evict)_?(participant|user|member)'`)).toBe('0');
      // Leaving names only the person leaving.
      expect(db.sql(`SELECT pronargs FROM pg_proc WHERE proname = 'builder_network_leave_conversation'`)).toBe('2');
    });
  });

  describe('leaving', () => {
    it('R23. the last participant on this side of a live conversation cannot leave', () => {
      expect(refusal(`SELECT public.builder_network_leave_conversation(${lit(C2)}, ${lit(OWNER_2)})`))
        .toMatch(/AGENCY_LAST_PARTICIPANT/);
      expect(isParticipant(C2, OWNER_2)).toBe('t');
    });

    it('R22/R24. once a colleague has joined, the original participant can leave, and is announced as left', () => {
      expect(leave(C1, OWNER)).toBe('left');
      expect(members(C1)).toBe('builder:Avery Builder:joined,command_centre:Casey Colleague:joined,command_centre:Olive Owner:left');
      expect(db.sql(`SELECT (payload->>'state') || '|' || (payload->>'version') FROM public.builder_network_outbox
        WHERE event_type = 'agency.message.participant' AND payload->>'display_name' = 'Olive Owner'
        ORDER BY (payload->>'version')::int DESC LIMIT 1`)).toBe('left|2');
    });

    it('R25. a departed participant loses read, write, retry, invite and leave at once', () => {
      expect(isParticipant(C1, OWNER)).toBe('f');
      expect(refusal(`SELECT public.builder_network_post_message(${lit(C1)}, ${lit(OWNER)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
      const failed = db.sql(`SELECT id FROM public.builder_network_messages WHERE conversation_id = ${lit(C1)}
                              AND sender_user_id = ${lit(OWNER)} ORDER BY sent_at LIMIT 1`);
      // Repeating an earlier send is not a way back in: the stored message is
      // answered to a current participant only.
      expect(refusal(`SELECT m2.id FROM public.builder_network_messages m,
        LATERAL public.builder_network_post_message(${lit(C1)}, ${lit(OWNER)}, m.client_message_id, m.body) m2
        WHERE m.id = ${lit(failed)}`)).toMatch(/AGENCY_NOT_A_PARTICIPANT/);
      db.sql(`UPDATE public.builder_network_messages SET delivery_state = 'failed', failure_reason = 'not_delivered' WHERE id = ${lit(failed)}`);
      expect(refusal(`SELECT public.builder_network_retry_message(${lit(failed)}, ${lit(OWNER)})`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
      expect(refusal(`SELECT public.builder_network_invite_participant(${lit(C1)}, ${lit(OWNER)}, ${lit(THIRD)})`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
      expect(refusal(`SELECT public.builder_network_leave_conversation(${lit(C1)}, ${lit(OWNER)})`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
    });

    it('R16. a non-participant cannot retry, even a message they wrote before leaving', () => {
      const failed = db.sql(`SELECT id FROM public.builder_network_messages WHERE conversation_id = ${lit(C1)}
                              AND sender_user_id = ${lit(OWNER)} AND delivery_state = 'failed' LIMIT 1`);
      expect(refusal(`SELECT public.builder_network_retry_message(${lit(failed)}, ${lit(OWNER)})`))
        .toMatch(/AGENCY_NOT_A_PARTICIPANT/);
    });

    it('someone invited again after leaving joins again under the same reference, with the whole history', () => {
      const ref = db.sql(`SELECT participant_ref FROM public.builder_network_conversation_participants
                          WHERE conversation_id = ${lit(C1)} AND local_user_id = ${lit(OWNER)}`);
      expect(invite(C1, COLLEAGUE, OWNER)).toBe('joined');
      expect(db.sql(`SELECT participant_ref || '|' || state || '|' || version FROM public.builder_network_conversation_participants
                     WHERE conversation_id = ${lit(C1)} AND local_user_id = ${lit(OWNER)}`)).toBe(`${ref}|joined|3`);
    });
  });

  describe('the builder\'s participants, as announced', () => {
    it('R26. two builder participants with the same name are two people', () => {
      const refA = randomUUID(); const refB = randomUUID();
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: refA, display_name: 'Sam Site' });
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: refB, display_name: 'Sam Site' });
      expect(count(`public.builder_network_conversation_participants WHERE conversation_id = ${lit(C1)}
                    AND display_name = 'Sam Site' AND state = 'joined'`)).toBe('2');
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: refA, display_name: 'Sam Site', state: 'left', version: 2 });
      expect(db.sql(`SELECT string_agg(state, ',' ORDER BY state) FROM public.builder_network_conversation_participants
                     WHERE conversation_id = ${lit(C1)} AND display_name = 'Sam Site'`)).toBe('joined,left');
    });

    it('R27/R28. a replayed join or leave changes nothing', () => {
      const ref = randomUUID();
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: ref, display_name: 'Riley Replay' });
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: ref, display_name: 'Riley Replay' });
      expect(count(`public.builder_network_conversation_participants WHERE participant_ref = ${lit(ref)}`)).toBe('1');
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: ref, display_name: 'Riley Replay', state: 'left', version: 2 });
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: ref, display_name: 'Riley Replay', state: 'left', version: 2 });
      expect(db.sql(`SELECT state || '|' || version FROM public.builder_network_conversation_participants
                     WHERE participant_ref = ${lit(ref)}`)).toBe('left|2');
    });

    it('R29. events arriving out of order settle on the latest version', () => {
      const ref = randomUUID();
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: ref, display_name: 'Olly Order', state: 'left', version: 2 });
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: ref, display_name: 'Olly Order', state: 'joined', version: 1 });
      expect(db.sql(`SELECT state || '|' || version FROM public.builder_network_conversation_participants
                     WHERE participant_ref = ${lit(ref)}`)).toBe('left|2');
    });

    it('R10/R11. a remote participant is display only: it never becomes a local participant, and another builder cannot add one', () => {
      const ref = randomUUID();
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: ref, display_name: 'Olive Owner' });
      expect(db.sql(`SELECT local_user_id IS NULL FROM public.builder_network_conversation_participants
                     WHERE participant_ref = ${lit(ref)}`)).toBe('t');
      expect(isParticipant(C1, OWNER)).toBe('t');
      const intruder = randomUUID();
      participantEvent(CONN_B, { conversation_id: C1, participant_ref: intruder, display_name: 'Intruder' });
      expect(count(`public.builder_network_conversation_participants WHERE participant_ref = ${lit(intruder)}`)).toBe('0');
    });

    it('an event claiming to be from this side, or naming a conversation that is not this activation\'s, is refused', () => {
      const ref1 = randomUUID(); const ref2 = randomUUID();
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: ref1, side: 'command_centre' });
      participantEvent(CONN_A, { conversation_id: activationConversationId(NET_A, randomUUID()), participant_ref: ref2 });
      expect(count(`public.builder_network_conversation_participants WHERE participant_ref IN (${lit(ref1)}, ${lit(ref2)})`)).toBe('0');
    });

    it('an event with a key outside the contract is refused', () => {
      const ref = randomUUID();
      participantEvent(CONN_A, { conversation_id: C1, participant_ref: ref, email: 'x@example.test' });
      expect(count(`public.builder_network_conversation_participants WHERE participant_ref = ${lit(ref)}`)).toBe('0');
    });
  });

  describe('nothing arrives ahead of the acknowledgement', () => {
    it('a signed participant or message for an activation not yet acknowledged opens no conversation and stores nothing', () => {
      const client = db.sql(`INSERT INTO public.clients(primary_first_name) VALUES ('E') RETURNING id`);
      const early = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status)
                            VALUES (${lit(QUIET_ITEM)}, ${lit(ORG_A)}, ${lit(client)}, ${lit(OWNER)}, 'selected') RETURNING id`);
      const conversation = activationConversationId(NET_A, early);
      const ref = randomUUID();
      participantEvent(CONN_A, { conversation_id: conversation, stock_item_id: QUIET_ITEM, participant_ref: ref, display_name: 'Early Builder' });
      const message = randomUUID();
      land(CONN_A, 'agency.message.posted', `agency.message:${message}:1`, {
        schema_version: 1, conversation_id: conversation, message_id: message, stock_item_id: QUIET_ITEM,
        body: 'Before anyone acknowledged.', sender_display_name: 'Early Builder',
        sent_at: '2026-09-26T02:00:00.000000Z', generation: 1,
      });
      messageSweep();
      expect(count(`public.builder_network_conversations WHERE id = ${lit(conversation)}`)).toBe('0');
      expect(count(`public.builder_network_conversation_participants WHERE participant_ref = ${lit(ref)}`)).toBe('0');
      expect(count(`public.builder_network_messages WHERE id = ${lit(message)}`)).toBe('0');
    });
  });

  describe('an event that overtakes its acknowledgement', () => {
    it('waits for the acknowledgement, then applies: the builder participant and message are not lost', () => {
      const client = db.sql(`INSERT INTO public.clients(primary_first_name) VALUES ('R') RETURNING id`);
      const sel = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status)
                          VALUES (${lit(QUIET_ITEM)}, ${lit(ORG_A)}, ${lit(client)}, ${lit(OWNER)}, 'selected') RETURNING id`);
      const conversation = activationConversationId(NET_A, sel);
      const ref = randomUUID();
      const message = randomUUID();
      participantEvent(CONN_A, { conversation_id: conversation, stock_item_id: QUIET_ITEM, participant_ref: ref, display_name: 'Early Acknowledger' });
      land(CONN_A, 'agency.message.posted', `agency.message:${message}:1`, {
        schema_version: 1, conversation_id: conversation, message_id: message, stock_item_id: QUIET_ITEM,
        body: 'Arrived before the acknowledgement.', sender_display_name: 'Early Acknowledger',
        sent_at: '2026-09-26T02:00:00.000000Z', generation: 1,
      });
      messageSweep();
      // Held, not consumed and not refused.
      expect(count(`public.builder_network_inbound_events WHERE event_type IN ('agency.message.participant', 'agency.message.posted')
                    AND payload->>'conversation_id' = ${lit(conversation)} AND message_applied_at IS NULL`)).toBe('2');
      acknowledge(CONN_A, sel, QUIET_ITEM, 'Early Acknowledger');
      messageSweep();
      expect(count(`public.builder_network_conversation_participants WHERE conversation_id = ${lit(conversation)}
                    AND participant_ref = ${lit(ref)} AND side = 'builder' AND state = 'joined'`)).toBe('1');
      expect(count(`public.builder_network_messages WHERE id = ${lit(message)} AND conversation_id = ${lit(conversation)}`)).toBe('1');
    });
  });

  describe('the network kill switch stops invitations too', () => {
    it('with builder_network_enabled off, nobody can be added, as nobody can send', () => {
      db.sql(`UPDATE public.feature_flags SET value = 'false'::jsonb WHERE key = 'builder_network_enabled'`);
      try {
        const before = count(`public.builder_network_conversation_participants WHERE conversation_id = ${lit(C2)}`);
        expect(refusal(`SELECT public.builder_network_invite_participant(${lit(C2)}, ${lit(OWNER_2)}, ${lit(THIRD)})`))
          .toMatch(/AGENCY_NETWORK_DISABLED/);
        expect(count(`public.builder_network_conversation_participants WHERE conversation_id = ${lit(C2)}`)).toBe(before);
      } finally {
        db.sql(`UPDATE public.feature_flags SET value = 'true'::jsonb WHERE key = 'builder_network_enabled'`);
      }
    });
  });

  describe('held events never block the queue', () => {
    it('more held events than one sweep takes do not keep a later valid event from applying', () => {
      const client = db.sql(`INSERT INTO public.clients(primary_first_name) VALUES ('H') RETURNING id`);
      const sel = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status)
                          VALUES (${lit(QUIET_ITEM)}, ${lit(ORG_A)}, ${lit(client)}, ${lit(OWNER_2)}, 'selected') RETURNING id`);
      const waiting = activationConversationId(NET_A, sel);
      for (let i = 0; i < 12; i += 1) {
        const ref = randomUUID();
        land(CONN_A, 'agency.message.participant', `agency.participant:${waiting}:${ref}:1:${randomUUID()}`, {
          schema_version: 1, conversation_id: waiting, stock_item_id: QUIET_ITEM, participant_ref: ref,
          display_name: `Held ${i}`, side: 'builder', state: 'joined', version: 1,
        });
      }
      // A valid event about an acknowledged conversation, behind all twelve.
      const ref = randomUUID();
      land(CONN_A, 'agency.message.participant', `agency.participant:${C1}:${ref}:1:${randomUUID()}`, {
        schema_version: 1, conversation_id: C1, stock_item_id: ITEM, participant_ref: ref,
        display_name: 'Later Builder', side: 'builder', state: 'joined', version: 1,
      });
      // Each sweep takes ten: the held ones are passed over, not re-taken for ever.
      for (let i = 0; i < 3; i += 1) db.sql('SELECT * FROM public.builder_network_apply_message_events(10)');
      expect(count(`public.builder_network_conversation_participants WHERE participant_ref = ${lit(ref)}`)).toBe('1');
      // The held ones are still held, unconsumed, and apply once acknowledged.
      expect(count(`public.builder_network_inbound_events WHERE payload->>'conversation_id' = ${lit(waiting)}
                    AND message_applied_at IS NULL`)).toBe('12');
      acknowledge(CONN_A, sel, QUIET_ITEM, 'Held Acknowledger');
      messageSweep();
      expect(count(`public.builder_network_conversation_participants WHERE conversation_id = ${lit(waiting)} AND side = 'builder'`))
        .toBe('12');
    });
  });

  describe('closed for any reason', () => {
    it('the last participant may leave a conversation closed for a reason other than withdrawal', () => {
      db.sql(`UPDATE public.builder_network_stock_items SET lifecycle_status = 'archived' WHERE id = ${lit(ITEM)}`);
      try {
        expect(db.sql(`SELECT public.builder_network_conversation_closed_reason(${lit(C2)})`)).toBe('delisted');
        expect(members(C2)).toContain('command_centre:Otto Other:joined');
        expect(leave(C2, OWNER_2)).toBe('left');
      } finally {
        db.sql(`UPDATE public.builder_network_stock_items SET lifecycle_status = 'active' WHERE id = ${lit(ITEM)}`);
      }
    });
  });

  describe('an acknowledgement whose activator is unavailable waits for them, and nobody else is added', () => {
    const AWAY = randomUUID(); const NAMELESS = randomUUID();
    let S_AWAY = ''; let S_NAMELESS = ''; let C_AWAY = ''; let C_NAMELESS = '';
    const outcome = (selection: string) => db.sql(`SELECT coalesce(string_agg(outcome, ','), '')
      FROM public.builder_network_acknowledgement_notices WHERE selection_id = ${lit(selection)}`);

    beforeAll(() => {
      db.sql(`INSERT INTO public.custom_users(id, username, email, first_name, last_name, is_active)
              VALUES (${lit(AWAY)}, 'away', 'away@example.test', 'Ada', 'Away', false),
                     (${lit(NAMELESS)}, NULL, 'nameless@example.test', NULL, NULL, true)`);
      const client = () => db.sql(`INSERT INTO public.clients(primary_first_name, primary_surname) VALUES ('Away', 'Client') RETURNING id`);
      S_AWAY = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status)
                       VALUES (${lit(ITEM)}, ${lit(ORG_A)}, ${lit(client())}, ${lit(AWAY)}, 'selected') RETURNING id`);
      S_NAMELESS = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status)
                           VALUES (${lit(ITEM)}, ${lit(ORG_A)}, ${lit(client())}, ${lit(NAMELESS)}, 'selected') RETURNING id`);
      C_AWAY = activationConversationId(NET_A, S_AWAY);
      C_NAMELESS = activationConversationId(NET_A, S_NAMELESS);
    });

    it('an inactive activator is not joined, notified or emailed, and the acknowledgement is not recorded as notified', () => {
      acknowledge(CONN_A, S_AWAY, ITEM);
      expect(count(`public.builder_network_conversations WHERE id = ${lit(C_AWAY)}`)).toBe('1');
      expect(members(C_AWAY)).toBe('');
      expect(notifications(AWAY)).toBe('0');
      expect(emails(S_AWAY)).toBe('0');
      expect(outcome(S_AWAY)).toBe('awaiting_activator');
    });

    it('a replay while they are still unavailable changes nothing', () => {
      acknowledge(CONN_A, S_AWAY, ITEM);
      db.sql('SELECT public.builder_network_process_acknowledgements(50)');
      expect(members(C_AWAY)).toBe('');
      expect(notifications(AWAY)).toBe('0');
      expect(emails(S_AWAY)).toBe('0');
      expect(outcome(S_AWAY)).toBe('awaiting_activator');
    });

    it('once the activator is active again the sweep completes it: joined, notified and emailed once', () => {
      db.sql(`UPDATE public.custom_users SET is_active = true WHERE id = ${lit(AWAY)}`);
      db.sql('SELECT public.builder_network_process_acknowledgements(50)');
      expect(members(C_AWAY)).toBe('command_centre:Ada Away:joined');
      expect(notifications(AWAY)).toBe('1');
      expect(emails(S_AWAY)).toBe('1');
      expect(outcome(S_AWAY)).toBe('notified');
      db.sql('SELECT public.builder_network_process_acknowledgements(50)');
      acknowledge(CONN_A, S_AWAY, ITEM);
      expect(notifications(AWAY)).toBe('1');
      expect(emails(S_AWAY)).toBe('1');
    });

    it('an active activator with no name on record still joins, under a neutral name', () => {
      acknowledge(CONN_A, S_NAMELESS, ITEM);
      expect(members(C_NAMELESS)).toBe('command_centre:Command Centre user:joined');
      expect(isParticipant(C_NAMELESS, NAMELESS)).toBe('t');
      expect(notifications(NAMELESS)).toBe('1');
      expect(outcome(S_NAMELESS)).toBe('notified');
    });
  });

  describe('the acknowledgement email is leased, never finalised before it is sent', () => {
    const SEL = randomUUID();
    const claim = (lease: number) => JSON.parse(db.sql(
      `SELECT public.builder_network_claim_acknowledgement_email(${lit(SEL)}, ${lease})::text`));
    const settle = (token: string, sent: boolean) => db.sql(
      `SELECT public.builder_network_settle_acknowledgement_email(${lit(SEL)}, ${lit(token)}, ${sent})`);
    const sentAt = () => db.sql(`SELECT coalesce(email_sent_at::text, '') FROM public.builder_network_acknowledgement_notices
                                 WHERE selection_id = ${lit(SEL)}`);

    beforeAll(() => {
      db.sql(`INSERT INTO public.builder_network_acknowledgement_notices(selection_id, outcome) VALUES (${lit(SEL)}, 'notified')`);
    });

    it('a claim is a lease: held while it is fresh, and nothing is recorded as sent', () => {
      const first = claim(600);
      expect(first.state).toBe('claimed');
      expect(first.token).toMatch(/^[0-9a-f-]{36}$/);
      const held = claim(600);
      expect(held.state).toBe('held');
      // It names when the lease ends, so the outbox can defer until then.
      expect(Date.parse(held.until) - Date.now()).toBeGreaterThan(590_000);
      expect(sentAt()).toBe('');
    });

    it('a claim abandoned by a worker that died is recoverable once its lease runs out', () => {
      const stale = claim(0);
      expect(stale.state).toBe('claimed');
      // The dead worker's token can no longer record a send.
      const fresh = claim(0);
      expect(fresh.state).toBe('claimed');
      expect(fresh.token).not.toBe(stale.token);
      expect(settle(stale.token, true)).toBe('f');
      expect(sentAt()).toBe('');
      expect(settle(fresh.token, true)).toBe('t');
      expect(sentAt()).not.toBe('');
      expect(claim(0).state).toBe('sent');
    });

    it('a released claim can be claimed again at once', () => {
      const other = randomUUID();
      db.sql(`INSERT INTO public.builder_network_acknowledgement_notices(selection_id, outcome) VALUES (${lit(other)}, 'notified')`);
      const first = JSON.parse(db.sql(`SELECT public.builder_network_claim_acknowledgement_email(${lit(other)}, 600)::text`));
      expect(db.sql(`SELECT public.builder_network_settle_acknowledgement_email(${lit(other)}, ${lit(first.token)}, false)`)).toBe('t');
      expect(JSON.parse(db.sql(`SELECT public.builder_network_claim_acknowledgement_email(${lit(other)}, 600)::text`)).state).toBe('claimed');
    });

    it('a historical acknowledgement, or none at all, is owed no email', () => {
      const historical = randomUUID();
      db.sql(`INSERT INTO public.builder_network_acknowledgement_notices(selection_id, outcome) VALUES (${lit(historical)}, 'historical')`);
      expect(JSON.parse(db.sql(`SELECT public.builder_network_claim_acknowledgement_email(${lit(historical)}, 600)::text`)).state).toBe('not_owed');
      expect(JSON.parse(db.sql(`SELECT public.builder_network_claim_acknowledgement_email(${lit(randomUUID())}, 600)::text`)).state).toBe('not_owed');
    });

    it('neither can be called by a browser role', () => {
      for (const role of ['anon', 'authenticated']) {
        expect(db.sql(`SELECT has_function_privilege('${role}', 'public.builder_network_claim_acknowledgement_email(uuid,integer)', 'EXECUTE')
                          OR has_function_privilege('${role}', 'public.builder_network_settle_acknowledgement_email(uuid,uuid,boolean)', 'EXECUTE')`))
          .toBe('f');
      }
    });
  });

  describe('withdrawal', () => {
    it('R30. a withdrawn activation closes the conversation to writing and inviting, and keeps it for its participants', () => {
      db.sql(`UPDATE public.builder_stock_selections SET status = 'withdrawn', withdrawn_at = now() WHERE id = ${lit(S1)}`);
      expect(refusal(`SELECT public.builder_network_post_message(${lit(C1)}, ${lit(COLLEAGUE)}, gen_random_uuid(), 'x')`))
        .toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
      expect(refusal(`SELECT public.builder_network_invite_participant(${lit(C1)}, ${lit(COLLEAGUE)}, ${lit(THIRD)})`))
        .toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
      expect(isParticipant(C1, COLLEAGUE)).toBe('t');
      expect(count(`public.builder_network_messages WHERE conversation_id = ${lit(C1)}`)).not.toBe('0');
    });

    it('a closed conversation can be left by its last participant, and its history stays', () => {
      const before = count(`public.builder_network_messages WHERE conversation_id = ${lit(C1)}`);
      expect(leave(C1, OWNER)).toBe('left');
      expect(leave(C1, COLLEAGUE)).toBe('left');
      expect(count(`public.builder_network_messages WHERE conversation_id = ${lit(C1)}`)).toBe(before);
    });
  });

  describe('the conversations that existed before this step', () => {
    const legacy = () => propertyConversationId(NET_A, LEGACY_ITEM);

    it('R31/R32. the existing conversation keeps its id and its three messages, and is bound to its activation', () => {
      expect(db.sql(`SELECT public.builder_network_seed_activation_conversation(${lit(S_LEGACY)}, ${lit(legacy())})`)).toBe('seeded');
      expect(db.sql(`SELECT selection_ref FROM public.builder_network_conversations WHERE id = ${lit(legacy())}`)).toBe(S_LEGACY);
      expect(db.sql(`SELECT string_agg(id::text || ':' || body, ',' ORDER BY sent_at)
                     FROM public.builder_network_messages WHERE conversation_id = ${lit(legacy())}`))
        .toBe(`${LEGACY_MESSAGES[0]}:Is lot 102 still available?,${LEGACY_MESSAGES[1]}:Yes, it is.,${LEGACY_MESSAGES[2]}:Thank you.`);
      expect(members(legacy())).toBe('command_centre:Olive Owner:joined');
    });

    it('R33. binding and seeding send no notification and no email', () => {
      const before = notifications(OWNER);
      db.sql(`SELECT public.builder_network_seed_activation_conversation(${lit(S_QUIET)},
                ${lit(activationConversationId(NET_A, S_QUIET))})`);
      expect(members(activationConversationId(NET_A, S_QUIET))).toBe('command_centre:Otto Other:joined');
      expect(notifications(OWNER)).toBe(before);
      expect(emails(S_LEGACY)).toBe('0');
      expect(emails(S_QUIET)).toBe('0');
    });

    it('seeding again changes nothing', () => {
      expect(db.sql(`SELECT public.builder_network_seed_activation_conversation(${lit(S_LEGACY)}, ${lit(legacy())})`)).toBe('already_seeded');
      expect(count(`public.builder_network_conversation_participants WHERE conversation_id = ${lit(legacy())}`)).toBe('1');
    });

    it('nothing is seeded that cannot be established: a conversation of another property, or an unacknowledged activation', () => {
      expect(refusal(`SELECT public.builder_network_seed_activation_conversation(${lit(S_QUIET)}, ${lit(legacy())})`))
        .toMatch(/AGENCY_SEED_MISMATCH/);
      const client = db.sql(`INSERT INTO public.clients(primary_first_name) VALUES ('Y') RETURNING id`);
      const pending = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status)
                              VALUES (${lit(QUIET_ITEM)}, ${lit(ORG_A)}, ${lit(client)}, ${lit(OWNER)}, 'selected') RETURNING id`);
      expect(refusal(`SELECT public.builder_network_seed_activation_conversation(${lit(pending)},
                        ${lit(activationConversationId(NET_A, pending))})`)).toMatch(/AGENCY_SEED_NOT_ACKNOWLEDGED/);
    });
  });

  describe('the builder\'s company contact', () => {
    it('R34/R35. the builder organisation\'s own public contact fields arrive with its property', () => {
      const item = randomUUID();
      land(CONN_A, 'stock.item.upserted', `stock:${randomUUID()}`, {
        id: item, organisation_id: ORG_A, lifecycle_status: 'active', availability_status: 'available',
        address_line: '4 Contact Street',
        organisation: {
          id: ORG_A, legal_name: 'Check Homes Pty Ltd', contact_email: 'sales@checkhomes.example',
          contact_phone: '02 9000 0000', website: 'https://checkhomes.example',
        },
        media: { schema_version: 1, photos: [], documents: [] },
      });
      mainSweep();
      expect(db.sql(`SELECT contact_email || '|' || contact_phone || '|' || website
                     FROM public.builder_network_stock_organisations WHERE id = ${lit(ORG_A)}`))
        .toBe('sales@checkhomes.example|02 9000 0000|https://checkhomes.example');
    });

    it('R36. no client or private field crosses in anything this step sends', () => {
      // What this step sends: the message lane. The activation's own events
      // carry its reference by Step 1's contract, and are not this step's.
      const everything = db.sql(`SELECT COALESCE(string_agg(payload::text, ' '), '') FROM public.builder_network_outbox
                                 WHERE event_type LIKE 'agency.%'`);
      for (const secret of ['Clientina', 'clientina.hidden', 'Confidential note', OWNER, OWNER_2, COLLEAGUE, S1, S2]) {
        expect(everything).not.toContain(secret);
      }
      for (const row of JSON.parse(db.sql(`SELECT COALESCE(json_agg(payload), '[]') FROM public.builder_network_outbox`))) {
        expect(() => assertPayloadCrossesClean(row)).not.toThrow();
      }
    });
  });

  describe('R40. what this step does not change', () => {
    it('stock events still take the main sweep, and media its own lane', () => {
      const item = randomUUID();
      land(CONN_A, 'stock.item.upserted', `stock:${randomUUID()}`, {
        id: item, organisation_id: ORG_A, lifecycle_status: 'active', availability_status: 'available',
        address_line: '5 Unchanged Street', organisation: { id: ORG_A, legal_name: 'Check Homes Pty Ltd' },
        media: { schema_version: 1, photos: [], documents: [] },
      });
      mainSweep();
      db.sql('SELECT * FROM public.builder_network_apply_stock_media(50)');
      expect(count(`public.builder_network_stock_items WHERE id = ${lit(item)}`)).toBe('1');
      expect(count(`public.builder_network_inbound_events WHERE event_type = 'stock.item.upserted' AND media_applied_at IS NULL`)).toBe('0');
    });

    it('no browser role reaches the new tables or functions', () => {
      for (const role of ['anon', 'authenticated']) {
        expect(db.sql(`SELECT has_table_privilege('${role}', 'public.builder_network_conversation_participants', 'SELECT')
                          OR has_function_privilege('${role}', 'public.builder_network_invite_participant(uuid,uuid,uuid)', 'EXECUTE')
                          OR has_function_privilege('${role}', 'public.builder_network_leave_conversation(uuid,uuid)', 'EXECUTE')
                          OR has_function_privilege('${role}', 'public.builder_network_post_message(uuid,uuid,uuid,text)', 'EXECUTE')
                          OR has_function_privilege('${role}', 'public.builder_network_seed_activation_conversation(uuid,uuid)', 'EXECUTE')`))
          .toBe('f');
      }
    });
  });

  describe('R39. Step 5\'s delivery, under the new model', () => {
    const ITEM3 = randomUUID();
    let S3 = ''; let C3 = '';
    const builderMessage = (overrides: Record<string, unknown> = {}) => ({
      schema_version: 1, conversation_id: C3, message_id: randomUUID(), stock_item_id: ITEM3,
      body: 'Lot 104 is available.', sender_display_name: 'Avery Builder',
      sent_at: '2026-09-26T03:00:00.000000Z', generation: 1, ...overrides,
    });
    const receipt = (message: string, generation: number, outcome: string, reason?: string) =>
      land(CONN_A, 'agency.message.receipt', `agency.receipt:${message}:${generation}:${randomUUID()}`, {
        schema_version: 1, message_id: message, conversation_id: C3, generation, outcome, ...(reason ? { reason } : {}),
      });

    beforeAll(() => {
      db.sql(`INSERT INTO public.builder_network_stock_items(id, organisation_id, address_line, lot_number, lifecycle_status)
              VALUES (${lit(ITEM3)}, ${lit(ORG_A)}, '4 Transport Street', '104', 'active')`);
      const client = db.sql(`INSERT INTO public.clients(primary_first_name) VALUES ('T') RETURNING id`);
      S3 = db.sql(`INSERT INTO public.builder_stock_selections(stock_item_id, organisation_id, client_id, selected_by_user_id, status)
                   VALUES (${lit(ITEM3)}, ${lit(ORG_A)}, ${lit(client)}, ${lit(THIRD)}, 'selected') RETURNING id`);
      acknowledge(CONN_A, S3, ITEM3);
      C3 = activationConversationId(NET_A, S3);
    });

    it('an accepted receipt marks a message delivered; a refusal marks it failed, with the reason', () => {
      const a = post(C3, THIRD, 'First.');
      const b = post(C3, THIRD, 'Second.');
      receipt(a, 1, 'accepted');
      receipt(b, 1, 'refused', 'conversation_not_open');
      messageSweep();
      expect(db.sql(`SELECT delivery_state FROM public.builder_network_messages WHERE id = ${lit(a)}`)).toBe('delivered');
      expect(db.sql(`SELECT delivery_state || '|' || failure_reason FROM public.builder_network_messages WHERE id = ${lit(b)}`))
        .toBe('failed|refused:conversation_not_open');
    });

    it('a builder message is stored once however often it is delivered, and a changed one is refused', () => {
      const m = builderMessage();
      land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:1`, m);
      land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:2`, { ...m, generation: 2 });
      land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:3`, { ...m, body: 'Other words.', generation: 3 });
      messageSweep();
      expect(count(`public.builder_network_messages WHERE id = ${lit(m.message_id)}`)).toBe('1');
      expect(db.sql(`SELECT string_agg(payload->>'outcome', ',' ORDER BY (payload->>'generation')::int) FROM public.builder_network_outbox
                     WHERE event_type = 'agency.message.receipt' AND payload->>'message_id' = ${lit(m.message_id)}`))
        .toBe('accepted,accepted,refused');
    });

    it('a message waits behind an activation event that landed before it and is not yet applied', () => {
      const m = builderMessage({ body: 'Behind the activation.' });
      land(CONN_A, 'stock.selection.acknowledged', `stock.selection.acknowledged:${randomUUID()}`, {
        remote_selection_ref: randomUUID(), stock_item_id: ITEM3, status: 'builder_acknowledged',
        acknowledged_at: '2026-09-26T03:00:00.000000Z',
      });
      land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:1`, m);
      messageSweep();
      expect(count(`public.builder_network_messages WHERE id = ${lit(m.message_id)}`)).toBe('0');
      mainSweep();
      messageSweep();
      expect(count(`public.builder_network_messages WHERE id = ${lit(m.message_id)}`)).toBe('1');
    });

    it('a disputed connection halts writing here and holds what arrives', () => {
      db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = now() WHERE id = ${lit(CONN_A)}`);
      try {
        expect(refusal(`SELECT public.builder_network_post_message(${lit(C3)}, ${lit(THIRD)}, gen_random_uuid(), 'x')`))
          .toMatch(/AGENCY_CONNECTION_HALTED/);
        const m = builderMessage({ body: 'During the dispute.' });
        land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:1`, m);
        messageSweep();
        expect(db.sql(`SELECT message_applied_at IS NULL FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${m.message_id}:1'`)).toBe('t');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET identity_mismatch_since = NULL WHERE id = ${lit(CONN_A)}`);
      }
      messageSweep();
    });

    it('a withdrawn stock:publish closes writing and refuses the builder\'s new content, and is restored with it', () => {
      db.sql(`UPDATE public.builder_network_connections SET scopes = ARRAY[]::text[] WHERE id = ${lit(CONN_A)}`);
      try {
        expect(refusal(`SELECT public.builder_network_post_message(${lit(C3)}, ${lit(THIRD)}, gen_random_uuid(), 'x')`))
          .toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
        const m = builderMessage({ body: 'Without the scope.' });
        land(CONN_A, 'agency.message.posted', `agency.message:${m.message_id}:1`, m);
        messageSweep();
        expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                       WHERE dedupe_key = 'agency.message:${m.message_id}:1'`)).toBe('refused:scope_revoked');
      } finally {
        db.sql(`UPDATE public.builder_network_connections SET scopes = ARRAY['stock:publish'] WHERE id = ${lit(CONN_A)}`);
      }
      expect(post(C3, THIRD, 'Open again.')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('a property the builder stopped listing takes nothing new, and keeps its history', () => {
      db.sql(`UPDATE public.builder_network_stock_items SET lifecycle_status = 'archived' WHERE id = ${lit(ITEM3)}`);
      try {
        expect(refusal(`SELECT public.builder_network_post_message(${lit(C3)}, ${lit(THIRD)}, gen_random_uuid(), 'x')`))
          .toMatch(/AGENCY_CONVERSATION_NOT_OPEN/);
        expect(count(`public.builder_network_messages WHERE conversation_id = ${lit(C3)}`)).not.toBe('0');
      } finally {
        db.sql(`UPDATE public.builder_network_stock_items SET lifecycle_status = 'active' WHERE id = ${lit(ITEM3)}`);
      }
    });

    it('a withdrawn activation refuses the builder\'s new message, and still acknowledges a stored one sent again', () => {
      const kept = builderMessage({ body: 'Kept before the withdrawal.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${kept.message_id}:1`, kept);
      messageSweep();
      db.sql(`UPDATE public.builder_stock_selections SET status = 'withdrawn', withdrawn_at = now() WHERE id = ${lit(S3)}`);
      const fresh = builderMessage({ body: 'After the withdrawal.' });
      land(CONN_A, 'agency.message.posted', `agency.message:${fresh.message_id}:1`, fresh);
      land(CONN_A, 'agency.message.posted', `agency.message:${kept.message_id}:2`, { ...kept, generation: 2 });
      messageSweep();
      expect(db.sql(`SELECT message_apply_error FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${fresh.message_id}:1'`)).toBe('refused:conversation_not_open');
      expect(db.sql(`SELECT COALESCE(message_apply_error, 'applied') FROM public.builder_network_inbound_events
                     WHERE dedupe_key = 'agency.message:${kept.message_id}:2'`)).toBe('applied');
    });
  });
});
