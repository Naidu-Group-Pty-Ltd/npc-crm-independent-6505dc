/**
 * The map must not ask a tile service for a zoom it does not publish.
 *
 * Esri answers a tile outside its cache with **HTTP 200** and a grey image
 * reading "Map data not yet available" — measured 18 Sep 2026 from the
 * production egress over Sydney CBD, Traralgon and Kirwan: one fixed
 * 2,521-byte PNG, identical at every coordinate, appearing at exactly one zoom
 * level past each configured `maxNativeZoom`. Because it is a 200 carrying a
 * valid image, Leaflet's `tileerror` never fires, so nothing in the product can
 * notice; the only defence is not asking.
 *
 * The map draws `detectRetina`, and Leaflet's retina branch adds a zoom offset
 * to the URL while leaving `maxNativeZoom` alone — so on any HiDPI screen every
 * request at the cap was one level past it. That is the 19 Sep 2026 clone
 * audit's "map data not yet available" past a zoom level, and it is a property
 * of the screen rather than of the deployment.
 */
import { describe, expect, it } from 'vitest';

import { BASEMAP_CATALOG, effectiveMaxNativeZoom } from '../listingsMap';

/**
 * The deepest zoom each Esri service answered with a REAL tile, at all three
 * Australian points probed. A number here is a measurement, not a preference —
 * re-measure before changing one.
 */
const MEASURED_DEEPEST_REAL_ZOOM: Record<string, number> = {
  'World_Street_Map': 19,
  'Canvas/World_Dark_Gray_Base': 16,
  'Canvas/World_Dark_Gray_Reference': 16,
  // z18 at Traralgon, z19 at Kirwan, z20 at Sydney — the floor is what binds.
  'World_Imagery': 18,
  'Reference/World_Boundaries_and_Places': 19,
};

function serviceOf(url: string): string {
  const match = /services\/(.+?)\/MapServer/.exec(url);
  return match ? match[1] : url;
}

describe('effectiveMaxNativeZoom', () => {
  it('leaves the cap alone where Leaflet adds no offset', () => {
    expect(effectiveMaxNativeZoom(19, false)).toBe(19);
    expect(effectiveMaxNativeZoom(16, false)).toBe(16);
  });

  it('absorbs the offset detectRetina adds', () => {
    // Leaflet: `options.zoomOffset++` and the URL zoom is
    // `_clampZoom(mapZoom) + zoomOffset`, so the cap must come down by one or
    // every request at the top asks for a tile that does not exist.
    expect(effectiveMaxNativeZoom(19, true)).toBe(18);
    expect(effectiveMaxNativeZoom(16, true)).toBe(15);
  });

  it('never goes negative', () => {
    expect(effectiveMaxNativeZoom(0, true)).toBe(0);
  });
});

describe('basemap caps against what the services actually publish', () => {
  const entries = Object.values(BASEMAP_CATALOG);

  it('covers every basemap in the catalogue', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const basemap of entries) {
      expect(MEASURED_DEEPEST_REAL_ZOOM[serviceOf(basemap.url)]).toBeDefined();
    }
  });

  it('never requests past the cache, on a standard screen', () => {
    for (const basemap of entries) {
      const deepest = MEASURED_DEEPEST_REAL_ZOOM[serviceOf(basemap.url)];
      expect(
        effectiveMaxNativeZoom(basemap.maxNativeZoom, false),
        `${basemap.id} base`,
      ).toBeLessThanOrEqual(deepest);
    }
  });

  it('never requests past the cache on a HiDPI screen either', () => {
    // The request zoom is the effective cap PLUS the retina offset of one.
    for (const basemap of entries) {
      const deepest = MEASURED_DEEPEST_REAL_ZOOM[serviceOf(basemap.url)];
      const requested = effectiveMaxNativeZoom(basemap.maxNativeZoom, true) + 1;
      expect(requested, `${basemap.id} base on HiDPI`).toBeLessThanOrEqual(deepest);
    }
  });

  it('holds for the label overlays, which carry no retina offset', () => {
    // They are drawn without `detectRetina`, so their request zoom is the
    // configured cap itself.
    for (const basemap of entries) {
      if (!basemap.labelsUrl) continue;
      const deepest = MEASURED_DEEPEST_REAL_ZOOM[serviceOf(basemap.labelsUrl)];
      expect(basemap.maxNativeZoom, `${basemap.id} labels`).toBeLessThanOrEqual(deepest);
    }
  });

  it('keeps Esri row-before-column in every url', () => {
    // {z}/{y}/{x}. Written {x}/{y} it fetches the transpose of the tile it
    // meant to, which reads as a map of the wrong part of the world.
    for (const basemap of entries) {
      expect(basemap.url).toContain('/tile/{z}/{y}/{x}');
      if (basemap.labelsUrl) expect(basemap.labelsUrl).toContain('/tile/{z}/{y}/{x}');
    }
  });

  it('needs no API key anywhere', () => {
    // A clone has nowhere to inherit a tile account from, and a VITE_ token is
    // inlined into every clone's bundle.
    for (const basemap of entries) {
      for (const url of [basemap.url, basemap.labelsUrl].filter(Boolean) as string[]) {
        expect(url).not.toMatch(/api[_-]?key|apikey|access[_-]?token|\{key\}/i);
      }
    }
  });
});
