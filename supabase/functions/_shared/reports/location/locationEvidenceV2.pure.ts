/**
 * ME-5 item 7 — Location evidence built only from sources that answer.
 *
 * The historical Location object is quarantined (see
 * `locationEvidenceProvenance.pure.ts`): its transport block is a per-state
 * template, its walk score inherits that template, 494 of its commutes point
 * at the wrong city and 438 were never routes at all. This is what replaces
 * it, and the design constraint is the one the whole programme runs on —
 * **every point must come from a real observation or a deterministic
 * calculation.**
 *
 * ## What this is allowed to read
 *
 * | component | source | held today |
 * | --- | --- | --- |
 * | transit stops | loaded GTFS feeds, by coordinate | NSW, QLD SEQ, NT ×2 |
 * | activity centre | ABS ASGS 2021 (GCCSA / SUA / UCL) | all placed reports |
 * | access to that centre | not yet acquired | no |
 * | schools, shops, health | not yet acquired | no |
 *
 * Three of the four are absent, and this module says so rather than filling
 * them. The old walk score's other 70 points came from Places counts capped at
 * ten, and reproducing them would reproduce the saturation that gave 641
 * reports four distinct scores between them.
 *
 * ## Three rules
 *
 * **There is no composite score here.** A single number invites a weighting,
 * and a weighting over one measured component and three absent ones is a
 * confident answer to a question the evidence cannot settle. `LocationEvidenceV2`
 * publishes components and coverage; whether that is enough to score is the
 * caller's decision, made against `componentsMeasured`.
 *
 * **Transit is measured or it is unmeasured — never poor.** A property outside
 * every loaded feed has no reading, and 587 of 931 placed historical reports
 * are in that position. Scoring them as badly served would grade them on which
 * state government publishes an open feed.
 *
 * **A jurisdiction's own feed, or nothing.** `readingIsInJurisdiction` is
 * applied here and not left to a caller: an interstate coach stop is a real
 * stop that says nothing about local service, and 11 historical reports would
 * have been given a Victorian or ACT "reading" composed entirely of NSW
 * network stops.
 */

import {
  readingIsInJurisdiction,
  type TransportReading,
} from '../../transportReading.pure.ts';
import {
  resolveActivityCentre,
  type ActivityCentre,
  type GeographyForCentre,
} from './activityCentre.pure.ts';

/** How a component stands. Never a score, and never a zero standing in for one. */
export type ComponentState =
  /** A real value, measured from a source that answered. */
  | 'measured'
  /** The source was reached and reports nothing here. A fact about the area. */
  | 'none_here'
  /** No source covers this location. A fact about the data, not the area. */
  | 'not_covered'
  /** No source for this component is held at all, anywhere. */
  | 'not_acquired';

export interface LocationComponent<T> {
  state: ComponentState;
  value: T | null;
  /** What a report may print about this component. Never blank. */
  statement: string;
}

export interface LocationEvidenceV2 {
  version: 'location-evidence-v2';
  transit: LocationComponent<{
    nearestStopMetres: number | null;
    stopsWithinRadius: number;
    radiusMetres: number;
    feeds: string[];
  }>;
  centre: LocationComponent<ActivityCentre>;
  accessToCentre: LocationComponent<never>;
  amenities: LocationComponent<never>;
  /** How many components carry a real measurement. */
  componentsMeasured: number;
  /** Every component this contract declares, measured or not. */
  componentsTotal: number;
  /** What a reader must know before using any of it. */
  caveats: string[];
}

const NOT_ACQUIRED = <T,>(what: string, instead: string): LocationComponent<T> => ({
  state: 'not_acquired',
  value: null,
  statement: `${what} is not measured: this deployment holds no source for it. ${instead}`,
});

export interface LocationEvidenceInputs {
  /** From `public-transport-service`, or null where it refused. */
  transport: TransportReading | null;
  geography: GeographyForCentre;
}

/** Build the Location evidence a report may actually stand on. */
export function buildLocationEvidenceV2(
  inputs: LocationEvidenceInputs,
): LocationEvidenceV2 {
  const caveats: string[] = [];

  // --- transit ----------------------------------------------------------
  let transit: LocationEvidenceV2['transit'];
  const reading = inputs.transport;
  if (!reading || reading.verdict === 'outside_loaded_networks') {
    transit = {
      state: 'not_covered', value: null,
      statement: 'No public transport feed loaded by this deployment covers this location, so '
        + 'no stop distance is measured for it. This is a limit of the data held, not a '
        + 'finding about the area.',
    };
  } else if (!readingIsInJurisdiction(reading.feeds, inputs.geography.state)) {
    transit = {
      state: 'not_covered', value: null,
      statement: 'The only stops near this property come from another jurisdiction’s feed — an '
        + 'interstate rail or coach network — so they measure long-distance interchange rather '
        + 'than the local service. This location’s own network is not loaded.',
    };
    caveats.push('An interstate feed reached this coordinate and was deliberately not used.');
  } else if (reading.verdict === 'none_within_radius') {
    transit = {
      state: 'none_here', value: null,
      statement: `A loaded network covers this area and no boardable stop falls within `
        + `${reading.radiusMetres} m of the property.`,
    };
  } else {
    transit = {
      state: 'measured',
      value: {
        nearestStopMetres: reading.nearest?.metres ?? null,
        stopsWithinRadius: reading.countWithinRadius,
        radiusMetres: reading.radiusMetres,
        feeds: [...reading.feeds],
      },
      statement: `${reading.countWithinRadius} boardable stop(s) within ${reading.radiusMetres} m, `
        + `the nearest ${reading.nearest?.metres ?? '—'} m away.`,
    };
    if (reading.notMeasured.length) {
      caveats.push(`The stops feed does not carry ${reading.notMeasured.join(' or ')}.`);
    }
  }

  // --- the activity centre ---------------------------------------------
  const centreValue = resolveActivityCentre(inputs.geography);
  const centre: LocationEvidenceV2['centre'] = centreValue.tier === 'none'
    ? { state: 'none_here', value: centreValue, statement: centreValue.reason }
    : { state: 'measured', value: centreValue, statement: centreValue.reason };

  // --- what is not held at all -----------------------------------------
  const accessToCentre = NOT_ACQUIRED<never>(
    'Travel time to the activity centre',
    centreValue.tier === 'capital_labour_market'
      ? 'A routing source would measure it to the CBD named above.'
      : 'No centre coordinate is held for this tier, so a route cannot be requested even if a '
        + 'routing source were available.',
  );
  const amenities = NOT_ACQUIRED<never>(
    'Schools, shopping and health access',
    'The historical figures came from a places search capped at ten results and are quarantined; '
      + 'nothing has replaced them.',
  );

  const components = [transit, centre, accessToCentre, amenities];
  return {
    version: 'location-evidence-v2',
    transit, centre, accessToCentre, amenities,
    componentsMeasured: components.filter((c) => c.state === 'measured').length,
    componentsTotal: components.length,
    caveats,
  };
}

/**
 * May two properties' Location evidence be compared?
 *
 * Only where both carry the same measured components AND their centres are of
 * the same tier. Minutes to the Perth CBD and minutes to a country town's main
 * street are different quantities; so is a transit count in a covered network
 * against one in an uncovered state.
 */
export function evidenceIsComparable(a: LocationEvidenceV2, b: LocationEvidenceV2): boolean {
  if (a.transit.state !== b.transit.state) return false;
  if (a.centre.state !== 'measured' || b.centre.state !== 'measured') return false;
  return a.centre.value?.tier === b.centre.value?.tier;
}
