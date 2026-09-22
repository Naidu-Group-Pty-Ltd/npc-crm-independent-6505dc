/**
 * One numeric cell, read out of one register row.
 *
 * ## Why this module exists
 *
 * A register row arrives from PostgREST, and PostgREST answers for a column
 * that is **not in the projection** exactly as it answers for one that is
 * empty: the key is simply absent, so the property reads `undefined`. That is
 * the class `scripts/security/check-edge-column-names.mjs` exists for, and it
 * has already cost this repository `investment_reports.client_id`,
 * `market_updates.summary`, `custom_users.role_display` and
 * `aml.cases.tenant_id` — every one of which reported as normal, empty
 * operation.
 *
 * A guard written as `=== null` does not see it. `Number(undefined)` is
 * **NaN**, `NaN === null` is false, and `0 + undefined` is NaN — so NaN walks
 * past every downstream absence check and reaches the formatter. Measured
 * 22 Sep 2026, by rendering the Supply section's evidence block against the
 * register's real depth rather than reading the source: the money column
 * printed `$NaN`.
 *
 * Three more things this closes, each one already paid for somewhere:
 *
 *  - **`Number('')` is 0.** The urban-centre register recorded that: a feature
 *    with no point parsed as `(0, 0)` and was stopped only by the continent
 *    bounds. An empty cell is an absence, never a zero.
 *  - **A `numeric` column arrives as a STRING** from supabase-js, so a reader
 *    that only accepts `typeof v === 'number'` discards every real figure.
 *  - **An absence travels as an absence** — `rentalEvidence`'s and
 *    `placesAvailability`' rule, *absent is never zero* — and NaN is neither a
 *    figure nor an absence, which makes it the worst of the three.
 *
 * ## Why `null` and not `undefined`
 *
 * This is the fourth statement of this rule in the repository and the first
 * shared one. The other three are:
 *
 *  - `overrides.pure.ts`' `toFiniteNumber` — correct, returns `undefined`,
 *    because an override that was not supplied is an absent KEY;
 *  - `borrowingCapacityProjection.pure.ts`' `num` — correct, same reason;
 *  - the two register readers that adopted this module — both of which were
 *    WRONG, in the same way, on paths that print a figure in a client's
 *    document.
 *
 * A register row's absent measure is `null`, not `undefined`: that is what the
 * column holds, what a suppressed publisher cell means (*"a suppressed median
 * is null, never zero"*), and what every consumer of these rows already
 * branches on. Two returns for two different questions is deliberate; one
 * function coerced into serving both is how a caller gets the other one's
 * answer.
 *
 * Deno-parsed: no `@/` aliases, explicit `.ts` extensions.
 */

/**
 * The cell's value where it IS a finite number, and `null` in every other
 * case — absent, null, empty, blank, or something that does not parse.
 *
 * Never throws, because a register read must not fail over one cell: the row
 * is still evidence about every other column it carries.
 */
export function finiteOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
