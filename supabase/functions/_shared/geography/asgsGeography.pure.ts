/**
 * ME-5 — canonical Australian geography, resolved from a coordinate.
 *
 * ## The blocker this removes
 *
 * ME-4 measured that **suburb, postcode and state are stored on 0 of 1,204**
 * historical reports while coordinates are present on 1,113. A licensed
 * suburb-grain dataset cannot be joined to a corpus that has no suburb, so the
 * historical backtest was blocked on geography rather than on evidence — and
 * that blocker is ours, not a provider's.
 *
 * ## Why point-in-polygon and not reverse geocoding
 *
 * The ABS publishes the Australian Statistical Geography Standard as queryable
 * boundaries at `geo.abs.gov.au`, and a point query against them is:
 *
 * - **deterministic** — the same coordinate returns the same area, always;
 * - **authoritative** — they are the boundaries the ABS itself publishes
 *   statistics against, so the geography and the evidence share one definition;
 * - **auditable** — every resolution records the layer, the ASGS release and
 *   the exact coordinate it was taken from;
 * - **reproducible** — the answer is stored, so a backtest rerun never depends
 *   on the service being up.
 *
 * A commercial reverse-geocoder is none of the first three. It is retained
 * only as an optional cross-check, never as the authority.
 *
 * **The free-text address is never consulted.** `ADDRESS_COMPOSITION.md`
 * records why: Make geocodes `{{address}},{{suburb}}` with no street number,
 * Google answers with a suburb centroid, and a second model call writes eight
 * address columns back over the extraction — so `Full Address` reads
 * `Cobblebank VIC 3338, Australia` on a record that knows `Mortlock Street`.
 * Measured on that very coordinate, the ASGS SAL layer returns **Melton
 * South**, which is correct, while the stored string is not. A string that has
 * been through that loop cannot prove which suburb a property is in.
 *
 * ## What is derived rather than fetched
 *
 * `abs_sa2_meta` already holds 2,454 SA2 rows carrying SA3, SA4, GCCSA and
 * state. So the SA2 point query answers five questions, and only SAL, POA, SA2
 * and the remoteness/urban-centre layers need the boundary service at all.
 * Deriving beats fetching: fewer calls, and the hierarchy cannot disagree with
 * itself.
 *
 * ## The rule that decides everything here
 *
 * **A coordinate that cannot be placed is left unplaced.** Coverage is not the
 * objective; correct geography is. Forcing an uncertain point into a suburb
 * would attach real market evidence to the wrong property, and every figure
 * downstream would inherit the error silently — which is worse than a report
 * the backtest honestly skips.
 */

import { isAustraliaCentroid } from '../geocodeGranularity.pure.ts';

/** The ASGS edition every boundary in this module is read from. */
export const ASGS_RELEASE = 'ASGS2021';

/** Where the boundaries came from, recorded on every resolution. */
export const BOUNDARY_SOURCE = 'ABS ASGS 2021 (geo.abs.gov.au ArcGIS REST)';

/**
 * How a resolution turned out.
 *
 * Four states rather than two, because "we could not place this" and "we
 * placed it but you should look" are different facts to an operator, and
 * collapsing them is how an uncertain point becomes a confident one.
 */
export type GeographyStatus =
  | 'resolved'
  | 'resolved_with_warning'
  | 'requires_review'
  | 'unresolved';

/** Why a resolution is not a clean `resolved`. */
export type GeographyFlag =
  | 'missing_coordinate'
  | 'invalid_coordinate'
  | 'outside_australia'
  | 'geocoder_country_fallback'
  | 'outside_all_polygons'
  | 'near_locality_boundary'
  | 'suburb_postcode_mismatch'
  | 'state_mismatch'
  | 'suburb_not_in_directory'
  | 'boundary_service_unavailable';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * The bounding box of Australia including its external territories that the
 * ASGS covers.
 *
 * Deliberately generous: a point inside the box is merely *plausible* and is
 * still proved or refused by the polygon query. The box exists to refuse the
 * obviously-impossible before spending a request on it — measured, 183 of
 * 1,113 stored coordinates fall outside it, at latitudes as far north as 55.9
 * and longitudes as far west as −122.3.
 */
export const AUSTRALIA_BBOX = {
  minLatitude: -55.0,   // Macquarie Island
  maxLatitude: -9.0,    // Boigu Island, Torres Strait
  minLongitude: 72.0,   // Heard and McDonald Islands
  maxLongitude: 168.0,  // Norfolk Island
} as const;

/** Is this a coordinate at all? */
export function isValidCoordinate(c: Partial<Coordinate> | null | undefined): c is Coordinate {
  if (!c) return false;
  const { latitude: lat, longitude: lng } = c as Coordinate;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // (0,0) is in the Gulf of Guinea and is the classic "unset" value.
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** Could this coordinate plausibly be in Australia? */
export function isPlausiblyAustralian(c: Coordinate): boolean {
  return c.latitude >= AUSTRALIA_BBOX.minLatitude
    && c.latitude <= AUSTRALIA_BBOX.maxLatitude
    && c.longitude >= AUSTRALIA_BBOX.minLongitude
    && c.longitude <= AUSTRALIA_BBOX.maxLongitude;
}

/** One ASGS area as the boundary service returns it. */
export interface AsgsArea {
  code: string;
  name: string;
}

/** What a boundary query produced, before validation. */
export interface AsgsLookup {
  /** Suburbs and Localities — the suburb. */
  sal: AsgsArea | null;
  /** Postal Areas — the postcode. */
  poa: AsgsArea | null;
  /** Statistical Area Level 2. */
  sa2: AsgsArea | null;
  /** Remoteness Area, for the metro/regional question. */
  ra: AsgsArea | null;
  /** Urban Centre and Locality — the nearest real urban centre. */
  ucl: AsgsArea | null;
  /** Significant Urban Area. */
  sua: AsgsArea | null;
  /**
   * Distinct SAL areas intersecting a small envelope around the point. More
   * than one means the coordinate sits near a locality boundary, where a
   * metre of error changes the answer.
   */
  salNeighbours: ReadonlyArray<AsgsArea>;
  /** True when the service could not be reached at all. */
  serviceFailed: boolean;
}

/** The SA2 hierarchy, joined locally from `abs_sa2_meta`. */
export interface Sa2Hierarchy {
  sa2Code: string;
  sa2Name: string;
  sa3Name: string | null;
  sa4Name: string | null;
  gccsaName: string | null;
  stateName: string | null;
}

/** A `suburb_directory` row, used only to validate — never to decide. */
export interface DirectoryEntry {
  suburb: string;
  state: string;
  postcode: string;
}

/**
 * The canonical geography record.
 *
 * The coordinate stays the source fact; everything else is a derived fact with
 * its own provenance. Nothing here is written back onto the report.
 */
export interface ResolvedGeography {
  /** Echoed so the record is self-contained and auditable. */
  latitude: number | null;
  longitude: number | null;

  suburb: string | null;
  localityCode: string | null;
  postcode: string | null;
  state: string | null;

  sa2Code: string | null;
  sa2Name: string | null;
  sa3Name: string | null;
  sa4Name: string | null;
  gccsaName: string | null;

  /** Remoteness Area, e.g. "Major Cities of Australia", "Inner Regional". */
  remotenessArea: string | null;
  /** The urban centre the point actually sits in — Melton, not Melbourne. */
  urbanCentre: string | null;
  significantUrbanArea: string | null;

  status: GeographyStatus;
  flags: ReadonlyArray<GeographyFlag>;
  /** Human sentences an operator can act on. */
  notes: ReadonlyArray<string>;

  method: 'asgs_point_in_polygon' | 'none';
  boundarySource: string;
  sourceVersion: string;
}

const STATE_ABBREVIATION: Readonly<Record<string, string>> = {
  'new south wales': 'NSW',
  'victoria': 'VIC',
  'queensland': 'QLD',
  'south australia': 'SA',
  'western australia': 'WA',
  'tasmania': 'TAS',
  'northern territory': 'NT',
  'australian capital territory': 'ACT',
  'other territories': 'OT',
};

/** ABS state names to the abbreviation the rest of the platform uses. */
export function toStateAbbreviation(name: string | null | undefined): string | null {
  if (!name) return null;
  return STATE_ABBREVIATION[name.trim().toLowerCase()] ?? null;
}

/**
 * Strip the ABS's disambiguating qualifier from a locality name.
 *
 * ASGS locality names carry a bracketed qualifier where the name repeats
 * across the country — `Fernvale (Qld)`, `Armadale (WA)`, `Churchill (Vic.)`,
 * `Springfield (Ipswich - Qld)`. The suburb directory stores the plain name,
 * so an exact comparison fails on every one of them.
 *
 * Measured: this accounted for **all 144** of the corpus's
 * `suburb_not_in_directory` warnings, and once normalised the postcode AND the
 * state agreed with the directory on **all 144, with zero disagreements**. It
 * was a name-format difference, never a geography error — which is exactly the
 * distinction a validation layer exists to make.
 *
 * The ABS name is what is STORED; this normalisation is used only to compare.
 */
export function stripLocalityQualifier(v: string): string {
  return v.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Compare place names ignoring case, punctuation, spacing and ABS qualifiers. */
export function normalisePlaceName(v: string): string {
  return stripLocalityQualifier(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unresolved(
  coordinate: Coordinate | null,
  flag: GeographyFlag,
  note: string,
): ResolvedGeography {
  return {
    latitude: coordinate?.latitude ?? null,
    longitude: coordinate?.longitude ?? null,
    suburb: null, localityCode: null, postcode: null, state: null,
    sa2Code: null, sa2Name: null, sa3Name: null, sa4Name: null, gccsaName: null,
    remotenessArea: null, urbanCentre: null, significantUrbanArea: null,
    status: 'unresolved',
    flags: [flag],
    notes: [note],
    method: 'none',
    boundarySource: BOUNDARY_SOURCE,
    sourceVersion: ASGS_RELEASE,
  };
}

export interface ResolveInput {
  coordinate: Partial<Coordinate> | null | undefined;
  lookup: AsgsLookup | null;
  hierarchy: Sa2Hierarchy | null;
  /**
   * Directory rows matching the resolved suburb, for validation only.
   *
   * **Three states, and they are three different facts.** This distinction is
   * the whole point of the field:
   *
   *  - `null` / `undefined` — **the check was not performed.** No directory
   *    flag is raised, because "we did not look" is not evidence about the
   *    suburb. A note records that the cross-check is absent.
   *  - `[]` — **the check was performed and found nothing.** That IS evidence,
   *    and it raises `suburb_not_in_directory`.
   *  - a populated array — checked, matched; the postcode and state comparisons
   *    below can run.
   *
   * They used to be two: an empty array meant both, and every caller passed
   * `[]` without performing a lookup. So every resolution this module has ever
   * produced carried `suburb_not_in_directory` and read
   * `resolved_with_warning` — a warning about a check nobody ran, on a
   * geography that was perfectly good. It also meant the two disagreements
   * this validation exists to catch (`suburb_postcode_mismatch`,
   * `state_mismatch`) could never be raised at all, because the code reached
   * them only through the populated branch.
   */
  directoryMatches: ReadonlyArray<DirectoryEntry> | null | undefined;
}

/**
 * Turn a boundary lookup into a canonical record, with every disagreement
 * surfaced rather than smoothed.
 *
 * The order of the checks is the order of severity: a coordinate that is not a
 * coordinate cannot be outside Australia, and a point in no polygon cannot
 * disagree with a directory.
 */
export function resolveGeography(input: ResolveInput): ResolvedGeography {
  const { coordinate: raw, lookup, hierarchy, directoryMatches } = input;

  if (!raw || (raw.latitude === undefined && raw.longitude === undefined)) {
    return unresolved(null, 'missing_coordinate',
      'No coordinate is stored for this report, so no geography can be derived.');
  }
  if (!isValidCoordinate(raw)) {
    return unresolved(null, 'invalid_coordinate',
      `The stored coordinate (${raw.latitude}, ${raw.longitude}) is not a usable position.`);
  }
  const coordinate = raw;

  if (!isPlausiblyAustralian(coordinate)) {
    return unresolved(coordinate, 'outside_australia',
      `The coordinate (${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)}) `
      + 'falls outside Australia and its external territories, so no Australian geography applies. '
      + 'The report needs its coordinate corrected before it can carry market evidence.');
  }

  // The geocoder's own "no match", which is inside the box, on land, and
  // contradicts no state. `components=country:AU` answers the CENTRE OF THE
  // CONTINENT rather than failing, so `London` and `Pittsburgh` became a tidy
  // cluster in the desert — and a boundary query would place that cluster in a
  // real remote locality with a real postcode, which is how a wrong coordinate
  // becomes confident area statistics about somebody else's postal area.
  //
  // `isAustraliaCentroid` is the check the listing map already uses, imported
  // rather than re-implemented: two spellings of one sentinel is how one of
  // them goes stale.
  if (isAustraliaCentroid(coordinate.latitude, coordinate.longitude)) {
    return unresolved(coordinate, 'geocoder_country_fallback',
      `The coordinate (${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)}) `
      + 'is the geocoder\'s centre-of-Australia fallback, which is what it returns when an '
      + 'address matches nothing in the country. It locates no property, so it is left '
      + 'unplaced rather than resolved to whichever remote locality contains it.');
  }

  if (!lookup || lookup.serviceFailed) {
    return unresolved(coordinate, 'boundary_service_unavailable',
      'The ABS boundary service could not be reached, so this coordinate is unresolved rather '
      + 'than guessed. It is safe to retry.');
  }

  if (!lookup.sal) {
    return unresolved(coordinate, 'outside_all_polygons',
      'The coordinate is inside the Australian bounding box but falls in no ASGS locality — '
      + 'commonly a point at sea or on an unnamed area. It is left unplaced.');
  }

  const flags: GeographyFlag[] = [];
  const notes: string[] = [];

  const suburb = lookup.sal.name;
  const postcode = lookup.poa?.name ?? null;
  const state = toStateAbbreviation(hierarchy?.stateName);

  // Near a locality boundary: a metre of coordinate error changes the suburb.
  if (lookup.salNeighbours.length > 1) {
    flags.push('near_locality_boundary');
    const others = lookup.salNeighbours
      .filter((a) => a.code !== lookup.sal!.code)
      .map((a) => a.name);
    notes.push(
      `The coordinate sits close to a locality boundary; ${others.join(' and ')} `
      + `${others.length === 1 ? 'is' : 'are'} within ~150 m. The suburb is ${suburb} on the `
      + 'exact point, but a small coordinate error would change it.',
    );
  }

  // Validate against the directory. It confirms or questions; it never decides.
  // Callers match on `normalisePlaceName(suburb)` so an ABS qualifier is not
  // mistaken for a missing suburb.
  //
  // Nothing below may run on a check that did not happen. A resolution with no
  // directory reading is a clean `resolved` carrying a note, never a warning:
  // the flags here are assertions ABOUT the suburb, and we have none to make.
  if (directoryMatches === null || directoryMatches === undefined) {
    notes.push(
      'The suburb directory cross-check was not performed for this resolution, so no '
      + 'directory agreement or disagreement is recorded. The ASGS boundary is the '
      + 'authority either way.',
    );
  } else if (directoryMatches.length === 0) {
    flags.push('suburb_not_in_directory');
    notes.push(
      `"${suburb}" is not in the suburb directory. The ASGS boundary is still the authority — `
      + 'the directory is a cross-check and does not carry every locality.',
    );
  } else {
    if (postcode && !directoryMatches.some((d) => d.postcode === postcode)) {
      flags.push('suburb_postcode_mismatch');
      const known = [...new Set(directoryMatches.map((d) => d.postcode))].join(', ');
      notes.push(
        `The postal area at this point is ${postcode}, but the directory lists `
        + `${suburb} under ${known}. Suburbs can span postcodes, so this is flagged rather `
        + 'than treated as an error.',
      );
    }
    if (state && !directoryMatches.some((d) => d.state === state)) {
      flags.push('state_mismatch');
      const known = [...new Set(directoryMatches.map((d) => d.state))].join(', ');
      notes.push(
        `The boundary places this point in ${state}, while the directory lists ${suburb} `
        + `in ${known}. A cross-state disagreement needs a human before this report is scored.`,
      );
    }
  }

  // A state disagreement is the one that can silently attach evidence to the
  // wrong market, so it alone forces review.
  const status: GeographyStatus = flags.includes('state_mismatch')
    ? 'requires_review'
    : flags.length > 0
      ? 'resolved_with_warning'
      : 'resolved';

  return {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    suburb,
    localityCode: lookup.sal.code,
    postcode,
    state,
    sa2Code: hierarchy?.sa2Code ?? lookup.sa2?.code ?? null,
    sa2Name: hierarchy?.sa2Name ?? lookup.sa2?.name ?? null,
    sa3Name: hierarchy?.sa3Name ?? null,
    sa4Name: hierarchy?.sa4Name ?? null,
    gccsaName: hierarchy?.gccsaName ?? null,
    remotenessArea: lookup.ra?.name ?? null,
    urbanCentre: lookup.ucl?.name ?? null,
    significantUrbanArea: lookup.sua?.name ?? null,
    status,
    flags,
    notes,
    method: 'asgs_point_in_polygon',
    boundarySource: BOUNDARY_SOURCE,
    sourceVersion: ASGS_RELEASE,
  };
}

/** Can suburb-grain market evidence be attached to this record? */
export function isGeographyReady(g: ResolvedGeography): boolean {
  return (g.status === 'resolved' || g.status === 'resolved_with_warning')
    && g.suburb !== null && g.state !== null;
}

export interface GeographyRollup {
  total: number;
  byStatus: Readonly<Record<GeographyStatus, number>>;
  byFlag: Readonly<Record<string, number>>;
  byState: Readonly<Record<string, number>>;
  byRemoteness: Readonly<Record<string, number>>;
  geographyReady: number;
}

/** Aggregate resolutions into the counts the validation report needs. */
export function rollUpGeography(rows: ReadonlyArray<ResolvedGeography>): GeographyRollup {
  const byStatus: Record<string, number> = {
    resolved: 0, resolved_with_warning: 0, requires_review: 0, unresolved: 0,
  };
  const byFlag: Record<string, number> = {};
  const byState: Record<string, number> = {};
  const byRemoteness: Record<string, number> = {};
  let geographyReady = 0;

  for (const r of rows) {
    byStatus[r.status] += 1;
    for (const f of r.flags) byFlag[f] = (byFlag[f] ?? 0) + 1;
    const s = r.state ?? '(unresolved)';
    byState[s] = (byState[s] ?? 0) + 1;
    const ra = r.remotenessArea ?? '(unresolved)';
    byRemoteness[ra] = (byRemoteness[ra] ?? 0) + 1;
    if (isGeographyReady(r)) geographyReady += 1;
  }

  return {
    total: rows.length,
    byStatus: byStatus as GeographyRollup['byStatus'],
    byFlag, byState, byRemoteness, geographyReady,
  };
}
