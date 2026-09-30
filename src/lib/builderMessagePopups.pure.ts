/**
 * The Command Centre's "new message from <builder>" popup, as words and rules.
 *
 * The server answers which builder messages arrived after a cursor, in the
 * reader's own conversations (`list_new_builder_messages`). This module turns
 * each conversation's arrivals into what the popup and the desktop
 * notification say and where they lead, and decides the questions the
 * component asks of every answer — is the reader already on that
 * conversation, has the check been refused, how often to ask while nobody is
 * looking — so the wording, the link and the rules are tested without a
 * browser.
 */

export interface NewBuilderMessage {
  message_id: string;
  conversation_id: string;
  builder_name: string | null;
  sender_display_name: string;
  lot_number: string | null;
  address: string | null;
  received_at: string;
}

export interface BuilderMessagePopup {
  id: string;
  title: string;
  description: string;
  href: string;
}

/** Where a builder conversation opens in the Command Centre. */
export const builderConversationHref = (conversationId: string) =>
  `/admin/builder-portal/messaging/${encodeURIComponent(conversationId)}`;

export function builderMessagePopup(message: NewBuilderMessage): BuilderMessagePopup {
  const builder = message.builder_name?.trim() || 'a builder';
  const property = [message.lot_number ? `Lot ${message.lot_number}` : null, message.address]
    .filter(Boolean).join(', ');
  const sender = message.sender_display_name?.trim();
  return {
    id: message.message_id,
    title: `New message from ${builder}`,
    description: [sender, property].filter(Boolean).join(' · ') || 'Open the conversation to read it.',
    href: builderConversationHref(message.conversation_id),
  };
}

/**
 * How often an open, visible Command Centre asks for new builder messages. The
 * same read tells an open conversation to re-read itself, so this is also how
 * soon a message appears in a thread that is already on screen.
 */
export const BUILDER_MESSAGE_POPUP_POLL_MS = 5_000;

/**
 * How often a Command Centre nobody is looking at — another tab, another
 * window, minimised — still asks. It used to ask nothing at all, so a builder
 * who wrote while the reader was elsewhere reached them only when they came
 * back. Slower than a visible tab, because the browser throttles a background
 * tab's timers anyway and nobody is reading it; quick enough that the desktop
 * notification and the tab badge arrive within half a minute.
 */
export const BUILDER_MESSAGE_BACKGROUND_POLL_MS = 30_000;

/** What one conversation received in one check, oldest first. */
export interface BuilderConversationArrival {
  conversationId: string;
  messages: NewBuilderMessage[];
  latest: NewBuilderMessage;
}

/**
 * One entry per conversation, in the order their latest message arrived. A
 * conversation that received three messages is told once, as three — not as
 * three popups stacked over each other.
 */
export function groupBuilderMessages(messages: readonly NewBuilderMessage[]): BuilderConversationArrival[] {
  const byConversation = new Map<string, NewBuilderMessage[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversation_id) ?? [];
    list.push(message);
    byConversation.set(message.conversation_id, list);
  }
  const at = (message: NewBuilderMessage) => String(message.received_at ?? '');
  return [...byConversation.entries()]
    .map(([conversationId, list]) => {
      const ordered = [...list].sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
      return { conversationId, messages: ordered, latest: ordered[ordered.length - 1] };
    })
    .sort((a, b) => (at(a.latest) < at(b.latest) ? -1 : at(a.latest) > at(b.latest) ? 1 : 0));
}

/**
 * The popup for everything one conversation received. Its id is the
 * conversation's, so a later message replaces the popup rather than stacking a
 * second one under it.
 */
export function builderConversationPopup(messages: readonly NewBuilderMessage[]): BuilderMessagePopup {
  const latest = messages[messages.length - 1];
  const popup = builderMessagePopup(latest);
  if (messages.length <= 1) return { ...popup, id: latest.conversation_id };
  const builder = latest.builder_name?.trim() || 'a builder';
  return { ...popup, id: latest.conversation_id, title: `${messages.length} new messages from ${builder}` };
}

const decodePath = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/** The conversation whose own page this is, or null. */
export function builderConversationIdFromPath(pathname: string): string | null {
  const match = /^\/admin\/builder-portal\/messaging\/([^/]+)\/?$/.exec(pathname);
  return match ? decodePath(match[1]) : null;
}

/**
 * Whether the reader is on the conversation's own page. Then the thread
 * re-reads itself and no popup is raised over the conversation they are
 * already reading.
 */
export function isViewingBuilderConversation(pathname: string, conversationId: string): boolean {
  return builderConversationIdFromPath(pathname) === conversationId;
}

/**
 * A refusal the next check would get too ends the checking: signed out, or
 * access withdrawn. Anything else — a 5xx, a network failure — is asked again
 * next time, from the same cursor.
 */
export function builderMessagePollingRefused(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/**
 * The keys the once-per-person ledger records a conversation under: one for
 * the desktop notification, one for the catch-up popup. Namespaced, so a
 * builder conversation can never share a key with a team thread.
 */
export const builderAlertKey = (conversationId: string) => `builder-message:${conversationId}`;
export const builderCatchUpKey = (conversationId: string) => `builder-message-shown:${conversationId}`;

/**
 * What a reader's checks have already read, kept across a remount. The
 * Command Centre swaps its desktop and mobile layouts at 1024px, which mounts
 * the popups afresh, and a fresh cursor would silently skip whatever arrived
 * in between. Kept per reader, so a different person signing in on the same
 * tab starts again from their own cursor.
 */
export interface BuilderMessageCheckState {
  cursor: string | null;
  shown: Set<string>;
}

const checkStates = new Map<string, BuilderMessageCheckState>();

export function builderMessageCheckState(reader: string | null): BuilderMessageCheckState {
  const key = reader ?? '';
  let state = checkStates.get(key);
  if (!state) {
    state = { cursor: null, shown: new Set() };
    checkStates.set(key, state);
  }
  return state;
}

/** Forget every reader's cursor (tests, and nothing else). */
export function forgetBuilderMessageChecks() {
  checkStates.clear();
}
