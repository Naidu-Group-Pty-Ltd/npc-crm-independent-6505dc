/**
 * What the geocoding chain asks, decided before anything is asked.
 *
 * `geocoder.ts` does the I/O — the allowance, the one-a-second turn, the
 * cache, the providers — and follows this plan. The decisions live here so
 * they can be tested without a network, because the ones that went wrong on
 * 24 Sep 2026 were decisions, not I/O. Report 79d677d6 was filed as
 * `93 Schofields Farm Road (tallawong) NSW 2762` and the chain asked
 * Nominatim for a street called "93 Schofields Farm Road (tallawong) NSW
 * 2762" in a city called "(tallawong)", then asked the ABS for a suburb of
 * that name; both found nothing and the report was written with its
 * geography unresolved and eight evidence sources missing.
 *
 * Three rules:
 *
 * 1. **A bracketed annotation is not part of the address** — removed before
 *    anything reads it, the cache key included (`stripAddressAnnotations`).
 * 2. **A suburb is a filter the street may not need.** A development split
 *    runs one street through two suburbs — the owner's reading of this very
 *    listing: Schofields on the listing, Tallawong beside it — and a named
 *    suburb that OpenStreetMap files differently makes a structured search
 *    find nothing. Where the street and the postal area are both known they
 *    identify the street on their own, so the plan carries that second
 *    question (`withoutSuburb`); the chain refuses an answer from it that
 *    names another postal area, because that is a different street.
 * 3. **The bracketed place name is kept as a second suburb candidate**
 *    (`annotatedLocalities`), tried by the locality fallback only after the
 *    first candidate finds nothing.
 *
 * The suburb a report's EVIDENCE is keyed on is not decided here at all: once
 * a point is found, the report resolves its geography from the point, so a
 * house on either side of a split is described by the suburb it is in.
 */
import type { GeocodeAsk, GeocodePrecision } from './geocodeResult.pure.ts';
import { streetLineOf } from './osmGeocode.pure.ts';
import { normaliseAuState, normalisePostcode, type AuState } from '../auLocality.pure.ts';
import { annotatedLocalities, parseAddressText, stripAddressAnnotations } from '../reports/market/addressGeography.pure.ts';

/** A question as the chain asks it: every part present, absent as null. */
export interface PlannedAsk extends GeocodeAsk {
  street: string | null;
  suburb: string | null;
  state: AuState | null;
  postcode: string | null;
}

export interface GeocodePlan {
  /** The address every provider is asked about, annotations removed. */
  address: string;
  /** The first question: street, suburb, state and postal area as known. */
  ask: PlannedAsk;
  /**
   * The same street asked without its suburb — only where a suburb was part
   * of the first question and the street and postal area can identify the
   * street without it. Null otherwise.
   */
  withoutSuburb: PlannedAsk | null;
  /** Suburb names the locality fallback may try, in order, without repeats. */
  localityCandidates: string[];
}

/** The plan for one address, or null where there is no address to ask about. */
export function planGeocode(input: GeocodeAsk): GeocodePlan | null {
  const address = stripAddressAnnotations(input.address ?? '');
  if (!address) return null;
  const parsed = parseAddressText(address);
  const askedSuburb = typeof input.suburb === 'string' ? stripAddressAnnotations(input.suburb) : '';
  const suburb = askedSuburb || parsed.suburb;
  const state = normaliseAuState(input.state) ?? parsed.state;
  const postcode = normalisePostcode(input.postcode) ?? parsed.postcode;
  const askedStreet = typeof input.street === 'string' ? stripAddressAnnotations(input.street) : '';
  const street = askedStreet || streetLineOf({ address, suburb });
  const ask: PlannedAsk = { address, street: street || null, suburb: suburb || null, state, postcode };

  const withoutSuburb: PlannedAsk | null = ask.suburb && ask.street && ask.postcode ? { ...ask, suburb: null } : null;

  const localityCandidates: string[] = [];
  for (const name of [suburb, ...annotatedLocalities(input.address ?? '')]) {
    const trimmed = (name ?? '').trim();
    if (trimmed && !localityCandidates.some((seen) => seen.toLowerCase() === trimmed.toLowerCase())) {
      localityCandidates.push(trimmed);
    }
  }
  return { address, ask, withoutSuburb, localityCandidates };
}

/**
 * Why an answer to the question WITHOUT the suburb may not stand, or null
 * where it may.
 *
 * That question keeps the postal area as its only locality, so it is there to
 * find the STREET and nothing else. An answer coarser than the street is
 * refused — a suburb or postcode centroid is what the locality fallback is
 * for, under the suburb's own name — and so is one that names another postal
 * area (a street of the same name elsewhere) or none at all, because an
 * answer that cannot show it is in the postal area asked has not shown it is
 * on the street asked for. Absent is not agreement.
 */
export function suburblessAnswerRefusal(
  answer: { precision: GeocodePrecision; postcode: string | null },
  postcode: string,
): string | null {
  if (answer.precision !== 'address' && answer.precision !== 'street') {
    return `without the suburb the answer was a ${answer.precision}, not the street`;
  }
  if (!answer.postcode) return `without the suburb the answer names no postcode, so it cannot be shown to be in ${postcode}`;
  if (answer.postcode !== postcode) return `the match is in postcode ${answer.postcode}, not ${postcode}`;
  return null;
}
