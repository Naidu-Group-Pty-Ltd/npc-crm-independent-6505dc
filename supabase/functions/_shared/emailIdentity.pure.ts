/**
 * Who a deployment's email is FROM: the organisation named in it, the address
 * it is sent from, where a reply goes, and which application its links open.
 *
 * Every Resend email this repository sends goes through here, except password
 * recovery (see the end of this header).
 *
 * ## Why this exists
 *
 * Measured 24 Sep 2026 across the four deployments of this repository. Every
 * clone's mail introduced it as somebody else, in four different ways, and
 * each was invisible from the clone that sent it:
 *
 *  1. **The name.** `getBrandConfig()` reads the organisation from
 *     `global_report_settings.contact_details`, and on three of the four
 *     clones (Preflight Property Group, NPC Test, NPC CRM Independent) that
 *     table is EMPTY. So every invite, notification and alert those clones
 *     sent came from "Property Consulting". Mission Control writes each
 *     clone's own name into its environment as `MISSION_CONTROL_AGENCY_NAME`
 *     when it provisions it. No email read it.
 *  2. **The links.** The finance and solicitor portal invites pinned their
 *     links to the prime's own `https://command-centre.npcservices.com.au`,
 *     "so preview URLs can never leak into an invite". On a clone that pin IS
 *     the leak: a finance partner or solicitor invited by one tenant was sent
 *     into a different tenant's application, where the token means nothing.
 *  3. **The sender.** The portal notifier and the AML step-up code sent from a
 *     literal `notifications@npcservices.com.au`, and the call-alert email
 *     sent FROM the contact address. A clone's Resend key is scoped to its own
 *     `send.<clone-fqdn>` domain, so Resend refused all three with a 403.
 *     Clients never received portal notifications, and nobody on a clone
 *     could receive a step-up code.
 *  4. **The contact.** `contactEmail` falls back to the prime's
 *     `admin@npcservices.com.au`, so a clone's footers and `List-Unsubscribe`
 *     named another business's mailbox.
 *
 * ## The rules
 *
 * - **The name is the tenant's, then the workspace's.** What the tenant set on
 *   its own Branding page and report settings wins. Where it has set nothing,
 *   the name Mission Control provisioned the workspace under is used. The
 *   generic word is used only when neither exists.
 * - **The address belongs to the key, and this module never chooses one.** It
 *   is handed `getBrandConfig().senderEmail`, the rule every other email
 *   already follows: `RESEND_FROM_EMAIL` first, because a domain-scoped key
 *   can send from nothing else. Two rules for one address is how two senders
 *   come to disagree.
 * - **Replies reach the tenant.** Mail sent from the address Mission Control
 *   provisioned leaves from a transport mailbox nobody reads. So `Reply-To` is
 *   the tenant's own contact address, where one is configured. That
 *   provisioned address is never offered as a contact.
 * - **A clone's links open the clone.** The origin is the one Mission Control
 *   provisioned (`PUBLIC_APP_URL`, `APP_URL`, `APP_BASE_URL`, the same value
 *   written three times). It is never one that belongs to the prime, and
 *   never a preview or a localhost. Where a clone has none, there is no link,
 *   because a link into another tenant's application is worse than none.
 * - **The prime keeps its own links.** Each call site passes the origin it
 *   always used, and on the prime that is what comes back. A deployment
 *   counts as the prime only when `SUPABASE_URL` is the prime's own project.
 *   Anything else, including a unit test and `supabase start`, is treated as
 *   a clone, so a prime literal can never be the default.
 *
 * ## What is deliberately not here
 *
 * **Password recovery.** The four forgot-password and admin-reset functions
 * keep using `getBrandConfig()` directly, as the owner asked, and
 * `brand-config.ts` is unchanged by this module. They already send from the
 * clone's own address, because that rule lives in brand-config.
 *
 * Pure: no Deno, no network. `emailIdentity.ts` reads the environment and the
 * two settings tables and hands the facts to `resolveEmailIdentity`.
 */

import { PRODUCTION_PROJECT_REF } from './aml/providerEnvironment.ts';

/** Used only when nothing names the organisation. The same word brand-config falls back to. */
export const UNNAMED_ORGANISATION = 'Property Consulting';

/**
 * The prime's application. Call sites pass it as the origin they always used;
 * `linkOrigin` returns it only on the prime.
 */
export const PRIME_APP_ORIGIN = 'https://command-centre.npcservices.com.au';

/**
 * Hosts that serve the prime. A clone's email may never link to one, even if
 * its environment names one: an inherited or copied `APP_URL` is exactly how
 * a cross-tenant link would arrive.
 */
const PRIME_HOSTS: ReadonlySet<string> = new Set([
  'command-centre.npcservices.com.au',
  'npc-property-dashbord.lovable.app',
]);

export type DeploymentKind = 'prime' | 'clone';

/**
 * Which deployment this is, from its own Supabase project.
 *
 * Positive identification only: an unreadable, missing or local URL is a
 * clone. The failure that matters is a prime literal reaching a tenant's
 * mail, and that is the only way to make it impossible by default.
 */
export function deploymentKind(supabaseUrl: string | null | undefined): DeploymentKind {
  try {
    const host = new URL(String(supabaseUrl ?? '')).hostname.toLowerCase();
    return host === `${PRODUCTION_PROJECT_REF}.supabase.co` ? 'prime' : 'clone';
  } catch {
    return 'clone';
  }
}

/** `global_report_settings.contact_details`, as far as mail reads it. */
export type ContactDetailsLike = {
  company_name?: unknown;
  email?: unknown;
  phone?: unknown;
  website?: unknown;
  address?: unknown;
};

/** `whitelabel_settings`, as far as mail reads it: the Branding page. */
export type WhitelabelLike = {
  company_name?: unknown;
  email_signature_email?: unknown;
  email_signature_phone?: unknown;
  email_signature_website?: unknown;
  email_signature_address?: unknown;
};

export type EmailIdentityFacts = {
  /** `SUPABASE_URL`: decides prime or clone. */
  supabaseUrl: string | null;
  /** `getBrandConfig().senderEmail`: the address this deployment's key may send from. */
  senderAddress: string;
  /** `RESEND_FROM_EMAIL` as brand-config parses it; null when unset or unparseable. */
  provisionedSender: string | null;
  /** `MISSION_CONTROL_AGENCY_NAME`: the name Mission Control provisioned the workspace under. */
  workspaceName: string | null;
  /** `PUBLIC_APP_URL`, `APP_URL`, `APP_BASE_URL`, in that order. */
  provisionedOrigins: ReadonlyArray<string | null | undefined>;
  contactDetails: ContactDetailsLike | null;
  whitelabel: WhitelabelLike | null;
};

export type EmailIdentity = {
  deployment: DeploymentKind;
  /** The organisation the mail comes from, as a reader sees it. */
  organisationName: string;
  /** Where the name came from, for logs and for tests. */
  organisationNameFrom: 'contact_details' | 'whitelabel' | 'workspace' | 'unnamed';
  /** The transport address. Never chosen here; see the header. */
  senderAddress: string;
  /** Set only when mail leaves from the provisioned mailbox and the tenant has a contact of its own. */
  replyTo: string | null;
  /** The tenant's own contact address for body copy. Never the provisioned mailbox, never a prime literal. */
  contactEmail: string | null;
  contactPhone: string | null;
  contactWebsite: string | null;
  contactAddress: string | null;
  /** The clone's own application origin. Null on the prime, whose origin each call site keeps. */
  cloneOrigin: string | null;
};

const ADDRESS = /^[^\s@<>"]+@[^\s@.<>"]+(\.[^\s@.<>"]+)+$/;

/** A configured string, trimmed; header-breaking whitespace folded to spaces. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return s || null;
}

/** A configured email address, or null when it is not one. */
function emailAddress(value: unknown): string | null {
  const s = text(value);
  return s && ADDRESS.test(s) ? s : null;
}

function same(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * The origin Mission Control provisioned for a clone: the first value that is
 * an absolute http(s) URL on a host that is not the prime's, not a preview and
 * not a localhost. Trailing slashes are dropped and any path is kept, because
 * every call site appends its own path to it.
 */
export function provisionedOrigin(values: ReadonlyArray<string | null | undefined>): string | null {
  for (const raw of values) {
    const s = text(raw);
    if (!s) continue;
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const host = url.hostname.toLowerCase();
    if (PRIME_HOSTS.has(host)) continue;
    // An email is never read on the machine that sent it, and a preview
    // deployment is gone by the time an invitation is opened.
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('preview--')) continue;
    return s.replace(/\/+$/, '');
  }
  return null;
}

/** Whether a URL is served by the prime. Exported for the contract tests. */
export function isPrimeOrigin(value: string | null | undefined): boolean {
  try {
    return PRIME_HOSTS.has(new URL(String(value ?? '')).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Decide the identity. See the header for the rules, in order. */
export function resolveEmailIdentity(facts: EmailIdentityFacts): EmailIdentity {
  const deployment = deploymentKind(facts.supabaseUrl);
  const contact = facts.contactDetails ?? {};
  const brand = facts.whitelabel ?? {};

  type Source = EmailIdentity['organisationNameFrom'];
  const named: Array<[Source, string | null]> = [
    ['contact_details', text(contact.company_name)],
    ['whitelabel', text(brand.company_name)],
    ['workspace', text(facts.workspaceName)],
  ];
  const found = named.find((entry): entry is [Source, string] => entry[1] !== null);
  const organisationNameFrom: Source = found ? found[0] : 'unnamed';
  const organisationName = found ? found[1] : UNNAMED_ORGANISATION;

  const senderAddress = facts.senderAddress.trim();
  const provisioned = emailAddress(facts.provisionedSender);

  // The provisioned mailbox is a transport address, not a contact. Mission
  // Control once copied it INTO `contact_details.email` to make a sender
  // work, so it is skipped wherever it turns up.
  const contactEmail =
    [emailAddress(contact.email), emailAddress(brand.email_signature_email)].find(
      (candidate) => candidate !== null && !same(candidate, provisioned),
    ) ?? null;

  const sendsFromProvisioned = same(senderAddress, provisioned);
  const replyTo =
    sendsFromProvisioned && contactEmail !== null && !same(contactEmail, senderAddress)
      ? contactEmail
      : null;

  return {
    deployment,
    organisationName,
    organisationNameFrom,
    senderAddress,
    replyTo,
    contactEmail,
    contactPhone: text(contact.phone) ?? text(brand.email_signature_phone),
    contactWebsite: text(contact.website) ?? text(brand.email_signature_website),
    contactAddress: text(contact.address) ?? text(brand.email_signature_address),
    cloneOrigin: deployment === 'clone' ? provisionedOrigin(facts.provisionedOrigins) : null,
  };
}

/**
 * The origin a link in this deployment's email must open.
 *
 * On the prime: `primeOrigin`, exactly as the call site always chose it. On a
 * clone: the provisioned origin, or null, and never `primeOrigin`.
 */
export function linkOrigin(
  identity: Pick<EmailIdentity, 'deployment' | 'cloneOrigin'>,
  primeOrigin: string | null | undefined,
): string | null {
  if (identity.deployment === 'prime') {
    const s = text(primeOrigin);
    return s ? s.replace(/\/+$/, '') : null;
  }
  return identity.cloneOrigin;
}

/**
 * `linkOrigin` for a caller with no identity to hand, such as a synchronous
 * link builder that reads its own environment.
 */
export function deploymentLinkOrigin(
  env: { supabaseUrl: string | null | undefined; provisionedOrigins: ReadonlyArray<string | null | undefined> },
  primeOrigin: string | null | undefined,
): string | null {
  const deployment = deploymentKind(env.supabaseUrl);
  return linkOrigin(
    { deployment, cloneOrigin: deployment === 'clone' ? provisionedOrigin(env.provisionedOrigins) : null },
    primeOrigin,
  );
}

/** Characters a display name may carry without quoting (RFC 5322 atext, plus space). */
const ATEXT = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/;

/**
 * `Name <address>`, safe to hand Resend.
 *
 * Control characters, angle brackets, quotes and backslashes are removed from
 * the name, so a configured name cannot inject a header or a second address.
 * A name carrying anything else outside atext, such as "Smith, Jones & Co." or
 * "Pty. Ltd.", is quoted, because unquoted it would be read as two addresses.
 */
export function formatMailbox(displayName: string, address: string): string {
  const name = displayName
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[<>"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return address;
  return ATEXT.test(name) ? `${name} <${address}>` : `"${name}" <${address}>`;
}

/**
 * The addressing half of a Resend payload: spread it into the body.
 *
 * `reply_to` is the snake-case field both the REST API and the v2 SDK take,
 * and it is absent rather than null when there is nothing to set. `qualifier`
 * names the mailbox's role after the organisation ("Admin", "Security",
 * "Call Alerts"), the way these emails always have.
 */
export function resendAddressing(
  identity: Pick<EmailIdentity, 'organisationName' | 'senderAddress' | 'replyTo'>,
  qualifier?: string,
): { from: string; reply_to?: string } {
  const name = qualifier ? `${identity.organisationName} ${qualifier}` : identity.organisationName;
  const addressing: { from: string; reply_to?: string } = {
    from: formatMailbox(name, identity.senderAddress),
  };
  if (identity.replyTo) addressing.reply_to = identity.replyTo;
  return addressing;
}

/** For interpolating a configured value into an HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
