/**
 * How a listing is written down.
 *
 * Every view — card, table row, map popup, property page — had its own idea of
 * what to render when a value was missing, and they disagreed: the card said
 * "Price on request", the table said "-", the popup said "Price undisclosed".
 * Worse, all three were answering a question nobody had actually asked, because
 * the projection was reading a column that did not exist and every price looked
 * missing.
 *
 * Now that the real columns are read, there is genuinely more to say — an agent
 * may have written "From $1,599,000" or "$430,000 - $450,000", which no single
 * number can express — so the decision of what to show belongs in one place.
 */
import type { PropertyListing } from '@/lib/airtable';

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

export function formatAud(amount: number | null | undefined): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  return AUD.format(amount);
}

export interface DisplayPrice {
  /** What to render. Never empty. */
  text: string;
  /** False when nothing was known and `text` is a placeholder. */
  known: boolean;
  /** True for a rental, so callers can style or label it differently. */
  isRent: boolean;
}

/**
 * The price line.
 *
 * Order matters. `Display Price Text` comes first because it is both the most
 * populated price signal on the table (1,023 of 1,441 records against 773 for
 * the numeric field) and the most faithful: "From $1,599,000" and "Offers above
 * $850,000" carry a meaning that formatting the number alone would throw away,
 * and quoting a single figure for a range the agent deliberately left open
 * misrepresents them.
 */
export function displayPrice(listing: PropertyListing): DisplayPrice {
  if (listing.priceDisplay) {
    return { text: listing.priceDisplay, known: true, isRent: listing.priceBasis === 'rent' };
  }

  if (listing.rentAmount) {
    const period = listing.rentPeriod ? ` / ${listing.rentPeriod.toLowerCase()}` : ' / week';
    const amount = formatAud(listing.rentAmount);
    if (amount) return { text: `${amount}${period}`, known: true, isRent: true };
  }

  const exact = formatAud(listing.price);
  if (exact) {
    // A quoted range renders as a range; `price` holds its midpoint for sorting
    // and must not be presented as though the agent named that figure.
    if (listing.priceMin && listing.priceMax && listing.priceMin !== listing.priceMax) {
      const low = formatAud(listing.priceMin);
      const high = formatAud(listing.priceMax);
      if (low && high) return { text: `${low} – ${high}`, known: true, isRent: false };
    }
    return { text: exact, known: true, isRent: false };
  }

  return { text: 'Price on request', known: false, isRent: false };
}

/** Land or floor area with its unit, or null. */
export function formatArea(sqm: number | null | undefined): string | null {
  if (typeof sqm !== 'number' || !Number.isFinite(sqm) || sqm <= 0) return null;
  if (sqm >= 10_000) return `${(sqm / 10_000).toFixed(2)} ha`;
  return `${Math.round(sqm).toLocaleString('en-AU')} m²`;
}

/**
 * Suburb, state and postcode as one line.
 *
 * Silently drops parts that did not survive reconciliation, so a record whose
 * postcode contradicted its state shows "Campbells Creek" rather than
 * "Campbells Creek, VIC 4171" — which would present a Queensland postcode as
 * though it were verified.
 */
export function formatLocality(listing: PropertyListing): string | null {
  const line = [listing.suburb, listing.state, listing.zipCode].filter(Boolean).join(' ').trim();
  return line || null;
}

/** A short, human explanation of a listing's data quality, or null when it is fine. */
export function qualityCaveat(listing: PropertyListing): string | null {
  if (listing.localityTrust === 'conflict') {
    return listing.localityConflicts?.[0] ?? 'State and postcode disagree';
  }
  if (listing.needsHumanReview && listing.errorType) return listing.errorType;
  return null;
}

/**
 * How long this listing has been with us, in the phrasing portals use.
 *
 * realestate.com.au leads every card with "Added 4 days ago", and it earns its
 * place: on a marketplace fed by a mailbox, the first question is always
 * whether a property is still live. It is the cheapest signal we have and the
 * only one that needs no enrichment at all.
 *
 * `listedAtKnown === false` marks a record whose date we invented rather than
 * read, so it gets no phrase — "Added today" on a month-old listing is worse
 * than saying nothing.
 */
export function listingFreshness(
  listing: PropertyListing,
  now: number = Date.now(),
): { label: string; isNew: boolean } | null {
  if (listing.listedAtKnown === false) return null;

  const raw =
    listing.receivedAt ?? listing.createdTime ?? listing.createdAt ?? listing.listingDate ?? null;
  if (!raw) return null;

  const at = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  if (!Number.isFinite(at)) return null;

  const days = Math.floor((now - at) / 86_400_000);
  // A future timestamp is a clock or a parse problem, not a listing that has
  // not happened yet. Say nothing rather than "Added in 3 days".
  if (days < 0) return null;

  const label =
    days === 0 ? 'Added today'
    : days === 1 ? 'Added yesterday'
    : days < 7 ? `Added ${days} days ago`
    : days < 14 ? 'Added last week'
    : days < 31 ? `Added ${Math.floor(days / 7)} weeks ago`
    : 'Added over a month ago';

  // Airtable prunes at 30 days, so "new" has to mean days, not weeks.
  return { label, isNew: days <= 3 };
}

export interface PhotoFreshness {
  /** Full phrasing for a tooltip: "Photos updated 3 days ago". */
  label: string;
  /** Captured within the last week. */
  isRecent: boolean;
  /** Where intake got the set, when it recorded that. */
  source: string | null;
}

/**
 * When this listing's photographs were last captured.
 *
 * A separate question from `listingFreshness`, and the answer is often
 * different: intake re-scrapes a listing page long after the record arrived, so
 * a property "added over a month ago" can have photographs taken yesterday. The
 * card was previously silent on this, which meant a set of photos had no way of
 * telling a reader whether it was current — the one thing that makes a
 * photograph worth trusting.
 *
 * Returns null when `Images Captured At` is empty. That column is only written
 * when a capture actually happens, so an absent value means "we do not know",
 * and inventing a date from the record's own timestamp would claim the photos
 * are as recent as the record when they may be a year older.
 */
export function photoFreshness(
  listing: PropertyListing,
  now: number = Date.now(),
): PhotoFreshness | null {
  const raw = listing.imagesCapturedAt;
  if (!raw) return null;

  const at = Date.parse(String(raw));
  if (!Number.isFinite(at)) return null;

  const days = Math.floor((now - at) / 86_400_000);
  if (days < 0) return null;

  const label =
    days === 0 ? 'Photos updated today'
    : days === 1 ? 'Photos updated yesterday'
    : days < 7 ? `Photos updated ${days} days ago`
    : days < 14 ? 'Photos updated last week'
    : days < 31 ? `Photos updated ${Math.floor(days / 7)} weeks ago`
    : days < 365 ? `Photos updated ${Math.floor(days / 30)} months ago`
    : 'Photos over a year old';

  return { label, isRecent: days <= 7, source: listing.imageSource ?? null };
}
