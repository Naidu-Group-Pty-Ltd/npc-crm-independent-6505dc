import { describe, expect, it } from 'vitest';
import {
  assessAuPoint,
  normaliseAuState,
} from '../../supabase/functions/_shared/auGeoSanity.pure';

describe('assessAuPoint — country bounds', () => {
  it.each([
    ['Perth', -31.95, 115.86],
    ['Sydney', -33.87, 151.21],
    ['Hobart', -42.88, 147.33],
    ['South East Cape, Tasmania', -43.64, 146.83],
    ['Cairns', -16.92, 145.77],
    ['Broome', -17.96, 122.24],
    ['Alice Springs', -23.7, 133.88],
  ])('accepts %s', (_name, lat, lng) => {
    expect(assessAuPoint(lat, lng).ok).toBe(true);
  });

  it.each([
    ['the Southern Ocean below Tasmania', -46, 146],
    ['Wellington, New Zealand', -41.29, 174.78],
    ['Jakarta', -6.2, 106.85],
    ['the null island trap', 0, 0],
    ['a sign-flipped Sydney', 33.87, 151.21],
  ])('rejects %s as outside Australia', (_name, lat, lng) => {
    expect(assessAuPoint(lat, lng)).toEqual({ ok: false, reason: 'outside_australia' });
  });

  it('rejects non-finite coordinates instead of plotting NaN', () => {
    expect(assessAuPoint(Number.NaN, 151).ok).toBe(false);
  });
});

describe('assessAuPoint — state cross-check', () => {
  it('rejects a Perth coordinate claimed for a NSW listing', () => {
    expect(assessAuPoint(-31.95, 115.86, 'NSW')).toEqual({ ok: false, reason: 'wrong_state' });
  });

  it('rejects a Tasmanian-waters point claimed for a WA listing', () => {
    expect(assessAuPoint(-43.5, 147.0, 'WA')).toEqual({ ok: false, reason: 'wrong_state' });
  });

  it('accepts border towns on either side thanks to the padding', () => {
    // Albury sits on the NSW bank of the Murray; a geocoder answering the
    // Wodonga side must not disqualify the listing.
    expect(assessAuPoint(-36.12, 146.89, 'NSW').ok).toBe(true);
    expect(assessAuPoint(-36.08, 146.91, 'VIC').ok).toBe(true);
    // The ACT is an island in NSW; both claims are plausible around Canberra.
    expect(assessAuPoint(-35.28, 149.13, 'ACT').ok).toBe(true);
    expect(assessAuPoint(-35.28, 149.13, 'NSW').ok).toBe(true);
  });

  it('accepts full state names as well as codes', () => {
    expect(assessAuPoint(-31.95, 115.86, 'Western Australia').ok).toBe(true);
    expect(assessAuPoint(-31.95, 115.86, 'New South Wales').ok).toBe(false);
  });

  it('falls back to country bounds when the state is unknown or garbage', () => {
    expect(assessAuPoint(-31.95, 115.86, 'Unknown').ok).toBe(true);
    expect(assessAuPoint(-31.95, 115.86, null).ok).toBe(true);
    expect(assessAuPoint(-46, 146, 'Not A State').ok).toBe(false);
  });
});

describe('normaliseAuState', () => {
  it('maps names and codes to canonical codes', () => {
    expect(normaliseAuState('wa')).toBe('WA');
    expect(normaliseAuState('Queensland')).toBe('QLD');
    expect(normaliseAuState('  VIC ')).toBe('VIC');
    expect(normaliseAuState('Unknown')).toBeNull();
    expect(normaliseAuState('')).toBeNull();
    expect(normaliseAuState(null)).toBeNull();
  });
});
