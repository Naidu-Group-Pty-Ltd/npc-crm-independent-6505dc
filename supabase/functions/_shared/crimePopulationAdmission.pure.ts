/**
 * RF-7.2B.1B0-F4 — the population a crime rate is divided by is EVIDENCE, and
 * it enters through the front door or not at all.
 *
 * ## The defect this closes
 *
 * `crime-statistics-service` used to read `abs_census_poa.population` itself,
 * keyed on whatever postcode the caller handed it. When the report's geography
 * was unresolved that postcode was the untrusted one scraped out of the
 * free-text address — the exact input the Client-Safe Gate exists to stop
 * trusting.
 *
 * Measured on production report `0ec278ea-…` (48 Redfern Street, Cowra NSW
 * 2794, geography unresolved):
 *
 *   abs_census_poa.population['2794'] = 10,504   ← withheld from the report
 *   crime_reference offences (12m)    =  1,144
 *   published rate                    = 10,891 per 100,000
 *
 * So the same document said, in prose, that *"population counts, age profiles
 * and tenure splits for postcode 2794 are explicitly unavailable and must not
 * be substituted from broader geographies"* — and then printed a figure that
 * cannot exist without exactly that population. One report, two answers to one
 * question, and the second one came through a side channel.
 *
 * ## The rule
 *
 * A crime rate may be computed only from a population the evidence layer has
 * ADMITTED, at the SAME grain and for the SAME area as the offence counts.
 * Nothing here looks anything up: this module is handed a candidate and says
 * yes or no, and the caller that owns the evidence decision is the only thing
 * that can produce a candidate at all.
 *
 * Three refusals, each its own reading rather than a shared "no", because they
 * send an operator to different places:
 *
 *   `not_admitted`        the evidence layer withheld it, or never offered one
 *   `grain_mismatch`      an LGA or state figure cannot stand in for a postcode
 *   `geography_mismatch`  the right grain, the wrong area
 *
 * Refusing a rate is never refusing the evidence. Offence COUNTS, the trend and
 * the change are facts about the register and survive untouched — what stops is
 * the division, because the divisor is what we do not have.
 */

/** The geographic grains this platform's registers actually publish at. */
export type PopulationGrain = 'postcode' | 'lga' | 'sa2' | 'region' | 'state';

/**
 * A population the report's evidence layer has admitted for a named area.
 *
 * Every field is required. A population with no source, no geography and no
 * vintage is not admitted evidence, it is a number — and a rate whose
 * denominator cannot be described is exactly what §25 forbids.
 */
export interface AdmittedPopulation {
  readonly value: number;
  /** Where it came from, e.g. `abs_census_poa`. */
  readonly source: string;
  /** The area it describes, in the same spelling the register keys on. */
  readonly geography: string;
  readonly grain: PopulationGrain;
  /** e.g. `2021 Census usual residents`. */
  readonly vintage: string;
}

export type AdmissionRefusal =
  | 'not_admitted'
  | 'grain_mismatch'
  | 'geography_mismatch'
  | 'not_a_population';

export interface AdmissionVerdict {
  /** The population to divide by, or null — never a fallback. */
  readonly value: number | null;
  readonly refusedBecause: AdmissionRefusal | null;
  /** Carried through so a served rate can always describe its own divisor. */
  readonly admitted: AdmittedPopulation | null;
}

const refuse = (why: AdmissionRefusal): AdmissionVerdict =>
  ({ value: null, refusedBecause: why, admitted: null });

/** Case and surrounding space are not a geography difference. */
const sameArea = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * May this candidate population be used as the denominator for offence counts
 * published at `areaGrain` for `areaKey`?
 *
 * Total, and conservative in every direction: anything that is not an explicit
 * match refuses. There is deliberately no "close enough" — a postcode next
 * door, a parent LGA and a state are all wrong by the same rule, and the cost
 * of refusing is a missing rate while the cost of accepting is a figure the
 * report cannot justify.
 */
export function admitPopulationForArea(
  candidate: AdmittedPopulation | null | undefined,
  areaGrain: PopulationGrain,
  areaKey: string,
): AdmissionVerdict {
  if (!candidate || typeof candidate !== 'object') return refuse('not_admitted');

  const { value, grain, geography, source, vintage } = candidate;

  // A population must be a usable count. Zero is refused rather than treated as
  // absent: dividing by it is not a smaller rate, it is an infinity.
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return refuse('not_a_population');
  }
  // Provenance is part of admission, not decoration. Without it the rate cannot
  // state its own denominator, which is the whole §25 rule.
  if (typeof source !== 'string' || source.trim() === ''
    || typeof vintage !== 'string' || vintage.trim() === ''
    || typeof geography !== 'string' || geography.trim() === '') {
    return refuse('not_admitted');
  }

  // An LGA population under postcode offence counts is not a rate, it is two
  // different areas divided by one another.
  if (grain !== areaGrain) return refuse('grain_mismatch');
  if (!sameArea(geography, areaKey)) return refuse('geography_mismatch');

  return { value, refusedBecause: null, admitted: candidate };
}

/**
 * Say, in the operator's language, why no rate was published.
 *
 * Never shown to a client — the client-facing document simply carries no rate,
 * because "we could not divide" is our problem and not theirs.
 */
export const ADMISSION_REFUSAL_NOTE: Record<AdmissionRefusal, string> = {
  not_admitted:
    'No admitted population was supplied for this area, so no per-capita rate was calculated. '
    + 'Offence counts are unaffected.',
  grain_mismatch:
    'The supplied population describes a different geographic grain from the offence counts, '
    + 'so no per-capita rate was calculated rather than dividing one area by another.',
  geography_mismatch:
    'The supplied population describes a different area from the offence counts, '
    + 'so no per-capita rate was calculated.',
  not_a_population:
    'The supplied population was not a usable count, so no per-capita rate was calculated.',
};
