/**
 * Discounted Cash Flow engine for Commercial Property
 *
 * Inputs: starting NOI, hold period, rental growth, vacancy, capex, terminal cap, discount rate, optional debt.
 * Outputs: NOI/year, levered & unlevered cashflows, NPV, IRR (unlevered & levered), equity multiple.
 */

export interface DcfInputs {
  purchasePrice: number;
  acquisitionCosts?: number;        // stamp duty + legals + due diligence
  initialNoi: number;
  holdPeriodYears: number;          // typically 10
  rentalGrowthPct: number | number[]; // single rate or per-year array
  vacancyAllowancePct?: number;     // applied as a haircut to NOI per year
  capexSchedule?: number[];         // per-year capex (year 1..N)
  terminalCapRatePct: number;
  sellingCostsPct?: number;         // % of terminal value
  discountRatePct: number;
  // Optional debt
  loanAmount?: number;
  interestRatePct?: number;
  loanTermYears?: number;           // 0 = interest only
}

export interface DcfYearRow {
  year: number;
  grossNoi: number;
  noi: number;
  capex: number;
  debtService: number;
  unleveredCf: number;
  leveredCf: number;
  loanBalance: number;
}

export interface DcfResult {
  rows: DcfYearRow[];
  terminalValue: number;
  netSaleProceeds: number;
  remainingLoanAtSale: number;
  unleveredNpv: number;
  leveredNpv: number;
  unleveredIrr: number | null;
  leveredIrr: number | null;
  equityInvested: number;
  totalEquityReturned: number;
  equityMultiple: number;
  peakEquity: number;
}

function growthFor(year: number, g: number | number[]): number {
  if (Array.isArray(g)) return (g[year - 1] ?? g[g.length - 1] ?? 0) / 100;
  return g / 100;
}

/** Loan amortisation: returns {payment, balanceAt(yearIndex)} */
function buildAmortisation(loan: number, ratePct: number, termYears: number) {
  if (loan <= 0) return { annualPayment: 0, balanceAt: (_y: number) => 0 };
  const r = ratePct / 100;
  if (termYears <= 0) {
    // Interest only — balance never reduces
    return { annualPayment: loan * r, balanceAt: (_y: number) => loan };
  }
  const rm = r / 12;
  const n = termYears * 12;
  const monthly = rm === 0 ? loan / n : (loan * rm) / (1 - Math.pow(1 + rm, -n));
  const annualPayment = monthly * 12;
  const balanceAt = (yearsElapsed: number) => {
    const months = Math.min(n, yearsElapsed * 12);
    if (rm === 0) return Math.max(0, loan - monthly * months);
    return Math.max(0, loan * Math.pow(1 + rm, months) - monthly * (Math.pow(1 + rm, months) - 1) / rm);
  };
  return { annualPayment, balanceAt };
}

function npv(rate: number, cashflows: number[]): number {
  // cashflows[0] is the time-0 cash flow (typically negative outlay)
  return cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i), 0);
}

/** IRR via Newton-Raphson with bisection fallback */
function irr(cashflows: number[], guess = 0.1): number | null {
  if (cashflows.length < 2) return null;
  let rate = guess;
  for (let iter = 0; iter < 100; iter++) {
    let f = 0;
    let df = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      f += cashflows[t] / denom;
      if (t > 0) df += -t * cashflows[t] / (denom * (1 + rate));
    }
    if (Math.abs(df) < 1e-12) break;
    const next = rate - f / df;
    if (!isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-7) return Number((next * 100).toFixed(4));
    rate = next;
  }
  // Bisection fallback in [-0.99, 10]
  let lo = -0.99, hi = 10;
  const fAt = (r: number) => cashflows.reduce((a, cf, i) => a + cf / Math.pow(1 + r, i), 0);
  let fLo = fAt(lo), fHi = fAt(hi);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = fAt(mid);
    if (Math.abs(fMid) < 1e-6) return Number((mid * 100).toFixed(4));
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  return Number((((lo + hi) / 2) * 100).toFixed(4));
}

export function runDcf(inputs: DcfInputs): DcfResult {
  const {
    purchasePrice,
    acquisitionCosts = 0,
    initialNoi,
    holdPeriodYears,
    rentalGrowthPct,
    vacancyAllowancePct = 0,
    capexSchedule = [],
    terminalCapRatePct,
    sellingCostsPct = 1.5,
    discountRatePct,
    loanAmount = 0,
    interestRatePct = 0,
    loanTermYears = 0,
  } = inputs;

  const equityInvested = (purchasePrice + acquisitionCosts) - loanAmount;
  const { annualPayment, balanceAt } = buildAmortisation(loanAmount, interestRatePct, loanTermYears);
  const vacancyMult = 1 - Math.max(0, Math.min(100, vacancyAllowancePct)) / 100;

  const rows: DcfYearRow[] = [];
  let noi = initialNoi;
  let peakEquity = equityInvested;

  for (let y = 1; y <= holdPeriodYears; y++) {
    if (y > 1) noi = noi * (1 + growthFor(y, rentalGrowthPct));
    const grossNoi = noi;
    const effectiveNoi = grossNoi * vacancyMult;
    const capex = capexSchedule[y - 1] ?? 0;
    const debtService = annualPayment;
    const unleveredCf = effectiveNoi - capex;
    const leveredCf = unleveredCf - debtService;
    const loanBalance = balanceAt(y);

    rows.push({
      year: y,
      grossNoi: Number(grossNoi.toFixed(2)),
      noi: Number(effectiveNoi.toFixed(2)),
      capex,
      debtService: Number(debtService.toFixed(2)),
      unleveredCf: Number(unleveredCf.toFixed(2)),
      leveredCf: Number(leveredCf.toFixed(2)),
      loanBalance: Number(loanBalance.toFixed(2)),
    });

    peakEquity = Math.max(peakEquity, equityInvested - rows.slice(0, y).reduce((a, r) => a + r.leveredCf, 0));
  }

  // Terminal value: NOI of year (N+1) capitalised at terminal cap
  const yearAfter = rows[rows.length - 1].noi * (1 + growthFor(holdPeriodYears + 1, rentalGrowthPct));
  const terminalValue = yearAfter / (terminalCapRatePct / 100);
  const sellingCosts = terminalValue * (sellingCostsPct / 100);
  const remainingLoan = balanceAt(holdPeriodYears);
  const netSaleProceeds = terminalValue - sellingCosts - remainingLoan;

  // Build cashflow series for IRR/NPV (time 0 = equity outlay)
  const unleveredSeries = [-(purchasePrice + acquisitionCosts), ...rows.map(r => r.unleveredCf)];
  unleveredSeries[unleveredSeries.length - 1] += terminalValue - sellingCosts;

  const leveredSeries = [-equityInvested, ...rows.map(r => r.leveredCf)];
  leveredSeries[leveredSeries.length - 1] += netSaleProceeds;

  const dr = discountRatePct / 100;
  const unleveredNpv = npv(dr, unleveredSeries);
  const leveredNpv = npv(dr, leveredSeries);

  const totalEquityReturned = rows.reduce((a, r) => a + r.leveredCf, 0) + netSaleProceeds;
  const equityMultiple = equityInvested > 0 ? totalEquityReturned / equityInvested : 0;

  return {
    rows,
    terminalValue: Number(terminalValue.toFixed(2)),
    netSaleProceeds: Number(netSaleProceeds.toFixed(2)),
    remainingLoanAtSale: Number(remainingLoan.toFixed(2)),
    unleveredNpv: Number(unleveredNpv.toFixed(2)),
    leveredNpv: Number(leveredNpv.toFixed(2)),
    unleveredIrr: irr(unleveredSeries),
    leveredIrr: irr(leveredSeries),
    equityInvested: Number(equityInvested.toFixed(2)),
    totalEquityReturned: Number(totalEquityReturned.toFixed(2)),
    equityMultiple: Number(equityMultiple.toFixed(2)),
    peakEquity: Number(peakEquity.toFixed(2)),
  };
}
