/**
 * When a report was generated — one rule, read by every surface that prints
 * a report's date.
 *
 * ## The defect
 *
 * Every card, the package header, the table, the report page and the
 * comparison basket printed `created_at`. That column is set once, when the
 * row is inserted, and a regeneration REUSES the row: the archive trigger
 * copies the old content into `report_versions` and bumps `current_version`,
 * and `created_at` never moves. So on 25 Sep 2026 the library said
 * "Latest Sep 24, 2026, 11:46 AM · completed" over 60 Lawley Street, Spalding,
 * a report regenerated that afternoon, beside "Version 7". Blacktown and
 * Schofields showed the evening of the 24th though both were regenerated on
 * the morning of the 25th.
 *
 * ## What the record holds
 *
 * - `data_sources._generationQuality.generatedAt` — written by the final write
 *   of `generate-investment-report` at the moment a generation completes, and
 *   every generation since 30 Dec 2025 carries it. Within the generator only
 *   that write touches `data_sources`, so it describes the LATEST completed
 *   generation.
 * - `variant_generated_at` — written by `fork-investment-report` and
 *   `condense-investment-report` each time a child report is (re)drawn.
 * - `updated_at` — trigger-stamped on EVERY write, so it is "last touched",
 *   not "generated". It moves when an override is saved or a report is
 *   archived. It is read only for a report that is not complete, where
 *   the row's content is the partial output of the attempt in progress (or of
 *   the attempt that failed) and its latest activity is the honest time.
 *
 * ## The rule
 *
 * A complete report is dated by the latest generation stamp it carries, and
 * by `created_at` where it carries none. A report that is not complete is
 * dated by its latest activity. A stamp earlier than the row itself is
 * ignored: a condensed child may carry its parent's stamp in a copied
 * `data_sources`, and that describes the parent.
 *
 * The server resolves it once (`get-investment-reports` publishes
 * `generated_at` and `generated_at_basis`). The browser reads what the server
 * resolved, and resolves the same way from the raw stamps where a row reached
 * it by another route.
 */

/** What a date was read from. */
export type GeneratedAtBasis =
  /** A generation stamp: the moment a generation of this report completed. */
  | 'generation'
  /** A report that is not complete: its latest activity. */
  | 'activity'
  /** Nothing better recorded: when the row was created. */
  | 'created';

export interface GeneratedAtReading {
  /** ISO 8601, exactly as recorded. */
  at: string;
  basis: GeneratedAtBasis;
}

/** The columns (and the one projection alias) the rule reads. */
export interface GenerationStampRow {
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  variant_generated_at?: unknown;
  /** `get-investment-reports`' alias of `data_sources->_generationQuality->>generatedAt`. */
  generation_completed_at?: unknown;
  /** The whole object, where a projection carries it. */
  data_sources?: unknown;
  /** Already resolved by the server. */
  generated_at?: unknown;
  generated_at_basis?: unknown;
}

/**
 * What the rule accepts: a typed row, or a row as an Edge Function holds it
 * (`Record<string, unknown>`, which shares no declared field with the
 * interface and so would otherwise fail TypeScript's weak-type check).
 */
export type GenerationStampSource = GenerationStampRow | Record<string, unknown> | null | undefined;

interface Instant {
  at: string;
  ms: number;
}

function instant(value: unknown): Instant | null {
  if (typeof value !== 'string') return null;
  const at = value.trim();
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? { at, ms } : null;
}

function completedStampOf(dataSources: unknown): unknown {
  if (!dataSources || typeof dataSources !== 'object' || Array.isArray(dataSources)) return undefined;
  const quality = (dataSources as Record<string, unknown>)._generationQuality;
  if (!quality || typeof quality !== 'object' || Array.isArray(quality)) return undefined;
  return (quality as Record<string, unknown>).generatedAt;
}

const BASES: readonly GeneratedAtBasis[] = ['generation', 'activity', 'created'];

/**
 * Is the report complete? A missing status is treated as complete, as every
 * surface already did (`status || 'completed'`).
 */
function isComplete(status: unknown): boolean {
  if (typeof status !== 'string' || !status.trim()) return true;
  return status.trim().toLowerCase() === 'completed';
}

/** Resolve from the raw stamps. Null only where the row records no time at all. */
export function resolveReportGeneratedAt(source: GenerationStampSource): GeneratedAtReading | null {
  if (!source) return null;
  const row = source as GenerationStampRow;
  const created = instant(row.created_at);
  const notBeforeCreation = (i: Instant | null): Instant | null =>
    i && (!created || i.ms >= created.ms) ? i : null;

  if (!isComplete(row.status)) {
    const activity = notBeforeCreation(instant(row.updated_at));
    if (activity) return { at: activity.at, basis: 'activity' };
    return created ? { at: created.at, basis: 'created' } : null;
  }

  const stamps = [
    instant(row.generation_completed_at),
    instant(completedStampOf(row.data_sources)),
    instant(row.variant_generated_at),
  ]
    .map(notBeforeCreation)
    .filter((i): i is Instant => i !== null);
  if (stamps.length) {
    const latest = stamps.reduce((a, b) => (b.ms > a.ms ? b : a));
    return { at: latest.at, basis: 'generation' };
  }
  return created ? { at: created.at, basis: 'created' } : null;
}

/**
 * The date to print for a report: what the server resolved where it resolved
 * one, otherwise the same rule over the raw stamps.
 */
export function reportGeneratedAt(source: GenerationStampSource): GeneratedAtReading | null {
  if (!source) return null;
  const row = source as GenerationStampRow;
  const server = instant(row.generated_at);
  if (server) {
    const basis = BASES.includes(row.generated_at_basis as GeneratedAtBasis)
      ? (row.generated_at_basis as GeneratedAtBasis)
      : 'generation';
    return { at: server.at, basis };
  }
  return resolveReportGeneratedAt(row);
}

/** Milliseconds, for sorting; a row with no time sorts last. */
export function reportGeneratedAtMs(source: GenerationStampSource): number {
  const reading = reportGeneratedAt(source);
  const ms = reading ? Date.parse(reading.at) : NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * The word in front of the date. A report still being written, or one whose
 * last attempt failed, has not been "generated" at that time. It was last
 * updated then.
 */
export function generatedAtLabel(basis: GeneratedAtBasis | null | undefined): 'Generated' | 'Last updated' {
  return basis === 'activity' ? 'Last updated' : 'Generated';
}
