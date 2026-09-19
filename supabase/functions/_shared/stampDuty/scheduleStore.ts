/**
 * Cache-backed schedule loading.
 *
 * Not `.pure` — this is the only module in `stampDuty/` that touches the
 * database, so the engine and the tables stay testable without one.
 *
 * ── Why the cache cannot simply overwrite the built-in table ──────────────
 *
 * `stamp_duty_rates_cache` used to be written by a job that scraped eight
 * revenue office pages and pulled numbers out of the markdown with a regex,
 * then upserted whatever it got as `data_quality = 'live'`. Two things saved
 * that from causing harm: the parser never actually produced a bracket, and
 * nothing in the product ever read the table. Both of those are now fixed,
 * which makes the design dangerous rather than merely inert — a scrape that
 * half-worked would silently change the stamp duty figure on a client's
 * report, and nobody would know which number they had been quoted.
 *
 * So the cache serves a schedule only when a human has published one
 * (`override`) or when it matches what the code already ships (`built_in`), and
 * only after it passes the same validation the built-in tables pass. A scrape
 * that disagrees is recorded as `needs_review` and is never served. The refresh
 * job's job is to tell someone the rates moved, not to guess what they moved to.
 */

import type { AustralianState, DutySchedule } from './types.pure.ts';
import { DUTY_SCHEDULES } from './schedules.pure.ts';
import { validateSchedule } from './validate.pure.ts';

/**
 * `built_in`  — identical to the schedule shipped in the code.
 * `override`  — a human-published correction; served in preference to the code.
 * `needs_review` — a verification sweep found drift it could not confirm. Held
 *                  for review and deliberately NOT served.
 */
export type ScheduleQuality = 'built_in' | 'override' | 'needs_review';

const SERVABLE: ReadonlySet<ScheduleQuality> = new Set<ScheduleQuality>(['built_in', 'override']);

export interface ResolvedSchedule {
  schedule: DutySchedule;
  /** Where the served schedule came from. */
  source: 'cache' | 'built-in';
  /** Present when the cache was consulted and rejected, with the reason. */
  rejectedReason?: string;
}

interface CacheRow {
  state: string;
  schedule: unknown;
  data_quality: string;
  expires_at: string | null;
}

/**
 * Structural check on a value read out of JSONB. Validation of the *numbers*
 * is `validateSchedule`'s job; this only establishes that we have a schedule at
 * all, so a malformed row degrades to the built-in rather than throwing.
 */
function looksLikeSchedule(value: unknown): value is DutySchedule {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DutySchedule>;
  return (
    typeof candidate.state === 'string' &&
    typeof candidate.year === 'string' &&
    Array.isArray(candidate.general) &&
    candidate.general.length > 0 &&
    typeof candidate.foreignSurchargePct === 'number' &&
    !!candidate.firstHome
  );
}

/**
 * The schedule to assess `state` against.
 *
 * Never throws and never returns nothing: every failure path falls back to the
 * built-in table, because an outage in the cache must not become an outage in
 * the calculator.
 */
export async function resolveSchedule(
  state: AustralianState,
  supabase: { from: (table: string) => any },
): Promise<ResolvedSchedule> {
  const builtIn = DUTY_SCHEDULES[state];

  try {
    const { data, error } = await supabase
      .from('stamp_duty_rates_cache')
      .select('state, schedule, data_quality, expires_at')
      .eq('state', state)
      .maybeSingle();

    if (error || !data) {
      return { schedule: builtIn, source: 'built-in', rejectedReason: error ? String(error.message ?? error) : undefined };
    }

    const row = data as CacheRow;

    if (!SERVABLE.has(row.data_quality as ScheduleQuality)) {
      return { schedule: builtIn, source: 'built-in', rejectedReason: `cached schedule is ${row.data_quality}` };
    }

    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
      return { schedule: builtIn, source: 'built-in', rejectedReason: 'cached schedule has expired' };
    }

    if (!looksLikeSchedule(row.schedule)) {
      return { schedule: builtIn, source: 'built-in', rejectedReason: 'cached schedule is malformed' };
    }

    const issues = validateSchedule(row.schedule);
    if (issues.length) {
      return {
        schedule: builtIn,
        source: 'built-in',
        rejectedReason: `cached schedule failed validation: ${issues.map((i) => i.message).join('; ')}`,
      };
    }

    return { schedule: row.schedule, source: 'cache' };
  } catch (cause) {
    return { schedule: builtIn, source: 'built-in', rejectedReason: `cache unavailable: ${String(cause)}` };
  }
}

/** Narrow an arbitrary string to a jurisdiction, defaulting to NSW. */
export function coerceState(value: string | null | undefined): AustralianState {
  const candidate = (value ?? '').trim().toUpperCase();
  return candidate in DUTY_SCHEDULES ? (candidate as AustralianState) : 'NSW';
}
