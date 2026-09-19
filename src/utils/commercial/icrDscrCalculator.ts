/**
 * Interest Coverage Ratio (ICR) and Debt Service Coverage Ratio (DSCR)
 * Used by commercial lenders instead of (or alongside) residential serviceability.
 *
 * ICR  = NOI / Annual Interest Expense    (typ. min 1.50x)
 * DSCR = NOI / Annual Debt Service (P&I)  (typ. min 1.25 - 1.35x)
 */

export interface CoverageInputs {
  noi: number;
  loanAmount: number;
  /** Annual interest rate as % (e.g. 7.25) */
  interestRatePct: number;
  /** P&I term in years (used for DSCR). Pass 0 for interest-only. */
  loanTermYears?: number;
}

export interface CoverageResult {
  annualInterest: number;
  annualDebtService: number;
  icr: number;
  dscr: number;
}

export function annualInterest(loan: number, ratePct: number): number {
  return loan * (Math.max(0, ratePct) / 100);
}

/** Standard amortising annual P&I payment */
export function annualPI(loan: number, ratePct: number, termYears: number): number {
  if (loan <= 0) return 0;
  if (termYears <= 0) return annualInterest(loan, ratePct); // interest-only
  const r = ratePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return loan / termYears;
  const monthly = (loan * r) / (1 - Math.pow(1 + r, -n));
  return monthly * 12;
}

export function calculateCoverage(inputs: CoverageInputs): CoverageResult {
  const interest = annualInterest(inputs.loanAmount, inputs.interestRatePct);
  const debtService = annualPI(inputs.loanAmount, inputs.interestRatePct, inputs.loanTermYears ?? 0);
  const icr = interest > 0 ? Number((inputs.noi / interest).toFixed(2)) : 0;
  const dscr = debtService > 0 ? Number((inputs.noi / debtService).toFixed(2)) : 0;
  return { annualInterest: interest, annualDebtService: debtService, icr, dscr };
}

/** Maximum loan supportable given a target ICR (interest-only test) */
export function maxLoanByIcr(noi: number, ratePct: number, targetIcr: number): number {
  if (ratePct <= 0 || targetIcr <= 0) return 0;
  return (noi / targetIcr) / (ratePct / 100);
}
