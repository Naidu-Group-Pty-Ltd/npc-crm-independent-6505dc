/**
 * The Portfolio figures the record can produce — so the model is never asked.
 *
 * The rule this file exists to enforce: **if a figure can be produced
 * deterministically from the system record, the model is not asked to
 * calculate, guess, transcribe or recreate it.** Not asked and then checked;
 * not asked and then overwritten. Not asked.
 *
 * ## What was happening
 *
 * `generate-portfolio-analysis` handed the model the portfolio's own metrics
 * and then requested `plusOnePercentImpact`, `plusTwoPercentImpact`,
 * `currentMonthlyCashflow`, `currentMonthlyRepayment`,
 * `projectedPortfolioValue` and `projectedEquity` back as numbers in its JSON
 * schema. Measured over the 14 stored reports carrying the sensitivity block
 * on 2026-09-07, using the one test that needs no external reference — the
 * +2% impact must be a plausible multiple of the +1%:
 *
 *  - inside 1.9×–2.2× (any real amortisation): **4 of 14**
 *  - outside it: **8 of 14**; one of the pair literally zero: 2 more
 *  - observed ratio range: **0.000 to 5.842**
 *
 * Against the loans themselves the model's +1% figure was out by **$2,137 a
 * month on average and $9,090 at worst** — over $109,000 a year, on the
 * headline risk number of a portfolio review. One `currentMonthlyCashflow`
 * differed by $492 a month from the `portfolioMetrics` figure sitting beside
 * it in the same object.
 *
 * ## Why an interest-only loan is exact and an amortising one is absent
 *
 * Traced across `client_properties` (52 rows, 47 loans) on 2026-09-07:
 * `loan_remaining` and `interest_rate` are present on 47 of 47,
 * `repayment_type` on 46. But **there is no loan term in this data model** —
 * not unpopulated, no such column — and `loan_repayment_amount` exists and is
 * populated on **0 of 47**.
 *
 * That splits the mathematics, and the split is a fact rather than a choice:
 *
 *  - **Interest-only**: the monthly repayment IS `balance × rate ÷ 12`, and a
 *    +Δ shock moves it by exactly `balance × Δ ÷ 12`. No term is involved.
 *    Verified against the data: `monthly_interest_repayment` equals that
 *    expression for **20 of 20** interest-only loans (and 0 of 21
 *    principal-and-interest ones, which is how we know it is not the same
 *    quantity there).
 *  - **Principal-and-interest**: the payment is the amortisation formula and
 *    needs a remaining term. There is none. Assuming one is refused here —
 *    a thirty-year guess on a loan with eight years left misstates both the
 *    payment and the shock, and a wrong number carries more conviction than
 *    an absent one.
 *
 * So a portfolio containing any loan that cannot be modelled has **no**
 * sensitivity figure, rather than a partial one presented as the whole. Across
 * the 23 clients holding loans that is 15 exact and 8 absent. That is a strict
 * improvement on a figure produced for all 23 and wrong for most.
 *
 * The remedy for the other third is a data change — capture a loan term — and
 * is deliberately not attempted here.
 *
 * ## Sign convention, stated once and used everywhere
 *
 * **A rate impact is the change to the client's monthly cash position.**
 * A rise that increases repayments is therefore NEGATIVE: `-350` means the
 * position is $350 a month worse. Positive would mean an improvement. Zero
 * means a genuinely calculated zero. Unknown means `null` — never zero.
 *
 * A surface that wants to say "repayments increase by $350" derives that from
 * the negative figure; the underlying convention does not bend to the wording.
 *
 * Nothing here fetches, reads a clock, or randomises.
 */

/** How a loan is repaid, which decides whether a rate rise can be modelled. */
export type RepaymentStructure = 'interest_only' | 'principal_and_interest' | 'unknown';

/** Why a figure could not be produced. Never collapsed into a zero. */
export type UnavailableReason =
  | 'no_loans'
  | 'missing_interest_rate'
  | 'missing_repayment_structure'
  /** An amortising loan with no term recorded anywhere in the data model. */
  | 'amortising_loan_without_term';

export interface PortfolioLoanInput {
  readonly loanRemaining?: unknown;
  /** Annual rate as a percentage, e.g. 5.9. */
  readonly interestRate?: unknown;
  readonly repaymentType?: unknown;
  /** Present in the schema; populated on 0 of 47 loans as at 2026-09-07. */
  readonly loanRepaymentAmount?: unknown;
  readonly loanRepaymentFrequency?: unknown;
}

export interface LoanFact {
  readonly balance: number;
  readonly annualRatePercent: number | null;
  readonly structure: RepaymentStructure;
  /** Null when the record cannot establish it. Never a stand-in zero. */
  readonly monthlyRepayment: number | null;
  readonly modellable: boolean;
  readonly reason: UnavailableReason | null;
}

const finite = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const positive = (v: unknown): number | null => {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Repayment frequency
// ---------------------------------------------------------------------------

/**
 * Periods per year for each frequency the record may carry.
 *
 * As at 2026-09-07 `loan_repayment_frequency` only ever holds `monthly`, so
 * nothing here is exercised by current data. It exists because the column
 * accepts other values and a second conversion written later, elsewhere, is
 * how two answers to one question appear.
 */
const PERIODS_PER_YEAR: Record<string, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  annually: 1,
  yearly: 1,
};

/**
 * A repayment amount stated at some frequency, as a monthly amount.
 *
 * Returns null when the amount is absent OR the frequency is one this cannot
 * convert — deliberately, rather than assuming monthly. A legitimate zero
 * survives as zero: `0` is a real repayment amount on an offset-cleared loan,
 * and a truthy fallback would turn it into "unknown", which is a different
 * claim.
 */
export function monthlyFromFrequency(amount: unknown, frequency: unknown): number | null {
  const value = finite(amount);
  if (value === null) return null;
  const key = typeof frequency === 'string' ? frequency.trim().toLowerCase() : '';
  const periods = PERIODS_PER_YEAR[key];
  if (periods === undefined) return null;
  return round2((value * periods) / 12);
}

// ---------------------------------------------------------------------------
// Reading one loan
// ---------------------------------------------------------------------------

export function readRepaymentStructure(v: unknown): RepaymentStructure {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  if (s === 'interest_only' || s === 'io') return 'interest_only';
  if (s === 'principal_and_interest' || s === 'p&i' || s === 'pi' || s === 'principal_interest') {
    return 'principal_and_interest';
  }
  return 'unknown';
}

/**
 * What the record establishes about one loan, and what it does not.
 *
 * A recorded repayment amount is preferred over any calculation when the
 * record carries one, because an actual repayment is evidence and a formula is
 * a model of it. Today it never does, so in practice the interest-only branch
 * is what runs — but the preference is the right way round for the day the
 * column is populated.
 */
export function readLoanFact(input: PortfolioLoanInput): LoanFact | null {
  const balance = positive(input.loanRemaining);
  if (balance === null) return null; // no debt is not an unmodellable loan

  const rate = positive(input.interestRate);
  const structure = readRepaymentStructure(input.repaymentType);

  const recorded = monthlyFromFrequency(input.loanRepaymentAmount, input.loanRepaymentFrequency);

  if (rate === null) {
    return { balance, annualRatePercent: null, structure, monthlyRepayment: recorded, modellable: false, reason: 'missing_interest_rate' };
  }
  if (structure === 'unknown') {
    return { balance, annualRatePercent: rate, structure, monthlyRepayment: recorded, modellable: false, reason: 'missing_repayment_structure' };
  }
  if (structure === 'principal_and_interest') {
    // The amortisation formula needs a remaining term, and no column in this
    // data model carries one. Refusing here is the point of the module.
    return { balance, annualRatePercent: rate, structure, monthlyRepayment: recorded, modellable: false, reason: 'amortising_loan_without_term' };
  }
  return {
    balance,
    annualRatePercent: rate,
    structure,
    monthlyRepayment: recorded ?? round2((balance * rate) / 100 / 12),
    modellable: true,
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// Rate sensitivity
// ---------------------------------------------------------------------------

/** The shocks a portfolio review presents. Rises, not forecasts. */
export const RATE_SHOCKS_PERCENTAGE_POINTS = [1, 2] as const;

export interface RateShock {
  readonly deltaPercentagePoints: number;
  /** NEGATIVE means the client's monthly cash position is worse by this much. */
  readonly monthlyImpact: number;
}

export interface PortfolioRateSensitivity {
  readonly available: boolean;
  readonly unavailableReason: UnavailableReason | null;
  /** Total current monthly repayment across the loans, or null. */
  readonly currentMonthlyRepayment: number | null;
  /** Empty when unavailable — never a row of zeroes. */
  readonly shocks: RateShock[];
  readonly loansCovered: number;
  readonly balanceCovered: number;
}

const unavailable = (reason: UnavailableReason): PortfolioRateSensitivity => ({
  available: false, unavailableReason: reason, currentMonthlyRepayment: null,
  shocks: [], loansCovered: 0, balanceCovered: 0,
});

/**
 * What each rate rise costs this group of loans per month.
 *
 * **Every loan in the group must be modellable.** A portfolio where one loan
 * out of four can be priced does not have a sensitivity figure that is three
 * quarters right — it has a figure that understates the exposure, and printing
 * it beside the portfolio's full debt invites exactly the wrong conclusion.
 * The first unmodellable loan makes the whole group unavailable and says why.
 */
export function portfolioRateSensitivity(
  loans: readonly PortfolioLoanInput[],
): PortfolioRateSensitivity {
  const facts: LoanFact[] = [];
  for (const loan of loans ?? []) {
    const fact = readLoanFact(loan);
    if (fact) facts.push(fact);
  }
  if (!facts.length) return unavailable('no_loans');

  const blocker = facts.find((f) => !f.modellable);
  if (blocker) return unavailable(blocker.reason ?? 'missing_repayment_structure');

  const currentMonthly = facts.reduce((sum, f) => sum + (f.monthlyRepayment ?? 0), 0);

  const shocks = RATE_SHOCKS_PERCENTAGE_POINTS.map((delta) => {
    // Interest-only throughout, so the shocked repayment is exact and needs no
    // term: balance × (rate + delta) / 12. The impact is the RISE in what
    // leaves the client's account, carried as a negative.
    const shocked = facts.reduce(
      (sum, f) => sum + (f.balance * ((f.annualRatePercent ?? 0) + delta)) / 100 / 12, 0);
    return { deltaPercentagePoints: delta, monthlyImpact: round2(-(shocked - currentMonthly)) };
  });

  return {
    available: true,
    unavailableReason: null,
    currentMonthlyRepayment: round2(currentMonthly),
    shocks,
    loansCovered: facts.length,
    balanceCovered: round2(facts.reduce((s, f) => s + f.balance, 0)),
  };
}

/** The impact for one shock, or null when the sensitivity is unavailable. */
export function impactFor(s: PortfolioRateSensitivity, delta: number): number | null {
  if (!s.available) return null;
  const row = s.shocks.find((r) => r.deltaPercentagePoints === delta);
  return row ? row.monthlyImpact : null;
}

/** Why a reader is seeing no figure. Rendered, not swallowed. */
export function sensitivityUnavailableText(reason: UnavailableReason | null): string {
  switch (reason) {
    case 'no_loans':
      return 'No loans are recorded against this portfolio, so there is no interest rate exposure to model.';
    case 'missing_interest_rate':
      return 'Interest rate sensitivity is unavailable: at least one loan has no interest rate recorded.';
    case 'missing_repayment_structure':
      return 'Interest rate sensitivity is unavailable: at least one loan has no repayment type recorded.';
    case 'amortising_loan_without_term':
      return 'Interest rate sensitivity is unavailable: this portfolio holds a principal-and-interest loan, and the record does not carry a loan term to amortise it against. Recording the remaining term on that loan would enable this figure.';
    default:
      return 'Interest rate sensitivity is unavailable.';
  }
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export type ProjectionScenario = 'conservative' | 'moderate' | 'optimistic';

/**
 * The annual capital growth each scenario means.
 *
 * These three numbers already existed in `generate-portfolio-analysis`, where
 * they were interpolated into the PROMPT and used in no calculation at all —
 * the model was shown "5% growth" and asked for the resulting value. They are
 * named here so the figure and the assumption printed beside it come from one
 * place and cannot drift.
 */
export const PORTFOLIO_GROWTH_ASSUMPTIONS: Record<ProjectionScenario, number> = {
  conservative: 3.5,
  moderate: 5,
  optimistic: 7.5,
};

export const DEFAULT_PROJECTION_SCENARIO: ProjectionScenario = 'moderate';

export function readProjectionScenario(v: unknown): ProjectionScenario {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'conservative' || s === 'optimistic' ? s : DEFAULT_PROJECTION_SCENARIO;
}

export interface PortfolioProjectionAssumptions {
  readonly scenario: ProjectionScenario;
  readonly annualCapitalGrowthPercent: number;
  readonly horizonYears: number;
  /**
   * Debt is held at today's balance for the whole horizon.
   *
   * Named rather than silent, and it is the honest treatment here for two
   * reasons. Interest-only loans do not amortise, so for them the balance IS
   * constant — and as at 2026-09-07 that is 15 of the 23 clients who hold
   * loans. For the rest the record carries no term, so amortising them is not
   * possible at all. This assumption is therefore exactly right for most
   * portfolios and openly stated for the others; it is not a convenience.
   */
  readonly debtTreatment: 'held_constant';
  /**
   * Cashflow is NOT projected.
   *
   * Projecting it would require a rent growth rate and an expense growth rate,
   * and this repository records neither for a portfolio. Capital growth is not
   * rental growth, and using it as a stand-in would manufacture the number
   * this work exists to remove.
   */
  readonly cashflowTreatment: 'not_projected';
  /** What the client is shown, worded from the fields above. */
  readonly statements: readonly string[];
}

export interface PortfolioProjection {
  readonly assumptions: PortfolioProjectionAssumptions;
  readonly projectedPortfolioValue: number | null;
  readonly projectedDebt: number | null;
  readonly projectedEquity: number | null;
  /** Always null. See `cashflowTreatment`. */
  readonly projectedMonthlyCashflow: null;
}

export interface PortfolioProjectionInput {
  readonly currentPortfolioValue: unknown;
  readonly currentDebt: unknown;
  readonly scenario?: unknown;
  readonly horizonYears?: unknown;
}

export function buildProjectionAssumptions(
  scenario: ProjectionScenario,
  horizonYears: number,
): PortfolioProjectionAssumptions {
  const growth = PORTFOLIO_GROWTH_ASSUMPTIONS[scenario];
  return {
    scenario,
    annualCapitalGrowthPercent: growth,
    horizonYears,
    debtTreatment: 'held_constant',
    cashflowTreatment: 'not_projected',
    statements: [
      `Capital growth of ${growth}% a year, compounding, for ${horizonYears} year${horizonYears === 1 ? '' : 's'} (${scenario} scenario).`,
      'Debt is held at today\'s balance for the whole period. Interest-only loans do not reduce their balance, and the record does not carry a loan term for those that would.',
      'Rental cashflow is not projected, because no rent or expense growth rate is recorded for this portfolio.',
    ],
  };
}

/**
 * Project the portfolio's value and equity from the record and one named
 * assumption set.
 *
 * `projectedEquity` is `projectedPortfolioValue − projectedDebt` and nothing
 * else; under `held_constant` the debt term is today's debt. Both are returned
 * so the subtraction a reader is shown is the subtraction that was performed.
 */
export function projectPortfolio(input: PortfolioProjectionInput): PortfolioProjection {
  const scenario = readProjectionScenario(input.scenario);
  const horizonRaw = positive(input.horizonYears);
  const horizonYears = horizonRaw !== null ? Math.round(horizonRaw) : 10;
  const assumptions = buildProjectionAssumptions(scenario, horizonYears);

  const value = positive(input.currentPortfolioValue);
  // Zero debt is a real, unencumbered portfolio; only absence is unknown.
  const debt = finite(input.currentDebt);

  if (value === null) {
    return {
      assumptions, projectedPortfolioValue: null, projectedDebt: null,
      projectedEquity: null, projectedMonthlyCashflow: null,
    };
  }

  const growthFactor = Math.pow(1 + assumptions.annualCapitalGrowthPercent / 100, horizonYears);
  const projectedPortfolioValue = Math.round(value * growthFactor);
  const projectedDebt = debt === null ? null : Math.round(debt);

  return {
    assumptions,
    projectedPortfolioValue,
    projectedDebt,
    projectedEquity: projectedDebt === null ? null : projectedPortfolioValue - projectedDebt,
    projectedMonthlyCashflow: null,
  };
}
