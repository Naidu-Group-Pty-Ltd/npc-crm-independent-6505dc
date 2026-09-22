/**
 * Planning-data sources: one registry of where zoning, parcel and development
 * facts come from, per jurisdiction — query builders and parsers, both pure.
 *
 * Everything here was **verified by execution on 2026-09-06** against the
 * live services with real corpus coordinates (the probe log is in
 * `docs/reports/ZONING_BY_JURISDICTION.md`). Field names are transcribed
 * from real responses, never from documentation — the lesson of
 * `airtableIntakeFields.pure.ts` and the 42703 class: a mistyped field is
 * invisible, an absent one reads as "no zoning here".
 *
 * The matrix, as measured (share = of stored Australian coordinates):
 *
 *  - NSW  (12.4%) — zoning ✅ ePlanning ArcGIS (EPI, LGA, zone, class,
 *    currency date). CC BY. The LGA comes back with the zone.
 *  - VIC  (22.3%) — zoning ✅ Vicmap WFS `plan_zone` (zone code/description,
 *    LGA). CC BY 4.0.
 *  - QLD  (43.9%) — zoning ❌ at state level (set per council scheme); the
 *    state cadastre ✅ returns surveyed lot area, LGA, lot/plan and tenure —
 *    and the StatePlanning service carries the state's own development
 *    instruments (PDAs, SDAs, coordinated projects, infrastructure
 *    designations).
 *  - TAS  (0.8%) — zoning ✅ LISTmap Tasmanian Planning Scheme zones.
 *  - ACT — zoning ✅ ACTmapi Territory Plan land-use zones (AGOL).
 *  - WA   (19.3%) — technically serving, **licence-restricted**: SLIP public
 *    terms are personal/non-commercial, so nothing is fetched and the cell
 *    says why. A value that may not be republished must not be fetched into
 *    a commercial PDF pipeline at all.
 *  - SA / NT (~1.4%) — every candidate host either refuses this sandbox's
 *    egress (CONNECT rejected) or 403s a scripted client, so **no parser
 *    could be verified against a real response**; the cells read
 *    `not_integrated` rather than carrying guessed field names. Probe from
 *    Supabase egress (which reached what this sandbox could not, per the
 *    ABS load) before wiring either.
 *
 * Development applications: the NSW ePlanning **Online DA API** answers
 * without a key and returns, per application: cost of development, new
 * dwellings, storeys, types, status, lodgement/determination dates and
 * location. Its council filter is EXACT-match (verified: "MUSWELLBROOK"
 * alone matches nothing, "MUSWELLBROOK SHIRE COUNCIL" matches 62), which is
 * why `developmentActivity.pure.ts` resolves council names instead of
 * guessing suffixes. No other jurisdiction publishes a state-wide DA feed;
 * those cells are honestly absent.
 *
 * Pure: no fetch, no Deno. The edge function performs the requests; vitest
 * exercises the builders and parsers against captured fixtures.
 */

export type PlanningJurisdiction =
  | 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';

/** Why a cell holds no reading. Distinct reasons render distinct sentences. */
export type PlanningAbsenceReason =
  | 'none_at_point'        // the service answered, and no feature covers this point
  | 'not_served'           // the jurisdiction publishes no such dataset state-wide
  | 'licence_restricted'   // data exists but its terms bar commercial republication
  | 'not_integrated'       // no verified adapter yet (unreached from any egress we hold)
  | 'unavailable';         // transport/service failure — worth retrying, never cached

export interface ZoningReading {
  jurisdiction: PlanningJurisdiction;
  /** The verbatim code from the instrument, e.g. `R1`, `UGZ8`, `CZ1`. */
  zoneCode: string;
  /** The instrument's own words for the zone, e.g. `General Residential`. */
  zoneLabel: string | null;
  /** The planning instrument, e.g. `Muswellbrook Local Environmental Plan 2009`. */
  instrument: string | null;
  lga: string | null;
  /** ISO date the layer states for its own currency/gazettal, when it states one. */
  currencyDate: string | null;
  source: string;
  licence: string;
}

export interface ParcelReading {
  jurisdiction: PlanningJurisdiction;
  lotPlan: string | null;
  /** Square metres. Present only when the layer publishes a figure. */
  area: number | null;
  /** Surveyed area is the layer's stated figure; computed is polygon geometry. */
  areaBasis: 'surveyed' | 'computed' | null;
  lga: string | null;
  tenure: string | null;
  locality: string | null;
  source: string;
  licence: string;
}

/** A state development instrument the point sits inside. */
export interface DevelopmentInstrumentReading {
  kind:
    | 'priority_development_area'
    | 'state_development_area'
    | 'coordinated_project'
    | 'infrastructure_designation';
  name: string;
  status: string | null;
  gazetted: string | null;
  detail: string | null;
  /**
   * The publisher's own stable reference for this feature, where the layer
   * publishes one. Null where it does not — and null is never read as a match.
   *
   * It is preserved HERE because this is the boundary that was discarding it:
   * an infrastructure designation's `id_reference` was read only as a fallback
   * NAME and then thrown away, so a consumer asking "is this the same
   * designation the other register returned?" had nothing to answer with, and
   * a name was the best it could do. A name is a candidate; a reference is an
   * answer.
   *
   * `OBJECTID` is deliberately NOT used. It is the feature service's own row
   * id, it is re-issued when a layer is republished, and identity built on it
   * would be stable only until the next publication — which is worse than no
   * identifier, because it looks like one.
   *
   * The other three kinds read no published reference from their layers, so
   * they carry null and, under `infrastructureEvidence`'s rule 10, do not
   * merge. That is the conservative direction: a duplicate row is a
   * presentation fault, and suppressing a record that was never confirmed to
   * be a duplicate destroys evidence.
   */
  reference: string | null;
}

/** One parsed answer: a reading, a definite empty, or a transport-level failure. */
export type ParseOutcome<T> =
  | { kind: 'ok'; reading: T }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** Epoch milliseconds (how ArcGIS states dates) → `YYYY-MM-DD`, or null. */
export function epochMsToIsoDate(v: unknown): string | null {
  const n = num(v);
  if (n === null || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

interface ArcgisFeature { attributes?: Record<string, unknown> }
interface ArcgisResponse { features?: ArcgisFeature[]; error?: { message?: string } }

/**
 * The shared shape judgement for an ArcGIS layer answer: an error body or a
 * body with no `features` array is a FAILURE, never an empty coverage — an
 * outage must not read as "this property has no zoning" (law: a read that
 * failed is not a row that is absent).
 */
function arcgisFeatures(body: unknown): ParseOutcome<Record<string, unknown>[]> {
  const b = body as ArcgisResponse | null;
  if (!b || typeof b !== 'object') return { kind: 'error', message: 'non-object response' };
  if (b.error) return { kind: 'error', message: str(b.error.message) ?? 'service error' };
  if (!Array.isArray(b.features)) return { kind: 'error', message: 'no features array in response' };
  if (b.features.length === 0) return { kind: 'empty' };
  return { kind: 'ok', reading: b.features.map((f) => f.attributes ?? {}) };
}

// ---------------------------------------------------------------------------
// NSW — zoning (ePlanning Principal Planning layer 19) and Online DA API
// ---------------------------------------------------------------------------

export const NSW_ZONING_SOURCE = 'NSW Planning Portal — Principal Planning Layers (Land Zoning)';
export const NSW_ZONING_LICENCE = 'CC BY 4.0';

export function buildNswZoningQuery(lng: number, lat: number): string {
  const base = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/19/query';
  const p = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'EPI_NAME,LGA_NAME,SYM_CODE,LAY_CLASS,CURRENCY_DATE',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${base}?${p}`;
}

export function parseNswZoning(body: unknown): ParseOutcome<ZoningReading> {
  const feats = arcgisFeatures(body);
  if (feats.kind !== 'ok') return feats;
  const a = feats.reading[0];
  const zoneCode = str(a['SYM_CODE']);
  if (!zoneCode) return { kind: 'error', message: 'feature carries no SYM_CODE' };
  return {
    kind: 'ok',
    reading: {
      jurisdiction: 'NSW',
      zoneCode,
      zoneLabel: str(a['LAY_CLASS']),
      instrument: str(a['EPI_NAME']),
      lga: str(a['LGA_NAME']),
      currencyDate: epochMsToIsoDate(a['CURRENCY_DATE']),
      source: NSW_ZONING_SOURCE,
      licence: NSW_ZONING_LICENCE,
    },
  };
}

export const NSW_DA_SOURCE = 'NSW Planning Portal — Online DA API (api.apps1.nsw.gov.au/eplanning)';
export const NSW_DA_LICENCE = 'CC BY 4.0';

/**
 * The Online DA API filters by EXACT council name and paginates via headers.
 * `filters` is itself a header carrying JSON — verified live; a body is not
 * read by the endpoint. `CouncilName` is a LIST, which is what lets the
 * caller send every dressing of an LGA's name and read the real one off the
 * answer (`developmentActivity.pure.ts` builds the candidates and validates
 * the answered name).
 */
export function buildNswDaRequest(
  councilNames: readonly string[],
  lodgedFromIso: string,
  lodgedToIso: string,
  pageSize: number,
  pageNumber: number,
): { url: string; headers: Record<string, string> } {
  return {
    url: 'https://api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA',
    headers: {
      PageSize: String(pageSize),
      PageNumber: String(pageNumber),
      filters: JSON.stringify({
        filters: {
          CouncilName: [...councilNames],
          LodgementDateFrom: lodgedFromIso,
          LodgementDateTo: lodgedToIso,
        },
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// VIC — zoning (Vicmap open data WFS, plan_zone)
// ---------------------------------------------------------------------------

export const VIC_ZONING_SOURCE = 'Vicmap Planning — plan_zone (opendata.maps.vic.gov.au WFS)';
export const VIC_ZONING_LICENCE = 'CC BY 4.0';

export function buildVicZoningQuery(lng: number, lat: number): string {
  const base = 'https://opendata.maps.vic.gov.au/geoserver/wfs';
  const p = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'open-data-platform:plan_zone',
    outputFormat: 'application/json',
    count: '1',
    propertyName: 'zone_code,zone_description,lga,scheme_code,gaz_begin_date',
    CQL_FILTER: `INTERSECTS(geom,SRID=4326;POINT(${lng} ${lat}))`,
  });
  return `${base}?${p}`;
}

interface WfsResponse { features?: Array<{ properties?: Record<string, unknown> }> }

export function parseVicZoning(body: unknown): ParseOutcome<ZoningReading> {
  const b = body as WfsResponse | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.features)) {
    return { kind: 'error', message: 'no features array in WFS response' };
  }
  if (b.features.length === 0) return { kind: 'empty' };
  const p = b.features[0].properties ?? {};
  const zoneCode = str(p['zone_code']);
  if (!zoneCode) return { kind: 'error', message: 'feature carries no zone_code' };
  const lga = str(p['lga']);
  return {
    kind: 'ok',
    reading: {
      jurisdiction: 'VIC',
      zoneCode,
      zoneLabel: str(p['zone_description']),
      instrument: lga ? `${titleCase(lga)} Planning Scheme` : null,
      lga,
      currencyDate: str(p['gaz_begin_date'])?.slice(0, 10) ?? null,
      source: VIC_ZONING_SOURCE,
      licence: VIC_ZONING_LICENCE,
    },
  };
}

// ---------------------------------------------------------------------------
// QLD — cadastre (surveyed area, LGA, lot/plan, tenure) and state
// development instruments. Zoning is per-council in QLD and NOT served
// state-wide; publishing land *use* as though it were a zone is the
// plausible-wrong-figure trap the research doc records.
// ---------------------------------------------------------------------------

export const QLD_CADASTRE_SOURCE = 'Queensland Land Parcel Property Framework (spatial-gis.information.qld.gov.au)';
export const QLD_CADASTRE_LICENCE = 'CC BY 4.0';

export function buildQldParcelQuery(lng: number, lat: number): string {
  const base = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query';
  const p = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'lot_area,shire_name,lotplan,lot,plan,tenure,locality',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${base}?${p}`;
}

export function parseQldParcel(body: unknown): ParseOutcome<ParcelReading> {
  const feats = arcgisFeatures(body);
  if (feats.kind !== 'ok') return feats;
  const a = feats.reading[0];
  return {
    kind: 'ok',
    reading: {
      jurisdiction: 'QLD',
      lotPlan: str(a['lotplan']),
      area: num(a['lot_area']),
      // lot_area is the framework's stated (surveyed) figure, not geometry.
      areaBasis: num(a['lot_area']) !== null ? 'surveyed' : null,
      lga: str(a['shire_name']),
      tenure: str(a['tenure']),
      locality: str(a['locality']),
      source: QLD_CADASTRE_SOURCE,
      licence: QLD_CADASTRE_LICENCE,
    },
  };
}

export const QLD_STATE_PLANNING_SOURCE = 'Queensland StatePlanning layers (PDAs, SDAs, coordinated projects, infrastructure designations)';

/** The four StatePlanning layers verified 2026-09-06, with their real field names. */
export const QLD_INSTRUMENT_LAYERS: ReadonlyArray<{
  layer: number;
  kind: DevelopmentInstrumentReading['kind'];
}> = [
  { layer: 25, kind: 'coordinated_project' },
  { layer: 30, kind: 'infrastructure_designation' },
  { layer: 35, kind: 'priority_development_area' },
  { layer: 40, kind: 'state_development_area' },
];

export function buildQldInstrumentQuery(layer: number, lng: number, lat: number): string {
  const base = `https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/StatePlanning/MapServer/${layer}/query`;
  const p = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${base}?${p}`;
}

export function parseQldInstrument(
  kind: DevelopmentInstrumentReading['kind'],
  body: unknown,
): ParseOutcome<DevelopmentInstrumentReading[]> {
  const feats = arcgisFeatures(body);
  if (feats.kind !== 'ok') return feats;
  const readings: DevelopmentInstrumentReading[] = [];
  for (const a of feats.reading) {
    if (kind === 'priority_development_area') {
      const name = str(a['pda_name']);
      if (!name) continue;
      readings.push({ kind, name, status: str(a['pda_status']), gazetted: epochMsToIsoDate(a['gazetted_date']), detail: str(a['lga_name']), reference: null });
    } else if (kind === 'state_development_area') {
      const name = str(a['sda_name']);
      if (!name) continue;
      readings.push({ kind, name, status: null, gazetted: epochMsToIsoDate(a['gazdate']), detail: null, reference: null });
    } else if (kind === 'coordinated_project') {
      const name = str(a['name']);
      if (!name) continue;
      readings.push({ kind, name, status: str(a['projectstatus']), gazetted: null, detail: str(a['description']), reference: null });
    } else {
      // `id_reference` is the designation's own published reference. It was
      // read only as a name fallback and discarded; it is preserved now.
      const reference = str(a['id_reference']);
      const name = str(a['id_description']) ?? reference;
      if (!name) continue;
      readings.push({ kind, name, status: str(a['id_type__per_legislation_']), gazetted: epochMsToIsoDate(a['date_of_gazettal']), detail: str(a['address']), reference });
    }
  }
  return readings.length === 0 ? { kind: 'empty' } : { kind: 'ok', reading: readings };
}

// ---------------------------------------------------------------------------
// TAS — zoning (LISTmap, Tasmanian Planning Scheme zones, layer 13)
// ---------------------------------------------------------------------------

export const TAS_ZONING_SOURCE = 'theLIST — Tasmanian Planning Scheme Zones (services.thelist.tas.gov.au)';
export const TAS_ZONING_LICENCE = 'CC BY 3.0 AU';

export function buildTasZoningQuery(lng: number, lat: number): string {
  const base = 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/PlanningOnline/MapServer/13/query';
  const p = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'LPS,ZONE,ZONE_ABB,ZONESUBGRP,LPSDATE',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${base}?${p}`;
}

export function parseTasZoning(body: unknown): ParseOutcome<ZoningReading> {
  const feats = arcgisFeatures(body);
  if (feats.kind !== 'ok') return feats;
  const a = feats.reading[0];
  const zone = str(a['ZONE']);
  if (!zone) return { kind: 'error', message: 'feature carries no ZONE' };
  return {
    kind: 'ok',
    reading: {
      jurisdiction: 'TAS',
      // TAS names zones in words and abbreviates to a clause number
      // (`114.16`); the words are the code a person recognises.
      zoneCode: zone,
      zoneLabel: str(a['ZONESUBGRP']),
      instrument: str(a['LPS']),
      lga: lgaFromTasLps(str(a['LPS'])),
      currencyDate: epochMsToIsoDate(a['LPSDATE']),
      source: TAS_ZONING_SOURCE,
      licence: TAS_ZONING_LICENCE,
    },
  };
}

/** `Hobart Local Provisions Schedule` names its council; read it, never guess. */
export function lgaFromTasLps(lps: string | null): string | null {
  if (!lps) return null;
  const m = lps.match(/^(.*?)\s+Local Provisions Schedule$/i);
  return m ? m[1].trim().toUpperCase() : null;
}

// ---------------------------------------------------------------------------
// ACT — Territory Plan land-use zones (ACTmapi, AGOL FeatureServer layer 1)
// ---------------------------------------------------------------------------

export const ACT_ZONING_SOURCE = 'ACTmapi — Territory Plan Land Use Zones (services1.arcgis.com/E5n4f1VY84i0xSjy)';
export const ACT_ZONING_LICENCE = 'CC BY 4.0';

export function buildActZoningQuery(lng: number, lat: number): string {
  const base = 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_TP_LAND_USE_ZONE/FeatureServer/1/query';
  const p = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'LAND_USE_ZONE_CODE_ID,LAND_USE_POLICY_DESC,DIVISION_NAME,DISTRICT_NAME,GAZETTAL_DATE,CURRENT_LIFECYCLE_STAGE',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${base}?${p}`;
}

export function parseActZoning(body: unknown): ParseOutcome<ZoningReading> {
  const feats = arcgisFeatures(body);
  if (feats.kind !== 'ok') return feats;
  // The layer keeps degazetted history; prefer a GAZETTED feature.
  const rows = feats.reading;
  const a = rows.find((r) => str(r['CURRENT_LIFECYCLE_STAGE']) === 'GAZETTED') ?? rows[0];
  const zoneCode = str(a['LAND_USE_ZONE_CODE_ID']);
  if (!zoneCode) return { kind: 'error', message: 'feature carries no LAND_USE_ZONE_CODE_ID' };
  return {
    kind: 'ok',
    reading: {
      jurisdiction: 'ACT',
      zoneCode,
      zoneLabel: str(a['LAND_USE_POLICY_DESC']),
      instrument: 'Territory Plan (ACT)',
      lga: str(a['DIVISION_NAME']),
      currencyDate: epochMsToIsoDate(a['GAZETTAL_DATE']),
      source: ACT_ZONING_SOURCE,
      licence: ACT_ZONING_LICENCE,
    },
  };
}

// ---------------------------------------------------------------------------
// The cells no adapter may fill, and why — rendered, never silently skipped
// ---------------------------------------------------------------------------

export const WA_LICENCE_NOTE =
  'WA planning scheme data (SLIP) is published for personal, non-commercial use; commercial republication requires written authorisation, so nothing is fetched. Verify zoning via PlanWA or the local government scheme.';

/**
 * South Australia and the Northern Territory, MEASURED rather than assumed.
 *
 * These were one constant, `SA_NT_NOTE`, reading *"every candidate host
 * refused this platform's scripted egress during integration"*. That was a
 * measurement about the DEVELOPMENT egress — the one that answers 403 to
 * CONNECT for `data.gov.au` and every ABS host, three registers that answer
 * production perfectly well — and W3.4 asked the publishers from CI instead.
 *
 * Measured 22 Sep 2026 (`scripts/market/jurisdiction-layer-liveness.ts`):
 *
 *   SA  `dpti.geohub.sa.gov.au/server/rest/services`  HTTP 200,
 *       **131 services across 30 folders**, two of them named `PlanSA`
 *       and `ePlanning`.
 *   NT  `www.ntlis.nt.gov.au/arcgis/rest/services`    HTTP 403 carrying
 *       `<title>Just a moment...</title>` — a bot-protection interstitial.
 *
 * So the old sentence was **false for South Australia** and described the
 * wrong thing for the Northern Territory. They are two notes now, because
 * they are two different facts and one sentence for both is how the
 * measurement was never taken: a claim that covers two jurisdictions is a
 * claim nobody can check against either.
 *
 * Both still say `not_integrated`, which is the honest status — reachable is
 * not read, and no parser here has been verified against either publisher's
 * response.
 */
export const SA_NOTE =
  'South Australia’s planning layers are published by a state spatial service this platform can reach — it answers with a catalogue of 131 services, including folders named PlanSA and ePlanning — and none of them is read into this report yet. That is outstanding integration work rather than a limitation of the source, and nothing here says whether a control applies. Verify via the PlanSA portal.';

export const NT_NOTE =
  'A bot-protection challenge stood in front of the Northern Territory’s land-information service on every address this platform asked, so no layer was read. That is a property of automated access rather than a decision the Territory made about publishing, and nothing here says whether a control applies. Verify via the NT planning portal.';

/*
 * `SA_NT_NOTE` is DELETED rather than aliased onto `SA_NOTE`.
 *
 * An alias would have served South Australia's sentence to the Northern
 * Territory, which is the exact fault the split exists to end — and a
 * dormant export is one import away from putting it back
 * (`ResponsibilityNotice.tsx`'s rule). `planningNotesAreMeasured.spec.ts`
 * refuses the name anywhere in the repository, so a caller reintroducing it
 * fails rather than silently getting the wrong jurisdiction's note.
 */

/**
 * What settles the question when the spatial layer and reality must agree:
 * the layer is indicative, the certificate is the instrument. One sentence
 * per jurisdiction, from the research doc's rule 8.
 */
export const VERIFICATION_INSTRUMENT: Readonly<Record<PlanningJurisdiction, string>> = {
  NSW: 'a s10.7 planning certificate from the council (EP&A Act 1979)',
  VIC: 'a planning certificate from Land Use Victoria or the council',
  QLD: 'a planning and development certificate from the council',
  WA: 'the local government planning scheme and PlanWA',
  SA: 'the PlanSA portal / a property interest report',
  TAS: 'a s.337 certificate from the council (LGA 1993)',
  ACT: 'the Crown lease and its purpose clause (ACT land is leasehold)',
  NT: 'the NT Planning Scheme via the NT planning portal',
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
