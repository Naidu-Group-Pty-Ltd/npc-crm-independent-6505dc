/**
 * ME-5 — the canonical geography resolver.
 *
 * ## THESE ARE NOT MARKET EVIDENCE
 *
 * Fixtures are controlled inputs exercising the RULES. Where a real place name
 * appears it is because the rule is about that name's FORM — `Fernvale (Qld)`
 * tests the ABS qualifier, not Fernvale.
 */
import { describe, expect, it } from 'vitest';

import {
  ASGS_RELEASE,
  type AsgsLookup,
  type DirectoryEntry,
  type Sa2Hierarchy,
  isGeographyReady,
  isPlausiblyAustralian,
  isValidCoordinate,
  normalisePlaceName,
  resolveGeography,
  rollUpGeography,
  stripLocalityQualifier,
  toStateAbbreviation,
} from '../../geography/asgsGeography.pure';

const area = (code: string, name: string) => ({ code, name });

const lookup = (o: Partial<AsgsLookup> = {}): AsgsLookup => ({
  sal: area('21643', 'Melton South'),
  poa: area('3338', '3338'),
  sa2: area('213041578', 'Melton South - Weir Views'),
  ra: area('20', 'Major Cities of Australia'),
  ucl: area('211002', 'Melton'),
  sua: area('2011', 'Melbourne'),
  salNeighbours: [area('21643', 'Melton South')],
  serviceFailed: false,
  ...o,
});

const hierarchy: Sa2Hierarchy = {
  sa2Code: '213041578', sa2Name: 'Melton South - Weir Views',
  sa3Name: 'Melton - Bacchus Marsh', sa4Name: 'Melbourne - West',
  gccsaName: 'Greater Melbourne', stateName: 'Victoria',
};

const directory: DirectoryEntry[] = [{ suburb: 'Melton South', state: 'VIC', postcode: '3338' }];
const MELTON = { latitude: -37.7136, longitude: 144.5619 };

describe('a coordinate is placed, or it is left unplaced', () => {
  it('resolves the full ASGS chain from one coordinate', () => {
    const g = resolveGeography({
      coordinate: MELTON, lookup: lookup(), hierarchy, directoryMatches: directory,
    });
    expect(g.status).toBe('resolved');
    expect(g.suburb).toBe('Melton South');
    expect(g.postcode).toBe('3338');
    expect(g.state).toBe('VIC');
    expect(g.gccsaName).toBe('Greater Melbourne');
    expect(g.remotenessArea).toBe('Major Cities of Australia');
    // The urban centre is Melton, not Melbourne — the item this exists for.
    expect(g.urbanCentre).toBe('Melton');
    expect(g.method).toBe('asgs_point_in_polygon');
    expect(g.sourceVersion).toBe(ASGS_RELEASE);
    expect(isGeographyReady(g)).toBe(true);
  });

  it('refuses a coordinate outside Australia rather than forcing a suburb', () => {
    const g = resolveGeography({
      // A real stored value's shape: northern hemisphere, North American longitude.
      coordinate: { latitude: 55.953, longitude: -122.304 },
      lookup: lookup(), hierarchy, directoryMatches: directory,
    });
    expect(g.status).toBe('unresolved');
    expect(g.flags).toContain('outside_australia');
    expect(g.suburb).toBeNull();
    expect(isGeographyReady(g)).toBe(false);
  });

  it('refuses (0,0), a missing coordinate and a non-finite one', () => {
    for (const c of [{ latitude: 0, longitude: 0 }, { latitude: Number.NaN, longitude: 1 }]) {
      expect(isValidCoordinate(c)).toBe(false);
      const g = resolveGeography({ coordinate: c, lookup: lookup(), hierarchy, directoryMatches: [] });
      expect(g.status).toBe('unresolved');
    }
    expect(resolveGeography({ coordinate: null, lookup: lookup(), hierarchy, directoryMatches: [] })
      .flags).toContain('missing_coordinate');
  });

  it('leaves a point in no polygon unplaced', () => {
    const g = resolveGeography({
      coordinate: { latitude: -35.0, longitude: 140.0 },
      lookup: lookup({ sal: null }), hierarchy, directoryMatches: [],
    });
    expect(g.status).toBe('unresolved');
    expect(g.flags).toContain('outside_all_polygons');
  });

  it('does not guess when the boundary service is unreachable', () => {
    const g = resolveGeography({
      coordinate: MELTON, lookup: lookup({ serviceFailed: true }), hierarchy, directoryMatches: directory,
    });
    expect(g.status).toBe('unresolved');
    expect(g.flags).toContain('boundary_service_unavailable');
    expect(g.notes[0]).toMatch(/safe to retry/);
  });
});

describe('ambiguity is surfaced, not hidden', () => {
  it('flags a coordinate near a locality boundary and names the neighbour', () => {
    const g = resolveGeography({
      coordinate: MELTON,
      lookup: lookup({ salNeighbours: [area('21643', 'Melton South'), area('21642', 'Melton West')] }),
      hierarchy, directoryMatches: directory,
    });
    expect(g.status).toBe('resolved_with_warning');
    expect(g.flags).toContain('near_locality_boundary');
    expect(g.notes.join(' ')).toContain('Melton West');
    // Still usable — a warning is not a refusal.
    expect(isGeographyReady(g)).toBe(true);
  });

  it('sends a cross-state disagreement to review, not to a warning', () => {
    const g = resolveGeography({
      coordinate: MELTON, lookup: lookup(), hierarchy,
      directoryMatches: [{ suburb: 'Melton South', state: 'NSW', postcode: '3338' }],
    });
    expect(g.status).toBe('requires_review');
    expect(g.flags).toContain('state_mismatch');
  });

  it('flags a postcode disagreement without blocking it', () => {
    const g = resolveGeography({
      coordinate: MELTON, lookup: lookup(), hierarchy,
      directoryMatches: [{ suburb: 'Melton South', state: 'VIC', postcode: '3337' }],
    });
    expect(g.status).toBe('resolved_with_warning');
    expect(g.flags).toContain('suburb_postcode_mismatch');
    expect(g.notes.join(' ')).toMatch(/suburbs can span postcodes/i);
  });

  it('keeps the ASGS answer when the directory has never heard of the suburb', () => {
    const g = resolveGeography({
      coordinate: MELTON, lookup: lookup(), hierarchy, directoryMatches: [],
    });
    expect(g.flags).toContain('suburb_not_in_directory');
    expect(g.suburb).toBe('Melton South');   // the boundary is still the authority
    expect(g.notes.join(' ')).toMatch(/cross-check/);
  });
});

describe('the ABS locality qualifier is a name format, not a geography error', () => {
  it('strips the qualifier for comparison and keeps it for storage', () => {
    expect(stripLocalityQualifier('Fernvale (Qld)')).toBe('Fernvale');
    expect(stripLocalityQualifier('Springfield (Ipswich - Qld)')).toBe('Springfield');
    expect(stripLocalityQualifier('Churchill (Vic.)')).toBe('Churchill');
    expect(stripLocalityQualifier('Melton South')).toBe('Melton South');
    // A bracket that is not a trailing qualifier is left alone.
    expect(stripLocalityQualifier('St Marys (South) Park')).toBe('St Marys (South) Park');
  });

  it('matches a qualified ABS name to a plain directory name', () => {
    expect(normalisePlaceName('Fernvale (Qld)')).toBe(normalisePlaceName('Fernvale'));
    expect(normalisePlaceName('Armadale (WA)')).toBe(normalisePlaceName('armadale'));
  });
});

describe('bounds and rollups', () => {
  it('accepts the external territories and refuses the northern hemisphere', () => {
    expect(isPlausiblyAustralian({ latitude: -54.5, longitude: 158.9 })).toBe(true);  // Macquarie
    expect(isPlausiblyAustralian({ latitude: -10.05, longitude: 142.2 })).toBe(true); // Torres Strait
    expect(isPlausiblyAustralian({ latitude: 55.953, longitude: -122.304 })).toBe(false);
    expect(isPlausiblyAustralian({ latitude: -36.85, longitude: 174.76 })).toBe(false); // Auckland
  });

  it('maps every ABS state name to the platform abbreviation', () => {
    expect(toStateAbbreviation('Victoria')).toBe('VIC');
    expect(toStateAbbreviation('New South Wales')).toBe('NSW');
    expect(toStateAbbreviation('Australian Capital Territory')).toBe('ACT');
    expect(toStateAbbreviation(null)).toBeNull();
    expect(toStateAbbreviation('Ruritania')).toBeNull();
  });

  it('counts what the validation report needs', () => {
    const ok = resolveGeography({ coordinate: MELTON, lookup: lookup(), hierarchy, directoryMatches: directory });
    const off = resolveGeography({
      coordinate: { latitude: 55.9, longitude: -122.3 }, lookup: lookup(), hierarchy, directoryMatches: directory,
    });
    const r = rollUpGeography([ok, ok, off]);
    expect(r.total).toBe(3);
    expect(r.byStatus.resolved).toBe(2);
    expect(r.byStatus.unresolved).toBe(1);
    expect(r.geographyReady).toBe(2);
    expect(r.byState.VIC).toBe(2);
    expect(r.byFlag.outside_australia).toBe(1);
    expect(r.byRemoteness['Major Cities of Australia']).toBe(2);
  });
});
