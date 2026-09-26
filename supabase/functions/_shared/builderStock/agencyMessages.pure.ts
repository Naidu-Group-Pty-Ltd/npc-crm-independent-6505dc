/**
 * THE BUILDER CONVERSATION — WHAT A COMMAND CENTRE USER IS SHOWN.
 *
 * The rows are written by `builder_network_post_message` and by the message
 * sweep (`20261221120000_an_agency_and_a_builder_talk_over_the_network.sql`).
 * This decides what reaches a browser: the sender's display name and side,
 * the body, when it was written, and — for what the Command Centre sent — its
 * delivery state. Never a user id and never the client's idempotency key.
 *
 * Order is the writing side's server clock, then the id: the same order the
 * Builder Portal draws, so both ends read one conversation the same way.
 *
 * Pure: no IO.
 */

export type ConversationSide = 'command_centre' | 'builder';
export type DeliveryState = 'queued' | 'delivered' | 'failed';

export interface ConversationMessageView {
  id: string;
  side: ConversationSide;
  sender_display_name: string;
  body: string;
  sent_at: string;
  /** Only for what the Command Centre sent; the builder's messages carry none. */
  delivery_state: DeliveryState | null;
  delivered_at: string | null;
  failure_reason: string | null;
  mine: boolean;
  can_retry: boolean;
}

type Row = Record<string, unknown>;

export function projectConversationMessages(rows: readonly Row[], viewerUserId: string): ConversationMessageView[] {
  return rows
    .map((row) => {
      const side: ConversationSide = row.side === 'command_centre' ? 'command_centre' : 'builder';
      const ours = side === 'command_centre';
      const mine = ours && row.sender_user_id === viewerUserId;
      const state = ours ? (row.delivery_state as DeliveryState | null) ?? null : null;
      return {
        id: String(row.id),
        side,
        sender_display_name: String(row.sender_display_name ?? ''),
        body: String(row.body ?? ''),
        sent_at: String(row.sent_at),
        delivery_state: state,
        delivered_at: ours ? (row.delivered_at as string | null) ?? null : null,
        failure_reason: ours ? (row.failure_reason as string | null) ?? null : null,
        mine,
        can_retry: mine && state === 'failed',
      } satisfies ConversationMessageView;
    })
    .sort((a, b) => (a.sent_at === b.sent_at ? (a.id < b.id ? -1 : 1) : (a.sent_at < b.sent_at ? -1 : 1)));
}

/** A refusal raised by the SQL, as the browser is told it — or null for a fault of ours. */
export function agencyMessageRefusal(message: string): { status: number; code: string; error: string } | null {
  const table: Array<[string, number, string, string]> = [
    ['AGENCY_CONVERSATION_NOT_FOUND', 404, 'not_found', 'This property has no builder connection to message.'],
    ['AGENCY_CONVERSATION_NOT_OPEN', 409, 'conversation_not_open', 'Activate this property before messaging its builder.'],
    ['AGENCY_MESSAGE_INVALID', 400, 'invalid_message', 'A message needs between 1 and 4,000 characters.'],
    ['AGENCY_MESSAGE_NOT_RETRYABLE', 409, 'not_retryable', 'Only a message you sent that was not delivered can be sent again.'],
    ['AGENCY_SENDER_NOT_A_MEMBER', 403, 'not_a_member', 'Your account cannot send messages.'],
    ['AGENCY_MESSAGE_ID_REUSED', 409, 'message_id_reused', 'That message was already sent to a different conversation.'],
    // One activation, one private conversation (docs/builder-portal/52, 62).
    ['AGENCY_NOT_A_PARTICIPANT', 403, 'not_a_participant', 'You are not in this conversation.'],
    ['AGENCY_LAST_PARTICIPANT', 409, 'last_participant', 'Add a colleague before you leave: a live conversation keeps at least one person from your side.'],
    ['AGENCY_INVITEE_NOT_ELIGIBLE', 422, 'invitee_not_eligible', 'That person cannot be added to this conversation.'],
    ['AGENCY_NETWORK_DISABLED', 409, 'network_disabled', 'The builder network is switched off for this workspace.'],
    ['AGENCY_CONNECTION_HALTED', 409, 'connection_halted', 'Messages to this builder are paused while the connection is checked. Try again later.'],
  ];
  for (const [raw, status, code, error] of table) {
    if (message.includes(raw)) return { status, code, error };
  }
  return null;
}

/**
 * Whether the worker must HOLD an outbound agency message rather than send it:
 * the connection's builder identity is disputed, or the builder withdrew
 * stock:publish. The same rule the database applies to pending rows, asked
 * again at the moment of sending, because a row claimed before the hold began
 * is already in the worker's hands. Nothing else is this rule's to hold.
 */
export function agencyMessageRouteHeld(
  connection: { identity_mismatch_since?: string | null; scopes?: readonly string[] | null },
  eventType: string,
): boolean {
  if (!eventType.startsWith('agency.message.')) return false;
  if (connection.identity_mismatch_since) return true;
  // A withdrawn scope holds new CONTENT only: the receipt that tells the
  // builder why must still reach it.
  return eventType === 'agency.message.posted' && !(connection.scopes ?? []).includes('stock:publish');
}

/**
 * The exact key set of each message event. The privacy screen is a deny-list;
 * this is the allow-list: a signed peer cannot widen what crosses by adding a
 * field, because an envelope carrying anything else is refused at the door,
 * before it is stored, and again when it is applied.
 */
const POSTED_KEYS = [
  'body', 'conversation_id', 'generation', 'message_id', 'schema_version',
  'sender_display_name', 'sent_at', 'stock_item_id',
] as const;
const RECEIPT_REQUIRED_KEYS = ['conversation_id', 'generation', 'message_id', 'outcome', 'schema_version'] as const;
const RECEIPT_OPTIONAL_KEYS = ['reason'] as const;
/**
 * `agency.message.participant` (docs/builder-portal/52, 62): who is in an
 * activation's conversation, as each side announces its own. A display record
 * only — it never grants anything at the receiving end.
 */
const PARTICIPANT_KEYS = [
  'conversation_id', 'display_name', 'participant_ref', 'schema_version', 'side', 'state', 'stock_item_id', 'version',
] as const;
const PARTICIPANT_SIDES: readonly string[] = ['command_centre', 'builder'];
const PARTICIPANT_STATES: readonly string[] = ['joined', 'left'];

export interface AgencyContractViolation {
  /** Key NAMES outside the contract; a value is never carried. */
  unexpected: string[];
  missing: string[];
  /** Contract keys whose value is not the contract's JSON type. */
  mistyped: string[];
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECEIPT_OUTCOMES: readonly string[] = ['accepted', 'refused'];

/** The message schema version both sides write and apply. */
export const AGENCY_MESSAGE_SCHEMA_VERSION = 1;

/** Each key's JSON type. `reason` alone may also be null. */
const KEY_TYPES: Record<string, 'string' | 'number'> = {
  body: 'string', sender_display_name: 'string', sent_at: 'string', message_id: 'string',
  conversation_id: 'string', stock_item_id: 'string', outcome: 'string', reason: 'string',
  generation: 'number', schema_version: 'number',
  participant_ref: 'string', display_name: 'string', side: 'string', state: 'string', version: 'number',
};

export function agencyPayloadContractViolation(eventType: string, payload: unknown): AgencyContractViolation | null {
  let required: readonly string[];
  let optional: readonly string[];
  if (eventType === 'agency.message.posted') {
    required = POSTED_KEYS; optional = [];
  } else if (eventType === 'agency.message.receipt') {
    required = RECEIPT_REQUIRED_KEYS; optional = RECEIPT_OPTIONAL_KEYS;
  } else if (eventType === 'agency.message.participant') {
    required = PARTICIPANT_KEYS; optional = [];
  } else {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { unexpected: [], missing: [...required], mistyped: [] };
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = new Set<string>([...required, ...optional]);
  const unexpected = keys.filter((key) => !allowed.has(key)).sort();
  const missing = required.filter((key) => !keys.includes(key));
  const mistyped = keys
    .filter((key) => allowed.has(key))
    .filter((key) => !(key === 'reason' && record[key] === null))
    .filter((key) => typeof record[key] !== KEY_TYPES[key]
      // The one schema version the apply step can read. Refused at the door,
      // a skewed peer's message stays pending and is retried, never marked
      // delivered only to be dropped where no receipt can follow.
      || (key === 'schema_version' && record[key] !== AGENCY_MESSAGE_SCHEMA_VERSION)
      // The values the apply step reads without answering: an id it cannot
      // cast, or an outcome it does not know, would be stamped invalid there
      // with no receipt, after the door had already said delivered.
      || ((key === 'message_id' || key === 'conversation_id') && !UUID_SHAPE.test(String(record[key])))
      || ((key === 'participant_ref' || (key === 'stock_item_id' && eventType === 'agency.message.participant'))
        && !UUID_SHAPE.test(String(record[key])))
      || (key === 'side' && !PARTICIPANT_SIDES.includes(record[key] as string))
      || (key === 'state' && !PARTICIPANT_STATES.includes(record[key] as string))
      || (key === 'display_name' && !(String(record[key]).trim().length >= 1 && String(record[key]).trim().length <= 200))
      || (key === 'version' && !(Number.isInteger(record[key]) && (record[key] as number) >= 1
        && (record[key] as number) <= 2_147_483_647))
      || (key === 'outcome' && !RECEIPT_OUTCOMES.includes(record[key] as string))
      // A generation is a positive whole number within an integer's range.
      || (key === 'generation' && !(Number.isInteger(record[key]) && (record[key] as number) >= 1
        && (record[key] as number) <= 2_147_483_647)))
    .sort();
  return unexpected.length || missing.length || mistyped.length ? { unexpected, missing, mistyped } : null;
}

/**
 * The dedupe key a message envelope must carry, derived from its payload. The
 * door's duplicate check is a global unique key: bound to the payload, a
 * reused key can never make a NEW message read as a redelivery of an old one.
 */
export function agencyDedupeKeyFor(eventType: string, payload: unknown): string | null {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (eventType === 'agency.message.posted') return `agency.message:${String(record.message_id)}:${String(record.generation)}`;
  if (eventType === 'agency.message.receipt') return `agency.receipt:${String(record.message_id)}:${String(record.generation)}`;
  if (eventType === 'agency.message.participant') {
    return `agency.participant:${String(record.conversation_id)}:${String(record.participant_ref)}:${String(record.version)}`;
  }
  return null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/**
 * Whether an envelope that hit an existing dedupe key is the SAME envelope.
 * Only then is it a redelivery to acknowledge; the same key carrying other
 * content is a conflict, never an accepted duplicate.
 */
export function sameAgencyEnvelope(
  stored: { connection_id: unknown; event_type: unknown; payload: unknown },
  incoming: { connection_id: unknown; event_type: unknown; payload: unknown },
): boolean {
  return stored.connection_id === incoming.connection_id
    && stored.event_type === incoming.event_type
    && JSON.stringify(canonical(stored.payload)) === JSON.stringify(canonical(incoming.payload));
}
