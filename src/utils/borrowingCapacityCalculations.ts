/**
 * Borrowing Capacity Calculator - Client-Side Utilities
 * 
 * These utilities mirror the edge function logic for:
 * - Instant UI feedback
 * - What-if scenario modeling
 * - Offline calculations
 * 
 * Phase 3: Constants are now sourced from the Policy Engine (policyEngine.ts)
 */

import {
  DEFAULT_POLICY,
  DEFAULT_INCOME_SHADING_RULES,
  DEFAULT_HEM_CONFIG,
  DEFAULT_CONSERVATIVE_CONFIG,
  DEFAULT_LOAN_PARAMS,
  DEFAULT_BAND_THRESHOLDS,
  DEFAULT_TAX_CONFIG,
  DEFAULT_HECS_CONFIG,
  calculateIncomeTaxFromPolicy,
  getHemBenchmarkFromPolicy,
  getHecsRepaymentFromPolicy,
  determineServiceabilityBand,
  type PolicyConfig,
  type IncomeShadingRule,
  type HemConfig,
  type BandThresholds,
  type ConservativeModeConfig,
} from './policyEngine';
// Audit item 9 — the one place that decides whether a household is a couple.
import { householdCategory } from '@/lib/householdComposition.pure';

// ============================================
// TYPES
// ============================================

export type ServiceabilityBand = 'green' | 'amber' | 'red';

export interface IncomeBreakdownItem {
  component: string;
  grossAmount: number;
  shadingRate: number;
  shadedAmount: number;
}

export interface LiabilityBreakdownItem {
  type: string;
  balance: number;
  limit?: number;
  monthlyServicing: number;
}

export type CalculationMode = 'bank' | 'conservative';

export interface CalculationModeConfig {
  mode: CalculationMode;
  dtiCapEnabled: boolean;
  dtiCapLimit: number;
}

export interface BorrowingCapacityInput {
  grossAnnualIncome: number; // Gross income before tax
  shadedAnnualIncome: number; // After shading applied (kept for serviceability)
  monthlyLivingExpenses: number;
  monthlyCommitments: number;
  interestRate: number;
  bufferRate: number;
  loanTermYears: number;
  // Total outstanding debt balances for DTI calculation
  totalDebtBalances?: number;
  // Optional mode configuration
  calculationMode?: CalculationMode;
  dtiCapEnabled?: boolean;
  dtiCapLimit?: number;
  /** Phase I11 — APS 220-aligned DTI denominator (rental @ 75%, FTB @ 50%, etc.).
   *  When provided, OVERRIDES grossAnnualIncome inside the DTI cap path so two
   *  borrowers with identical headline gross but different rental mixes get
   *  honestly-different caps. Pass `computeDtiDenominator(...).dtiAdjustedAnnualIncome`. */
  dtiAdjustedAnnualIncome?: number;
}

export interface BorrowingCapacityResult {
  borrowingCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: ServiceabilityBand;
  stressTestedCapacity: number;
  dtiRatio: number;
  assessmentRate: number;
  recommendations: string[];
  warnings: string[];
  // After-tax metrics for transparency
  afterTaxAnnualIncome: number;
  monthlyAfterTaxIncome: number;
}

export interface FullAssessmentResult extends BorrowingCapacityResult {
  assessmentId?: string;
  clientId: string;
  grossAnnualIncome: number;
  shadedAnnualIncome: number;
  incomeBreakdown: IncomeBreakdownItem[];
  livingExpensesMonthly: number;
  expenseMethod: 'hem' | 'declared' | 'hybrid';
  hemBenchmark: number;
  existingCommitmentsMonthly: number;
  liabilityBreakdown: LiabilityBreakdownItem[];
  interestRate: number;
  bufferRate: number;
  loanTermYears: number;
  proposedLoanAmount?: number;
  assumptions: { key: string; value: string }[];
  calculatedAt: string;
  // Phase 2: Three-Output Envelope fields
  currentCapacity?: import('./borrowingCapacityTypes').CurrentCapacityResult;
  scenarios?: import('./borrowingCapacityTypes').ScenarioCapacityResult[];
  proposedLoanCheck?: import('./borrowingCapacityTypes').ProposedLoanCheckResult | null;
  // Phase 1: Property contributions
  propertyContributions?: any;
  // Phase 5: Audit Trail & Explanation
  auditTrail?: import('./auditEngine').AuditTrail;
  explanation?: import('./explanationEngine').ExplanationReport;
}

// Tax brackets and Medicare now sourced from Policy Engine
export const TAX_BRACKETS_2025_26 = DEFAULT_TAX_CONFIG.brackets;
export const MEDICARE_LEVY_RATE = DEFAULT_TAX_CONFIG.medicareLevyRate;

/**
 * Calculate income tax payable for a given taxable income (2025-26 rates)
 * @param taxableIncome - Annual taxable income
 * @param includeMedicareLevy - Whether to include 2% Medicare Levy (default: true)
 * @returns Tax payable amount
 */
export function calculateIncomeTax(taxableIncome: number, includeMedicareLevy: boolean = true): number {
  if (taxableIncome <= 0) return 0;
  
  let tax = 0;
  
  for (const bracket of TAX_BRACKETS_2025_26) {
    if (taxableIncome >= bracket.min) {
      if (bracket.rate === 0) {
        // Tax-free threshold - no tax
        continue;
      }
      if (taxableIncome <= bracket.max) {
        // Income falls within this bracket
        const previousBracketMax = TAX_BRACKETS_2025_26[TAX_BRACKETS_2025_26.indexOf(bracket) - 1]?.max || 0;
        tax = bracket.base + (taxableIncome - previousBracketMax) * bracket.rate;
        break;
      }
    }
  }
  
  // Add Medicare Levy (2%)
  if (includeMedicareLevy) {
    tax += taxableIncome * MEDICARE_LEVY_RATE;
  }
  
  return Math.round(tax);
}

/**
 * Get the marginal tax rate for a given income level
 * @param taxableIncome - Annual taxable income
 * @param includeMedicareLevy - Whether to include 2% Medicare Levy (default: true)
 * @returns Marginal tax rate as decimal (e.g., 0.32 for 32%)
 */
export function getMarginalTaxRate(taxableIncome: number, includeMedicareLevy: boolean = true): number {
  if (taxableIncome <= 0) return 0;
  
  let marginalRate = 0;
  
  for (const bracket of TAX_BRACKETS_2025_26) {
    if (taxableIncome >= bracket.min && taxableIncome <= bracket.max) {
      marginalRate = bracket.rate;
      break;
    }
  }
  
  // Add Medicare Levy if applicable
  if (includeMedicareLevy) {
    marginalRate += MEDICARE_LEVY_RATE;
  }
  
  return marginalRate;
}

/**
 * Calculate after-tax income (take-home pay)
 * @param grossAnnualIncome - Annual gross income
 * @param includeMedicareLevy - Whether to include 2% Medicare Levy (default: true)
 * @returns After-tax income
 */
export function calculateAfterTaxIncome(grossAnnualIncome: number, includeMedicareLevy: boolean = true): number {
  const tax = calculateIncomeTax(grossAnnualIncome, includeMedicareLevy);
  return grossAnnualIncome - tax;
}

/**
 * Get full tax breakdown for display purposes
 */
export interface TaxBreakdown {
  grossIncome: number;
  taxPayable: number;
  medicareLevy: number;
  totalTax: number;
  afterTaxIncome: number;
  effectiveTaxRate: number;
  marginalTaxRate: number;
  marginalBracket: string;
  monthlyTakeHome: number;
}

export function getTaxBreakdown(grossAnnualIncome: number): TaxBreakdown {
  const taxWithoutMedicare = calculateIncomeTax(grossAnnualIncome, false);
  const medicareLevy = Math.round(grossAnnualIncome * MEDICARE_LEVY_RATE);
  const totalTax = taxWithoutMedicare + medicareLevy;
  const afterTaxIncome = grossAnnualIncome - totalTax;
  const marginalRate = getMarginalTaxRate(grossAnnualIncome, true);
  
  // Determine marginal bracket label
  let marginalBracket = '$0 - $18,200 (0%)';
  if (grossAnnualIncome > 190000) {
    marginalBracket = '$190,001+ (45% + 2% ML)';
  } else if (grossAnnualIncome > 135000) {
    marginalBracket = '$135,001 - $190,000 (37% + 2% ML)';
  } else if (grossAnnualIncome > 45000) {
    marginalBracket = '$45,001 - $135,000 (30% + 2% ML)';
  } else if (grossAnnualIncome > 18200) {
    marginalBracket = '$18,201 - $45,000 (16% + 2% ML)';
  }
  
  return {
    grossIncome: grossAnnualIncome,
    taxPayable: taxWithoutMedicare,
    medicareLevy,
    totalTax,
    afterTaxIncome,
    effectiveTaxRate: grossAnnualIncome > 0 ? totalTax / grossAnnualIncome : 0,
    marginalTaxRate: marginalRate,
    marginalBracket,
    monthlyTakeHome: Math.round(afterTaxIncome / 12),
  };
}

/**
 * Calculate negative gearing tax refund based on marginal rate
 * @param taxableLoss - The negative gearing loss (should be positive number)
 * @param grossAnnualIncome - Client's gross annual income to determine marginal rate
 * @returns Tax refund amount
 */
export function calculateNegativeGearingRefund(taxableLoss: number, grossAnnualIncome: number): number {
  if (taxableLoss <= 0) return 0;
  
  const marginalRate = getMarginalTaxRate(grossAnnualIncome, true);
  return Math.round(taxableLoss * marginalRate);
}

// ============================================
// CONSTANTS — Now sourced from Policy Engine
// Exported for backward compatibility
// ============================================

export const INCOME_SHADING_RULES = DEFAULT_INCOME_SHADING_RULES;

// HEM benchmarks (backward-compatible exports)
export const HEM_BENCHMARKS_BASE = DEFAULT_HEM_CONFIG.baseBenchmarks;
export const HEM_INCOME_SCALING = DEFAULT_HEM_CONFIG.incomeScaling;
export const HEM_BENCHMARKS = HEM_BENCHMARKS_BASE;

// Property & loan constants
export const RENTAL_EXPENSE_RATIO = DEFAULT_POLICY.propertyPolicy.rentalExpenseRatio;
export const LOAN_ASSESSMENT_RATE = DEFAULT_POLICY.propertyPolicy.loanAssessmentRate;

export const DEFAULT_CALCULATION_PARAMS = {
  interestRate: DEFAULT_LOAN_PARAMS.interestRate,
  bufferRate: DEFAULT_LOAN_PARAMS.bufferRate,
  loanTermYears: DEFAULT_LOAN_PARAMS.loanTermYears,
};

// Conservative mode (backward-compatible export)
export const CONSERVATIVE_MODE_ADJUSTMENTS = DEFAULT_CONSERVATIVE_CONFIG;

// Default DTI cap
export const DEFAULT_DTI_CAP = DEFAULT_LOAN_PARAMS.dtiCap;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get HEM benchmark based on marital status, dependents, and income
 * Income-scaled to reflect higher living costs for higher earners
 */
export interface HemBreakdown {
  householdType: 'single' | 'couple';
  dependentsCount: number;
  baseHem: number;
  incomeTier: string;
  multiplier: number;
  finalHem: number;
}

export function getHemBreakdown(
  maritalStatus: string | null,
  dependentsCount: number | null,
  grossAnnualIncome: number = 0,
  /**
   * `clients.secondary_first_name`. Optional so every existing caller keeps
   * compiling, but a caller that has the client row should pass it: a second
   * person on the assessment is a couple household however the status field
   * is spelled, and omitting them is half of audit item 9.
   */
  secondaryApplicantName?: string | null,
): HemBreakdown {
  const dependents = Math.min(dependentsCount || 0, 3);

  const householdType = householdCategory({ maritalStatus, secondaryApplicantName });
  const baseHem = HEM_BENCHMARKS_BASE[householdType][dependents] || HEM_BENCHMARKS_BASE[householdType][0];
  
  // Find income tier and multiplier
  let multiplier = 1.0;
  let incomeTier = 'Under $80k';
  
  for (let i = 0; i < HEM_INCOME_SCALING.length; i++) {
    const tier = HEM_INCOME_SCALING[i];
    if (grossAnnualIncome <= tier.maxIncome) {
      multiplier = tier.multiplier;
      if (tier.maxIncome === 80000) incomeTier = 'Under $80k';
      else if (tier.maxIncome === 120000) incomeTier = '$80k - $120k';
      else if (tier.maxIncome === 180000) incomeTier = '$120k - $180k';
      else if (tier.maxIncome === 250000) incomeTier = '$180k - $250k';
      else incomeTier = 'Over $250k';
      break;
    }
  }
  
  return {
    householdType,
    dependentsCount: dependents,
    baseHem,
    incomeTier,
    multiplier,
    finalHem: Math.round(baseHem * multiplier),
  };
}

export function getHemBenchmark(
  maritalStatus: string | null,
  dependentsCount: number | null,
  grossAnnualIncome: number = 0,
  secondaryApplicantName?: string | null,
): number {
  return getHemBreakdown(maritalStatus, dependentsCount, grossAnnualIncome, secondaryApplicantName).finalHem;
}

/**
 * Get HECS repayment based on annual income — now delegates to Policy Engine
 */
export function getHecsRepayment(annualIncome: number): number {
  return getHecsRepaymentFromPolicy(annualIncome, DEFAULT_HECS_CONFIG);
}

/**
 * Get serviceability band color for styling
 */
export function getServiceabilityBandColor(band: ServiceabilityBand): {
  bg: string;
  text: string;
  border: string;
  label: string;
  description: string;
} {
  switch (band) {
    case 'green':
      return {
        bg: 'bg-success/10',
        text: 'text-success',
        border: 'border-success/30',
        label: 'Strong',
        description: 'Strong borrowing position',
      };
    case 'amber':
      return {
        bg: 'bg-warning/10',
        text: 'text-warning',
        border: 'border-warning/30',
        label: 'Moderate',
        description: 'Moderate capacity - proceed with caution',
      };
    case 'red':
      return {
        bg: 'bg-destructive/10',
        text: 'text-destructive',
        border: 'border-destructive/30',
        label: 'Limited',
        description: 'Limited capacity - focus on debt reduction',
      };
  }
}

// ============================================
// CORE CALCULATION FUNCTION
// ============================================

/**
 * Calculate borrowing capacity from input parameters
 * This mirrors the edge function logic for instant client-side calculations
 */
export function calculateBorrowingCapacity(params: BorrowingCapacityInput): BorrowingCapacityResult {
  const { 
    grossAnnualIncome,
    shadedAnnualIncome, 
    monthlyLivingExpenses, 
    monthlyCommitments, 
    interestRate, 
    bufferRate, 
    loanTermYears,
    totalDebtBalances = 0,
    calculationMode = 'bank',
    dtiCapEnabled = false,
    dtiCapLimit = DEFAULT_DTI_CAP,
    dtiAdjustedAnnualIncome,
  } = params;
  
  const isConservative = calculationMode === 'conservative';
  
  // Assessment rate = current rate + APRA buffer
  const assessmentRate = interestRate + bufferRate;
  const monthlyRate = (assessmentRate / 100) / 12;
  
  // *** Phase A1/A4 FIX: Tax must be applied to the SHADED (assessable) income ***
  // Banks assess serviceability on the income they actually count — not raw gross.
  // Using gross overstated take-home pay for variable-income clients (bonus/commission/casual).
  // Fall back to gross only if shaded is missing or zero (defensive).
  const assessableIncome = shadedAnnualIncome > 0 ? shadedAnnualIncome : grossAnnualIncome;
  const afterTaxAnnualIncome = calculateAfterTaxIncome(assessableIncome);
  const monthlyAfterTaxIncome = afterTaxAnnualIncome / 12;
  
  // Monthly net income available = after-tax shaded income (what banks count as take-home)
  const monthlyIncome = monthlyAfterTaxIncome;
  let monthlySurplus = monthlyIncome - monthlyLivingExpenses - monthlyCommitments;
  
  // Conservative mode adjustments
  if (isConservative) {
    // Apply surplus buffer multiplier (only use 85% of calculated surplus)
    monthlySurplus = monthlySurplus * CONSERVATIVE_MODE_ADJUSTMENTS.surplusBufferMultiplier;
    
    // *** Phase A2 FIX: Enforce real minimum surplus floor (was a no-op clamp) ***
    // If surplus is below the conservative floor, treat the shortfall as zero capacity
    // for serviceability purposes — capacity should not flow from sub-floor surplus.
    if (monthlySurplus < CONSERVATIVE_MODE_ADJUSTMENTS.minimumSurplusFloor) {
      monthlySurplus = 0;
    }
    
    // Enforce residual income floor (income remaining after commitments)
    const residualIncome = monthlyIncome - monthlyCommitments;
    if (residualIncome < CONSERVATIVE_MODE_ADJUSTMENTS.residualIncomeFloor) {
      const shortfall = CONSERVATIVE_MODE_ADJUSTMENTS.residualIncomeFloor - residualIncome;
      monthlySurplus = Math.max(0, monthlySurplus - shortfall);
    }
  }
  
  // Max new repayment = available surplus
  let maxNewRepayment = Math.max(0, monthlySurplus);
  
  // Reverse-calculate max loan from repayment using P&I formula
  const periods = loanTermYears * 12;
  let borrowingCapacity = 0;
  
  if (monthlyRate > 0 && maxNewRepayment > 0) {
    const factor = (1 - Math.pow(1 + monthlyRate, -periods)) / monthlyRate;
    borrowingCapacity = Math.round(maxNewRepayment * factor);
  }
  
  // ── Phase I11 ─ DTI denominator now APS 220-aware ────────────────────
  // When the caller supplied `dtiAdjustedAnnualIncome` (computed via
  // computeDtiDenominator with rental @ 75%, FTB @ 50%, etc.), use it as
  // the cap denominator. The headline `dtiRatio` we surface ALSO switches
  // to that denominator so lender review and our number agree.
  const dtiDenominator = (typeof dtiAdjustedAnnualIncome === 'number' && dtiAdjustedAnnualIncome > 0)
    ? dtiAdjustedAnnualIncome
    : grossAnnualIncome;
  const totalDebtWithNewLoan = totalDebtBalances + borrowingCapacity;
  let dtiRatio = dtiDenominator > 0 ? Math.round((totalDebtWithNewLoan / dtiDenominator) * 100) / 100 : 0;

  // Apply DTI cap if enabled or in conservative mode
  const effectiveDtiCap = isConservative ? CONSERVATIVE_MODE_ADJUSTMENTS.dtiHardCap : dtiCapLimit;
  const shouldApplyDtiCap = dtiCapEnabled || isConservative;

  if (shouldApplyDtiCap && dtiRatio > effectiveDtiCap && dtiDenominator > 0) {
    // Calculate max new loan to stay within DTI cap (APS 220-aware denominator)
    const maxTotalDebt = dtiDenominator * effectiveDtiCap;
    const maxNewLoan = Math.max(0, maxTotalDebt - totalDebtBalances);

    if (maxNewLoan < borrowingCapacity) {
      borrowingCapacity = Math.round(maxNewLoan);
      // Recalculate DTI with capped capacity (same denominator)
      dtiRatio = Math.round(((totalDebtBalances + borrowingCapacity) / dtiDenominator) * 100) / 100;
    }
  }
  
  // Stress test at policy-configured increment above assessment rate
  const stressRate = ((assessmentRate + DEFAULT_LOAN_PARAMS.stressTestIncrement) / 100) / 12;
  let stressTestedCapacity = 0;
  if (stressRate > 0 && maxNewRepayment > 0) {
    const stressFactor = (1 - Math.pow(1 + stressRate, -periods)) / stressRate;
    stressTestedCapacity = Math.round(maxNewRepayment * stressFactor);
    
    // Apply DTI cap to stress-tested capacity as well
    if (shouldApplyDtiCap && stressTestedCapacity > borrowingCapacity) {
      stressTestedCapacity = Math.min(stressTestedCapacity, borrowingCapacity);
    }
  }
  
  // Determine band using policy thresholds
  const serviceabilityBand: ServiceabilityBand = determineServiceabilityBand(
    monthlySurplus, dtiRatio, DEFAULT_BAND_THRESHOLDS
  );
  
  // Generate recommendations
  const recommendations: string[] = [];
  const warnings: string[] = [];
  
  // Add mode-specific context
  if (isConservative) {
    recommendations.push("Conservative mode: Capacity adjusted with minimum surplus floors and DTI cap");
  }
  
  if (serviceabilityBand === 'green') {
    recommendations.push("Strong borrowing position - ready for property acquisition");
    if (borrowingCapacity > 500000) {
      recommendations.push("Consider accelerating portfolio growth while rates are favorable");
    }
  } else if (serviceabilityBand === 'amber') {
    recommendations.push("Moderate borrowing capacity - proceed with caution");
    if (dtiRatio > 5) {
      recommendations.push("Consider debt reduction strategies before new borrowing");
    }
    if (monthlySurplus < 300) {
      recommendations.push("Build cash buffer to improve serviceability");
    }
  } else {
    recommendations.push("Limited borrowing capacity - focus on strengthening financial position");
    recommendations.push("Consider paying down high-interest debts first");
    if (monthlyCommitments > monthlyIncome * 0.5) {
      recommendations.push("Existing commitments are high - debt consolidation may help");
    }
  }
  
  // Add warnings
  if (shouldApplyDtiCap && dtiRatio >= effectiveDtiCap * 0.9) {
    warnings.push(`DTI ratio approaching ${effectiveDtiCap}x cap limit`);
  }
  if (dtiRatio >= 7) {
    warnings.push("DTI ratio exceeds most lender thresholds");
  }
  if (monthlySurplus < 0) {
    warnings.push("Monthly expenses exceed income - unable to service new debt");
  }
  if (borrowingCapacity < 100000 && shadedAnnualIncome > 50000) {
    warnings.push("Borrowing capacity constrained by existing commitments");
  }
  if (isConservative && monthlySurplus < CONSERVATIVE_MODE_ADJUSTMENTS.minimumSurplusFloor) {
    warnings.push(`Surplus below conservative minimum floor of $${CONSERVATIVE_MODE_ADJUSTMENTS.minimumSurplusFloor}/mo`);
  }
  
  return {
    borrowingCapacity,
    monthlySurplus: Math.round(monthlySurplus),
    serviceabilityBand,
    stressTestedCapacity,
    dtiRatio,
    assessmentRate,
    recommendations,
    warnings,
    afterTaxAnnualIncome,
    monthlyAfterTaxIncome: Math.round(monthlyAfterTaxIncome),
  };
}

/**
 * Format currency for display
 */
export function formatCapacity(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(2)}M`;
  } else if (amount >= 1000) {
    return `$${Math.round(amount / 1000)}K`;
  }
  return `$${amount.toLocaleString('en-AU')}`;
}

/**
 * Calculate capacity change for scenario comparison
 */
export function calculateCapacityChange(
  baseResult: BorrowingCapacityResult,
  scenarioResult: BorrowingCapacityResult
): {
  absoluteChange: number;
  percentChange: number;
  direction: 'increase' | 'decrease' | 'unchanged';
} {
  const absoluteChange = scenarioResult.borrowingCapacity - baseResult.borrowingCapacity;
  const percentChange = baseResult.borrowingCapacity > 0 
    ? (absoluteChange / baseResult.borrowingCapacity) * 100 
    : 0;
  
  return {
    absoluteChange,
    percentChange: Math.round(percentChange * 10) / 10,
    direction: absoluteChange > 0 ? 'increase' : absoluteChange < 0 ? 'decrease' : 'unchanged',
  };
}

// Re-export Policy Engine types for consumers
export type { PolicyConfig, IncomeShadingRule, HemConfig, BandThresholds, ConservativeModeConfig } from './policyEngine';
export { DEFAULT_POLICY, buildPolicy, getLenderPolicy, LENDER_PROFILES } from './policyEngine';
export type { LenderProfileId } from './policyEngine';
