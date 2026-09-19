/**
 * Shared CSS-colour helpers: alpha-preserving normalisation (the renderer's
 * own normaliser strips rgba alpha) and gradient detection/fallback.
 */
import { describe, it, expect } from 'vitest';
import { parseCssColor, toRendererHex, applyAlphaToColor, isCssGradient, firstGradientStop } from '../cssColor';

describe('parseCssColor', () => {
  it('parses hex forms with and without alpha', () => {
    expect(parseCssColor('#0A2540')).toEqual({ r: 10, g: 37, b: 64, a: 1 });
    expect(parseCssColor('#0A254080')).toMatchObject({ r: 10, g: 37, b: 64 });
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('parses rgb()/rgba()', () => {
    expect(parseCssColor('rgb(245, 166, 35)')).toEqual({ r: 245, g: 166, b: 35, a: 1 });
    expect(parseCssColor('rgba(255, 255, 255, 0.1)')).toEqual({ r: 255, g: 255, b: 255, a: 0.1 });
  });

  it('rejects junk', () => {
    expect(parseCssColor('linear-gradient(#fff, #000)')).toBeNull();
    expect(parseCssColor('')).toBeNull();
  });
});

describe('toRendererHex', () => {
  it('keeps opaque colours as 6-digit hex', () => {
    expect(toRendererHex('rgb(10, 37, 64)')).toBe('#0A2540');
  });

  it('preserves alpha as 8-digit hex (the renderer passes #RRGGBBAA through)', () => {
    expect(toRendererHex('rgba(255, 255, 255, 0.1)')).toBe('#FFFFFF1A');
  });

  it('drops fully-transparent paints instead of collapsing them to black', () => {
    expect(toRendererHex('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(toRendererHex('transparent')).toBeUndefined();
  });
});

describe('applyAlphaToColor', () => {
  it('folds ExtGState alpha into the colour', () => {
    expect(applyAlphaToColor('#ffffff', 0.1)).toBe('#FFFFFF1A');
  });

  it('multiplies with existing alpha and keeps opaque untouched', () => {
    expect(applyAlphaToColor('#FFFFFF80', 0.5)).toBe('#FFFFFF40');
    expect(applyAlphaToColor('#0A2540', 1)).toBe('#0A2540');
  });

  it('passes unparseable values through', () => {
    expect(applyAlphaToColor('token:primary', 0.5)).toBe('token:primary');
  });
});

describe('gradients', () => {
  it('detects CSS gradients', () => {
    expect(isCssGradient('linear-gradient(135deg, rgb(10, 37, 64) 0%, rgb(26, 58, 90) 100%)')).toBe(true);
    expect(isCssGradient('radial-gradient(circle, #fff, #000)')).toBe(true);
    expect(isCssGradient('#ffffff')).toBe(false);
  });

  it('extracts a flat fallback colour from the first stop', () => {
    expect(firstGradientStop('linear-gradient(135deg, rgb(10, 37, 64) 0%, rgb(26, 58, 90) 100%)')).toBe('#0A2540');
    expect(firstGradientStop('no stops here')).toBeUndefined();
  });
});
