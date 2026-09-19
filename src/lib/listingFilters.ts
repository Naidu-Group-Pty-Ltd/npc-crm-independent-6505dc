/**
 * The Listings page filter model.
 *
 * Extracted from `Listings.tsx` for two reasons. The predicate is the one piece
 * of that page whose behaviour is worth asserting — "does a listing with no
 * bedroom count survive a 3-bed minimum" is a real question with a real answer,
 * and it was previously buried in a 90-line inline `.filter()`. And the same
 * predicate now has to serve list, table and map identically; a second copy
 * would be how the map quietly starts disagreeing with the table.
 *
 * Pure: no React, no Supabase, no DOM.
 */
import type { PropertyListing } from '@/lib/airtable';
import { normaliseImageCandidates } from '@/lib/listingImages';
import { listingTimestamp, toFiniteNumber, isPlottable } from '@/lib/listingsMap';

export interface ListingFilterState {
  propertyType: string;
  suburb: string;
  state: string;
  zipCode: string;
  sourceHost: string;
  hasInspection: boolean;
  lowConfidence: boolean;
  offMarket: boolean;
  priceMin: string;
  priceMax: string;
  bedsMin: string;
  bedsMax: string;
  bathsMin: string;
  bathsMax: string;
  carsMin: string;
  carsMax: string;
  agencyName: string;
  keywordSearch: string;
  includeNearbySuburbs: boolean;

  /* --- Added dimensions ------------------------------------------------- */

  /** `'all'`, or a day count: only listings first seen inside that window. */
  listedWithinDays: string;
  /** Land size bounds in square metres. */
  landSizeMin: string;
  landSizeMax: string;
  /** Exact `status` value, or `'all'`. */
  status: string;
  /** Only listings with at least one photo on record. */
  hasPhotos: boolean;
  /** Only listings that can actually be placed on the map. */
  mappableOnly: boolean;
  /**
   * Whether a price range should also admit listings with no price.
   *
   * Off by default, and the reason is a behaviour change: the old predicate
   * dropped unpriced listings from *any* price range, with no way to ask for
   * them back. Making it explicit means "$1M–$2M" can still be told apart from
   * "$1M–$2M, plus anything undisclosed".
   */
  includeUndisclosedPrice: boolean;

  /* --- Dimensions unlocked by reading the real columns ------------------ */

  /**
   * `Intent` — Sale, Rent, Lease. Now filterable because the column is read at
   * all: the projection previously had no notion of a rental, so a weekly rent
   * and a purchase price sat in the same field.
   */
  intent: string;
  /** `Sector` — Residential, Commercial, Industrial, Rural, Land. */
  sector: string;
  /** `Package Type` — House & Land, Build Only, and so on. */
  packageType: string;
  /** `Source Type` — how the listing reached us. */
  sourceType: string;
  /**
   * Minimum `Overall Data Quality Score`, as a percentage string.
   *
   * Newly meaningful. The six confidence columns are populated on 1,440 of
   * 1,441 records and were read by nothing, so every listing scored 0% and any
   * confidence filter was either a no-op or hid everything.
   */
  minQuality: string;
  /** Only listings the pipeline flagged for a human to look at. */
  needsReview: boolean;
  /** Only listings whose state and postcode contradict each other. */
  localityConflict: boolean;
}

export const DEFAULT_LISTING_FILTERS: ListingFilterState = {
  propertyType: 'all',
  suburb: 'all',
  state: 'all',
  zipCode: 'all',
  sourceHost: 'all',
  hasInspection: false,
  lowConfidence: false,
  offMarket: false,
  priceMin: '',
  priceMax: '',
  bedsMin: '',
  bedsMax: '',
  bathsMin: '',
  bathsMax: '',
  carsMin: '',
  carsMax: '',
  agencyName: 'all',
  keywordSearch: '',
  includeNearbySuburbs: false,
  listedWithinDays: 'all',
  landSizeMin: '',
  landSizeMax: '',
  status: 'all',
  hasPhotos: false,
  mappableOnly: false,
  includeUndisclosedPrice: false,
  intent: 'all',
  sector: 'all',
  packageType: 'all',
  sourceType: 'all',
  minQuality: '',
  needsReview: false,
  localityConflict: false,
};

export const LISTED_WITHIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
];

/* -------------------------------------------------------------------------- */
/* Value parsing                                                               */
/* -------------------------------------------------------------------------- */

const SQM_PER_HECTARE = 10_000;
const SQM_PER_ACRE = 4046.86;

/**
 * Land size as square metres.
 *
 * The field is free text from the source: `650`, `"650 m2"`, `"650m²"`,
 * `"0.25 ha"`, `"1.2 acres"`, `"1,012 sqm"`. Anything that cannot be read as an
 * area returns null, and a null is never silently treated as zero — a listing
 * with an unparseable size must not be filtered out as "too small".
 */
export function parseLandSizeSqm(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;

  const text = value.trim().toLowerCase();
  if (!text) return null;

  const match = text.match(/(\d[\d,\s]*(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(/[,\s]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (/\bh(a|ectare)/.test(text)) return amount * SQM_PER_HECTARE;
  if (/\bac(re)?/.test(text)) return amount * SQM_PER_ACRE;
  return amount;
}

/** Numeric filter bound, or null when the field is blank/unusable. */
function bound(value: string): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const n = Number(value.replace(/[,\s$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** A count that is actually on record. Zero is a real answer; null and 0 are not. */
function positiveCount(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n !== null && n > 0 ? n : null;
}

/* -------------------------------------------------------------------------- */
/* Predicate                                                                   */
/* -------------------------------------------------------------------------- */

export interface FilterContext {
  /** Free-text query from the page's search box. */
  searchQuery?: string;
  /** Suburbs to accept when `includeNearbySuburbs` is on. */
  nearbySuburbs?: string[] | null;
  /** Resolves a listing's state when the field is empty. */
  extractState?: (address: string) => string | undefined;
  /** Resolves a listing's postcode when the field is empty. */
  extractPostcode?: (address: string) => string | undefined;
  /** Evaluation time, so "last 7 days" is testable. */
  now?: number;
  /**
   * Listing id → whether resolved photos exist, from `useListingImages`.
   *
   * Needed because a listing's own `images` field is not where photos live. The
   * Airtable attachment columns are empty on all 1,441 records; what a listing
   * actually has is whatever the image library harvested and stored for it. A
   * predicate reading `listing.images` was therefore permanently false, which
   * turned the "Has photos" switch into a "show nothing" switch.
   */
  hasImagesById?: ReadonlySet<string> | null;
  /**
   * Listing id → whether a coordinate was resolved, from `useListingCoordinates`.
   *
   * Same shape of bug: `Latitude`/`Longitude` are empty on every record, so
   * "Mappable only" hid everything. Coordinates come from geocoding at read
   * time, not from the source record.
   */
  mappableById?: ReadonlySet<string> | null;
}

/**
 * Whether a range bound should reject a listing whose value is unknown.
 *
 * It should. A minimum is a requirement — "at least 3 bedrooms" cannot be
 * satisfied by a record that does not say how many bedrooms it has, and the old
 * predicate's `listing.beds && …` guard let every such record through every
 * minimum. That made "3+ beds" quietly mean "3+ beds, or no idea".
 */
function withinRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

/**
 * Whether a listing has a photo anyone could actually see.
 *
 * `resolved` is the set of ids the image library has stored bytes for, and it is
 * the authority. The record's own `images` field is only a *source candidate*
 * list — a fetch instruction, not storage — and on this dataset it is empty for
 * every record, so a predicate that consulted it alone answered "no photos" for
 * the entire table.
 *
 * When no resolved set has been supplied (a caller that does not run the image
 * hook, or a pass that has not finished), fall back to candidates rather than
 * asserting there are none: an optimistic answer keeps a listing visible, and a
 * filter that hides everything is the worse failure.
 */
/**
 * A categorical match, case-insensitively, with `'all'` meaning no constraint.
 *
 * A listing with no value for the dimension is excluded once a specific value is
 * asked for — the same rule `withinRange` applies to numbers. "Show me the
 * rentals" cannot be satisfied by a record that does not say.
 */
function matchesCategory(value: string | null | undefined, filter: string): boolean {
  if (!filter || filter === 'all') return true;
  if (!value) return false;
  return value.toLowerCase() === filter.toLowerCase();
}

export function listingHasPhotos(
  listing: PropertyListing,
  resolved?: ReadonlySet<string> | null,
): boolean {
  if (resolved) return resolved.has(listing.id);
  // The fallback, used before the image library has answered. It has to read
  // the same sources the projection does: reading the attachment column alone
  // answered "no" for every record, because photographs arrive as links in
  // `Listing Image URLs`, not as attachments.
  if (Array.isArray(listing.imageCandidates)) return listing.imageCandidates.length > 0;
  return normaliseImageCandidates(listing.images).length > 0;
}

/**
 * Whether a listing can be placed on the map.
 *
 * Coordinates on the record would settle it, but `Latitude`/`Longitude` are
 * empty on all 1,441 records — they are resolved by geocoding at read time. So
 * the question this can honestly answer without a resolved set is "is there
 * enough of an address to geocode", which is what the map itself acts on.
 * Answering "no" for everything, as the old predicate did, made the switch hide
 * the entire table.
 */
export function listingIsMappable(
  listing: PropertyListing,
  resolved?: ReadonlySet<string> | null,
): boolean {
  if (isPlottable(toFiniteNumber(listing.latitude), toFiniteNumber(listing.longitude))) return true;
  if (resolved) return resolved.has(listing.id);
  return Boolean(listing.address?.trim() || listing.suburb?.trim());
}

export function matchesListingFilters(
  listing: PropertyListing,
  filters: ListingFilterState,
  context: FilterContext = {},
): boolean {
  const {
    searchQuery,
    nearbySuburbs,
    extractState,
    extractPostcode,
    now = Date.now(),
    hasImagesById,
    mappableById,
  } = context;

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    const haystack = [listing.address, listing.suburb, listing.agencyName, listing.agentName]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.keywordSearch) {
    const keywords = filters.keywordSearch.toLowerCase().split(/[,\s]+/).filter(Boolean);
    const content = [
      listing.summary,
      listing.rawExtract,
      listing.keyEntities,
      listing.description,
      listing.address,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!keywords.every((keyword) => content.includes(keyword))) return false;
  }

  if (filters.propertyType !== 'all' && listing.propertyType !== filters.propertyType) return false;

  if (filters.suburb && filters.suburb !== 'all') {
    if (filters.includeNearbySuburbs && nearbySuburbs) {
      if (!listing.suburb || !nearbySuburbs.includes(listing.suburb)) return false;
    } else if (listing.suburb !== filters.suburb) {
      return false;
    }
  }

  if (filters.state && filters.state !== 'all') {
    const state = listing.state || extractState?.(listing.address || '');
    if (state !== filters.state) return false;
  }

  if (filters.zipCode && filters.zipCode !== 'all') {
    const postcode = listing.zipCode || extractPostcode?.(listing.address || '');
    if (postcode !== filters.zipCode) return false;
  }

  if (filters.sourceHost !== 'all' && listing.sourceHost !== filters.sourceHost) return false;
  if (filters.agencyName !== 'all' && listing.agencyName !== filters.agencyName) return false;

  if (filters.status && filters.status !== 'all') {
    if ((listing.status || '').toLowerCase() !== filters.status.toLowerCase()) return false;
  }

  if (filters.hasInspection && !listing.inspectionStart) return false;

  if (filters.lowConfidence && (listing.confidence === undefined || listing.confidence === null || listing.confidence >= 0.7)) {
    return false;
  }

  if (filters.offMarket) {
    const marker = `${listing.status || ''} ${listing.category || ''}`.toLowerCase();
    if (!marker.includes('off-market') && !marker.includes('off market')) return false;
  }

  if (filters.hasPhotos && !listingHasPhotos(listing, hasImagesById)) return false;
  if (filters.mappableOnly && !listingIsMappable(listing, mappableById)) return false;

  // Categorical dimensions that only became filterable once the projection
  // started reading the columns they live in.
  if (!matchesCategory(listing.intent, filters.intent)) return false;
  if (!matchesCategory(listing.sector, filters.sector)) return false;
  if (!matchesCategory(listing.packageType, filters.packageType)) return false;
  if (!matchesCategory(listing.sourceType, filters.sourceType)) return false;

  if (filters.needsReview && !listing.needsHumanReview) return false;
  if (filters.localityConflict && listing.localityTrust !== 'conflict') return false;

  const minQuality = bound(filters.minQuality);
  if (minQuality !== null) {
    // Expressed as a percentage in the UI because a 0–1 float is not a thing
    // anyone types into a filter box.
    const quality = listing.confidences?.overall ?? listing.confidence;
    if (quality === null || quality === undefined) return false;
    if (quality * 100 < minQuality) return false;
  }

  // Price. An unpriced listing is admitted only when explicitly asked for.
  const priceMin = bound(filters.priceMin);
  const priceMax = bound(filters.priceMax);
  if (priceMin !== null || priceMax !== null) {
    const price = positiveCount(listing.price);
    if (price === null) {
      if (!filters.includeUndisclosedPrice) return false;
    } else if (!withinRange(price, priceMin, priceMax)) {
      return false;
    }
  }

  if (!withinRange(positiveCount(listing.beds ?? listing.bedrooms), bound(filters.bedsMin), bound(filters.bedsMax))) {
    return false;
  }
  if (!withinRange(positiveCount(listing.baths ?? listing.bathrooms), bound(filters.bathsMin), bound(filters.bathsMax))) {
    return false;
  }
  if (!withinRange(positiveCount(listing.carSpaces), bound(filters.carsMin), bound(filters.carsMax))) {
    return false;
  }
  // `landSizeSqm` is the canonical number from `Land Size SQM`; `landSize` is
  // kept as the fallback for records that arrived through the legacy shape.
  const landSize = listing.landSizeSqm ?? parseLandSizeSqm(listing.landSize);
  if (!withinRange(landSize, bound(filters.landSizeMin), bound(filters.landSizeMax))) {
    return false;
  }

  if (filters.listedWithinDays && filters.listedWithinDays !== 'all') {
    const days = Number(filters.listedWithinDays);
    if (Number.isFinite(days) && days > 0) {
      const stamp = listingTimestamp(listing);
      // Same rule as the numeric ranges: an undated listing cannot satisfy a
      // recency window, so it is excluded rather than assumed fresh.
      if (stamp === null) return false;
      if (now - stamp > days * 86_400_000) return false;
    }
  }

  return true;
}

/**
 * How many filters are narrowing the result set.
 *
 * `includeNearbySuburbs` is not counted: on its own it widens rather than
 * narrows, and it does nothing at all without a suburb selected.
 */
export function activeListingFilterCount(filters: ListingFilterState): number {
  let count = 0;
  for (const [key, value] of Object.entries(filters) as Array<
    [keyof ListingFilterState, string | boolean]
  >) {
    if (key === 'includeNearbySuburbs' || key === 'includeUndisclosedPrice') continue;
    const fallback = DEFAULT_LISTING_FILTERS[key];
    if (value !== fallback) count += 1;
  }
  return count;
}
