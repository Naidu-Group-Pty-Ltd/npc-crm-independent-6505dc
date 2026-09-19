import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearStreetViewCache,
  readStreetView,
  streetViewKey,
  writeStreetView,
} from './streetViewCache';

describe('streetViewCache', () => {
  beforeEach(clearStreetViewCache);

  it('misses cold', () => {
    expect(readStreetView(-31.94, 115.76)).toBeNull();
  });

  it('returns a stored panorama for the same location', () => {
    writeStreetView(-31.94, 115.76, { kind: 'image', dataUrl: 'data:image/jpeg;base64,x', date: '2024-03' });
    expect(readStreetView(-31.94, 115.76)).toEqual({
      kind: 'image',
      dataUrl: 'data:image/jpeg;base64,x',
      date: '2024-03',
    });
  });

  it('treats sub-metre jitter as the same camera position', () => {
    // A re-geocoded listing can move a few centimetres between passes; the
    // panorama it lands on is the same one, and re-fetching it spends two
    // metered calls to learn nothing.
    expect(streetViewKey(-31.940001, 115.760004)).toBe(streetViewKey(-31.94, 115.76));
    writeStreetView(-31.940001, 115.760004, { kind: 'none' });
    expect(readStreetView(-31.94, 115.76)).toEqual({ kind: 'none' });
  });

  it('caches the negative answer too — no-coverage is worth remembering', () => {
    writeStreetView(10, 20, { kind: 'none' });
    expect(readStreetView(10, 20)).toEqual({ kind: 'none' });
  });

  it('distinguishes genuinely different locations', () => {
    writeStreetView(10, 20, { kind: 'none' });
    expect(readStreetView(10.001, 20)).toBeNull();
  });
});
