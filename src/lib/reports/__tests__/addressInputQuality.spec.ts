import { describe, expect, it } from 'vitest';

import {
  assessAddressInput,
  assessCoordinateIsAPlace,
  OBSERVED_FAILURE_COORDINATES,
} from '@/lib/reports/location/addressInputQuality.pure';

/**
 * ME-5.1 item 7.
 *
 * Every string below is a verbatim `investment_reports.property_address` from
 * production. Invented fixtures would only prove the assertion matches the
 * fixture.
 */

/** Real addresses that produced a foreign or fallback coordinate. */
const CORRUPTED: Array<[string, string]> = [
  ['Unknown Property (recekKBh9NIZaebhq)', 'Airtable record id'],
  ['Property from Lot 2267 - Brochure - Parklea-151 (Lisbon - LHS).pdf', 'PDF filename → Lisbon'],
  ['Properties in 4510 Bellmore', 'listing fragment → New York'],
];

/** Real, legitimate addresses that carry NO Australian anchor and resolved correctly. */
const LEGITIMATE_UNANCHORED = [
  '42 Lowanna Drive',      // → Buddina, QLD
  '285 Old Toowoomba Road', // → Gatton, QLD
  '19 McDonald Street',     // → Mordialloc, VIC
  '8 Agett Way',            // → Northam, WA
  '2 Bliss Lane',           // → South Ripley, QLD
];

describe('address input quality', () => {
  describe('what is not an address is refused before the geocoder is called', () => {
    it.each(CORRUPTED)('refuses %j (%s)', (addr) => {
      const a = assessAddressInput(addr);
      expect(a.kind).toBe('not_an_address');
      expect(a.mayGeocode).toBe(false);
    });

    it('says why a geocoder must not simply be asked', () => {
      expect(assessAddressInput(CORRUPTED[0][0]).reason)
        .toMatch(/a geocoder always answers/);
    });

    it('refuses an empty address as absent rather than as garbage', () => {
      for (const empty of ['', '   ', null, undefined]) {
        const a = assessAddressInput(empty);
        expect(a.kind).toBe('absent');
        expect(a.mayGeocode).toBe(false);
      }
    });
  });

  describe('a missing Australian anchor is disclosed, never refused', () => {
    it.each(LEGITIMATE_UNANCHORED)('lets %j through while reporting it is unanchored', (addr) => {
      const a = assessAddressInput(addr);
      expect(a.kind).toBe('usable');
      expect(a.mayGeocode).toBe(true);
      expect(a.anchor).toBe('unanchored');
    });

    it('states the measured reason a required anchor was rejected as a gate', () => {
      expect(assessAddressInput('42 Lowanna Drive').reason).toMatch(/63\.7% of\s+legitimate/);
    });

    it('marks a properly anchored address as anchored', () => {
      for (const addr of [
        '54 Foxtail Circuit, Wallan VIC 3756, Australia',
        '23 MACKAY Street, Moranbah QLD 4744',
        '12/33 Bronte Street, East Perth, WA 6004',
      ]) {
        expect(assessAddressInput(addr).anchor).toBe('anchored');
        expect(assessAddressInput(addr).mayGeocode).toBe(true);
      }
    });

    it('an anchor does not rescue something that is not an address', () => {
      // Real: carries `WA` and a four-digit run, and geocoded to Washington State.
      const a = assessAddressInput('Properties in 4510 Bellmore');
      expect(a.anchor).toBe('anchored');
      expect(a.mayGeocode).toBe(false);
    });
  });

  describe('a fallback coordinate raises suspicion; context settles it', () => {
    it('confirms a failure when the request was not an address at all', () => {
      // The real pairing: 26 reports whose address is an Airtable record id,
      // every one of them on the Sydney CBD fallback.
      const v = assessCoordinateIsAPlace(-33.8688, 151.2093, {
        requestedAddress: 'Unknown Property (recekKBh9NIZaebhq)',
      });
      expect(v.verdict).toBe('confirmed_failure_value');
      expect(v.rejectOutright).toBe(true);
      expect(v.reason).toMatch(/positive evidence of a fallback/);
    });

    it('does NOT reject a genuine Sydney CBD property on the coordinate alone', () => {
      // The rule ME-5.1 item 4 asks for: the busiest postcode in the country
      // must stay geocodable.
      const v = assessCoordinateIsAPlace(-33.8688, 151.2093, {
        requestedAddress: '1 Martin Place, Sydney NSW 2000',
      });
      expect(v.verdict).toBe('plausible_genuine_location');
      expect(v.rejectOutright).toBe(false);
    });

    it('holds it as SUSPECTED when context neither confirms nor refutes', () => {
      const v = assessCoordinateIsAPlace(-33.8688, 151.2093, {
        requestedAddress: '42 Lowanna Drive',
      });
      expect(v.verdict).toBe('suspected_failure_value');
      expect(v.rejectOutright).toBe(false);
      expect(v.reason).toMatch(/needs a human or a stronger signal/);
    });

    it('rejects the continent centre outright — no property exists there', () => {
      const v = assessCoordinateIsAPlace(-25.2744, 133.7751, {
        requestedAddress: '42 Lowanna Drive',
      });
      expect(v.verdict).toBe('confirmed_failure_value');
      expect(v.rejectOutright).toBe(true);
    });

    it('passes any coordinate that is not an observed failure value', () => {
      for (const [lat, lng] of [
        [-21.9993496, 148.0641236],   // Moranbah QLD
        [-33.8712, 151.2065],         // a few hundred metres from the fallback
        [-31.9605, 115.8705],         // near Perth
      ]) {
        const v = assessCoordinateIsAPlace(lat, lng, { requestedAddress: '1 Some Street' });
        expect(v.verdict).toBe('not_a_known_failure');
        expect(v.rejectOutright).toBe(false);
      }
    });

    it('rejects a non-numeric coordinate rather than throwing', () => {
      expect(assessCoordinateIsAPlace('x', 151).rejectOutright).toBe(true);
      expect(assessCoordinateIsAPlace(null, undefined).rejectOutright).toBe(true);
    });

    it('only lists failure values this system has been OBSERVED to return', () => {
      // Item 5: measured failure behaviour drives rejection; a merely
      // suspicious coordinate does not belong here.
      expect(OBSERVED_FAILURE_COORDINATES.map((f) => [f.label, f.occurrences])).toEqual([
        ['Sydney CBD', 64],
        ['centre of the Australian continent', 2],
      ]);
      for (const f of OBSERVED_FAILURE_COORDINATES) {
        expect(f.occurrences).toBeGreaterThan(0);
        expect(f.why.length).toBeGreaterThan(30);
      }
    });
  });
});
