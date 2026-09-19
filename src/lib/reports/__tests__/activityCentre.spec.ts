import { describe, expect, it } from 'vitest';

import {
  CAPITAL_GCCSA,
  centresAreComparable,
  isAbsencePolygon,
  resolveActivityCentre,
  type GeographyForCentre,
} from '@/lib/reports/location/activityCentre.pure';

/**
 * ME-5 items 9–10 — which centre, and the metro bias that follows from getting
 * it wrong.
 *
 * The corpus measured all 931 placed reports to a state capital. Under this
 * rule only 587 belong to a capital's labour market: 344 (37%) were being
 * graded on a journey to a city they have no relationship with.
 */
const geo = (o: Partial<GeographyForCentre>): GeographyForCentre => ({
  gccsaName: null, significantUrbanArea: null, urbanCentre: null, state: null, ...o,
});

describe('activity centre', () => {
  describe('tier 1 — a capital’s own labour market', () => {
    it('routes a property inside a Greater capital to that capital', () => {
      const centre = resolveActivityCentre(geo({ gccsaName: 'Greater Perth', urbanCentre: 'Perth' }));
      expect(centre.tier).toBe('capital_labour_market');
      expect(centre.name).toBe('Perth');
      expect(centre.destination?.lat).toBeCloseTo(-31.95, 1);
      expect(centre.measurable).toBe(true);
    });

    it('names exactly the eight GCCSAs that are a capital', () => {
      expect(Object.keys(CAPITAL_GCCSA).sort()).toEqual([
        'Australian Capital Territory', 'Greater Adelaide', 'Greater Brisbane',
        'Greater Darwin', 'Greater Hobart', 'Greater Melbourne', 'Greater Perth',
        'Greater Sydney',
      ]);
    });

    it('does NOT route a "Rest of" GCCSA to the capital', () => {
      // 92 Sunshine Coast reports sit in "Rest of Qld" and were measured to Brisbane.
      const centre = resolveActivityCentre(geo({
        gccsaName: 'Rest of Qld', significantUrbanArea: 'Sunshine Coast',
      }));
      expect(centre.tier).toBe('significant_urban_area');
      expect(centre.name).toBe('Sunshine Coast');
      expect(centre.destination).toBeNull();
    });
  });

  describe('tier 2 — a significant urban area', () => {
    it('prefers the SUA over the urban centre inside it', () => {
      const centre = resolveActivityCentre(geo({
        gccsaName: 'Rest of Vic.',
        significantUrbanArea: 'Traralgon - Morwell',
        urbanCentre: 'Traralgon',
      }));
      expect(centre.tier).toBe('significant_urban_area');
      expect(centre.name).toBe('Traralgon - Morwell');
    });

    it('measures nothing rather than measuring to a polygon centroid', () => {
      const centre = resolveActivityCentre(geo({ significantUrbanArea: 'Gympie' }));
      expect(centre.measurable).toBe(false);
      expect(centre.destination).toBeNull();
      expect(centre.reason).toMatch(/rather than measured to a guess/);
    });
  });

  describe('tier 3 — the town itself, and what it does not claim', () => {
    it('falls back to the urban centre and says it is local, not a commute', () => {
      const centre = resolveActivityCentre(geo({
        gccsaName: 'Rest of Qld', urbanCentre: 'Moranbah',
      }));
      expect(centre.tier).toBe('local_centre');
      expect(centre.name).toBe('Moranbah');
      expect(centre.reason).toMatch(/where it is rather than necessarily where its residents work/);
    });

    it('strips an ABS state qualifier from the name', () => {
      expect(resolveActivityCentre(geo({ urbanCentre: 'Richmond (Vic.)' })).name).toBe('Richmond');
    });
  });

  describe('the ABS tiles the continent, so absence arrives as a named polygon', () => {
    it.each([
      'Not in any Significant Urban Area (Qld)',
      'Not in any Urban Centre or Locality (NSW)',
      'No usual address (Vic.)',
      'Migratory - Offshore - Shipping (WA)',
    ])('treats %j as absence, not a place', (name) => {
      expect(isAbsencePolygon(name)).toBe(true);
      expect(resolveActivityCentre(geo({ significantUrbanArea: name })).tier).toBe('none');
    });

    it('never invents a centre from a filler polygon', () => {
      const centre = resolveActivityCentre(geo({
        gccsaName: 'Rest of Qld',
        significantUrbanArea: 'Not in any Significant Urban Area (Qld)',
        urbanCentre: 'Not in any Urban Centre or Locality (Qld)',
      }));
      expect(centre.tier).toBe('none');
      expect(centre.name).toBeNull();
      expect(centre.measurable).toBe(false);
      expect(centre.reason).toMatch(/Absent, not distant/);
    });

    it('does not mistake a real place for absence', () => {
      for (const real of ['Nottingham', 'Northam', 'Notting Hill', 'Nowra - Bomaderry']) {
        expect(isAbsencePolygon(real)).toBe(false);
      }
    });
  });

  describe('neutrality — a regional property is not graded on a city it has no tie to', () => {
    const perth = resolveActivityCentre(geo({ gccsaName: 'Greater Perth' }));
    const moranbah = resolveActivityCentre(geo({ gccsaName: 'Rest of Qld', urbanCentre: 'Moranbah' }));
    const sunshine = resolveActivityCentre(geo({
      gccsaName: 'Rest of Qld', significantUrbanArea: 'Sunshine Coast',
    }));

    it('never compares an access figure across tiers', () => {
      expect(centresAreComparable(perth, moranbah)).toBe(false);
      expect(centresAreComparable(perth, sunshine)).toBe(false);
      expect(centresAreComparable(moranbah, sunshine)).toBe(false);
    });

    it('compares within a tier', () => {
      const melbourne = resolveActivityCentre(geo({ gccsaName: 'Greater Melbourne' }));
      expect(centresAreComparable(perth, melbourne)).toBe(true);
    });

    it('never treats two unplaced properties as comparable', () => {
      const nowhere = resolveActivityCentre(geo({}));
      expect(centresAreComparable(nowhere, nowhere)).toBe(false);
    });

    it('gives a regional property a centre rather than a long journey to a capital', () => {
      // The stored record measured this to Brisbane: 1,487 minutes.
      expect(moranbah.name).toBe('Moranbah');
      expect(moranbah.destination).toBeNull();
      expect(moranbah.tier).not.toBe('capital_labour_market');
    });
  });
});
