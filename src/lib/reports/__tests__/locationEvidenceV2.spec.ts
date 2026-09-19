import { describe, expect, it } from 'vitest';

import {
  buildLocationEvidenceV2,
  evidenceIsComparable,
  type LocationEvidenceInputs,
} from '@/lib/reports/location/locationEvidenceV2.pure';
import {
  FEED_JURISDICTION,
  readingIsInJurisdiction,
  type TransportReading,
} from '../../../../supabase/functions/_shared/transportReading.pure';

/**
 * ME-5 items 7, 8 and 10 — Location evidence from sources that answer, and the
 * metro bias that a naive version reintroduces.
 *
 * The GTFS numbers quoted here are from reconstructing all 931 placed
 * historical reports against the 185,177 loaded stops.
 */
const stopsNearby = (feeds: string[]): TransportReading => ({
  verdict: 'stops_nearby',
  stops: [{ stopId: '1', name: 'A Street', metres: 210, feed: feeds[0], routeType: null }],
  countWithinRadius: 4,
  radiusMetres: 1600,
  nearest: { stopId: '1', name: 'A Street', metres: 210, feed: feeds[0], routeType: null },
  feeds,
  sources: ['A transit agency'],
  notMeasured: ['mode', 'service frequency'],
});

const inputs = (o: Partial<LocationEvidenceInputs>): LocationEvidenceInputs => ({
  transport: null,
  geography: { gccsaName: null, significantUrbanArea: null, urbanCentre: null, state: null },
  ...o,
});

describe('location evidence v2', () => {
  describe('transit is measured or unmeasured, never poor', () => {
    it('measures where a loaded in-jurisdiction feed answers', () => {
      const e = buildLocationEvidenceV2(inputs({
        transport: stopsNearby(['nsw_sydney']),
        geography: { gccsaName: 'Greater Sydney', significantUrbanArea: 'Sydney', urbanCentre: 'Sydney', state: 'NSW' },
      }));
      expect(e.transit.state).toBe('measured');
      expect(e.transit.value?.nearestStopMetres).toBe(210);
      expect(e.caveats.join(' ')).toMatch(/does not carry mode or service frequency/);
    });

    it('says NOT COVERED where no feed reaches, rather than reporting nothing nearby', () => {
      const e = buildLocationEvidenceV2(inputs({
        transport: null,
        geography: { gccsaName: 'Greater Perth', significantUrbanArea: 'Perth', urbanCentre: 'Perth', state: 'WA' },
      }));
      expect(e.transit.state).toBe('not_covered');
      expect(e.transit.statement).toMatch(/limit of the data held, not a finding about the area/);
    });

    it('distinguishes "a network covers this and there is no stop" from "no network"', () => {
      const e = buildLocationEvidenceV2(inputs({
        transport: { ...stopsNearby(['qld_seq']), verdict: 'none_within_radius', countWithinRadius: 0, nearest: null, stops: [] },
        geography: { gccsaName: 'Rest of Qld', significantUrbanArea: 'Gympie', urbanCentre: 'Gympie', state: 'QLD' },
      }));
      expect(e.transit.state).toBe('none_here');
      expect(e.transit.statement).toMatch(/A loaded network covers this area/);
    });
  });

  describe("a jurisdiction's own feed, or nothing", () => {
    it('names one jurisdiction per loaded feed', () => {
      expect(FEED_JURISDICTION).toEqual({
        nsw_sydney: 'NSW', qld_seq: 'QLD', nt_darwin: 'NT', nt_alice: 'NT',
      });
    });

    it('refuses an interstate-feed stop as a local reading', () => {
      // Measured: 6 VIC, 4 ACT and 1 SA report find stops ONLY in the NSW bundle —
      // Southern Cross Station 225 m from a Docklands property, for instance.
      const e = buildLocationEvidenceV2(inputs({
        transport: stopsNearby(['nsw_sydney']),
        geography: { gccsaName: 'Greater Melbourne', significantUrbanArea: 'Melbourne', urbanCentre: 'Melbourne', state: 'VIC' },
      }));
      expect(e.transit.state).toBe('not_covered');
      expect(e.transit.statement).toMatch(/another jurisdiction’s feed/);
      expect(e.caveats.join(' ')).toMatch(/deliberately not used/);
    });

    it('withholds rather than accepts when the state is unknown', () => {
      expect(readingIsInJurisdiction(['nsw_sydney'], null)).toBe(false);
      expect(readingIsInJurisdiction(['nsw_sydney'], '')).toBe(false);
      expect(readingIsInJurisdiction(['nsw_sydney'], 'NSW')).toBe(true);
      expect(readingIsInJurisdiction([], 'NSW')).toBe(false);
    });
  });

  describe('nothing is invented for a source this deployment does not hold', () => {
    it('marks access and amenities not_acquired and says why', () => {
      const e = buildLocationEvidenceV2(inputs({
        geography: { gccsaName: 'Greater Sydney', significantUrbanArea: 'Sydney', urbanCentre: 'Sydney', state: 'NSW' },
      }));
      expect(e.accessToCentre.state).toBe('not_acquired');
      expect(e.accessToCentre.value).toBeNull();
      expect(e.amenities.state).toBe('not_acquired');
      expect(e.amenities.statement).toMatch(/capped at ten results and are quarantined/);
    });

    it('publishes no composite score at all', () => {
      const e = buildLocationEvidenceV2(inputs({}));
      expect(e).not.toHaveProperty('score');
      expect(e).not.toHaveProperty('walkScore');
      expect(e).not.toHaveProperty('total');
      expect(e.componentsTotal).toBe(4);
    });

    it('gives every component a statement a report can print', () => {
      const e = buildLocationEvidenceV2(inputs({}));
      for (const c of [e.transit, e.centre, e.accessToCentre, e.amenities]) {
        expect(c.statement.trim().length).toBeGreaterThan(20);
      }
    });
  });

  describe('neutrality — metro against regional', () => {
    const sydneyInner = buildLocationEvidenceV2(inputs({
      transport: stopsNearby(['nsw_sydney']),
      geography: { gccsaName: 'Greater Sydney', significantUrbanArea: 'Sydney', urbanCentre: 'Sydney', state: 'NSW' },
    }));
    const brisbaneInner = buildLocationEvidenceV2(inputs({
      transport: stopsNearby(['qld_seq']),
      geography: { gccsaName: 'Greater Brisbane', significantUrbanArea: 'Brisbane', urbanCentre: 'Brisbane', state: 'QLD' },
    }));
    const moranbah = buildLocationEvidenceV2(inputs({
      transport: null,
      geography: { gccsaName: 'Rest of Qld', significantUrbanArea: null, urbanCentre: 'Moranbah', state: 'QLD' },
    }));
    const perthInner = buildLocationEvidenceV2(inputs({
      transport: null,
      geography: { gccsaName: 'Greater Perth', significantUrbanArea: 'Perth', urbanCentre: 'Perth', state: 'WA' },
    }));

    it('never penalises a property for its state not publishing a feed', () => {
      // Perth is inner-metro with excellent transit; WA publishes no loaded feed.
      expect(perthInner.transit.state).toBe('not_covered');
      expect(perthInner.transit.value).toBeNull();
      // The absence must never be expressible as a low measured value.
      expect(perthInner.transit.statement).not.toMatch(/\b(poor|limited|few|no service)\b/i);
    });

    it('never compares a covered property against an uncovered one', () => {
      expect(evidenceIsComparable(sydneyInner, perthInner)).toBe(false);
      expect(evidenceIsComparable(sydneyInner, moranbah)).toBe(false);
    });

    it('compares two properties in the same tier with the same coverage', () => {
      expect(evidenceIsComparable(sydneyInner, brisbaneInner)).toBe(true);
    });

    it('gives a regional property its own centre, not a capital it has no tie to', () => {
      expect(moranbah.centre.state).toBe('measured');
      expect(moranbah.centre.value?.tier).toBe('local_centre');
      expect(moranbah.centre.value?.name).toBe('Moranbah');
      // The stored record measured this to Brisbane: 1,487 minutes.
      expect(moranbah.centre.value?.destination).toBeNull();
    });

    it('counts a regional property no worse than a metro one on components MEASURED', () => {
      // Both have their centre measured and their transit uncovered. Neither is
      // scored down for being where it is.
      expect(moranbah.componentsMeasured).toBe(perthInner.componentsMeasured);
    });
  });
});
