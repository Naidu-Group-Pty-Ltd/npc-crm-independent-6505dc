/**
 * Policy Engine (Phase 3)
 * 
 * Centralizes ALL hard-coded constants, shading rules, thresholds, and
 * strategy-mode adjustments into a single configurable PolicyConfig object.
 * 
 * This enables:
 * - Lender-specific profiles (different buffers, shading, DTI caps)
 * - Strategy modes (bank vs conservative vs custom)
 * - Easy testing of policy changes without code edits
 * - Single source of truth shared by edge function + client-side
 * 
 * CRITICAL: Changing DEFAULT values here changes calculation outputs.
 * The defaults are calibrated to match the legacy system exactly.
 */
import { householdCategory } from '@/lib/householdComposition.pure';

// ============================================
// INCOME SHADING RULES
// ============================================

export interface IncomeShadingRule {
  rate: number;
  label: string;
}

export const DEFAULT_INCOME_SHADING_RULES: Record<string, IncomeShadingRule> = {
  base_salary: { rate: 1.00, label: "Base Salary (PAYG)" },
  gross_salary: { rate: 1.00, label: "Gross Salary" },
  second_job: { rate: 0.80, label: "Second Job" },
  casual: { rate: 0.60, label: "Casual Income" },
  bonus: { rate: 0.80, label: "Bonus (avg 2yr)" },
  commission: { rate: 0.80, label: "Commission" },
  overtime_essential: { rate: 1.00, label: "Essential Overtime" },
  overtime_non_essential: { rate: 0.50, label: "Non-Essential Overtime" },
  allowance: { rate: 0.80, label: "Allowances" },
  rental_existing: { rate: 0.80, label: "Rental Income (Existing)" },
  rental_proposed: { rate: 0.70, label: "Rental Income (Proposed)" },
  investment_income: { rate: 0.80, label: "Investment Income" },
  government_payments: { rate: 1.00, label: "Government Payments" },
  self_employed: { rate: 0.80, label: "Self-Employed (2yr avg)" },
  other_taxable: { rate: 0.80, label: "Other Taxable" },
};

// ============================================
// HEM BENCHMARKS
// ============================================

export interface HemConfig {
  /** Base HEM values by household type and dependent count (0-3) */
  baseBenchmarks: Record<'single' | 'couple', Record<number, number>>;
  /** Income-based scaling tiers */
  incomeScaling: { maxIncome: number; multiplier: number }[];
}

export const DEFAULT_HEM_CONFIG: HemConfig = {
  baseBenchmarks: {
    single: { 0: 2100, 1: 2650, 2: 3050, 3: 3450 },
    couple: { 0: 2950, 1: 3400, 2: 3850, 3: 4300 },
  },
  incomeScaling: [
    { maxIncome: 80000, multiplier: 1.00 },
    { maxIncome: 120000, multiplier: 1.20 },
    { maxIncome: 180000, multiplier: 1.40 },
    { maxIncome: 250000, multiplier: 1.60 },
    { maxIncome: Infinity, multiplier: 1.80 },
  ],
};

// ============================================
// SERVICEABILITY BAND THRESHOLDS
// ============================================

export interface BandThresholds {
  /** Minimum monthly surplus for green band */
  greenSurplusMin: number;
  /** Maximum DTI for green band */
  greenDtiMax: number;
  /** Maximum DTI for amber band (surplus must be > 0) */
  amberDtiMax: number;
}

export const DEFAULT_BAND_THRESHOLDS: BandThresholds = {
  greenSurplusMin: 500,
  greenDtiMax: 6,
  amberDtiMax: 8,
};

// ============================================
// CONSERVATIVE MODE ADJUSTMENTS
// ============================================

export interface ConservativeModeConfig {
  /** Enforce minimum monthly surplus floor ($) */
  minimumSurplusFloor: number;
  /** Minimum residual income after commitments ($) */
  residualIncomeFloor: number;
  /** Multiplier applied to surplus (e.g. 0.85 = use 85%) */
  surplusBufferMultiplier: number;
  /** Hard DTI cap for conservative mode */
  dtiHardCap: number;
}

export const DEFAULT_CONSERVATIVE_CONFIG: ConservativeModeConfig = {
  minimumSurplusFloor: 1000,
  residualIncomeFloor: 1500,
  surplusBufferMultiplier: 0.85,
  dtiHardCap: 6,
};

// ============================================
// LOAN & RATE DEFAULTS
// ============================================

export interface LoanDefaults {
  /** Default interest rate (%) */
  interestRate: number;
  /** Default APRA buffer rate (%) */
  bufferRate: number;
  /** Default loan term (years) */
  loanTermYears: number;
  /** Stress test increment above assessment rate (percentage points) */
  stressTestIncrement: number;
  /** Default DTI cap */
  dtiCap: number;
}

export const DEFAULT_LOAN_PARAMS: LoanDefaults = {
  interestRate: 6.50,
  bufferRate: 3.00,
  loanTermYears: 30,
  stressTestIncrement: 1.0,
  dtiCap: 6.0,
};

// ============================================
// PROPERTY ASSESSMENT POLICY
// ============================================

export interface PropertyPolicy {
  /** Shading rate for existing rental income */
  rentalShadingRate: number;
  /** Shading rate for proposed rental income */
  proposedRentalShadingRate: number;
  /** Vacancy rate deduction (0 = not applied) */
  vacancyRate: number;
  /** Assessment rate for stress-testing existing loans (decimal, e.g. 0.095) */
  loanAssessmentRate: number;
  /** Loan term in months for P&I calculation */
  loanTermMonths: number;
  /** Rental expense ratio — assumed % of rent covering property expenses */
  rentalExpenseRatio: number;
}

export const DEFAULT_PROPERTY_POLICY: PropertyPolicy = {
  rentalShadingRate: 0.80,
  proposedRentalShadingRate: 0.70,
  vacancyRate: 0.0,
  loanAssessmentRate: 0.095,
  loanTermMonths: 360,
  rentalExpenseRatio: 0.20,
};

// ============================================
// LIABILITY ASSESSMENT RULES
// ============================================

export interface LiabilityRules {
  /** Credit card: % of limit used for servicing */
  creditCardLimitRate: number;
  /** BNPL: % of limit used for servicing */
  bnplLimitRate: number;
}

export const DEFAULT_LIABILITY_RULES: LiabilityRules = {
  creditCardLimitRate: 0.03,
  bnplLimitRate: 0.05,
};

// ============================================
// TAX CONFIGURATION
// ============================================

export interface TaxConfig {
  /** Financial year label */
  taxYear: string;
  /** Tax brackets (excluding Medicare) */
  brackets: { min: number; max: number; rate: number; base: number }[];
  /** Medicare Levy rate */
  medicareLevyRate: number;
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  taxYear: '2025-26',
  brackets: [
    { min: 0, max: 18200, rate: 0, base: 0 },
    { min: 18201, max: 45000, rate: 0.16, base: 0 },
    { min: 45001, max: 135000, rate: 0.30, base: 4288 },
    { min: 135001, max: 190000, rate: 0.37, base: 31288 },
    { min: 190001, max: Infinity, rate: 0.45, base: 51638 },
  ],
  medicareLevyRate: 0.02,
};

// ============================================
// HECS/HELP REPAYMENT THRESHOLDS
// ============================================

export interface HecsConfig {
  thresholds: { min: number; max: number; rate: number }[];
}

export const DEFAULT_HECS_CONFIG: HecsConfig = {
  thresholds: [
    { min: 0, max: 54434, rate: 0.00 },
    { min: 54435, max: 62850, rate: 0.01 },
    { min: 62851, max: 66620, rate: 0.02 },
    { min: 66621, max: 70618, rate: 0.025 },
    { min: 70619, max: 74855, rate: 0.03 },
    { min: 74856, max: 79346, rate: 0.035 },
    { min: 79347, max: 84107, rate: 0.04 },
    { min: 84108, max: 89154, rate: 0.045 },
    { min: 89155, max: 94503, rate: 0.05 },
    { min: 94504, max: 100174, rate: 0.055 },
    { min: 100175, max: 106185, rate: 0.06 },
    { min: 106186, max: 112556, rate: 0.065 },
    { min: 112557, max: 119309, rate: 0.07 },
    { min: 119310, max: 126467, rate: 0.075 },
    { min: 126468, max: 134056, rate: 0.08 },
    { min: 134057, max: 142100, rate: 0.085 },
    { min: 142101, max: 150626, rate: 0.09 },
    { min: 150627, max: 159663, rate: 0.095 },
    { min: 159664, max: Infinity, rate: 0.10 },
  ],
};

// ============================================
// FULL POLICY CONFIG (MASTER TYPE)
// ============================================

export interface PolicyConfig {
  /** Human-readable name for this policy (e.g. "Default APRA", "CBA Lender Profile") */
  name: string;
  /** Income shading rules by source type */
  incomeShadingRules: Record<string, IncomeShadingRule>;
  /** HEM benchmark configuration */
  hem: HemConfig;
  /** Serviceability band thresholds */
  bandThresholds: BandThresholds;
  /** Conservative mode adjustments */
  conservativeMode: ConservativeModeConfig;
  /** Default loan parameters */
  loanDefaults: LoanDefaults;
  /** Property assessment policy */
  propertyPolicy: PropertyPolicy;
  /** Liability assessment rules */
  liabilityRules: LiabilityRules;
  /** Tax configuration */
  tax: TaxConfig;
  /** HECS/HELP configuration */
  hecs: HecsConfig;
}

// ============================================
// DEFAULT POLICY (matches legacy system exactly)
// ============================================

export const DEFAULT_POLICY: PolicyConfig = {
  name: 'Default APRA',
  incomeShadingRules: DEFAULT_INCOME_SHADING_RULES,
  hem: DEFAULT_HEM_CONFIG,
  bandThresholds: DEFAULT_BAND_THRESHOLDS,
  conservativeMode: DEFAULT_CONSERVATIVE_CONFIG,
  loanDefaults: DEFAULT_LOAN_PARAMS,
  propertyPolicy: DEFAULT_PROPERTY_POLICY,
  liabilityRules: DEFAULT_LIABILITY_RULES,
  tax: DEFAULT_TAX_CONFIG,
  hecs: DEFAULT_HECS_CONFIG,
};

// ============================================
// LENDER PROFILES (pre-built policy overrides)
// ============================================

export type LenderProfileId = 'default' | 'conservative' | 'cba' | 'westpac' | 'anz' | 'nab' | 'macquarie';

/**
 * Build a PolicyConfig by merging partial overrides onto the default.
 * Supports nested partial overrides via deep merge.
 */
export function buildPolicy(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    name: overrides.name ?? DEFAULT_POLICY.name,
    incomeShadingRules: { ...DEFAULT_POLICY.incomeShadingRules, ...overrides.incomeShadingRules },
    hem: overrides.hem ?? DEFAULT_POLICY.hem,
    bandThresholds: { ...DEFAULT_POLICY.bandThresholds, ...overrides.bandThresholds },
    conservativeMode: { ...DEFAULT_POLICY.conservativeMode, ...overrides.conservativeMode },
    loanDefaults: { ...DEFAULT_POLICY.loanDefaults, ...overrides.loanDefaults },
    propertyPolicy: { ...DEFAULT_POLICY.propertyPolicy, ...overrides.propertyPolicy },
    liabilityRules: { ...DEFAULT_POLICY.liabilityRules, ...overrides.liabilityRules },
    tax: overrides.tax ?? DEFAULT_POLICY.tax,
    hecs: overrides.hecs ?? DEFAULT_POLICY.hecs,
  };
}

/** Pre-built lender profiles with differentiated policy parameters */
export const LENDER_PROFILES: Record<LenderProfileId, Partial<PolicyConfig>> = {
  default: { name: 'Default APRA' },
  conservative: {
    name: 'Conservative',
    loanDefaults: { ...DEFAULT_LOAN_PARAMS, bufferRate: 3.50 },
    bandThresholds: { greenSurplusMin: 750, greenDtiMax: 5, amberDtiMax: 7 },
  },
  cba: {
    name: 'Commonwealth Bank',
    loanDefaults: { ...DEFAULT_LOAN_PARAMS, bufferRate: 3.00 },
    incomeShadingRules: {
      ...DEFAULT_INCOME_SHADING_RULES,
      casual: { rate: 0.50, label: "Casual Income (CBA)" },
      bonus: { rate: 0.70, label: "Bonus (CBA)" },
    },
  },
  westpac: {
    name: 'Westpac',
    loanDefaults: { ...DEFAULT_LOAN_PARAMS, bufferRate: 3.00 },
    incomeShadingRules: {
      ...DEFAULT_INCOME_SHADING_RULES,
      overtime_non_essential: { rate: 0.40, label: "Non-Essential OT (Westpac)" },
    },
  },
  anz: {
    name: 'ANZ',
    loanDefaults: { ...DEFAULT_LOAN_PARAMS, bufferRate: 3.00 },
    liabilityRules: { creditCardLimitRate: 0.038, bnplLimitRate: 0.05 },
  },
  nab: {
    name: 'NAB',
    loanDefaults: { ...DEFAULT_LOAN_PARAMS, bufferRate: 3.00 },
    incomeShadingRules: {
      ...DEFAULT_INCOME_SHADING_RULES,
      commission: { rate: 0.70, label: "Commission (NAB)" },
    },
  },
  macquarie: {
    name: 'Macquarie Bank',
    loanDefaults: { ...DEFAULT_LOAN_PARAMS, bufferRate: 2.50 },
    propertyPolicy: { ...DEFAULT_PROPERTY_POLICY, rentalShadingRate: 0.80 },
    bandThresholds: { greenSurplusMin: 400, greenDtiMax: 7, amberDtiMax: 9 },
  },
};

/**
 * Get a complete PolicyConfig for a named lender profile.
 */
export function getLenderPolicy(lenderId: LenderProfileId): PolicyConfig {
  return buildPolicy(LENDER_PROFILES[lenderId] || {});
}

// ============================================
// POLICY-AWARE CALCULATION HELPERS
// ============================================

/** Calculate income tax using policy tax config */
export function calculateIncomeTaxFromPolicy(
  taxableIncome: number,
  config: TaxConfig,
  includeMedicareLevy: boolean = true,
): number {
  if (taxableIncome <= 0) return 0;

  let tax = 0;
  for (const bracket of config.brackets) {
    if (taxableIncome >= bracket.min) {
      if (bracket.rate === 0) continue;
      if (taxableIncome <= bracket.max) {
        const prevMax = config.brackets[config.brackets.indexOf(bracket) - 1]?.max || 0;
        tax = bracket.base + (taxableIncome - prevMax) * bracket.rate;
        break;
      }
    }
  }

  if (includeMedicareLevy) {
    tax += taxableIncome * config.medicareLevyRate;
  }

  return Math.round(tax);
}

/** Get HECS repayment using policy config */
export function getHecsRepaymentFromPolicy(annualIncome: number, config: HecsConfig): number {
  for (const bracket of config.thresholds) {
    if (annualIncome >= bracket.min && annualIncome <= bracket.max) {
      return (annualIncome * bracket.rate) / 12;
    }
  }
  return (annualIncome * 0.10) / 12;
}

/** Get HEM benchmark using policy config */
export function getHemBenchmarkFromPolicy(
  maritalStatus: string | null,
  dependentsCount: number | null,
  grossAnnualIncome: number,
  config: HemConfig,
  /** `clients.secondary_first_name` — see `householdComposition.pure.ts`. */
  secondaryApplicantName?: string | null,
): number {
  const dependents = Math.min(dependentsCount || 0, 3);

  const category = householdCategory({ maritalStatus, secondaryApplicantName });
  const baseHem = config.baseBenchmarks[category][dependents] || config.baseBenchmarks[category][0];

  let multiplier = 1.0;
  for (const tier of config.incomeScaling) {
    if (grossAnnualIncome <= tier.maxIncome) {
      multiplier = tier.multiplier;
      break;
    }
  }

  return Math.round(baseHem * multiplier);
}

/** Determine serviceability band using policy thresholds */
export function determineServiceabilityBand(
  monthlySurplus: number,
  dtiRatio: number,
  thresholds: BandThresholds,
): 'green' | 'amber' | 'red' {
  if (monthlySurplus > thresholds.greenSurplusMin && dtiRatio < thresholds.greenDtiMax) {
    return 'green';
  } else if (monthlySurplus > 0 && dtiRatio < thresholds.amberDtiMax) {
    return 'amber';
  }
  return 'red';
}
