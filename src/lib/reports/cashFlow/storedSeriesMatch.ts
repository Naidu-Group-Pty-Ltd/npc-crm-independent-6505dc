/**
 * Is the projection on screen the one that is stored?
 *
 * ## Why this has to exist before the format can be templated
 *
 * Every other migrated format's delivery path reads the same stored record the
 * adapter reads, so the two agree by construction. This one does not.
 * `requestCashFlowPdf` takes the projection as an **argument**:
 * `CashFlowAnalysisModal` recomputes ten years in the browser from the report's
 * `manual_overrides` plus whatever the adviser has changed since the modal
 * opened, and sends that. `cashFlowAdapter` reads the stored
 * `financial_calculations.projections`, which is a different series whenever an
 * override exists.
 *
 * Routing blind would hand a client a document whose numbers are not the ones
 * the adviser was looking at while they sent it. A misread figure in a client's
 * financial report is this programme's top risk. So the template is offered
 * only when the two series are the same series, and this is the function that
 * decides.
 *
 * ## It is deliberately hard to satisfy
 *
 * The two failure modes are not symmetrical. Saying "different" when they match
 * costs a nicer layout. Saying "match" when they differ ships wrong figures
 * under the client's own letterhead. So every comparison below is exact, every
 * absence is a mismatch, and anything this cannot check is a mismatch:
 *
 *  - **The lengths must be equal**, so a stored series that still carries its
 *    settlement row does not half-match a ten-year one.
 *  - **Every field both sides state must be equal**: the year, the property
 *    value, the loan balance, and the rent (`annualRent` on the stored side,
 *    `rentalIncome` on the wire).
 *  - **The cash flow must correspond consistently.** The stored series carries
 *    one `cashFlow` per year and states no tax treatment — that is why the
 *    projection dropped the legacy "after tax" claim — while the wire carries
 *    both `preTaxAnnual` and `afterTaxAnnual`. So the stored figure must equal
 *    the *same one of the two* in every year of the series. This is the check
 *    that matters most: an interest-rate override moves the cash flow without
 *    moving the loan balance on an interest-only loan, so the three balance
 *    fields can agree while the document's headline figure does not.
 *  - **Exactly one scenario may match.** If two stored scenarios are identical
 *    series, routing would still have to pick a label — "Moderate" or
 *    "Optimistic" is printed on the page — and a document labelled with the
 *    wrong assumption is wrong even when its figures are right.
 *
 * What it does not compare is what neither side states twice: `equity`,
 * `cumulativeCashFlow` and `roi` exist only on the stored series and are
 * derived from the fields above within it, so a match on those fields is a
 * match on what the page draws from them.
 */
import type { WireProjection } from './requestCashFlowPdf';

export const STORED_SCENARIOS = ['conservative', 'moderate', 'optimistic'] as const;
export type StoredScenario = typeof STORED_SCENARIOS[number];

/**
 * Float noise, and nothing more.
 *
 * Both series are produced by the same calculator from the same inputs, so a
 * match is expected to be exact; this exists only so that a representation
 * difference in the last bit of a dollar figure does not read as an override.
 * A real change to an assumption moves these numbers by dollars or thousands,
 * never by a hundredth of a cent.
 */
const EPSILON = 0.01;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A stated number, or null. `null` never compares equal to anything. */
function stated(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function same(a: unknown, b: number): boolean {
  const value = stated(a);
  return value !== null && Math.abs(value - b) <= EPSILON;
}

/**
 * The stored scenario the on-screen series is, or null.
 *
 * Null covers every uncertainty: no stored projections, a shape that is not a
 * series, a length that differs, a field that is absent, a cash flow that
 * corresponds to neither column consistently, and the ambiguous case where more
 * than one scenario would match.
 */
export function matchStoredScenario(
  wire: Pick<WireProjection, 'years'> | null | undefined,
  row: { financial_calculations?: unknown } | null | undefined,
): StoredScenario | null {
  const years = wire?.years;
  if (!Array.isArray(years) || years.length === 0) return null;

  const financials = isRecord(row?.financial_calculations) ? row!.financial_calculations : null;
  const projections = financials && isRecord(financials.projections) ? financials.projections : null;
  if (!projections) return null;

  const matched = STORED_SCENARIOS.filter((scenario) => {
    const series = projections[scenario];
    if (!Array.isArray(series) || series.length !== years.length) return false;

    // Which of the wire's two cash-flow columns the stored one is. Decided by
    // the first year and then required of every year, so a series that happens
    // to agree in year one and diverges in year two is not a match.
    let column: 'preTaxAnnual' | 'afterTaxAnnual' | null = null;

    return series.every((raw, i) => {
      if (!isRecord(raw)) return false;
      const year = years[i];

      if (!same(raw.year, year.year)) return false;
      if (!same(raw.propertyValue, year.propertyValue)) return false;
      if (!same(raw.loanBalance, year.loanBalance)) return false;
      if (!same(raw.annualRent, year.rentalIncome)) return false;

      if (column === null) {
        if (same(raw.cashFlow, year.preTaxAnnual)) column = 'preTaxAnnual';
        else if (same(raw.cashFlow, year.afterTaxAnnual)) column = 'afterTaxAnnual';
        else return false;
        return true;
      }
      return same(raw.cashFlow, year[column]);
    });
  });

  return matched.length === 1 ? matched[0] : null;
}
