/**
 * Walkability from the distance to each amenity, not from a saturated index.
 *
 * ## Why the walk score could not be re-anchored
 *
 * `locationScoring.pure.ts` stretches `WALK_ANCHORS` to try to recover
 * discrimination from an input that has none — 62.8% of the corpus scores 90
 * or above, p25 to p75 spans 84 to 95 — and the obvious fix, mapping the
 * input onto Walk Score's published bands, is wrong twice over.
 *
 * **It is not Walk Score's index.** `calculateWalkScore` in
 * `location-intelligence-service` is this platform's own composite: transit
 * 30, shopping and dining 25, schools 15, healthcare 15, recreation 15.
 * Importing a publisher's semantics onto it would put a stranger's meaning on
 * our own arithmetic.
 *
 * **The saturation is built in at two levels, and neither is recoverable by
 * re-anchoring.** Every term caps at a low count — schools at 5, healthcare at
 * 3, recreation at 5, shopping at 13 — and underneath that the lookup itself
 * caps: `results.slice(0, 10)` inside a radius of 2 km for parks, 3 km for
 * schools and 5 km for everything else. Within 5 km of any Australian
 * suburban address there are ten restaurants. **A cap destroys information;
 * no later transform puts it back.**
 *
 * ## What this scores instead
 *
 * **The distance to the nearest of each kind**, which the enrichment already
 * measures and publishes per category (`locationIntelligence.amenities[].
 * distance`, in kilometres). Distance does not saturate: 200 m, 800 m and
 * 3 km are three different places everywhere in the country, and "how far is
 * it" is what walkability means in the first place.
 *
 * ## Schools are deliberately absent
 *
 * `LOCATION_WEIGHTS.schools` already scores school access at 0.25 of the
 * dimension. Scoring school distance here as well would charge one
 * characteristic twice inside one dimension — the defect `DEMAND_EXCLUSIONS`
 * names across dimensions and `GROWTH_WEIGHTS_V3_0` names within one. The
 * category is read, reported, and given no weight.
 *
 * ## Absent, empty and near are three different readings
 *
 * A category whose provider never answered has `count: null` and contributes
 * nothing — the rule `placesAvailability.pure.ts` exists for. A category that
 * WAS reached and found nothing inside its radius has `count: 0`, which is a
 * real and poor reading, and scores the floor rather than being excluded:
 * dropping it would let an outage and a genuinely isolated address produce
 * the same answer.
 */

/** Bumped whenever a weight, an anchor or the exclusion changes. */
export const AMENITY_WALKABILITY_VERSION = '1.0.0';

/** One row of `locationIntelligence.amenities`, as the enrichment publishes it. */
export interface AmenityReading {
  readonly category: string;
  /** Measured count, or null where the provider never answered. */
  readonly count?: number | null;
  /** Kilometres to the nearest of this kind, or null. */
  readonly distance?: number | null;
}

/**
 * What each category is worth to walkability, and why.
 *
 * Transit carries the most because it is the one amenity that changes whether
 * a household can live without a car, which is the question walkability is
 * asked to answer. Shopping and dining is daily; recreation is frequent;
 * healthcare is real but occasional, and the lookup asks for `hospital`, which
 * is sparse by nature and a poor discriminator between suburbs.
 *
 * Schools carry ZERO and are listed rather than omitted, so the exclusion is
 * visible to a reader and checkable by a test.
 */
export const AMENITY_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  'Public Transport': 0.40,
  Shopping: 0.30,
  Recreation: 0.20,
  Healthcare: 0.10,
  /** Scored by `LOCATION_WEIGHTS.schools`. Charging it here too is a double count. */
  Schools: 0,
});

/**
 * Kilometres to the nearest, per category.
 *
 * Each curve is set against the radius its own lookup uses, so the scale
 * spends its range where that category's readings actually fall: parks are
 * searched to 2 km, everything else to 5 km.
 */
export const DISTANCE_ANCHORS: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> =
  Object.freeze({
    // A stop inside 400 m is the walk-up catchment planners use.
    'Public Transport': [[0.2, 100], [0.4, 88], [0.8, 70], [1.5, 50], [2.5, 30], [4, 12], [5, 0]],
    // Daily needs. A centre inside 800 m is genuinely walkable with bags.
    Shopping: [[0.3, 100], [0.8, 82], [1.5, 62], [2.5, 42], [4, 18], [5, 5]],
    // Searched to 2 km, so the curve ends there rather than at 5.
    Recreation: [[0.2, 100], [0.5, 85], [1.0, 65], [1.5, 45], [2, 25]],
    // `hospital`, which is sparse by nature — a wide, shallow curve.
    Healthcare: [[1, 100], [2, 80], [3.5, 55], [5, 30]],
  });

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function interpolate(value: number, anchors: ReadonlyArray<readonly [number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x1, y1] = anchors[i - 1];
    const [x2, y2] = anchors[i];
    if (value <= x2) return y1 + ((value - x1) / (x2 - x1)) * (y2 - y1);
  }
  return last[1];
}

export interface AmenityComponent {
  readonly category: string;
  readonly score: number;
  /** Kilometres, or null where the category was reached and held nothing. */
  readonly distanceKm: number | null;
  readonly weight: number;
  readonly detail: string;
}

export interface AmenityWalkabilityResult {
  /** 0-100, or null where no weighted category could be read. */
  readonly score: number | null;
  readonly components: ReadonlyArray<AmenityComponent>;
  /** Categories that carry weight and had no measurement, named. */
  readonly unmeasured: ReadonlyArray<string>;
  /** Share of the weighted categories that answered, 0-1. */
  readonly weightCovered: number;
  readonly methodologyVersion: string;
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Score walkability from the measured distances.
 *
 * Returns null where nothing weighted could be read — never a placeholder,
 * and never a score built from the schools row alone.
 */
export function scoreAmenityWalkability(
  amenities: ReadonlyArray<AmenityReading> | null | undefined,
): AmenityWalkabilityResult {
  const empty: AmenityWalkabilityResult = {
    score: null,
    components: [],
    unmeasured: Object.keys(AMENITY_WEIGHTS).filter((c) => AMENITY_WEIGHTS[c] > 0),
    weightCovered: 0,
    methodologyVersion: AMENITY_WALKABILITY_VERSION,
  };
  if (!amenities || !amenities.length) return empty;

  const components: AmenityComponent[] = [];
  const unmeasured: string[] = [];

  for (const [category, weight] of Object.entries(AMENITY_WEIGHTS)) {
    if (weight <= 0) continue;
    const row = amenities.find((a) => a.category === category);
    const anchors = DISTANCE_ANCHORS[category];
    if (!row || !anchors) { unmeasured.push(category); continue; }

    const count = finite(row.count);
    const distance = finite(row.distance);

    if (count === null) {
      // The provider never answered. Absent, not empty.
      unmeasured.push(category);
      continue;
    }
    if (count === 0 || distance === null) {
      /*
       * Reached, and nothing inside the radius. That is a real and poor
       * reading about the address rather than a gap in the evidence, so it
       * scores the floor instead of leaving the component — dropping it would
       * make an outage and a genuinely isolated property score the same.
       */
      const floor = anchors[anchors.length - 1][1];
      components.push({
        category,
        score: clamp(floor),
        distanceKm: null,
        weight,
        detail: `no ${category.toLowerCase()} within the searched radius`,
      });
      continue;
    }

    components.push({
      category,
      score: clamp(interpolate(distance, anchors)),
      distanceKm: distance,
      weight,
      detail: `nearest ${category.toLowerCase()} ${distance < 1
        ? `${Math.round(distance * 1000)} m`
        : `${distance.toFixed(1)} km`} away`,
    });
  }

  const covered = components.reduce((s, c) => s + c.weight, 0);
  const weighted = Object.entries(AMENITY_WEIGHTS)
    .filter(([, w]) => w > 0)
    .reduce((s, [, w]) => s + w, 0);

  return {
    score: covered > 0
      ? Math.round(components.reduce((s, c) => s + c.score * (c.weight / covered), 0))
      : null,
    components,
    unmeasured,
    weightCovered: weighted > 0 ? Number((covered / weighted).toFixed(3)) : 0,
    methodologyVersion: AMENITY_WALKABILITY_VERSION,
  };
}
