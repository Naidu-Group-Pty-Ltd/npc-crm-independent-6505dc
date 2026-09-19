/**
 * ME-4 — the Location dimension, measured on locational characteristics only.
 *
 * ## What the audit found (measured 2026-09-08, 1,001–1,112 stored reports)
 *
 * Location is the one dimension that genuinely works, and that is worth saying
 * plainly: **972 of 1,001 reports carry all three of its inputs**, the values
 * are real (64 distinct walk scores, 512 distinct commute times), and the
 * scores span 14–85 across 21 distinct values. Nothing here is the flat
 * placeholder that Growth and Demand were.
 *
 * Three defects, in descending order of consequence.
 *
 * **1. The state premium is not a locational characteristic.** The live scorer
 * awards up to 15 of 100 points by state — NSW/VIC/QLD 15, WA/SA 12, TAS/ACT/NT
 * 8 — so every property in New South Wales collects the same 15 whether it
 * stands in Mosman or 700 km inland, and the reason string printed on a rural
 * report reads *"Major capital city location"*. That is a market-strength
 * proxy assigned by state, which is audit §48's failure in miniature, and it is
 * the reason `state` is owned by nobody in the ownership matrix. **Removed.**
 *
 * **2. Absent evidence scored points.** No walk score awarded +12, no commute
 * +12, no schools +8 — 32 of 100 points available to a property with no
 * locational evidence whatever. It bites on only 29 of 1,001 reports because
 * the inputs are nearly always present, so the blast radius is small and the
 * principle is not: this is the rule the 0.00% yield and the placeholder 50
 * growth score each cost this product once. **Removed; absent is absent.**
 *
 * **3. The walk score saturates.** `calculateWalkScore` sums five capped
 * amenity terms that all max out in any suburb with a shopping strip, so
 * measured across 1,112 reports **62.8% score 90 or above** and 87.1% score 70
 * or above, with p25→p75 spanning just 84→95. A "Walker's Paradise" band
 * holding two thirds of an Australian investment corpus carries almost no
 * information at the top of the range. This module cannot fix the input — that
 * belongs to `location-intelligence-service` — but it must not pretend the top
 * of that scale discriminates, so the anchors are stretched where the data
 * actually lives and {@link LocationResult.saturationWarning} says so.
 */

import { interpolate } from './growthScoring.pure.ts';

/** Bumped whenever a weight, anchor or rule changes. Persisted with the score. */
export const LOCATION_METHODOLOGY_VERSION = '1.0.0';

export const LOCATION_WEIGHTS = {
  walkability: 0.35,
  cbdAccess: 0.40,
  schools: 0.25,
} as const;

export type LocationComponentKey = keyof typeof LOCATION_WEIGHTS;

/**
 * Walkability anchors, stretched against the measured distribution.
 *
 * Because 62.8% of the corpus sits at 90+, a linear read of the published
 * 0-100 walk score would call two thirds of every portfolio exceptional. The
 * anchors put the corpus median (94.5) near the middle of the OUTPUT range, so
 * the component discriminates where the properties actually are rather than
 * where the input scale claims they are.
 */
export const WALK_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [40, 15], [65, 30], [80, 42], [88, 50], [93, 60], [96, 75], [99, 90], [100, 100],
];

/** Minutes to the CBD. Under 20 is exceptional; beyond 75 is a different market. */
export const COMMUTE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [10, 100], [20, 88], [30, 74], [40, 60], [50, 46], [65, 30], [80, 15], [110, 0],
];

/** Schools within 3 km. */
export const SCHOOL_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 25], [2, 42], [3, 58], [5, 78], [7, 90], [10, 100],
];

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export interface LocationInputs {
  /** Published walk score, 0-100. */
  walkScore?: number | null;
  /** Minutes to the CBD by the resolved mode. */
  commuteTimeCBD?: number | null;
  /** Schools within 3 km. */
  schoolsNearby?: number | null;
}

export interface LocationComponent {
  key: LocationComponentKey;
  score: number;
  input: number;
  unit: 'index' | 'minutes' | 'count';
  detail: string;
  weight: number;
}

export interface LocationResult {
  methodologyVersion: string;
  /** 0-100, or null when nothing could be measured. Never a placeholder. */
  score: number | null;
  components: ReadonlyArray<LocationComponent>;
  missing: ReadonlyArray<LocationComponentKey>;
  weightCovered: number;
  /**
   * Set when the walk score sits in the saturated band, so a reader is told the
   * input cannot separate this property from most others rather than being
   * shown a confident number.
   */
  saturationWarning: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Score the location.
 *
 * No state term, no default for an absent input, and no reading of any Growth
 * or Demand evidence — the three things the audit found. A property with no
 * locational evidence scores `null`, not 32.
 */
export function scoreLocation(input: LocationInputs): LocationResult {
  const built: LocationComponent[] = [];

  const walk = num(input.walkScore);
  if (walk !== null && walk >= 0) {
    built.push({
      key: 'walkability',
      score: clamp(interpolate(walk, WALK_ANCHORS)),
      input: walk, unit: 'index',
      detail: `Walk score ${Math.round(walk)} of 100`,
      weight: LOCATION_WEIGHTS.walkability,
    });
  }

  const commute = num(input.commuteTimeCBD);
  if (commute !== null && commute > 0) {
    built.push({
      key: 'cbdAccess',
      score: clamp(interpolate(commute, COMMUTE_ANCHORS)),
      input: commute, unit: 'minutes',
      detail: `${Math.round(commute)} minutes to the CBD`,
      weight: LOCATION_WEIGHTS.cbdAccess,
    });
  }

  const schools = num(input.schoolsNearby);
  if (schools !== null && schools >= 0) {
    built.push({
      key: 'schools',
      score: clamp(interpolate(schools, SCHOOL_ANCHORS)),
      input: schools, unit: 'count',
      detail: `${Math.round(schools)} school${schools === 1 ? '' : 's'} within 3 km`,
      weight: LOCATION_WEIGHTS.schools,
    });
  }

  const present = new Set(built.map((c) => c.key));
  const missing = (Object.keys(LOCATION_WEIGHTS) as LocationComponentKey[])
    .filter((k) => !present.has(k));
  const weightCovered = built.reduce((s, c) => s + c.weight, 0);
  const score = weightCovered > 0
    ? Math.round(built.reduce((s, c) => s + c.score * (c.weight / weightCovered), 0))
    : null;

  return {
    methodologyVersion: LOCATION_METHODOLOGY_VERSION,
    score,
    components: built,
    missing,
    weightCovered: Number(weightCovered.toFixed(3)),
    saturationWarning: walk !== null && walk >= 90
      ? 'The published walk score is in its saturated band — 62.8% of measured properties score 90 or above, '
        + 'so this reading separates the property from few others.'
      : null,
  };
}
