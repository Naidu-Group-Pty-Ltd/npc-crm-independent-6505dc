/**
 * The planning controls, overlays and hazards that sit ON a property — the
 * half of "Zoning & Planning" that this platform used to say nothing about.
 *
 * `planningFacts.pure.ts` carried one honest sentence for overlays:
 *
 *   "Overlay mapping (heritage, flood, bushfire, character, acoustic) is held
 *    in the council scheme and is not retrieved by this platform."
 *
 * That was true of the code and false of the world. Measured from the
 * production egress on 17 Sep 2026 — every service below answered HTTP 200
 * with a parseable body, under an open licence, with no key:
 *
 *  - NSW `Planning_Portal_Principal_Planning` answers, in ONE `identify` call,
 *    the LEP and its amendment, the zone, the maximum building height in
 *    metres, the floor space ratio, the minimum lot size, heritage listing
 *    (item number, type, significance), land reservation acquisition, the
 *    foreshore building line and minimum dwelling density — each with the
 *    legislative clause that creates it and its own currency date. At
 *    Muswellbrook: `8.5 m` under cl. 4.3, `0.5:1` under cl. 4.4, `600 m²`
 *    under cl. 4.1, and a **Residential Heritage Conservation Area (C2,
 *    local significance)** under cl. 5.10.
 *  - NSW `Planning_Portal_Hazard` answers Bushfire Prone Land, the Flood
 *    Planning Map and Landslide Risk Land.
 *  - NSW `Planning_Portal_Protection` answers acid sulfate soils, airport
 *    noise, drinking-water catchment, groundwater vulnerability, riparian
 *    land, salinity, terrestrial biodiversity, wetlands and scenic protection.
 *  - VIC `plan_overlay` sits on the SAME Vicmap WFS endpoint as `plan_zone`,
 *    one word different in the typeName. At Melbourne it returned DDO1, DDO2,
 *    DDO2-A1, HO509, HO544 and PO2 with each one's gazettal date.
 *  - QLD `StatePlanning` answers the regional plan (its name, its legal
 *    status and its version) and the priority living / development areas. At
 *    262 Pallas Street: **Maryborough Priority Living Area**, inside the
 *    **Wide Bay Burnett Regional Plan (Statutory, December 2023)**.
 *  - QLD `FloodCheck` answers flood hazard and QLD `MSES` answers regulated
 *    vegetation, wildlife habitat, wetlands and watercourses.
 *  - TAS `PlanningOnline` layers 14 and 15 answer the Code Overlay and the
 *    General Overlay with the Local Provisions Schedule that carries them.
 *
 * Four rules, and each one is a defect this repository has already paid for.
 *
 * **A constraint is named only where a layer named it.** Nothing here infers
 * a control from a zone code, a suburb or a neighbouring parcel. The legacy
 * long-form report is the worked example of the alternative: three copies of
 * its own zoning section on ONE lot said the flood overlay was moderate, then
 * minimal, then moderate-at-5%-of-the-lot; the bushfire overlay was High, then
 * low, then BAL-12.5-to-29; the contributions were $45,000, then $15,000, then
 * $52,000; and one copy cited **Wyong Shire Council** flood mapping — a New
 * South Wales council — for a Victorian property.
 *
 * **A layer that was never asked is evidence of nothing.** `askedFamilies`
 * travels with the answer so a reader can tell "we asked and the answer was
 * no" from "nobody asked". Ten of NSW's protection layers exist; a report that
 * checked four and said "no constraints" would be the
 * confident-clear-against-nothing failure the sanctions register already had.
 *
 * **A value carries its unit, its instrument and its clause.** `8.5` is not a
 * fact. `8.5 m maximum building height, Muswellbrook LEP 2009 cl. 4.3,
 * current 18 Nov 2022` is one, and it is the difference between a number a
 * client can take to a town planner and a number they cannot.
 *
 * **A code is never converted into an entitlement.** What a zone permits is
 * the instrument's land-use table, which nothing here reads. `zoneFamily`
 * groups codes for comparison; it does not say a duplex may be built.
 *
 * Pure: no fetch, no Deno. The edge function performs the requests.
 */

import type { PlanningJurisdiction } from './planningSources.pure.ts';

/**
 * What KIND of control this is.
 *
 * The family is what `planningControlGuide.pure.ts` explains and what the
 * report groups by, so it is deliberately coarse: a reader needs to know
 * "this is a heritage control" before they need to know which schedule.
 * `other` is a real answer — a layer we retrieved whose family we do not
 * claim to recognise is printed under its publisher's own name rather than
 * filed under a guess.
 */
export type ConstraintFamily =
  | 'height'
  | 'floorSpaceRatio'
  | 'minimumLotSize'
  | 'dwellingDensity'
  | 'heritage'
  | 'design'
  | 'bushfire'
  | 'flood'
  | 'landslide'
  | 'erosion'
  | 'coastal'
  | 'acidSulfateSoils'
  | 'airportNoise'
  | 'drinkingWaterCatchment'
  | 'groundwater'
  | 'riparian'
  | 'salinity'
  | 'biodiversity'
  | 'wetlands'
  | 'vegetation'
  | 'scenicProtection'
  | 'environmentallySensitive'
  | 'contamination'
  | 'mineralResource'
  | 'acquisition'
  | 'foreshoreBuildingLine'
  | 'developmentContributions'
  | 'infrastructureContribution'
  | 'parking'
  | 'regionalPlan'
  | 'growthArea'
  | 'other';

/**
 * Whether the reading limits what may be built (`control`), warns of a
 * physical hazard (`hazard`), protects something (`protection`), or states
 * where the property sits in a strategic plan (`context`).
 *
 * A reader triages by this before anything else: a hazard changes insurance
 * and construction cost, a control changes what can be built, and a context
 * reading changes neither but says what the area is FOR.
 */
export type ConstraintKind = 'control' | 'hazard' | 'protection' | 'context';

export interface PlanningConstraintReading {
  family: ConstraintFamily;
  kind: ConstraintKind;
  /** The publisher's own name for it — never our paraphrase. */
  label: string;
  /** The instrument's code where it uses one: `DDO1`, `HO544`, `C2`, `R1`. */
  code: string | null;
  /** The published figure WITH its unit: `8.5 m`, `0.5:1`, `600 m²`. */
  value: string | null;
  /** The instrument that creates the obligation. */
  instrument: string | null;
  /** The clause inside that instrument, where the layer states one. */
  clause: string | null;
  /** What the publisher states for its own currency, ISO. */
  currencyDate: string | null;
  /** Anything else the layer published that a reader would want. */
  detail: string | null;
  /**
   * The publisher's own word for an instrument's STANDING, where it gives one
   * — `Statutory instrument`, and the version beside it when the version is
   * not a date.
   *
   * Separate from `detail` because `detail` is a join of everything the layer
   * published that a reader would want, and a consumer that needs one of those
   * facts cannot take the join. The Infrastructure Outlook did exactly that:
   * it put `detail` in its **Status** column, and on 262 Pallas Street the
   * Priority Living Area's `detail` is `Wide Bay Burnett` — the REGION — so
   * the table stated a region as a project's status.
   */
  standingLabel: string | null;
  /**
   * The publisher's own layer id inside the service that answered, where the
   * response carried one.
   *
   * It is the only STABLE identifier this reading has. A label is what the
   * publisher calls a feature today; a layer id is which register the feature
   * came out of, and it is what lets a consumer tell "the same designation,
   * read twice" from "two designations with similar names". The infrastructure
   * outlook needs exactly that distinction, because Queensland's StatePlanning
   * MapServer is read two ways — layers 25/30/35/40 one at a time by the
   * instruments probe, and `layers: all` by this register — so the same
   * feature comes back from both.
   *
   * Null where the response published none. A consumer may not treat null as
   * a match: an unidentified reading is unidentified, not equal to another
   * unidentified one.
   */
  sourceLayer?: number | null;
  /** The administrative or planning region the register named, where it did. */
  region: string | null;
  source: string;
  licence: string;
}

/** One register's answer: what it was asked, and what came back. */
export interface ConstraintProbeOutcome {
  /** Families this register can answer. Travels even when nothing was found. */
  asked: ConstraintFamily[];
  status: 'ok' | 'none_at_point' | 'unavailable' | 'not_served';
  readings: PlanningConstraintReading[];
  source: string;
  licence: string;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Shared ArcGIS `identify` plumbing
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/**
 * A trimmed string, or null.
 *
 * ArcGIS `identify` stringifies everything and spells an absent value
 * `"Null"` — a four-character word, not a null — so a naive read prints
 * `Additional Controls: Null` into a client's document. Both spellings and a
 * lone `-` are absences here.
 */
export const attrStr = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '' || t === '-') return null;
  if (t.toLowerCase() === 'null' || t.toLowerCase() === 'undefined') return null;
  return t;
};

/** `6/15/2012` (ArcGIS identify) or epoch ms (a raw query) → `YYYY-MM-DD`. */
export function identifyDateToIso(v: unknown): string | null {
  const n = num(v);
  if (n !== null && n > 100_000_000) {
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = attrStr(v);
  if (!s) return null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const [, mm, dd, yyyy] = us;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? iso[0] : null;
}

/**
 * An `identify` URL for an ArcGIS MapServer at one point.
 *
 * `layers` is `all` or an explicit `all:1,2,3`. The explicit form is not a
 * refinement — it is REQUIRED wherever the service's sublayers are not
 * visible by default, because `all` means "all VISIBLE" to ArcGIS. Measured:
 * NSW's Hazard service has `defaultVisibility: false` on its group, so
 * `layers=all` answered `{"results":[]}` at a point and the explicit form was
 * the only one that could ever return a bushfire or flood finding. An empty
 * answer that is really a wrong question is the worst shape this codebase
 * knows: it reads as a clean property.
 *
 * `tolerance: 0` is exact containment; a tolerance in pixels would return
 * controls that apply to the neighbour.
 */
export function buildIdentifyUrl(
  mapServer: string,
  lng: number,
  lat: number,
  layers: 'all' | number[],
): string {
  const d = 0.0005;
  const p = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: 'esriGeometryPoint',
    sr: '4326',
    layers: Array.isArray(layers) ? `all:${layers.join(',')}` : 'all',
    tolerance: '0',
    mapExtent: `${lng - d},${lat - d},${lng + d},${lat + d}`,
    imageDisplay: '400,400,96',
    returnGeometry: 'false',
  });
  return `${mapServer}/identify?${p}`;
}

interface IdentifyResult {
  layerId?: number;
  layerName?: string;
  value?: string;
  attributes?: Record<string, unknown>;
}
interface IdentifyResponse { results?: IdentifyResult[]; error?: { message?: string } }

/**
 * The shape judgement, shared by every identify parser.
 *
 * An error body or a body with no `results` array is a FAILURE. It must never
 * read as "no control applies here" — the rule `arcgisFeatures` already
 * answers to, restated because `identify` has a different envelope and a
 * second implementation is how the two come to disagree.
 */
export function identifyResults(body: unknown):
  | { kind: 'ok'; results: IdentifyResult[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string } {
  const b = body as IdentifyResponse | null;
  if (!b || typeof b !== 'object') return { kind: 'error', message: 'non-object response' };
  if (b.error) return { kind: 'error', message: attrStr(b.error.message) ?? 'service error' };
  if (!Array.isArray(b.results)) return { kind: 'error', message: 'no results array in response' };
  if (b.results.length === 0) return { kind: 'empty' };
  return { kind: 'ok', results: b.results };
}

/**
 * Which family a publisher's own layer name belongs to.
 *
 * Used where a register publishes dozens of layers under descriptive names
 * rather than a code — Queensland's 26 MSES layers, Tasmania's codes, the
 * Queensland regional plans. It is safe to classify by keyword HERE and
 * nowhere else, because the family only chooses which explanation is attached:
 * the row always prints the publisher's own label, and an unrecognised name
 * files as `other` and prints unexplained rather than under a guess.
 */
export function familyFromLabel(label: string): { family: ConstraintFamily; kind: ConstraintKind } {
  const t = label.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has('bushfire', 'wildfire', 'bush fire', 'fire scar')) return { family: 'bushfire', kind: 'hazard' };
  if (has('flood', 'inundation', 'floodway', 'storm tide', 'aep')) return { family: 'flood', kind: 'hazard' };
  if (has('landslip', 'landslide')) return { family: 'landslide', kind: 'hazard' };
  if (has('erosion')) return { family: 'erosion', kind: 'hazard' };
  if (has('coastal', 'foreshore protection')) return { family: 'coastal', kind: 'hazard' };
  if (has('acid sulfate')) return { family: 'acidSulfateSoils', kind: 'hazard' };
  if (has('contaminat', 'environmental audit')) return { family: 'contamination', kind: 'hazard' };
  if (has('heritage', 'historic', 'archaeolog')) return { family: 'heritage', kind: 'control' };
  if (has('airport', 'obstacle limitation', 'aircraft noise')) return { family: 'airportNoise', kind: 'control' };
  if (has('drinking water')) return { family: 'drinkingWaterCatchment', kind: 'protection' };
  if (has('groundwater')) return { family: 'groundwater', kind: 'protection' };
  if (has('riparian', 'watercourse', 'waterway')) return { family: 'riparian', kind: 'protection' };
  if (has('salinity')) return { family: 'salinity', kind: 'protection' };
  if (has('wetland')) return { family: 'wetlands', kind: 'protection' };
  if (has('vegetation', 'koala', 'habitat', 'biodiversity', 'ecological', 'nature refuge', 'fish habitat'))
    return { family: 'biodiversity', kind: 'protection' };
  if (has('scenic', 'landscape', 'dark sky')) return { family: 'scenicProtection', kind: 'protection' };
  if (has('environmentally sensitive', 'strategic environmental', 'protected area', 'marine park', 'conservation area'))
    return { family: 'environmentallySensitive', kind: 'protection' };
  if (has('mineral', 'extractive', 'resource land', 'quarry')) return { family: 'mineralResource', kind: 'protection' };
  if (has('acquisition', 'reservation')) return { family: 'acquisition', kind: 'control' };
  if (has('contribution', 'infrastructure charge')) return { family: 'developmentContributions', kind: 'control' };
  if (has('parking')) return { family: 'parking', kind: 'control' };
  if (has('design', 'character', 'development plan', 'urban design')) return { family: 'design', kind: 'control' };
  if (has('regional plan', 'land use category', 'regional land use')) return { family: 'regionalPlan', kind: 'context' };
  if (has('priority living', 'priority development', 'growth', 'urban area', 'development area'))
    return { family: 'growthArea', kind: 'context' };
  return { family: 'other', kind: 'context' };
}

// ---------------------------------------------------------------------------
// NSW — three services, one identify each
// ---------------------------------------------------------------------------

const NSW_BASE = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning';

export const NSW_PRINCIPAL_SOURCE = 'NSW Planning Portal — Principal Planning Layers';
export const NSW_HAZARD_SOURCE = 'NSW Planning Portal — Hazard';
export const NSW_PROTECTION_SOURCE = 'NSW Planning Portal — Protection';
export const NSW_LICENCE = 'CC BY 4.0';

/**
 * The Principal Planning sublayers that carry a control, and what each is.
 *
 * Transcribed from the service's own layer list, read from production on
 * 17 Sep 2026 — never from documentation, which is the `airtableIntakeFields`
 * rule. The group layers (7, 9, 12, 15, 17, 20) and the four "Additional
 * Controls" children are deliberately absent: they carry no reading.
 */
export const NSW_PRINCIPAL_CONTROL_LAYERS: Readonly<
  Record<number, { family: ConstraintFamily; kind: ConstraintKind }>
> = {
  11: { family: 'floorSpaceRatio', kind: 'control' },
  14: { family: 'height', kind: 'control' },
  16: { family: 'heritage', kind: 'control' },
  22: { family: 'minimumLotSize', kind: 'control' },
  24: { family: 'acquisition', kind: 'control' },
  25: { family: 'dwellingDensity', kind: 'control' },
  26: { family: 'foreshoreBuildingLine', kind: 'control' },
  221: { family: 'heritage', kind: 'control' },
};

/** Bushfire, flood and landslide. Explicit ids: the group is not visible by default. */
export const NSW_HAZARD_LAYERS: Readonly<Record<number, { family: ConstraintFamily; kind: ConstraintKind }>> = {
  229: { family: 'bushfire', kind: 'hazard' },
  230: { family: 'flood', kind: 'hazard' },
  231: { family: 'flood', kind: 'hazard' },
  232: { family: 'landslide', kind: 'hazard' },
};

export const NSW_PROTECTION_LAYERS: Readonly<Record<number, { family: ConstraintFamily; kind: ConstraintKind }>> = {
  234: { family: 'acidSulfateSoils', kind: 'hazard' },
  235: { family: 'airportNoise', kind: 'control' },
  236: { family: 'drinkingWaterCatchment', kind: 'protection' },
  237: { family: 'groundwater', kind: 'protection' },
  238: { family: 'mineralResource', kind: 'protection' },
  239: { family: 'airportNoise', kind: 'control' },
  240: { family: 'riparian', kind: 'protection' },
  241: { family: 'salinity', kind: 'protection' },
  242: { family: 'scenicProtection', kind: 'protection' },
  243: { family: 'biodiversity', kind: 'protection' },
  244: { family: 'wetlands', kind: 'protection' },
  245: { family: 'environmentallySensitive', kind: 'protection' },
};

export const buildNswPrincipalIdentify = (lng: number, lat: number): string =>
  buildIdentifyUrl(`${NSW_BASE}/Planning_Portal_Principal_Planning/MapServer`, lng, lat, 'all');

export const buildNswHazardIdentify = (lng: number, lat: number): string =>
  buildIdentifyUrl(`${NSW_BASE}/Planning_Portal_Hazard/MapServer`, lng, lat,
    Object.keys(NSW_HAZARD_LAYERS).map(Number));

export const buildNswProtectionIdentify = (lng: number, lat: number): string =>
  buildIdentifyUrl(`${NSW_BASE}/Planning_Portal_Protection/MapServer`, lng, lat,
    Object.keys(NSW_PROTECTION_LAYERS).map(Number));

/**
 * The measured value a NSW control layer publishes, with its unit.
 *
 * Each layer names its figure differently and only three of them carry one at
 * all, so this is a lookup rather than a scan: guessing a numeric field is how
 * an OBJECTID prints as a building height.
 */
function nswControlValue(family: ConstraintFamily, a: Record<string, unknown>): string | null {
  const unit = attrStr(a['Units']);
  const withUnit = (v: string | null) => (v === null ? null : unit ? `${v} ${unit}` : v);
  switch (family) {
    case 'height': return withUnit(attrStr(a['Maximum Building Height']) ?? attrStr(a['MAX_B_H_M']));
    case 'minimumLotSize': return withUnit(attrStr(a['Lot Size']));
    case 'floorSpaceRatio': {
      const fsr = attrStr(a['Floor Space Ratio']);
      // The instrument states a ratio; printing `0.5` alone reads as a
      // percentage or a decimal of something unnamed.
      return fsr === null ? null : `${fsr}:1`;
    }
    default: return null;
  }
}

function nswReading(
  r: IdentifyResult,
  map: Readonly<Record<number, { family: ConstraintFamily; kind: ConstraintKind }>>,
  source: string,
): PlanningConstraintReading | null {
  const id = typeof r.layerId === 'number' ? r.layerId : null;
  if (id === null) return null;
  const cls = map[id];
  if (!cls) return null;
  const a = r.attributes ?? {};
  const heritageName = attrStr(a['Item Name']);
  const heritageType = attrStr(a['Heritage Type']);
  const significance = attrStr(a['Significance']);
  const detail = cls.family === 'heritage'
    ? [heritageType, significance ? `${significance} significance` : null].filter(Boolean).join(' · ') || null
    : attrStr(a['Layer Class']) ?? attrStr(a['Category']) ?? attrStr(a['Class']);
  return {
    family: cls.family,
    kind: cls.kind,
    sourceLayer: id,
    label: cls.family === 'heritage' && heritageName ? heritageName : (attrStr(r.layerName) ?? 'Planning control'),
    code: attrStr(a['Item Number']) ?? attrStr(a['Symbol Code']) ?? attrStr(a['LABEL']),
    value: nswControlValue(cls.family, a),
    instrument: attrStr(a['EPI Name']),
    clause: attrStr(a['Legislative Clause']),
    currencyDate: identifyDateToIso(a['Currency Date']) ?? identifyDateToIso(a['Commenced Date']),
    detail,
    // NSW's spatial viewer publishes neither an instrument standing nor a
    // region on these layers; the LEP's own name and commencement come from
    // `parseNswInstrument`, which reads layer 8.
    standingLabel: null,
    region: null,
    source,
    licence: NSW_LICENCE,
  };
}

/** Parse any of the three NSW identify answers against its own layer map. */
export function parseNswConstraints(
  body: unknown,
  map: Readonly<Record<number, { family: ConstraintFamily; kind: ConstraintKind }>>,
  source: string,
): ConstraintProbeOutcome {
  const asked = [...new Set(Object.values(map).map((m) => m.family))];
  const out = identifyResults(body);
  if (out.kind === 'error') {
    return { asked, status: 'unavailable', readings: [], source, licence: NSW_LICENCE, note: out.message };
  }
  if (out.kind === 'empty') {
    return { asked, status: 'none_at_point', readings: [], source, licence: NSW_LICENCE, note: null };
  }
  const readings = out.results
    .map((r) => nswReading(r, map, source))
    .filter((r): r is PlanningConstraintReading => r !== null);
  return {
    asked,
    status: readings.length ? 'ok' : 'none_at_point',
    readings,
    source,
    licence: NSW_LICENCE,
    note: null,
  };
}

/**
 * The instrument every NSW control belongs to, read from the same answer.
 *
 * Layer 8 is the Local Environmental Plan itself — its name, its amendment
 * number and its published date. It is not a control and draws no row; it is
 * what lets the report say WHICH instrument the height and the lot size come
 * from, which is the first question a town planner asks.
 */
export function parseNswInstrument(body: unknown):
  { name: string; amendment: string | null; commenced: string | null; lga: string | null } | null {
  const out = identifyResults(body);
  if (out.kind !== 'ok') return null;
  const lep = out.results.find((r) => r.layerId === 8);
  if (!lep) return null;
  const a = lep.attributes ?? {};
  const name = attrStr(a['EPI Name']);
  if (!name) return null;
  return {
    name,
    amendment: attrStr(a['Amendment']),
    commenced: identifyDateToIso(a['Commenced Date']),
    lga: attrStr(a['LGA Name']),
  };
}

// ---------------------------------------------------------------------------
// VIC — `plan_overlay`, one word different from the zone query we already make
// ---------------------------------------------------------------------------

export const VIC_OVERLAY_SOURCE = 'Vicmap Planning — plan_overlay (opendata.maps.vic.gov.au WFS)';
export const VIC_OVERLAY_LICENCE = 'CC BY 4.0';

/**
 * The Victoria Planning Provisions overlay codes, by scheme code.
 *
 * Victoria's overlays are a closed, state-wide vocabulary — every scheme uses
 * the same two-to-four letter code with a local schedule number — so this maps
 * the code and the SCHEDULE is carried through as the code on the row. An
 * unlisted code is `other` and prints under the layer's own description, which
 * is how a new overlay type reaches a report unexplained rather than wrong.
 */
export const VIC_OVERLAY_FAMILY: Readonly<Record<string, { family: ConstraintFamily; kind: ConstraintKind }>> = {
  HO: { family: 'heritage', kind: 'control' },
  DDO: { family: 'design', kind: 'control' },
  NCO: { family: 'design', kind: 'control' },
  DPO: { family: 'design', kind: 'control' },
  LSIO: { family: 'flood', kind: 'hazard' },
  FO: { family: 'flood', kind: 'hazard' },
  SBO: { family: 'flood', kind: 'hazard' },
  BMO: { family: 'bushfire', kind: 'hazard' },
  WMO: { family: 'bushfire', kind: 'hazard' },
  EMO: { family: 'erosion', kind: 'hazard' },
  EAO: { family: 'contamination', kind: 'hazard' },
  SLO: { family: 'scenicProtection', kind: 'protection' },
  ESO: { family: 'environmentallySensitive', kind: 'protection' },
  VPO: { family: 'vegetation', kind: 'protection' },
  SMO: { family: 'salinity', kind: 'protection' },
  DCPO: { family: 'developmentContributions', kind: 'control' },
  ICO: { family: 'infrastructureContribution', kind: 'control' },
  PAO: { family: 'acquisition', kind: 'control' },
  PO: { family: 'parking', kind: 'control' },
  AEO: { family: 'airportNoise', kind: 'control' },
  SRO: { family: 'mineralResource', kind: 'protection' },
  RXO: { family: 'other', kind: 'context' },
};

export function buildVicOverlayQuery(lng: number, lat: number): string {
  const p = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'open-data-platform:plan_overlay',
    outputFormat: 'application/json',
    count: '30',
    propertyName: 'zone_code,zone_description,scheme_code,lga,zone_status,gaz_begin_date',
    CQL_FILTER: `INTERSECTS(geom,SRID=4326;POINT(${lng} ${lat}))`,
  });
  return `https://opendata.maps.vic.gov.au/geoserver/wfs?${p}`;
}

interface WfsResponse { features?: Array<{ properties?: Record<string, unknown> }>; exceptions?: unknown }

export function parseVicOverlays(body: unknown): ConstraintProbeOutcome {
  const asked = [...new Set(Object.values(VIC_OVERLAY_FAMILY).map((m) => m.family))];
  const base = { asked, source: VIC_OVERLAY_SOURCE, licence: VIC_OVERLAY_LICENCE };
  const b = body as WfsResponse | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.features)) {
    return { ...base, status: 'unavailable', readings: [], note: 'no features array in WFS response' };
  }
  const readings = b.features.map((f): PlanningConstraintReading => {
    const p = f.properties ?? {};
    const scheme = attrStr(p['scheme_code']);
    // Written as two statements rather than one `&&`/`??` chain: `scheme && …`
    // carries the empty string through, which `??` does not catch, so `cls`
    // would be `''` and every field read off it `undefined`. `attrStr` never
    // answers `''` today, but a classification must not rest on an invariant
    // held in another function.
    const schemeClass = scheme ? VIC_OVERLAY_FAMILY[scheme.toUpperCase()] : undefined;
    const cls = schemeClass ?? familyFromLabel(attrStr(p['zone_description']) ?? '');
    const lga = attrStr(p['lga']);
    return {
      family: cls.family,
      kind: cls.kind,
      // A WFS feature carries no layer id — Victoria publishes features, not
      // identify results — and an absent identifier identifies nothing.
      sourceLayer: null,
      // Title-cased by the report, not here: the WFS shouts its descriptions
      // (`DESIGN AND DEVELOPMENT OVERLAY - SCHEDULE 1`) and a renderer that
      // lower-cases loses `DDO`.
      label: attrStr(p['zone_description']) ?? scheme ?? 'Planning overlay',
      code: attrStr(p['zone_code']),
      value: null,
      instrument: lga ? `${lga} Planning Scheme` : null,
      // The schedule IS the clause in Victoria: `HO544` is the only reference
      // a planner needs to find the control's own words.
      clause: attrStr(p['zone_code']),
      currencyDate: identifyDateToIso(p['gaz_begin_date']),
      // `g` is gazetted; anything else is an interim or proposed control, and
      // the difference decides whether it binds today.
      detail: attrStr(p['zone_status']) === 'g' ? 'Gazetted' : attrStr(p['zone_status']),
      // Gazettal IS the standing in Victoria — it is the difference between a
      // control that binds today and an interim or proposed one.
      standingLabel: attrStr(p['zone_status']) === 'g' ? 'Gazetted' : attrStr(p['zone_status']),
      region: null,
      source: VIC_OVERLAY_SOURCE,
      licence: VIC_OVERLAY_LICENCE,
    };
  });
  return { ...base, status: readings.length ? 'ok' : 'none_at_point', readings, note: null };
}

// ---------------------------------------------------------------------------
// QLD — state planning context, flood hazard, environmental significance
// ---------------------------------------------------------------------------

const QLD_BASE = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services';
export const QLD_STATE_PLANNING_CONTEXT_SOURCE =
  'Queensland StatePlanning — regional plans, priority living areas and state development instruments';
export const QLD_FLOODCHECK_SOURCE = 'Queensland FloodCheck — Rapid Hazard Assessment';
export const QLD_MSES_SOURCE = 'Queensland Matters of State Environmental Significance';
export const QLD_LICENCE = 'CC BY 4.0';

export const buildQldStatePlanningIdentify = (lng: number, lat: number): string =>
  buildIdentifyUrl(`${QLD_BASE}/PlanningCadastre/StatePlanning/MapServer`, lng, lat, 'all');

export const buildQldFloodIdentify = (lng: number, lat: number): string =>
  buildIdentifyUrl(`${QLD_BASE}/FloodCheck/RapidHazardAssessment/MapServer`, lng, lat, [0]);

export const buildQldMsesIdentify = (lng: number, lat: number): string =>
  buildIdentifyUrl(`${QLD_BASE}/Environment/MattersOfStateEnvironmentalSignificance/MapServer`, lng, lat, 'all');

/**
 * Parse an identify answer whose layers are named rather than numbered.
 *
 * `askedFamilies` is passed in rather than derived, because what the register
 * COVERS is a property of the register and not of what happened to be found:
 * a QLD flood answer with no results means the assessment found no hazard at
 * the point, and that is only readable as such if the reader is told flood is
 * what was asked.
 */
export function parseNamedLayerConstraints(
  body: unknown,
  opts: {
    asked: ConstraintFamily[];
    source: string;
    licence: string;
    instrument?: string | null;
    /**
     * The family every reading from this register belongs to.
     *
     * Required for a SINGLE-PURPOSE register, and this is the defect that made
     * it required. Queensland's FloodCheck Rapid Hazard Assessment answers at
     * 262 Pallas Street with the value `Lower Mary River` — the sub-basin's
     * own name — and classifying by that label finds no flood keyword in it,
     * so a **flood hazard reading on a Mary River property was filed as
     * "Strategic context"**, dropped out of the hazard ordering, appeared in
     * the infrastructure outlook, and left the coverage line saying flood had
     * been "checked and not mapped at this coordinate".
     *
     * Four wrong statements from one classification. A register that answers
     * one question knows the answer's kind better than a keyword scan of what
     * the feature happens to be called, so the caller states it and
     * `familyFromLabel` is used only where a register genuinely publishes many
     * kinds under descriptive names.
     */
    family?: { family: ConstraintFamily; kind: ConstraintKind };
  },
): ConstraintProbeOutcome {
  const base = { asked: opts.asked, source: opts.source, licence: opts.licence };
  const out = identifyResults(body);
  if (out.kind === 'error') return { ...base, status: 'unavailable', readings: [], note: out.message };
  if (out.kind === 'empty') return { ...base, status: 'none_at_point', readings: [], note: null };
  const readings = out.results.map((r): PlanningConstraintReading => {
    const a = r.attributes ?? {};
    const layerName = attrStr(r.layerName) ?? 'Mapped area';
    const value = attrStr(r.value);
    const cls = opts.family ?? familyFromLabel(`${layerName} ${value ?? ''}`);
    // The publisher's own word for the instrument's standing. The version
    // rides with it when it is not parseable as a date: `December 2023` is a
    // real statement of which version is in force, and turning it into
    // `1 December 2023` would print a day the publisher never stated.
    const standing = [
      attrStr(a['Legal status']) ? `${attrStr(a['Legal status'])} instrument` : null,
      attrStr(a['Version']) && !identifyDateToIso(a['Version']) ? `version ${attrStr(a['Version'])}` : null,
    ].filter(Boolean).join(' · ') || null;
    const hazardClass = attrStr(a['Hazard']) ?? attrStr(a['Class']) ?? attrStr(a['Category']);
    return {
      family: cls.family,
      kind: cls.kind,
      sourceLayer: typeof r.layerId === 'number' ? r.layerId : null,
      /*
       * The feature's own name where it has one, else the layer's. At 262
       * Pallas Street that is the difference between "Priority Living Area"
       * and "Maryborough Priority Living Area".
       *
       * On a single-purpose register it is the other way round: the LAYER
       * says what was found and the feature says where. "Lower Mary River" is
       * not a finding a reader can act on; "Rapid Hazard Assessment — Lower
       * Mary River" is.
       */
      label: opts.family
        ? (value && value !== layerName ? `${layerName} — ${value}` : layerName)
        : (value && value !== layerName ? value : layerName),
      code: null,
      value: null,
      instrument: attrStr(a['Plan Name']) ?? opts.instrument ?? layerName,
      clause: null,
      currencyDate: identifyDateToIso(a['Version']) ?? identifyDateToIso(a['Currency Date']),
      // `detail` is still the whole join — it is what the register table's
      // "What the register returned" column prints, and it reads correctly
      // there because that column is explicitly a summary of what came back.
      // `standingLabel` and `region` carry the two parts a consumer needs to
      // put in a column of their own.
      detail: [standing, attrStr(a['Region']), hazardClass].filter(Boolean).join(' · ') || null,
      standingLabel: standing,
      region: attrStr(a['Region']),
      source: opts.source,
      licence: opts.licence,
    };
  });
  return { ...base, status: readings.length ? 'ok' : 'none_at_point', readings, note: null };
}

// ---------------------------------------------------------------------------
// TAS — the Code Overlay and the General Overlay
// ---------------------------------------------------------------------------

export const TAS_OVERLAY_SOURCE = 'theLIST — Tasmanian Planning Scheme overlays (services.thelist.tas.gov.au)';
export const TAS_OVERLAY_LICENCE = 'CC BY 3.0 AU';

/** Layer 14 is the Code Overlay, 15 the General Overlay. Both answer at a point. */
export function buildTasOverlayQuery(layer: 14 | 15, lng: number, lat: number): string {
  const p = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'LPS,CODE,OV_NAME,OV_CAT,OV_ABB,DESCRIPT,LPS_REF,LPSDATE',
    returnGeometry: 'false',
  });
  return `https://services.thelist.tas.gov.au/arcgis/rest/services/Public/PlanningOnline/MapServer/${layer}/query?${p}`;
}

interface ArcgisQueryResponse {
  features?: Array<{ attributes?: Record<string, unknown> }>;
  error?: { message?: string };
}

export function parseTasOverlays(body: unknown): ConstraintProbeOutcome {
  const base = {
    // Tasmania's codes are a fixed schedule of the state scheme; these are the
    // families the two overlay layers can answer.
    asked: ['heritage', 'bushfire', 'flood', 'landslide', 'coastal', 'riparian',
      'biodiversity', 'scenicProtection', 'airportNoise', 'contamination'] as ConstraintFamily[],
    source: TAS_OVERLAY_SOURCE,
    licence: TAS_OVERLAY_LICENCE,
  };
  const b = body as ArcgisQueryResponse | null;
  if (!b || typeof b !== 'object') return { ...base, status: 'unavailable', readings: [], note: 'non-object response' };
  if (b.error) return { ...base, status: 'unavailable', readings: [], note: attrStr(b.error.message) ?? 'service error' };
  if (!Array.isArray(b.features)) return { ...base, status: 'unavailable', readings: [], note: 'no features array' };
  const readings = b.features.map((f): PlanningConstraintReading => {
    const a = f.attributes ?? {};
    const code = attrStr(a['CODE']);
    const name = attrStr(a['OV_NAME']) ?? attrStr(a['OV_CAT']);
    const cls = familyFromLabel(`${code ?? ''} ${name ?? ''}`);
    return {
      family: cls.family,
      kind: cls.kind,
      label: name ?? code ?? 'Planning overlay',
      code: attrStr(a['OV_ABB']),
      value: null,
      instrument: attrStr(a['LPS']),
      clause: attrStr(a['LPS_REF']) ?? code,
      currencyDate: identifyDateToIso(a['LPSDATE']),
      detail: attrStr(a['DESCRIPT']) ?? (code && code !== name ? code : null),
      // theLIST publishes the overlay's description, not a standing or a
      // region, on either overlay layer.
      standingLabel: null,
      region: null,
      source: TAS_OVERLAY_SOURCE,
      licence: TAS_OVERLAY_LICENCE,
    };
  });
  return { ...base, status: readings.length ? 'ok' : 'none_at_point', readings, note: null };
}

/**
 * Merge several registers' answers into one set, keeping every register's
 * coverage claim.
 *
 * The union of `asked` is what makes a short list readable: three registers
 * answering `none_at_point` and one answering `unavailable` is a very
 * different report from four clean answers, and a merged list that lost which
 * was which could not say so.
 */
export function mergeConstraintOutcomes(outcomes: ConstraintProbeOutcome[]): {
  readings: PlanningConstraintReading[];
  askedFamilies: ConstraintFamily[];
  registersAnswered: string[];
  registersUnavailable: string[];
} {
  const readings: PlanningConstraintReading[] = [];
  const asked = new Set<ConstraintFamily>();
  const answered: string[] = [];
  const unavailable: string[] = [];
  for (const o of outcomes) {
    if (o.status === 'unavailable') {
      unavailable.push(o.note ? `${o.source} (${o.note})` : o.source);
      // An unreached register claims no coverage: counting its families as
      // "asked" is how an outage comes to read as a clean property.
      continue;
    }
    if (o.status === 'not_served') continue;
    for (const f of o.asked) asked.add(f);
    answered.push(o.source);
    readings.push(...o.readings);
  }
  // A control the reader must act on first: hazards, then what limits the
  // build, then what is protected, then where it sits in a plan.
  const rank: Record<ConstraintKind, number> = { hazard: 0, control: 1, protection: 2, context: 3 };
  readings.sort((a, b) => rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label));
  return {
    readings,
    askedFamilies: [...asked],
    registersAnswered: [...new Set(answered)],
    registersUnavailable: [...new Set(unavailable)],
  };
}

/**
 * A family's name in a sentence a client reads.
 *
 * Used where the report states COVERAGE — "bushfire, flood and landslide were
 * checked and none applies" — so the list has to read as English rather than
 * as the identifiers the code uses. The rule `partnerRoster.pure.ts` already
 * answers to: database vocabulary never reaches the operator.
 */
export const CONSTRAINT_FAMILY_LABEL: Readonly<Record<ConstraintFamily, string>> = {
  height: 'maximum building height',
  floorSpaceRatio: 'floor space ratio',
  minimumLotSize: 'minimum lot size',
  dwellingDensity: 'minimum dwelling density',
  heritage: 'heritage',
  design: 'design and character controls',
  bushfire: 'bushfire',
  flood: 'flood',
  landslide: 'landslip',
  erosion: 'erosion',
  coastal: 'coastal hazard',
  acidSulfateSoils: 'acid sulfate soils',
  airportNoise: 'airport noise and obstacle limits',
  drinkingWaterCatchment: 'drinking-water catchment',
  groundwater: 'groundwater vulnerability',
  riparian: 'riparian land and watercourses',
  salinity: 'salinity',
  biodiversity: 'biodiversity and habitat',
  wetlands: 'wetlands',
  vegetation: 'vegetation protection',
  scenicProtection: 'scenic and landscape protection',
  environmentallySensitive: 'environmentally sensitive land',
  contamination: 'contaminated land',
  mineralResource: 'mineral and extractive resources',
  acquisition: 'land reserved for acquisition',
  foreshoreBuildingLine: 'foreshore building line',
  developmentContributions: 'development contributions',
  infrastructureContribution: 'infrastructure contributions',
  parking: 'parking controls',
  regionalPlan: 'regional plan designation',
  growthArea: 'growth and priority development areas',
  other: 'other mapped designations',
};
