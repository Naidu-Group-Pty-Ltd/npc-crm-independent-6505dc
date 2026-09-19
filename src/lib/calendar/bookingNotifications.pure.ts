/**
 * Who gets told about a booking, and who tells them.
 *
 * ## The defect this closes
 *
 * Two different systems emailed the two audiences, and neither knew about the
 * other. GoHighLevel emailed the CLIENT its own confirmation; this platform
 * emailed the additional contact and the finance partner. So the client alone
 * received no meeting notes, no call type and no Zoom link — reported as
 * "the client doesn't receive a zoom link… the client also doesn't receive
 * the notes whereas the additional contact and finance partner receives".
 *
 * The client was never a recipient here at all: the booking dialog carries a
 * CRM `contactId` and no email address, so there was nothing to send to even
 * if somebody had wanted to.
 *
 * ## The rule
 *
 * **The platform owns the client notification.** Everyone invited to a
 * booking is notified by one sender, from one template, with the same facts —
 * so a Zoom link cannot reach three people and miss the fourth.
 *
 * That makes the feature work with **no CRM at all**: a booking made against
 * a locally-held client is announced exactly as one made against a CRM
 * contact. The CRM becomes a source of contact details rather than a
 * dependency of the notification.
 *
 * ## Three rules that bite
 *
 * - **"Nobody" is never an answer for the client.** If a deployment says the
 *   CRM sends client confirmations but no CRM is linked, the platform sends
 *   anyway. A setting that silently means "the customer is told nothing" is
 *   the failure this module exists to prevent.
 * - **One person, one email.** The client is frequently also an additional
 *   contact; the finance partner is sometimes both. Recipients are collapsed
 *   by address, keeping the most specific role, so nobody is told twice.
 * - **A missing address is reported, never dropped.** An operator who cannot
 *   see that the client has no email on file will assume they were told.
 */

export type PartyRole = 'client' | 'additional_contact' | 'finance_partner';

/** Who sends the client's confirmation. */
export type ClientSender = 'platform' | 'crm';

export interface PartyInput {
  role: PartyRole;
  name?: string | null;
  email?: string | null;
  /** The finance-contact row this party came from, where there is one. */
  financeContactId?: string | null;
}

export interface PlannedRecipient {
  role: PartyRole;
  name: string;
  email: string;
  /**
   * The finance-contact row this recipient came from, or null.
   *
   * This used to be a required string, and where a party had no real id the
   * planner minted `party-<role>-<email>` to key the de-duplication map. That
   * synthetic key was then written straight into
   * `appointment_secondary_recipients.finance_contact_id`, a UUID column —
   * so every insert for a client or an additional contact was rejected, and
   * the ledger of who was invited held finance partners and nobody else.
   *
   * Three audit findings followed from that one column: a booking's detail
   * window listed no additional contact, a reschedule reached nobody but the
   * finance partner, and a cancellation did not either — because all three
   * read this ledger.
   *
   * De-duplication is a property of the PLAN and now has a key of its own
   * (`dedupeKey`). What goes in the column is a real id or nothing.
   */
  financeContactId: string | null;
  /**
   * Stable per-address key for "have we already planned to tell this person".
   * Never written to the database.
   */
  dedupeKey: string;
}

export interface BookingNotificationPlan {
  recipients: PlannedRecipient[];
  /** Who tells the client. `none` only when we have no address for them. */
  clientNotifiedBy: ClientSender | 'none';
  /** Operator-facing sentences. Never silent about somebody left out. */
  warnings: string[];
}

/** Most specific role wins when one address appears twice. */
const ROLE_RANK: Record<PartyRole, number> = {
  client: 3,
  finance_partner: 2,
  additional_contact: 1,
};

function normaliseEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function displayName(party: PartyInput, fallback: string): string {
  const name = (party.name ?? '').trim();
  return name || fallback;
}

export interface PlanInput {
  parties: PartyInput[];
  crm: {
    /** Is a CRM contact actually behind this booking? */
    linked: boolean;
    /** Does that CRM send the client its own confirmation? */
    sendsClientConfirmation: boolean;
  };
}

export function planBookingNotifications({ parties, crm }: PlanInput): BookingNotificationPlan {
  const warnings: string[] = [];

  // A party with no address cannot be emailed by anyone. Say so per role, once.
  const missing = new Set<PartyRole>();
  const addressable = parties.filter((p) => {
    if (normaliseEmail(p.email)) return true;
    missing.add(p.role);
    return false;
  });
  if (missing.has('client')) {
    warnings.push('No email address on file for the client — they will not be notified.');
  }
  if (missing.has('additional_contact')) {
    warnings.push('An additional contact has no email address and will not be notified.');
  }
  if (missing.has('finance_partner')) {
    warnings.push('A finance partner has no email address and will not be notified.');
  }

  // The client is ours to notify unless a CRM is BOTH linked and sending.
  // A setting that says "the CRM does it" cannot mean "nobody does it".
  const crmSendsToClient = crm.linked && crm.sendsClientConfirmation;
  if (!crm.linked && crm.sendsClientConfirmation) {
    warnings.push('No CRM is linked to this booking, so this workspace is sending the client\'s confirmation.');
  }

  const byEmail = new Map<string, PlannedRecipient>();
  for (const party of addressable) {
    if (party.role === 'client' && crmSendsToClient) continue;
    const email = normaliseEmail(party.email);
    const candidate: PlannedRecipient = {
      role: party.role,
      name: displayName(party, email),
      email,
      // Only a real finance-contact row. A stand-in here is a value the
      // database refuses, which is how three surfaces came to be told nothing.
      financeContactId: party.financeContactId?.trim() || null,
      // A stable key per address: the ledger of who was invited is read back
      // on reschedule and cancellation, and two rows for one person send two
      // notices.
      dedupeKey: party.financeContactId?.trim() || `party-${party.role}-${email}`,
    };
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, candidate);
      continue;
    }
    if (ROLE_RANK[candidate.role] > ROLE_RANK[existing.role]) {
      // The more specific role wins, but the key that already identified this
      // address stays — it is what a second pass would match on.
      byEmail.set(email, {
        ...candidate,
        financeContactId: candidate.financeContactId ?? existing.financeContactId,
        dedupeKey: existing.dedupeKey,
      });
    }
  }

  const recipients = [...byEmail.values()].sort(
    (a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.email.localeCompare(b.email),
  );

  const clientHasAddress = parties.some((p) => p.role === 'client' && normaliseEmail(p.email));
  const clientNotifiedBy: ClientSender | 'none' = !clientHasAddress
    ? 'none'
    : crmSendsToClient
      ? 'crm'
      : 'platform';

  return { recipients, clientNotifiedBy, warnings };
}

/** One line for the booking dialog, so the operator sees it before booking. */
export function describeNotificationPlan(plan: BookingNotificationPlan): string {
  const count = plan.recipients.length;
  if (count === 0) {
    return plan.clientNotifiedBy === 'crm'
      ? 'Your CRM will email the client. Nobody else will be notified.'
      : 'Nobody will be emailed about this booking.';
  }
  const people = `${count} ${count === 1 ? 'person' : 'people'}`;
  return plan.clientNotifiedBy === 'crm'
    ? `${people} will be emailed from here; your CRM emails the client separately.`
    : `${people} will be emailed from here, including the client.`;
}
