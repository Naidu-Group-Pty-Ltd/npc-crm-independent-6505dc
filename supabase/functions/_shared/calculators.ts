/**
 * Self-contained property finance calculators for the Report Q&A agent.
 *
 * Phase 2.2 — these are wrapped as agent tools in `agent-tools-registry.ts`.
 *
 * Each function:
 *   - takes plain JS numbers (already validated by the tool schema)
 *   - returns a JSON-serialisable object with both raw numbers and short
 *     human-readable summaries so the model can quote them verbatim
 *   - never reads from network or DB (those tools live elsewhere)
 *
 * Keep in lockstep with the source-of-truth implementations in
 * `src/utils/mortgageCalculations.ts`, `src/utils/lmiCalculations.ts`, and
 * `src/utils/stampDutyCalculator.ts` (mirrored in `_shared/`).
 */

// deno-lint-ignore-file no-explicit-any

export type RepaymentFrequency = 'weekly' | 'fortnightly' | 'monthly';

// Exact multipliers — see memory: Financial Math Standards.
// Weekly = 52/12 per month (NOT 4.33), fortnightly = 26/12.
export const PERIODS_PER_YEAR: Record<RepaymentFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round0 = (n: number) => Math.round(n);

// ---------------------------------------------------------------------------
// Mortgage payment
// ---------------------------------------------------------------------------

export interface MortgageRepaymentInput {
  loan_amount: number;
  annual_rate_percent: number;
  loan_term_years: number;
  frequency?: RepaymentFrequency;
  loan_type?: 'principal_interest' | 'interest_only';
  io_term_years?: number;
}

export interface MortgageRepaymentResult {
  frequency: RepaymentFrequency;
  loan_type: 'principal_interest' | 'interest_only';
  periodic_payment: number;
  monthly_equivalent: number;
  annual_total: number;
  total_interest_over_term: number;
  total_paid_over_term: number;
  summary: string;
}

export function calculateMortgageRepayment(input: MortgageRepaymentInput): MortgageRepaymentResult {
  const principal = Math.max(0, input.loan_amount);
  const ratePct = Math.max(0, input.annual_rate_percent);
  const termYears = Math.max(1, input.loan_term_years);
  const frequency = input.frequency || 'monthly';
  const loanType = input.loan_type || 'principal_interest';
  const periodsPerYear = PERIODS_PER_YEAR[frequency];
  const periodicRate = ratePct / 100 / periodsPerYear;
  const totalPeriods = termYears * periodsPerYear;

  let periodicPayment = 0;
  if (loanType === 'interest_only') {
    periodicPayment = principal * periodicRate;
  } else if (periodicRate === 0) {
    periodicPayment = principal / totalPeriods;
  } else {
    // Standard amortisation formula
    periodicPayment =
      (principal * periodicRate * Math.pow(1 + periodicRate, totalPeriods)) /
      (Math.pow(1 + periodicRate, totalPeriods) - 1);
  }

  const annualTotal = periodicPayment * periodsPerYear;
  const monthlyEquivalent = annualTotal / 12;

  // For IO, approximate total interest assuming IO for term (or io_term)
  let totalPaid = 0;
  let totalInterest = 0;
  if (loanType === 'interest_only') {
    const ioYears = Math.min(input.io_term_years ?? termYears, termYears);
    totalInterest = principal * (ratePct / 100) * ioYears;
    totalPaid = totalInterest; // principal still owed at end
  } else {
    totalPaid = periodicPayment * totalPeriods;
    totalInterest = totalPaid - principal;
  }

  return {
    frequency,
    loan_type: loanType,
    periodic_payment: round2(periodicPayment),
    monthly_equivalent: round2(monthlyEquivalent),
    annual_total: round0(annualTotal),
    total_interest_over_term: round0(totalInterest),
    total_paid_over_term: round0(totalPaid),
    summary:
      `${loanType === 'interest_only' ? 'Interest-only' : 'P&I'} ${frequency} payment of ` +
      `$${round0(periodicPayment).toLocaleString()} ` +
      `($${round0(monthlyEquivalent).toLocaleString()}/mo, $${round0(annualTotal).toLocaleString()}/yr) ` +
      `on $${round0(principal).toLocaleString()} @ ${ratePct.toFixed(2)}% over ${termYears} years`,
  };
}

// ---------------------------------------------------------------------------
// Yield
// ---------------------------------------------------------------------------

export interface YieldInput {
  property_value: number;
  weekly_rent?: number;
  annual_rent?: number;
  annual_expenses?: number; // optional — enables net yield
}

export interface YieldResult {
  property_value: number;
  weekly_rent: number;
  annual_rent: number;
  gross_yield_percent: number;
  net_yield_percent: number | null;
  annual_expenses: number | null;
  summary: string;
}

export function calculateYield(input: YieldInput): YieldResult {
  const value = Math.max(0, input.property_value);
  const annualRent = input.annual_rent ?? (input.weekly_rent ? input.weekly_rent * 52 : 0);
  const weeklyRent = input.weekly_rent ?? annualRent / 52;
  const gross = value > 0 ? (annualRent / value) * 100 : 0;
  const net =
    input.annual_expenses != null && value > 0
      ? ((annualRent - input.annual_expenses) / value) * 100
      : null;
  const grossStr = `${gross.toFixed(2)}%`;
  const netStr = net != null ? ` (net ${net.toFixed(2)}% after $${round0(input.annual_expenses!).toLocaleString()} expenses)` : '';
  return {
    property_value: round0(value),
    weekly_rent: round0(weeklyRent),
    annual_rent: round0(annualRent),
    gross_yield_percent: round2(gross),
    net_yield_percent: net != null ? round2(net) : null,
    annual_expenses: input.annual_expenses != null ? round0(input.annual_expenses) : null,
    summary:
      `Gross yield ${grossStr}${netStr} on $${round0(value).toLocaleString()} ` +
      `(rent $${round0(weeklyRent).toLocaleString()}/wk, $${round0(annualRent).toLocaleString()}/yr)`,
  };
}

// ---------------------------------------------------------------------------
// LVR
// ---------------------------------------------------------------------------

export interface LvrInput {
  loan_amount?: number;
  property_value: number;
  deposit?: number;
}

export interface LvrResult {
  loan_amount: number;
  property_value: number;
  deposit: number;
  lvr_percent: number;
  lmi_likely: boolean;
  deposit_gap_to_80_lvr: number;
  summary: string;
}

export function calculateLvr(input: LvrInput): LvrResult {
  const value = Math.max(0, input.property_value);
  let loan = input.loan_amount;
  let deposit = input.deposit;
  if (loan == null && deposit != null) loan = Math.max(0, value - deposit);
  if (deposit == null && loan != null) deposit = Math.max(0, value - loan);
  loan = loan ?? 0;
  deposit = deposit ?? 0;
  const lvr = value > 0 ? (loan / value) * 100 : 0;
  const lmiLikely = lvr > 80;
  const requiredLoanAt80 = value * 0.8;
  const depositGapTo80 = Math.max(0, loan - requiredLoanAt80);
  return {
    loan_amount: round0(loan),
    property_value: round0(value),
    deposit: round0(deposit),
    lvr_percent: round2(lvr),
    lmi_likely: lmiLikely,
    deposit_gap_to_80_lvr: round0(depositGapTo80),
    summary:
      `LVR ${lvr.toFixed(2)}% (loan $${round0(loan).toLocaleString()} / value $${round0(value).toLocaleString()}). ` +
      (lmiLikely
        ? `Above 80% — LMI typically applies. Additional $${round0(depositGapTo80).toLocaleString()} deposit needed to reach 80% LVR.`
        : `Below 80% — no LMI typically required.`),
  };
}

// ---------------------------------------------------------------------------
// Property cash flow
// ---------------------------------------------------------------------------

export interface CashFlowInput {
  weekly_rent?: number;
  annual_rent?: number;
  // Repayments — at least one must be provided (or supply loan args to compute)
  annual_repayments?: number;
  monthly_repayments?: number;
  loan_amount?: number;
  annual_rate_percent?: number;
  loan_term_years?: number;
  loan_type?: 'principal_interest' | 'interest_only';
  // Holding expenses (annualised). All optional — sensible defaults applied
  annual_expenses?: number; // total override
  council_rates?: number;
  water_rates?: number;
  property_management_percent?: number; // e.g. 7 means 7% of rent
  insurance?: number;
  strata?: number;
  maintenance?: number;
  vacancy_weeks?: number; // assumed vacancy
}

export interface CashFlowResult {
  annual_rent_gross: number;
  vacancy_adjustment: number;
  annual_rent_effective: number;
  annual_repayments: number;
  annual_expenses_breakdown: Record<string, number>;
  annual_expenses_total: number;
  annual_cash_flow: number;
  monthly_cash_flow: number;
  weekly_cash_flow: number;
  is_positive: boolean;
  summary: string;
}

export function calculateCashFlow(input: CashFlowInput): CashFlowResult {
  const annualRentGross =
    input.annual_rent ?? (input.weekly_rent ? input.weekly_rent * 52 : 0);
  const vacancyWeeks = input.vacancy_weeks ?? 2;
  const weeklyRent = input.weekly_rent ?? annualRentGross / 52;
  const vacancyAdj = weeklyRent * vacancyWeeks;
  const annualRentEffective = Math.max(0, annualRentGross - vacancyAdj);

  // Repayments
  let annualRepayments = 0;
  if (input.annual_repayments != null) annualRepayments = input.annual_repayments;
  else if (input.monthly_repayments != null) annualRepayments = input.monthly_repayments * 12;
  else if (input.loan_amount && input.annual_rate_percent != null && input.loan_term_years) {
    const r = calculateMortgageRepayment({
      loan_amount: input.loan_amount,
      annual_rate_percent: input.annual_rate_percent,
      loan_term_years: input.loan_term_years,
      frequency: 'monthly',
      loan_type: input.loan_type || 'principal_interest',
    });
    annualRepayments = r.annual_total;
  }

  // Expenses breakdown
  const breakdown: Record<string, number> = {};
  if (input.annual_expenses != null) {
    breakdown.total_override = round0(input.annual_expenses);
  } else {
    breakdown.council_rates = round0(input.council_rates ?? 2200);
    breakdown.water_rates = round0(input.water_rates ?? 1100);
    breakdown.insurance = round0(input.insurance ?? 1500);
    breakdown.strata = round0(input.strata ?? 0);
    breakdown.maintenance = round0(input.maintenance ?? 1500);
    const pmPct = input.property_management_percent ?? 7;
    breakdown.property_management = round0(annualRentEffective * (pmPct / 100));
  }
  const expensesTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);

  const annualCF = annualRentEffective - annualRepayments - expensesTotal;
  const monthlyCF = annualCF / 12;
  const weeklyCF = annualCF / 52;

  return {
    annual_rent_gross: round0(annualRentGross),
    vacancy_adjustment: round0(vacancyAdj),
    annual_rent_effective: round0(annualRentEffective),
    annual_repayments: round0(annualRepayments),
    annual_expenses_breakdown: breakdown,
    annual_expenses_total: round0(expensesTotal),
    annual_cash_flow: round0(annualCF),
    monthly_cash_flow: round0(monthlyCF),
    weekly_cash_flow: round0(weeklyCF),
    is_positive: annualCF >= 0,
    summary:
      `${annualCF >= 0 ? 'Positive' : 'Negative'} cash flow of ` +
      `$${round0(annualCF).toLocaleString()}/yr ` +
      `($${round0(weeklyCF).toLocaleString()}/wk). ` +
      `Rent $${round0(annualRentEffective).toLocaleString()} − repayments $${round0(annualRepayments).toLocaleString()} − expenses $${round0(expensesTotal).toLocaleString()}.`,
  };
}

// ---------------------------------------------------------------------------
// Scenario delta (rate change, P&I vs IO, repayment frequency switch)
// ---------------------------------------------------------------------------

export interface ScenarioDeltaInput {
  loan_amount: number;
  loan_term_years: number;
  baseline: {
    annual_rate_percent: number;
    loan_type?: 'principal_interest' | 'interest_only';
    frequency?: RepaymentFrequency;
  };
  scenario: {
    annual_rate_percent?: number;
    loan_type?: 'principal_interest' | 'interest_only';
    frequency?: RepaymentFrequency;
    io_term_years?: number;
  };
}

export interface ScenarioDeltaResult {
  baseline: MortgageRepaymentResult;
  scenario: MortgageRepaymentResult;
  monthly_delta: number;
  annual_delta: number;
  total_interest_delta: number;
  pct_change_monthly: number;
  summary: string;
}

export function calculateScenarioDelta(input: ScenarioDeltaInput): ScenarioDeltaResult {
  const base = calculateMortgageRepayment({
    loan_amount: input.loan_amount,
    loan_term_years: input.loan_term_years,
    annual_rate_percent: input.baseline.annual_rate_percent,
    loan_type: input.baseline.loan_type || 'principal_interest',
    frequency: input.baseline.frequency || 'monthly',
  });
  const sc = calculateMortgageRepayment({
    loan_amount: input.loan_amount,
    loan_term_years: input.loan_term_years,
    annual_rate_percent: input.scenario.annual_rate_percent ?? input.baseline.annual_rate_percent,
    loan_type: input.scenario.loan_type || input.baseline.loan_type || 'principal_interest',
    frequency: input.scenario.frequency || input.baseline.frequency || 'monthly',
    io_term_years: input.scenario.io_term_years,
  });
  const monthlyDelta = sc.monthly_equivalent - base.monthly_equivalent;
  const annualDelta = sc.annual_total - base.annual_total;
  const interestDelta = sc.total_interest_over_term - base.total_interest_over_term;
  const pctChange = base.monthly_equivalent > 0
    ? (monthlyDelta / base.monthly_equivalent) * 100
    : 0;
  const dir = monthlyDelta >= 0 ? 'increases' : 'decreases';
  return {
    baseline: base,
    scenario: sc,
    monthly_delta: round2(monthlyDelta),
    annual_delta: round0(annualDelta),
    total_interest_delta: round0(interestDelta),
    pct_change_monthly: round2(pctChange),
    summary:
      `Scenario ${dir} monthly repayment by $${Math.abs(round0(monthlyDelta)).toLocaleString()} ` +
      `(${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%). ` +
      `Annual change $${round0(annualDelta).toLocaleString()}. ` +
      `Lifetime interest change $${round0(interestDelta).toLocaleString()}.`,
  };
}

// ---------------------------------------------------------------------------
// Report metric extractor — auto-fill helper
// ---------------------------------------------------------------------------

export interface ExtractedReportMetrics {
  property_value?: number;
  weekly_rent?: number;
  annual_rent?: number;
  loan_amount?: number;
  deposit?: number;
  interest_rate_percent?: number;
  loan_term_years?: number;
  postcode?: string;
  state?: string;
  address?: string;
  notes: string[];
}

const AU_STATE_RE = /\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/;

function parseMoney(raw: string): number | undefined {
  const cleaned = raw.replace(/[$,\s]/g, '');
  // Support "1.2m" / "850k" shorthand
  const mMatch = cleaned.match(/^([\d.]+)([mk])?$/i);
  if (mMatch) {
    const n = parseFloat(mMatch[1]);
    if (Number.isNaN(n)) return undefined;
    const suffix = mMatch[2]?.toLowerCase();
    if (suffix === 'm') return n * 1_000_000;
    if (suffix === 'k') return n * 1_000;
    return n;
  }
  return undefined;
}

/**
 * Best-effort regex extraction of headline numbers from a single report.
 * Intentionally conservative — when in doubt we omit rather than guess.
 */
export function extractReportMetrics(text: string): ExtractedReportMetrics {
  const out: ExtractedReportMetrics = { notes: [] };
  if (!text) return out;
  const t = text.replace(/\s+/g, ' ').slice(0, 60000); // bound work

  // Property value
  const priceMatch =
    t.match(/(?:purchase price|property (?:value|price)|valuation|listing price|asking price)[^$\d]{0,30}\$?\s*([\d.,]+\s*[mk]?)/i) ||
    t.match(/\$\s*([\d.,]+\s*[mk]?)\s*(?:purchase|property|listing|asking)/i);
  if (priceMatch) {
    const v = parseMoney(priceMatch[1]);
    if (v && v >= 50_000) {
      out.property_value = v;
      out.notes.push(`property_value extracted from: "${priceMatch[0].slice(0, 80)}"`);
    }
  }

  // Weekly rent
  const rentMatch =
    t.match(/(?:weekly rent|rent(?:al)? estimate|estimated rent|rent income)[^$\d]{0,30}\$?\s*([\d,]+)\s*(?:per week|\/?\s*week|\/?\s*wk|p\.?w\.?)?/i) ||
    t.match(/\$\s*([\d,]+)\s*(?:per week|\/?\s*week|\/?\s*wk|p\.?w\.?)/i);
  if (rentMatch) {
    const v = parseMoney(rentMatch[1]);
    if (v && v >= 100 && v <= 10_000) {
      out.weekly_rent = v;
      out.annual_rent = Math.round(v * 52);
      out.notes.push(`weekly_rent extracted from: "${rentMatch[0].slice(0, 80)}"`);
    }
  }

  // Loan amount
  const loanMatch = t.match(/(?:loan amount|loan size|mortgage)[^$\d]{0,30}\$?\s*([\d.,]+\s*[mk]?)/i);
  if (loanMatch) {
    const v = parseMoney(loanMatch[1]);
    if (v && v >= 10_000) {
      out.loan_amount = v;
      out.notes.push(`loan_amount extracted from: "${loanMatch[0].slice(0, 80)}"`);
    }
  }

  // Deposit
  const depositMatch = t.match(/deposit[^$\d]{0,30}\$?\s*([\d.,]+\s*[mk]?)/i);
  if (depositMatch) {
    const v = parseMoney(depositMatch[1]);
    if (v && v >= 1_000) {
      out.deposit = v;
      out.notes.push(`deposit extracted from: "${depositMatch[0].slice(0, 80)}"`);
    }
  }

  // Interest rate
  const rateMatch = t.match(/(?:interest rate|rate)[^%\d]{0,20}(\d{1,2}\.\d{1,2})\s*%/i);
  if (rateMatch) {
    const v = parseFloat(rateMatch[1]);
    if (v >= 1 && v <= 20) {
      out.interest_rate_percent = v;
      out.notes.push(`interest_rate_percent extracted from: "${rateMatch[0].slice(0, 80)}"`);
    }
  }

  // Loan term (years)
  const termMatch = t.match(/(?:loan term|term)[^\d]{0,20}(\d{1,2})\s*(?:years?|yrs?)/i);
  if (termMatch) {
    const v = parseInt(termMatch[1], 10);
    if (v >= 1 && v <= 40) {
      out.loan_term_years = v;
    }
  }

  // Postcode (AU 4-digit)
  const pcMatch = t.match(/\b(\d{4})\b(?!\s*(?:per|p\.?w|sqm|m2))/);
  if (pcMatch) {
    const pc = pcMatch[1];
    if (parseInt(pc, 10) >= 200 && parseInt(pc, 10) <= 9999) {
      out.postcode = pc;
    }
  }

  // State
  const stMatch = t.match(AU_STATE_RE);
  if (stMatch) out.state = stMatch[1];

  // Address (very loose — line containing a number + street suffix)
  const addrMatch = t.match(/(\d+\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Place|Pl|Court|Ct|Crescent|Cres|Way|Boulevard|Blvd|Highway|Hwy|Parade|Pde|Terrace|Tce)[^,]{0,40},\s*[A-Z][a-zA-Z\s]+,?\s*(?:NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\s+\d{4})/);
  if (addrMatch) out.address = addrMatch[1].trim();

  return out;
}

/**
 * Aggregate metrics across multiple reports. First non-undefined value wins
 * unless multiple disagree, in which case both are reported.
 */
export function extractMetricsFromReports(
  reports: Array<string | { content?: string; name?: string }>,
): ExtractedReportMetrics & { per_report: ExtractedReportMetrics[] } {
  const perReport: ExtractedReportMetrics[] = (reports || []).map((r) => {
    const text = typeof r === 'string' ? r : (r?.content ?? '');
    return extractReportMetrics(text);
  });
  const merged: ExtractedReportMetrics = { notes: [] };
  for (const m of perReport) {
    for (const key of Object.keys(m) as Array<keyof ExtractedReportMetrics>) {
      if (key === 'notes') continue;
      const v = m[key];
      if (v != null && (merged as any)[key] == null) {
        (merged as any)[key] = v;
      }
    }
    merged.notes.push(...m.notes);
  }
  return { ...merged, per_report: perReport };
}
