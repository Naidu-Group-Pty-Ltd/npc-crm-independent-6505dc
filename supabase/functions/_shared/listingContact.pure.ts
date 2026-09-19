/**
 * Who to contact about a listing, and how confident we are that it is them.
 *
 * The intake table spreads contact details across five columns and fills none
 * of them reliably. Measured across all 1,441 records:
 *
 *   Agent Email    416      Agent Mobile   ~440
 *   Agency Email   314      Agent Phone    rarely
 *   Sender Email   361
 *   ─────────────────────────────────────────────
 *   any email      451 (31%)   any phone   480 (33%)
 *
 * `Sender Email` is the interesting one. It is not an "agent" field at all — it
 * is whoever sent the marketing email to property@ — but for a listing that
 * arrived as an agent's own broadcast, the sender *is* the agent. Treating it as
 * a last-resort fallback is what makes the contact action available on a third
 * of the corpus rather than a quarter, and it is why every resolved address
 * carries the field it came from: emailing "the agent" at an address we inferred
 * from an envelope is a different claim from emailing the address they published,
 * and the person about to press send deserves to know which one it is.
 *
 * That premise — "the sender is the agent" — holds only while agents mail
 * property@ directly, and intake stopped working that way. Listings now arrive
 * *forwarded* by NPC's own people from their personal mailboxes, so the envelope
 * carries the forwarder rather than the agency: every one of the 51 records the
 * rebuilt intake scenario wrote on 2026-08-04 has an NPC operator in
 * `Sender Email`. With `Agent Email` and `Agency Email` empty — which is the
 * common case — the fallback resolved "the agent" to the colleague who forwarded
 * the mail, and the compose dialog offered to send an enquiry to him about his
 * own forward. `isIntakeOperatorEmail` is why that cannot happen again: an
 * address on our side of the pipeline is never the answer to "who do I ask about
 * this property", whichever column it arrives in.
 *
 * Pure: no Deno, Supabase, network, DOM or clock.
 */

import { INTAKE_FIELDS as F } from './airtableIntakeFields.pure.ts';

/** Which column an address or number came from, in descending directness. */
export type ContactSource = 'agent' | 'agency' | 'sender' | 'enriched';

export interface ResolvedContact {
  email: string | null;
  emailSource: ContactSource | null;
  phone: string | null;
  phoneSource: ContactSource | null;
  name: string | null;
  agency: string | null;
  /** True when the address is the agent's own published one. */
  direct: boolean;
}

/**
 * Addresses that exist to receive nothing.
 *
 * Sending an enquiry to `noreply@` is worse than not offering the action: the
 * user believes they have contacted the agent and no one has.
 */
const UNREACHABLE = /(^|[._-])(noreply|no-reply|donotreply|do-not-reply|bounce[sd]?|mailer-daemon|postmaster|unsubscribe|notifications?|alerts?|automated|system)([._-]|@)/i;

/** Bulk-send infrastructure, which is never a person. */
const BULK_SENDER_HOSTS = [
  'sendgrid.net',
  'mailchimp',
  'mailchimpapp.net',
  'sparkpostmail',
  'mandrillapp',
  'amazonses.com',
  'mailgun',
  'postmarkapp',
  'socketlabs',
  'apemail.net',
  'campaign-archive',
  'hubspot',
  'exacttarget',
  'rsgsv.net',
  'mcsv.net',
  // Portal broadcast infrastructure. A saved-search alert forwarded in from
  // realcommercial resolves to `email@campaign.realcommercial.com.au` — which is
  // genuinely who sent it, and is the portal's own mail platform rather than the
  // agency marketing the property. `email@` slips past UNREACHABLE, so it has to
  // be named here.
  'campaign.realcommercial.com.au',
  'campaign.realestate.com.au',
  'reastatic.net',
];

/**
 * NPC's own side of the pipeline: the intake mailbox, the company domain, and
 * the personal mailboxes staff forward listing mail in from.
 *
 * These are not agency addresses under any circumstances, so they disqualify a
 * candidate in *every* column rather than only in `Sender Email` — a model that
 * reads a forwarded chain and reports the forwarder as `agent_email` is making
 * the same mistake one field to the left, and it should fail the same way.
 *
 * Add a mailbox here when someone new starts forwarding into intake; leaving one
 * out is silent, and the symptom is their name appearing as the agent.
 */
const INTAKE_OPERATOR_DOMAINS = ['npcservices.com.au'];
const INTAKE_OPERATOR_ADDRESSES = ['lavankenobi@gmail.com', 'naidu.rugesh@gmail.com'];

const EMAIL_SHAPE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** True when the address belongs to NPC rather than to an agency. */
export function isIntakeOperatorEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const email = value.trim().toLowerCase();
  if (!email) return false;
  if (INTAKE_OPERATOR_ADDRESSES.includes(email)) return true;
  const host = email.slice(email.indexOf('@') + 1);
  return INTAKE_OPERATOR_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** A usable, human-reachable address, or null. */
export function cleanContactEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || !EMAIL_SHAPE.test(email)) return null;
  if (UNREACHABLE.test(email)) return null;
  // Ours, not theirs — see INTAKE_OPERATOR_DOMAINS.
  if (isIntakeOperatorEmail(email)) return null;

  const host = email.slice(email.indexOf('@') + 1);
  // A listing relayed through a bulk sender carries that sender's envelope
  // address, which reaches the mail platform rather than the agency.
  if (BULK_SENDER_HOSTS.some((bulk) => host.includes(bulk))) return null;
  return email;
}

/** An Australian phone number in a dialable form, or null. */
export function cleanContactPhone(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const digits = String(value).replace(/[^\d+]/g, '');
  if (!digits) return null;

  const national = digits.replace(/^\+?61/, '0').replace(/\D/g, '');
  if (national.length === 10 && national.startsWith('04')) {
    return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
  }
  if (national.length === 10 && national.startsWith('0')) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 6)} ${national.slice(6)}`;
  }
  // 1300/1800 and other service numbers.
  if (national.length === 10 && /^1[38]00/.test(national)) return national;
  if (national.length >= 8 && national.length <= 11) return national;
  return null;
}

/**
 * A listing-shaped subset, so this works against either a projected listing or
 * the raw Airtable fields.
 */
export interface ContactInput {
  agentEmail?: unknown;
  agencyEmail?: unknown;
  senderEmail?: unknown;
  agentMobile?: unknown;
  agentPhone?: unknown;
  agencyPhone?: unknown;
  agentName?: unknown;
  senderName?: unknown;
  agencyName?: unknown;
}

/**
 * Picks the best contact available, and says where it came from.
 *
 * Order is deliberate. The agent's published address beats the agency's general
 * inbox, which beats the envelope the listing arrived in — each step is one
 * remove further from the person who can answer a question about this property.
 */
export function resolveContact(input: ContactInput): ResolvedContact {
  const candidates: Array<[ContactSource, unknown]> = [
    ['agent', input.agentEmail],
    ['agency', input.agencyEmail],
    ['sender', input.senderEmail],
  ];

  let email: string | null = null;
  let emailSource: ContactSource | null = null;
  for (const [source, raw] of candidates) {
    const cleaned = cleanContactEmail(raw);
    if (cleaned) {
      email = cleaned;
      emailSource = source;
      break;
    }
  }

  const phoneCandidates: Array<[ContactSource, unknown]> = [
    ['agent', input.agentMobile],
    ['agent', input.agentPhone],
    ['agency', input.agencyPhone],
  ];
  let phone: string | null = null;
  let phoneSource: ContactSource | null = null;
  for (const [source, raw] of phoneCandidates) {
    const cleaned = cleanContactPhone(raw);
    if (cleaned) {
      phone = cleaned;
      phoneSource = source;
      break;
    }
  }

  const name =
    text(input.agentName) ??
    // Only when the address itself came from the envelope — otherwise the
    // sender's name would be attached to the agency's general inbox.
    (emailSource === 'sender' ? text(input.senderName) : null);

  return {
    email,
    emailSource,
    phone,
    phoneSource,
    name,
    agency: text(input.agencyName),
    direct: emailSource === 'agent',
  };
}

/** Reads the contact straight out of an Airtable `fields` object. */
export function resolveContactFromFields(fields: Record<string, unknown>): ResolvedContact {
  return resolveContact({
    agentEmail: fields[F.agentEmail],
    agencyEmail: fields[F.agencyEmail],
    senderEmail: fields[F.senderEmail],
    agentMobile: fields[F.agentMobile],
    agentPhone: fields[F.agentPhone],
    agencyPhone: fields[F.agencyPhone],
    agentName: fields[F.agentName],
    senderName: fields[F.senderName],
    agencyName: fields[F.agencyName],
  });
}

/** How to describe an inferred address to the person about to email it. */
export function describeContactSource(source: ContactSource | null): string | null {
  switch (source) {
    case 'agent':
      return null; // The expected case needs no explanation.
    case 'agency':
      return 'Agency inbox — the listing did not include a direct address for the agent.';
    case 'sender':
      return 'Taken from the address this listing was emailed from, which is usually the agent.';
    case 'enriched':
      return 'Found on the agency’s listing page rather than in the original email.';
    default:
      return null;
  }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /^unknown$/i.test(trimmed)) return null;
  return trimmed;
}
