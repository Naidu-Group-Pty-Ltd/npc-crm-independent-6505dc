/**
 * Which layer is each unread jurisdiction's ZONE, and what does it answer at a
 * point? The step between "the publisher's directory answers" and "a parser
 * is verified against a real response".
 *
 * ── Where this sits ──────────────────────────────────────────────────────
 *
 * `jurisdictionLayerProbe.pure.ts` established reachability and licence from
 * metadata alone (22 Sep 2026): South Australia's state spatial service
 * answers with 131 services across 30 folders, Western Australia's SLIP root
 * answers with five folders, and the Northern Territory's NTLIS sits behind a
 * bot-protection challenge. It deliberately made no feature query. What it
 * could not say is WHICH layer carries the zone, what that layer's fields are
 * called, and what it returns at a real coordinate — and `SA_NOTE` says,
 * correctly, that none of it is read because no parser has been verified
 * against a response nobody here has seen.
 *
 * This module is what finds the layer and shapes the one question that
 * verifies a parser: a point query at a public coordinate in each capital.
 * Nothing in it is a layer id anybody typed — ids come from the publisher's
 * own directory, walked by the publisher's own folder names — and the only
 * typed things are HOSTS, as in `LAYER_CANDIDATES`, whose failures are
 * printed rather than hidden.
 *
 * ── Two routes, because they fail differently ────────────────────────────
 *
 * A jurisdiction's open-data catalogue names datasets WITH their licence and
 * the service they are served from; a service directory names layers with
 * none of that. So both are asked, and a layer found in a directory is
 * reported beside the catalogue's statement of its terms where one exists.
 * WA's is the case that matters: `WA_LICENCE_NOTE` was typed from SLIP's
 * public terms, and whether the planning scheme zones are also offered under
 * an open licence is a question for the catalogue, not for memory.
 *
 * Deno-compatible: explicit `.ts` extensions, no `@/` aliases. Writes nothing.
 */
import type { VolumeDataset } from '../reports/market/openData/salesVolumePublishers.pure.ts';

export type UnreadZoneJurisdiction = 'SA' | 'WA' | 'NT';

export const UNREAD_ZONE_JURISDICTIONS: readonly UnreadZoneJurisdiction[] = ['SA', 'WA', 'NT'];

/**
 * Each jurisdiction's own CKAN catalogue. WA's and the NT's answered from CI
 * on 22 Sep 2026 (`sales-volume-liveness`); South Australia's is the root its
 * portal documents, typed, and printed with whatever it answers.
 */
export const ZONE_CATALOGUES: Readonly<Record<UnreadZoneJurisdiction, { root: string; measured: boolean }>> = {
  SA: { root: 'https://data.sa.gov.au/data/api/3', measured: false },
  WA: { root: 'https://catalogue.data.wa.gov.au/api/3', measured: true },
  NT: { root: 'https://data.nt.gov.au/api/3', measured: true },
};

export const ZONE_QUERIES: readonly string[] = [
  'planning zones',
  'zoning',
  'planning scheme zones',
  'land use zones',
];

/** A dataset's own words name a planning zone. */
export const ZONE_WORDS = /\bzon(?:e|es|ing)\b/i;
export const PLANNING_WORDS = /\bplanning\b|\bscheme\b|\bdesign code\b|\bland use\b/i;

/**
 * The ArcGIS REST service root a URL belongs to, or null.
 *
 * `…/rest/services/Folder/Name/MapServer/12/query?x` → `…/rest/services/Folder/Name/MapServer`.
 * A layer id or operation on the end is stripped so the SERVICE is asked for
 * its own layer list; the layer the zone lives in is then read from it.
 */
export function arcgisServiceRootOf(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const m = /^(.*\/rest\/services\/.+?\/(?:MapServer|FeatureServer))(?:\/.*)?$/i.exec(url.pathname);
  if (!m) return null;
  return `https://${url.host}${m[1]}`;
}

export interface ZoneDatasetJudgement {
  dataset: VolumeDataset;
  zone: boolean;
  /** ArcGIS service roots its resources point at, de-duplicated. */
  services: string[];
  formats: string[];
}

export function judgeZoneDataset(dataset: VolumeDataset): ZoneDatasetJudgement {
  const words = [dataset.title, dataset.notes].filter((w): w is string => typeof w === 'string').join(' · ');
  const services = [...new Set(dataset.resources.map((r) => arcgisServiceRootOf(r.url)).filter((s): s is string => s !== null))];
  return {
    dataset,
    zone: ZONE_WORDS.test(words) && PLANNING_WORDS.test(words),
    services,
    formats: [...new Set(dataset.resources.map((r) => r.format).filter((f) => f !== ''))],
  };
}

/** Zone datasets first, those served from a queryable service above those that are not. */
export function rankZoneDatasets(datasets: readonly VolumeDataset[]): ZoneDatasetJudgement[] {
  return datasets
    .map(judgeZoneDataset)
    .filter((j) => j.zone)
    .sort((a, b) => Number(b.services.length > 0) - Number(a.services.length > 0));
}

/** A service in a directory worth opening: its name speaks of planning or zones. */
export const ZONE_SERVICE_PATTERN = /zon|plan|scheme|design.?code|landuse|land_use/i;

/** A layer inside a service that is the zone itself, not a precinct, overlay or label. */
export const ZONE_LAYER_PATTERN = /\bzon(?:e|es|ing)\b|zones?_|_zones?\b|zoning/i;
export const NOT_A_ZONE_LAYER = /\boverlay|\bprecinct|\blabel|annotation|\bboundar|sub-?zone|policy area/i;

export function isZoneLayerName(name: string): boolean {
  return ZONE_LAYER_PATTERN.test(name) && !NOT_A_ZONE_LAYER.test(name);
}

export interface ServiceLayer { id: number; name: string; geometryType: string | null }

/** A service's own layer list, with ids — `parseArcgisAnswer` keeps only names. */
export function readServiceLayers(text: string): ServiceLayer[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const layers = (body as { layers?: unknown })?.layers;
  if (!Array.isArray(layers)) return null;
  const out: ServiceLayer[] = [];
  for (const raw of layers) {
    const l = raw as Record<string, unknown>;
    if (typeof l.id !== 'number' || typeof l.name !== 'string') continue;
    out.push({ id: l.id, name: l.name, geometryType: typeof l.geometryType === 'string' ? l.geometryType : null });
  }
  return out;
}

export interface LayerField { name: string; alias: string | null; type: string | null }

export interface LayerDescription {
  name: string | null;
  geometryType: string | null;
  fields: LayerField[];
  /** What the layer says about its own terms and currency, verbatim. */
  copyrightText: string | null;
  description: string | null;
}

export function readLayerDescription(text: string): LayerDescription | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const o = body as Record<string, unknown>;
  if (!o || typeof o !== 'object' || o.error) return null;
  const fields = Array.isArray(o.fields)
    ? (o.fields as unknown[]).map((f) => {
      const r = f as Record<string, unknown>;
      return {
        name: typeof r.name === 'string' ? r.name : '',
        alias: typeof r.alias === 'string' ? r.alias : null,
        type: typeof r.type === 'string' ? r.type : null,
      };
    }).filter((f) => f.name !== '')
    : [];
  const text2 = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return {
    name: text2(o.name),
    geometryType: text2(o.geometryType),
    fields,
    copyrightText: text2(o.copyrightText),
    description: text2(o.description),
  };
}

/**
 * Public places in each capital, for the one question that verifies a parser.
 *
 * A capital's centre and an established residential suburb, because a zone
 * layer that answers the CBD with a city-centre zone and a suburb with a
 * residential one has been read correctly twice — one point can agree with a
 * wrong field by accident. Coordinates are of public places, not of any
 * client's property.
 */
export const ZONE_PROBE_POINTS: Readonly<Record<UnreadZoneJurisdiction, ReadonlyArray<{ place: string; lng: number; lat: number }>>> = {
  SA: [
    { place: 'Adelaide city centre (Victoria Square)', lng: 138.6007, lat: -34.9285 },
    { place: 'Prospect (Prospect Road)', lng: 138.5947, lat: -34.8837 },
  ],
  WA: [
    { place: 'Perth city centre (Forrest Place)', lng: 115.8599, lat: -31.9522 },
    { place: 'Mount Lawley (Beaufort Street)', lng: 115.8740, lat: -31.9340 },
  ],
  NT: [
    { place: 'Darwin city centre (Smith Street)', lng: 130.8418, lat: -12.4634 },
    { place: 'Nightcliff', lng: 130.8526, lat: -12.3833 },
  ],
};

/**
 * The point query, in the shape `buildActZoningQuery` has run in production:
 * `x,y` with `inSR=4326`, intersects, every field, no geometry.
 */
export function buildZonePointQuery(layerUrl: string, lng: number, lat: number): string {
  const p = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${layerUrl.replace(/\/+$/, '')}/query?${p}`;
}

export type PointAnswer =
  | { kind: 'features'; attributes: Record<string, unknown>[] }
  | { kind: 'none_at_point' }
  | { kind: 'error'; message: string };

/** A point query's answer. An ArcGIS error inside a 200 is an error, read first. */
export function readPointAnswer(text: string): PointAnswer {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { kind: 'error', message: `not JSON: ${JSON.stringify(text.slice(0, 160))}` };
  }
  const o = body as Record<string, unknown>;
  const err = o?.error as Record<string, unknown> | undefined;
  if (err && typeof err === 'object') {
    return { kind: 'error', message: `ArcGIS error ${String(err.code ?? '?')}: ${String(err.message ?? '')}` };
  }
  if (!Array.isArray(o?.features)) return { kind: 'error', message: 'no features array' };
  const attributes = (o.features as unknown[])
    .map((f) => (f as { attributes?: Record<string, unknown> }).attributes)
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object');
  return attributes.length === 0 ? { kind: 'none_at_point' } : { kind: 'features', attributes };
}

// ---------------------------------------------------------------------------
// Second pass, 23 Sep 2026: which of a directory's services to ask
// ---------------------------------------------------------------------------

/*
 * The first CI run walked South Australia's directory — 131 services across
 * 30 folders — and asked the first twelve whose names matched
 * `ZONE_SERVICE_PATTERN`. Seven of the twelve were print and export
 * GEOPROCESSING tools (`PlanSA/CodeAmendments_Print/GPServer`), one was a
 * historical site plan, and the two layers named as zones were a transport
 * PERMIT zone and a tree-canopy PRIORITY zone. The Planning and Design Code's
 * own zone layer was never asked, because the order was the directory's
 * rather than the question's.
 *
 * So a service is ranked for the question before it is asked: types that
 * cannot answer a point query are not services to ask, names that describe a
 * tool or a different kind of "zone" are pushed down, and the planning code's
 * own vocabulary is pulled up. Only what scores above zero is asked.
 */
export interface DirectoryService {
  /** `Folder/Name`, as the directory names it. */
  path: string;
  /** `MapServer`, `FeatureServer`, `GPServer`, … */
  type: string;
}

/** Service types a point query cannot be put to. */
export const UNQUERYABLE_SERVICE_TYPES = /^(?:GPServer|GeometryServer|GeocodeServer|NAServer|GlobeServer|SceneServer|VectorTileServer|ImageServer|StreamServer|SearchServer|MobileServer|UtilityNetworkServer)$/i;

/** Names that describe a tool, a picture or a different kind of zone. */
export const NOT_A_PLANNING_ZONE_SERVICE =
  /print|export|geoprocess|locator|basemap|base_map|historical|imagery|aerial|photo|permit|priority|speed|project_zone|climate|water|storm|surge|flood|fire|bushfire|noise|school|electoral|census/i;

export function zoneServiceScore(service: DirectoryService): number {
  if (UNQUERYABLE_SERVICE_TYPES.test(service.type)) return -Infinity;
  const name = service.path;
  let score = 0;
  if (/zon(?:e|es|ing)/i.test(name)) score += 4;
  if (/design.?code|\bpdc\b|_code\b|code_/i.test(name)) score += 3;
  if (/plansa|planning|sappa|atlas/i.test(name)) score += 2;
  if (/scheme|landuse|land_use/i.test(name)) score += 1;
  if (NOT_A_PLANNING_ZONE_SERVICE.test(name)) score -= 6;
  return score;
}

/** The services worth asking, most promising first; nothing that scores at or below zero. */
export function rankZoneServices(services: readonly DirectoryService[]): DirectoryService[] {
  return services
    .map((s) => ({ s, score: zoneServiceScore(s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.path.localeCompare(b.s.path))
    .map((x) => x.s);
}

/** `Folder/Name (MapServer)` → `{ path: 'Folder/Name', type: 'MapServer' }`, as `parseArcgisAnswer` renders a directory entry. */
export function directoryEntry(rendered: string): DirectoryService | null {
  const m = /^(.+?) \((\w+)\)$/.exec(rendered.trim());
  return m ? { path: m[1], type: m[2] } : null;
}

/**
 * The ArcGIS Online web map a "MAP VIEWER" resource opens, where it names one.
 *
 * South Australia's *Planning and Design Code Zones* dataset carried SHP,
 * GeoJSON and KML files and a MAP VIEWER, and no service URL: the service is
 * inside the web map, whose own definition names it. A web map id is 32 hex
 * characters, passed as `webmap=` or `id=`.
 */
export function webmapIdOf(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  for (const key of ['webmap', 'id', 'appid']) {
    const v = url.searchParams.get(key);
    if (v && /^[0-9a-f]{32}$/i.test(v)) return v.toLowerCase();
  }
  return null;
}

/** The definition URL for a web map's operational layers. */
export function webmapDataUrl(id: string): string {
  return `https://www.arcgis.com/sharing/rest/content/items/${encodeURIComponent(id)}/data?f=json`;
}

/** Every service a web map's operational layers name, as service roots. */
export function webmapServiceRoots(text: string): string[] {
  let body: unknown;
  try { body = JSON.parse(text); } catch { return []; }
  const out = new Set<string>();
  const visit = (layers: unknown) => {
    if (!Array.isArray(layers)) return;
    for (const raw of layers) {
      const l = raw as { url?: unknown; layers?: unknown };
      if (typeof l.url === 'string') {
        const root = arcgisServiceRootOf(l.url);
        if (root) out.add(root);
      }
      visit(l.layers);
    }
  };
  const o = body as { operationalLayers?: unknown; baseMap?: unknown };
  visit(o?.operationalLayers);
  return [...out];
}
