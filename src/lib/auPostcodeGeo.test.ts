import { describe, expect, it } from 'vitest';
import {
  assessAuPostcodePoint,
  normaliseAuPostcode,
} from '../../supabase/functions/_shared/auPostcodeGeo.pure';

describe('assessAuPostcodePoint', () => {
  it('catches the wrong end of the right state — the case no other gate can see', () => {
    // Doonan QLD 4562 (Sunshine Coast) plotted at Cairns: inside Queensland,
    // ~1,400km from its postcode. This is the production screenshot bug.
    const verdict = assessAuPostcodePoint(-16.92, 145.77, '4562');
    expect(verdict).toEqual({ ok: false, reason: 'wrong_region', checked: true });
  });

  it('accepts the same postcode at its actual location', () => {
    // Doonan itself.
    expect(assessAuPostcodePoint(-26.42, 152.99, '4562').ok).toBe(true);
  });

  it.each([
    ['Perth CBD in 6000', -31.95, 115.86, '6000'],
    ['Margaret River in the South West band', -33.95, 115.07, '6285'],
    ['Bondi in Sydney metro', -33.89, 151.27, '2026'],
    ['Hobart in 7000', -42.88, 147.33, '7000'],
    ['Cairns in its own band', -16.92, 145.77, '4870'],
    ['Darwin in 0800 with the leading zero', -12.46, 130.84, '0800'],
  ])('accepts %s', (_name, lat, lng, postcode) => {
    expect(assessAuPostcodePoint(lat, lng, postcode).ok).toBe(true);
  });

  it.each([
    ['a Perth-postcode listing plotted in Sydney', -33.87, 151.21, '6000'],
    ['a Melbourne-postcode listing plotted in Brisbane', -27.47, 153.02, '3000'],
  ])('rejects %s', (_name, lat, lng, postcode) => {
    expect(assessAuPostcodePoint(lat, lng, postcode).ok).toBe(false);
  });

  it('skips postcodes it has no band for, and says so', () => {
    // 4825 reaches Mount Isa, half a continent from the coast — deliberately
    // unlisted, so it can never hold a correct listing back.
    const verdict = assessAuPostcodePoint(-20.72, 139.49, '4825');
    expect(verdict).toEqual({ ok: true, checked: false });
  });

  it('skips missing or malformed postcodes', () => {
    expect(assessAuPostcodePoint(-33.87, 151.21, null).checked).toBe(false);
    expect(assessAuPostcodePoint(-33.87, 151.21, 'QLD').checked).toBe(false);
    expect(assessAuPostcodePoint(-33.87, 151.21, '12').checked).toBe(false);
  });

  it('tolerates band edges — boundary suburbs are never adjudicated', () => {
    // Just outside the Sydney metro box, inside the padding.
    expect(assessAuPostcodePoint(-34.6, 150.7, '2233').ok).toBe(true);
  });
});

describe('normaliseAuPostcode', () => {
  it('handles strings, numbers and NT leading zeros', () => {
    expect(normaliseAuPostcode('4562')).toBe(4562);
    expect(normaliseAuPostcode(4562)).toBe(4562);
    expect(normaliseAuPostcode('0800')).toBe(800);
    expect(normaliseAuPostcode(' 6000 ')).toBe(6000);
    expect(normaliseAuPostcode('postcode')).toBeNull();
    expect(normaliseAuPostcode('')).toBeNull();
  });
});
