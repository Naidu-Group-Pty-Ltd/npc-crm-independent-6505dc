/**
 * Pure model for the server-side listings cache.
 *
 * The cache is an **archive**, not a mirror. Airtable's `Property Intake Master`
 * is a working table and the base prunes it at thirty days; this store keeps
 * what the purge took, because it is the only copy the product has. It used to
 * mirror those deletions, which put the whole marketplace on a thirty-day fuse —
 * see `planRetention` below for the measurement.
 *
 * That makes the sync's deletion step the most dangerous code in the feature: it
 * is the one operation that can destroy data for every user at once, and it
 * fires on a schedule with nobody watching. Two decisions guard it, and they are
 * separate questions. `planReconciliation` asks whether this run may act on what
 * it did not see at all. `planRetention` then asks, of each row it did not see,
 * whether it aged out (keep it) or was deleted on purpose (remove it).
 *
 * Free of Deno, Supabase, React and the DOM so both runtimes can share it and
 * the dangerous decisions can be tested directly.
 */

/** One record as it arrives from Airtable. */
export interface AirtableRecordLike {
  id?: unknown;
  createdTime?: unknown;
  fields?: Record<string, unknown> | null;
}

/** One row as it is stored. */
export interface CachedListingRow {
  listing_id: string;
  table_key: string;
  fields: Record<string, unknown>;
  created_time: string | null;
  last_modified_time: string | null;
  fingerprint: string;
  last_verified_at: string;
}

/* -------------------------------------------------------------------------- */
/* Field extraction                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Airtable record ids are `rec` + 14 url-safe characters. Bounded rather than
 * exact, matching the check `listing-images` already uses.
 */
export function cleanRecordId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{3,64}$/.test(trimmed) ? trimmed : null;
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * The record's creation time, taken from Airtable's own metadata.
 *
 * Deliberately *not* the value `airtable-proxy` synthesises: that helper
 * coalesces several possible date fields and falls back to `new Date()` when a
 * record has none, which would make an undated record look brand new on every
 * sync — permanently fresh here while Airtable's own 30-day window, which reads
 * the real Created Time, prunes it. The cache and the source have to be looking
 * at the same clock.
 */
export function extractCreatedTime(record: AirtableRecordLike): string | null {
  const fields = record.fields ?? {};
  return (
    isoOrNull(fields['Created Time']) ??
    isoOrNull(fields['Created']) ??
    isoOrNull(record.createdTime)
  );
}

export function extractLastModified(record: AirtableRecordLike): string | null {
  const fields = record.fields ?? {};
  return isoOrNull(fields['Last Modified Time']) ?? isoOrNull(fields['Last Modified']);
}

/**
 * Stable digest of a record's contents.
 *
 * Key order is normalised because Airtable does not promise a stable ordering
 * between reads; without that, every sync would look like every record changed
 * and the cache would rewrite itself in full each time.
 */
export function fingerprintRecord(fields: Record<string, unknown> | null | undefined): string {
  if (!fields) return '0';
  const keys = Object.keys(fields).sort();
  let hash = 0;
  for (const key of keys) {
    const chunk = `${key}=${JSON.stringify(fields[key]) ?? ''}`;
    for (let i = 0; i < chunk.length; i += 1) {
      hash = (hash * 31 + chunk.charCodeAt(i)) | 0;
    }
  }
  return `${keys.length}:${(hash >>> 0).toString(36)}`;
}

/** Maps an Airtable record to a cache row, or null if it has no usable id. */
export function toCacheRow(
  record: AirtableRecordLike,
  tableKey: string,
  verifiedAt: string,
): CachedListingRow | null {
  const listingId = cleanRecordId(record.id);
  if (!listingId) return null;
  const fields = (record.fields ?? {}) as Record<string, unknown>;
  return {
    listing_id: listingId,
    table_key: tableKey,
    fields,
    created_time: extractCreatedTime(record),
    last_modified_time: extractLastModified(record),
    fingerprint: fingerprintRecord(fields),
    last_verified_at: verifiedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Deletion reconciliation                                                     */
/* -------------------------------------------------------------------------- */

export type ReconcileDecision = 'reconcile' | 'skip_incomplete' | 'skip_implausible' | 'skip_empty';

export interface ReconcileVerdict {
  decision: ReconcileDecision;
  allowed: boolean;
  /** Why, in a form worth writing to `last_error` and reading in a log. */
  reason: string;
}

/**
 * The largest *share* of the cache a single sync may delete.
 *
 * A run that suddenly cannot see most of the table is usually describing a
 * failure — a truncated walk, a permissions change, a wrong table name — not a
 * real deletion, and acting on it would take the dashboard down for everyone
 * with no way back, because the cache is the only copy.
 */
export const MAX_DELETION_SHARE = 0.75;

/**
 * The largest *absolute* number of records a single sync may delete regardless
 * of share.
 *
 * This exists because the share test alone would have blocked the exact event
 * it is meant to propagate. Airtable's "Delete Records After 30 Days"
 * automation runs `findRecords` with `limit: 1000`, so one night can legitimately
 * remove a thousand records; against the 1,441 currently held that is 69% of the
 * table, and a purely proportional guard would have refused it and quietly
 * stopped the cache mirroring deletions at all.
 *
 * Tied to that automation's limit plus headroom. If the limit changes upstream,
 * this has to change with it.
 */
export const MAX_DELETION_ABSOLUTE = 1_200;

/** Below this a proportional test is meaningless, so it is not applied. */
export const SMALL_TABLE_FLOOR = 20;

export interface ReconcileInput {
  /** Did the walk reach the end of Airtable's pagination without erroring? */
  walkComplete: boolean;
  /** Distinct records the walk actually saw. */
  fetchedCount: number;
  /** Records held after the last clean sync; 0 or null on a first run. */
  previousCount: number | null;
}

/**
 * Decides whether this sync run may delete the rows it did not see.
 *
 * Reconciliation is the only way an upstream deletion reaches the cache, so this
 * cannot simply refuse when unsure — it has to distinguish "Airtable pruned some
 * records" from "this run did not see the whole table". The evidence available
 * is whether the walk finished and how the count compares to the last known-good
 * one.
 */
export function planReconciliation({
  walkComplete,
  fetchedCount,
  previousCount,
}: ReconcileInput): ReconcileVerdict {
  if (!walkComplete) {
    return {
      decision: 'skip_incomplete',
      allowed: false,
      reason: 'walk did not complete; rows it never reached would look deleted',
    };
  }

  if (fetchedCount === 0) {
    // Either the table really is empty or the read silently returned nothing.
    // The second is far more likely and the first is harmless to defer, so a
    // human gets to make this call rather than a cron job at 3am.
    return {
      decision: 'skip_empty',
      allowed: false,
      reason: 'walk returned no records at all; refusing to empty the cache',
    };
  }

  // Nothing to compare against yet: a first sync has no cache to protect.
  if (previousCount === null || previousCount <= 0) {
    return { decision: 'reconcile', allowed: true, reason: 'first sync for this table' };
  }

  const missing = previousCount - fetchedCount;
  if (missing <= 0) {
    return { decision: 'reconcile', allowed: true, reason: 'no net loss against the last clean sync' };
  }

  if (previousCount < SMALL_TABLE_FLOOR) {
    // On a handful of records "half" is one or two, so proportion says nothing.
    return {
      decision: 'reconcile',
      allowed: true,
      reason: `small table (${previousCount}); proportional guard not meaningful`,
    };
  }

  // Two independent allowances, either of which is enough. The absolute one
  // covers a known nightly prune on a table small enough for it to look
  // disproportionate; the share one covers a proportionate change on a table of
  // any size. Only a loss that fails both looks like a broken read.
  const share = missing / previousCount;
  if (missing > MAX_DELETION_ABSOLUTE && share > MAX_DELETION_SHARE) {
    return {
      decision: 'skip_implausible',
      allowed: false,
      reason:
        `saw ${fetchedCount} of ${previousCount} previously cached records ` +
        `(${missing} missing, ${Math.round(share * 100)}%); that is a failed read, not a deletion`,
    };
  }

  return {
    decision: 'reconcile',
    allowed: true,
    reason: `${missing} of ${previousCount} records gone, within the expected band`,
  };
}

/**
 * Whether the walk's ordering can be trusted.
 *
 * `airtable-proxy` silently retries without sorting when a table rejects the
 * sort field, and says nothing about it in the response. Nothing in this cache
 * depends on order — the sync reads the whole table either way — but a sync that
 * quietly stopped being newest-first is worth surfacing, because the client's
 * incremental path does depend on it.
 */
export function orderLooksSorted(createdTimes: Array<string | null>): boolean {
  const stamps = createdTimes
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Date.parse(value))
    .filter((ms) => Number.isFinite(ms));
  if (stamps.length < 3) return true;
  let descending = 0;
  for (let i = 1; i < stamps.length; i += 1) {
    if (stamps[i] <= stamps[i - 1]) descending += 1;
  }
  // Allow for ties and the odd out-of-order record rather than demanding a
  // perfect sort; this is a smoke signal, not a correctness check.
  // 0.8 tolerates ties and the odd stray while a genuinely unsorted read
  // scores around 0.5.
  return descending / (stamps.length - 1) >= 0.8;
}

/* -------------------------------------------------------------------------- */
/* Retention: what a vanished record means                                     */
/* -------------------------------------------------------------------------- */

/**
 * How long Airtable keeps an intake record.
 *
 * Set by the base's own `Delete Property Intake Records After 30 Days`
 * automation (`wfljwe75Zqv5u8uCx`), which finds records whose `Created Time` is
 * before *30 days ago* and deletes them. This constant must track that
 * automation; see `docs/integrations/AIRTABLE_RETENTION.md`.
 */
export const AIRTABLE_RETENTION_DAYS = 30;

/**
 * Slack between "old enough to be purged" and "we treat its disappearance as a
 * purge".
 *
 * The automation runs once a day at midnight Kuala Lumpur, so a record can sit
 * up to a day past thirty before its turn comes, and the walk that notices it
 * gone may be a further fifteen minutes behind. A day of grace keeps a
 * *deliberate* deletion of a nearly-expired record from being mistaken for the
 * schedule — the two are indistinguishable at the boundary, and this decides
 * which way the boundary leans.
 */
export const RETENTION_GRACE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface VanishedRow {
  listing_id: string;
  /** Airtable's own record creation time, which the purge measures against. */
  created_time: string | null;
}

/**
 * The most in-window disappearances one sync may act on destructively, as a
 * share of what the walk actually saw.
 *
 * A deliberate deletion is a person removing a listing or two. A dozen records
 * that were inside the window vanishing between two syncs fifteen minutes apart
 * is not somebody tidying up — it is a walk that missed them, which Airtable's
 * offset pagination makes entirely possible while the nightly purge is deleting
 * rows underneath it.
 *
 * `planReconciliation` cannot catch that on a table this size: its two
 * allowances are ANDed, and `missing` never approaches
 * `MAX_DELETION_ABSOLUTE` on 148 records, so a walk that returned 26 of them
 * would be acted on in full. That guard is calibrated for the nightly purge,
 * which no longer needs to produce deletions at all now that ageing out is
 * archived — so the destructive half gets its own, much tighter, limit.
 */
export const MAX_REMOVAL_SHARE = 0.1;

/** Below this a share is meaningless, so this many removals are always allowed. */
export const MIN_REMOVAL_FLOOR = 5;

export interface RetentionPlan {
  /** Rows the 30-day purge took. Kept, and marked archived. */
  archive: string[];
  /** Rows that disappeared while still inside the window. Really deleted. */
  remove: string[];
  /**
   * In-window rows archived instead of deleted because there were too many of
   * them to be anybody's deliberate act. Zero on a normal run.
   */
  withheld: number;
  /** Why, when `withheld` is non-zero. Worth writing to the sync row. */
  note: string | null;
}

export interface RetentionOptions {
  retentionDays?: number;
  /**
   * How many records the walk actually saw. The removal cap is measured against
   * this; omit it and only the floor applies.
   */
  liveCount?: number;
}

/**
 * What to do with the rows a completed walk did not see.
 *
 * **This is the difference between a mirror and an archive**, and it is the
 * whole reason the Property Marketplace was emptying itself. Airtable prunes
 * the intake table at thirty days because it is a working table, not a store —
 * and the cache propagated every one of those deletions, so the product's
 * entire inventory sat on a thirty-day fuse. Measured on 2026-08-25: 148
 * listings on 2026-08-19 had become 51, all of them from a single evening's
 * intake, with the next purge due to take those too.
 *
 * The purge is not the bug. Mirroring it is. So a row that vanished *because it
 * aged out* is kept and marked archived, and only a row that vanished while it
 * was still inside the window is actually removed — because that one was
 * deleted on purpose by somebody, and a deliberate deletion must still reach
 * the dashboard.
 *
 * A row with no `created_time` cannot be shown to have aged out, so it is
 * archived rather than removed: keeping a listing that should have gone is a
 * recoverable mistake, and deleting the only copy of one is not.
 *
 * The same asymmetry bounds the destructive half. Deliberate deletions come a
 * few at a time; a crowd of them is a walk that missed records, so past
 * `MAX_REMOVAL_SHARE` the whole batch is archived rather than part-deleted —
 * all or nothing, because deleting the first five and archiving the rest would
 * still lose five listings on every racing sync.
 */
export function planRetention(
  vanished: readonly VanishedRow[],
  now: number,
  options: RetentionOptions | number = {},
): RetentionPlan {
  // Tolerates the older positional `retentionDays` form.
  const opts: RetentionOptions = typeof options === 'number' ? { retentionDays: options } : options;
  const retentionDays = opts.retentionDays ?? AIRTABLE_RETENTION_DAYS;
  const cutoff = now - (retentionDays + RETENTION_GRACE_DAYS) * DAY_MS;
  const archive: string[] = [];
  const remove: string[] = [];

  for (const row of vanished) {
    if (!row?.listing_id) continue;
    const created = row.created_time ? Date.parse(row.created_time) : NaN;
    if (!Number.isFinite(created) || created <= cutoff) archive.push(row.listing_id);
    else remove.push(row.listing_id);
  }

  const allowance = Math.max(
    MIN_REMOVAL_FLOOR,
    Math.floor((opts.liveCount ?? 0) * MAX_REMOVAL_SHARE),
  );
  if (remove.length > allowance) {
    const note =
      `${remove.length} records still inside the ${retentionDays}d window vanished at once ` +
      `(allowance ${allowance}); archived rather than deleted — that is a walk that missed them, ` +
      'not a deliberate deletion';
    return { archive: [...archive, ...remove], remove: [], withheld: remove.length, note };
  }

  return { archive, remove, withheld: 0, note: null };
}

export interface RetentionHealth {
  /** True when the live table contains nothing older than the window allows. */
  effective: boolean;
  /** Age in days of the oldest record Airtable still holds, or null if empty. */
  oldestLiveAgeDays: number | null;
  reason: string;
}

/**
 * Is the 30-day purge actually running?
 *
 * The automation is configured in Airtable and cannot be asserted from here, so
 * this asserts its *effect* instead: if it runs daily, nothing in the live table
 * is ever much older than the window. If it stops, the oldest record ages past
 * the boundary and keeps going, and this says so on every sync.
 *
 * That check is worth having because the automation has already been off once —
 * it shipped as a draft with an empty Run script node and had to be pasted in by
 * hand (`AIRTABLE_RETENTION.md`), and nothing in the product would have noticed.
 *
 * An empty table is reported as effective with no age: there is nothing to
 * prune, which is not evidence of failure.
 */
export function assessRetention(
  oldestLiveCreatedTime: string | null,
  now: number,
  retentionDays: number = AIRTABLE_RETENTION_DAYS,
): RetentionHealth {
  if (!oldestLiveCreatedTime) {
    return { effective: true, oldestLiveAgeDays: null, reason: 'no live records to prune' };
  }

  const created = Date.parse(oldestLiveCreatedTime);
  if (!Number.isFinite(created)) {
    return { effective: true, oldestLiveAgeDays: null, reason: 'oldest record carries no usable date' };
  }

  const ageDays = Math.floor((now - created) / DAY_MS);
  const limit = retentionDays + RETENTION_GRACE_DAYS;
  if (ageDays <= limit) {
    return {
      effective: true,
      oldestLiveAgeDays: ageDays,
      reason: `oldest live record is ${ageDays}d old, inside the ${retentionDays}d window`,
    };
  }

  return {
    effective: false,
    oldestLiveAgeDays: ageDays,
    reason:
      `oldest live record is ${ageDays}d old, past the ${retentionDays}d window` +
      ` — the Airtable purge may have stopped running`,
  };
}
