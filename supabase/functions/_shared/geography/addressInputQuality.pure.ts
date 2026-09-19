/**
 * ME-5.1 item 7 — stopping the 183 from recurring, and what the measurement
 * says about how.
 *
 * ## What the brief proposed, and why the corpus refuses it
 *
 * Item 7 asks for structured Australian context to be *required* before a
 * coordinate may become authoritative — street, suburb, state, postcode,
 * country. Measured against the corpus, that gate cannot be a precondition:
 *
 * | cohort | has a state token, postcode or "Australia" | has none |
 * | --- | ---: | ---: |
 * | corrupted (183) | 3 | **180** |
 * | resolved (931) | 338 | **593** |
 *
 * The recall is superb — it rejects 180 of 183 — and the cost is ruinous: it
 * also rejects **593 of 931 legitimate reports, 63.7%**. Those are ordinary
 * bare street lines (`42 Lowanna Drive`, `285 Old Toowoomba Road`,
 * `19 McDonald Street`) that geocoded correctly to Buddina, Gatton and
 * Mordialloc. And the structured columns cannot supply the missing context:
 * `property_specs.state` and `.postcode` are NULL on **every** report in both
 * cohorts, so there is nothing to compose the query from.
 *
 * **So a required-anchor gate is a disclosure signal, not a precondition.**
 * `anchorStrength` reports it; nothing refuses on it alone.
 *
 * ## What DOES separate them
 *
 * Two things, both cheap and both measured.
 *
 * **An input that is not an address at all.** A PDF filename, a listing
 * fragment, an Airtable record id. These are recognisable by shape and cost no
 * legitimate report: nothing in the resolved cohort matches.
 *
 * **An answer that is a known failure value.** This is the one that matters,
 * and it is the finding that corrects ME-5's own numbers. Of the 931 reports
 * ME-5 called trustworthy, **64 sit at exactly −33.8688, 151.2093 — Sydney CBD
 * to four decimal places, which is the geocoder's old literal fallback.** All
 * 26 reports whose address is `Unknown Property (rec…)` are among them, and
 * **none of the 64 has an address that mentions Sydney at all.** They are not
 * measured locations; they are the failure value, and `assessAuPoint` could
 * never catch them because Sydney is in Australia and in NSW.
 *
 * The trustworthy count is therefore **867, not 931.**
 *
 * ## The rule
 *
 * **A coordinate that equals a known failure value is not a location**, however
 * plausible it looks. Validating the answer against the country box catches a
 * geocode that went abroad; it cannot catch one that never happened.
 */

/** What the supplied text is, before anything is geocoded. */
export type AddressInputKind =
  /** Plausibly a property address, whatever else may be wrong with it. */
  | 'usable'
  /** A filename, record id or system placeholder — never an address. */
  | 'not_an_address'
  /** Empty or whitespace. */
  | 'absent';

/** How much Australian anchoring the text carries. Disclosed, never enforced alone. */
export type AnchorStrength = 'anchored' | 'unanchored';

export interface AddressInputAssessment {
  kind: AddressInputKind;
  anchor: AnchorStrength;
  /** Why, in words an operator can act on. */
  reason: string;
  /** Whether a geocode may be attempted at all. */
  mayGeocode: boolean;
}

/** Shapes that are never a property address. Each is measured against the corpus. */
const NOT_AN_ADDRESS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\brec[A-Za-z0-9]{14,}\b/,
    why: 'contains an Airtable record id — 26 stored reports carry `Unknown Property (rec…)`, '
      + 'and every one of them geocoded to the Sydney CBD fallback',
  },
  {
    pattern: /\.(pdf|jpe?g|png|docx?|xlsx?|csv)\b/i,
    why: 'is a filename rather than an address — one stored report is a PDF name ending '
      + '"(Lisbon - LHS).pdf" and geocoded to Lisbon, Portugal',
  },
  {
    pattern: /^\s*(unknown|untitled|unnamed|test|sample|n\/?a)\b/i,
    why: 'opens with a system placeholder rather than a location',
  },
  {
    pattern: /^\s*(properties in|property from)\b/i,
    why: 'is a listing-page fragment rather than a property address',
  },
];

/** A state token, a four-digit postcode, or the country named. */
const HAS_STATE = /\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/;
const HAS_POSTCODE = /\b\d{4}\b/;
const HAS_COUNTRY = /\baustralia\b/i;

export function assessAddressInput(raw: unknown): AddressInputAssessment {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const anchor: AnchorStrength =
    HAS_STATE.test(text) || HAS_POSTCODE.test(text) || HAS_COUNTRY.test(text)
      ? 'anchored' : 'unanchored';

  if (!text) {
    return {
      kind: 'absent', anchor: 'unanchored', mayGeocode: false,
      reason: 'No address text was supplied, so there is nothing to geocode.',
    };
  }

  for (const { pattern, why } of NOT_AN_ADDRESS) {
    if (pattern.test(text)) {
      return {
        kind: 'not_an_address', anchor, mayGeocode: false,
        reason: `This ${why}. It is refused before the geocoder is called, because a geocoder `
          + 'always answers and its answer would be stored as a property location.',
      };
    }
  }

  return {
    kind: 'usable',
    anchor,
    mayGeocode: true,
    reason: anchor === 'anchored'
      ? 'Carries a state, postcode or country token, so the query is anchored in Australia.'
      : 'Carries no state, postcode or country token. That is the ordinary shape of 63.7% of '
        + 'legitimate stored reports, so it is disclosed rather than refused — the answer is '
        + 'validated instead.',
  };
}

/**
 * Coordinates this system has been OBSERVED to return as a failure value.
 *
 * `occurrences` is the measured count in the stored corpus of 1,114
 * coordinates, not a suspicion. That distinction is the whole of ME-5.1 item 5:
 * only measured failure behaviour may drive an automatic rejection, and a
 * coordinate that merely looks suspicious gets review logic instead.
 *
 * Both entries here are measured. The continent centre was added on theory in
 * the first draft of this module and then checked — it turns out 2 stored
 * reports sit on it exactly, so it stays, with its evidence stated.
 */
export interface FailureValue {
  latitude: number;
  longitude: number;
  label: string;
  /** How many stored coordinates sit on it exactly. Measured, never assumed. */
  occurrences: number;
  /** Localities a GENUINE property here would plausibly name. */
  plausibleLocalityTerms: readonly string[];
  why: string;
}

export const OBSERVED_FAILURE_COORDINATES: readonly FailureValue[] = [
  {
    latitude: -33.8688, longitude: 151.2093, label: 'Sydney CBD',
    occurrences: 64,
    plausibleLocalityTerms: ['sydney', 'nsw', 'new south wales', '2000'],
    why: 'the geocoder’s former literal fallback. All 64 stored reports on it lack any mention '
      + 'of Sydney, and 26 carry an Airtable record id in place of an address',
  },
  {
    latitude: -25.2744, longitude: 133.7751, label: 'centre of the Australian continent',
    occurrences: 2,
    plausibleLocalityTerms: [],
    why: 'what a country-restricted geocode returns for an address it cannot match — inside '
      + 'Australia, on land, contradicting no state. Two stored reports sit on it exactly, and '
      + 'no residential property exists there',
  },
];

/** How confident we are that a coordinate is a failure rather than a place. */
export type FailureVerdict =
  /** Not on any observed failure value. */
  | 'not_a_known_failure'
  /** On one, and the context shows it is genuinely that place. */
  | 'plausible_genuine_location'
  /** On one, and context neither confirms nor refutes. Needs a human. */
  | 'suspected_failure_value'
  /** On one, and the context proves it is the fallback. */
  | 'confirmed_failure_value';

export interface CoordinateContext {
  /** The address text the geocode was requested for. */
  requestedAddress?: string | null;
  /** Structured parts, where the record holds them. */
  state?: string | null;
  postcode?: string | null;
  suburb?: string | null;
}

export interface CoordinateVerdict {
  verdict: FailureVerdict;
  /** True only for `confirmed_failure_value`. Everything else is reviewable. */
  rejectOutright: boolean;
  failureValue?: string;
  reason: string;
}

/**
 * Adjudicate a coordinate that sits on an observed failure value.
 *
 * The rule ME-5.1 item 4 asks for: a fallback coordinate raises SUSPICION, and
 * only context settles it. A genuine Sydney CBD property must still resolve —
 * it would be absurd to make the busiest postcode in the country ungeocodable
 * — so the coordinate alone never rejects.
 *
 * Confirmation requires positive evidence of failure: an input that is not an
 * address at all, or a request that names a locality nowhere near the fallback.
 */
export function assessCoordinateIsAPlace(
  latitude: unknown, longitude: unknown, context: CoordinateContext = {},
): CoordinateVerdict {
  const lat = typeof latitude === 'number' ? latitude : Number.NaN;
  const lng = typeof longitude === 'number' ? longitude : Number.NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      verdict: 'confirmed_failure_value', rejectOutright: true,
      reason: 'The coordinate is not a usable position.',
    };
  }

  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const hit = OBSERVED_FAILURE_COORDINATES.find(
    (f) => r4(lat) === r4(f.latitude) && r4(lng) === r4(f.longitude),
  );
  if (!hit) {
    return {
      verdict: 'not_a_known_failure', rejectOutright: false,
      reason: 'The coordinate is not on any observed failure value.',
    };
  }

  const haystack = [
    context.requestedAddress ?? '', context.state ?? '',
    context.postcode ?? '', context.suburb ?? '',
  ].join(' ').toLowerCase();

  // Positive evidence of failure: the request was never an address.
  const input = assessAddressInput(context.requestedAddress);
  if (input.kind !== 'usable') {
    return {
      verdict: 'confirmed_failure_value', rejectOutright: true, failureValue: hit.label,
      reason: `The coordinate is ${hit.label} exactly — ${hit.why} — and the request that `
        + 'produced it was not an address. That is positive evidence of a fallback, not a '
        + 'coincidence.',
    };
  }

  // Positive evidence it is genuine: the request names this place.
  const namesThePlace = hit.plausibleLocalityTerms.some((t) => t && haystack.includes(t));
  if (namesThePlace) {
    return {
      verdict: 'plausible_genuine_location', rejectOutright: false, failureValue: hit.label,
      reason: `The coordinate is ${hit.label} exactly, which is a known fallback — but the `
        + 'request names that locality, so it is plausibly a genuine property there. It is '
        + 'flagged for review rather than rejected.',
    };
  }

  // A place nothing could genuinely be: no property exists at the continent centre.
  if (hit.plausibleLocalityTerms.length === 0) {
    return {
      verdict: 'confirmed_failure_value', rejectOutright: true, failureValue: hit.label,
      reason: `The coordinate is ${hit.label} exactly — ${hit.why}.`,
    };
  }

  return {
    verdict: 'suspected_failure_value', rejectOutright: false, failureValue: hit.label,
    reason: `The coordinate is ${hit.label} exactly, which is a known fallback, and the request `
      + 'neither names that locality nor is obviously not an address. It is held as suspected '
      + 'rather than resolved, and needs a human or a stronger signal to settle.',
  };
}
