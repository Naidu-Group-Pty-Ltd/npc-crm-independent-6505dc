/**
 * The address a report is filed under, composed from what a scrape extracted.
 *
 * ## The defect this exists for
 *
 * Scraping a realestate.com.au listing at
 * `…/property-house-nsw-bowral-152220352` confirmed `✓ Scraped: 6 Acer Court`.
 * The suburb, state and postcode were extracted too — they are in the same
 * response, and the form fields below were populated from them — but the
 * address took `extractedAddress` verbatim and stopped there.
 *
 * It was reported as a display defect and is not one. That string becomes
 * `property_address` on the generated report, its title, the activity log's
 * entity name and the notification text, so every report generated from a URL
 * was filed under a street line with no locality. Two different properties can
 * share "6 Acer Court", and this product already has eleven City Beach
 * listings whose street numbers never got extracted — an address without its
 * suburb is not an address.
 *
 * ## The rules
 *
 * 1. **Use every part that was extracted.** The parts are all present; the
 *    only reason they were discarded is that `extractedAddress` was truthy.
 * 2. **Never repeat a part the address already carries.** A scraper that
 *    returns the full address for one site and the street line for another is
 *    the normal case, so this has to be idempotent — appending blindly gives
 *    "6 Acer Court, Bowral NSW 2576, Bowral NSW 2576".
 * 3. **Compose, never invent.** Nothing here supplies a part that was not
 *    extracted, and a scrape that yielded nothing falls back exactly as it did
 *    before — to the page title, then to the source.
 */

export interface ExtractedAddressParts {
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | number | null;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

/**
 * Is `part` already present in `address` as a whole word?
 *
 * Word boundaries matter both ways: "Bowral" must match "6 Acer Court,
 * Bowral" and must NOT match inside a longer word, and a state abbreviation
 * like "NSW" must not match the "nsw" inside a slug the title happened to
 * carry. Comparison is case- and punctuation-insensitive because a scraper
 * writes "Nsw", "NSW" and "N.S.W." for the same thing.
 */
function alreadyPresent(address: string, part: string): boolean {
  if (!part) return true;
  // A full stop is REMOVED and a comma becomes a space. Replacing both with a
  // space splits `N.S.W.` into three tokens, which then never matches `NSW` —
  // caught by the spec, and it would have appended the state a second time.
  const normalise = (value: string) =>
    value.toLowerCase().replace(/\./g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const haystack = ` ${normalise(address)} `;
  const needle = ` ${normalise(part)} `;
  return haystack.includes(needle);
}

/** A trailing state or postcode, in any spelling `alreadyPresent` accepts. */
const LOCALITY_TAIL = /\s*(?:\b(?:nsw|vic|qld|sa|wa|tas|nt|act|new south wales|victoria|queensland|south australia|western australia|tasmania|northern territory|australian capital territory)\b|\b\d{4}\b|\baustralia\b)\s*$/;

/**
 * Does the address already carry `suburb` AS ITS SUBURB — in the locality
 * position, after the street line — rather than merely containing the word?
 *
 * `alreadyPresent` answers "is the word anywhere", which is right for a state
 * or a postcode and wrong for a suburb: Australian streets are named after the
 * suburbs they run through. Measured 24 Sep 2026 on a realestate.com.au
 * listing — street `93 Schofields Farm Road (tallawong)`, suburb `Schofields`
 * — the word test found "Schofields" inside the street name, dropped the
 * suburb, and the report was filed as `93 Schofields Farm Road (tallawong)
 * NSW 2762`. Nothing downstream could place it: the geocoder took
 * "(tallawong)" for the suburb, the geography never resolved, and the report
 * was written with eight evidence sources missing and its grade withheld.
 *
 * Each comma-separated part is read with its locality tail set aside one word
 * at a time — "mount victoria nsw 2786", "mount victoria nsw", "mount
 * victoria", "mount" — and a part that was nothing but a tail is dropped. The
 * suburb is carried when a reading of a part AFTER the first is exactly the
 * suburb, or when a reading of the last part is the suburb or ENDS with it.
 * "12 Schofields Road" ends with its street type, so the suburb is added;
 * "12 Smith Street Schofields NSW 2762" and "Unit 3, 12 Smith St Bowral" end
 * with the suburb, so it is not added twice. Every reading is kept, not only
 * the last, because a suburb's own name can end in a state's: stripped to the
 * end, Mount Victoria and Port Victoria lose the word that makes them.
 */
function carriesSuburb(address: string, suburb: string): boolean {
  const normalise = (value: string) =>
    value.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const readings = (value: string): string[] => {
    const out = [normalise(value)];
    for (;;) {
      const current = out[out.length - 1];
      const next = current.replace(LOCALITY_TAIL, '').trim();
      if (next === current) return out;
      out.push(next);
    }
  };
  const target = normalise(suburb);
  if (!target) return true;
  const parts = address.split(',').map(readings).filter((part) => part[part.length - 1] !== '');
  if (!parts.length) return false;
  if (parts.slice(1).some((part) => part.includes(target))) return true;
  return parts[parts.length - 1].some((reading) => reading === target || reading.endsWith(` ${target}`));
}

/**
 * The full address, from whatever the extractor produced.
 *
 * Returns an empty string when nothing was extracted, so the caller decides
 * its own fallback — a page title, a file name — rather than this module
 * inventing one it has no basis for.
 */
export function composePropertyAddress(parts: ExtractedAddressParts): string {
  const address = clean(parts.address);
  const suburb = clean(parts.suburb);
  const state = clean(parts.state);
  const postcode = clean(parts.postcode);

  if (!address) {
    // No street line: the locality alone is still a real answer, and it is
    // what the previous code produced in this branch.
    const locality = [suburb, [state, postcode].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    return locality;
  }

  let composed = address;

  // The suburb joins with a comma; the state and postcode ride together after
  // it, which is how an Australian address is written. The suburb is judged
  // by POSITION (`carriesSuburb`), never by the word appearing somewhere —
  // a street named after its suburb is the ordinary case.
  if (suburb && !carriesSuburb(composed, suburb)) {
    composed = `${composed}, ${suburb}`;
  }
  if (state && !alreadyPresent(composed, state)) {
    composed = `${composed} ${state}`;
  }
  if (postcode && !alreadyPresent(composed, postcode)) {
    composed = `${composed} ${postcode}`;
  }

  return composed.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

/**
 * How much of an address was actually extracted.
 *
 * `ADDRESS_COMPOSITION.md`'s vocabulary, because the question is the same one:
 * 30 live listings genuinely carry only a suburb, and the composer must not be
 * asked to invent a street number that was never in the source. What it can do
 * is SAY which of the two happened — "Pokolbin, NSW 2320" and
 * "6 Acer Court, Bowral NSW 2576" are both correct compositions and only one of
 * them identifies a property, and the 19 Sep 2026 clone audit reported the
 * first as an address shown partially.
 */
export type AddressPrecision = 'address' | 'locality' | 'none';

export function addressPrecision(parts: ExtractedAddressParts): AddressPrecision {
  if (clean(parts.address)) return 'address';
  if (clean(parts.suburb) || clean(parts.state) || clean(parts.postcode)) return 'locality';
  return 'none';
}

/** What to tell the reader about a composition that named no street. */
export function addressPrecisionNotice(precision: AddressPrecision): string | null {
  if (precision === 'locality') {
    return 'No street address was extracted — this names the suburb only. '
      + 'Add the street address before generating, or the report is filed against a locality.';
  }
  if (precision === 'none') {
    return 'No address was extracted. The name below is a placeholder.';
  }
  return null;
}

/**
 * Strip a listing site's own furniture off a page title.
 *
 * Kept here beside the composer because it is the same decision — what to
 * call this property — and it existed inline in one of the two call sites.
 */
export function cleanListingTitle(title: string): string {
  return title
    .replace(/\s*[-|]\s*(Domain|realestate\.com\.au|Real Estate|Property|For Sale|Sold).*$/i, '')
    .replace(/^(Domain|realestate\.com\.au|Real Estate|Property|For Sale)\s*[-|]\s*/i, '')
    .trim();
}
