/**
 * Who sent a finance-portal message, as a reader should see it.
 *
 * Audit item 48 — the Finance Messages thread labelled every incoming message
 * `ARVINRAJ2829@GMAIL.COM`, for the finance partner and the client alike, and
 * drew both in the same bubble. The reporter had to annotate the screenshot
 * with "F" and "C" to say which was which, because their finance portal and
 * client portal happen to share an address.
 *
 * The cause is upstream: `finance-portal-messages` resolves an actor's display
 * name as `portalUser.email` for a partner and `portalUser.email || 'Client'`
 * for a client, because neither `finance_portal_users` nor
 * `client_portal_users` carries a name column. Measured over the live table:
 * 26 staff messages, none of them an email; 5 client messages and 5 partner
 * messages, ALL of them an email.
 *
 * Two rules follow.
 *
 * **The role is always shown, and it is what distinguishes the parties.** A
 * name can be absent, can be shared, and — as here — can be the same person on
 * both sides of a conversation. Colour cannot carry it either: in dark mode
 * `--primary`, `--accent`, `--warning` and `--brand` are the identical gold,
 * so a palette-only answer is unreadable on the very theme the defect was
 * reported on, and would be invisible to a colour-blind reader on any theme.
 *
 * **An address is never a name.** The stored value is used only when it is
 * not an email; otherwise the role stands alone. That repairs the ten
 * historical messages as well as every future one, which a server-side fix
 * on its own could not do.
 */

export type MessageSenderType = 'partner' | 'staff' | 'client';

/** What each party is called on screen. Never a column name, never an id. */
export const SENDER_ROLE_LABEL: Record<MessageSenderType, string> = {
  partner: 'Finance Partner',
  client: 'Client',
  staff: 'Command Centre',
};

/**
 * Deliberately loose. This decides whether to PRINT a value as somebody's
 * name, so the cost of a false positive is a role label with no name beside
 * it, and the cost of a false negative is an address on screen where a name
 * belongs. Erring towards the first is right.
 */
export function looksLikeEmailAddress(value: string): boolean {
  return /\S+@\S+/.test(value);
}

export interface SenderIdentity {
  /** Always present. */
  role: string;
  /** The person, when the record holds one that is not an address. */
  name: string | null;
}

export function senderIdentity(
  senderType: string | null | undefined,
  senderName: string | null | undefined,
): SenderIdentity {
  const type = (senderType ?? '') as MessageSenderType;
  const role = SENDER_ROLE_LABEL[type] ?? 'Participant';
  const trimmed = (senderName ?? '').trim();
  if (!trimmed || looksLikeEmailAddress(trimmed)) return { role, name: null };
  // A stored name that merely repeats the role adds nothing.
  if (trimmed.toLowerCase() === role.toLowerCase()) return { role, name: null };
  return { role, name: trimmed };
}

/** One line: the role, and the person when there is one. */
export function senderLabel(
  senderType: string | null | undefined,
  senderName: string | null | undefined,
): string {
  const { role, name } = senderIdentity(senderType, senderName);
  return name ? `${role} · ${name}` : role;
}

/**
 * The bubble, by who is speaking.
 *
 * Semantic tokens only, and only ones that stay distinct in dark mode —
 * `--info` is the single hue that does not collapse into the gold the rest of
 * the accent ramp becomes there. The client is tinted, the partner is left on
 * the neutral card, and the reader is told which is which in words above
 * either one.
 */
export const SENDER_BUBBLE_CLASS: Record<MessageSenderType, string> = {
  client: 'border-info/30 bg-info/[0.08] text-foreground',
  partner: 'border-border dark:border-white/10 bg-card dark:bg-background/95 text-foreground',
  staff: 'border-success/25 bg-success/[0.07] text-foreground',
};

export function bubbleClassFor(senderType: string | null | undefined): string {
  return SENDER_BUBBLE_CLASS[(senderType ?? '') as MessageSenderType]
    ?? SENDER_BUBBLE_CLASS.partner;
}
