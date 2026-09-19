/**
 * The ABS boundary server as a suburb's own point and a point's council —
 * pinned on the answers of 16 Sep 2026 (pg_net 246898, 246899, 246900).
 */
import { describe, expect, it } from 'vitest';

import { lgaPointQueryUrl, parseLgaPoint, parseSalFeature, salQueryUrl } from '@/lib/geocode/absLocality.pure';

// pg_net 246899 — the point on Leakes Road is in Wyndham, not Melton
const LGA_POINT = { displayFieldName: 'LGA_NAME_2021', features: [{ attributes: { lga_code_2021: '27260', lga_name_2021: 'Wyndham' } }] };
// A square: (138.51, -34.98) to (138.52, -34.97), clockwise as ArcGIS writes an outer ring
const SQUARE = [[138.51, -34.98], [138.51, -34.97], [138.52, -34.97], [138.52, -34.98], [138.51, -34.98]];
const SAL_SQUARE = {
  displayFieldName: 'SAL_NAME_2021', geometryType: 'esriGeometryPolygon', spatialReference: { wkid: 4326 },
  features: [{ attributes: { sal_code_2021: '40505', sal_name_2021: 'Glenelg (SA)', state_name_2021: 'South Australia' }, geometry: { rings: [SQUARE] } }],
};

describe('the questions', () => {
  it('asks for the suburb under both the plain and the ABS-qualified spelling, pinned to the state', () => {
    const url = new URL(salQueryUrl('Glenelg', 'SA'));
    expect(url.origin + url.pathname).toBe('https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SAL/MapServer/0/query');
    expect(url.searchParams.get('where')).toBe("UPPER(SAL_NAME_2021) IN ('GLENELG', 'GLENELG (SA)') AND STATE_NAME_2021 = 'South Australia'");
    expect(url.searchParams.get('returnGeometry')).toBe('true');
    expect(url.searchParams.get('outSR')).toBe('4326');
    expect(new URL(salQueryUrl("O'Connor", 'WA')).searchParams.get('where')).toContain("'O''CONNOR'");
    expect(new URL(salQueryUrl('Richmond', 'VIC')).searchParams.get('where')).toContain("'RICHMOND (VIC.)'");
  });

  it('asks the council layer with the point as lng,lat in WGS84', () => {
    const url = new URL(lgaPointQueryUrl(-37.8375, 144.7265));
    expect(url.pathname).toContain('/ASGS2021/LGA/MapServer/0/query');
    expect(url.searchParams.get('geometry')).toBe('144.7265,-37.8375');
    expect(url.searchParams.get('geometryType')).toBe('esriGeometryPoint');
    expect(url.searchParams.get('spatialRel')).toBe('esriSpatialRelIntersects');
  });
});

describe('the answers', () => {
  it('reads the council by name and code', () => {
    expect(parseLgaPoint(LGA_POINT)).toEqual({ code: '27260', name: 'Wyndham' });
    expect(parseLgaPoint({ features: [] })).toBeNull();
    expect(parseLgaPoint(null)).toBeNull();
  });

  it('places a suburb at the centroid of its polygon', () => {
    const c = parseSalFeature(SAL_SQUARE)!;
    expect(c.code).toBe('40505');
    expect(c.name).toBe('Glenelg (SA)');
    expect(c.state).toBe('South Australia');
    expect(c.lng).toBeCloseTo(138.515, 6);
    expect(c.lat).toBeCloseTo(-34.975, 6);
  });

  it('takes the largest outer ring of a suburb with several, and ignores holes', () => {
    const small = [[138.6, -34.9], [138.6, -34.899], [138.601, -34.899], [138.601, -34.9], [138.6, -34.9]];
    const hole = [[138.512, -34.978], [138.518, -34.978], [138.518, -34.972], [138.512, -34.972], [138.512, -34.978]]; // anticlockwise
    const c = parseSalFeature({ features: [{ attributes: { sal_code_2021: '1', sal_name_2021: 'X' }, geometry: { rings: [small, SQUARE, hole] } }] })!;
    expect(c.lng).toBeCloseTo(138.515, 6);
    expect(c.lat).toBeCloseTo(-34.975, 6);
  });

  it('answers nothing for no feature, no rings, or a degenerate ring', () => {
    expect(parseSalFeature({ features: [] })).toBeNull();
    expect(parseSalFeature({ features: [{ attributes: { sal_code_2021: '1', sal_name_2021: 'X' }, geometry: { rings: [] } }] })).toBeNull();
    expect(parseSalFeature({ features: [{ attributes: { sal_code_2021: '1', sal_name_2021: 'X' }, geometry: { rings: [[[1, 1], [1, 1], [1, 1], [1, 1]]] } }] })).toBeNull();
  });
});
