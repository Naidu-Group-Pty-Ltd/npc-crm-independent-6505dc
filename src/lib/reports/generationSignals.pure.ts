/**
 * The two signals the floating generation-progress widget and the in-page
 * regeneration hook send each other.
 *
 * They are two drivers of the same work. `ReportGenerationProgress` discovers
 * reports by polling and can pump one forward itself; `useChunkedRegeneration`
 * drives a regeneration the operator started on this page. Neither could see
 * the other, which cost one control at each end:
 *
 *   • **Started** — nothing announces a generation, so the widget found a
 *     regeneration begun in this very tab only on its next poll, up to 30s
 *     later on the idle backoff. The operator's own click is the one start
 *     that need not be waited for. (A start in another tab, or by the bulk
 *     runner, is still discovered only by asking — which is why the idle
 *     ceiling stays where it is.)
 *
 *   • **Cancelled** — the widget's Stop marks the row `failed` and nothing
 *     else. The hook's section loop never reads the row, so it kept calling
 *     the generator and the next section wrote the row straight back to
 *     `processing`: Stop moved a badge for one poll. The hook has had an
 *     `abort()` since it was written and no caller anywhere; this is its
 *     caller.
 *
 * Both names are spelled here and imported at each end, because a literal at
 * each end is how two ends drift.
 */

import { rowHoldsCompleteDocument, type ReportRunRow } from './investment/failureStamp.pure';

/**
 * A report in THIS tab just went in flight server-side.
 *
 * Carries `ReportGenerationStartedDetail` — the id, and the instant the RUN
 * began. The instant is the load-bearing half. The progress widget used to
 * time a run from `investment_reports.created_at`, which is the report's
 * birthday rather than the run's start: on a regeneration the row is reused,
 * so a run two minutes old announced `3h 30m elapsed` (measured, 97 Poole
 * Road, 20 Sep 2026). Nothing was frozen — the widget ticks every second and
 * always did — the origin was simply the wrong event.
 *
 * Deliberately not a new column. `report_generation_runs.started_at` already
 * records this server-side; what the widget lacked was a cheap way to know it
 * without a per-poll join, and the run it is watching is usually the run this
 * tab just started. Where a tab did NOT start the run — a cron resume, a bulk
 * job, a reload mid-flight — the start is genuinely unknown and the widget
 * prints no elapsed at all, because the report's age is not the run's duration
 * and a wrong number is worse than none.
 */
export const REPORT_GENERATION_STARTED_EVENT = 'report-generation-started';

export interface ReportGenerationStartedDetail {
  reportId: string;
  /** `Date.now()` at the moment the row went `processing` for THIS run. */
  startedAt: number;
}

/** The operator stopped a report. Carries the report id and reason in `detail`. */
export const REPORT_GENERATION_CANCELLED_EVENT = 'report-generation-cancelled';

export interface ReportGenerationCancelledDetail {
  reportId: string;
  /** What to record against the row, e.g. `Cancelled by <user>`. */
  reason: string;
}

/** What a stop records when the signal carried no reason of its own. */
export const DEFAULT_CANCELLATION_REASON = 'Generation stopped';

/**
 * The stopped report's id, or null when the event carries none.
 *
 * Read defensively and compared by the listener: a hook instance must abort
 * only its OWN run. Several are mounted at once — every report card carries a
 * Regenerate button — so treating a detail-less event as "cancel whatever you
 * are doing" would have one card's Stop abort another card's regeneration.
 */
export function cancelledReportId(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const id = (detail as { reportId?: unknown }).reportId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * The reason to record against the stopped row, never empty.
 *
 * The stop is re-asserted by whoever stops last (see the hook), and a row that
 * reads `failed` with no reason is indistinguishable from one that broke.
 */
export function cancellationReason(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return DEFAULT_CANCELLATION_REASON;
  const reason = (detail as { reason?: unknown }).reason;
  return typeof reason === 'string' && reason.trim().length > 0
    ? reason.trim()
    : DEFAULT_CANCELLATION_REASON;
}

/**
 * Whether a client that has just thrown may record the row as failed.
 *
 * The regeneration hook's catch writes `status: 'failed'` unconditionally, and
 * that is how a finished document came to be presented as a failure twice in
 * two days. The first time the client's own section count was wrong (fixed at
 * source in `sectionCountForTier`). The second time two pumps drove one report
 * and the loser threw on a row the winner had already carried to 14 of 14 —
 * measured on 97 Poole Road, 20 Sep 2026, where the run reported `Failed` at
 * `14/14 sections · 100%` beside a `report_content` of 128,126 characters.
 *
 * So the stamp is now a statement about the ROW rather than about this
 * client's own run: a report the server calls `completed`, or one whose banked
 * sections meet the total the server itself stated, is not failed however
 * badly this particular caller ended.
 *
 * It fails VISIBLE, not closed. A row that could not be read at all still
 * records the failure, because a run that threw with its state unknown must
 * not be left looking healthy — an unreadable row is the one case where the
 * old unconditional behaviour is still the right one.
 *
 * Except where the state is NOT unknown. On 24 Sep 2026 60 Lawley Street
 * finished — the generator's own answer to this run said `isComplete: true`
 * and it had written the row `completed` — and a three-second platform 503 on
 * the two reads that followed was taken as "state unknown" and stamped the
 * finished document failed. An unreadable row is not evidence against what
 * the server already said, so `context.serverReportedComplete` refuses the
 * stamp. And a run that failed before it wrote anything — the kickoff read,
 * the start write — leaves the row exactly as it found it, perhaps mid-run
 * under a different driver, so `context.wroteNothing` refuses it too.
 *
 * The completeness reading is `rowHoldsCompleteDocument`, the rule
 * `manage-investment-reports` now enforces as well: the browser asks, and the
 * server, which can always read the row, refuses a stamp over a finished
 * document whatever a browser — this build or an older one — sends.
 */
export interface RunFailureContext {
  /**
   * The server already said this run's document is complete: the generator
   * answered `isComplete`, or the kickoff read found every section banked.
   */
  serverReportedComplete?: boolean;
  /** The run failed before it wrote anything to the row. */
  wroteNothing?: boolean;
}

export function shouldMarkRunFailed(
  row: ReportRunRow | null | undefined,
  context: RunFailureContext = {},
): boolean {
  if (context.wroteNothing) return false;
  if (row) return !rowHoldsCompleteDocument(row);
  return !context.serverReportedComplete;
}
