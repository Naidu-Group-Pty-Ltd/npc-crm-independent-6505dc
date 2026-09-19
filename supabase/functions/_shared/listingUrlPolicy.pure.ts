/**
 * Which listing URLs are worth following, and what they turn out to be.
 *
 * The links on these records are not clean listing pages. Of 94 sampled, 63 go
 * straight to a property page, 25 are email-tracking redirects
 * (`u80386.ct.sendgrid.net/ls/click?upn=…`, `socketlabs.vaultre.com.au/?ref=…`,
 * `t.apemail.net`), 4 are an agency homepage and one is a search results page.
 * The tracking ones are worth following — one resolved in a single hop to
 * `greatoceanproperties.com.au/8300588`, a real listing — but they cannot be
 * told apart from the destination by looking at them, so the classification
 * exists to decide how much to spend on each.
 *
 * Note this is deliberately *not* `scrape-property-listing/urlPolicy.ts`. That
 * module guards a paid Perplexity call and allows eight known portals; widening
 * it to admit every agency CRM in the country would widen what can be billed.
 * This is a plain GET for `og:` tags and gallery markup, so it can be permissive
 * about hosts while staying strict about network safety.
 *
 * Pure: no Deno, Supabase, network, DOM or clock.
 */

export type UrlKind = 'listing' | 'tracking' | 'homepage' | 'search' | 'unusable';

/** Hosts that only ever redirect. Worth following, never worth scraping. */
const TRACKING_HOSTS = [
  'ct.sendgrid.net',
  'sendgrid.net',
  'socketlabs',
  'apemail.net',
  'hubspotlinks',
  'hubspotlinksstarter',
  'mailchimp',
  'list-manage.com',
  'campaign-archive',
  'mandrillapp',
  'sparkpostmail',
  'clicks.',
  '/ls/click',
  'awstrack.me',
  'mailgun',
  'postmarkapp',
  'exacttarget',
  'trk.',
];

/**
 * Never fetched.
 *
 * Loopback, the private ranges and the link-local block are the SSRF surface — a
 * URL arriving from an agent's email is caller-supplied data, and this is the
 * first gate in front of a server-side fetch. `assertPublicUrl` does the real
 * DNS-level check; this rejects the obvious cases before a lookup is spent on
 * them.
 *
 * `169.254.0.0/16` matters most: `169.254.169.254` is the cloud instance
 * metadata endpoint, and a redirect to it is the classic way to turn a
 * server-side fetcher into a credential leak.
 *
 * Each alternative is anchored deliberately. An earlier version ended the whole
 * group with `$`, which meant the prefixes could only match a hostname that was
 * *exactly* `127.` — so every address they were written to stop sailed straight
 * through. The tests below cover each one.
 */
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?(?:fc|fd)[0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i,
  /\.localhost$/i,
];

/**
 * Exported on its own because callers outside `assertAcceptableUrl` need the
 * same answer — the bulk image seeder steps through redirects manually and
 * must re-check every hop against the identical ranges.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

const NON_PAGE_EXTENSION = /\.(?:pdf|zip|docx?|xlsx?|pptx?|csv|jpe?g|png|gif|webp|svg|mp4|mov|css|js|ico)$/i;

export interface ClassifiedUrl {
  url: string;
  kind: UrlKind;
  /** Why, for the provenance panel and the logs. */
  reason: string;
}

/**
 * What a URL is, without fetching it.
 *
 * A tracking link is classified by host rather than by shape because its path
 * is opaque by design — the whole point of `?upn=u001.XPFC4-2B2d…` is that it
 * carries no information the recipient can read.
 */
export function classifyListingUrl(raw: unknown): ClassifiedUrl {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { url: '', kind: 'unusable', reason: 'no url' };
  }
  const trimmed = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: trimmed, kind: 'unusable', reason: 'not a url' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { url: trimmed, kind: 'unusable', reason: `unsupported scheme ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) {
    return { url: trimmed, kind: 'unusable', reason: 'url carries credentials' };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { url: trimmed, kind: 'unusable', reason: 'non-public host' };
  }
  if (NON_PAGE_EXTENSION.test(parsed.pathname)) {
    return { url: trimmed, kind: 'unusable', reason: 'not an html page' };
  }

  const haystack = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  if (TRACKING_HOSTS.some((host) => haystack.includes(host))) {
    return { url: trimmed, kind: 'tracking', reason: 'email tracking redirect' };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { url: trimmed, kind: 'homepage', reason: 'site root, no listing' };
  }
  if (/^(?:buy|rent|sold|search|listings|properties|for-sale)$/i.test(segments[segments.length - 1])) {
    return { url: trimmed, kind: 'search', reason: 'index page, not one listing' };
  }
  // A property page is a deep path, and usually says so.
  if (segments.length >= 2 || /property|listing|for-sale|real-estate|\d{4,}/i.test(parsed.pathname)) {
    return { url: trimmed, kind: 'listing', reason: 'looks like a property page' };
  }
  return { url: trimmed, kind: 'homepage', reason: 'shallow path' };
}

/**
 * The links to try, best first.
 *
 * `Web Link` is more populated than `Source Web Link` (880 records against 676)
 * so it leads, but either can be the tracking one, so both are classified and
 * ranked rather than assumed.
 */
export function rankListingUrls(candidates: Array<string | null | undefined>): ClassifiedUrl[] {
  const order: Record<UrlKind, number> = {
    listing: 0,
    tracking: 1,
    search: 2,
    homepage: 3,
    unusable: 4,
  };
  const seen = new Set<string>();
  const ranked: ClassifiedUrl[] = [];
  for (const candidate of candidates) {
    const classified = classifyListingUrl(candidate);
    if (classified.kind === 'unusable') continue;
    if (seen.has(classified.url)) continue;
    seen.add(classified.url);
    ranked.push(classified);
  }
  return ranked.sort((a, b) => order[a.kind] - order[b.kind]);
}

/**
 * Whether a redirect hop may be followed.
 *
 * Checked on **every** hop, not just the first. A tracking service is an open
 * redirector by definition, so the only URL that was ever validated is the one
 * we started with; without re-checking, a crafted link could bounce a
 * server-side fetch into the private network.
 */
export function mayFollow(location: string, base: string): { ok: boolean; url?: string; reason?: string } {
  let next: URL;
  try {
    next = new URL(location, base);
  } catch {
    return { ok: false, reason: 'unparseable redirect target' };
  }
  const classified = classifyListingUrl(next.toString());
  if (classified.kind === 'unusable') return { ok: false, reason: classified.reason };
  return { ok: true, url: next.toString() };
}

/** Redirect hops allowed before giving up. Real chains observed are 1–2. */
export const MAX_REDIRECT_HOPS = 5;
