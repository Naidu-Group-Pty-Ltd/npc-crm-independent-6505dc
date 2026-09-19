import { describe, expect, it } from 'vitest';

import {
  COMMUTE_DESTINATION_UNKNOWN,
  COMMUTE_NO_ROUTE,
  resolveCbdDestination,
  STATE_CAPITALS,
} from '@/lib/reports/location/cbdDestination.pure';

/**
 * ME-5 items 14–15 — the writer fix.
 *
 * The fault these pin is not hypothetical: 494 stored reports carry a transit
 * journey to Sydney because the lookup this replaces ended `|| cbdLocations['NSW']`.
 */
describe('CBD destination', () => {
  it('knows the eight capitals and nothing else', () => {
    expect(Object.keys(STATE_CAPITALS).sort())
      .toEqual(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);
    for (const [state, dest] of Object.entries(STATE_CAPITALS)) {
      expect(dest.state).toBe(state);
      expect(dest.capital.length).toBeGreaterThan(3);
      // Every capital is on the Australian mainland or Tasmania.
      expect(dest.lat).toBeLessThan(-9);
      expect(dest.lat).toBeGreaterThan(-44);
      expect(dest.lng).toBeGreaterThan(112);
      expect(dest.lng).toBeLessThan(154);
    }
  });

  it('resolves a state to its own capital', () => {
    expect(resolveCbdDestination('WA')?.capital).toBe('Perth');
    expect(resolveCbdDestination('vic')?.capital).toBe('Melbourne');
    expect(resolveCbdDestination('  qld  ')?.capital).toBe('Brisbane');
  });

  describe('an unknown destination yields no commute rather than somebody else’s', () => {
    it.each([undefined, null, '', '   ', 'Victoria', 'XYZ', 'NZ'])(
      'returns null for %j rather than defaulting to Sydney',
      (state) => {
        expect(resolveCbdDestination(state as string | null | undefined)).toBeNull();
      },
    );

    it('never resolves an unrecognised state to NSW', () => {
      // The exact regression: the old lookup ended `|| cbdLocations['NSW']`.
      for (const bad of ['', '  ', 'Queensland', 'Western Australia', 'unknown', '0']) {
        expect(resolveCbdDestination(bad)?.capital).not.toBe('Sydney');
      }
    });
  });

  describe('the two ways a commute can be absent are distinguishable', () => {
    it('says which, and says nothing about the location', () => {
      expect(COMMUTE_DESTINATION_UNKNOWN.measured).toBe(false);
      expect(COMMUTE_NO_ROUTE.measured).toBe(false);
      expect(COMMUTE_DESTINATION_UNKNOWN.reason).not.toBe(COMMUTE_NO_ROUTE.reason);
      expect(COMMUTE_NO_ROUTE.detail).toMatch(/limit of the lookup, not a finding/);
    });

    it('carries no number a reader could mistake for a measurement', () => {
      for (const absent of [COMMUTE_DESTINATION_UNKNOWN, COMMUTE_NO_ROUTE]) {
        const record = absent as unknown as Record<string, unknown>;
        expect(record.durationMinutes).toBeUndefined();
        expect(record.distanceKm).toBeUndefined();
        // 'estimated' was the mode 438 fabricated commutes were stored under.
        expect(record.mode).toBeUndefined();
      }
    });
  });
});
