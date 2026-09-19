/**
 * One loan ledger, monthly, aggregated for annual presentation.
 *
 * The audit of 291 Stone Mason Drive (QA-291SM-20260915) reconstructed the
 * Financial Analysis's ten-year balances as
 * `B(y) = B(y−1) × 1.065 − 78,821.41`: interest accrued ANNUALLY on the
 * opening balance while the repayment subtracted was the MONTHLY-amortising
 * one — so year-10 debt was $887,072 where a monthly-consistent schedule
 * gives $880,993.51, equity was understated by about $6,078 and LVR read
 * 41.9% instead of 41.6% (QA-05). The same report labelled the loan
 * "interest only" while every figure on the page — $6,568 a month, $78,821 a
 * year, $1,325,442 lifetime interest — was a 30-year P&I schedule, because
 * the label was a display override no arithmetic ever read (QA-04).
 *
 * This module is the one schedule. Every payment, balance, interest figure
 * and equity figure the engine publishes is read off it, at the frequency the
 * loan actually repays, and the loan product drives the arithmetic: an
 * interest-only loan pays interest alone for its stated period and then
 * amortises over the remaining term.
 *
 * Verified against the audit's own acceptance figures (Gate 2): for
 * L = $1,039,200, r = 6.5%, n = 360 the monthly payment is $6,568.4509 and
 * the year-10 balance $880,993.51; pure interest-only is $67,548 a year with
 * no principal reduction before the stated transition.
 *
 * Deno-compatible: no imports.
 */

export type LoanProduct = 'principal_interest' | 'interest_only';

/**
 * The interest-only period used when a loan is STATED to be interest only and
 * no period is recorded.
 *
 * Measured on 262 Pallas Street, 17 Sep 2026: the operator's overrides carried
 * `loanType: 'interest_only'` and no `interestOnlyPeriodYears`, so this module
 * read the term as zero and published a 30-year principal-and-interest
 * schedule — $34,890 a year against $29,900 — on an object whose own
 * `loanType` still said `interest_only`, under the sentence "Principal and
 * interest over 30 years". The operator's statement was overruled by a missing
 * second field, silently, and the record contradicted itself.
 *
 * Five years is the ordinary Australian IO term. The value is NOT this
 * module's invention: `readBaseFinancials` has run the Cash Flow report on it
 * since QA-04 and imports it from here, because the two reports describing one
 * loan must not answer differently. It is disclosed wherever the structure is
 * printed — an assumed term is never presented as a stated one.
 *
 * An EXPLICIT `interestOnlyYears: 0` still means principal and interest. "No
 * interest-only period" and "no interest-only period recorded" are different
 * statements, and only the second one is assumed for.
 */
export const ASSUMED_INTEREST_ONLY_YEARS = 5;

export interface LoanLedgerInput {
  loanAmount: number;
  /** Nominal annual rate in percent (6.5 for 6.5%). */
  annualRatePercent: number;
  termYears: number;
  loanType?: LoanProduct | string | null;
  /** Years of interest-only repayments before amortisation begins; 0 for P&I. */
  interestOnlyYears?: number | null;
}

export interface LoanLedgerYear {
  year: number;
  openingBalance: number;
  interest: number;
  principal: number;
  /** Interest + principal actually paid in the year. */
  payments: number;
  closingBalance: number;
  /** Whether every month of the year was interest-only. */
  interestOnly: boolean;
}

export interface LoanLedger {
  loanType: LoanProduct;
  interestOnlyYears: number;
  /** True when the loan said interest-only and no term was recorded, so `ASSUMED_INTEREST_ONLY_YEARS` was used. */
  interestOnlyYearsAssumed: boolean;
  termYears: number;
  annualRatePercent: number;
  /** The repayment in the first month — interest alone during an IO period. */
  firstMonthlyPayment: number;
  /** The amortising repayment once principal is being repaid. */
  amortisingMonthlyPayment: number;
  /** Interest over the whole term, on this schedule. */
  totalInterest: number;
  years: LoanLedgerYear[];
}

/** The standard amortising repayment for `n` monthly instalments. */
export function amortisingPayment(principal: number, monthlyRate: number, months: number): number {
  if (months <= 0) return 0;
  if (monthlyRate === 0) return principal / months;
  const f = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * f) / (f - 1);
}

export function normaliseLoanProduct(v: unknown): LoanProduct {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'interest_only' || s === 'io' || s === 'interest only' || s === 'interest-only') return 'interest_only';
  return 'principal_interest';
}

/**
 * Build the ledger. Interest accrues monthly at `annualRatePercent / 12`;
 * during the interest-only period the payment is the month's interest and
 * the balance stands; afterwards the amortising payment over the remaining
 * months retires the balance by the end of the term.
 */
export function buildLoanLedger(input: LoanLedgerInput): LoanLedger {
  const loanAmount = Math.max(0, Number(input.loanAmount) || 0);
  const termYears = Math.max(1, Math.round(Number(input.termYears) || 30));
  const annualRatePercent = Number(input.annualRatePercent) || 0;
  const loanType = normaliseLoanProduct(input.loanType);
  // A term that was RECORDED — including a recorded zero — is used as given.
  // Only an absent one is assumed for, and only on a loan that says it is
  // interest only. See `ASSUMED_INTEREST_ONLY_YEARS`.
  const ioYearsStated = input.interestOnlyYears !== undefined
    && input.interestOnlyYears !== null
    && Number.isFinite(Number(input.interestOnlyYears));
  const interestOnlyYearsAssumed = loanType === 'interest_only' && !ioYearsStated;
  const ioYearsRaw = loanType !== 'interest_only'
    ? 0
    : (ioYearsStated ? Math.max(0, Number(input.interestOnlyYears) || 0) : ASSUMED_INTEREST_ONLY_YEARS);
  const interestOnlyYears = Math.min(ioYearsRaw, termYears - 1 >= 0 ? termYears - 1 : 0);
  const monthlyRate = annualRatePercent / 100 / 12;
  const totalMonths = termYears * 12;
  const ioMonths = interestOnlyYears * 12;
  const amortisingMonthlyPayment = amortisingPayment(loanAmount, monthlyRate, totalMonths - ioMonths);
  const firstMonthlyPayment = ioMonths > 0 ? loanAmount * monthlyRate : amortisingMonthlyPayment;

  const years: LoanLedgerYear[] = [];
  let balance = loanAmount;
  let totalInterest = 0;
  for (let year = 1; year <= termYears; year += 1) {
    const opening = balance;
    let interest = 0;
    let principal = 0;
    let ioMonthsThisYear = 0;
    for (let m = 1; m <= 12; m += 1) {
      const monthIndex = (year - 1) * 12 + m;
      const monthInterest = balance * monthlyRate;
      interest += monthInterest;
      if (monthIndex <= ioMonths) {
        ioMonthsThisYear += 1;
        continue;
      }
      const monthPrincipal = Math.min(balance, amortisingMonthlyPayment - monthInterest);
      principal += monthPrincipal;
      balance = Math.max(0, balance - monthPrincipal);
    }
    totalInterest += interest;
    years.push({
      year,
      openingBalance: opening,
      interest,
      principal,
      payments: interest + principal,
      closingBalance: balance,
      interestOnly: ioMonthsThisYear === 12,
    });
  }

  return {
    loanType,
    interestOnlyYears,
    interestOnlyYearsAssumed: interestOnlyYearsAssumed && interestOnlyYears > 0,
    termYears,
    annualRatePercent,
    firstMonthlyPayment,
    amortisingMonthlyPayment,
    totalInterest,
    years,
  };
}

/** The ledger's year `n`, or the final year for `n` past the term. */
export function ledgerYear(ledger: LoanLedger, year: number): LoanLedgerYear | undefined {
  if (!ledger.years.length) return undefined;
  if (year < 1) return undefined;
  return ledger.years[Math.min(year, ledger.years.length) - 1];
}

/** "Interest only for 5 years, then principal and interest over the remaining 25 years (30-year term)". */
export function describeLoanStructure(ledger: LoanLedger): string {
  if (ledger.loanType === 'interest_only' && ledger.interestOnlyYears > 0) {
    const rest = ledger.termYears - ledger.interestOnlyYears;
    // An assumed term says so in the sentence a reader sees. The alternative —
    // printing it as though the operator had stated it — is how a default
    // becomes a fact about somebody's loan.
    const basis = ledger.interestOnlyYearsAssumed ? ' (term not recorded; assumed)' : '';
    return `Interest only for ${ledger.interestOnlyYears} year${ledger.interestOnlyYears === 1 ? '' : 's'}${basis}, then principal and interest over the remaining ${rest} year${rest === 1 ? '' : 's'} (${ledger.termYears}-year term)`;
  }
  return `Principal and interest over ${ledger.termYears} years`;
}
