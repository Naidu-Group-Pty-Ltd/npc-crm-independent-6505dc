/**
 * OSRM parsing, pinned on the verbatim production route [pg_net 248212]:
 * Truganina → Melbourne CBD, code "Ok", duration 1411.9 s, distance
 * 23441.3 m.
 */
import { describe, expect, it } from 'vitest';
import { OSRM_BASE, buildOsrmRouteUrl, parseOsrmAnswer } from '../osrmRoute.pure.ts';

const MEASURED_ROUTE = {
  code: 'Ok',
  routes: [{ legs: [], weight_name: 'routability', weight: 1411.9, duration: 1411.9, distance: 23441.3 }],
  waypoints: [
    { hint: '…', distance: 20.5, name: 'Leakes Road', location: [144.726497, -37.837523] },
    { hint: '…', distance: 4.2, name: 'Collins Street', location: [144.962646, -37.817497] },
  ],
};

describe('buildOsrmRouteUrl', () => {
  it('writes longitude first — OSRM’s convention, the reverse of ours', () => {
    const url = buildOsrmRouteUrl({ lat: -37.837523, lng: 144.726497 }, { lat: -37.8136, lng: 144.9631 });
    expect(url).toBe(`${OSRM_BASE}/route/v1/driving/144.726497,-37.837523;144.9631,-37.8136?overview=false&alternatives=false&steps=false`);
  });
});

describe('parseOsrmAnswer', () => {
  it('rounds the measured route exactly as the Distance Matrix mapper would', () => {
    const answer = parseOsrmAnswer(MEASURED_ROUTE);
    expect(answer).toEqual({
      kind: 'route',
      commute: { durationMinutes: 24, distanceKm: 23.4, mode: 'driving' },
    });
  });

  it('says driving, because the demo graph has no timetables', () => {
    const answer = parseOsrmAnswer(MEASURED_ROUTE);
    expect(answer.kind === 'route' && answer.commute.mode).toBe('driving');
  });

  it('a NoRoute is an answer about the geometry, final', () => {
    expect(parseOsrmAnswer({ code: 'NoRoute' })).toEqual({ kind: 'no_route' });
    expect(parseOsrmAnswer({ code: 'NoSegment' })).toEqual({ kind: 'no_route' });
  });

  it('anything else is unusable — the provider’s fault, the next provider’s turn', () => {
    expect(parseOsrmAnswer({})).toMatchObject({ kind: 'unusable', code: 'missing_code' });
    expect(parseOsrmAnswer({ code: 'InvalidUrl' })).toMatchObject({ kind: 'unusable' });
    expect(parseOsrmAnswer({ code: 'Ok', routes: [] })).toMatchObject({ kind: 'unusable' });
    expect(parseOsrmAnswer({ code: 'Ok', routes: [{ duration: -3, distance: 100 }] }))
      .toMatchObject({ kind: 'unusable', code: 'non_finite_route' });
    expect(parseOsrmAnswer({ code: 'Ok', routes: [{ duration: 'fast', distance: 100 }] }))
      .toMatchObject({ kind: 'unusable' });
  });
});
