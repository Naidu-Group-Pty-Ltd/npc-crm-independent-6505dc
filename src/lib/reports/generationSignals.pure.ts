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

/** A report in THIS tab just went in flight server-side. Carries no detail. */
export const REPORT_GENERATION_STARTED_EVENT = 'report-generation-started';

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
