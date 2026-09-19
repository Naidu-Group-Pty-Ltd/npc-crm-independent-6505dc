/**
 * The SITE half of Property Risk: parcel identity, and register queries at
 * parcel geometry — because **an address-point identify describes the POINT,
 * and is never clearance for a parcel.**
 *
 * ## What the measurements said (18 September 2026, this egress — evidence
 * in `docs/reports/evidence/PARCEL_PROBE_2026-09-18.json`)
 *
 *   * Queensland's cadastre answers a lot POLYGON at a coordinate: layer 4
 *     (`Cadastral parcels`) of `PlanningCadastre/LandParcelPropertyFramework`,
 *     HTTP 200 in ~240 ms, fields `lot`, `plan`, `lotplan`, `tenure`,
 *     `lot_area`, `locality`, one ring of 9 vertices at the Pallas subject.
 *   * A register's identify ACCEPTS that polygon: FloodCheck answered the
 *     same subject at point and at parcel (HTTP 200, ~320 ms, POST), so the
 *     sweep can move to parcel grain with no new provider.
 *   * NSW's `NSW_Cadastre/9 (Lot)` now answers its query in ~420 ms — the
 *     earlier 40-second stall was not the service's steady state — and the
 *     stored enrichment coordinate for the NSW subject lies on **no lot**:
 *     a street-grade point answers `no_lot_at_point`, which is a fact about
 *     the coordinate, not about the parcel.
 *
 * ## The rule the measurements forced: a coordinate yields a CANDIDATE
 *
 * Probed at nominally the SAME subject (262 Pallas Street), two geocodes of
 * the address resolved two different lot/plans — `2RP87802` on the earlier
 * measurement, `3SP239114` on this one. At least one of those coordinates
 * selects a neighbouring parcel. So nothing here returns a parcel
 * *identity* from a coordinate: {@link resolveParcelCandidate} returns a
 * **candidate**, its caveat written in the sentence, and confirming the
 * lot/plan against the contract or title is an operator act this module
 * deliberately cannot perform. The `MAP_PIN_PLACEMENT` and
 * `DUPLICATE_RECORDS` lessons apply verbatim: a guess that selects the
 * neighbour's parcel is worse than a named absence.
 *
 * ## What a sweep may conclude
 *
 * {@link assessSiteSweep} — the interpretation, and nothing else:
 *
 *   * a POSITIVE (an intersection) is valid at either grain — a point inside
 *     the parcel that intersects a layer means the parcel intersects it;
 *   * a COMPLETED NEGATIVE exists only where the sweep ran at PARCEL grain
 *     and every consulted register completed;
 *   * a point-grain sweep that found nothing is `negative_at_point_only` —
 *     stated as what it is, never as clearance;
 *   * anything else is `incomplete`.
 *
 * **No conversion.** `CONVERSIONS` in `riskEvidenceConnection.pure.ts` stays
 * frozen empty; nothing here produces a number, and the verdict vocabulary
 * shares no value with any scoring outcome.
 */

import type { RiskEvidenceReading } from './riskEvidenceConnection.pure.ts';
import { coverageOf } from './riskEvidenceConnection.pure.ts';

export const PARCEL_GEOMETRY_VERSION = '1.0.0' as const;

// ---------------------------------------------------------------------------
// Parcel identity — sources, builders, parsers
// ---------------------------------------------------------------------------

export const QLD_CADASTRE_SOURCE =
  'Queensland Land Parcel Property Framework — Cadastral parcels (layer 4)';
export const QLD_CADASTRE_LICENCE = 'CC BY 4.0';
const QLD_BASE = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services';
/** Pinned by measurement: layers 3 and 8 also answer; 4 is the cadastral set. */
export const QLD_CADASTRE_LAYER = 4;

export const NSW_CADASTRE_SOURCE = 'NSW Spatial Services — NSW_Cadastre, layer 9 (Lot)';
export const NSW_CADASTRE_LICENCE = 'CC BY 4.0';
const NSW_CADASTRE = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer';

export function buildQldParcelQuery(lng: number, lat: number): string {
  const p = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'lot,plan,lotplan,tenure,lot_area,locality',
    returnGeometry: 'true',
    outSR: '4326',
  });
  return `${QLD_BASE}/PlanningCadastre/LandParcelPropertyFramework/MapServer/${QLD_CADASTRE_LAYER}/query?${p}`;
}

export function buildNswParcelQuery(lng: number, lat: number): string {
  const p = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'lotidstring,lotnumber,planlabel',
    returnGeometry: 'true',
    outSR: '4326',
  });
  return `${NSW_CADASTRE}/9/query?${p}`;
}

/** A lot polygon in WGS84 rings, as ArcGIS serves it. */
export interface ParcelPolygon {
  readonly rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
}

export interface ParcelCandidate {
  readonly jurisdiction: 'QLD' | 'NSW';
  /** The register's own identifier, e.g. `3SP239114` or `4//DP1145931`. */
  readonly lotPlan: string;
  readonly geometry: ParcelPolygon;
  /** Publisher-stated square metres, where the layer carries it. */
  readonly areaM2: number | null;
  readonly locality: string | null;
  readonly register: string;
  readonly licence: string;
}

/**
 * How a parcel lookup resolved. `resolved_candidate` is deliberately not
 * `resolved`: the module header records two geocodes of one address
 * resolving two different lots, so a coordinate-selected parcel is a
 * candidate until a person confirms the lot/plan against the record.
 */
export type ParcelResolution =
  | { readonly kind: 'resolved_candidate'; readonly parcel: ParcelCandidate; readonly caveat: string }
  | { readonly kind: 'no_lot_at_point'; readonly statement: string }
  | { readonly kind: 'unavailable'; readonly detail: string };

export const PARCEL_CANDIDATE_CAVEAT =
  'The lot was selected by the assessment coordinate, and a geocoded coordinate can select a '
  + 'neighbouring parcel — measured: two geocodes of one address resolved two different lots. '
  + 'Confirm the lot/plan against the contract or title before relying on parcel-grain findings.';

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

interface ArcgisFeature {
  attributes?: Record<string, unknown>;
  geometry?: { rings?: number[][][] };
}
interface ArcgisQueryBody { features?: ArcgisFeature[]; error?: { message?: string } }

function firstFeature(body: unknown):
  | { kind: 'ok'; feature: ArcgisFeature }
  | { kind: 'empty' }
  | { kind: 'error'; message: string } {
  const b = body as ArcgisQueryBody | null;
  if (!b || typeof b !== 'object') return { kind: 'error', message: 'non-object response' };
  if (b.error) return { kind: 'error', message: str(b.error.message) ?? 'service error' };
  if (!Array.isArray(b.features)) return { kind: 'error', message: 'no features array in response' };
  if (b.features.length === 0) return { kind: 'empty' };
  return { kind: 'ok', feature: b.features[0] };
}

function ringsOf(feature: ArcgisFeature): ParcelPolygon | null {
  const rings = feature.geometry?.rings;
  if (!Array.isArray(rings) || rings.length === 0) return null;
  return { rings: rings as ParcelPolygon['rings'] };
}

export function parseQldParcel(body: unknown): ParcelResolution {
  const f = firstFeature(body);
  if (f.kind === 'error') return { kind: 'unavailable', detail: f.message };
  if (f.kind === 'empty') {
    return {
      kind: 'no_lot_at_point',
      statement: 'The cadastre holds no lot at the assessment coordinate — a street-grade point '
        + 'lies in road reserve or between lots. This is a fact about the coordinate, never about '
        + 'the parcel, and no parcel-grain reading can be made from it.',
    };
  }
  const a = f.feature.attributes ?? {};
  const geometry = ringsOf(f.feature);
  const lotPlan = str(a.lotplan) ?? (str(a.lot) && str(a.plan) ? `${str(a.lot)}${str(a.plan)}` : null);
  if (!geometry || !lotPlan) {
    return { kind: 'unavailable', detail: 'feature answered without a lot/plan or a polygon' };
  }
  return {
    kind: 'resolved_candidate',
    parcel: {
      jurisdiction: 'QLD',
      lotPlan,
      geometry,
      areaM2: num(a.lot_area),
      locality: str(a.locality),
      register: QLD_CADASTRE_SOURCE,
      licence: QLD_CADASTRE_LICENCE,
    },
    caveat: PARCEL_CANDIDATE_CAVEAT,
  };
}

export function parseNswParcel(body: unknown): ParcelResolution {
  const f = firstFeature(body);
  if (f.kind === 'error') return { kind: 'unavailable', detail: f.message };
  if (f.kind === 'empty') {
    return {
      kind: 'no_lot_at_point',
      statement: 'The cadastre holds no lot at the assessment coordinate — measured for the NSW '
        + 'validation subject, whose stored enrichment coordinate lies on no lot. This is a fact '
        + 'about the coordinate, never about the parcel.',
    };
  }
  const a = f.feature.attributes ?? {};
  const geometry = ringsOf(f.feature);
  const lotPlan = str(a.lotidstring)
    ?? (str(a.lotnumber) && str(a.planlabel) ? `${str(a.lotnumber)}//${str(a.planlabel)}` : null);
  if (!geometry || !lotPlan) {
    return { kind: 'unavailable', detail: 'feature answered without a lot identifier or a polygon' };
  }
  return {
    kind: 'resolved_candidate',
    parcel: {
      jurisdiction: 'NSW',
      lotPlan,
      geometry,
      areaM2: null,
      locality: null,
      register: NSW_CADASTRE_SOURCE,
      licence: NSW_CADASTRE_LICENCE,
    },
    caveat: PARCEL_CANDIDATE_CAVEAT,
  };
}

/**
 * One entry point per jurisdiction the platform can resolve today. The
 * jurisdictions NOT listed are absent rather than guessed — the same honesty
 * `RegisterOutcome.not_served` carries.
 */
export const PARCEL_RESOLVERS: Readonly<Record<'QLD' | 'NSW', {
  readonly build: (lng: number, lat: number) => string;
  readonly parse: (body: unknown) => ParcelResolution;
}>> = Object.freeze({
  QLD: { build: buildQldParcelQuery, parse: parseQldParcel },
  NSW: { build: buildNswParcelQuery, parse: parseNswParcel },
});

export function resolveParcelCandidate(
  jurisdiction: string,
  body: unknown,
): ParcelResolution {
  const r = PARCEL_RESOLVERS[jurisdiction as 'QLD' | 'NSW'];
  if (!r) {
    return {
      kind: 'unavailable',
      detail: `No parcel register is integrated for ${jurisdiction || 'this jurisdiction'}; the sweep stays at point grain and says so.`,
    };
  }
  return r.parse(body);
}

// ---------------------------------------------------------------------------
// Register queries at parcel geometry
// ---------------------------------------------------------------------------

/**
 * An identify request carrying the PARCEL polygon instead of the point.
 *
 * POST, because a lot polygon's vertices do not belong in a URL — and
 * measured working that way (FloodCheck, HTTP 200, ~320 ms). Everything else
 * matches `buildIdentifyUrl`: `tolerance: 0`, explicit layers, no geometry
 * returned.
 */
export function buildParcelIdentify(
  mapServer: string,
  parcel: ParcelPolygon,
  layers: 'all' | number[],
): { url: string; method: 'POST'; contentType: string; body: string } {
  const xs = parcel.rings.flat().map(([x]) => x);
  const ys = parcel.rings.flat().map(([, y]) => y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const p = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ rings: parcel.rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    sr: '4326',
    layers: Array.isArray(layers) ? `all:${layers.join(',')}` : 'all',
    tolerance: '0',
    mapExtent: `${minX},${minY},${maxX},${maxY}`,
    imageDisplay: '400,400,96',
    returnGeometry: 'false',
  });
  return {
    url: `${mapServer}/identify`,
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    body: p.toString(),
  };
}

// ---------------------------------------------------------------------------
// Interpretation — positive, completed negative, incomplete
// ---------------------------------------------------------------------------

/** Which geometry the sweep's queries carried. */
export type SweepBasis = 'point' | 'parcel';

/**
 * What a sweep established. Three different answers to "was anything found",
 * never collapsed — the user's own vocabulary: positive, completed negative,
 * incomplete. A point-grain negative gets its own reading because it is the
 * one that reads as clearance and is not.
 */
export type SiteSweepVerdict =
  | 'constraint_intersects'
  | 'completed_negative_at_parcel'
  | 'negative_at_point_only'
  | 'incomplete';

export interface SiteSweepReading {
  readonly version: string;
  readonly basis: SweepBasis;
  readonly verdict: SiteSweepVerdict;
  /** From `coverageOf`, retained whole so nothing is inferred from the verdict. */
  readonly coverage: ReturnType<typeof coverageOf>;
  readonly statement: string;
}

export function assessSiteSweep(
  readings: readonly RiskEvidenceReading[],
  basis: SweepBasis,
): SiteSweepReading {
  const coverage = coverageOf(readings);
  const base = { version: PARCEL_GEOMETRY_VERSION, basis, coverage };

  if (coverage.withIntersection > 0) {
    return {
      ...base,
      verdict: 'constraint_intersects',
      statement: 'At least one register maps a constraint that intersects the subject. A positive '
        + 'is valid at either grain: a point inside the parcel that intersects a layer means the '
        + 'parcel intersects it.',
    };
  }
  if (coverage.answered === 0 || !coverage.complete) {
    return {
      ...base,
      verdict: 'incomplete',
      statement: coverage.answered === 0
        ? 'No register completed for this subject, so the sweep establishes nothing in either direction.'
        : `The sweep is incomplete: ${coverage.incomplete.join(', ')} did not complete, and on a `
          + 'partial set nothing found is not a finding.',
    };
  }
  if (basis === 'parcel') {
    return {
      ...base,
      verdict: 'completed_negative_at_parcel',
      statement: 'Every consulted register completed against the parcel polygon and none maps a '
        + 'constraint that intersects it. This is a completed negative for the registers consulted '
        + '— a statement about those registers, never about hazards no register maps.',
    };
  }
  return {
    ...base,
    verdict: 'negative_at_point_only',
    statement: 'Every consulted register completed and none maps a constraint at the assessment '
      + 'POINT. A point-in-polygon identify describes the point, not the parcel: a layer that '
      + 'misses the point may still cross the lot, so this is not clearance and is never read as '
      + 'a completed negative.',
  };
}
