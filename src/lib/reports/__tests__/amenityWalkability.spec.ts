/**
 * Walkability is scored on distance, because the composite cannot discriminate.
 *
 * `calculateWalkScore` sums five CAPPED terms — transit 30, shopping 25,
 * schools 15, healthcare 15, recreation 15 — over lookups that themselves cap
 * at `results.slice(0, 10)` inside radii of 2 km (parks), 3 km (schools) and
 * 5 km (everything else). Within 5 km of any Australian suburban address
 * there are ten restaurants, so 62.8% of the corpus scores 90 or above and
 * p25 to p75 spans 84 to 95.
 *
 * `WALK_ANCHORS` then tries to recover discrimination from an input that has
 * none, and amplifies instead: raw 90 scores 54, raw 96 scores 75, raw 100
 * scores 100. A 10-point move in a saturated input becomes 46 points of
 * output, precisely where most of the corpus sits. A cap destroys
 * information; no later transform puts it back.
 */
import { describe, expect, it } from 'vitest';
import {
  AMENITY_WALKABILITY_VERSION,
  AMENITY_WEIGHTS,
  DISTANCE_ANCHORS,
  scoreAmenityWalkability,
  type AmenityReading,
} from '../../../../supabase/functions/_shared/reports/market/amenityWalkability.pure';
import { scoreLocation } from '../../../../supabase/functions/_shared/reports/market/locationScoring.pure';

const a = (category: string, count: number | null, distance: number | null): AmenityReading =>
  ({ category, count, distance });

const INNER = [a('Public Transport', 10, 0.25), a('Shopping', 10, 0.4), a('Recreation', 10, 0.3), a('Healthcare', 5, 1.2), a('Schools', 8, 0.5)];
const SUBURBAN = [a('Public Transport', 6, 0.9), a('Shopping', 8, 1.2), a('Recreation', 7, 0.7), a('Healthcare', 3, 3.0), a('Schools', 10, 1.1)];
const OUTER = [a('Public Transport', 3, 2.2), a('Shopping', 5, 2.8), a('Recreation', 4, 1.4), a('Healthcare', 1, 4.5), a('Schools', 6, 2.0)];
const RURAL = [a('Public Transport', 1, 4.4), a('Shopping', 2, 4.6), a('Recreation', 1, 1.9), a('Healthcare', 0, null), a('Schools', 2, 2.8)];

describe('it discriminates where the composite cannot', () => {
  it('orders four real profiles monotonically and spreads them', () => {
    const inner = scoreAmenityWalkability(INNER).score!;
    const suburban = scoreAmenityWalkability(SUBURBAN).score!;
    const outer = scoreAmenityWalkability(OUTER).score!;
    const rural = scoreAmenityWalkability(RURAL).score!;
    expect(inner).toBeGreaterThan(suburban);
    expect(suburban).toBeGreaterThan(outer);
    expect(outer).toBeGreaterThan(rural);
    expect(inner - rural).toBeGreaterThan(60);
  });

  it('is monotonic in distance, with no cliff anywhere', () => {
    /*
     * The defect the composite has: between raw 88 and raw 100 the anchors
     * move the output 50 points, so measurement noise in the band where most
     * properties sit swings the score wildly. Stepping the transit distance
     * smoothly must move this score smoothly.
     */
    let previous = 101;
    let biggestStep = 0;
    for (let km = 0.1; km <= 5; km += 0.1) {
      const s = scoreAmenityWalkability([
        a('Public Transport', 5, km), a('Shopping', 5, 1.0),
        a('Recreation', 5, 0.8), a('Healthcare', 2, 2.5),
      ]).score!;
      expect(s).toBeLessThanOrEqual(previous);
      if (previous <= 100) biggestStep = Math.max(biggestStep, previous - s);
      previous = s;
    }
    // No single 100 m step may move the dimension more than a couple of points.
    expect(biggestStep).toBeLessThanOrEqual(3);
  });
});

describe('schools are excluded, and the exclusion is visible', () => {
  it('gives the schools row zero weight, because Location already scores it', () => {
    expect(AMENITY_WEIGHTS.Schools).toBe(0);
    // Listed rather than omitted, so a reader sees the decision.
    expect(Object.keys(AMENITY_WEIGHTS)).toContain('Schools');
  });

  it('moving the school distance does not move walkability at all', () => {
    const near = scoreAmenityWalkability([...OUTER.filter((r) => r.category !== 'Schools'), a('Schools', 12, 0.1)]);
    const far = scoreAmenityWalkability([...OUTER.filter((r) => r.category !== 'Schools'), a('Schools', 1, 2.9)]);
    expect(near.score).toBe(far.score);
  });

  it('cannot produce a score from the schools row alone', () => {
    expect(scoreAmenityWalkability([a('Schools', 10, 0.4)]).score).toBeNull();
  });
});

describe('absent, empty and near are three different readings', () => {
  it('excludes a category whose provider never answered, and names it', () => {
    const r = scoreAmenityWalkability([
      a('Public Transport', null, null), a('Shopping', 8, 1.2),
      a('Recreation', 7, 0.7), a('Healthcare', 3, 3.0),
    ]);
    expect(r.unmeasured).toContain('Public Transport');
    expect(r.components.map((c) => c.category)).not.toContain('Public Transport');
    expect(r.weightCovered).toBeCloseTo(0.6, 2);
    expect(r.score).not.toBeNull();
  });

  it('scores a reached-and-empty category at the floor rather than dropping it', () => {
    // An outage and a genuinely isolated property must not score the same.
    const reachedEmpty = scoreAmenityWalkability([
      a('Public Transport', 0, null), a('Shopping', 8, 1.2),
      a('Recreation', 7, 0.7), a('Healthcare', 3, 3.0),
    ]);
    const neverAnswered = scoreAmenityWalkability([
      a('Public Transport', null, null), a('Shopping', 8, 1.2),
      a('Recreation', 7, 0.7), a('Healthcare', 3, 3.0),
    ]);
    expect(reachedEmpty.components.map((c) => c.category)).toContain('Public Transport');
    expect(reachedEmpty.score!).toBeLessThan(neverAnswered.score!);
    expect(reachedEmpty.weightCovered).toBe(1);
  });

  it('returns null rather than a placeholder where nothing was read', () => {
    expect(scoreAmenityWalkability([]).score).toBeNull();
    expect(scoreAmenityWalkability(null).score).toBeNull();
    expect(scoreAmenityWalkability(undefined).score).toBeNull();
  });
});

describe('every anchor is bounded and ordered', () => {
  it('keeps each curve descending in distance and inside 0-100', () => {
    for (const [category, anchors] of Object.entries(DISTANCE_ANCHORS)) {
      let lastKm = -Infinity;
      let lastScore = 101;
      for (const [km, score] of anchors) {
        expect(km, category).toBeGreaterThan(lastKm);
        expect(score, category).toBeLessThanOrEqual(lastScore);
        expect(score, category).toBeGreaterThanOrEqual(0);
        expect(score, category).toBeLessThanOrEqual(100);
        lastKm = km; lastScore = score;
      }
    }
  });

  it('declares a curve for every weighted category', () => {
    for (const [category, weight] of Object.entries(AMENITY_WEIGHTS)) {
      if (weight > 0) expect(DISTANCE_ANCHORS[category], category).toBeDefined();
    }
  });

  it('is deterministic and carries its version', () => {
    expect(JSON.stringify(scoreAmenityWalkability(SUBURBAN)))
      .toBe(JSON.stringify(scoreAmenityWalkability(SUBURBAN)));
    expect(AMENITY_WALKABILITY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('Location names which measurement it used', () => {
  it('prefers the distances and says so', () => {
    const r = scoreLocation({ walkScore: 80, commuteTimeCBD: 39, schoolsNearby: 10, amenities: SUBURBAN });
    expect(r.walkabilityBasis).toBe('amenity_distance');
    expect(r.saturationWarning).toBeNull();
  });

  it('falls back to the composite, byte-identically, where no distances exist', () => {
    const before = scoreLocation({ walkScore: 80, commuteTimeCBD: 39, schoolsNearby: 10 });
    expect(before.walkabilityBasis).toBe('composite_walk_score');
    // The issued 97 Poole Road reading, unchanged on the fallback path.
    expect(before.score).toBe(64);
  });

  it('never carries the saturation warning on the distance basis', () => {
    // A saturated walk score beside real distances: the warning describes an
    // input this score did not use.
    const r = scoreLocation({ walkScore: 97, commuteTimeCBD: 20, schoolsNearby: 8, amenities: INNER });
    expect(r.walkabilityBasis).toBe('amenity_distance');
    expect(r.saturationWarning).toBeNull();
    const fallback = scoreLocation({ walkScore: 97, commuteTimeCBD: 20, schoolsNearby: 8 });
    expect(fallback.saturationWarning).toBeTruthy();
  });

  it('falls back where the distances exist but none carries weight', () => {
    const r = scoreLocation({ walkScore: 80, commuteTimeCBD: 39, schoolsNearby: 10, amenities: [a('Schools', 9, 0.3)] });
    expect(r.walkabilityBasis).toBe('composite_walk_score');
    expect(r.score).toBe(64);
  });
});
