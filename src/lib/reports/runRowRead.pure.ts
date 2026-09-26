/**
 * Reading the report row after a run, and telling a read that FAILED apart
 * from an answer.
 *
 * ## Why this exists
 *
 * The regeneration hook's last act is a status read: did the record end the
 * run holding every section? It destructured `{ data }`, dropped the `error`,
 * and compared `Number(data?.report?.last_completed_section) >= total`. When
 * the read failed, `data.report` was undefined, the comparison was `NaN >= 16`
 * — false — and the hook threw "the record holds 0 of 16 sections" about a
 * record it had never seen.
 *
 * That happened on 24 Sep 2026 (60 Lawley Street, Spalding). The generator had
 * banked 16 of 16 sections and written the row `completed`; three seconds later
 * the Supabase edge runtime answered HTTP 503 `SUPABASE_EDGE_RUNTIME_SERVICE_
 * DEGRADED` in six milliseconds — before any worker saw the request — and that
 * one read decided the run. See `failureStamp.pure.ts` for what the failure
 * stamp then did.
 *
 * Three rules, each paid for elsewhere in this repository first:
 *
 *  - **A read that failed is not a row that is absent.** `unreadable` is its
 *    own answer, never `0 of N`.
 *  - **A transient failure is asked again before anything is concluded.** The
 *    window measured on 24 Sep was about three seconds; the delays below span
 *    more than twice that. A 4xx other than 408/429 is an answer about the
 *    request, not a blip, and is not repeated; nor is our own timeout, which
 *    has already spent the time a repeat would buy.
 *  - **Where the row cannot be read, what the server already said stands.**
 *    The generator's own `isComplete` answer to this very run is a statement
 *    from the server about the document; a status read that could not be made
 *    afterwards does not overrule it. The row, when it CAN be read, is the
 *    authority — including against that answer, because a second pump can
 *    rewind a counter the generator reported complete.
 */

import { rowHoldsCompleteDocument, type ReportRunRow } from './investment/failureStamp.pure';

/** The part of `invokeSecureFunction`'s error this module reads. */
export interface RowReadError {
  message?: string;
  status?: number;
  network?: boolean;
  retryable?: boolean;
  /** `provider_timeout` is how `invokeSecureFunction` names its own abort. */
  code?: string;
}

export type RowReadResult<T> =
  /** The server answered with the row. */
  | { kind: 'row'; row: T }
  /** The server answered and holds no such row. */
  | { kind: 'absent' }
  /** Every attempt failed; nothing is known about the row. */
  | { kind: 'unreadable'; error: RowReadError };

/**
 * Pauses before each repeat. Three repeats spanning 8.5s, against a measured
 * outage of about 3s — enough to outlast a blip, short enough that a person
 * watching the widget is not left waiting on a run that is over.
 */
export const TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [1000, 2500, 5000];

/** Whether an error is the platform failing to answer rather than an answer. */
export function isTransientReadError(error: RowReadError | null | undefined): boolean {
  if (!error) return false;
  if (error.network === true || error.retryable === true) return true;
  const status = Number(error.status) || 0;
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Whether a failure is worth asking again: transient, and not our own
 * timeout. The incident's 503 came back in 6 ms; a call that already waited
 * out its whole timeout has spent the time a repeat would buy, and repeating
 * it would hold a person at the end of a run for minutes in a real outage.
 */
export function isRepeatableFailure(error: RowReadError | null | undefined): boolean {
  return isTransientReadError(error) && error?.code !== 'provider_timeout';
}

type Attempt = () => Promise<{ data: unknown; error: RowReadError | null }>;

/**
 * Read the row, repeating a transient failure, and say which of three things
 * happened. `attempt` is one call of the read; it may throw, which counts as a
 * network failure.
 */
export async function readRunRow<T = ReportRunRow>(
  attempt: Attempt,
  opts: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RowReadResult<T>> {
  const delays = opts.delaysMs ?? TRANSIENT_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: RowReadError = { message: 'The read was not attempted.' };
  for (let i = 0; i <= delays.length; i++) {
    if (i > 0) await sleep(delays[i - 1]);
    let result: { data: unknown; error: RowReadError | null };
    try {
      result = await attempt();
    } catch (e) {
      result = { data: null, error: { message: e instanceof Error ? e.message : String(e), network: true } };
    }
    if (!result.error) {
      const row = (result.data as { report?: unknown } | null | undefined)?.report;
      return row && typeof row === 'object' ? { kind: 'row', row: row as T } : { kind: 'absent' };
    }
    lastError = result.error;
    if (!isRepeatableFailure(result.error)) break;
  }
  return { kind: 'unreadable', error: lastError };
}

export type RunOutcome =
  /** The row holds every section; `confirmed` is false when it could not be read and the server's own answer stands. */
  | { kind: 'complete'; confirmed: boolean; done: number | null; required: number; currentVersion: unknown }
  /** The row was read and is short of its sections. */
  | { kind: 'incomplete'; done: number; required: number }
  /** The row could not be read, or is gone, and nothing the server said settles it. */
  | { kind: 'unknown'; reason: 'unreadable' | 'absent'; error?: RowReadError };

/**
 * What a finished run amounts to, from the row read after it.
 *
 * `fallbackTotal` is the client's own section count, used only where the row
 * has not stated a total — the row's own `total_sections` wins wherever it is
 * stated, because completion is the SERVER'S arithmetic (see the hook).
 */
export function settleRunOutcome(
  read: RowReadResult<ReportRunRow & { current_version?: unknown }>,
  ctx: { serverReportedComplete: boolean; fallbackTotal: number },
): RunOutcome {
  if (read.kind === 'row') {
    const row = read.row;
    const stated = Number(row.total_sections) || 0;
    const required = stated > 0 ? stated : ctx.fallbackTotal;
    const done = Number(row.last_completed_section) || 0;
    if (rowHoldsCompleteDocument(row) || (required > 0 && done >= required)) {
      return { kind: 'complete', confirmed: true, done, required, currentVersion: row.current_version };
    }
    return { kind: 'incomplete', done, required };
  }
  if (ctx.serverReportedComplete) {
    return { kind: 'complete', confirmed: false, done: null, required: ctx.fallbackTotal, currentVersion: undefined };
  }
  return read.kind === 'unreadable'
    ? { kind: 'unknown', reason: 'unreadable', error: read.error }
    : { kind: 'unknown', reason: 'absent' };
}
