/**
 * Resolve ONE report's geography, from its coordinate, through the canonical
 * ASGS boundaries.
 *
 * ## Why this exists
 *
 * `resolve-report-geography` is a bounded backfill: it self-selects reports
 * whose `location_intelligence` is ALREADY PERSISTED — which happens at the
 * generator's own write — so a first generation never had a geography row when
 * the Client-Safe Gate asked whether the ABS data belonged to the subject
 * property. The result was a real inconsistency: a regenerated report got area
 * statistics and a brand-new one did not.
 *
 * This is that function's per-report body, lifted out so the generator can run
 * it for the report in hand, before the gate decides. **There is no second
 * geography algorithm**: the batch now calls this too, so both paths resolve
 * through the same `resolveGeography` over the same ASGS 2021 boundaries.
 *
 * ## The defect this move exposed
 *
 * The batch wrote `method: 'point_in_polygon'`. The table's CHECK constraint
 * admits `'asgs_point_in_polygon'` or `'none'` — so **every upsert violated it
 * and every write failed**, and the failure was swallowed into a per-report
 * `write_failed:` string in a results array nobody reads. The function returned
 * HTTP 200 throughout. That, rather than "the backfill has not run yet", is why
 * `report_geography` was empty. Fixed here, in the one place that now writes.
 *
 * ## What it refuses
 *
 * A coordinate outside Australia's bounding box is never sent to the boundary
 * service, and a report with no usable coordinate resolves `unresolved` rather
 * than borrowing a location. Nothing here reads a free-text suburb or postcode:
 * the address string is what produced the untrusted postcode in the first place.
 *
 * ## The directory cross-check is PERFORMED, not declared
 *
 * `resolveGeography` reads `directoryMatches: []` as "the directory was checked
 * and this suburb is not in it" — and every caller, this one included, used to
 * pass `[]` without opening the directory. So every resolution carried
 * `suburb_not_in_directory` and read `resolved_with_warning`: a warning about a
 * check nobody ran, on a geography that was correct. Worse, the two
 * disagreements the validation exists to catch — a suburb under a different
 * postcode, and a cross-state contradiction — were unreachable, because the
 * code reached them only through the populated branch.
 *
 * The lookup now happens, against the same `suburb_directory` the listings
 * pipeline uses, and the field's three states are three different facts: `null`
 * for not checked, `[]` for checked and absent, rows for checked and matched.
 * **The directory never decides geography** — the ASGS point-in-polygon answer
 * is the authority, and the directory only agrees, disagrees or is silent.
 */

import { isAustraliaCentroid } from '../geocodeGranularity.pure.ts';
import {
  ASGS_RELEASE,
  BOUNDARY_SOURCE,
  isPlausiblyAustralian,
  normalisePlaceName,
  resolveGeography,
  stripLocalityQualifier,
  type AsgsArea,
  type AsgsLookup,
  type DirectoryEntry,
  type Sa2Hierarchy,
} from './asgsGeography.pure.ts';

/** The value the table's CHECK constraint actually admits. */
export const GEOGRAPHY_METHOD = 'asgs_point_in_polygon' as const;

export const GEO_TIMEOUT_MS = 20_000;

// Moved VERBATIM from `resolve-report-geography`, which now imports it back.
// Transcribing it by hand would have produced a second algorithm with
// different layer names and a different endpoint — which is exactly what a
// first draft of this file did.
const LAYERS: ReadonlyArray<{ key: keyof AsgsLookup; layer: string; code: string; name: string }> = [
  { key: 'sal', layer: 'SAL', code: 'sal_code_2021', name: 'sal_name_2021' },
  { key: 'poa', layer: 'POA', code: 'poa_code_2021', name: 'poa_name_2021' },
  { key: 'sa2', layer: 'SA2', code: 'sa2_code_2021', name: 'sa2_name_2021' },
  { key: 'ra', layer: 'RA', code: 'ra_code_2021', name: 'ra_name_2021' },
  { key: 'ucl', layer: 'UCL', code: 'ucl_code_2021', name: 'ucl_name_2021' },
  { key: 'sua', layer: 'SUA', code: 'sua_code_2021', name: 'sua_name_2021' },
];

async function queryLayer(
  layer: string, codeField: string, nameField: string, lat: number, lng: number,
): Promise<AsgsArea | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: `${codeField},${nameField}`,
    returnGeometry: 'false',
    f: 'json',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://geo.abs.gov.au/arcgis/rest/services/${ASGS_RELEASE}/${layer}/MapServer/0/query?${params}`,
      { signal: controller.signal },
    );
    if (!res.ok) throw new Error(`ABS geoserver answered ${res.status} for ${layer}`);
    const body = await res.json() as {
      error?: unknown;
      features?: Array<{ attributes?: Record<string, unknown> }>;
    };
    // ArcGIS reports failures as 200 plus an error body. That is transport.
    if (body.error) throw new Error(`ABS geoserver returned an error body for ${layer}`);
    const attrs = body.features?.[0]?.attributes;
    const code = attrs?.[codeField];
    const name = attrs?.[nameField];
    if (typeof code !== 'string' || !code) return null;
    return { code, name: typeof name === 'string' && name ? name : code };
  } finally {
    clearTimeout(timer);
  }
}

/** Every layer for one point. A single failure fails the whole lookup. */
export async function lookupPointDefault(lat: number, lng: number): Promise<AsgsLookup> {
  const empty: AsgsLookup = {
    sal: null, poa: null, sa2: null, ra: null, ucl: null, sua: null,
    salNeighbours: [], serviceFailed: true,
  };
  try {
    const areas = await Promise.all(
      LAYERS.map((l) => queryLayer(l.layer, l.code, l.name, lat, lng)),
    );
    const out: Record<string, AsgsArea | null> = {};
    LAYERS.forEach((l, i) => { out[l.key as string] = areas[i]; });
    return {
      sal: out.sal, poa: out.poa, sa2: out.sa2, ra: out.ra, ucl: out.ucl, sua: out.sua,
      // Neighbour detection needs an envelope query; the backfill's finding was
      // that it matters rarely, so it is left empty rather than approximated.
      salNeighbours: out.sal ? [out.sal] : [],
      serviceFailed: false,
    };
  } catch (_e) {
    return empty;
  }
}

/**
 * The `suburb_directory` rows for one ASGS locality name.
 *
 * Returns **null** — meaning "not checked" — for every reason that is not an
 * answer about the suburb: no locality to look up, or a read that failed. That
 * distinction is load-bearing: `resolveGeography` treats `[]` as "checked and
 * absent" and raises `suburb_not_in_directory` on it, so returning `[]` from a
 * database fault would put a warning on a good geography and blame the suburb
 * for our own outage.
 *
 * The query is by the STRIPPED name: ABS publishes qualifiers like
 * `Springfield (Qld)` that no directory carries, and `normalisePlaceName`
 * filters the rows afterwards so case, punctuation and spacing cannot cause a
 * false miss either. `.ilike` is a parameterised filter — never a composed
 * `.or()` string, which is the pattern this repository has already been bitten
 * by twice.
 */
async function readDirectory(
  supabase: { from: (table: string) => any },
  salName: string,
): Promise<DirectoryEntry[] | null> {
  const bare = stripLocalityQualifier(salName).trim();
  if (bare === '') return null;
  try {
    const { data, error } = await supabase
      .from('suburb_directory')
      .select('suburb, state, postcode')
      .ilike('suburb', bare)
      .limit(50);
    if (error) {
      console.warn(`⚠️ suburb_directory unreadable (${error.message}) — cross-check not performed.`);
      return null;
    }
    const wanted = normalisePlaceName(salName);
    return (data ?? [])
      .filter((r: Record<string, unknown>) =>
        typeof r.suburb === 'string' && normalisePlaceName(r.suburb) === wanted)
      .map((r: Record<string, unknown>) => ({
        suburb: String(r.suburb),
        state: String(r.state ?? ''),
        postcode: String(r.postcode ?? ''),
      }));
  } catch (e) {
    console.warn(`⚠️ suburb_directory read threw (${String(e)}) — cross-check not performed.`);
    return null;
  }
}

export interface GeographyRowShape {
  report_id: string;
  latitude: number | null;
  longitude: number | null;
  suburb: string | null;
  locality_code: string | null;
  postcode: string | null;
  state: string | null;
  sa2_code: string | null;
  sa2_name: string | null;
  sa3_name: string | null;
  sa4_name: string | null;
  gccsa_name: string | null;
  remoteness_area: string | null;
  urban_centre: string | null;
  significant_urban_area: string | null;
  method: string;
  boundary_source: string;
  source_version: string;
  status: string;
  flags: readonly string[];
  notes: string;
}

export interface ResolveOneOptions {
  /** A service-role Supabase client. */
  readonly supabase: {
    from: (table: string) => any;
  };
  readonly reportId: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Injected so the generator and the batch can share one HTTP policy. */
  readonly lookupPoint?: (lat: number, lng: number) => Promise<AsgsLookup>;
  /**
   * Answer from the report's stored row when it already resolves THIS point
   * under THIS release, rather than asking the boundary service again — see
   * `storedRowDescribesPoint`.
   *
   * The generator sets it, because it resolves the same coordinate on every
   * invocation of one report and a boundary service that answered the first
   * time can fail the fourth. The batch sweep does not: re-resolving is its
   * job, and a sweep that trusted its own earlier answers could never correct
   * one.
   */
  readonly reuseStored?: boolean;
}

export interface ResolveOneResult {
  readonly status: string;
  /**
   * The resolution — present whether or not it could be persisted. A failed
   * write is a storage fault, not a property with no geography: both callers
   * that run a report say "resolution still used" on a write failure, and
   * until 24 Sep 2026 this returned null there, so they logged that sentence
   * and then withheld the demographics anyway.
   */
  readonly row: GeographyRowShape | null;
  /** The write's own error, where the persist failed. */
  readonly writeError: string | null;
  /**
   * Whether the suburb-directory cross-check actually ran IN THIS CALL.
   * Reported rather than inferred from the flags, because the absence of
   * `suburb_not_in_directory` means "matched" and "not checked" at once if you
   * read it that way — which is the confusion this whole field exists to end.
   * False for a reused row: this call opened no directory, and the row's own
   * flags carry what the original resolution found.
   */
  readonly directoryChecked: boolean;
  /** True where the stored row answered and the boundary service was not asked. */
  readonly reused?: boolean;
}

/** The statuses a stored row may be reused at. `unresolved` is always asked again. */
const REUSABLE_STATUSES: ReadonlySet<string> = new Set([
  'resolved', 'resolved_with_warning', 'requires_review',
]);

/**
 * Degrees. A stored double-precision coordinate round-trips exactly; the
 * tolerance exists only so a value that passed through a JSON boundary as a
 * shorter decimal still matches. 1e-7° is about a centimetre.
 */
const SAME_POINT_TOLERANCE_DEG = 1e-7;

/**
 * Whether a stored geography row may answer for this point without asking the
 * boundary service.
 *
 * Every condition is a refusal: the row must place the SAME point, by the SAME
 * method, against the SAME ASGS release, and must have placed it — an
 * `unresolved` row is asked again, because `boundary_service_unavailable` is
 * one of the ways to be unresolved and it is the one a retry can clear.
 *
 * The case this closes: the generator resolves one report's coordinate on
 * every invocation, and a boundary service that answered on the first could
 * fail on a later one. The failure then OVERWROTE the resolved row with an
 * unresolved one, and the invocation went on to withhold the demographics,
 * skip the market evidence and write its sections as if the property had
 * never been placed — beside sections an earlier invocation wrote with all of
 * it. A point's ASGS geography under a fixed release does not change between
 * invocations; asking again could only lose it.
 */
export function storedRowDescribesPoint(
  stored: Partial<GeographyRowShape> | null | undefined,
  latitude: number,
  longitude: number,
): boolean {
  if (!stored) return false;
  const lat = num(stored.latitude);
  const lng = num(stored.longitude);
  return lat !== null && lng !== null
    && Math.abs(lat - latitude) <= SAME_POINT_TOLERANCE_DEG
    && Math.abs(lng - longitude) <= SAME_POINT_TOLERANCE_DEG
    && typeof stored.status === 'string' && REUSABLE_STATUSES.has(stored.status)
    && stored.method === GEOGRAPHY_METHOD
    && stored.source_version === ASGS_RELEASE;
}

const STORED_GEOGRAPHY_COLUMNS = 'report_id, latitude, longitude, suburb, locality_code, postcode, state, '
  + 'sa2_code, sa2_name, sa3_name, sa4_name, gccsa_name, remoteness_area, urban_centre, '
  + 'significant_urban_area, method, boundary_source, source_version, status, flags, notes';

/**
 * The report's stored row, or null for every reason that is not a row —
 * absent, or a read that failed. A failed read is NOT an answer here: the
 * caller then asks the boundary service exactly as it did before, so a
 * database fault can cost a request and never a geography.
 */
async function readStoredGeography(
  supabase: { from: (table: string) => any },
  reportId: string,
): Promise<GeographyRowShape | null> {
  try {
    const { data, error } = await supabase
      .from('report_geography')
      .select(STORED_GEOGRAPHY_COLUMNS)
      .eq('report_id', reportId)
      .maybeSingle();
    if (error || !data) return null;
    const flags = Array.isArray(data.flags) ? data.flags.filter((f: unknown) => typeof f === 'string') : [];
    return {
      ...(data as GeographyRowShape),
      flags,
      notes: typeof data.notes === 'string' ? data.notes : '',
    };
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;


/**
 * Resolve and persist one report's geography.
 *
 * Total: never throws on a resolution that simply cannot be made. A coordinate
 * that is absent or outside Australia resolves `unresolved`, which is what
 * makes the Client-Safe Gate withhold rather than guess.
 */
export async function resolveOneReportGeography(
  opts: ResolveOneOptions,
): Promise<ResolveOneResult> {
  const latitude = num(opts.latitude);
  const longitude = num(opts.longitude);
  const lookupPoint = opts.lookupPoint ?? lookupPointDefault;

  // The boundary service is only asked about a point that could be here, and
  // is not the geocoder's own "no match". Asking it about London wastes a
  // request to be told what the bounding box already knows; asking it about
  // the centre of the continent spends one to be told a desert locality we are
  // going to refuse anyway — and it would spend a directory query too.
  //
  // `resolveGeography` refuses both independently, so this is an economy and
  // never the authority: a caller that asks anyway still gets the refusal.
  const worthAsking = latitude !== null && longitude !== null
    && isPlausiblyAustralian({ latitude, longitude })
    && !isAustraliaCentroid(latitude, longitude);

  // The report already placed this point, by this method, against this
  // release: that answer stands, and nothing is written over it. See
  // `storedRowDescribesPoint` for why asking again can only lose it.
  if (opts.reuseStored && worthAsking) {
    const stored = await readStoredGeography(opts.supabase, opts.reportId);
    if (stored && storedRowDescribesPoint(stored, latitude!, longitude!)) {
      return { status: stored.status, row: stored, writeError: null, directoryChecked: false, reused: true };
    }
  }

  const lookup = worthAsking ? await lookupPoint(latitude!, longitude!) : null;

  let hierarchy: Sa2Hierarchy | null = null;
  if (lookup?.sa2) {
    const { data: meta } = await opts.supabase
      .from('abs_sa2_meta')
      .select('sa2_code, sa2_name, sa3_name, sa4_name, gccsa_name, state_name')
      .eq('sa2_code', lookup.sa2.code)
      .maybeSingle();
    if (meta) {
      hierarchy = {
        sa2Code: meta.sa2_code as string,
        sa2Name: meta.sa2_name as string,
        sa3Name: (meta.sa3_name as string) ?? null,
        sa4Name: (meta.sa4_name as string) ?? null,
        gccsaName: (meta.gccsa_name as string) ?? null,
        stateName: (meta.state_name as string) ?? null,
      };
    }
  }

  // The cross-check is performed, rather than declared and skipped. `null`
  // where there is no locality to check or the read failed — never `[]`, which
  // would assert the suburb is absent from a directory nobody opened.
  const directoryMatches = lookup?.sal
    ? await readDirectory(opts.supabase, lookup.sal.name)
    : null;

  const resolved = resolveGeography({
    coordinate: latitude !== null && longitude !== null ? { latitude, longitude } : null,
    lookup,
    hierarchy,
    directoryMatches,
  });

  const row: GeographyRowShape = {
    report_id: opts.reportId,
    latitude,
    longitude,
    suburb: resolved.suburb,
    locality_code: resolved.localityCode,
    postcode: resolved.postcode,
    state: resolved.state,
    sa2_code: resolved.sa2Code,
    sa2_name: resolved.sa2Name,
    sa3_name: resolved.sa3Name,
    sa4_name: resolved.sa4Name,
    gccsa_name: resolved.gccsaName,
    remoteness_area: resolved.remotenessArea,
    urban_centre: resolved.urbanCentre,
    significant_urban_area: resolved.significantUrbanArea,
    // Not `point_in_polygon`: the CHECK constraint admits only this spelling,
    // and the other one silently failed every write this table ever received.
    method: GEOGRAPHY_METHOD,
    boundary_source: BOUNDARY_SOURCE,
    source_version: ASGS_RELEASE,
    status: resolved.status,
    flags: resolved.flags,
    notes: resolved.notes.join(' '),
  };

  const { error } = await opts.supabase
    .from('report_geography')
    .upsert(row, { onConflict: 'report_id' });

  return {
    status: resolved.status,
    // The resolution stands whether or not it was stored — see `row` above.
    row,
    writeError: error ? String(error.message ?? error) : null,
    directoryChecked: directoryMatches !== null,
    reused: false,
  };
}
