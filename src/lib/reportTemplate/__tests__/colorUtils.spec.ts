import { describe, it, expect } from 'vitest';
import { contrastRatio, colorRamp, hexToCmyk } from '../colorUtils';

describe('contrastRatio', () => {
  it('returns the maximum ratio (21) for black on white', () => {
    const r = contrastRatio('#000000', '#ffffff')!;
    expect(r.ratio).toBe(21);
    expect(r.aaNormal).toBe(true);
    expect(r.aaaNormal).toBe(true);
    expect(r.grade).toBe('aaa');
  });

  it('returns 1 (fail) for identical colours', () => {
    const r = contrastRatio('#ffffff', '#ffffff')!;
    expect(r.ratio).toBe(1);
    expect(r.aaNormal).toBe(false);
    expect(r.grade).toBe('fail');
  });

  it('is symmetric and supports 3-digit hex', () => {
    expect(contrastRatio('#000', '#fff')!.ratio).toBe(21);
    expect(contrastRatio('#fff', '#000')!.ratio).toBe(21);
  });

  it('grades the AA / AAA thresholds correctly', () => {
    // mid-grey on white lands around 4.5 (the AA-normal boundary)
    const r = contrastRatio('#777777', '#ffffff')!;
    expect(r.ratio).toBeGreaterThan(3);
    expect(r.ratio).toBeLessThan(6);
    expect(r.aaLarge).toBe(true); // ratio >= 3
  });

  it('returns null for invalid hex', () => {
    expect(contrastRatio('nope', '#fff')).toBeNull();
    expect(contrastRatio('#fff', '#12g')).toBeNull();
  });
});

describe('colorRamp', () => {
  it('produces the 10 standard stops with 500 = the base colour', () => {
    const ramp = colorRamp('#3366cc');
    expect(Object.keys(ramp)).toEqual(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']);
    expect(ramp['500']).toBe('#3366cc'); // m=0 → unchanged
  });

  it('lightens toward 50 and darkens toward 900', () => {
    const ramp = colorRamp('#808080');
    // 50 is a tint (closer to white), 900 a shade (closer to black)
    expect(parseInt(ramp['50'].slice(1, 3), 16)).toBeGreaterThan(0x80);
    expect(parseInt(ramp['900'].slice(1, 3), 16)).toBeLessThan(0x80);
  });

  it('returns {} for invalid hex', () => {
    expect(colorRamp('not-a-color')).toEqual({});
  });
});

describe('hexToCmyk', () => {
  it('converts the primaries and neutrals', () => {
    expect(hexToCmyk('#ffffff')).toEqual({ c: 0, m: 0, y: 0, k: 0 });
    expect(hexToCmyk('#000000')).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    expect(hexToCmyk('#ff0000')).toEqual({ c: 0, m: 100, y: 100, k: 0 });
    expect(hexToCmyk('#00ff00')).toEqual({ c: 100, m: 0, y: 100, k: 0 });
    expect(hexToCmyk('#0000ff')).toEqual({ c: 100, m: 100, y: 0, k: 0 });
  });

  it('returns null for invalid hex', () => {
    expect(hexToCmyk('#xyz')).toBeNull();
  });
});
