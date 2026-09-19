/**
 * One annual rent, and the basis it is stated on.
 *
 * ## The defect this exists to end
 *
 * A property earns a weekly rent. Turning that into an annual figure needs a
 * number of weeks, and this product had two answers in play at once without
 * ever saying which was which.
 *
 * `reportBindingProjection` published `annualRent = weeklyRent ×
 * occupancyWeeks` — the report's own occupancy assumption, deliberately, and
 * `financialChapters.rentalAndYield` copied the same derivation on purpose so
 * that "this table and the verdict page's tiles state the same annual
 * figure". They did. And both disagreed with the **yield printed beside
 * them**.
 *
 * Measured 2026-09-07 on `1/27D Mitchell Street` (a real, current record),
 * the composed rental table reads:
 *
 * > | Weekly rent | $600 |
 * > | Annual rent (50 occupied weeks) | $30,000 |
 * > | Gross rental yield | 5.67% |
 *
 * $30,000 ÷ $550,000 is **5.45%**. The 5.67% is $31,200 ÷ $550,000 — the rent
 * at 52 weeks. Two rows apart, in one four-row table, on the deterministic
 * path. Nothing a model wrote.
 *
 * ## What the record actually says
 *
 * Measured across the completed corpus:
 *
 * | question | answer |
 * | --- | ---: |
 * | reports storing `income.annualRent` where it equals `weeklyRent × 52` | 18 of 18 |
 * | ... where it equals `weeklyRent × occupancyWeeks` | 0 of 18 |
 * | reports whose stored `grossRentalYield` rests on `weeklyRent × 52` | 149 of 153 |
 * | reports with `occupancyWeeks < 52` whose yield is still on 52 | 61 of 62 |
 *
 * So the record is not ambiguous: **the annual rent is the contractual rent,
 * and the yield rests on it.** 62 of 153 reports carry an occupancy
 * assumption below 52, and on every one of them the published annual rent was
 * a third quantity agreeing with neither — off by $1,832 on average and
 * $2,600 at worst.
 *
 * ## The rule
 *
 * Both quantities are real and a client wants both. What is not allowed is
 * stating one under the other's name. So this module returns them separately
 * and names each:
 *
 *  - **`contractual`** — the rent the lease is for, `weeklyRent × 52`, or the
 *    record's own `income.annualRent` where it carries one. This is the figure
 *    a yield rests on, and the one that belongs beside a weekly rent under a
 *    bare "p.a.".
 *  - **`atOccupancy`** — what the assumption says will actually be collected.
 *    Present only when the report carries an occupancy assumption that is not
 *    52, because otherwise it is the same number and a second row saying so is
 *    noise.
 *
 * A caller may print either. It may not print `atOccupancy` labelled `Annual
 * rent`, which is what both callers did.
 *
 * Nothing here recomputes a yield. The stored yield is the authority for the
 * yield; this only stops the rent printed beside it from contradicting it.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** A lease year. The occupancy assumption is measured against this. */
export const WEEKS_PER_LEASE_YEAR = 52;

export interface AnnualRentReading {
  /**
   * The contractual annual rent — `weeklyRent × 52`, or the record's own
   * `income.annualRent`. Undefined when the record establishes no rent.
   */
  contractual: number | undefined;
  /**
   * The rent the report's own occupancy assumption expects to collect.
   * Undefined when there is no assumption, or it is 52, or there is no weekly
   * rent to apply it to — in each case `contractual` already says it.
   */
  atOccupancy: number | undefined;
  /** The assumption itself, when the report carries one. */
  occupiedWeeks: number | undefined;
  /** `Annual rent at 50 occupied weeks` — the label `atOccupancy` must carry. */
  occupancyLabel: string | undefined;
}

/**
 * Read both annual rents from a `financial_calculations` block's `income` and
 * `assumptions`.
 *
 * Takes the two sub-objects rather than the whole block so a caller that has
 * already destructured them (both current callers have) does not have to
 * rebuild one.
 */
export function readAnnualRent(income: unknown, assumptions: unknown): AnnualRentReading {
  const inc = isRecord(income) ? income : {};
  const asm = isRecord(assumptions) ? assumptions : {};

  const weeklyRent = num(inc.weeklyRent);
  const storedAnnual = num(inc.annualRent);
  const occupiedWeeks = num(asm.occupancyWeeks);

  // The record's own annual rent wins where it has one: it is what the
  // calculator wrote and what the stored yield was computed from. Where it has
  // none, 52 weeks of the weekly rent is the same quantity.
  const contractual = storedAnnual !== undefined
    ? storedAnnual
    : weeklyRent !== undefined
      ? Math.round(weeklyRent * WEEKS_PER_LEASE_YEAR)
      : undefined;

  const adjusted = weeklyRent !== undefined
    && occupiedWeeks !== undefined
    && occupiedWeeks !== WEEKS_PER_LEASE_YEAR
    ? Math.round(weeklyRent * occupiedWeeks)
    : undefined;

  return {
    contractual,
    atOccupancy: adjusted,
    occupiedWeeks,
    occupancyLabel: adjusted === undefined
      ? undefined
      : `Annual rent at ${occupiedWeeks} occupied weeks`,
  };
}
