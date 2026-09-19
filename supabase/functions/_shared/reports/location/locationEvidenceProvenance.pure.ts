/**
 * ME-5 item 6 — provenance for the stored Location intelligence.
 *
 * The audit's Section 24 named ONE contaminated field, `distanceToStop`. This
 * module is what a full sweep of `investment_reports.location_intelligence`
 * found instead: the contamination runs through the whole object, in five
 * distinct kinds that must not be collapsed into one another.
 *
 * Nothing here re-measures a location. It classifies what is already stored so
 * that a backtest, a score and a reader can each tell a measurement from a
 * template, and so that the honest answer — "this was never evidence" — is
 * available without deleting the record.
 *
 * ## What was measured (1,114 stored objects, 8 September 2026)
 *
 * **The transport block is a per-state constant.** 1,108 of 1,114 carry the
 * legacy shape, and across all of them `stopsWithin1km` takes exactly ONE
 * value (3) while `nearestStop`, `distanceToStop`, `qualityScore`,
 * `serviceFrequency`, `routeCoverage` and `summary` take exactly FIVE — one
 * per state that had a template, plus a default. **822 reports say the nearest
 * stop is Sydney's "Central Station", 450 m away, and those 822 span all eight
 * states and territories.**
 *
 * **The walk score inherits it.** `calculateWalkScore` spends its whole
 * 30-point transit allowance on `publicTransportData.qualityScore`, so the
 * templated constant is up to 30 of 100 points. The other four components
 * saturate at counts of 3–5 against a hard `.slice(0, 10)`, and **641 reports
 * have all four maxed** — for those the walk score is the state constant and
 * nothing else, carrying **4 distinct values across 641 properties**. A
 * reconstruction of the formula from the stored counts reproduces the stored
 * score exactly on 1,109 of 1,114.
 *
 * **The commute is a real call to the wrong city.** `getCBDCoordinates` ends
 * `|| cbdLocations['NSW']`, so a missing state sends the Distance Matrix query
 * to Sydney. Of 519 non-NSW reports carrying the Sydney transport template,
 * **494 have a commute consistent with a journey to Sydney and NOT with one to
 * their own capital; zero point at their own capital.** Every other template
 * label points at its own capital and never at Sydney — one missing input,
 * two symptoms.
 *
 * That matters because the Location score bands the commute in MINUTES: all
 * 494 land in "Limited CBD access (>60 min)" for 3 points of 30. **74 of them
 * are within 10 km of their own CBD** — the closest is 0.4 km from its state
 * capital's centre. A 27-point inversion on a dimension weighted at 25%.
 *
 * **And 438 of the 1,114 commutes were never a route at all.** When the
 * Distance Matrix call fails, `calculateCommuteTime` falls through to a
 * straight-line distance times 1.5 minutes per kilometre and stores it as
 * `mode: 'estimated'` — a figure with the shape of a journey and no journey
 * behind it, averaging 10,125 minutes. `mode` is therefore load-bearing: it is
 * how a stored commute says whether anything was measured, and a reader that
 * ignores it cannot tell the two apart.
 *
 * **Every "within N km" count is `min(actual, 10)`.** `fetchNearbyPlaces`
 * slices the first Places page to ten and returns `results.length`, so
 * `schoolsWithin3km` and `facilitiesWithin5km` are counts of the API's page,
 * not of the radius they name. At the ceiling: restaurants 990/1,114 (88.9%),
 * schools 851 (76.4%), parks 818 (73.4%), healthcare 686 (61.6%), shopping
 * 596 (53.5%).
 *
 * **A failed read is stored as an empty area.** The fetch helper's `catch`
 * returns `{ count: 0, results: [] }`, which becomes `nearest*: 'N/A'` and
 * `distanceTo*: 0`. A zero distance reads as "at the door" and is the modal
 * value for both school and hospital distance.
 *
 * **183 objects measure a foreign location.** Those are the reports whose
 * coordinate falls outside Australia (ME-5 item 2). Their amenities are real
 * Google results for a real place — in New York, Virginia, Lisbon — and US
 * school vocabulary appears in 31 of the 183 and in **0 of the 931** reports
 * whose coordinate resolves to an ASGS boundary.
 *
 * ## Three rules
 *
 * **A template is not a measurement, and a measurement of the wrong thing is
 * not a template.** They need different remedies: the first can only be
 * discarded, the second can be recomputed from the coordinate that is already
 * stored. Collapsing them would throw away 494 recoverable commutes.
 *
 * **A ceiling is disclosed, never silently trusted.** A count that saturates
 * is a lower bound; it may still rank sparse locations, and refusing it
 * outright would discard the one signal that distinguishes a remote property
 * from an urban one.
 *
 * **`legacy_non_evidence` is a status, not a deletion.** The stored object is
 * kept whole. Nothing here rewrites an issued report.
 */

/** What a stored Location field actually is. */
export type LocationProvenance =
  /** Synthetic or templated. Carries no information about this property. */
  | 'legacy_non_evidence'
  /** A genuine measurement of the wrong question. Recomputable. */
  | 'measured_misdirected'
  /** A genuine measurement, bounded by an API page size rather than a radius. */
  | 'measured_capped'
  /** A genuine nearest-place, whose CLASS was never verified. */
  | 'measured_unverified_class'
  /** A failed read stored as an empty area. Absent, not zero. */
  | 'read_failed'
  /** A genuine measurement of a location outside Australia. */
  | 'offshore'
  /** A genuine measurement, usable as evidence. */
  | 'measured';

/** Provenance values that must never contribute to a score. */
export const NON_EVIDENCE_PROVENANCE: ReadonlySet<LocationProvenance> = new Set([
  'legacy_non_evidence',
  'measured_misdirected',
  'read_failed',
  'offshore',
]);

export interface FieldProvenance {
  field: string;
  provenance: LocationProvenance;
  /** Why, in one sentence a reader can act on. */
  reason: string;
  /** Whether the fault can be repaired from data already stored. */
  recoverable: boolean;
}

export interface LocationProvenanceReport {
  fields: FieldProvenance[];
  /** True when nothing in the object may be used as Location evidence. */
  wholeObjectIsNonEvidence: boolean;
  /** The walk score's standing, called out because it is the scored figure. */
  walkScore: FieldProvenance;
  summary: string;
}

/** The five per-state transport templates, by their `nearestStop` label. */
export const TEMPLATED_STOP_LABELS: ReadonlyArray<string> = [
  'Central Station',
  'Swanston Street Tram',
  'Queen Street Bus Station',
  'Wellington Street Bus Station',
  'Currie Street Bus Stop',
];

/** The label the template falls back to when no state was supplied. */
export const TRANSPORT_TEMPLATE_DEFAULT_LABEL = 'Central Station';

/** Every legacy transport key. All of them are templated together. */
export const TEMPLATED_TRANSPORT_KEYS: ReadonlyArray<string> = [
  'nearestStop', 'distanceToStop', 'stopsWithin1km', 'transportTypes',
  'routeCoverage', 'serviceFrequency', 'accessibility', 'realTimeAlerts',
  'qualityScore', 'summary', 'detailedStops',
];

/**
 * The `commute.mode` a stored commute carries when no route was ever fetched.
 *
 * Named here because it is the only thing that distinguishes a fabricated
 * commute from a measured one, and a reader that does not check it will treat
 * 438 straight-line estimates as journeys.
 */
export const FABRICATED_COMMUTE_MODE = 'estimated';

/** Counts the API page size bounds. `fetchNearbyPlaces` slices to ten. */
export const PLACES_PAGE_CEILING = 10;

const CAPPED_COUNT_PATHS: ReadonlyArray<string> = [
  'schools.schoolsWithin3km',
  'healthcare.facilitiesWithin5km',
  'lifestyle.restaurants',
  'lifestyle.parks',
  'lifestyle.shoppingCenters',
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function at(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** What the caller already knows about the report's geography. */
export interface GeographyContext {
  /** From `report_geography`. `unresolved` means the coordinate is not in Australia. */
  status: 'resolved' | 'resolved_with_warning' | 'requires_review' | 'unresolved';
  /** The ASGS state the coordinate falls in, where one was resolved. */
  state: string | null;
}

/**
 * Does this object's transport block carry the legacy per-state template?
 *
 * Asked of the SHAPE rather than of a date, because both writers were live at
 * once — the Google branch answered whenever the transport service refused —
 * and a row's creation date therefore does not decide which it got.
 */
export function usesTransportTemplate(locationIntelligence: unknown): boolean {
  const t = at(locationIntelligence, 'transport');
  return isObj(t) && typeof t.distanceToStop !== 'undefined';
}

/**
 * Is the stored commute a journey to Sydney from a property that is not in NSW?
 *
 * The marker is the transport template's default label, which the measurement
 * showed is a perfect predictor: 494 of 519 non-NSW reports carrying it commute
 * to Sydney and none to their own capital, while no other label ever does.
 * Both symptoms come from the one absent `input.state`.
 */
export function commuteIsMisdirected(
  locationIntelligence: unknown,
  geography: GeographyContext,
): boolean {
  if (!geography.state || geography.state === 'NSW') return false;
  const stop = at(locationIntelligence, 'transport.nearestStop');
  return stop === TRANSPORT_TEMPLATE_DEFAULT_LABEL;
}

/**
 * Classify every field of one stored Location object.
 *
 * Order matters: an offshore coordinate makes the whole object a measurement of
 * somewhere else, so it is decided before anything is called capped or genuine.
 */
export function classifyLocationEvidence(
  locationIntelligence: unknown,
  geography: GeographyContext,
): LocationProvenanceReport {
  const fields: FieldProvenance[] = [];
  const offshore = geography.status === 'unresolved';
  const templated = usesTransportTemplate(locationIntelligence);

  const push = (
    field: string,
    provenance: LocationProvenance,
    reason: string,
    recoverable = false,
  ) => { fields.push({ field, provenance, reason, recoverable }); };

  // --- coordinates -------------------------------------------------------
  push(
    'coordinates',
    offshore ? 'offshore' : 'measured',
    offshore
      ? 'The coordinate is outside Australia, so every amenity measured from it '
        + 'describes a foreign location.'
      : 'Resolved to an ASGS boundary by point-in-polygon.',
  );

  // --- transport ---------------------------------------------------------
  for (const key of TEMPLATED_TRANSPORT_KEYS) {
    if (typeof at(locationIntelligence, `transport.${key}`) === 'undefined') continue;
    push(
      `transport.${key}`,
      templated ? 'legacy_non_evidence' : (offshore ? 'offshore' : 'measured'),
      templated
        ? 'One of five per-state constants written without reading the coordinate; '
          + '822 of 1,108 name Sydney’s Central Station across all eight states.'
        : 'Measured from the coordinate.',
    );
  }
  for (const key of ['nearestStation', 'distanceToStation', 'stationsWithin2km']) {
    if (typeof at(locationIntelligence, `transport.${key}`) === 'undefined') continue;
    push(
      `transport.${key}`,
      offshore ? 'offshore' : 'measured_capped',
      'Measured from the coordinate by Places, with the count bounded by the '
      + `${PLACES_PAGE_CEILING}-result page slice.`,
    );
  }

  // --- commute -----------------------------------------------------------
  const commuteKm = num(at(locationIntelligence, 'commute.distanceKm'));
  const commuteMode = at(locationIntelligence, 'commute.mode');
  const misdirected = commuteIsMisdirected(locationIntelligence, geography);
  for (const key of ['distanceKm', 'durationMinutes', 'mode']) {
    if (typeof at(locationIntelligence, `commute.${key}`) === 'undefined') continue;
    if (offshore) {
      push(`commute.${key}`, 'offshore', 'Measured from a coordinate outside Australia.');
    } else if (commuteMode === FABRICATED_COMMUTE_MODE) {
      push(`commute.${key}`, 'legacy_non_evidence',
        'No route was returned, so this is a straight-line distance times 1.5 minutes per '
        + 'kilometre — the shape of a journey with no journey behind it.');
    } else if (commuteKm === 0) {
      push(`commute.${key}`, 'read_failed',
        'The Distance Matrix call did not return a route; zero is the failure value, not a distance.');
    } else if (misdirected) {
      push(`commute.${key}`, 'measured_misdirected',
        'A genuine transit query sent to Sydney because no state was supplied. Recomputable '
        + 'from the stored coordinate against the correct destination.',
        true);
    } else {
      push(`commute.${key}`, 'measured',
        'A transit query to the property’s own state capital. Whether that capital is the '
        + 'right destination for this property is a separate question.');
    }
  }

  // --- counted amenities -------------------------------------------------
  for (const path of CAPPED_COUNT_PATHS) {
    const v = num(at(locationIntelligence, path));
    if (v === null) continue;
    if (offshore) {
      push(path, 'offshore', 'Counted at a coordinate outside Australia.');
    } else if (v === 0) {
      push(path, 'read_failed',
        'Zero is what the fetch helper’s catch block stores, so a failed call and an empty '
        + 'area are indistinguishable here.');
    } else {
      push(path, 'measured_capped',
        `A count of the first Places page, bounded at ${PLACES_PAGE_CEILING}; the field name `
        + 'promises a radius count it does not deliver.');
    }
  }

  // --- nearest places ----------------------------------------------------
  const nearest: Array<[string, string]> = [
    ['schools.nearestSchool', 'schools.distanceToSchool'],
    ['healthcare.nearestHospital', 'healthcare.distanceToHospital'],
  ];
  for (const [nameP, distP] of nearest) {
    const name = at(locationIntelligence, nameP);
    if (typeof name === 'undefined') continue;
    if (offshore) {
      push(nameP, 'offshore', 'The nearest place to a coordinate outside Australia.');
      push(distP, 'offshore', 'Measured to a place outside Australia.');
    } else if (name === 'N/A') {
      push(nameP, 'read_failed', 'No place was returned; the read may have failed.');
      push(distP, 'read_failed',
        'Zero accompanies the “N/A” name and means unknown, not adjacent.');
    } else {
      push(nameP, 'measured_unverified_class',
        'A real nearest place of the Places type queried. That type admits childcare, '
        + 'driving, swim and music schools, so the CLASS was never verified.');
      push(distP, 'measured', 'A real distance to the place named.');
    }
  }

  // --- walk score --------------------------------------------------------
  const walkScore: FieldProvenance = offshore
    ? { field: 'walkScore', provenance: 'offshore', recoverable: false,
        reason: 'Composed from amenities around a coordinate outside Australia.' }
    : templated
      ? { field: 'walkScore', provenance: 'legacy_non_evidence', recoverable: false,
          reason: 'Up to 30 of its 100 points are the per-state transport constant, and its '
            + 'other four components saturate at counts of 3–5 against a ten-result slice — '
            + '641 objects have all four maxed and carry four distinct scores between them.' }
      : { field: 'walkScore', provenance: 'measured_capped', recoverable: false,
          reason: 'Composed from coordinate-measured Places counts, each bounded by the '
            + 'ten-result page slice.' };
  fields.push(walkScore);

  const nonEvidence = fields.filter((f) => NON_EVIDENCE_PROVENANCE.has(f.provenance));
  const wholeObjectIsNonEvidence = offshore
    || fields.every((f) => NON_EVIDENCE_PROVENANCE.has(f.provenance));

  return {
    fields,
    walkScore,
    wholeObjectIsNonEvidence,
    summary: offshore
      ? 'Every field measures a location outside Australia; none of it is evidence about this property.'
      : `${nonEvidence.length} of ${fields.length} stored fields cannot be used as Location `
        + `evidence; ${fields.filter((f) => f.recoverable).length} are recoverable from the stored coordinate.`,
  };
}
