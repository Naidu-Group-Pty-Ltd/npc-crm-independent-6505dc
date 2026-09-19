import { describe, expect, it } from 'vitest';
import {
  assessAgainstConsensus,
  distanceKm,
  medianPoint,
} from '../../supabase/functions/_shared/geoConsensus.pure';

const doonan = { lat: -26.42, lng: 152.99 };
const cairns = { lat: -16.92, lng: 145.77 };

describe('distanceKm', () => {
  it('measures known distances within a few percent', () => {
    // Sydney–Melbourne is ~713km great-circle.
    const d = distanceKm({ lat: -33.87, lng: 151.21 }, { lat: -37.81, lng: 144.96 });
    expect(d).toBeGreaterThan(680);
    expect(d).toBeLessThan(740);
    expect(distanceKm(doonan, doonan)).toBe(0);
  });
});

describe('assessAgainstConsensus', () => {
  const doonanNeighbours = [
    { lat: -26.41, lng: 152.98 },
    { lat: -26.44, lng: 153.0 },
    { lat: -26.4, lng: 153.02 },
    { lat: -26.43, lng: 152.96 },
  ];

  it('rejects the wrong-town answer no rectangle can catch', () => {
    // Doonan QLD placed at Cairns: right state, plausible alone, ~1,150km
    // from every neighbour. This is the production screenshot bug, as a test.
    const verdict = assessAgainstConsensus(cairns, doonanNeighbours);
    expect(verdict.checked).toBe(true);
    expect(verdict.ok).toBe(false);
    expect(verdict.kmOff!).toBeGreaterThan(1000);
  });

  it('accepts a correct newcomer beside its neighbours', () => {
    expect(assessAgainstConsensus(doonan, doonanNeighbours)).toMatchObject({
      ok: true,
      checked: true,
    });
  });

  it('allows acreage fringes — the threshold is a district, not a street', () => {
    const fringe = { lat: doonan.lat + 0.15, lng: doonan.lng }; // ~17km out
    expect(assessAgainstConsensus(fringe, doonanNeighbours).ok).toBe(true);
  });

  it('abstains when the suburb has too few verified neighbours', () => {
    const verdict = assessAgainstConsensus(cairns, doonanNeighbours.slice(0, 2));
    expect(verdict).toEqual({ ok: true, checked: false });
  });

  it('cannot be dragged by one wrong neighbour — the median holds', () => {
    const withPoison = [...doonanNeighbours, cairns];
    expect(assessAgainstConsensus(doonan, withPoison).ok).toBe(true);
  });
});

describe('medianPoint', () => {
  it('handles empty and single inputs', () => {
    expect(medianPoint([])).toBeNull();
    expect(medianPoint([doonan])).toEqual(doonan);
  });
});
