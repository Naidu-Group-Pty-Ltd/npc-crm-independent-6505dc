/**
 * ONE ACTIVATION, ONE PRIVATE CONVERSATION — WHAT A COMMAND CENTRE USER IS
 * SHOWN (docs/builder-portal/52).
 *
 * The rows are written by `20261224090000_one_activation_one_private_conversation.sql`.
 * This decides what of them reaches a browser: display names, sides and
 * states — never a user id, a selection id or anything about the client.
 *
 * Pure: no IO.
 */

export type ActivationStatus = 'awaiting_acknowledgement' | 'acknowledged' | 'withdrawn';

/** Read from the activation's own fields; a withdrawal outranks everything. */
export function activationStatus(row: { status?: unknown; acknowledged_at?: unknown }): ActivationStatus {
  if (row.status === 'withdrawn') return 'withdrawn';
  return row.acknowledged_at ? 'acknowledged' : 'awaiting_acknowledgement';
}

/**
 * Why a conversation takes nothing new right now, or null while it does.
 * The same order the database decides it in
 * (`builder_network_conversation_closed_reason`).
 */
export type ConversationClosedReason =
  | 'not_connected' | 'connection_halted' | 'connection_paused' | 'not_activated'
  | 'withdrawn' | 'not_acknowledged' | 'delisted';

export function conversationClosedReason(facts: {
  connection: { state?: unknown; scopes?: unknown; identity_mismatch_since?: unknown } | null;
  selectionRef: string | null;
  selection: { status?: unknown; acknowledged_at?: unknown } | null;
  item: { lifecycle_status?: unknown } | null;
}): ConversationClosedReason | null {
  const { connection, selectionRef, selection, item } = facts;
  if (!connection || connection.state !== 'active') return 'not_connected';
  // No live activation outranks a paused route (Step 5's rule): restoring the
  // route alone would not open it.
  if (!selectionRef) return 'not_activated';
  if (!selection || selection.status === 'withdrawn') return 'withdrawn';
  if (!selection.acknowledged_at) return 'not_acknowledged';
  if (connection.identity_mismatch_since) return 'connection_halted';
  if (!(Array.isArray(connection.scopes) && connection.scopes.includes('stock:publish'))) return 'connection_paused';
  if (!item || item.lifecycle_status !== 'active') return 'delisted';
  return null;
}

export interface ParticipantView {
  /** Random per (conversation, person): what tells two people with one name apart. */
  participant_ref: string;
  side: 'command_centre' | 'builder';
  display_name: string;
  is_me: boolean;
}

/**
 * The people in a conversation now: this side first, then the builder's, by
 * name. Someone who has left is not listed. `is_me` is the only thing derived
 * from the viewer, and no user id leaves this function.
 */
export function projectParticipants(rows: readonly Record<string, unknown>[], viewerUserId: string): ParticipantView[] {
  return rows
    .filter((row) => row.state === 'joined')
    .map((row) => ({
      participant_ref: String(row.participant_ref),
      side: (row.side === 'builder' ? 'builder' : 'command_centre') as ParticipantView['side'],
      display_name: String(row.display_name ?? ''),
      is_me: row.side === 'command_centre' && !!row.local_user_id && row.local_user_id === viewerUserId,
    }))
    .sort((a, b) => (a.side === b.side
      ? (a.display_name === b.display_name ? (a.participant_ref < b.participant_ref ? -1 : 1)
        : a.display_name < b.display_name ? -1 : 1)
      : a.side === 'command_centre' ? -1 : 1));
}

/** A person's name as this workspace writes it — the database's rule. */
export function userDisplayName(user: { first_name?: unknown; last_name?: unknown; username?: unknown } | null | undefined): string | null {
  if (!user) return null;
  const full = [user.first_name, user.last_name].filter((part) => typeof part === 'string' && part.trim()).join(' ').trim();
  if (full) return full.slice(0, 200);
  const username = typeof user.username === 'string' ? user.username.trim() : '';
  return username ? username.slice(0, 200) : null;
}

/** How a property is named to a person: its lot, then its street. */
export function propertyLabel(item: { lot_number?: unknown; address_line?: unknown } | null | undefined): string {
  const lot = typeof item?.lot_number === 'string' && item.lot_number.trim() ? `Lot ${item.lot_number.trim()}` : '';
  const street = typeof item?.address_line === 'string' ? item.address_line.trim() : '';
  return [lot, street].filter(Boolean).join(', ') || 'your activated property';
}

/**
 * A stable key for a row that is not the activation's id: the page needs to
 * tell rows apart, and nothing it is given should name a record it cannot
 * otherwise reach.
 */
export function activationKey(selectionId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < selectionId.length; i += 1) {
    hash ^= selectionId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let second = 0x9e3779b9;
  for (let i = selectionId.length - 1; i >= 0; i -= 1) {
    second ^= selectionId.charCodeAt(i);
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return `a${hash.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

/** For setting builder-supplied words into an HTML body. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The acknowledgement email. It names the builder company, the property and,
 * where the builder sent one, who acknowledged it — never the client.
 */
export function acknowledgementEmail(facts: {
  builderName: string; address: string; lotNumber: string | null; acknowledgedBy: string | null; link: string | null;
}): { subject: string; title: string; text: string; html: string } {
  const property = propertyLabel({ lot_number: facts.lotNumber ?? undefined, address_line: facts.address });
  const by = facts.acknowledgedBy ? ` ${facts.acknowledgedBy} acknowledged it on the builder's behalf.` : '';
  const text = `${facts.builderName} has acknowledged your activation of ${property}.${by}`
    + ' You can now message the builder about it from Portals → Builder Portal.';
  return {
    subject: `${facts.builderName} acknowledged your activation`,
    // Fixed words: the title is set into the email as markup and as its
    // subject, so nothing the builder wrote goes there.
    title: 'Activation acknowledged',
    text,
    // Every value here came from the builder over the network, and the email
    // helper sets its message into HTML as it is given.
    html: escapeHtml(text),
  };
}

export interface ConversationSummary {
  conversation_id: string;
  stock_item_id: string;
  address: string | null;
  lot_number: string | null;
  builder_name: string | null;
  status: ActivationStatus | null;
  last_message_at: string | null;
}

export interface ActivatedPropertyRow {
  /** Stable per activation, and not its id. */
  activation_key: string;
  stock_item_id: string;
  address: string | null;
  suburb: string | null;
  lot_number: string | null;
  house_design: string | null;
  primary_image_id: string | null;
  builder_name: string | null;
  builder_email: string | null;
  builder_phone: string | null;
  builder_website: string | null;
  activated_by: string | null;
  activated_at: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  status: ActivationStatus;
  /** Only where the viewer is in the activation's conversation now. */
  conversation_id: string | null;
}
