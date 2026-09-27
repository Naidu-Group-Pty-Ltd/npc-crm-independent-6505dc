/**
 * The Australian Government's Infrastructure Investment Program, read at the
 * property's own coordinate — the one forward infrastructure register that
 * reaches every locality in the country.
 * ------------------------------------------------------------------------
 *
 * ## Why this exists
 *
 * The Compass for 37 Bolin Street, Tallawong (27 Sep 2026) said "no major
 * public project within 15 km", three times "Not covered by this report", and
 * rated nothing because it had nothing — while a $520 million upgrade of
 * Richmond Road was under construction 4 km away, a $150 million second stage
 * beside it, a $440 million upgrade of Garfield Road East was funded to start
 * in 2027, and a new $500 million Richmond Bridge was being built. Every one of
 * those is published, by the department that funds it, with a coordinate, a
 * status, a cost, the Australian Government's share and an expected start and
 * end. None of it was read, because `PROGRAMME_PUBLISHERS` recorded New South
 * Wales's forward programme as a PUBLICATION (budget papers, agency pages) and
 * no register reached the other seven jurisdictions at all either, apart from
 * Queensland's QTRIP.
 *
 * ## The register, measured (27 Sep 2026, from a GitHub runner)
 *
 * The Department of Infrastructure, Transport, Regional Development,
 * Communications, Sport and the Arts lists the dataset in its own catalogue
 * (`investment-infrastructure-programs`, licence `cc-by`, mirrored on
 * data.gov.au) and serves it from its own ArcGIS server, keyless:
 *
 * | layer | features | what it holds |
 * | --- | ---: | --- |
 * | `AuslinkGIS_Line_web` | 61,762 | road and rail projects drawn as their alignment |
 * | `AuslinkGIS_Point_web` | 1,134 | projects at a single location |
 * | `AuslinkGIS_Poly_web` | 59 | allocations to a whole region or jurisdiction |
 *
 * Status, in the publisher's own words, across the line layer: Completed
 * 58,798 · Not Started 1,677 · Underway 812 · In Planning 304 · Under
 * Construction 169 · Not Currently Proceeding 2. Sub-programme: Roads to
 * Recovery 55,369 · Black Spot 5,641 · Investment Road and Rail Program 684 ·
 * and six small national programmes. A live-project query (status not
 * `Completed`) within 15 km answered 46 features at Tallawong NSW, 42 at
 * Kellyville NSW, 10 at Golden Square VIC, 2 at Maryborough QLD and 13 (plus
 * two regional allocations) at Geraldton WA.
 *
 * ## Four rules
 *
 * 1. **A project is named only as the register names it**, status in the
 *    publisher's own word. `Under Construction` maps onto this platform's
 *    `under_construction` through `readDeliveryStanding`; `In Planning`,
 *    `Underway` and `Not Started` map onto nothing and are printed verbatim.
 * 2. **Maintenance is not a pipeline.** Roads to Recovery and Black Spot are
 *    resurfacing, patching and intersection safety — 61,000 of the 62,000
 *    lines — and a list of them buries the one project a reader needs. They
 *    are counted and named as a class, never itemised, unless a single item's
 *    stated cost reaches `MAJOR_PROJECT_FLOOR`. Whole-jurisdiction allocations
 *    (the polygon layer) describe a region, not a place near the property, and
 *    are not read.
 * 3. **An expected date is the publisher's EXPECTATION**, never a completion.
 *    The register publishes `ExpectedStartDate` and `ExpectedEndDate` as the
 *    Department writes them ("Early 2026", "Late 2028", "TBC"); they are kept
 *    as text, bucketed into a horizon only when a year can be read from them,
 *    and "TBC" is a statement that no date has been set.
 * 4. **The estimated cost and the Australian Government's contribution are two
 *    different figures**, and both are the Department's. The contribution is
 *    never presented as the whole cost, and a whole cost is never presented as
 *    federal money.
 *
 * The Department's own dashboard carries a standing notice — "we are
 * investigating an issue causing some project information to be missing or
 * out-of-date" — so the reading says so beside every list.
 *
 * Deno-compatible: no imports.
 */

export const IPAMS_BASE = 'https://spatial.infrastructure.gov.au/server/rest/services/iPAMS-DB';
export const IPAMS_SOURCE =
  'Infrastructure Investment Program, Australian Government Department of Infrastructure, Transport, '
  + 'Regional Development, Communications, Sport and the Arts';
/** The dataset's licence in the Department's own catalogue (`investment-infrastructure-programs`). */
export const IPAMS_LICENCE = 'CC BY';
/** The Department's own caveat on its dashboard, verbatim in substance. */
export const IPAMS_CAVEAT =
  'The Department notes on its own project map that it is investigating an issue causing some project '
  + 'information to be missing or out of date, so each entry should be checked on its project page.';

/** The two layers a place-based question can be put to. See rule 2 for the third. */
export const IPAMS_LAYERS = ['AuslinkGIS_Line_web', 'AuslinkGIS_Point_web'] as const;
export type IpamsLayer = typeof IPAMS_LAYERS[number];

/** How far from the property a project is asked about. */
export const NATIONAL_PROGRAMME_RADIUS_KM = 15;
/** A single maintenance or safety item this large is itemised as a project (rule 2). */
export const MAJOR_PROJECT_FLOOR = 10_000_000;
/** The programmes whose items are maintenance and safety works, not the pipeline (rule 2). */
export const MINOR_WORKS_PROGRAMMES: readonly string[] = ['Roads to Recovery Program', 'Black Spot Projects'];
/** How many projects a report itemises; the rest are counted. */
export const NATIONAL_PROGRAMME_ITEM_CAP = 12;

const OUT_FIELDS = [
  'Project_ID', 'ProjectName', 'ProjectStatus', 'SubProgram', 'TransportMode',
  'EstimatedProjectCost', 'AGC', 'ExpectedStartDate', 'ExpectedEndDate', 'State', 'URL',
].join(',');

/**
 * The query for live projects within `radiusKm` of a point, on one layer.
 *
 * Geometry comes back in WGS84 and generalised to about 50 m, which is ample to
 * measure how far the works are from the property and keeps a long alignment
 * from costing a megabyte.
 */
export function ipamsQuery(layer: IpamsLayer, lat: number, lon: number, radiusKm: number): string {
  const params = new URLSearchParams({
    where: "ProjectStatus <> 'Completed'",
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(Math.round(radiusKm * 1000)),
    units: 'esriSRUnit_Meter',
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.0005',
    f: 'json',
  });
  return `${IPAMS_BASE}/${layer}/MapServer/0/query?${params.toString()}`;
}

export interface NationalProject {
  id: string;
  name: string;
  /** The Department's status word, verbatim. */
  status: string | null;
  subProgram: string | null;
  mode: string | null;
  estimatedCost: number | null;
  /** The Australian Government's contribution — its own column, never the whole cost (rule 4). */
  australianGovernmentContribution: number | null;
  /** As the Department writes it: "Early 2026", "Late 2028", "TBC" (rule 3). */
  expectedStart: string | null;
  expectedEnd: string | null;
  state: string | null;
  /** The Department's own project page, where it links one. */
  url: string | null;
  /** Straight-line kilometres from the property to the nearest point of the works. */
  distanceKm: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().replace(/\s+/g, ' ') : null;

/** "$520,000,000" → 520000000. Anything without a digit is null, never zero. */
export function parseMoney(v: unknown): number | null {
  const s = str(v);
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "Richmond Road, Quakers Hill - 129973-24NSW-RTR" → "Richmond Road, Quakers Hill". */
export function cleanName(name: string, id: string | null): string {
  const trimmed = id ? name.replace(new RegExp(`\\s*-\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '') : name;
  return trimmed.trim();
}

const R_EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Equirectangular kilometres from the origin — exact enough at 15 km, and used only to rank and state distance. */
function planar(origin: { lat: number; lon: number }, lat: number, lon: number): [number, number] {
  const x = toRad(lon - origin.lon) * Math.cos(toRad(origin.lat)) * R_EARTH_KM;
  const y = toRad(lat - origin.lat) * R_EARTH_KM;
  return [x, y];
}

function distanceToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = p; const [ax, ay] = a; const [bx, by] = b;
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Nearest distance from the origin to a feature's geometry, or null when it carries none. */
export function geometryDistanceKm(geometry: unknown, origin: { lat: number; lon: number }): number | null {
  if (!isRecord(geometry)) return null;
  const o: [number, number] = [0, 0];
  if (typeof geometry.x === 'number' && typeof geometry.y === 'number') {
    return Math.hypot(...planar(origin, geometry.y, geometry.x));
  }
  const paths = Array.isArray(geometry.paths) ? geometry.paths : Array.isArray(geometry.rings) ? geometry.rings : null;
  if (!paths) return null;
  let best: number | null = null;
  for (const path of paths) {
    if (!Array.isArray(path)) continue;
    const pts = path
      .filter((pt): pt is [number, number] => Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number')
      .map(([x, y]) => planar(origin, y, x));
    if (pts.length === 1) best = Math.min(best ?? Infinity, Math.hypot(...pts[0]));
    for (let i = 1; i < pts.length; i += 1) {
      const d = distanceToSegment(o, pts[i - 1], pts[i]);
      best = best === null ? d : Math.min(best, d);
    }
  }
  return best;
}

export type IpamsParse =
  | { ok: true; projects: NationalProject[]; truncated: boolean }
  | { ok: false; reason: string };

/**
 * One layer's answer, as projects. A project drawn as several features — a
 * long alignment is — is one project at the distance of its nearest part.
 */
export function parseIpamsAnswer(body: unknown, origin: { lat: number; lon: number }): IpamsParse {
  if (!isRecord(body)) return { ok: false, reason: 'the answer was not a JSON object' };
  if (isRecord(body.error)) {
    return { ok: false, reason: `the service answered an error: ${str(body.error.message) ?? 'unstated'}` };
  }
  if (!Array.isArray(body.features)) return { ok: false, reason: 'the answer carried no feature list' };
  const byId = new Map<string, NationalProject>();
  for (const f of body.features) {
    if (!isRecord(f) || !isRecord(f.attributes)) continue;
    const a = f.attributes;
    const id = str(a.Project_ID);
    const rawName = str(a.ProjectName);
    if (!id || !rawName) continue;
    const distanceKm = geometryDistanceKm(f.geometry, origin);
    const url = str(a.URL);
    const project: NationalProject = {
      id,
      name: cleanName(rawName, id),
      status: str(a.ProjectStatus),
      subProgram: str(a.SubProgram),
      mode: str(a.TransportMode),
      estimatedCost: parseMoney(a.EstimatedProjectCost),
      australianGovernmentContribution: parseMoney(a.AGC),
      expectedStart: str(a.ExpectedStartDate),
      expectedEnd: str(a.ExpectedEndDate),
      state: str(a.State),
      url: url ? url.replace(/^http:\/\//i, 'https://') : null,
      distanceKm: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
    };
    const seen = byId.get(id);
    if (!seen || (project.distanceKm !== null && (seen.distanceKm === null || project.distanceKm < seen.distanceKm))) {
      byId.set(id, project);
    }
  }
  return { ok: true, projects: [...byId.values()], truncated: body.exceededTransferLimit === true };
}

/** Several layers' projects as one list, one row per project id, nearest reading kept. */
export function mergeProjects(...lists: NationalProject[][]): NationalProject[] {
  const byId = new Map<string, NationalProject>();
  for (const p of lists.flat()) {
    const seen = byId.get(p.id);
    if (!seen || (p.distanceKm !== null && (seen.distanceKm === null || p.distanceKm < seen.distanceKm))) byId.set(p.id, p);
  }
  return [...byId.values()];
}

/** Rule 2: part of the pipeline, or maintenance and safety works counted as a class. */
export function isMajorProject(p: NationalProject): boolean {
  if (p.status && /not currently proceeding/i.test(p.status)) return false;
  const minor = p.subProgram !== null && MINOR_WORKS_PROGRAMMES.includes(p.subProgram);
  return !minor || (p.estimatedCost ?? 0) >= MAJOR_PROJECT_FLOOR;
}

/** The year an expected date names, where it names one: "Late 2028" → 2028; "TBC" → null. */
export function yearOf(expected: string | null): number | null {
  const m = /\b(20\d{2})\b/.exec(expected ?? '');
  return m ? Number(m[1]) : null;
}

export type Horizon = 'next_two_years' | 'three_to_five_years' | 'six_to_ten_years' | 'beyond_ten_years';

export const HORIZON_LABEL: Readonly<Record<Horizon, string>> = {
  next_two_years: 'Within two years',
  three_to_five_years: 'Three to five years',
  six_to_ten_years: 'Six to ten years',
  beyond_ten_years: 'Beyond ten years',
};

/**
 * Which horizon a publisher's expected end falls in, counted from `year`.
 * Null where the publisher named no year — "TBC" is not a horizon.
 */
export function horizonOf(expectedEnd: string | null, year: number): Horizon | null {
  const y = yearOf(expectedEnd);
  if (y === null) return null;
  const ahead = y - year;
  if (ahead <= 2) return 'next_two_years';
  if (ahead <= 5) return 'three_to_five_years';
  if (ahead <= 10) return 'six_to_ten_years';
  return 'beyond_ten_years';
}

/** The published timing, as one sentence that cannot be read as a completion (rule 3). */
export function timingSentence(p: NationalProject): string | null {
  const start = p.expectedStart && !/^(tbc|tbd|tba)$/i.test(p.expectedStart) ? p.expectedStart : null;
  const end = p.expectedEnd && !/^(tbc|tbd|tba)$/i.test(p.expectedEnd) ? p.expectedEnd : null;
  if (!start && !end) {
    return p.expectedStart || p.expectedEnd
      ? 'The Department states the timing is still to be confirmed.'
      : null;
  }
  return [
    start ? `Expected start ${start}` : null,
    end ? `expected end ${end}` : null,
  ].filter(Boolean).join('; ') + ' — the Department’s own expectation, not a completion date.';
}

export interface NationalProgrammeReading {
  /** Projects itemised, nearest first, at most `NATIONAL_PROGRAMME_ITEM_CAP`. */
  major: NationalProject[];
  /** Pipeline projects beyond the cap, counted rather than itemised. */
  majorNotItemised: number;
  /** Maintenance and safety works inside the radius, counted as a class (rule 2). */
  minorWorks: number;
}

/** Split a merged answer into what is itemised and what is counted. */
export function readNationalProgramme(projects: readonly NationalProject[]): NationalProgrammeReading {
  const major = projects
    .filter(isMajorProject)
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.name.localeCompare(b.name));
  return {
    major: major.slice(0, NATIONAL_PROGRAMME_ITEM_CAP),
    majorNotItemised: Math.max(0, major.length - NATIONAL_PROGRAMME_ITEM_CAP),
    minorWorks: projects.filter((p) => !isMajorProject(p) && !(p.status && /not currently proceeding/i.test(p.status))).length,
  };
}
