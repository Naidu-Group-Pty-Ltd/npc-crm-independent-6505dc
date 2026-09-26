/**
 * Whether a persisted acquisition result may be reused on a continuation, one
 * dependency at a time.
 *
 * ## Why this is not "skip acquisition on continuation"
 *
 * A blanket gate is the wrong shape twice over. It would reuse a result
 * acquired for a different subject or under a different accepted input, and it
 * would freeze a *failed* acquisition as permanent — so a register that was
 * merely unreachable for four seconds would be reported as holding nothing
 * about the property, for the life of the report.
 *
 * So reuse is decided per dependency, and it is refused unless the stored
 * object can PROVE it describes this subject under these inputs. That is the
 * rule `locationEnrichmentReuse` already established for the enrichment
 * (RF-7.2B.1B1); this generalises it to the rest of the acquisition phase,
 * which today re-runs in full on every continuation because the early-persist
 * block guards the WRITE and nothing guards the FETCH.
 *
 * ## The four refusals
 *
 * 1. **No stamp** — a legacy object that cannot say what it describes is never
 *    reused. It re-acquires exactly as before, which is why adopting this
 *    cannot change any existing report.
 * 2. **Different subject** — address, postcode or state differ. A result about
 *    somewhere else is worse than no result.
 * 3. **Different accepted inputs** — the operator's submitted scenario changed,
 *    so anything derived from price, rent, LVR or loan terms is stale by
 *    definition. Geography-only dependencies are unaffected and say so.
 * 4. **Too old** — each class carries its own shelf life. A cadastral zoning
 *    answer is good for far longer than a market median.
 *
 * And one rule that is not a refusal: a dependency whose last attempt FAILED is
 * always re-attempted. Failure is a fact about that attempt, never about the
 * property.
 */

/** How finely a planning answer's point was placed — the geocoder's own four words. */
type PlanningPrecision = 'address' | 'street' | 'locality' | 'postcode';

/** What a stored acquisition result must carry to be reusable. */
export interface AcquisitionStamp {
  /** The address the result was acquired for, as submitted. */
  address: string;
  /** The postcode resolved at acquisition time, if any. */
  postcode: string | null;
  /** The state resolved at acquisition time, if any. */
  state: string | null;
  /**
   * A digest of the accepted inputs this result was derived under. Anything
   * financial must re-acquire when this changes; geography need not.
   */
  inputRevision: string;
  /** When the result was acquired (ISO 8601). */
  acquiredAt: string;
  /** The shape version of the stored payload. */
  schemaVersion: number;
  /** Whether the acquisition succeeded. A failure is never reused. */
  outcome: 'answered' | 'empty' | 'failed';
}

/** The subject and inputs the CURRENT invocation is working on. */
export interface AcquisitionSubject {
  address: string;
  postcode: string | null;
  state: string | null;
  inputRevision: string;
}

/**
 * What a dependency's answer depends on. Decides which changes invalidate it.
 *
 * `geography` results survive a change of accepted inputs — a flood overlay does
 * not move because the operator revised the interest rate. `financial` results
 * do not. `both` is the conservative default for anything mixed.
 */
export type DependencySensitivity = 'geography' | 'financial' | 'both';

/** How long each class of answer stays good, in hours. */
export const REUSE_SHELF_LIFE_HOURS = {
  /** Cadastral and statutory layers: zoning, overlays, lot geometry. */
  cadastral: 24 * 30,
  /** Census, SEIFA and other periodic official statistics. */
  statistical: 24 * 30,
  /** Registers that publish on a cadence: crime, planning applications. */
  register: 24 * 7,
  /** Anything with a market price in it. */
  market: 24,
  /** Derived from the operator's own inputs. */
  derived: 24,
} as const;

export type ReuseClass = keyof typeof REUSE_SHELF_LIFE_HOURS;

export interface DependencyPolicy {
  sensitivity: DependencySensitivity;
  reuseClass: ReuseClass;
}

export type ReuseDecision =
  | { reuse: true; reason: 'valid'; ageHours: number }
  | {
      reuse: false;
      reason:
        | 'no_stamp'
        | 'subject_changed'
        | 'inputs_changed'
        | 'schema_changed'
        | 'expired'
        | 'previous_attempt_failed'
        | 'no_stored_value'
        | 'point_not_recorded'
        | 'point_changed'
        | 'answer_version_not_recorded'
        | 'answer_version_changed';
    };

function normaliseAddress(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hoursBetween(thenIso: string, nowMs: number): number | null {
  const then = Date.parse(thenIso);
  if (!Number.isFinite(then)) return null;
  return (nowMs - then) / 3_600_000;
}

/**
 * May this stored result be reused for this subject, now?
 *
 * `storedValue` is passed so an absent or empty payload can never be "reused"
 * into overwriting a later, valid acquisition — the continuation object being
 * empty is not a reason to keep it.
 */
export function assessReuse(args: {
  storedValue: unknown;
  stamp: AcquisitionStamp | null | undefined;
  subject: AcquisitionSubject;
  policy: DependencyPolicy;
  currentSchemaVersion: number;
  nowMs: number;
}): ReuseDecision {
  const { storedValue, stamp, subject, policy, currentSchemaVersion, nowMs } = args;

  if (storedValue === null || storedValue === undefined) {
    return { reuse: false, reason: 'no_stored_value' };
  }
  if (!stamp) {
    // A legacy object with no provenance. Re-acquire, exactly as today.
    return { reuse: false, reason: 'no_stamp' };
  }
  if (stamp.outcome === 'failed') {
    // Never freeze a transient failure into a permanent absence.
    return { reuse: false, reason: 'previous_attempt_failed' };
  }
  if (stamp.schemaVersion !== currentSchemaVersion) {
    return { reuse: false, reason: 'schema_changed' };
  }

  if (normaliseAddress(stamp.address) !== normaliseAddress(subject.address)) {
    return { reuse: false, reason: 'subject_changed' };
  }
  // A null on either side is not a match: we cannot show it describes the same
  // place, and reusing across a jurisdiction boundary is the worst failure here.
  if ((stamp.postcode ?? null) !== (subject.postcode ?? null)) {
    return { reuse: false, reason: 'subject_changed' };
  }
  if ((stamp.state ?? null) !== (subject.state ?? null)) {
    return { reuse: false, reason: 'subject_changed' };
  }

  if (policy.sensitivity !== 'geography' && stamp.inputRevision !== subject.inputRevision) {
    return { reuse: false, reason: 'inputs_changed' };
  }

  const ageHours = hoursBetween(stamp.acquiredAt, nowMs);
  if (ageHours === null || ageHours < 0) {
    return { reuse: false, reason: 'expired' };
  }
  if (ageHours > REUSE_SHELF_LIFE_HOURS[policy.reuseClass]) {
    return { reuse: false, reason: 'expired' };
  }

  return { reuse: true, reason: 'valid', ageHours };
}

/**
 * A stable digest of the accepted inputs, for `inputRevision`.
 *
 * Only the fields that actually change a derived figure are included, so an
 * unrelated edit does not throw away good research. Key order is normalised so
 * two equal scenarios always produce the same revision.
 */
export function inputRevisionOf(overrides: Record<string, unknown> | null | undefined): string {
  const MATERIAL_KEYS = [
    'purchasePrice', 'landPrice', 'buildPrice', 'depositValue', 'loanToValueRatio',
    'interestRate', 'capitalGrowth', 'weeklyRent', 'occupancyRate', 'loanType',
    'loanTermYears', 'loanAmount', 'interestOnlyPeriodYears', 'stampDuty',
    'propertyType', 'buildType', 'isFirstHomeBuyer',
  ];
  const source = overrides ?? {};
  const parts: string[] = [];
  for (const key of MATERIAL_KEYS.slice().sort()) {
    const value = (source as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${String(value)}`);
  }
  return parts.length === 0 ? 'empty' : parts.join('&');
}

/**
 * Merge a freshly acquired value over a stored one, without ever letting an
 * absence destroy evidence.
 *
 * The continuation path re-enters with a partially-populated object, and a
 * naive spread would write `undefined` over a good stored result. The rule:
 * only a value that was actually acquired replaces what is banked.
 */
export function mergeAcquired<T>(stored: T | null | undefined, fresh: T | null | undefined): T | null {
  if (fresh !== null && fresh !== undefined) return fresh;
  if (stored !== null && stored !== undefined) return stored;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// WIRING: which dependencies a later invocation may reuse, and from where
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where the stamp lives inside the stored packet.
 *
 * The packet IS `enhancedData` — `traceStartRun` persists it to
 * `report_generation_runs.data_packet` on every run, after the acquisition
 * block, so the research a run bought is already durable. Nothing needed a new
 * column; what was missing was a statement of WHAT the object describes, and
 * that rides inside the object the generator composes itself.
 */
export const ACQUISITION_STAMP_KEY = '__acquisition';

/**
 * Bump when the shape of any reusable value changes.
 *
 * A packet stamped with a different version is refused outright rather than
 * read field by field: a reader that guesses which half of a changed shape it
 * understands is how a stale field survives a migration.
 */
export const ACQUISITION_SCHEMA_VERSION = 1;

export interface ReusableDependency extends DependencyPolicy {
  /** The acquisition ledger's producer name, which is not always the key. */
  producer: string;
}

/**
 * The dependencies worth reusing, keyed by their `enhancedData` field.
 *
 * Every one is **geography-sensitive only**: a register's answer about a place
 * does not change because the operator revised the interest rate. Anything
 * derived from the accepted inputs is deliberately absent —
 * `financial_calculations` is a local calculator and costs nothing, and
 * `investmentScore` must re-run because it grades the evidence this run
 * assembled, reused or not. `locationIntelligence` is absent too: it already
 * has `assessEnrichmentReuse`, and two modules deciding one question is how
 * they come to disagree.
 *
 * The ceilings these replace, per invocation: planning 45s, climate 40s,
 * regional 30s, Domain 30s, crime 30s, risk 25s, SEIFA 25s, employment 25s,
 * demographics 30s, RBA 20s.
 */
export const REUSABLE_ACQUISITIONS: Record<string, ReusableDependency> = {
  planningData:    { producer: 'planning',        sensitivity: 'geography', reuseClass: 'cadastral' },
  climateData:     { producer: 'climate',         sensitivity: 'geography', reuseClass: 'statistical' },
  regionalTrends:  { producer: 'regionalTrends',  sensitivity: 'geography', reuseClass: 'statistical' },
  domainData:      { producer: 'marketData',      sensitivity: 'geography', reuseClass: 'market' },
  crimeStatistics: { producer: 'crimeStatistics', sensitivity: 'geography', reuseClass: 'register' },
  schoolData:      { producer: 'schools',         sensitivity: 'geography', reuseClass: 'register' },
  riskAssessment:  { producer: 'riskAssessment',  sensitivity: 'geography', reuseClass: 'register' },
  seifaData:       { producer: 'seifa',           sensitivity: 'geography', reuseClass: 'statistical' },
  demographics:    { producer: 'demographics',    sensitivity: 'geography', reuseClass: 'statistical' },
  employmentData:  { producer: 'employment',      sensitivity: 'geography', reuseClass: 'statistical' },
  // The cash rate is national rather than local, so no geography change
  // invalidates it — but it moves, so it is priced as market data and expires
  // in a day.
  economics:       { producer: 'economics',       sensitivity: 'geography', reuseClass: 'market' },
};

/**
 * Does a stored planning answer record that it was read at the property or on
 * its street? `pointBasis` rides on the answer from the generator's own
 * request (`planningCoordinate.pure.ts` decides the point).
 */
export function planningPointIsRecorded(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const basis = (value as Record<string, unknown>).pointBasis;
  if (!basis || typeof basis !== 'object') return false;
  const precision = (basis as Record<string, unknown>).precision;
  return precision === 'address' || precision === 'street';
}

/**
 * The planning answer version a stored answer was read under, or null where
 * it records none.
 *
 * `planning-data-service` keys its own cache on `PLANNING_ANSWER_VERSION`, so
 * a deployment that widens the answer stops serving the narrow rows. This
 * reuse is a second cache in front of that one, and it carried no version: on
 * 25 Sep 2026 the regeneration of 60 Lawley Street, Spalding WA adopted the
 * planning answer its own earlier generation had read at 01:31 UTC, under
 * `c6`. `c7`, which reads Western Australia's bush fire prone areas, had
 * shipped in between. So the service was never asked, and the bushfire
 * register that answers at that point never reached the regenerated
 * document. The thirty-day cadastral shelf life would have kept that answer
 * for a month.
 *
 * The generator stamps the version on the answer it stores and hands the
 * current one to `planReuse`. Both the stamp and the service's cache key read
 * `PLANNING_ANSWER_VERSION`, and both deploy with the shared module. It is
 * passed in rather than imported because a module here imports nothing from
 * another domain (`investmentSourceOfTruth.spec.ts`).
 */
export function planningAnswerVersionOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const version = (value as Record<string, unknown>).answerVersion;
  return typeof version === 'string' && version.trim() ? version.trim() : null;
}

/** A point a planning answer was, or is about to be, read at. */
export interface PlanningPoint {
  precision: PlanningPrecision | null;
  provider: string | null;
  /** Recorded from 25 Sep 2026; absent on every answer stored before. */
  lat: number | null;
  lng: number | null;
}

const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The point a stored planning answer records it was read at. Total. */
export function planningPointOf(value: unknown): PlanningPoint {
  const basis = value && typeof value === 'object'
    ? (value as Record<string, unknown>).pointBasis as Record<string, unknown> | undefined
    : undefined;
  const b = basis && typeof basis === 'object' ? basis : {};
  const precision = b.precision;
  const provider = b.provider;
  return {
    precision: precision === 'address' || precision === 'street' || precision === 'locality' || precision === 'postcode'
      ? precision
      : null,
    provider: typeof provider === 'string' && provider.trim() ? provider.trim() : null,
    lat: finiteOrNull(b.lat),
    lng: finiteOrNull(b.lng),
  };
}

/**
 * Was a stored planning answer read at the point THIS run is working from?
 *
 * A planning answer is a reading at a point, and the point can move between
 * generations: the geocoder puts a remembered street answer to the address
 * register (`geocodeChainPolicy.pure.ts`, rule 4) and the location enrichment
 * is placed again (`streetPointIsStale`). An answer kept for its thirty-day
 * cadastral life across that move would leave a report measuring its
 * amenities at the property and reading its zone on the street — measured on
 * 25 Sep 2026, `60 Lawley Street, Spalding` read its planning at
 * OpenStreetMap's street point while the register held the property's own.
 *
 * So the point is compared, not the clock: same precision, same provider,
 * and — where both record one — the same coordinate. Nothing recorded is not
 * a match.
 */
export function planningAnswerFitsPoint(
  stored: unknown,
  current: { precision: string | null; provider: string | null; lat?: number | null; lng?: number | null },
): boolean {
  const recorded = planningPointOf(stored);
  if (recorded.precision === null || recorded.precision !== current.precision) return false;
  if (recorded.provider !== (current.provider ?? null)) return false;
  const lat = finiteOrNull(current.lat);
  const lng = finiteOrNull(current.lng);
  if (recorded.lat !== null && recorded.lng !== null && lat !== null && lng !== null) {
    return Math.abs(recorded.lat - lat) < 1e-6 && Math.abs(recorded.lng - lng) < 1e-6;
  }
  return true;
}

/**
 * Take back a reuse `planReuse` admitted, once the run learns it does not fit.
 *
 * The provenance ledger is written from the plan LAST, and is last-write-wins,
 * so a withdrawn entry left standing would record "reused" over the fresh
 * answer the run then fetched.
 */
export function withdrawReuse(plan: ReusePlan, key: string, reason: 'point_changed'): ReusePlan {
  const values = { ...plan.values };
  delete values[key];
  return {
    ...plan,
    values,
    entries: plan.entries.map((e) => (e.key === key ? { ...e, decision: { reuse: false, reason } } : e)),
  };
}

/** Compose the stamp a run writes beside what it acquired. */
export function acquisitionStamp(subject: AcquisitionSubject, nowIso: string): AcquisitionStamp {
  return {
    address: subject.address,
    postcode: subject.postcode,
    state: subject.state,
    inputRevision: subject.inputRevision,
    acquiredAt: nowIso,
    schemaVersion: ACQUISITION_SCHEMA_VERSION,
    outcome: 'answered',
  };
}

export interface ReusePlanEntry {
  key: string;
  producer: string;
  decision: ReuseDecision;
}

export interface ReusePlan {
  /** Values this invocation may adopt without asking anybody. */
  values: Record<string, unknown>;
  /** Every dependency considered, with why it was or was not reused. */
  entries: ReusePlanEntry[];
  /** Whether a usable stamp was found at all. */
  stamped: boolean;
}

/**
 * Decide, per dependency, what this invocation may take from a previous one.
 *
 * Refusal is the default and every refusal is named. A packet with no stamp —
 * which is every run recorded before this shipped — reuses nothing and the
 * invocation acquires exactly as it always did.
 */
export function planReuse(args: {
  storedPacket: Record<string, unknown> | null | undefined;
  subject: AcquisitionSubject;
  nowMs: number;
  /**
   * The answer version the planning service answers under now
   * (`PLANNING_ANSWER_VERSION`). Required: a caller that could omit it would
   * reuse every stored answer whatever shape it had.
   */
  planningAnswerVersion: string;
}): ReusePlan {
  const { storedPacket, subject, nowMs, planningAnswerVersion } = args;
  const rawStamp = storedPacket?.[ACQUISITION_STAMP_KEY];
  const stamp = (rawStamp && typeof rawStamp === 'object')
    ? (rawStamp as AcquisitionStamp)
    : null;

  const values: Record<string, unknown> = {};
  const entries: ReusePlanEntry[] = [];

  for (const [key, policy] of Object.entries(REUSABLE_ACQUISITIONS)) {
    const storedValue = storedPacket?.[key];
    let decision = assessReuse({
      storedValue,
      stamp,
      subject,
      policy,
      currentSchemaVersion: ACQUISITION_SCHEMA_VERSION,
      nowMs,
    });
    // A planning answer is a reading AT A POINT, and it is reusable only where
    // it records that the point was the property or its street. Every answer
    // stored before 24 Sep 2026 records nothing — and on that day two were
    // read at the centre of a suburb and would otherwise have been served for
    // thirty days (`cadastral`) on every regeneration.
    if (decision.reuse && key === 'planningData' && !planningPointIsRecorded(storedValue)) {
      decision = { reuse: false, reason: 'point_not_recorded' };
    }
    // …and it is an answer of a particular SHAPE. One read under an earlier
    // `PLANNING_ANSWER_VERSION` lacks what the current version asks for, so it
    // is asked again once, exactly as the service's own cache would.
    if (decision.reuse && key === 'planningData') {
      const version = planningAnswerVersionOf(storedValue);
      if (version === null) decision = { reuse: false, reason: 'answer_version_not_recorded' };
      else if (version !== planningAnswerVersion) decision = { reuse: false, reason: 'answer_version_changed' };
    }
    entries.push({ key, producer: policy.producer, decision });
    if (decision.reuse) values[key] = storedValue;
  }

  return { values, entries, stamped: stamp !== null };
}
