/**
 * What a listing's State, Suburb, Postcode and Property Type actually are —
 * one answer, used by every surface that filters on them.
 *
 * ## Why this exists
 *
 * The Overview built its State filter from `extractState(listing.address)`
 * alone and never read `listing.state`, and applied the filter the same way.
 * `address` is the STREET LINE (see `ADDRESS_COMPOSITION.md`): the state lives
 * in its own column on almost every record, so almost every listing was
 * invisible to both the option list and the filter. The marketplace read the
 * column first and the address second, so the two pages offered different
 * sets — three states on one, four on the other, off the same data. That is
 * the 19 Sep 2026 clone audit's "the filters only has 3 states" and its
 * follow-on, "the other categories … also need to be checked for accuracy".
 *
 * The Overview also kept private copies of `extractState` and
 * `extractPostcode` rather than importing the shared ones, which is how they
 * came to differ at all.
 *
 * ## The rules
 *
 * **The record's own column outranks anything parsed from a string.** A
 * `state` column holds what the source said; a state parsed out of an address
 * holds what a regular expression could find in what survived composition.
 *
 * **A facet and the filter that uses it are one implementation.** A list built
 * one way and a predicate written another way is a filter that selects
 * nothing — so `listingState` / `listingPostcode` answer both questions.
 *
 * **Absent is absent.** A listing with no resolvable state contributes no
 * option and matches no state filter. It is not assigned a guess, and the
 * option list is not padded out with states nothing is listed in — an option
 * that can only ever return an empty page is worse than no option.
 */
import { extractAUState, extractAUPostcode } from '@/lib/addressUtils';

/** The shape every facet reader needs; deliberately narrower than PropertyListing. */
export interface FacetSource {
  state?: string | null;
  address?: string | null;
  suburb?: string | null;
  zipCode?: string | null;
  propertyType?: string | null;
}

const AU_STATES = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);

/**
 * Full names, because a source writes one sometimes and `extractAUState`
 * cannot see it: `\bVIC\b` does not match inside "VICTORIA". A column holding
 * "Victoria" is the source telling us the state, and dropping it would put
 * that listing in no state at all.
 */
const AU_STATE_NAMES: Record<string, string> = {
  'NEW SOUTH WALES': 'NSW',
  VICTORIA: 'VIC',
  QUEENSLAND: 'QLD',
  'SOUTH AUSTRALIA': 'SA',
  'WESTERN AUSTRALIA': 'WA',
  TASMANIA: 'TAS',
  'NORTHERN TERRITORY': 'NT',
  'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
};

/**
 * The state a listing is in, or null.
 *
 * The column first — it is what the source said — then the address, which is
 * what survived composition. A column holding something that is not an
 * Australian state (a full state name, a stray word) falls through to the
 * address rather than becoming a filter option nobody can match.
 */
export function listingState(listing: FacetSource): string | null {
  const declared = (listing.state ?? '').trim().toUpperCase();
  if (AU_STATES.has(declared)) return declared;
  if (AU_STATE_NAMES[declared]) return AU_STATE_NAMES[declared];
  // "NSW, Australia" and the like — still the column, just noisier.
  const fromColumn = extractAUState(declared);
  if (fromColumn) return fromColumn;
  return extractAUState(listing.address ?? '');
}

/** The postcode a listing is in, or null. Column first, then the address. */
export function listingPostcode(listing: FacetSource): string | null {
  const declared = (listing.zipCode ?? '').trim();
  if (/^\d{4}$/.test(declared)) return declared;
  return extractAUPostcode(listing.address ?? '');
}

/** The suburb, trimmed, or null. */
export function listingSuburb(listing: FacetSource): string | null {
  const value = (listing.suburb ?? '').trim();
  return value.length > 0 ? value : null;
}

/** The property type, trimmed, or null. */
export function listingPropertyType(listing: FacetSource): string | null {
  const value = (listing.propertyType ?? '').trim();
  return value.length > 0 ? value : null;
}

export interface ListingFacets {
  states: string[];
  suburbs: string[];
  postcodes: string[];
  propertyTypes: string[];
}

/** Sorted, de-duplicated, blank-free option lists for a set of listings. */
export function buildListingFacets(listings: readonly FacetSource[]): ListingFacets {
  const collect = (read: (l: FacetSource) => string | null): string[] => {
    const seen = new Set<string>();
    for (const listing of listings) {
      const value = read(listing);
      if (value) seen.add(value);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, 'en-AU'));
  };

  return {
    states: collect(listingState),
    suburbs: collect(listingSuburb),
    // Numeric order, not lexicographic — they are all four digits, so the two
    // agree, but sorting them as numbers says what they are.
    postcodes: collect(listingPostcode).sort((a, b) => Number(a) - Number(b)),
    propertyTypes: collect(listingPropertyType),
  };
}
