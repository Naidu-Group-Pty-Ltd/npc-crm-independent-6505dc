/**
 * One definition per figure — the derived property metrics every report quotes.
 *
 * ## Why this module exists
 *
 * Measured across the tree on 2026-09-07: gross yield is computed
 * independently in **six** places, net yield in **four**, and LVR in **eight**.
 * Stamp duty had exactly this shape once — four copies that drifted until no
 * two agreed on WA base amounts, a South Australian band, three Tasmanian
 * rates and a quadratic Northern Territory modelled as linear. That was fixed
 * by making one implementation and re-exporting it
 * (`supabase/functions/_shared/stampDuty/`). This is the same remedy for the
 * figures a client actually acts on.
 *
 * ## The finding that shaped it: the divergence was mostly NOT a bug
 *
 * The obvious reading of eight LVR sites is "seven of them are wrong". They
 * are not. `liveProjectionRow.ts` divides the settlement loan by the PURCHASE
 * PRICE; the strategy and review surfaces divide the remaining balance by the
 * CURRENT VALUE. Both are correct — they are **different quantities**:
 * origination LVR and current LVR. At settlement they coincide, and across a
 * ten-year projection they diverge every year.
 *
 * The same is true of yield. `financialEngine.pure.ts`'s `propertyValue` is
 * the purchase price (it pairs with `deposit` and drives land tax), so its
 * yields are yield-on-purchase; the portfolio and review surfaces divide by
 * current value.
 *
 * So consolidating onto ONE yield would have destroyed a real distinction and
 * silently changed documents. What the codebase actually lacks is not a single
 * definition — it is a NAME for each quantity and a way to state which one you
 * meant.
 *
 * **Therefore basis is not a default here. It is part of the call.** You
 * cannot compute a yield or an LVR through this module without saying what it
 * is on, which is what makes the ambiguity impossible to reproduce.
 *
 * ## Absent, not zero
 *
 * Every existing site is shaped `value > 0 ? (loan / value) * 100 : 0`. A zero
 * LVR is not the absence of an LVR — it is the claim that a property is
 * unencumbered, and a zero yield is the claim that it earns nothing. Law 2 of
 * this programme: a labelled row promises a figure, and absent means omitted.
 * Every function here returns `null` where the figure cannot be formed, so a
 * caller must decide what to print rather than inheriting a fabricated zero.
 *
 * ## Net yield versus cash-on-cash
 *
 * These are different quantities and the product has conflated them.
 *
 *  - **Net yield** is unlevered: rent less OPERATING costs, over a property
 *    basis. Financing is excluded because the yield is a property of the
 *    asset, not of how it was bought.
 *  - **Cash-on-cash** is levered: rent less operating costs AND debt service,
 *    over the CASH actually invested.
 *
 * `useReviewWizard.ts` computes rent less costs-including-interest over
 * current value and calls it `netYield`. That is neither: it is a levered
 * return on value. It is a screen figure and reaches no report, but it is why
 * `netYieldOnValue` here takes `operatingCosts` explicitly rather than a
 * pre-netted cashflow — the shape of the input makes the error hard to repeat.
 *
 * Nothing in this module fetches, reads a clock, or randomises.
 */

/**
 * What a ratio is measured against.
 *
 * `purchase` — the price paid. Fixed for the life of the holding, and the
 * right basis for an acquisition analysis: what this deal yields.
 * `value` — the current market value. Moves every year, and the right basis
 * for a portfolio review: what this asset yields now.
 */
export type MetricBasis = 'purchase' | 'value';

/** A figure with the basis it was measured on, so it cannot be re-labelled. */
export interface BasedMetric {
  readonly value: number;
  readonly basis: MetricBasis;
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * A denominator must be positive to divide by. Zero and negatives do not make
 * a ratio "0" — they make it undefined, which is what null says.
 */
const positive = (v: unknown): number | null => {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
};

/** Percentages are carried to 2dp; anything finer is false precision on rent. */
const pct = (numerator: number, denominator: number): number =>
  Math.round((numerator / denominator) * 100 * 100) / 100;

// ---------------------------------------------------------------------------
// Yield
// ---------------------------------------------------------------------------

export interface GrossYieldInput {
  /** Rent for a full year, in dollars. Not weekly, not monthly. */
  readonly annualRent: number;
  /** The basis amount — the purchase price, or the current value. */
  readonly basisAmount: number;
  readonly basis: MetricBasis;
}

/**
 * Gross yield: a year's rent over the basis, as a percentage.
 *
 * Gross means before every cost, including the ones an owner cannot avoid. It
 * is a comparison figure, not an income figure, and the reports say so.
 */
export function grossYield(input: GrossYieldInput): BasedMetric | null {
  const rent = finite(input.annualRent);
  const base = positive(input.basisAmount);
  if (rent === null || base === null) return null;
  return { value: pct(rent, base), basis: input.basis };
}

export interface NetYieldInput {
  readonly annualRent: number;
  /**
   * Operating costs for a year: rates, insurance, management, maintenance,
   * body corporate. **Debt service is not an operating cost** — see the
   * module header. Passing a figure that includes interest produces a levered
   * return wearing the name of an unlevered one.
   */
  readonly annualOperatingCosts: number;
  readonly basisAmount: number;
  readonly basis: MetricBasis;
}

/**
 * Net yield: a year's rent less OPERATING costs, over the basis.
 *
 * Unlevered on purpose. Two owners of the same property with different loans
 * have the same net yield and different cash-on-cash returns, and a document
 * that blurs them tells a client their asset performs differently because
 * they borrowed differently.
 *
 * Land tax is the one cost reasonable people exclude, because it depends on
 * the owner's total holdings rather than on this property — the investment
 * engine excludes it deliberately (`totalAnnualExcludingLandTax`) and says so
 * in the report. That choice belongs to the caller assembling
 * `annualOperatingCosts`; this module does not second-guess it.
 */
export function netYield(input: NetYieldInput): BasedMetric | null {
  const rent = finite(input.annualRent);
  const costs = finite(input.annualOperatingCosts);
  const base = positive(input.basisAmount);
  if (rent === null || costs === null || base === null) return null;
  return { value: pct(rent - costs, base), basis: input.basis };
}

// ---------------------------------------------------------------------------
// Leverage
// ---------------------------------------------------------------------------

export interface OriginationLvrInput {
  /** The loan drawn at settlement. */
  readonly loanAtSettlement: number;
  readonly purchasePrice: number;
}

/**
 * LVR at origination: the settlement loan over the purchase price.
 *
 * This is the LVR that decides LMI and the lender's product, and it never
 * changes for the life of the loan. `liveProjectionRow.ts` computes exactly
 * this, correctly, inside the initial loan block.
 */
export function originationLvr(input: OriginationLvrInput): number | null {
  const loan = finite(input.loanAtSettlement);
  const price = positive(input.purchasePrice);
  if (loan === null || price === null) return null;
  return pct(loan, price);
}

export interface CurrentLvrInput {
  /** What is still owed today. */
  readonly loanBalance: number;
  /** What the property is worth today. */
  readonly currentValue: number;
}

/**
 * Current LVR: the outstanding balance over today's value.
 *
 * This is the LVR that decides refinancing headroom, and it moves with both
 * amortisation and growth. It is NOT the origination LVR and a document must
 * not print one under the other's label.
 */
export function currentLvr(input: CurrentLvrInput): number | null {
  const balance = finite(input.loanBalance);
  const value = positive(input.currentValue);
  if (balance === null || value === null) return null;
  return pct(balance, value);
}

/**
 * Equity: value less what is owed.
 *
 * Deliberately NOT floored at zero. Negative equity is a real and material
 * state, and clamping it to zero would tell a client in it that they are at
 * break-even.
 */
export function equity(currentValue: unknown, loanBalance: unknown): number | null {
  const value = finite(currentValue);
  const balance = finite(loanBalance);
  if (value === null || balance === null) return null;
  return value - balance;
}

// ---------------------------------------------------------------------------
// Levered return
// ---------------------------------------------------------------------------

export interface CashOnCashInput {
  readonly annualRent: number;
  readonly annualOperatingCosts: number;
  /** A year's loan repayments — the thing net yield excludes. */
  readonly annualDebtService: number;
  /**
   * The cash actually put in: deposit plus acquisition costs. Dividing a
   * levered return by the property's value instead is the error this module's
   * header describes; it produces a number with no standard meaning.
   */
  readonly cashInvested: number;
}

/**
 * Cash-on-cash: what the money actually invested returned, after finance.
 *
 * The levered counterpart to net yield, and the figure an investor comparing
 * this against a term deposit actually wants. Can legitimately be negative —
 * a negatively geared property returns less cash than it consumes, and the
 * report says that plainly rather than reporting zero.
 */
export function cashOnCashReturn(input: CashOnCashInput): number | null {
  const rent = finite(input.annualRent);
  const costs = finite(input.annualOperatingCosts);
  const debt = finite(input.annualDebtService);
  const invested = positive(input.cashInvested);
  if (rent === null || costs === null || debt === null || invested === null) return null;
  return pct(rent - costs - debt, invested);
}

// ---------------------------------------------------------------------------
// Does the record agree with itself?
// ---------------------------------------------------------------------------

/**
 * The finance figures a stored report holds, as they sit in
 * `financial_calculations`. Every field is optional because a row may predate
 * the block that carries it, and a missing figure is not a breach.
 */
export interface StoredFinanceFigures {
  readonly purchasePrice?: unknown;
  readonly deposit?: unknown;
  readonly loanAmount?: unknown;
  /** `keyMetrics.lvr` — derived by the engine from the deposit. */
  readonly keyMetricsLvr?: unknown;
  /** `loanDetails.lvr` — the loan block's own copy of the same quantity. */
  readonly loanDetailsLvr?: unknown;
}

export interface IdentityBreach {
  readonly rule: 'deposit_plus_loan' | 'lvr_stated_twice' | 'lvr_matches_loan';
  readonly expected: number;
  readonly found: number;
  readonly message: string;
}

/** A dollar of rounding is allowed; a hundred is a different number. */
const DOLLAR_SLACK = 1;
/** Half a point, the same band the prose reconciliation uses for an LVR. */
const LVR_SLACK = 0.5;

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-AU')}`;

/**
 * Three identities a finance block cannot break and still describe one deal.
 *
 * This is the same rule as the rest of the module — one definition per figure —
 * turned on the record instead of the prose. It was written because the corpus
 * breaks it: 14 of 143 stored reports carry `keyMetrics.lvr` of 80 beside
 * `loanDetails.lvr` of 90, with a deposit computed at 20% of the price and a
 * loan computed at 90% of it. On one of those the two lines add to $739,200
 * against a $672,000 purchase — the client is shown a deposit and a loan that
 * together exceed what they are buying by $67,200 — and the written analysis
 * says "90% LVR" nine to twelve times, because that is the number the loan
 * block gave the model.
 *
 * Like the prose reconciliation, this DISCLOSES. A report that has already
 * been paid for and delivered is not improved by refusing to show it; it is
 * improved by saying, on its face, which two of its numbers disagree.
 */
export function financeIdentityBreaches(figures: StoredFinanceFigures): IdentityBreach[] {
  const out: IdentityBreach[] = [];
  const price = positive(finite(figures.purchasePrice) ?? undefined);
  const deposit = finite(figures.deposit);
  const loan = finite(figures.loanAmount);
  const kmLvr = finite(figures.keyMetricsLvr);
  const ldLvr = finite(figures.loanDetailsLvr);

  if (price !== null && deposit !== null && loan !== null
      && Math.abs(deposit + loan - price) > DOLLAR_SLACK) {
    out.push({
      rule: 'deposit_plus_loan',
      expected: price,
      found: deposit + loan,
      message: `The deposit (${money(deposit)}) and the loan (${money(loan)}) come to ${money(deposit + loan)} against a purchase price of ${money(price)}.`,
    });
  }

  if (kmLvr !== null && ldLvr !== null && Math.abs(kmLvr - ldLvr) > LVR_SLACK) {
    out.push({
      rule: 'lvr_stated_twice',
      expected: kmLvr,
      found: ldLvr,
      message: `The record states two loan-to-value ratios for the same loan: ${kmLvr}% with the key metrics and ${ldLvr}% with the loan details.`,
    });
  }

  // Which of the two is right is settled by the loan itself, so say so rather
  // than leaving a reader to pick. Checked against whichever copy exists.
  const stated = kmLvr ?? ldLvr;
  if (price !== null && loan !== null && stated !== null) {
    const fromLoan = pct(loan, price);
    if (Math.abs(fromLoan - stated) > LVR_SLACK) {
      out.push({
        rule: 'lvr_matches_loan',
        expected: fromLoan,
        found: stated,
        message: `A ${money(loan)} loan on a ${money(price)} purchase is an LVR of ${fromLoan}%, but the record states ${stated}%.`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Naming, for surfaces that print the figure
// ---------------------------------------------------------------------------

/**
 * What a reader should see this figure called, basis included.
 *
 * A yield printed as "Gross yield 4.8%" is ambiguous between two correct
 * numbers. Printed as "Gross yield (on purchase price) 4.8%" it is not, and
 * a reader comparing two documents can tell whether they disagree.
 */
export function labelFor(
  figure: 'grossYield' | 'netYield' | 'originationLvr' | 'currentLvr' | 'cashOnCash',
  basis?: MetricBasis,
): string {
  switch (figure) {
    case 'grossYield':
      return basis === 'value' ? 'Gross yield (on current value)' : 'Gross yield (on purchase price)';
    case 'netYield':
      return basis === 'value' ? 'Net yield (on current value)' : 'Net yield (on purchase price)';
    case 'originationLvr':
      return 'LVR at settlement';
    case 'currentLvr':
      return 'Current LVR';
    case 'cashOnCash':
      return 'Cash-on-cash return';
  }
}
