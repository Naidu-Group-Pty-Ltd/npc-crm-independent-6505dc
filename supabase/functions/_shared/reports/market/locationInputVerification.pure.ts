/**
 * Which of Location's inputs this run may declare VERIFIED — read off the
 * enrichment's own acquisition stamp, never off a request field.
 *
 * ## The event this records
 *
 * The input policy classed `walkScore`, `commuteTimeCBD` and `schoolsNearby`
 * as `requires_repair` on the measured findings of
 * `SCORING_INPUT_INTEGRITY_CLOSEOUT.md`: a per-state walk-score template, a
 * fabricated commute (mean 10,125 minutes, non-NSW reports routed to Sydney)
 * and a school count at its ceiling on 851 of 1,114. The policy's own header
 * said the verification field would be wired only by "the repair of the
 * location service, with a decision behind it".
 *
 * Both have happened. The repair: every geocode goes through the
 * granularity-gated chain (`GEOCODING_WITHOUT_GOOGLE.md` — a state centroid is
 * refused, whoever answered), amenities are measured at the verified
 * coordinate from the local OSM amenity register or Places
 * (`amenitySources`), the commute is a real route from that coordinate (OSRM
 * or the Distance Matrix), and RF-7.2B stamps every acquisition with the
 * subject it describes and whether each stage actually ran. The decision: the
 * platform owner's instruction of 16 September 2026 that the score stop
 * reporting partial where the evidence is measured.
 *
 * ## The rule
 *
 * An input is verified for THIS run exactly when the enrichment can prove it:
 *
 *   1. the enrichment carries the RF-7.2B acquisition stamp, and its
 *      `subjectKey` equals the key of the subject the caller is scoring —
 *      same address, postcode and state, under the same normalisation the
 *      reuse guard and `canonical_property_key` use. A stampless object
 *      (every enrichment persisted before RF-7.2B) verifies NOTHING and
 *      scores exactly as before; the next generation re-acquires with a
 *      stamp, so the remedy is regeneration, never migration.
 *   2. the stage that produced the reading actually ran: `places` must be
 *      `complete` for the walk score and the school count (a partial
 *      acquisition stores zeros a provider outage wrote, which is the
 *      confident-empty reading this platform refuses everywhere), and
 *      `commute` must be `measured` for the commute.
 *   3. the reading itself is a finite number on the object the stamp is
 *      attached to — the stamp vouches for the acquisition, not for a field
 *      somebody deleted.
 *   4. the point the readings were measured FROM was the property or its
 *      street (`enrichmentPoint.pure.ts`). On 24 Sep 2026 two reports were
 *      measured from the centre of their suburbs while the public geocoder
 *      refused us, and the walk score, the commute and the school count of
 *      that centre were counted as the property's own. An area's centre
 *      describes the area; a stamp that records no precision proves nothing
 *      about which it was. Either verifies nothing, and says which it was.
 *
 * Derived HERE, in the scoring service, rather than accepted from the caller:
 * `verifiedInputs` on a request body would let any caller assert trust, and
 * the evidence properly travels with the object that carries the readings.
 *
 * Pure and Deno-parseable; no clock, no IO.
 */

import {
  ENRICHMENT_STAMP,
  subjectKeyFor,
  type EnrichmentAcquisition,
  type EnrichmentSubject,
} from '../location/locationEnrichmentReuse.pure.ts';
import { enrichmentPointOf, pointIsAnAreaCentre } from '../location/enrichmentPoint.pure.ts';

export type VerifiableLocationInput = 'walkScore' | 'commuteTimeCBD' | 'schoolsNearby';

/**
 * Why NOTHING was verified because of the point itself, where that was the
 * cause — so the grade's gap can say it in the reader's terms rather than
 * blaming the acquisition stamp.
 */
export type LocationPointRefusal = 'measured_at_area_centre' | 'point_precision_unrecorded';

export interface LocationInputVerification {
  /** The inputs this run may count, in the input policy's vocabulary. */
  verified: VerifiableLocationInput[];
  /** Why the rest did not qualify — for the function log, never the client. */
  notes: string[];
  /** Set where rule 4 refused every reading. */
  pointRefusal?: LocationPointRefusal;
}

const NONE = (note: string): LocationInputVerification => ({ verified: [], notes: [note] });

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Rule on the three Location inputs for one scoring run.
 *
 * `enrichment` is the location-intelligence object the caller presented;
 * `subject` is the property the caller is scoring, restated by the caller so
 * the stamp can be checked against it. Total: every malformed shape answers
 * "nothing verified" with a note, never a throw.
 */
export function verifiedLocationInputs(
  enrichment: unknown,
  subject: EnrichmentSubject,
): LocationInputVerification {
  if (!enrichment || typeof enrichment !== 'object' || Array.isArray(enrichment)) {
    return NONE('no location enrichment was presented');
  }
  const record = enrichment as Record<string, unknown>;
  const stamp = record[ENRICHMENT_STAMP] as EnrichmentAcquisition | undefined;
  if (!stamp || typeof stamp !== 'object' || typeof stamp.subjectKey !== 'string') {
    return NONE(
      'the enrichment carries no acquisition stamp (persisted before RF-7.2B) — '
      + 'regenerating the report re-acquires it with one',
    );
  }
  const address = typeof subject.address === 'string' ? subject.address.trim() : '';
  if (!address) {
    return NONE('the caller named no location subject to check the stamp against');
  }
  if (stamp.subjectKey !== subjectKeyFor(subject)) {
    return NONE('the acquisition stamp names a different address, postcode or state');
  }

  const stages = stamp.stages ?? ({} as EnrichmentAcquisition['stages']);

  // Rule 4 — the point, before any reading taken from it.
  const point = enrichmentPointOf(record);
  if (pointIsAnAreaCentre(point.precision)) {
    return {
      verified: [],
      notes: [
        `the readings were measured from the centre of the ${point.precision === 'postcode' ? 'postal area' : 'suburb'}`
        + ` (${point.provider ?? 'provider unrecorded'}), not the property — they describe the area`,
      ],
      pointRefusal: 'measured_at_area_centre',
    };
  }
  if (!point.recorded) {
    return {
      verified: [],
      notes: ['the acquisition stamp records no geocode precision, so it cannot show the readings were measured from the property'],
      pointRefusal: 'point_precision_unrecorded',
    };
  }

  const verified: VerifiableLocationInput[] = [];
  const notes: string[] = [];

  const placesComplete = stages.places === 'complete';
  if (!placesComplete) {
    notes.push('places acquisition was partial — the walk score and school count may understate the area');
  }
  if (finite(record.walkScore) && placesComplete) verified.push('walkScore');

  const commute = record.commute as { durationMinutes?: unknown } | null | undefined;
  if (finite(commute?.durationMinutes) && stages.commute === 'measured') {
    verified.push('commuteTimeCBD');
  } else if (stages.commute && stages.commute !== 'measured') {
    notes.push(`commute was not measured (${stages.commute})`);
  }

  const schools = record.schools as { schoolsWithin3km?: unknown } | null | undefined;
  if (finite(schools?.schoolsWithin3km) && placesComplete) verified.push('schoolsNearby');

  return { verified, notes };
}
