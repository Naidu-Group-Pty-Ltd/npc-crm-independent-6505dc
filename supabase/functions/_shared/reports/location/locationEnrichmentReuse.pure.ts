/**
 * RF-7.2B.1B1 — a deterministic location enrichment is bought ONCE per report.
 *
 * ## What it costs today
 *
 * An investment report cannot finish inside one Edge Function invocation — 17
 * sections at ~25s against a ~150s ceiling — so it is resumed, repeatedly, by a
 * two-minute cron. Every one of those invocations re-enters the enrichment
 * block and calls `location-intelligence-service` again, because
 * `existingEnhancedFields.locationIntelligence` is consulted only when DECIDING
 * WHAT TO WRITE:
 *
 *     if (!existingEnhancedFields.locationIntelligence && enhancedData?.locationIntelligence)
 *
 * It guards the write. Nothing guards the fetch.
 *
 * One enrichment is **eight** Google calls, counted from the source and
 * confirmed by the production ledger's exact 6:1 ratio of Places to Distance
 * Matrix over 2026-09-05..08 (612 and 102):
 *
 *   1 × Geocoding          (skipped when a coordinate is supplied)
 *   6 × Places Nearby      transit_station, school, hospital, shopping_mall,
 *                          park, restaurant
 *   1 × Distance Matrix    the CBD commute
 *
 * The health-check report on 2026-09-12 resumed eleven times. Eleven geocodes
 * were purchased for one address. Had the geocode succeeded, the same eleven
 * resumes would have bought **88 Google calls for one report**, of which 80 are
 * a second, third and eleventh purchase of an answer that cannot change: the
 * property does not move between resumes.
 *
 * ## The rule
 *
 * A successful, complete enrichment acquired for THIS subject is reused on
 * later resumes instead of being bought again.
 *
 * Three things make that safe, and all three are refusals rather than
 * permissions:
 *
 *   **Identity is stamped, not inferred.** The persisted object carried no
 *   subject, no provider status and no timestamp — so nothing in it could say
 *   which property it described. `assessEnrichmentReuse` refuses anything
 *   without the stamp, which means every row written before this change
 *   re-fetches exactly as it does today. No silent reuse of an object whose
 *   provenance we are guessing at.
 *
 *   **Only success is reusable.** A refused geocode is never persisted at all
 *   (`location-intelligence-service` answers `success: false` with no `data`,
 *   and the caller writes nothing), so failure cannot become a cache by
 *   accident. This module refuses again anyway — no coordinates, no reuse —
 *   because the F1 outage is live and a guard that could freeze a failure into
 *   place would turn a provider problem into a permanent one.
 *
 *   **Incomplete is not complete.** `fetchNearbyPlaces` swallows a failed call
 *   into `{ count: 0, results: [] }`, which is indistinguishable from a genuinely
 *   empty rural area once stored. The acquisition stamp records whether each
 *   stage actually ran, so a Places outage cannot be locked in as "this address
 *   has no schools".
 *
 * This changes no figure in any document. An enrichment reused is byte-identical
 * to the enrichment stored, because it IS the enrichment stored.
 */

/** Where the acquisition record lives on the persisted object. */
export const ENRICHMENT_STAMP = '__acquisition' as const;

/** Did each provider stage actually run? */
export interface EnrichmentStages {
  /** `fetched` — geocoded here; `supplied` — the caller passed a coordinate. */
  readonly geocode: 'fetched' | 'supplied';
  /** `complete` — all six Places calls returned; `partial` — at least one failed. */
  readonly places: 'complete' | 'partial';
  /**
   * RF-7.2B.1B2 — WHICH categories did not answer. Additive and advisory: the
   * reuse decision below reads `places` alone and is unchanged by it. It exists
   * because "something was not measured" cannot tell a reader of the record
   * whether the missing thing was the hospitals or the parks.
   */
  readonly placesUnavailable?: readonly string[];
  /** A commute is legitimately absent for a state with no known destination. */
  readonly commute: 'measured' | 'no_route' | 'destination_unknown';
  /**
   * Which provider answered each category — `register` (the local OSM
   * amenity register), `google`, or `unmeasured`. Additive and advisory,
   * exactly like `placesUnavailable`: the reuse decision reads `places`
   * alone. It exists so a stored object can say where its figures came
   * from once two providers can produce them.
   */
  readonly amenitySources?: Readonly<Record<string, string>>;
  /** When the register slices that answered were loaded (category → ISO date). */
  readonly amenityRegisterLoadedAt?: Readonly<Record<string, string>>;
  /** Which provider measured the commute, when one did. */
  readonly commuteProvider?: string;
}

export interface EnrichmentAcquisition {
  /** Which subject this describes. Compared, never displayed. */
  readonly subjectKey: string;
  readonly acquiredAt: string;
  readonly stages: EnrichmentStages;
  /** Google's own `formatted_address`, for verification. Null when supplied. */
  readonly matchedAddress: string | null;
  /** How many times this subject has been acquired. 1 on a first success. */
  readonly attempt?: number;
}

/**
 * How many times a PARTIAL enrichment may be re-acquired before it is accepted
 * as the best this address is going to get.
 *
 * Without this the incompleteness rule is its own amplification: a Places
 * category that fails persistently — a quota, a category Google has no data
 * for — would refuse reuse on every resume and re-buy all eight calls each
 * time, which is the 88-call behaviour this module exists to stop, reached by
 * the guard meant to prevent it.
 *
 * Three acquisitions caps a pathological report at 24 calls rather than 88,
 * and the two extra attempts are worth buying because a transient Places
 * failure is common and a complete set is materially better evidence.
 *
 * Accepting a partial set is NOT calling it complete: `stages.places` still
 * reads `partial` afterwards, so nothing downstream can mistake it for a full
 * acquisition. What is exhausted is the re-buying, not the honesty.
 */
export const MAX_PARTIAL_ACQUISITIONS = 3;

/** The attempt number a fresh acquisition for this subject should carry. */
export function nextAcquisitionAttempt(stored: unknown, subject: EnrichmentSubject): number {
  if (!stored || typeof stored !== 'object') return 1;
  const prior = (stored as Record<string, unknown>)[ENRICHMENT_STAMP] as
    EnrichmentAcquisition | undefined;
  // A different subject starts its own count — attempts are per property, not
  // per row, or moving a report to a new address would inherit its exhaustion.
  if (!prior || typeof prior.subjectKey !== 'string') return 1;
  if (prior.subjectKey !== subjectKeyFor(subject)) return 1;
  const n = typeof prior.attempt === 'number' && Number.isFinite(prior.attempt)
    ? prior.attempt : 0;
  return n + 1;
}

/**
 * Carry the attempt count onto a freshly acquired enrichment.
 *
 * Kept here rather than at the call site so the counter and the rule that reads
 * it cannot drift apart.
 */
export function recordAcquisitionAttempt<T>(fresh: T, attempt: number): T {
  if (!fresh || typeof fresh !== 'object') return fresh;
  const record = fresh as Record<string, unknown>;
  const stamp = record[ENRICHMENT_STAMP] as EnrichmentAcquisition | undefined;
  if (!stamp || typeof stamp !== 'object') return fresh;
  return { ...record, [ENRICHMENT_STAMP]: { ...stamp, attempt } } as T;
}

export interface EnrichmentSubject {
  readonly address?: unknown;
  readonly postcode?: unknown;
  readonly state?: unknown;
}

/**
 * The SAME normalisation the database already uses for
 * `canonical_property_key`:
 *
 *   regexp_replace(lower(trim(raw_address)), '[^a-z0-9]+', ' ', 'g')
 *
 * (`20260724100000_canonical_generated_report_property_identity.sql`.) Reusing
 * it rather than inventing a second rule means a formatting-equivalent resume —
 * a comma dropped, a double space, different casing — is the SAME subject here
 * and the same subject to the rest of the platform. A key that disagreed with
 * the canonical one would refuse reuse on reports the database considers one
 * property, which is safe but pointless, and would drift the day either moved.
 */
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';

/**
 * The identity an enrichment belongs to.
 *
 * Address, postcode and state together, because all three steer the result:
 * the address is what is geocoded, and the postcode and state are part of the
 * query `buildAuGeocodeQuery` composes. A change in any of them can move the
 * coordinate, so a change in any of them must invalidate the reuse.
 */
export function subjectKeyFor(subject: EnrichmentSubject): string {
  return [text(subject.address), text(subject.postcode), text(subject.state)].join('|');
}

/** Attach the acquisition record. Returns a new object; never mutates. */
export function stampAcquisition<T extends Record<string, unknown>>(
  data: T,
  acquisition: EnrichmentAcquisition,
): T & { [ENRICHMENT_STAMP]: EnrichmentAcquisition } {
  return { ...data, [ENRICHMENT_STAMP]: acquisition };
}

/**
 * The readings a stage is expected to leave behind, and the stage that
 * produces each.
 *
 * Named as data so the guard, the verifier and the Client-Safe Gate can be
 * compared by a test rather than by reading three files.
 *
 * Only the PLACES readings are checked, and that is deliberate. The invariant
 * is exact — `measuredWalkScore` returns a number whenever every lookup
 * answered, and `measuredCount` likewise — so `places: 'complete'` beside an
 * absent `walkScore` cannot be a live acquisition. The commute is left out
 * because the gate removes all four paths together, so checking one places
 * reading already catches a gated object, and asserting a shape for the
 * commute would make this guard depend on which provider measured it.
 */
const STAGE_RAN = { places: 'complete' } as const;

const finiteAt = (record: Record<string, unknown>, head: string, tail?: string): boolean => {
  const outer = record[head];
  if (tail === undefined) return typeof outer === 'number' && Number.isFinite(outer);
  if (!outer || typeof outer !== 'object') return false;
  const inner = (outer as Record<string, unknown>)[tail];
  return typeof inner === 'number' && Number.isFinite(inner);
};

const MEASURED_READINGS: ReadonlyArray<{
  readonly path: string;
  readonly stage: keyof typeof STAGE_RAN;
  readonly present: (record: Record<string, unknown>) => boolean;
}> = [
  { path: 'walkScore', stage: 'places', present: (r) => finiteAt(r, 'walkScore') },
  { path: 'schools.schoolsWithin3km', stage: 'places', present: (r) => finiteAt(r, 'schools', 'schoolsWithin3km') },
];

export type ReuseVerdict =
  | 'reusable'
  | 'nothing_stored'
  | 'no_acquisition_stamp'
  | 'subject_changed'
  | 'missing_coordinates'
  | 'incomplete_acquisition'
  | 'partial_retry_exhausted'
  | 'readings_missing'
  | 'commute_destination_unrecorded';

export interface ReuseDecision {
  readonly reuse: boolean;
  readonly verdict: ReuseVerdict;
  readonly note: string;
}

const refuse = (verdict: ReuseVerdict, note: string): ReuseDecision =>
  ({ reuse: false, verdict, note });

const finiteCoords = (stored: Record<string, unknown>): boolean => {
  const c = stored.coordinates as { lat?: unknown; lng?: unknown } | undefined;
  return typeof c?.lat === 'number' && Number.isFinite(c.lat)
    && typeof c?.lng === 'number' && Number.isFinite(c.lng);
};

/**
 * May the stored enrichment stand in for a fresh acquisition?
 *
 * Total, and conservative in every direction — every answer but `reusable`
 * re-fetches, which is exactly today's behaviour. The worst outcome available
 * here is that we pay for a call we already had; the outcome being avoided is
 * serving one property's schools, hospitals and commute as another's, which is
 * the fault `assessAuPoint` exists to catch and which this must not reintroduce
 * through the back door.
 */
export function assessEnrichmentReuse(
  stored: unknown,
  subject: EnrichmentSubject,
): ReuseDecision {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return refuse('nothing_stored', 'No location enrichment is stored for this report.');
  }
  const record = stored as Record<string, unknown>;

  const acquisition = record[ENRICHMENT_STAMP] as EnrichmentAcquisition | undefined;
  if (!acquisition || typeof acquisition !== 'object'
    || typeof acquisition.subjectKey !== 'string') {
    // Every row written before this change lands here and re-fetches, which is
    // the behaviour it already has. An object that cannot name its subject is
    // not evidence about this one.
    return refuse(
      'no_acquisition_stamp',
      'The stored enrichment carries no acquisition record, so it cannot be shown '
      + 'to describe this property. Re-acquiring.',
    );
  }

  if (acquisition.subjectKey !== subjectKeyFor(subject)) {
    return refuse(
      'subject_changed',
      'The stored enrichment was acquired for a different address, postcode or '
      + 'state. Re-acquiring.',
    );
  }

  if (!finiteCoords(record)) {
    return refuse(
      'missing_coordinates',
      'The stored enrichment carries no usable coordinate, so nothing downstream '
      + 'can be built from it. Re-acquiring.',
    );
  }

  // S2 — a stamp vouches for the ACQUISITION, not for a field somebody
  // deleted afterwards.
  //
  // Until this was fixed the generator persisted the Client-Safe Gate's
  // output, which removes `walkScore`, `commute` and
  // `schools.schoolsWithin3km` — the only three readings
  // `verifiedLocationInputs` may count. The stamp survived that removal
  // untouched, so this guard saw a complete, subject-matched acquisition and
  // reused an object whose evidence was gone; every resume then scored
  // Location on nothing, and the gap the report printed told the reader to
  // regenerate, which reproduced it.
  //
  // The generator no longer writes the gated copy. This is the other half:
  // an enrichment already persisted in that state is refused, so it is
  // re-acquired on the next generation instead of being carried forward for
  // ever. No migration touches a stored row — the repair happens the next
  // time the report is generated, which is the same remedy the stamp's own
  // absence already uses.
  const readingsMissing = MEASURED_READINGS.filter(
    ({ stage, present }) => acquisition.stages?.[stage] === STAGE_RAN[stage] && !present(record),
  );
  if (readingsMissing.length > 0) {
    return refuse(
      'readings_missing',
      'The stored enrichment records stages that ran but no longer carries what '
      + `they measured (${readingsMissing.map((r) => r.path).join(', ')}). It was `
      + 'persisted after the Client-Safe Gate had removed them, so it cannot be '
      + 'scored. Re-acquiring.',
    );
  }

  // S3 — a measured commute with no destination predates the question
  // "measured to WHERE?", and reusing it scores the answer to a question
  // nobody asked.
  //
  // Until the urban-centre register existed, every commute went to the state
  // capital and nothing recorded that, because there was nothing to choose.
  // `scoreLocation` now reads `commute.destination.ownCentre` and RATES a
  // reading whose destination it cannot establish — which is correct for a
  // live measurement it has no register for, and wrong for a stored one that
  // was measured to a capital this property does not belong to. On 9 Hollow
  // Street that is the whole defect: a 114-minute drive to Melbourne, scored
  // 0 of 100, carried forward for ever because every other gate passes.
  //
  // This is `readings_missing`'s rule one step on. That guard exists because
  // a stamp vouches for the ACQUISITION and not for what survived it; this
  // one because a stamp vouches for what was measured and not for what the
  // measurement MEANT. Both refuse rather than repair, and both take effect
  // on the next generation with no migration and no stored byte rewritten.
  //
  // Bounded to a commute that actually ran: an enrichment with no commute has
  // nothing to re-measure, so it stays reusable exactly as it is today.
  const commuteRecord = record.commute as Record<string, unknown> | undefined;
  const commuteRan = acquisition.stages?.commute === 'measured'
    && !!commuteRecord
    && typeof commuteRecord.durationMinutes === 'number'
    && Number.isFinite(commuteRecord.durationMinutes);
  if (commuteRan && !commuteRecord?.destination) {
    return refuse(
      'commute_destination_unrecorded',
      'The stored enrichment measured a commute but records no destination, so '
      + 'it predates the urban-centre register and cannot say whether it was '
      + "measured to this property's own centre. Re-acquiring.",
    );
  }

  if (acquisition.stages?.places !== 'complete') {
    const attempts = typeof acquisition.attempt === 'number' && Number.isFinite(acquisition.attempt)
      ? acquisition.attempt
      : 1;
    if (attempts < MAX_PARTIAL_ACQUISITIONS) {
      // A Places outage stores zeros that read exactly like a quiet rural
      // suburb, and a complete set is worth a bounded number of retries.
      return refuse(
        'incomplete_acquisition',
        `The stored enrichment was acquired while at least one amenity lookup `
        + `failed, so its counts may understate the area. Re-acquiring `
        + `(attempt ${attempts} of ${MAX_PARTIAL_ACQUISITIONS}).`,
      );
    }
    // The retries are spent. Reuse what we have rather than re-buying eight
    // calls on every remaining resume — which is the amplification this whole
    // module exists to stop, and refusing forever would reach it through the
    // guard meant to prevent it. The stamp still says `partial`, so nothing
    // downstream can read this as a complete acquisition.
    return {
      reuse: true,
      verdict: 'partial_retry_exhausted',
      note:
        `Reusing an incomplete location enrichment after `
        + `${MAX_PARTIAL_ACQUISITIONS} acquisitions — at least one amenity `
        + 'lookup keeps failing for this address, and re-buying the whole set '
        + 'on every resume costs more than it recovers. Still recorded as '
        + 'partial.',
    };
  }

  return {
    reuse: true,
    verdict: 'reusable',
    note:
      `Reusing the location enrichment acquired at ${acquisition.acquiredAt} for `
      + 'this same property — the provider answer cannot change between resumes.',
  };
}
