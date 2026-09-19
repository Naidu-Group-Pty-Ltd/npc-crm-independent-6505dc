/**
 * Mortgage Repayment Calculator - Amortisation Engine
 * 
 * Supports:
 * - Principal & Interest (P&I) loans
 * - Interest-Only (IO) period then rollover to P&I
 * - Different repayment frequencies (weekly, fortnightly, monthly)
 * - Extra repayments
 * - Offset balance (simplified daily-interest approximation)
 * - Rate change scenarios
 */

// ============================================
// TYPES & INTERFACES
// ============================================

export type RepaymentFrequency = 'weekly' | 'fortnightly' | 'monthly';
export type LoanType = 'principal_interest' | 'interest_only';

export interface MortgageInput {
  loanAmount: number;           // Principal (P)
  annualInterestRate: number;   // APR as percentage (e.g., 6.5 for 6.5%)
  loanTermYears: number;        // Total loan term in years
  repaymentFrequency: RepaymentFrequency;
  loanType: LoanType;
  interestOnlyPeriodYears?: number;  // Only if loanType is 'interest_only'
  extraRepaymentPerPeriod?: number;  // Optional extra payment per period
  offsetBalance?: number;            // Optional offset account balance
  ongoingFeePerPeriod?: number;      // Optional ongoing fees
  upfrontFee?: number;               // One-time upfront fee
  capitalizeUpfrontFee?: boolean;    // Add upfront fee to principal
}

export interface RateChange {
  effectiveFromPeriod: number;
  newAnnualRate: number;  // As percentage
}

export interface AmortisationPeriod {
  period: number;
  year: number;
  openingBalance: number;
  effectiveBalanceForInterest: number;  // After offset
  interest: number;
  principal: number;
  scheduledPayment: number;
  extraPayment: number;
  fees: number;
  totalPayment: number;
  closingBalance: number;
  cumulativeInterest: number;
  cumulativePrincipal: number;
  interestRate: number;  // Current rate for this period
  isInterestOnly: boolean;
}

export interface YearlySummary {
  year: number;
  totalInterest: number;
  totalPrincipal: number;
  totalPayments: number;
  endingBalance: number;
  averageRate: number;
}

export interface MortgageCalculationResult {
  // Summary metrics
  scheduledPaymentPerPeriod: number;
  totalInterestPaid: number;
  totalPaid: number;
  totalPeriods: number;
  actualPayoffPeriod: number;  // May be less if extra repayments
  payoffYears: number;
  payoffMonths: number;
  interestSavedVsBaseline: number;  // Savings from extra repayments/offset
  
  // Amortisation schedule
  schedule: AmortisationPeriod[];
  yearlySummary: YearlySummary[];
  
  // Loan details
  loanAmount: number;
  effectiveLoanAmount: number;  // After capitalizing fees
  periodsPerYear: number;
  periodicRate: number;
}

// ============================================
// CONSTANTS
// ============================================

export const PERIODS_PER_YEAR: Record<RepaymentFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
};

// ============================================
// CORE CALCULATION FUNCTIONS
// ============================================

/**
 * Calculate the periodic interest rate from annual rate
 */
export function calculatePeriodicRate(annualRatePercent: number, frequency: RepaymentFrequency): number {
  if (annualRatePercent <= 0) return 0;
  return (annualRatePercent / 100) / PERIODS_PER_YEAR[frequency];
}

/**
 * Calculate P&I repayment amount per period
 * Formula: P × (r × (1+r)^N) / ((1+r)^N - 1)
 */
export function calculatePIPayment(
  principal: number, 
  periodicRate: number, 
  totalPeriods: number
): number {
  if (principal <= 0) return 0;
  if (periodicRate === 0) return principal / totalPeriods;
  if (totalPeriods <= 0) return 0;
  
  const factor = Math.pow(1 + periodicRate, totalPeriods);
  return principal * (periodicRate * factor) / (factor - 1);
}

/**
 * Calculate Interest-Only payment per period
 * Formula: P × r
 */
export function calculateIOPayment(principal: number, periodicRate: number): number {
  if (principal <= 0) return 0;
  return principal * periodicRate;
}

/**
 * Get the applicable interest rate for a given period, considering rate changes
 */
function getRateForPeriod(
  period: number, 
  baseAnnualRate: number, 
  rateChanges: RateChange[],
  frequency: RepaymentFrequency
): { annualRate: number; periodicRate: number } {
  let currentAnnualRate = baseAnnualRate;
  
  // Find the most recent rate change that applies
  for (const change of rateChanges) {
    if (period >= change.effectiveFromPeriod) {
      currentAnnualRate = change.newAnnualRate;
    }
  }
  
  return {
    annualRate: currentAnnualRate,
    periodicRate: calculatePeriodicRate(currentAnnualRate, frequency),
  };
}

/**
 * Main amortisation schedule generator
 */
export function generateAmortisationSchedule(
  input: MortgageInput,
  rateChanges: RateChange[] = []
): MortgageCalculationResult {
  const {
    loanAmount,
    annualInterestRate,
    loanTermYears,
    repaymentFrequency,
    loanType,
    interestOnlyPeriodYears = 0,
    extraRepaymentPerPeriod = 0,
    offsetBalance = 0,
    ongoingFeePerPeriod = 0,
    upfrontFee = 0,
    capitalizeUpfrontFee = false,
  } = input;

  const periodsPerYear = PERIODS_PER_YEAR[repaymentFrequency];
  const totalPeriods = loanTermYears * periodsPerYear;
  const ioPeriods = loanType === 'interest_only' ? interestOnlyPeriodYears * periodsPerYear : 0;
  
  // Effective loan amount (may include capitalized upfront fee)
  const effectiveLoanAmount = capitalizeUpfrontFee ? loanAmount + upfrontFee : loanAmount;
  
  // Sort rate changes by period
  const sortedRateChanges = [...rateChanges].sort((a, b) => a.effectiveFromPeriod - b.effectiveFromPeriod);
  
  // Calculate initial scheduled payment
  const basePeriodicRate = calculatePeriodicRate(annualInterestRate, repaymentFrequency);
  let scheduledPIPayment = calculatePIPayment(effectiveLoanAmount, basePeriodicRate, totalPeriods);
  let scheduledIOPayment = calculateIOPayment(effectiveLoanAmount, basePeriodicRate);
  
  // Amortisation schedule
  const schedule: AmortisationPeriod[] = [];
  let balance = effectiveLoanAmount;
  let cumulativeInterest = 0;
  let cumulativePrincipal = 0;
  let actualPayoffPeriod = totalPeriods;
  
  // Track last recalculation rate to detect when we need to recalculate
  let lastRecalcRate = annualInterestRate;
  let lastRecalcPeriod = 0;
  
  for (let period = 1; period <= totalPeriods && balance > 0; period++) {
    const year = Math.ceil(period / periodsPerYear);
    const isIOPeriod = period <= ioPeriods;
    
    // Get current rate (may have changed)
    const { annualRate, periodicRate } = getRateForPeriod(
      period, 
      annualInterestRate, 
      sortedRateChanges,
      repaymentFrequency
    );
    
    // Check if rate changed - recalculate payment
    if (annualRate !== lastRecalcRate && !isIOPeriod) {
      const remainingPeriods = totalPeriods - period + 1;
      scheduledPIPayment = calculatePIPayment(balance, periodicRate, remainingPeriods);
      lastRecalcRate = annualRate;
      lastRecalcPeriod = period;
    }
    
    // Handle IO → P&I transition
    if (period === ioPeriods + 1 && ioPeriods > 0) {
      const remainingPeriods = totalPeriods - period + 1;
      const currentPeriodicRate = calculatePeriodicRate(annualRate, repaymentFrequency);
      scheduledPIPayment = calculatePIPayment(balance, currentPeriodicRate, remainingPeriods);
    }
    
    // Calculate interest with offset consideration
    const effectiveBalanceForInterest = Math.max(balance - Math.min(offsetBalance, balance), 0);
    const interest = effectiveBalanceForInterest * periodicRate;
    
    // Determine scheduled payment
    let scheduledPayment: number;
    if (isIOPeriod) {
      scheduledPayment = calculateIOPayment(balance, periodicRate);
    } else {
      scheduledPayment = scheduledPIPayment;
    }
    
    // Calculate principal component
    let principal: number;
    if (isIOPeriod) {
      principal = 0;  // No principal reduction during IO
    } else {
      principal = Math.max(scheduledPayment - interest, 0);
    }
    
    // Apply extra repayment (cap to prevent overpayment)
    const maxExtraPayment = Math.max(balance - principal, 0);
    const effectiveExtraPayment = Math.min(extraRepaymentPerPeriod, maxExtraPayment);
    
    // Calculate closing balance
    const totalPrincipalReduction = principal + effectiveExtraPayment;
    const closingBalance = Math.max(balance - totalPrincipalReduction, 0);
    
    // Total payment for this period
    const totalPayment = scheduledPayment + effectiveExtraPayment + ongoingFeePerPeriod;
    
    // Update cumulative totals
    cumulativeInterest += interest;
    cumulativePrincipal += totalPrincipalReduction;
    
    schedule.push({
      period,
      year,
      openingBalance: Math.round(balance * 100) / 100,
      effectiveBalanceForInterest: Math.round(effectiveBalanceForInterest * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      principal: Math.round(principal * 100) / 100,
      scheduledPayment: Math.round(scheduledPayment * 100) / 100,
      extraPayment: Math.round(effectiveExtraPayment * 100) / 100,
      fees: Math.round(ongoingFeePerPeriod * 100) / 100,
      totalPayment: Math.round(totalPayment * 100) / 100,
      closingBalance: Math.round(closingBalance * 100) / 100,
      cumulativeInterest: Math.round(cumulativeInterest * 100) / 100,
      cumulativePrincipal: Math.round(cumulativePrincipal * 100) / 100,
      interestRate: annualRate,
      isInterestOnly: isIOPeriod,
    });
    
    // Check if loan is paid off
    if (closingBalance <= 0) {
      actualPayoffPeriod = period;
      break;
    }
    
    balance = closingBalance;
  }
  
  // Generate yearly summary
  const yearlySummary = generateYearlySummary(schedule, periodsPerYear);
  
  // Calculate totals
  const totalInterestPaid = schedule.reduce((sum, p) => sum + p.interest, 0);
  const totalPaid = schedule.reduce((sum, p) => sum + p.totalPayment, 0) + (capitalizeUpfrontFee ? 0 : upfrontFee);
  
  // Calculate interest saved vs baseline (no extra repayments, no offset)
  let baselineInterest = 0;
  if (extraRepaymentPerPeriod > 0 || offsetBalance > 0) {
    const baselineResult = generateAmortisationSchedule({
      ...input,
      extraRepaymentPerPeriod: 0,
      offsetBalance: 0,
    }, rateChanges);
    baselineInterest = baselineResult.totalInterestPaid;
  }
  const interestSaved = baselineInterest - totalInterestPaid;
  
  // Calculate payoff time
  const payoffYears = Math.floor(actualPayoffPeriod / periodsPerYear);
  const payoffMonths = Math.round((actualPayoffPeriod % periodsPerYear) * (12 / periodsPerYear));
  
  return {
    scheduledPaymentPerPeriod: Math.round(scheduledPIPayment * 100) / 100,
    totalInterestPaid: Math.round(totalInterestPaid * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalPeriods,
    actualPayoffPeriod,
    payoffYears,
    payoffMonths,
    interestSavedVsBaseline: Math.round(interestSaved * 100) / 100,
    schedule,
    yearlySummary,
    loanAmount,
    effectiveLoanAmount,
    periodsPerYear,
    periodicRate: basePeriodicRate,
  };
}

/**
 * Generate yearly summary from amortisation schedule
 */
function generateYearlySummary(schedule: AmortisationPeriod[], periodsPerYear: number): YearlySummary[] {
  const yearlyData: Map<number, {
    interest: number;
    principal: number;
    payments: number;
    endingBalance: number;
    rateSum: number;
    periodCount: number;
  }> = new Map();
  
  for (const period of schedule) {
    const existing = yearlyData.get(period.year) || {
      interest: 0,
      principal: 0,
      payments: 0,
      endingBalance: period.closingBalance,
      rateSum: 0,
      periodCount: 0,
    };
    
    existing.interest += period.interest;
    existing.principal += period.principal + period.extraPayment;
    existing.payments += period.totalPayment;
    existing.endingBalance = period.closingBalance;
    existing.rateSum += period.interestRate;
    existing.periodCount += 1;
    
    yearlyData.set(period.year, existing);
  }
  
  return Array.from(yearlyData.entries()).map(([year, data]) => ({
    year,
    totalInterest: Math.round(data.interest * 100) / 100,
    totalPrincipal: Math.round(data.principal * 100) / 100,
    totalPayments: Math.round(data.payments * 100) / 100,
    endingBalance: Math.round(data.endingBalance * 100) / 100,
    averageRate: Math.round((data.rateSum / data.periodCount) * 100) / 100,
  }));
}

// ============================================
// HELPER FUNCTIONS FOR CASH FLOW INTEGRATION
// ============================================

/**
 * Get loan balance and interest/principal breakdown for a specific year
 * Used by CashFlowAnalysisModal for 10-year projections
 */
export function getLoanDetailsForYear(
  input: MortgageInput,
  year: number,
  rateChanges: RateChange[] = []
): {
  openingBalance: number;
  closingBalance: number;
  yearlyInterest: number;
  yearlyPrincipal: number;
  yearlyPayments: number;
  isInterestOnlyYear: boolean;
} {
  const result = generateAmortisationSchedule(input, rateChanges);
  const yearSummary = result.yearlySummary.find(y => y.year === year);
  
  if (!yearSummary) {
    // Loan already paid off or year out of range
    return {
      openingBalance: 0,
      closingBalance: 0,
      yearlyInterest: 0,
      yearlyPrincipal: 0,
      yearlyPayments: 0,
      isInterestOnlyYear: false,
    };
  }
  
  // Get opening balance from first period of the year
  const periodsPerYear = PERIODS_PER_YEAR[input.repaymentFrequency];
  const firstPeriodOfYear = (year - 1) * periodsPerYear + 1;
  const firstPeriod = result.schedule.find(p => p.period === firstPeriodOfYear);
  const openingBalance = firstPeriod?.openingBalance || 0;
  
  // Check if any period in this year is IO
  const yearPeriods = result.schedule.filter(p => p.year === year);
  const isInterestOnlyYear = yearPeriods.some(p => p.isInterestOnly);
  
  return {
    openingBalance,
    closingBalance: yearSummary.endingBalance,
    yearlyInterest: yearSummary.totalInterest,
    yearlyPrincipal: yearSummary.totalPrincipal,
    yearlyPayments: yearSummary.totalPayments,
    isInterestOnlyYear,
  };
}

/**
 * Get 10-year loan projection summary
 * Returns array of yearly loan details for cash flow analysis
 */
export function get10YearLoanProjection(
  input: MortgageInput,
  rateChanges: RateChange[] = []
): Array<{
  year: number;
  openingBalance: number;
  closingBalance: number;
  interestPayment: number;
  principalPayment: number;
  totalPayment: number;
  isInterestOnly: boolean;
  effectiveRate: number;
}> {
  const result = generateAmortisationSchedule(input, rateChanges);
  const projections = [];
  
  for (let year = 1; year <= 10; year++) {
    const details = getLoanDetailsForYear(input, year, rateChanges);
    const yearSummary = result.yearlySummary.find(y => y.year === year);
    
    projections.push({
      year,
      openingBalance: details.openingBalance,
      closingBalance: details.closingBalance,
      interestPayment: details.yearlyInterest,
      principalPayment: details.yearlyPrincipal,
      totalPayment: details.yearlyPayments,
      isInterestOnly: details.isInterestOnlyYear,
      effectiveRate: yearSummary?.averageRate || input.annualInterestRate,
    });
  }
  
  return projections;
}

/**
 * Calculate monthly, fortnightly, and weekly payment equivalents
 */
export function calculatePaymentEquivalents(
  loanAmount: number,
  annualInterestRate: number,
  loanTermYears: number,
  loanType: LoanType = 'principal_interest',
  interestOnlyPeriodYears: number = 0
): {
  monthly: number;
  fortnightly: number;
  weekly: number;
  monthlyIO?: number;
  fortnightlyIO?: number;
  weeklyIO?: number;
} {
  const monthlyRate = calculatePeriodicRate(annualInterestRate, 'monthly');
  const fortnightlyRate = calculatePeriodicRate(annualInterestRate, 'fortnightly');
  const weeklyRate = calculatePeriodicRate(annualInterestRate, 'weekly');
  
  const monthlyPeriods = loanTermYears * 12;
  const fortnightlyPeriods = loanTermYears * 26;
  const weeklyPeriods = loanTermYears * 52;
  
  const result: any = {
    monthly: calculatePIPayment(loanAmount, monthlyRate, monthlyPeriods),
    fortnightly: calculatePIPayment(loanAmount, fortnightlyRate, fortnightlyPeriods),
    weekly: calculatePIPayment(loanAmount, weeklyRate, weeklyPeriods),
  };
  
  if (loanType === 'interest_only') {
    result.monthlyIO = calculateIOPayment(loanAmount, monthlyRate);
    result.fortnightlyIO = calculateIOPayment(loanAmount, fortnightlyRate);
    result.weeklyIO = calculateIOPayment(loanAmount, weeklyRate);
  }
  
  // Round all values
  Object.keys(result).forEach(key => {
    result[key] = Math.round(result[key] * 100) / 100;
  });
  
  return result;
}
