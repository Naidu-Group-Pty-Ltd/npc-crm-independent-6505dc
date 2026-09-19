/**
 * Run independent async work N-at-a-time, and never lose one item to another's
 * failure.
 *
 * ## Why this exists
 *
 * Every GoHighLevel / Microsoft Graph sync in this repository walked its work
 * with a plain `for` loop and an `await` in the body, so N independent network
 * requests were issued strictly one after another. Several then added a fixed
 * `delay(500)` between iterations to stay under a vendor rate limit, which
 * turned the loop into a sleep with a fetch attached: measured on the clone,
 * `sync-ghl-conversations` averaged 78.5s and peaked at 98.4s against a 120s
 * declared timeout, and at 500ms per contact a 95s budget can reach at most
 * 190 of the prime's 776 clients before it has to stop and be called again.
 *
 * A fixed sleep is the wrong instrument twice over. It is *too slow* when the
 * vendor is idle, and it is *not a limit* at all when two invocations overlap —
 * two isolates each sleeping 500ms still issue 4 req/s together. Pacing belongs
 * in a shared limiter that counts (`ghl-rate-limiter.ts` already does this, in
 * Postgres, cooperatively); this module supplies the other half, which is
 * letting independent requests overlap at all.
 *
 * ## What it guarantees
 *
 * **Results come back in input order**, whatever order they finish in, so a
 * caller can zip them against the input without carrying an index.
 *
 * **One item's failure is that item's failure.** Every result is settled —
 * `{ value }` or `{ error }` — because the loops this replaces all wrapped
 * their body in try/catch and pushed onto an `errors` array. `Promise.all`
 * would have changed that: a single rejected contact would discard every
 * sibling's work, including the ones already written. A batch that reports
 * "8 of 10 synced, 2 named" is the behaviour these functions already had, and
 * losing it would be a regression dressed as a speed-up.
 *
 * **Work already started always finishes.** `stop` is asked before a task is
 * STARTED and never cancels one in flight, because these callers write to the
 * database inside the task: cancelling mid-flight would leave a conversation
 * row with no messages and no record that it was short. A wall-clock budget
 * therefore drains rather than truncates, which is why the caller's own
 * deadline must leave room for the slowest in-flight item — the same reason
 * `sync-ghl-conversations` reserves 25s of its 120s.
 */

export interface SettledResult<TItem, TValue> {
  /** The input, so a caller never has to re-derive which one this was. */
  readonly item: TItem;
  /** Position in the input array. Results are returned in this order. */
  readonly index: number;
  /** Present when the task resolved. */
  readonly value?: TValue;
  /** Present when the task threw. Always a string — an Error is flattened. */
  readonly error?: string;
}

export interface ConcurrencyOptions {
  /**
   * Asked before each task STARTS. Returning true stops new work; everything
   * already running is still awaited. Items never started are returned with
   * neither `value` nor `error`, and `startedCount` says where to resume.
   */
  readonly stop?: () => boolean;
}

export interface ConcurrencyOutcome<TItem, TValue> {
  /** One entry per input, in input order. */
  readonly results: SettledResult<TItem, TValue>[];
  /**
   * How many tasks were started. Equals `items.length` unless `stop` fired.
   *
   * This is a COUNT, not an index into the results — it is what a resumable
   * caller adds to its cursor, and the reason `stop` is only consulted at the
   * head of the queue: with out-of-order completion there is no single index
   * that means "everything before here is done", but "the first N were all
   * started" stays true because tasks are started in order.
   */
  readonly startedCount: number;
  readonly succeeded: number;
  readonly failed: number;
}

const messageOf = (e: unknown): string =>
  e instanceof Error
    ? e.message
    : typeof e === "string"
      ? e
      : JSON.stringify(e ?? "unknown error");

/**
 * @param items  the work, in the order it should be started
 * @param limit  how many may be in flight at once; clamped to at least 1
 * @param fn     the task; may throw, and its throw is confined to its own item
 */
export async function mapWithConcurrency<TItem, TValue>(
  items: readonly TItem[],
  limit: number,
  fn: (item: TItem, index: number) => Promise<TValue>,
  opts: ConcurrencyOptions = {},
): Promise<ConcurrencyOutcome<TItem, TValue>> {
  const width = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 1));
  const results: SettledResult<TItem, TValue>[] = items.map((item, index) => ({
    item,
    index,
  }));

  let next = 0;
  let startedCount = 0;
  let succeeded = 0;
  let failed = 0;

  // Each worker pulls the next index until the queue is empty or `stop` fires.
  // `next` is only ever read-then-incremented synchronously, and JavaScript
  // runs this to completion before any await, so two workers cannot take the
  // same index without a lock.
  const worker = async (): Promise<void> => {
    for (;;) {
      if (opts.stop?.()) return;
      const index = next;
      if (index >= items.length) return;
      next += 1;
      startedCount += 1;

      try {
        const value = await fn(items[index], index);
        results[index] = { item: items[index], index, value };
        succeeded += 1;
      } catch (e) {
        results[index] = { item: items[index], index, error: messageOf(e) };
        failed += 1;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, worker),
  );

  return { results, startedCount, succeeded, failed };
}

/** The values that resolved, in input order, with failures dropped. */
export function valuesOf<TItem, TValue>(
  outcome: ConcurrencyOutcome<TItem, TValue>,
): TValue[] {
  const out: TValue[] = [];
  for (const r of outcome.results)
    if (r.error === undefined && r.value !== undefined) out.push(r.value);
  return out;
}
