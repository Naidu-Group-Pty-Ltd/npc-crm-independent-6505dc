import { PropertyListing } from '@/lib/airtable';

/**
 * Extract Australian state abbreviation from an address string.
 */
export function extractAUState(address: string): string | null {
  const match = address.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Extract an Australian postcode from an address string.
 *
 * ## The first four-digit token is not the postcode
 *
 * This used to be `address.match(/\b(\d{4})\b/)` — the FIRST four-digit token
 * anywhere in the string. On builder stock the first token is the lot:
 * `Lot 2267 Hunza Road, Truganina, VIC 3029` parses `2267`, a real NSW
 * postcode, for a Victorian property. RF-7.2B.1B1 measured that over the
 * report corpus — 30 of 418 addresses parse the wrong token and 17 of those
 * land on a postcode that exists — and fixed it for the evidence a report
 * selects. The same parse was still selecting the marketplace's postcode
 * FILTER and the postcode shown on the Overview, which is the accuracy the
 * 19 Sep 2026 clone audit asked about.
 *
 * ## Where a postcode sits
 *
 * An Australian address ends `SUBURB STATE POSTCODE`. So:
 *
 *   1. after the last state token, take the first four-digit run — that is the
 *      postcode by position, whatever precedes it;
 *   2. with no state token, take the LAST four-digit run, and only if it is at
 *      the end of the string (a trailing country name is allowed), because a
 *      four-digit number in the middle of an address is a street or lot number;
 *   3. otherwise answer null.
 *
 * A guess is never returned. A caller with no postcode has a listing whose
 * address does not carry one, and that is a fact about the address.
 */
export function extractAUPostcode(address: string): string | null {
  const text = (address ?? '').trim();
  if (!text) return null;

  // 1. Positional: the first four-digit run after the last state token.
  const states = [...text.matchAll(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/gi)];
  if (states.length > 0) {
    const last = states[states.length - 1];
    const after = text.slice((last.index ?? 0) + last[0].length);
    const match = after.match(/\b(\d{4})\b/);
    if (match) return match[1];
  }

  // 2. Tail: the last four-digit run, if nothing but a country follows it.
  const all = [...text.matchAll(/\b(\d{4})\b/g)];
  if (all.length > 0) {
    const candidate = all[all.length - 1];
    const tail = text.slice((candidate.index ?? 0) + candidate[0].length);
    if (/^[\s,.]*(australia|aus)?[\s,.]*$/i.test(tail)) return candidate[1];
  }

  return null;
}

/**
 * @deprecated Use {@link extractAUPostcode}. Kept only for the legacy
 * first-token behaviour where a caller has not yet been reviewed; every caller
 * in `src/` now uses the positional reading.
 */
export function extractPostcode(address: string): string | null {
  return extractAUPostcode(address);
}

/**
 * Build a full formatted address: "Street, Suburb, STATE Postcode"
 */
export function buildFullAddress(listing: PropertyListing): string {
  const parts: string[] = [];
  if (listing.address && listing.address !== 'Unknown Address') parts.push(listing.address);
  if (listing.suburb && listing.suburb !== 'Unknown' && listing.suburb !== 'Unknown Suburb') parts.push(listing.suburb);

  const stateStr = listing.state || extractAUState(listing.address || '');
  const postcodeStr = listing.zipCode || extractPostcode(listing.address || '');
  if (stateStr || postcodeStr) {
    parts.push([stateStr, postcodeStr].filter(Boolean).join(' '));
  }

  return parts.join(', ') || listing.address || '';
}
