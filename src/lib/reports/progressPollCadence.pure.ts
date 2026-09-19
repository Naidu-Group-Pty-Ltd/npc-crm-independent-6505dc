/**
 * How often the generation-progress widget asks the server for news.
 *
 * It asked every 3 seconds, per open tab, for ever — whatever the answer.
 * Measured in production over one day (2026-09-01): two idle dashboards made
 * **13,679 calls** to `get-investment-reports`' `generationProgress`
 * projection, every one answering `returnedCount: 0`, at ~1.2s of database
 * time each — about 4.5 database-hours spent saying "nothing is generating",
 * and the only four 5xx that projection returned all day were this poll
 * hitting resource limits.
 *
 * The widget cannot simply stop when idle: nothing announces a generation —
 * a job started in another tab, or by the bulk runner, is discovered only by
 * asking. So the cadence adapts instead:
 *
 *   • While the last answer held rows, every 3 seconds — live progress is the
 *     widget's whole point, and a section lands roughly every 25 seconds.
 *   • After a run of empty answers, back off: three quick confirmations, then
 *     15s, then a 30s ceiling. A report generates for five to ten minutes, so
 *     discovering one at most 30 seconds late is invisible in practice —
 *     while an idle tab drops from 28,800 requests a day to under 3,000.
 *   • A tab becoming visible again polls immediately (the caller resets the
 *     clock), because the person just looked.
 *
 * The transient-error backoff and the auth circuit breaker are separate
 * concerns and untouched: they gate on failure, this paces success.
 */

/** The cadence while something is generating. */
export const ACTIVE_POLL_MS = 3_000;

/** The idle ceiling. A generation runs minutes; half a minute late is unseen. */
export const IDLE_POLL_MAX_MS = 30_000;

/**
 * Delay until the next poll, given how many consecutive answers were empty.
 *
 * 0 empties (rows just now) → 3s. 1-3 empties → 3s, so a job that finished a
 * moment ago is confirmed gone quickly. 4-5 → 15s. Beyond → the 30s ceiling.
 */
export function nextPollDelayMs(consecutiveEmptyPolls: number): number {
  const empties = Number.isFinite(consecutiveEmptyPolls)
    ? Math.max(0, Math.floor(consecutiveEmptyPolls))
    : 0;
  if (empties <= 3) return ACTIVE_POLL_MS;
  if (empties <= 5) return 15_000;
  return IDLE_POLL_MAX_MS;
}
