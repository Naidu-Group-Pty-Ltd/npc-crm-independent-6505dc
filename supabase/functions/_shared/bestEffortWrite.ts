/**
 * A write that must never fail the act it records.
 *
 * An audit row, a usage counter, a "last seen" stamp — work that is worth
 * attempting and never worth failing for. The obvious way to write that is
 * also broken:
 *
 *     await supabase.from('client_activity_log').insert({ … }).catch(() => {});
 *
 * A PostgREST query builder is a **Thenable, not a Promise**. It implements
 * `then()` — which is why `await` works on it — and implements neither
 * `catch()` nor `finally()`. So `.catch(…)` is `undefined`, calling it throws
 * `TypeError: supabase.from(...).insert(...).catch is not a function`, and the
 * handler's own catch block turns that into a 500.
 *
 * The irony is the point: the code exists to stop an optional write failing
 * the request, and it is the thing that fails the request. Worse, it throws
 * AFTER the work is done, so the caller sees an error about an operation that
 * actually succeeded.
 *
 * This broke "View as Client" in both directions at once.
 * `staff-client-portal-handoff-create` minted a valid handoff token, wrote it,
 * and then threw on its audit line — the operator got "Internal error" and the
 * token was orphaned. `finance-portal-handoff-redeem` carried the same line on
 * its STAFF branch only (the finance-partner branch below it is written
 * plainly and has always worked), so a staff handoff consumed its one-time
 * token, minted the portal session, and then threw — burning the link, with no
 * way to retry.
 *
 * `await` inside `try` works on a thenable, which is the whole fix. It is here
 * rather than inlined so the rule has a name, and so a failure is logged
 * rather than swallowed in silence: "best effort" should still leave a trace
 * when it does not succeed.
 */
export async function bestEffort(
  work: PromiseLike<{ error?: unknown } | unknown>,
  context: string,
): Promise<void> {
  try {
    const result = (await work) as { error?: unknown } | null;
    // PostgREST reports a failed write in `error` rather than by throwing, so
    // a swallowed rejection is not the only way this goes quietly wrong.
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      console.warn(`[bestEffort] ${context} did not write`, result.error);
    }
  } catch (err) {
    console.warn(`[bestEffort] ${context} threw`, err);
  }
}
