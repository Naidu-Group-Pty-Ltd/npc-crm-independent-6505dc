/**
 * Whether a listing's stored link is a link, and what to open when it is.
 *
 * ## Why this exists
 *
 * "View Listing", "View Source" and "Open source listing" were drawn whenever
 * the field held any non-empty string, and clicking them called
 * `window.open(value)` on it. Both halves are wrong when the value is not a
 * URL, which is the ordinary case for a field an email extractor fills:
 *
 *  - `window.open('gattonrealestate.com.au/listings/…')` has no scheme, so the
 *    browser resolves it RELATIVE to the command centre's own origin. A tab
 *    opens on a path this app does not serve and the reader sees nothing they
 *    can use. That is the 19 Sep 2026 clone audit's "it doesn't open anything
 *    or take me anywhere", reported against all three controls.
 *  - a value that could never open at all still drew a button, and a control
 *    that cannot do anything is worse than no control — the same rule the
 *    AUSTRAC path card already answers to.
 *
 * ## The rules
 *
 * **A control is drawn only where a link resolves.** `resolveListingUrl`
 * answers null for anything it cannot open, and the caller renders nothing.
 *
 * **A bare host is completed, never guessed at.** `www.example.com/x` and
 * `example.com/x` become `https://…`; a string with a space in it, or with no
 * dot in its first segment, is not a host and is refused rather than turned
 * into one.
 *
 * **Only http and https.** These values arrive from a mailbox by way of an
 * extraction model, and `javascript:` and `data:` are navigation targets in
 * some engines. Refusing every other scheme is what makes it safe to hand one
 * of these strings to `window.open` at all.
 */

/** Schemes a listing link may use. Everything else is refused. */
const OPENABLE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * The absolute `https`/`http` URL this value names, or null.
 *
 * Null means "there is no link here", and the caller must draw no control.
 */
export function resolveListingUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A link has no whitespace in it. An extractor that wrote a sentence into
  // this field has not written a link.
  if (/\s/.test(trimmed)) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (!OPENABLE_PROTOCOLS.has(parsed.protocol)) return null;
  // `https://listings` is not a host anyone can reach. A dot is the cheapest
  // test that separates a domain from a word somebody typed.
  if (!parsed.hostname.includes('.')) return null;

  return parsed.toString();
}

/** True when this value names a link a control could open. */
export function hasListingUrl(raw: unknown): boolean {
  return resolveListingUrl(raw) !== null;
}

/**
 * Open a listing's link in a new tab, if it is one.
 *
 * Returns whether anything was opened, so a caller can say something rather
 * than appearing to do nothing.
 */
export function openListingUrl(raw: unknown): boolean {
  const url = resolveListingUrl(raw);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
