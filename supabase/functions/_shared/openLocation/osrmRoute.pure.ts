/**
 * OSRM public router — the free commute measurement.
 *
 * `router.project-osrm.org` answered this egress directly (pg_net 248212,
 * 16 Sep 2026: `code: "Ok"`, a Truganina→Melbourne CBD route of
 * duration 1411.9 s / distance 23441.3 m). It routes DRIVING: the demo
 * graph carries no timetables, so a transit commute is not something it
 * can state, and the reading says `mode: 'driving'` rather than wearing
 * the Google path's `'public_transit'` label over a different measurement.
 * The one consumer of the number (`commuteTimeCBD` in the legacy score
 * engine) reads minutes alone, in ≤15/≤25/≤40/≤60 bands; the generator
 * prompt was already forbidden from narrating a commute.
 *
 * Rounding is byte-identical to the Distance Matrix mapper's:
 * `Math.round(seconds / 60)` and `Math.round(metres / 1000 * 10) / 10`.
 */

export const OSRM_BASE = 'https://router.project-osrm.org';

/** Longitude first — OSRM's own convention, the reverse of ours. */
export function buildOsrmRouteUrl(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): string {
  return `${OSRM_BASE}/route/v1/driving/` +
    `${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
    `?overview=false&alternatives=false&steps=false`;
}

export interface OsrmCommute {
  durationMinutes: number;
  distanceKm: number;
  mode: 'driving';
}

export type OsrmAnswer =
  | { kind: 'route'; commute: OsrmCommute }
  /** OSRM was reached and states the graph holds no route — an answer
   * about the geometry, final, never a reason to ask another provider. */
  | { kind: 'no_route' }
  /** Every other shape — an error code, a truncated body, non-finite
   * numbers. The provider's fault or ours, so the chain may try the next
   * provider rather than recording a finding about the location. */
  | { kind: 'unusable'; code: string };

const NO_ROUTE_CODES = new Set(['NoRoute', 'NoSegment']);

export function parseOsrmAnswer(body: unknown): OsrmAnswer {
  const b = body as { code?: unknown; routes?: Array<{ duration?: unknown; distance?: unknown }> };
  const code = typeof b?.code === 'string' ? b.code : 'missing_code';
  if (NO_ROUTE_CODES.has(code)) return { kind: 'no_route' };
  if (code !== 'Ok' || !Array.isArray(b.routes) || b.routes.length === 0) {
    return { kind: 'unusable', code };
  }
  const duration = Number(b.routes[0]?.duration);
  const distance = Number(b.routes[0]?.distance);
  if (!Number.isFinite(duration) || !Number.isFinite(distance) || duration < 0 || distance < 0) {
    return { kind: 'unusable', code: 'non_finite_route' };
  }
  return {
    kind: 'route',
    commute: {
      durationMinutes: Math.round(duration / 60),
      distanceKm: Math.round(distance / 1000 * 10) / 10,
      mode: 'driving',
    },
  };
}
