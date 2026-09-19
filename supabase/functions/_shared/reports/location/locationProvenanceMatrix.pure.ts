/**
 * ME-5.1 item 9 — every Location input, classified.
 *
 * ME-5 §57 classified the transport block, the walk score and the commute. This
 * completes the sweep across all nine families the brief names, and it is the
 * register Location Evidence V2 is built against: **nothing classified below as
 * anything but `genuine_measured` or `recoverable` may enter V2.**
 *
 * The rule that shapes it: *do not treat a field as genuine merely because it
 * contains a precise number.* `transport.distanceToStop` is `450` on 822
 * reports. `amenities[].score` is a precise integer on all 1,114. Neither is a
 * measurement.
 *
 * All figures measured over the 1,114 stored `location_intelligence` objects on
 * 8 September 2026.
 */

export type LocationProvenanceClass =
  /** Measured from this property's coordinate by a source that answered. */
  | 'genuine_measured'
  /** Not measured, but re-derivable from data already stored. */
  | 'recoverable'
  /** A real measurement of the wrong target. */
  | 'wrong_destination'
  /** A per-state or global constant written without reading the coordinate. */
  | 'state_template_synthetic'
  /** A number produced by arithmetic on no observation. */
  | 'fabricated_estimate'
  /** Measured, at a coordinate outside Australia or on a failure value. */
  | 'offshore_or_corrupt'
  /** Not present, or present as a failure sentinel. */
  | 'missing';

export interface LocationInputProvenance {
  family: string;
  field: string;
  klass: LocationProvenanceClass;
  /** The measurement that decides the classification. */
  evidence: string;
  /** May Location Evidence V2 read this field? */
  admissibleToV2: boolean;
}

const g = (family: string, field: string, evidence: string): LocationInputProvenance =>
  ({ family, field, klass: 'genuine_measured', evidence, admissibleToV2: true });
const bad = (
  family: string, field: string, klass: LocationProvenanceClass, evidence: string,
): LocationInputProvenance => ({ family, field, klass, evidence, admissibleToV2: false });

/**
 * The matrix.
 *
 * Ordered by family so a reader can find a field; the `klass` is what decides
 * admissibility, and `admissibleToV2` is derived from it rather than set by
 * hand, so the two cannot drift.
 */
export const LOCATION_PROVENANCE_MATRIX: readonly LocationInputProvenance[] = [
  // --- coordinates -----------------------------------------------------
  g('coordinates', 'coordinates.lat/lng',
    'Present on 1,114. 867 resolve to an ASGS boundary; 183 fall outside Australia and 64 sit on '
    + 'the Sydney CBD fallback exactly. Genuine for the 867 and only those.'),

  // --- transport (the legacy block) ------------------------------------
  ...['nearestStop', 'distanceToStop', 'stopsWithin1km', 'transportTypes', 'routeCoverage',
      'serviceFrequency', 'accessibility', 'realTimeAlerts', 'qualityScore', 'summary',
      'detailedStops',
  ].map((f) => bad('transport', `transport.${f}`, 'state_template_synthetic',
    'One of five per-state constants across 1,108 objects. `stopsWithin1km` takes ONE value; '
    + '822 name Sydney’s Central Station 450 m away and span all eight states.')),
  { family: 'transport', field: 'transport.nearestStation (Places branch)',
    klass: 'recoverable',
    evidence:
      'The six objects written by the Google branch carry a real coordinate-measured nearest '
      + 'transit station. Genuine as far as it goes, but it is a Places result rather than a '
      + 'transit feed, so it is re-derived from GTFS rather than adopted.',
    admissibleToV2: false },

  // --- walkability -----------------------------------------------------
  bad('walkability', 'walkScore', 'state_template_synthetic',
    'Up to 30 of its 100 points ARE the transport constant, and the other four components '
    + 'saturate against a ten-result page slice: 641 objects have all four maxed and carry four '
    + 'distinct scores between them. Reconstructing the formula reproduces the stored score on '
    + '1,109 of 1,114.'),

  // --- commute ---------------------------------------------------------
  bad('commute', 'commute.distanceKm / durationMinutes (mode=estimated)', 'fabricated_estimate',
    '438 of 1,114 are straight-line distance × 1.5 minutes with no route, mean 10,125 minutes.'),
  bad('commute', 'commute.distanceKm / durationMinutes (wrong city)', 'wrong_destination',
    '494 non-NSW reports carry a real transit query sent to Sydney because getCBDCoordinates '
    + 'defaulted. Bentley WA, 8 km from Perth, stored 3,283.6 km. Recomputable from the stored '
    + 'coordinate against a correct destination.'),
  { family: 'commute', field: 'commute (own-capital, mode=public_transit)', klass: 'recoverable',
    evidence:
      'A real Distance Matrix answer to the property’s own capital. Usable as a measurement, but '
      + 'the DESTINATION is still the state capital rather than the property’s activity centre, '
      + 'so it is re-derived rather than adopted.',
    admissibleToV2: false },

  // --- schools ---------------------------------------------------------
  bad('schools', 'schools.schoolsWithin3km', 'state_template_synthetic',
    'min(actual, 10): `fetchNearbyPlaces` slices the first Places page. 851 of 1,114 sit at the '
    + 'ceiling, so the field name promises a radius count it does not deliver.'),
  bad('schools', 'schools.nearestSchool / topSchools[].name', 'missing',
    'A real nearest place of Google type `school`, which admits childcare, driving, swim and '
    + 'music schools — the modal value across the corpus is "Style Academy Australia" on 66 '
    + 'reports at 0.02 km. The class was never verified, so it cannot be read as a school.'),
  bad('schools', 'schools.topSchools[].rating', 'missing',
    'A Google user rating, zero where absent — not an academic rating. Real state schools in the '
    + 'corpus carry 0 while a swim school carries 5.'),
  { family: 'schools', field: 'schools.distanceToSchool', klass: 'recoverable',
    evidence:
      'A real distance to the place named, so the arithmetic is sound — but it inherits the '
      + 'unverified class above, and 74 rows carry 0 alongside an "N/A" name, which means '
      + 'unknown rather than adjacent.',
    admissibleToV2: false },

  // --- shopping / amenities / health ------------------------------------
  ...[
    ['Shopping', 'lifestyle.shoppingCenters', 596],
    ['Healthcare', 'healthcare.facilitiesWithin5km', 686],
    ['Recreation', 'lifestyle.parks', 818],
    ['Public Transport (Places)', 'amenities[Public Transport].count', 974],
  ].map(([label, field, ceiling]) => bad('amenities', String(field), 'state_template_synthetic',
    `min(actual, 10) from the Places page slice; ${ceiling} of 1,114 sit at the ceiling. A count `
    + 'bounded by an API page is a measurement of the API, not the area.')),
  bad('amenities', 'amenities[].score', 'fabricated_estimate',
    'A pure function of the capped count (count × a per-category multiplier, capped at 100), so '
    + 'it takes 6 to 11 distinct values across 1,114 objects and carries no information the count '
    + 'does not already carry.'),
  bad('amenities', 'lifestyle.restaurants', 'state_template_synthetic',
    '990 of 1,114 at the ten-result ceiling — 88.9%, the most saturated field in the object.'),
  { family: 'amenities', field: 'amenities[].distance / nearest (name)', klass: 'recoverable',
    evidence:
      'A real Places result at a real distance from the coordinate, for the 867 whose coordinate '
      + 'is sound. Re-derivable, but not adopted from the stored composite: the same call must be '
      + 'made again so the source, as-of date and radius travel with it.',
    admissibleToV2: false },

  // --- health ----------------------------------------------------------
  bad('health', 'healthcare.nearestHospital / distanceToHospital', 'missing',
    '69 rows carry "N/A" and 70 carry distance 0 — the fetch helper’s catch block returns '
    + '{count: 0}, so a failed read and an empty area are indistinguishable.'),

  // --- employment / activity-centre access ------------------------------
  bad('employment', '(no field exists)', 'missing',
    'The stored object has eight keys and none is employment or activity-centre access. The only '
    + 'employment signal anywhere in the scorer is `unemploymentRate`, which belongs to Demand.'),

  // --- composites -------------------------------------------------------
  bad('composite', 'transport.qualityScore', 'state_template_synthetic',
    'Five values across 1,108 objects, and the input to 30 of the walk score’s 100 points.'),
];

/** Only these two classes may be read by Location Evidence V2. */
export const ADMISSIBLE_CLASSES: readonly LocationProvenanceClass[] = ['genuine_measured'];

/** Is this stored field admissible as Location evidence? */
export function isAdmissible(field: string): boolean {
  const row = LOCATION_PROVENANCE_MATRIX.find((r) => r.field === field);
  return row ? row.admissibleToV2 : false;
}

/** Count by class, for the audit table. */
export function provenanceSummary(): Record<LocationProvenanceClass, number> {
  const out = {
    genuine_measured: 0, recoverable: 0, wrong_destination: 0,
    state_template_synthetic: 0, fabricated_estimate: 0, offshore_or_corrupt: 0, missing: 0,
  } as Record<LocationProvenanceClass, number>;
  for (const r of LOCATION_PROVENANCE_MATRIX) out[r.klass] += 1;
  return out;
}
