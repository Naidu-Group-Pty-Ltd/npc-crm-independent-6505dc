/**
 * The ABS boundary server as a geocoder of LAST resort for a suburb, and as
 * the authority on which council a point is in.
 *
 * `geo.abs.gov.au` serves the ASGS 2021 boundaries the report geography
 * already resolves through (`resolveOneReportGeography`). Two more questions
 * it answers, measured from production on 16 Sep 2026: a suburb's own polygon
 * by name (pg_net 246900, `Glenelg (SA)`, 3.9 KB of rings) and the council a
 * point falls in (246899: `144.7265, -37.8375` → `Wyndham`, `27260`).
 *
 * The centroid of the suburb's polygon is a `locality` answer — the same
 * grade the map already accepts for a record that carries only a suburb —
 * and it is the answer when OpenStreetMap has no street for the address.
 * It is never offered where a street was asked for and could have been
 * found: it is a floor, not a substitute.
 *
 * Two rules. **The name is matched under its ABS qualifier** — the ABS
 * writes `Glenelg (SA)`, `Richmond (Vic.)`, `Richmond (NSW)` where a name
 * repeats, so the query asks for both spellings and pins the state. **A
 * point's council is asked, never inferred from the suburb**: Truganina lies
 * in both Melton and Wyndham, and the measured point is in Wyndham.
 *
 * Pure: no Deno, no DOM, no network.
 */
import type { AuState } from '../auLocality.pure.ts';
import { ABS_STATE_NAMES } from './geocodeResult.pure.ts';

export const ASGS_REST_BASE = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021';
export const ABS_ATTRIBUTION = 'Australian Bureau of Statistics, ASGS Edition 3 (2021) digital boundaries, CC BY 4.0';

/** The qualifier the ABS appends to a suburb name that repeats across states. */
export const ABS_NAME_QUALIFIER: Record<AuState, string> = {
  NSW: 'NSW', VIC: 'Vic.', QLD: 'Qld', SA: 'SA', WA: 'WA', TAS: 'Tas.', NT: 'NT', ACT: 'ACT',
};

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** The SAL (suburb/locality) polygon query for a name in a state. */
export function salQueryUrl(suburb: string, state: AuState): string {
  const name = suburb.trim().replace(/\s+/g, ' ').toUpperCase();
  const qualified = `${name} (${ABS_NAME_QUALIFIER[state].toUpperCase()})`;
  const where = `UPPER(SAL_NAME_2021) IN (${sqlString(name)}, ${sqlString(qualified)}) AND STATE_NAME_2021 = ${sqlString(ABS_STATE_NAMES[state])}`;
  const params = new URLSearchParams({
    where,
    outFields: 'SAL_CODE_2021,SAL_NAME_2021,STATE_NAME_2021',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });
  return `${ASGS_REST_BASE}/SAL/MapServer/0/query?${params.toString()}`;
}

/** The LGA (council) point-in-polygon query. */
export function lgaPointQueryUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'LGA_CODE_2021,LGA_NAME_2021',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${ASGS_REST_BASE}/LGA/MapServer/0/query?${params.toString()}`;
}

export interface SalCentroid {
  code: string;
  name: string;
  state: string | null;
  lat: number;
  lng: number;
}

type Ring = ReadonlyArray<ReadonlyArray<number>>;

/** Signed area (shoelace) of a ring in degrees²; sign says orientation. */
function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** The area centroid of a ring; null for a degenerate one. */
function ringCentroid(ring: Ring): { lng: number; lat: number; area: number } | null {
  const a = signedArea(ring);
  if (!Number.isFinite(a) || Math.abs(a) < 1e-12) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return { lng: cx / (6 * a), lat: cy / (6 * a), area: Math.abs(a) };
}

/**
 * The first SAL feature's centroid. ArcGIS answers a polygon as `rings`,
 * outer rings clockwise and holes anticlockwise; a suburb with several outer
 * rings (an island, an exclave) is placed at the centroid of its LARGEST,
 * which is where the people are.
 */
export function parseSalFeature(json: unknown): SalCentroid | null {
  const feature = (json as { features?: Array<Record<string, unknown>> } | null)?.features?.[0];
  if (!feature) return null;
  const attrs = (feature.attributes ?? {}) as Record<string, unknown>;
  const rings = ((feature.geometry as { rings?: unknown } | undefined)?.rings ?? null) as Ring[] | null;
  if (!Array.isArray(rings) || !rings.length) return null;
  let best: { lng: number; lat: number; area: number } | null = null;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) continue;
    // A hole is anticlockwise in ArcGIS; the shoelace sign tells them apart.
    if (signedArea(ring) > 0) continue;
    const c = ringCentroid(ring);
    if (c && (!best || c.area > best.area)) best = c;
  }
  if (!best) {
    // Orientation is a convention, not a law; take the largest ring regardless.
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 4) continue;
      const c = ringCentroid(ring);
      if (c && (!best || c.area > best.area)) best = c;
    }
  }
  if (!best) return null;
  const code = typeof attrs.sal_code_2021 === 'string' ? attrs.sal_code_2021 : typeof attrs.SAL_CODE_2021 === 'string' ? attrs.SAL_CODE_2021 : null;
  const name = typeof attrs.sal_name_2021 === 'string' ? attrs.sal_name_2021 : typeof attrs.SAL_NAME_2021 === 'string' ? attrs.SAL_NAME_2021 : null;
  const state = typeof attrs.state_name_2021 === 'string' ? attrs.state_name_2021 : typeof attrs.STATE_NAME_2021 === 'string' ? attrs.STATE_NAME_2021 : null;
  if (!code || !name) return null;
  return { code, name, state, lat: best.lat, lng: best.lng };
}

export interface LgaHit { code: string; name: string }

/** The council a point query answered; null where the point is in none (offshore) or the answer is malformed. */
export function parseLgaPoint(json: unknown): LgaHit | null {
  const feature = (json as { features?: Array<Record<string, unknown>> } | null)?.features?.[0];
  const attrs = (feature?.attributes ?? null) as Record<string, unknown> | null;
  if (!attrs) return null;
  const code = typeof attrs.lga_code_2021 === 'string' ? attrs.lga_code_2021 : typeof attrs.LGA_CODE_2021 === 'string' ? attrs.LGA_CODE_2021 : null;
  const name = typeof attrs.lga_name_2021 === 'string' ? attrs.lga_name_2021 : typeof attrs.LGA_NAME_2021 === 'string' ? attrs.LGA_NAME_2021 : null;
  if (!code || !name) return null;
  return { code, name };
}
