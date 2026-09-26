/**
 * The Command Centre's "new message from <builder>" popup, as words.
 *
 * The server answers which builder messages arrived after a cursor, in the
 * reader's own conversations (`list_new_builder_messages`). This module turns
 * each into what the toast says and where it leads, and nothing else — so the
 * wording and the link are tested without a browser.
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

/** How often an open, visible Command Centre asks for new builder messages. */
export const BUILDER_MESSAGE_POPUP_POLL_MS = 10_000;
