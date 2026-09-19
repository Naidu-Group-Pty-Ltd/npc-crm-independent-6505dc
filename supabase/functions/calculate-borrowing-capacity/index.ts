import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { canAccessClient } from '../_shared/clientAccess.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { computeDtiDenominator } from '../_shared/dtiDenominator.ts';
// Audit item 9 — the one place that decides whether a household is a couple.
// This used to be an inline list here, a second copy in `policyEngine.ts`, a
// third in `borrowingCapacityCalculations.ts` and a fourth, different, one in
// `BorrowingCapacityModal.tsx`, which is why the card and the calculator
// showed two capacities for the same client.
import {
  describeHousehold,
  householdCategory,
  type HouseholdComposition,
} from '../_shared/householdComposition.pure.ts';
// The same humanising the report normaliser applies on the way *out*, applied
// here on the way in — so `vehicle_loan` never reaches a client's audit row.
import { titleCase } from '../_shared/reports/borrowingCapacity/normalise.pure.ts';
import type { ScenarioIncomeComponent } from '../_shared/lenderShadingProfiles.ts';
import {
  aggregateDeltas,
  computeAcquisitionCapacity,
  type ScenarioDelta,
  type ScenarioContext as SharedScenarioContext,
  type ScenarioProperty as SharedScenarioProperty,
  type ScenarioLiability as SharedScenarioLiability,
  type AcquisitionContext as SharedAcquisitionContext,
} from '../_shared/scenarioDeltaEngine.ts';
import { reconcileSegments } from './segments/reconcile.ts';
import { internalError } from '../_shared/errorResponse.ts';



const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
};

// ============================================
// POLICY ENGINE — Single source of truth for all constants
// ============================================

interface IncomeShadingRule { rate: number; label: string; }
interface HemConfig {
  baseBenchmarks: Record<'single' | 'couple', Record<number, number>>;
  incomeScaling: { maxIncome: number; multiplier: number }[];
}
interface BandThresholds { greenSurplusMin: number; greenDtiMax: number; amberDtiMax: number; }
interface ConservativeModeConfig { minimumSurplusFloor: number; residualIncomeFloor: number; surplusBufferMultiplier: number; dtiHardCap: number; }
interface LoanDefaults { interestRate: number; bufferRate: number; loanTermYears: number; stressTestIncrement: number; dtiCap: number; }
interface PropertyPolicy { rentalShadingRate: number; proposedRentalShadingRate: number; vacancyRate: number; loanAssessmentRate: number; loanTermMonths: number; rentalExpenseRatio: number; }
interface LiabilityRules { creditCardLimitRate: number; bnplLimitRate: number; }
interface TaxConfig { taxYear: string; brackets: { min: number; max: number; rate: number; base: number }[]; medicareLevyRate: number; }
interface HecsConfig { thresholds: { min: number; max: number; rate: number }[]; }

interface PolicyConfig {
  name: string;
  incomeShadingRules: Record<string, IncomeShadingRule>;
  hem: HemConfig;
  bandThresholds: BandThresholds;
  conservativeMode: ConservativeModeConfig;
  loanDefaults: LoanDefaults;
  propertyPolicy: PropertyPolicy;
  liabilityRules: LiabilityRules;
  tax: TaxConfig;
  hecs: HecsConfig;
}

const DEFAULT_POLICY: PolicyConfig = {
  name: 'Default APRA',
  incomeShadingRules: {
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
  },
  hem: {
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
  },
  bandThresholds: { greenSurplusMin: 500, greenDtiMax: 6, amberDtiMax: 8 },
  conservativeMode: { minimumSurplusFloor: 1000, residualIncomeFloor: 1500, surplusBufferMultiplier: 0.85, dtiHardCap: 6 },
  loanDefaults: { interestRate: 6.50, bufferRate: 3.00, loanTermYears: 30, stressTestIncrement: 1.0, dtiCap: 6.0 },
  propertyPolicy: { rentalShadingRate: 0.80, proposedRentalShadingRate: 0.70, vacancyRate: 0.0, loanAssessmentRate: 0.095, loanTermMonths: 360, rentalExpenseRatio: 0.20 },
  liabilityRules: { creditCardLimitRate: 0.03, bnplLimitRate: 0.05 },
  tax: {
    taxYear: '2025-26',
    brackets: [
      { min: 0, max: 18200, rate: 0, base: 0 },
      { min: 18201, max: 45000, rate: 0.16, base: 0 },
      { min: 45001, max: 135000, rate: 0.30, base: 4288 },
      { min: 135001, max: 190000, rate: 0.37, base: 31288 },
      { min: 190001, max: Infinity, rate: 0.45, base: 51638 },
    ],
    medicareLevyRate: 0.02,
  },
  hecs: {
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
  },
};

// Lender profiles
const LENDER_PROFILES: Record<string, Partial<PolicyConfig>> = {
  default: { name: 'Default APRA' },
  conservative: {
    name: 'Conservative',
    loanDefaults: { ...DEFAULT_POLICY.loanDefaults, bufferRate: 3.50 },
    bandThresholds: { greenSurplusMin: 750, greenDtiMax: 5, amberDtiMax: 7 },
  },
  cba: {
    name: 'Commonwealth Bank',
    incomeShadingRules: { ...DEFAULT_POLICY.incomeShadingRules, casual: { rate: 0.50, label: "Casual Income (CBA)" }, bonus: { rate: 0.70, label: "Bonus (CBA)" } },
  },
  westpac: {
    name: 'Westpac',
    incomeShadingRules: { ...DEFAULT_POLICY.incomeShadingRules, overtime_non_essential: { rate: 0.40, label: "Non-Essential OT (Westpac)" } },
  },
  anz: {
    name: 'ANZ',
    liabilityRules: { creditCardLimitRate: 0.038, bnplLimitRate: 0.05 },
  },
  nab: {
    name: 'NAB',
    incomeShadingRules: { ...DEFAULT_POLICY.incomeShadingRules, commission: { rate: 0.70, label: "Commission (NAB)" } },
  },
  macquarie: {
    name: 'Macquarie Bank',
    loanDefaults: { ...DEFAULT_POLICY.loanDefaults, bufferRate: 2.50 },
    bandThresholds: { greenSurplusMin: 400, greenDtiMax: 7, amberDtiMax: 9 },
  },
};

function buildPolicy(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
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

function resolvePolicy(lenderName?: string | null): PolicyConfig {
  if (!lenderName) return DEFAULT_POLICY;
  const key = lenderName.toLowerCase().replace(/\s+/g, '');
  for (const [id, profile] of Object.entries(LENDER_PROFILES)) {
    if (key === id || key.includes(id) || id.includes(key)) {
      return buildPolicy(profile);
    }
  }
  return DEFAULT_POLICY;
}

// Backward-compatible aliases
const INCOME_SHADING_RULES = DEFAULT_POLICY.incomeShadingRules;
const RENTAL_EXPENSE_RATIO = DEFAULT_POLICY.propertyPolicy.rentalExpenseRatio;

// ============================================
// AUDIT TRAIL BUILDER (Phase 5) — inline for edge function
// ============================================

type AuditCategory = 'income' | 'expense' | 'liability' | 'property' | 'tax' | 'policy' | 'constraint';

interface AuditEntry {
  seq: number;
  category: AuditCategory;
  action: string;
  label: string;
  rawValue: number;
  assessedValue: number;
  rule: string;
  delta: number;
  impact: 'increase' | 'decrease' | 'neutral';
  note?: string;
}

interface AuditTrailData {
  entries: AuditEntry[];
  summary: {
    totalTransformations: number;
    byCategory: Record<AuditCategory, number>;
    totalIncomeShading: number;
    totalExpenseAdjustments: number;
    totalLiabilityAdjustments: number;
    totalTaxImpact: number;
    hasOverrides: boolean;
    hasConstraints: boolean;
  };
  generatedAt: string;
}

class AuditTrailBuilder {
  private entries: AuditEntry[] = [];
  private seq = 0;

  add(category: AuditCategory, action: string, label: string, rawValue: number, assessedValue: number, rule: string, note?: string): void {
    const delta = assessedValue - rawValue;
    this.entries.push({
      seq: ++this.seq, category, action, label,
      rawValue: Math.round(rawValue * 100) / 100,
      assessedValue: Math.round(assessedValue * 100) / 100,
      rule, delta: Math.round(delta * 100) / 100,
      impact: delta > 0.01 ? 'increase' : delta < -0.01 ? 'decrease' : 'neutral',
      note,
    });
  }

  build(): AuditTrailData {
    const byCategory: Record<AuditCategory, number> = { income: 0, expense: 0, liability: 0, property: 0, tax: 0, policy: 0, constraint: 0 };
    let totalIncomeShading = 0, totalExpenseAdjustments = 0, totalLiabilityAdjustments = 0, totalTaxImpact = 0;
    let hasOverrides = false, hasConstraints = false;
    for (const e of this.entries) {
      byCategory[e.category]++;
      if (e.category === 'income') totalIncomeShading += Math.abs(e.delta);
      if (e.category === 'expense') totalExpenseAdjustments += Math.abs(e.delta);
      if (e.category === 'liability') totalLiabilityAdjustments += Math.abs(e.delta);
      if (e.category === 'tax') totalTaxImpact += Math.abs(e.delta);
      if (e.action === 'override_applied') hasOverrides = true;
      if (e.category === 'constraint') hasConstraints = true;
    }
    return {
      entries: this.entries,
      summary: { totalTransformations: this.entries.length, byCategory, totalIncomeShading, totalExpenseAdjustments, totalLiabilityAdjustments, totalTaxImpact, hasOverrides, hasConstraints },
      generatedAt: new Date().toISOString(),
    };
  }
}

// ============================================
// EXPLANATION ENGINE (Phase 5) — inline for edge function
// ============================================

interface ExplanationStep {
  step: number;
  title: string;
  narrative: string;
  figures: { label: string; value: string }[];
  icon: string;
}

interface ExplanationReport {
  headline: string;
  steps: ExplanationStep[];
  executiveSummary: string;
  generatedAt: string;
}

function fmtCurrencyServer(value: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function fmtPercentServer(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}


function generateExplanationServer(p: {
  borrowingCapacity: number; monthlySurplus: number; serviceabilityBand: string;
  stressTestedCapacity: number; dtiRatio: number; assessmentRate: number;
  grossAnnualIncome: number; shadedAnnualIncome: number; incomeBreakdownCount: number;
  afterTaxAnnualIncome: number; totalTax: number; effectiveTaxRate: number; marginalTaxRate: number;
  livingExpensesMonthly: number; hemBenchmark: number; declaredExpenses: number;
  expenseMethod: string; negativePropertyCashFlows: number; totalLivingExpenses: number;
  existingCommitmentsMonthly: number; totalDebtBalances: number; liabilityCount: number;
  interestRate: number; bufferRate: number; loanTermYears: number;
  policyName: string; calculationMode: string; dtiCapEnabled: boolean; dtiCapLimit: number;
  lmiAmount: number; lmiMode: string; propertyCount: number;
}): ExplanationReport {
  const steps: ExplanationStep[] = [];
  let sn = 0;
  const fc = fmtCurrencyServer;
  const fp = fmtPercentServer;

  if (p.policyName !== 'Default APRA') {
    steps.push({ step: ++sn, title: 'Lender Policy Applied', narrative: `Uses "${p.policyName}" lender profile with specific buffer rates, shading rules, and thresholds.`, figures: [{ label: 'Profile', value: p.policyName }], icon: 'policy' });
  }

  const shadRed = p.grossAnnualIncome - p.shadedAnnualIncome;
  steps.push({ step: ++sn, title: 'Income Assessment', narrative: `Gross income of ${fc(p.grossAnnualIncome)} from ${p.incomeBreakdownCount} source(s) assessed at ${fc(p.shadedAnnualIncome)} after APRA shading${shadRed > 0 ? ` (−${fc(shadRed)} reduction)` : ''}.`, figures: [{ label: 'Gross', value: fc(p.grossAnnualIncome) }, { label: 'Shaded', value: fc(p.shadedAnnualIncome) }], icon: 'income' });

  steps.push({ step: ++sn, title: 'Tax & After-Tax Income', narrative: `Tax of ${fc(p.totalTax)} calculated (${fp(p.effectiveTaxRate)} effective, ${fp(p.marginalTaxRate)} marginal). After-tax income: ${fc(p.afterTaxAnnualIncome)}/yr (${fc(Math.round(p.afterTaxAnnualIncome / 12))}/mo).`, figures: [{ label: 'Tax', value: fc(p.totalTax) }, { label: 'After-Tax', value: fc(p.afterTaxAnnualIncome) }], icon: 'tax' });

  let expNar = p.expenseMethod === 'hem' ? `HEM of ${fc(p.hemBenchmark)}/mo used (exceeds declared ${fc(p.declaredExpenses)}/mo).` : p.expenseMethod === 'declared_higher' ? `Declared expenses of ${fc(p.declaredExpenses)}/mo used (exceeds HEM ${fc(p.hemBenchmark)}/mo).` : `Expenses of ${fc(p.livingExpensesMonthly)}/mo via override.`;
  if (p.negativePropertyCashFlows > 0) expNar += ` Plus ${fc(p.negativePropertyCashFlows)}/mo negative property CF → total ${fc(p.totalLivingExpenses)}/mo.`;
  steps.push({ step: ++sn, title: 'Living Expenses', narrative: expNar, figures: [{ label: 'Base', value: `${fc(p.livingExpensesMonthly)}/mo` }, { label: 'Total', value: `${fc(p.totalLivingExpenses)}/mo` }], icon: 'expense' });

  steps.push({ step: ++sn, title: 'Existing Commitments', narrative: `${p.liabilityCount} commitment(s) at ${fc(p.existingCommitmentsMonthly)}/mo. Total debt: ${fc(p.totalDebtBalances)}.`, figures: [{ label: 'Monthly', value: `${fc(p.existingCommitmentsMonthly)}/mo` }, { label: 'Debt', value: fc(p.totalDebtBalances) }], icon: 'liability' });

  const mAT = Math.round(p.afterTaxAnnualIncome / 12);
  steps.push({ step: ++sn, title: 'Capacity Derivation', narrative: `Surplus = ${fc(mAT)} − ${fc(p.totalLivingExpenses)} − ${fc(p.existingCommitmentsMonthly)} = ${fc(p.monthlySurplus)}/mo. At ${p.assessmentRate.toFixed(2)}% over ${p.loanTermYears}yr → max loan ${fc(p.borrowingCapacity)}.`, figures: [{ label: 'Surplus', value: `${fc(p.monthlySurplus)}/mo` }, { label: 'Capacity', value: fc(p.borrowingCapacity) }], icon: 'capacity' });

  steps.push({ step: ++sn, title: 'DTI Ratio', narrative: `DTI = (${fc(p.totalDebtBalances)} + ${fc(p.borrowingCapacity)}) / ${fc(p.grossAnnualIncome)} = ${p.dtiRatio.toFixed(1)}x.${p.dtiCapEnabled ? ` Cap at ${p.dtiCapLimit}x ${p.dtiRatio >= p.dtiCapLimit ? 'has constrained capacity.' : 'is not binding.'}` : ''}`, figures: [{ label: 'DTI', value: `${p.dtiRatio.toFixed(1)}x` }], icon: 'dti' });

  steps.push({ step: ++sn, title: 'Stress Test', narrative: `At +1% (${(p.assessmentRate + 1).toFixed(2)}%), stressed capacity is ${fc(p.stressTestedCapacity)} (−${fc(p.borrowingCapacity - p.stressTestedCapacity)}).`, figures: [{ label: 'Stressed', value: fc(p.stressTestedCapacity) }], icon: 'stress' });

  if (p.lmiMode !== 'none' && p.lmiAmount > 0) {
    steps.push({ step: ++sn, title: 'LMI', narrative: `LMI of ${fc(p.lmiAmount)} ${p.lmiMode === 'debt_capitalised' ? 'capitalised onto loan' : 'deducted from proceeds'}.`, figures: [{ label: 'LMI', value: fc(p.lmiAmount) }], icon: 'capacity' });
  }

  const bandDesc: Record<string, string> = { green: 'Strong position.', amber: 'Moderate — proceed with caution.', red: 'Limited — focus on debt reduction.' };
  steps.push({ step: ++sn, title: 'Serviceability Band', narrative: `${p.serviceabilityBand.toUpperCase()} band. ${bandDesc[p.serviceabilityBand] || ''}`, figures: [{ label: 'Band', value: p.serviceabilityBand.toUpperCase() }], icon: 'band' });

  return {
    headline: `Borrowing capacity of ${fc(p.borrowingCapacity)} on ${fc(p.grossAnnualIncome)} gross income — ${p.serviceabilityBand.toUpperCase()} serviceability.`,
    steps,
    executiveSummary: `On ${fc(p.grossAnnualIncome)} gross (${fc(p.shadedAnnualIncome)} shaded), after-tax ${fc(p.afterTaxAnnualIncome)}, expenses ${fc(p.totalLivingExpenses)}/mo, commitments ${fc(p.existingCommitmentsMonthly)}/mo → capacity ${fc(p.borrowingCapacity)} at ${p.assessmentRate.toFixed(2)}% over ${p.loanTermYears}yr. DTI ${p.dtiRatio.toFixed(1)}x. Band: ${p.serviceabilityBand.toUpperCase()}.`,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================
// PROPERTY CONTRIBUTION ENGINE (Phase 1)
// Unified per-property assessment model
// ============================================

// PropertyContributionPolicy now uses PolicyConfig.propertyPolicy
type PropertyContributionPolicy = PropertyPolicy;

interface PropertyContributionResult {
  propertyId: string;
  address: string;
  propertyType: string;
  rawMonthlyRent: number;
  rawNetMonthlyCashflow: number;
  rawLoanBalance: number;
  rawMonthlyRepayment: number;
  assessedMonthlyRent: number;
  assessedMonthlyDebt: number;
  assessedMonthlyHoldingCosts: number;
  netMonthlyContribution: number;
  legacyIncomeContribution: number;
  legacyExpenseContribution: number;
  legacyLiabilityContribution: number;
  legacyDebtBalance: number;
  auditNotes: string[];
}

interface PropertyContributionSummary {
  properties: PropertyContributionResult[];
  totalLegacyIncome: number;
  totalLegacyExpense: number;
  totalLegacyLiability: number;
  totalLegacyDebtBalance: number;
  totalNetMonthlyContribution: number;
}

/**
 * Fix #1 — APRA APG-223 aligned existing-debt assessment.
 *
 * Problem this replaces:
 *   The legacy logic blanket-converted EVERY existing property loan to a fresh
 *   30-year P&I at the lender's full stress rate (~9.5%). This penalised
 *   Interest-Only loans by ~$2.9k/mo for clients like Masline Nyawo, costing
 *   ~$350k of capacity vs. how real lenders (and broker tools like Quickly)
 *   model existing debt.
 *
 * New rules (in priority order):
 *   1. Interest-Only loan, IO period NOT yet expired:
 *        assessed = balance × actualRate / 12   (true I/O cost — no buffer,
 *        no P&I conversion). This mirrors APG-223 §41 ("during the I/O period,
 *        assess at the contracted I/O repayment").
 *   2. Principal & Interest (or expired I/O) with known actualRate:
 *        assessed = PMT(balance, actualRate + EXISTING_DEBT_BUFFER, remainingTerm)
 *        where remainingTerm = max(original_term − elapsed, 5y) and
 *        EXISTING_DEBT_BUFFER = 1.0% (broker-standard "existing debt buffer",
 *        distinct from the +3% APRA buffer applied to NEW loans).
 *   3. Missing repayment_type or actualRate (legacy data):
 *        Fall back to the old PMT(balance, policy.loanAssessmentRate, 360m)
 *        and flag in audit so we can identify dirty data.
 *
 * In every branch we take max(assessed, actualRepayment) so we never under-
 * assess relative to what the client is demonstrably already paying.
 */
const EXISTING_DEBT_BUFFER_PCT = 0.01; // +1% on top of contracted rate for existing P&I
const MIN_REMAINING_TERM_MONTHS = 60; // floor remaining term at 5y to avoid PMT blowup

interface ExistingLoanAssessment {
  assessedMonthlyDebt: number;
  method: 'io_actual' | 'pi_remaining_term' | 'legacy_fallback';
  effectiveRatePct: number;
  termMonthsUsed: number;
  auditNote: string;
}

function assessExistingPropertyLoan(
  property: any,
  policy: PropertyContributionPolicy,
): ExistingLoanAssessment {
  const balance = Number(property.loan_remaining) || 0;
  if (balance <= 0) {
    return { assessedMonthlyDebt: 0, method: 'legacy_fallback', effectiveRatePct: 0, termMonthsUsed: 0, auditNote: 'No loan balance' };
  }

  const actualRepayment = Number(property.monthly_interest_repayment) || 0;
  const actualRatePct = Number(property.interest_rate); // expected as percentage e.g. 6.44
  const repaymentType = (property.repayment_type || '').toLowerCase();
  const ioPeriodYears = Number(property.interest_only_period_years) || 0;
  const purchaseDate = property.purchase_date ? new Date(property.purchase_date) : null;

  // Compute elapsed months since purchase (used for both IO-expiry & remaining-term math)
  let elapsedMonths = 0;
  if (purchaseDate && !isNaN(purchaseDate.getTime())) {
    const now = new Date();
    elapsedMonths = Math.max(
      0,
      (now.getFullYear() - purchaseDate.getFullYear()) * 12 +
        (now.getMonth() - purchaseDate.getMonth()),
    );
  }

  const isIO = repaymentType.includes('interest') && repaymentType.includes('only');
  const isPI = repaymentType === 'principal_and_interest' || repaymentType === 'p&i' || repaymentType === 'pi';
  // If IO period is unknown (NULL/0), default to "still in IO" — bank-aligned conservative
  // assumption: when origination data is missing, honour the loan's stated current state.
  const ioPeriodKnown = ioPeriodYears > 0;
  const ioRemainingMonths = ioPeriodKnown ? Math.max(0, ioPeriodYears * 12 - elapsedMonths) : Infinity;
  const ioStillActive = isIO && (ioPeriodKnown ? ioRemainingMonths > 0 : true);

  // ── Branch 1: Interest-Only, still in IO period (or IO period unknown → assume active) ──
  if (ioStillActive && actualRatePct > 0) {
    const ioMonthlyCost = (balance * (actualRatePct / 100)) / 12;
    const assessed = Math.max(ioMonthlyCost, actualRepayment);
    const ioNote = ioPeriodKnown
      ? `IO remaining: ${ioRemainingMonths}mo`
      : `IO period not specified — assumed currently active`;
    return {
      assessedMonthlyDebt: assessed,
      method: 'io_actual',
      effectiveRatePct: actualRatePct,
      termMonthsUsed: 0,
      auditNote: `I/O assessed at actual rate ${actualRatePct.toFixed(2)}% (${ioNote})`,
    };
  }

  // ── Branch 2: P&I (or IO that has expired) with a known rate ──
  if ((isPI || (isIO && ioPeriodKnown && ioRemainingMonths === 0)) && actualRatePct > 0) {
    const originalTermMonths = 30 * 12; // assume 30y origination if not stored
    const remainingTermMonths = Math.max(MIN_REMAINING_TERM_MONTHS, originalTermMonths - elapsedMonths);
    const assessmentRatePct = actualRatePct + EXISTING_DEBT_BUFFER_PCT * 100;
    const monthlyRate = assessmentRatePct / 100 / 12;
    const piRepayment =
      balance *
      (monthlyRate * Math.pow(1 + monthlyRate, remainingTermMonths)) /
      (Math.pow(1 + monthlyRate, remainingTermMonths) - 1);
    const assessed = Math.max(piRepayment, actualRepayment);
    return {
      assessedMonthlyDebt: assessed,
      method: 'pi_remaining_term',
      effectiveRatePct: assessmentRatePct,
      termMonthsUsed: remainingTermMonths,
      auditNote: `P&I assessed at actual+1% (${assessmentRatePct.toFixed(2)}%) over remaining ${Math.round(remainingTermMonths / 12)}y${isIO ? ' (IO expired)' : ''}`,
    };
  }

  // ── Branch 3: Legacy fallback — no repayment_type or no rate ──
  const monthlyRate = policy.loanAssessmentRate / 12;
  const piRepayment =
    balance *
    (monthlyRate * Math.pow(1 + monthlyRate, policy.loanTermMonths)) /
    (Math.pow(1 + monthlyRate, policy.loanTermMonths) - 1);
  const assessed = Math.max(piRepayment, actualRepayment);
  return {
    assessedMonthlyDebt: assessed,
    method: 'legacy_fallback',
    effectiveRatePct: policy.loanAssessmentRate * 100,
    termMonthsUsed: policy.loanTermMonths,
    auditNote: `Legacy fallback @ stress ${(policy.loanAssessmentRate * 100).toFixed(2)}% / ${policy.loanTermMonths / 12}y (missing repayment_type or interest_rate — flag for data cleanup)`,
  };
}

function assessPropertyContribution(
  property: any,
  policy: PropertyContributionPolicy = DEFAULT_PROPERTY_POLICY,
): PropertyContributionResult {
  const propertyType = property.property_type?.toLowerCase() || '';
  const address = property.address?.substring(0, 40) || 'Property';
  const auditNotes: string[] = [];

  if (propertyType === 'rental') {
    const monthlyRentPaid = property.monthly_rental_income || 0;
    auditNotes.push(`Rental: client pays ${fmtCurrencyServer(monthlyRentPaid)}/mo`);
    return {
      propertyId: property.id || '',
      address, propertyType,
      rawMonthlyRent: 0, rawNetMonthlyCashflow: 0, rawLoanBalance: 0, rawMonthlyRepayment: 0,
      assessedMonthlyRent: 0, assessedMonthlyDebt: 0, assessedMonthlyHoldingCosts: 0,
      netMonthlyContribution: -monthlyRentPaid,
      legacyIncomeContribution: 0, legacyExpenseContribution: 0,
      legacyLiabilityContribution: monthlyRentPaid, legacyDebtBalance: 0,
      auditNotes,
    };
  }

  const rawNetMonthlyCashflow = property.net_monthly_cashflow || 0;
  const rawMonthlyRent = property.monthly_rental_income || 0;
  const rawLoanBalance = property.loan_remaining || 0;
  const rawMonthlyRepayment = property.monthly_interest_repayment || 0;

  const assessedMonthlyRent = rawMonthlyRent * policy.rentalShadingRate * (1 - policy.vacancyRate);

  // Fix #1 — APRA-aligned existing debt assessment (replaces blanket 9.5%/30y P&I)
  let assessedMonthlyDebt = 0;
  if (rawLoanBalance > 0) {
    const loanAssessment = assessExistingPropertyLoan(property, policy);
    assessedMonthlyDebt = loanAssessment.assessedMonthlyDebt;
    auditNotes.push(`Loan: ${loanAssessment.auditNote} → $${assessedMonthlyDebt.toFixed(2)}/mo`);
  }

  const assessedMonthlyHoldingCosts = 0;
  const netMonthlyContribution = assessedMonthlyRent - assessedMonthlyDebt - assessedMonthlyHoldingCosts;

  let legacyIncomeContribution = 0;
  if (rawNetMonthlyCashflow > 0) {
    legacyIncomeContribution = rawNetMonthlyCashflow * 12 * policy.rentalShadingRate;
  }

  let legacyExpenseContribution = 0;
  if (rawNetMonthlyCashflow < 0) {
    legacyExpenseContribution = Math.abs(rawNetMonthlyCashflow);
  }

  const legacyLiabilityContribution = rawLoanBalance > 0 ? Math.round(assessedMonthlyDebt * 100) / 100 : 0;

  auditNotes.push(`Net contribution: $${netMonthlyContribution.toFixed(2)}/mo`);
  auditNotes.push(`Legacy: income=$${legacyIncomeContribution.toFixed(2)}/yr, expense=$${legacyExpenseContribution.toFixed(2)}/mo, liability=$${legacyLiabilityContribution.toFixed(2)}/mo`);

  return {
    propertyId: property.id || '', address, propertyType,
    rawMonthlyRent, rawNetMonthlyCashflow, rawLoanBalance, rawMonthlyRepayment,
    assessedMonthlyRent, assessedMonthlyDebt, assessedMonthlyHoldingCosts,
    netMonthlyContribution,
    legacyIncomeContribution, legacyExpenseContribution, legacyLiabilityContribution,
    legacyDebtBalance: rawLoanBalance,
    auditNotes,
  };
}

function assessAllPropertyContributions(
  properties: any[],
  policy: PropertyContributionPolicy = DEFAULT_PROPERTY_POLICY,
): PropertyContributionSummary {
  const results: PropertyContributionResult[] = [];
  let totalLegacyIncome = 0;
  let totalLegacyExpense = 0;
  let totalLegacyLiability = 0;
  let totalLegacyDebtBalance = 0;
  let totalNetMonthlyContribution = 0;

  for (const property of properties) {
    const result = assessPropertyContribution(property, policy);
    results.push(result);
    totalLegacyIncome += result.legacyIncomeContribution;
    totalLegacyExpense += result.legacyExpenseContribution;
    totalLegacyLiability += result.legacyLiabilityContribution;
    totalLegacyDebtBalance += result.legacyDebtBalance;
    totalNetMonthlyContribution += result.netMonthlyContribution;
  }

  return {
    properties: results,
    totalLegacyIncome, totalLegacyExpense, totalLegacyLiability,
    totalLegacyDebtBalance, totalNetMonthlyContribution,
  };
}

// Tax functions now use policy config (backward-compatible wrappers)
const TAX_BRACKETS_2025_26 = DEFAULT_POLICY.tax.brackets;
const MEDICARE_LEVY_RATE = DEFAULT_POLICY.tax.medicareLevyRate;

function calculateIncomeTax(taxableIncome: number, includeMedicareLevy: boolean = true): number {
  if (taxableIncome <= 0) return 0;
  
  let tax = 0;
  
  for (const bracket of TAX_BRACKETS_2025_26) {
    if (taxableIncome >= bracket.min) {
      if (bracket.rate === 0) continue;
      if (taxableIncome <= bracket.max) {
        const previousBracketMax = TAX_BRACKETS_2025_26[TAX_BRACKETS_2025_26.indexOf(bracket) - 1]?.max || 0;
        tax = bracket.base + (taxableIncome - previousBracketMax) * bracket.rate;
        break;
      }
    }
  }
  
  if (includeMedicareLevy) {
    tax += taxableIncome * MEDICARE_LEVY_RATE;
  }
  
  return Math.round(tax);
}

function getMarginalTaxRate(taxableIncome: number, includeMedicareLevy: boolean = true): number {
  if (taxableIncome <= 0) return 0;
  
  let marginalRate = 0;
  for (const bracket of TAX_BRACKETS_2025_26) {
    if (taxableIncome >= bracket.min && taxableIncome <= bracket.max) {
      marginalRate = bracket.rate;
      break;
    }
  }
  
  if (includeMedicareLevy) {
    marginalRate += MEDICARE_LEVY_RATE;
  }
  
  return marginalRate;
}

function getTaxBreakdown(grossAnnualIncome: number) {
  const taxWithoutMedicare = calculateIncomeTax(grossAnnualIncome, false);
  const medicareLevy = Math.round(grossAnnualIncome * MEDICARE_LEVY_RATE);
  const totalTax = taxWithoutMedicare + medicareLevy;
  const afterTaxIncome = grossAnnualIncome - totalTax;
  const marginalRate = getMarginalTaxRate(grossAnnualIncome, true);
  
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

// HECS thresholds now sourced from policy
const HECS_THRESHOLDS = DEFAULT_POLICY.hecs.thresholds;

interface IncomeBreakdownItem {
  component: string;
  grossAmount: number;
  shadingRate: number;
  shadedAmount: number;
}

interface LiabilityBreakdownItem {
  type: string;
  balance: number;
  limit?: number;
  monthlyServicing: number;
}

interface CalculationResult {
  borrowingCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  stressTestedCapacity: number;
  dtiRatio: number;
  assessmentRate: number;
  recommendations: string[];
  warnings: string[];
}

function getHecsRepayment(annualIncome: number): number {
  for (const bracket of HECS_THRESHOLDS) {
    if (annualIncome >= bracket.min && annualIncome <= bracket.max) {
      return (annualIncome * bracket.rate) / 12; // Monthly
    }
  }
  return (annualIncome * 0.10) / 12;
}

function getHemBenchmark(household: HouseholdComposition, dependentsCount: number | null, grossAnnualIncome: number = 0, hemConfig: HemConfig = DEFAULT_POLICY.hem): number {
  const dependents = Math.min(dependentsCount || 0, 3);

  // Takes the whole household rather than the status string, so a second
  // applicant cannot be left out of the classification by a call site that
  // did not think to pass them. That omission is audit item 9.
  const category = householdCategory(household);
  const baseHem = hemConfig.baseBenchmarks[category][dependents] || hemConfig.baseBenchmarks[category][0];
  
  let multiplier = 1.0;
  for (const tier of hemConfig.incomeScaling) {
    if (grossAnnualIncome <= tier.maxIncome) {
      multiplier = tier.multiplier;
      break;
    }
  }
  
  return Math.round(baseHem * multiplier);
}

function calculateIncomeBreakdown(incomeRecords: any[], properties: any[], incomeSources: any[]): { 
  grossTotal: number;
  shadedTotal: number;
  breakdown: IncomeBreakdownItem[];
} {
  const breakdown: IncomeBreakdownItem[] = [];
  let grossTotal = 0;
  let shadedTotal = 0;

  // Prefer new multi-source income table (client_income_sources) over legacy client_income
  const useNewSources = incomeSources && incomeSources.length > 0;

  if (useNewSources) {
    // Process from client_income_sources (supports primary, secondary, additional contacts)
    for (const src of incomeSources) {
      const contactLabel = src.contact_type === 'primary' ? 'Primary' : 
        src.contact_type === 'secondary' ? 'Secondary' : src.contact_type;
      const sourceName = src.source_name || src.source_type || 'Income';
      const effectiveShading = src.custom_shading_rate ?? src.default_shading_rate ?? 1.0;

      // Base gross annual amount
      const grossAnnual = Number(src.gross_annual_amount) || 0;
      if (grossAnnual > 0) {
        grossTotal += grossAnnual;
        const shadedAmount = grossAnnual * effectiveShading;
        shadedTotal += shadedAmount;
        breakdown.push({
          component: `${contactLabel} ${sourceName}`,
          grossAmount: grossAnnual,
          shadingRate: effectiveShading,
          shadedAmount,
        });
      }

      // Employment sub-fields with their own shading
      const subFields = [
        { key: 'bonus', label: 'Bonus', shading: INCOME_SHADING_RULES.bonus.rate },
        { key: 'commission', label: 'Commission', shading: INCOME_SHADING_RULES.commission.rate },
        { key: 'overtime_essential', label: 'Essential OT', shading: INCOME_SHADING_RULES.overtime_essential.rate },
        { key: 'overtime_non_essential', label: 'Non-Essential OT', shading: INCOME_SHADING_RULES.overtime_non_essential.rate },
        { key: 'allowance', label: 'Allowance', shading: INCOME_SHADING_RULES.allowance.rate },
        { key: 'other_taxable_income', label: 'Other Taxable', shading: INCOME_SHADING_RULES.other_taxable.rate },
      ];
      for (const { key, label, shading } of subFields) {
        const val = Number(src[key]) || 0;
        if (val > 0) {
          grossTotal += val;
          const shadedAmount = val * shading;
          shadedTotal += shadedAmount;
          breakdown.push({
            component: `${contactLabel} ${label}`,
            grossAmount: val,
            shadingRate: shading,
            shadedAmount,
          });
        }
      }
    }
  } else {
    // Fallback: Process from legacy client_income table
    for (const income of incomeRecords) {
      if (income.gross_salary && income.gross_salary > 0) {
        const frequency = income.salary_frequency?.toLowerCase() || 'annual';
        let annualAmount = income.gross_salary;
        if (frequency === 'monthly') annualAmount *= 12;
        else if (frequency === 'fortnightly') annualAmount *= 26;
        else if (frequency === 'weekly') annualAmount *= 52;
        
        const rule = INCOME_SHADING_RULES.gross_salary;
        grossTotal += annualAmount;
        shadedTotal += annualAmount * rule.rate;
        breakdown.push({ component: rule.label, grossAmount: annualAmount, shadingRate: rule.rate, shadedAmount: annualAmount * rule.rate });
      }
      const legacyFields = [
        { key: 'bonus', rule: INCOME_SHADING_RULES.bonus },
        { key: 'commission', rule: INCOME_SHADING_RULES.commission },
        { key: 'overtime_essential', rule: INCOME_SHADING_RULES.overtime_essential },
        { key: 'overtime_non_essential', rule: INCOME_SHADING_RULES.overtime_non_essential },
        { key: 'allowance', rule: INCOME_SHADING_RULES.allowance },
        { key: 'other_taxable_income', rule: INCOME_SHADING_RULES.other_taxable },
      ];
      for (const { key, rule } of legacyFields) {
        const val = Number(income[key]) || 0;
        if (val > 0) {
          grossTotal += val;
          shadedTotal += val * rule.rate;
          breakdown.push({ component: rule.label, grossAmount: val, shadingRate: rule.rate, shadedAmount: val * rule.rate });
        }
      }
    }
  }

  // Add POSITIVE property cash flows as income
  for (const property of properties) {
    const propertyType = property.property_type?.toLowerCase() || '';
    if (propertyType === 'rental') continue;
    
    const netMonthlyCashflow = property.net_monthly_cashflow || 0;
    if (netMonthlyCashflow > 0) {
      const annualPositiveCashflow = netMonthlyCashflow * 12;
      const rule = INCOME_SHADING_RULES.rental_existing;
      grossTotal += annualPositiveCashflow;
      const shadedAmount = annualPositiveCashflow * rule.rate;
      shadedTotal += shadedAmount;
      breakdown.push({
        component: `Positive Cash Flow (${property.address?.substring(0, 30) || 'Property'}...)`,
        grossAmount: annualPositiveCashflow,
        shadingRate: rule.rate,
        shadedAmount,
      });
    }
  }

  return { grossTotal, shadedTotal, breakdown };
}

function mapIncomeTypeToDtiComponent(sourceType?: string | null): ScenarioIncomeComponent['type'] {
  const t = (sourceType || '').toLowerCase();
  if (t.includes('salary') || t.includes('payg') || t.includes('wage')) return 'base_salary';
  if (t.includes('self')) return 'self_employed';
  if (t.includes('bonus')) return 'bonus';
  if (t.includes('commission')) return 'commission';
  if (t.includes('allowance')) return 'allowance';
  if (t.includes('overtime') && t.includes('essential')) return 'overtime_essential';
  if (t.includes('overtime')) return 'overtime_non_essential';
  if (t.includes('rental')) return 'rental_residential';
  if (t.includes('dividend') || t.includes('investment')) return 'investment_dividend';
  if (t.includes('family') && t.includes('benefit')) return 'family_tax_benefit';
  if (t.includes('centrelink')) return 'centrelink_other';
  if (t.includes('child') && t.includes('support')) return 'child_support';
  return 'other';
}

function buildDtiIncomeComponents(incomeRecords: any[], incomeSources: any[], properties: any[]): ScenarioIncomeComponent[] {
  const components: ScenarioIncomeComponent[] = [];

  if ((incomeSources || []).length > 0) {
    for (const src of incomeSources) {
      const grossAnnual = Number(src.gross_annual_amount) || 0;
      const baseType = mapIncomeTypeToDtiComponent(src.source_type || src.source_name);
      const baseRate = Number(src.custom_shading_rate ?? src.default_shading_rate ?? 1);
      if (grossAnnual > 0) {
        components.push({
          id: `${src.id}-base`,
          label: src.source_name || src.source_type || 'Income',
          type: baseType,
          grossAnnual,
          currentShadingRate: Number.isFinite(baseRate) ? baseRate : 1,
        });
      }

      const fields: Array<{ key: string; type: ScenarioIncomeComponent['type']; label: string; rate: number }> = [
        { key: 'bonus', type: 'bonus', label: 'Bonus', rate: 0.8 },
        { key: 'commission', type: 'commission', label: 'Commission', rate: 0.8 },
        { key: 'overtime_essential', type: 'overtime_essential', label: 'Essential Overtime', rate: 1.0 },
        { key: 'overtime_non_essential', type: 'overtime_non_essential', label: 'Non-Essential Overtime', rate: 0.5 },
        { key: 'allowance', type: 'allowance', label: 'Allowance', rate: 0.8 },
        { key: 'other_taxable_income', type: 'other', label: 'Other Taxable', rate: 0.8 },
      ];

      for (const f of fields) {
        const v = Number(src[f.key]) || 0;
        if (v <= 0) continue;
        components.push({
          id: `${src.id}-${f.key}`,
          label: `${src.source_name || 'Income'} ${f.label}`,
          type: f.type,
          grossAnnual: v,
          currentShadingRate: f.rate,
        });
      }
    }
  } else {
    for (const income of incomeRecords || []) {
      const salary = Number(income.gross_salary) || 0;
      if (salary > 0) {
        const frequency = (income.salary_frequency || 'annual').toLowerCase();
        const annualAmount =
          frequency === 'monthly' ? salary * 12 :
          frequency === 'fortnightly' ? salary * 26 :
          frequency === 'weekly' ? salary * 52 :
          salary;
        components.push({
          id: `${income.id}-salary`,
          label: 'Base Salary',
          type: 'base_salary',
          grossAnnual: annualAmount,
          currentShadingRate: 1,
        });
      }

      const fields: Array<{ key: string; type: ScenarioIncomeComponent['type']; label: string; rate: number }> = [
        { key: 'bonus', type: 'bonus', label: 'Bonus', rate: 0.8 },
        { key: 'commission', type: 'commission', label: 'Commission', rate: 0.8 },
        { key: 'overtime_essential', type: 'overtime_essential', label: 'Essential Overtime', rate: 1.0 },
        { key: 'overtime_non_essential', type: 'overtime_non_essential', label: 'Non-Essential Overtime', rate: 0.5 },
        { key: 'allowance', type: 'allowance', label: 'Allowance', rate: 0.8 },
        { key: 'other_taxable_income', type: 'other', label: 'Other Taxable', rate: 0.8 },
      ];
      for (const f of fields) {
        const v = Number(income[f.key]) || 0;
        if (v <= 0) continue;
        components.push({
          id: `${income.id}-${f.key}`,
          label: f.label,
          type: f.type,
          grossAnnual: v,
          currentShadingRate: f.rate,
        });
      }
    }
  }

  for (const property of properties || []) {
    const propertyType = property.property_type?.toLowerCase() || '';
    if (propertyType === 'rental') continue;
    const netMonthlyCashflow = Number(property.net_monthly_cashflow) || 0;
    if (netMonthlyCashflow > 0) {
      components.push({
        id: `property-${property.id}-net-cf`,
        label: `Property Net CF (${property.address?.substring(0, 24) || 'Property'})`,
        type: 'rental_residential',
        grossAnnual: netMonthlyCashflow * 12,
        currentShadingRate: DEFAULT_POLICY.propertyPolicy.rentalShadingRate,
      });
    }
  }

  return components.filter(c => Number.isFinite(c.grossAnnual) && c.grossAnnual > 0);
}

// Calculate negative property cash flows to be layered on top of expenses
function calculateNegativePropertyCashFlows(properties: any[]): {
  totalMonthly: number;
  breakdown: { address: string; monthlyCashflow: number }[];
} {
  let totalMonthly = 0;
  const breakdown: { address: string; monthlyCashflow: number }[] = [];

  for (const property of properties) {
    const propertyType = property.property_type?.toLowerCase() || '';
    
    // Skip rental properties (where client pays rent) - handled separately
    if (propertyType === 'rental') continue;
    
    const netMonthlyCashflow = property.net_monthly_cashflow || 0;
    
    // Only include NEGATIVE cash flows as additional expenses
    if (netMonthlyCashflow < 0) {
      const absoluteCashflow = Math.abs(netMonthlyCashflow);
      totalMonthly += absoluteCashflow;
      breakdown.push({
        address: property.address?.substring(0, 40) || 'Investment Property',
        monthlyCashflow: absoluteCashflow,
      });
    }
  }

  return { totalMonthly, breakdown };
}

function calculateLiabilityBreakdown(liabilities: any[], properties: any[], annualIncome: number, policy: PolicyConfig = DEFAULT_POLICY): {
  totalMonthly: number;
  breakdown: LiabilityBreakdownItem[];
} {
  const breakdown: LiabilityBreakdownItem[] = [];
  let totalMonthly = 0;

  // Process liabilities
  for (const liability of liabilities) {
    const type = liability.liability_type?.toLowerCase() || 'other';
    let monthlyServicing = 0;

    if (type.includes('credit') || type.includes('card')) {
      // Credit card: % of credit limit from policy
      const limit = liability.credit_limit || liability.current_balance || 0;
      monthlyServicing = limit * policy.liabilityRules.creditCardLimitRate;
      breakdown.push({
        type: 'Credit Card',
        balance: liability.current_balance || 0,
        limit,
        monthlyServicing,
      });
    } else if (type.includes('hecs') || type.includes('help')) {
      // HECS: Based on income threshold
      monthlyServicing = getHecsRepayment(annualIncome);
      breakdown.push({
        type: 'HECS/HELP',
        balance: liability.current_balance || 0,
        monthlyServicing,
      });
    } else if (type.includes('afterpay') || type.includes('bnpl') || type.includes('buy now')) {
      // BNPL: % of limit from policy or actual monthly
      const limit = liability.credit_limit || liability.current_balance || 0;
      monthlyServicing = Math.max(limit * policy.liabilityRules.bnplLimitRate, liability.monthly_repayment || 0);
      breakdown.push({
        type: 'Buy Now Pay Later',
        balance: liability.current_balance || 0,
        limit,
        monthlyServicing,
      });
    } else {
      // All other loans: Use actual repayment.
      //
      // `type` becomes the *label* of an audit row a client reads, and the three
      // branches above all write a display name. This one passed the raw column
      // through, so the audit trail printed `vehicle_loan` and `personal_loan`
      // five pages after the liabilities table had correctly called the same two
      // things "Vehicle Loan" and "Personal Loan".
      monthlyServicing = liability.monthly_repayment || 0;
      breakdown.push({
        type: titleCase(String(liability.liability_type ?? '')) || 'Other Loan',
        balance: liability.current_balance || 0,
        monthlyServicing,
      });
    }

    totalMonthly += monthlyServicing;
  }

  // Owned properties are represented via net_monthly_cashflow in income/expense
  // paths, so we do NOT add property-loan servicing here (prevents double count).
  // Rental-as-tenant commitments are still included below.
  for (const property of properties) {
    const propertyType = property.property_type?.toLowerCase() || '';

    // Handle rental properties (where client is tenant paying rent)
    if (propertyType === 'rental') {
      // Rent paid is treated as an existing commitment
      const monthlyRentPaid = property.monthly_rental_income || 0;
      if (monthlyRentPaid > 0) {
        totalMonthly += monthlyRentPaid;
        breakdown.push({
          type: `Rent Expense (${property.address?.substring(0, 30) || 'Rental'}...)`,
          balance: 0,
          monthlyServicing: monthlyRentPaid,
        });
      }
    }
  }

  return { totalMonthly, breakdown };
}

// Conservative mode + DTI cap now sourced from policy
const CONSERVATIVE_MODE_ADJUSTMENTS = DEFAULT_POLICY.conservativeMode;
const DEFAULT_DTI_CAP = DEFAULT_POLICY.loanDefaults.dtiCap;

function calculateBorrowingCapacity(params: {
  grossAnnualIncome: number;
  shadedAnnualIncome: number;
  monthlyLivingExpenses: number;
  monthlyCommitments: number;
  interestRate: number;
  bufferRate: number;
  loanTermYears: number;
  totalDebtBalances: number;
  calculationMode?: 'bank' | 'conservative';
  dtiCapEnabled?: boolean;
  dtiCapLimit?: number;
  policy?: PolicyConfig;
  /** Phase I11 — APS 220-aligned DTI denominator (rental @ 75%, etc.).
   *  When supplied, the DTI cap PATH uses this rather than headline gross. */
  dtiAdjustedAnnualIncome?: number;
}): CalculationResult & { afterTaxAnnualIncome: number; monthlyAfterTaxIncome: number } {
  const activePolicy = params.policy || DEFAULT_POLICY;
  const { grossAnnualIncome, shadedAnnualIncome, monthlyLivingExpenses, monthlyCommitments, 
          interestRate, bufferRate, loanTermYears,
          calculationMode = 'bank', dtiCapEnabled = false, dtiCapLimit = activePolicy.loanDefaults.dtiCap,
          dtiAdjustedAnnualIncome } = params;
  
  const isConservative = calculationMode === 'conservative';
  const conservativeConfig = activePolicy.conservativeMode;
  
  // Assessment rate = current rate + APRA buffer
  const assessmentRate = interestRate + bufferRate;
  const monthlyRate = (assessmentRate / 100) / 12;
  
  // *** Phase A1/A4 FIX: Tax must be applied to SHADED (assessable) income ***
  // Banks assess serviceability on income they actually count — not raw gross.
  // Using gross overstated take-home for variable-income clients (bonus/commission/casual).
  const assessableIncome = shadedAnnualIncome > 0 ? shadedAnnualIncome : grossAnnualIncome;
  const taxBreakdown = getTaxBreakdown(assessableIncome);
  const afterTaxAnnualIncome = taxBreakdown.afterTaxIncome;
  const monthlyAfterTaxIncome = afterTaxAnnualIncome / 12;
  
  const monthlyIncome = monthlyAfterTaxIncome;
  let monthlySurplus = monthlyIncome - monthlyLivingExpenses - monthlyCommitments;
  
  // Conservative mode adjustments (mirrors client-side logic exactly)
  if (isConservative) {
    monthlySurplus = monthlySurplus * conservativeConfig.surplusBufferMultiplier;
    
    // *** Phase A2 FIX: Enforce real minimum surplus floor (was a no-op clamp) ***
    if (monthlySurplus < conservativeConfig.minimumSurplusFloor) {
      monthlySurplus = 0;
    }
    
    const residualIncome = monthlyIncome - monthlyCommitments;
    if (residualIncome < conservativeConfig.residualIncomeFloor) {
      const shortfall = conservativeConfig.residualIncomeFloor - residualIncome;
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
  
  // DTI ratio - Industry standard: Total Outstanding Debt Balances / Gross Annual Income.
  // Phase I11 — when caller supplied APS 220-aligned denominator, use it for the
  // CAP PATH so DTI-binding scenarios match the broker UI exactly.
  const dtiDenominator = (typeof dtiAdjustedAnnualIncome === 'number' && dtiAdjustedAnnualIncome > 0)
    ? dtiAdjustedAnnualIncome
    : params.grossAnnualIncome;
  const totalDebtWithNewLoan = params.totalDebtBalances + borrowingCapacity;
  let dtiRatio = dtiDenominator > 0 ? Math.round((totalDebtWithNewLoan / dtiDenominator) * 100) / 100 : 0;
  
  // Apply DTI cap if enabled or in conservative mode
  const effectiveDtiCap = isConservative ? conservativeConfig.dtiHardCap : dtiCapLimit;
  const shouldApplyDtiCap = dtiCapEnabled || isConservative;
  
  if (shouldApplyDtiCap && dtiRatio > effectiveDtiCap && dtiDenominator > 0) {
    const maxTotalDebt = dtiDenominator * effectiveDtiCap;
    const maxNewLoan = Math.max(0, maxTotalDebt - params.totalDebtBalances);
    
    if (maxNewLoan < borrowingCapacity) {
      borrowingCapacity = Math.round(maxNewLoan);
      dtiRatio = Math.round(((params.totalDebtBalances + borrowingCapacity) / dtiDenominator) * 100) / 100;
    }
  }
  
  // Stress test at policy-configured increment above assessment rate
  const stressRate = ((assessmentRate + activePolicy.loanDefaults.stressTestIncrement) / 100) / 12;
  let stressTestedCapacity = 0;
  if (stressRate > 0 && maxNewRepayment > 0) {
    const stressFactor = (1 - Math.pow(1 + stressRate, -periods)) / stressRate;
    stressTestedCapacity = Math.round(maxNewRepayment * stressFactor);
    
    if (shouldApplyDtiCap && stressTestedCapacity > borrowingCapacity) {
      stressTestedCapacity = Math.min(stressTestedCapacity, borrowingCapacity);
    }
  }
  
  // Determine band using policy thresholds
  const bandThresholds = activePolicy.bandThresholds;
  let serviceabilityBand: 'green' | 'amber' | 'red';
  if (monthlySurplus > bandThresholds.greenSurplusMin && dtiRatio < bandThresholds.greenDtiMax) {
    serviceabilityBand = 'green';
  } else if (monthlySurplus > 0 && dtiRatio < bandThresholds.amberDtiMax) {
    serviceabilityBand = 'amber';
  } else {
    serviceabilityBand = 'red';
  }
  
  // Generate recommendations
  const recommendations: string[] = [];
  const warnings: string[] = [];
  
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
  if (isConservative && monthlySurplus < conservativeConfig.minimumSurplusFloor) {
    warnings.push(`Surplus below conservative minimum floor of ${fmtCurrencyServer(conservativeConfig.minimumSurplusFloor)}/mo`);
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

// ============================================
// SCENARIO DELTA ENGINE — Phase B (unified)
// All math now flows through `_shared/scenarioDeltaEngine.ts` so the server
// replay matches the client preview byte-for-byte. This module only orchestrates
// I/O around the shared aggregator.
// ============================================

interface ServerScenarioContext extends SharedScenarioContext {
  baseResult: SharedScenarioContext['baseResult'] & { afterTaxAnnualIncome: number; monthlyAfterTaxIncome: number };
}

function runServerScenarios(
  scenarioDeltas: { name: string; deltas: ScenarioDelta[] }[] | undefined | null,
  ctx: ServerScenarioContext,
  strictValidation = false,
): any[] {
  if (!scenarioDeltas || !Array.isArray(scenarioDeltas) || scenarioDeltas.length === 0) return [];

  const results: any[] = [];
  for (const scenario of scenarioDeltas) {
    const { inputs, effect, safeDeltas, issues } = aggregateDeltas(scenario.name, scenario.deltas || [], ctx);

    if (issues.length > 0) {
      console.warn(`[calculate-borrowing-capacity] Scenario "${scenario.name}" produced ${issues.length} validation issue(s):`, issues);
    }

    // Phase C5: strict mode rejects scenarios with hard errors (non-finite values, etc.)
    const hasErrors = issues.some(i => i.severity === 'error');
    if (strictValidation && hasErrors) {
      results.push({
        scenarioName: scenario.name,
        deltas: safeDeltas,
        borrowingCapacity: ctx.baseResult.borrowingCapacity,
        monthlySurplus: ctx.baseResult.monthlySurplus,
        serviceabilityBand: ctx.baseResult.serviceabilityBand,
        dtiRatio: ctx.baseResult.dtiRatio,
        assessmentRate: ctx.baseResult.assessmentRate,
        afterTaxAnnualIncome: ctx.baseResult.afterTaxAnnualIncome,
        monthlyAfterTaxIncome: ctx.baseResult.monthlyAfterTaxIncome,
        capacityChange: { absolute: 0, percent: 0, direction: 'unchanged' },
        validationIssues: issues,
        rejected: true,
        rejectionReason: 'Strict validation: scenario contains errors',
      });
      continue;
    }

    const scenarioResult = calculateBorrowingCapacity({
      grossAnnualIncome: inputs.grossAnnualIncome,
      shadedAnnualIncome: inputs.shadedAnnualIncome,
      monthlyLivingExpenses: inputs.monthlyLivingExpenses,
      monthlyCommitments: inputs.monthlyCommitments,
      interestRate: inputs.interestRate,
      bufferRate: inputs.bufferRate,
      loanTermYears: inputs.loanTermYears,
      totalDebtBalances: inputs.totalDebtBalances,
      calculationMode: inputs.calculationMode,
      dtiCapEnabled: inputs.dtiCapEnabled,
      dtiCapLimit: inputs.dtiCapLimit,
      // Phase I11 — APS 220 denominator binding for cap path parity
      dtiAdjustedAnnualIncome: (inputs as { dtiAdjustedAnnualIncome?: number }).dtiAdjustedAnnualIncome,
    });

    const abs = scenarioResult.borrowingCapacity - ctx.baseResult.borrowingCapacity;
    const pct = ctx.baseResult.borrowingCapacity > 0
      ? Math.round((abs / ctx.baseResult.borrowingCapacity) * 1000) / 10
      : 0;

    // Phase C: derive Acquisition Capacity if an acquisition context was supplied
    const acquisitionCapacity = ctx.acquisition
      ? computeAcquisitionCapacity(scenarioResult.borrowingCapacity, ctx, effect)
      : null;

    results.push({
      scenarioName: scenario.name,
      deltas: safeDeltas,
      borrowingCapacity: scenarioResult.borrowingCapacity,
      monthlySurplus: scenarioResult.monthlySurplus,
      serviceabilityBand: scenarioResult.serviceabilityBand,
      dtiRatio: scenarioResult.dtiRatio,
      assessmentRate: scenarioResult.assessmentRate,
      afterTaxAnnualIncome: scenarioResult.afterTaxAnnualIncome,
      monthlyAfterTaxIncome: scenarioResult.monthlyAfterTaxIncome,
      capacityChange: {
        absolute: abs,
        percent: pct,
        direction: abs > 0 ? 'increase' : abs < 0 ? 'decrease' : 'unchanged',
      },
      acquisitionCapacity,
      validationIssues: issues,
    });
  }

  console.log(`[calculate-borrowing-capacity] Phase C: Ran ${results.length} scenario(s) via shared engine (strict=${strictValidation})`);
  return results;
}


Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  // ── Phase timing (audit item 4) ────────────────────────────────────────
  //
  // The reported symptom was "Calculation failed: Request timed out. Please
  // try again." — the browser's own abort at 60s (`invokeSecureFunction`),
  // which tells us only that the function did not answer. Nothing here
  // recorded WHERE the time went, so a timeout left no evidence at all: the
  // handler logs a result, a tax breakdown and a segment verdict, none of
  // them timed, and a request that never reached those lines logged nothing.
  //
  // This costs one `Date.now()` per phase and changes no behaviour. It exists
  // because the most probable cause is not in this file: `mcFetchRaw` was
  // unbounded until 2026-08-29, so `requireWorkspaceCapability` below could
  // spend the browser's entire budget waiting on Mission Control (the same
  // stall measured at 83s on `compare-investment-reports`). That is now
  // capped at 10s an attempt — but the next time this function is slow, the
  // log should name the phase rather than leave it to be inferred.
  const t0 = Date.now();
  const phases: Record<string, number> = {};
  let lastMark = t0;
  const mark = (name: string) => {
    const now = Date.now();
    phases[name] = now - lastMark;
    lastMark = now;
  };
  const timingLine = () =>
    `total=${Date.now() - t0}ms ` +
    Object.entries(phases).map(([k, v]) => `${k}=${v}ms`).join(' ');

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { clientId, overrides, saveResult = true, scenarioDeltas, acquisition, strictScenarioValidation } = body;

    // SECURITY: Verify authentication (enforced - TODO removed)
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log(`[calculate-borrowing-capacity] Auth failed for client ${clientId}:`, authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    mark('auth');

    // Named once, as in get-client-data and manage-bc-scenarios. The authz gate
    // (scripts/security/check-client-portfolio-authz.mjs) asserts on the exact
    // access-check call below, so the actor shape is not inlined at the call
    // site. Do not restate that call in a comment either — a comment satisfies
    // the gate's literal match just as well as the code does, which is how this
    // very line first defeated its own negative test.
    const actor = { userId, authMethod };

    // Borrowing Capacity is a Scale-or-add-on capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, actor, 'borrowing-capacity');
    mark('entitlement');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);
    console.log(`[calculate-borrowing-capacity] Authenticated user: ${userId}`);

    if (!clientId) {
      return new Response(
        JSON.stringify({ success: false, error: "Client ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The service-role client bypasses RLS, so bind this request to a client
    // the authenticated actor owns or is assigned to before reading any data.
    if (!await canAccessClient(supabase, actor, clientId)) {
      return new Response(
        JSON.stringify({ success: false, error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── PHASE 3: Resolve active policy from lender name ──
    const activePolicy = resolvePolicy(overrides?.selectedLenderName);
    console.log(`[calculate-borrowing-capacity] Active policy: ${activePolicy.name}`);

    // ── PHASE A3: Build effective policy with dynamic stress rate ──
    // Existing property loans should be stress-tested at the HIGHER of:
    //   (a) the lender/policy assessment rate (default 9.5%)
    //   (b) the user-configured assessment rate = interestRate + bufferRate
    // This ensures user/lender overrides flow through to ALL stress calcs.
    const earlyInterestRate = overrides?.interestRate ?? activePolicy.loanDefaults.interestRate;
    const earlyBufferRate = overrides?.bufferRate ?? activePolicy.loanDefaults.bufferRate;
    const userAssessmentRateDecimal = (earlyInterestRate + earlyBufferRate) / 100;
    const effectiveLoanAssessmentRate = Math.max(
      activePolicy.propertyPolicy.loanAssessmentRate,
      userAssessmentRateDecimal,
    );
    const effectivePolicy: PolicyConfig = {
      ...activePolicy,
      propertyPolicy: {
        ...activePolicy.propertyPolicy,
        loanAssessmentRate: effectiveLoanAssessmentRate,
      },
    };
    console.log(`[calculate-borrowing-capacity] Effective loan stress rate: ${(effectiveLoanAssessmentRate * 100).toFixed(2)}% (policy=${(activePolicy.propertyPolicy.loanAssessmentRate * 100).toFixed(2)}%, user=${(userAssessmentRateDecimal * 100).toFixed(2)}%)`);

    console.log(`[calculate-borrowing-capacity] Processing client: ${clientId}`);

    // Fetch client data
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    if (clientError || !client) {
      console.error("Client not found:", clientError);
      return new Response(
        JSON.stringify({ success: false, error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch related data in parallel - INCLUDING client_expenses and new income sources
    const [incomeResult, incomeSourcesResult, liabilitiesResult, propertiesResult, expensesResult] = await Promise.all([
      supabase.from("client_income").select("*").eq("client_id", clientId),
      supabase.from("client_income_sources").select("*").eq("client_id", clientId).eq("is_active", true).order("display_order"),
      supabase.from("client_liabilities").select("*").eq("client_id", clientId),
      supabase.from("client_properties").select("*").eq("client_id", clientId),
      supabase.from("client_expenses").select("*").eq("client_id", clientId),
    ]);

    mark('reads');

    const incomeRecords = incomeResult.data || [];
    const incomeSources = incomeSourcesResult.data || [];
    const liabilities = liabilitiesResult.data || [];
    const properties = propertiesResult.data || [];
    const clientExpenses = expensesResult.data || [];
    
    // Calculate total declared living expenses from client_expenses table
    const totalDeclaredExpenses = clientExpenses.reduce((sum, exp) => sum + (Number(exp.monthly_amount) || 0), 0);
    console.log(`[calculate-borrowing-capacity] Declared expenses from DB: $${totalDeclaredExpenses}/month from ${clientExpenses.length} expense records`);

    console.log(`[calculate-borrowing-capacity] Found ${incomeSources.length} income sources (new), ${incomeRecords.length} income records (legacy), ${liabilities.length} liabilities, ${properties.length} properties`);

    // Calculate income - prefers client_income_sources over legacy client_income
    const { grossTotal, shadedTotal, breakdown: incomeBreakdown } = calculateIncomeBreakdown(incomeRecords, properties, incomeSources);
    
    // Apply overrides if provided
    const effectiveGrossIncome = overrides?.grossAnnualIncome ?? grossTotal;
    const effectiveShadedIncome = overrides?.shadedAnnualIncome 
      ? overrides.shadedAnnualIncome
      : overrides?.additionalIncome 
        ? shadedTotal + (overrides.additionalIncome * 0.8) 
        : shadedTotal;

    // Calculate NEGATIVE property cash flows - these are layered ON TOP of the
    // BASE living expenses below. Computed up-front (before the override branch)
    // so an explicit UI override that ALREADY folds them in is not double counted.
    const { totalMonthly: negativePropertyCashFlows, breakdown: negativeCashFlowBreakdown } =
      calculateNegativePropertyCashFlows(properties);

    // Calculate living expenses (HEM or override) - use income-scaled HEM
    const household: HouseholdComposition = {
      maritalStatus: client.marital_status,
      secondaryApplicantName: client.secondary_first_name,
    };
    const hemBenchmark = getHemBenchmark(household, client.dependents_count, effectiveGrossIncome, activePolicy.hem);

    // CRITICAL: Use the HIGHER of HEM benchmark OR declared expenses from database
    // This is the "hybrid" approach that banks use - they take the greater value
    // Overrides take precedence if provided (for UI-driven calculations)
    let livingExpenses: number;
    if (overrides?.livingExpenses !== undefined && overrides?.livingExpenses !== null) {
      // The UI override is the COMPLETE monthly living-expenses figure — it already
      // folds in negative property cash flows (see BorrowingCapacityModal's
      // `effectiveExpenses = baseExpenses + totalNegativeCashFlows`). Recover the
      // BASE portion here so negative CF is layered back on EXACTLY ONCE below.
      // Without this the server re-adds negCF and the what-if scenario capacity
      // computed client-side (single negCF layer) never lands on this final calc.
      livingExpenses = Math.max(0, overrides.livingExpenses - negativePropertyCashFlows);
    } else {
      // Default: use MAX(HEM, declared) - the "hybrid" approach
      livingExpenses = Math.max(hemBenchmark, totalDeclaredExpenses);
    }

    const expenseMethodUsed = overrides?.livingExpenses !== undefined && overrides?.livingExpenses !== null
      ? 'declared'
      : (totalDeclaredExpenses > hemBenchmark ? 'declared_higher' : 'hem');

    console.log(`[calculate-borrowing-capacity] Expenses: HEM=$${hemBenchmark}, Declared=$${totalDeclaredExpenses}, Base=$${livingExpenses}, NegCF=$${negativePropertyCashFlows} (${expenseMethodUsed})`);

    // Total living expenses = base living expenses + negative property cash flows
    // (counted exactly ONCE, regardless of whether the override already had them).
    const totalLivingExpenses = livingExpenses + negativePropertyCashFlows;

    console.log(`[calculate-borrowing-capacity] Negative property cash flows: $${negativePropertyCashFlows}/month from ${negativeCashFlowBreakdown.length} properties`);
    console.log(`[calculate-borrowing-capacity] Total living expenses (base + negative CF): $${totalLivingExpenses}/month`);

    // ── PROPERTY CONTRIBUTION ENGINE (Phase 1) ──
    // Run unified assessment alongside legacy for parity validation
    const propertyContributions = assessAllPropertyContributions(properties, effectivePolicy.propertyPolicy);
    
    // Parity validation: compare engine outputs against legacy functions
    // Legacy income from properties = income added by calculateIncomeBreakdown from positive cashflows
    const legacyPropertyIncomeFromBreakdown = incomeBreakdown
      .filter((item: any) => item.component?.startsWith('Positive Cash Flow'))
      .reduce((sum: number, item: any) => sum + item.shadedAmount, 0);
    
    const parityChecks = {
      incomeMatch: Math.abs(propertyContributions.totalLegacyIncome - legacyPropertyIncomeFromBreakdown) <= 1,
      expenseMatch: Math.abs(propertyContributions.totalLegacyExpense - negativePropertyCashFlows) <= 1,
      incomeEngine: propertyContributions.totalLegacyIncome,
      incomeLegacy: legacyPropertyIncomeFromBreakdown,
      expenseEngine: propertyContributions.totalLegacyExpense,
      expenseLegacy: negativePropertyCashFlows,
      unifiedNetContribution: propertyContributions.totalNetMonthlyContribution,
    };
    
    console.log(`[calculate-borrowing-capacity] Property Contribution Engine:`, JSON.stringify(parityChecks));
    if (!parityChecks.incomeMatch || !parityChecks.expenseMatch) {
      console.warn(`[calculate-borrowing-capacity] PARITY WARNING: Property contribution engine outputs differ from legacy!`);
    }

    // Calculate liability servicing
    const { totalMonthly: liabilityServicing, breakdown: liabilityBreakdown } = 
      calculateLiabilityBreakdown(liabilities, properties, effectiveGrossIncome, effectivePolicy);
    
    // Calculate total outstanding debt balances for DTI.
    // Include liabilities + owned property loan balances (even though their
    // monthly servicing is not separately counted when net cashflow is used).
    const propertyDebtBalances = properties.reduce((sum, p) => {
      const propertyType = p.property_type?.toLowerCase() || '';
      if (propertyType === 'rental') return sum;
      return sum + (Number(p.loan_remaining) || 0);
    }, 0);
    let totalDebtBalances = liabilityBreakdown.reduce((sum, item) => sum + (item.balance || 0), 0) + propertyDebtBalances;
    if (overrides?.totalDebtBalances != null && Number.isFinite(Number(overrides.totalDebtBalances))) {
      totalDebtBalances = Math.max(0, Number(overrides.totalDebtBalances));
      console.log(`[calculate-borrowing-capacity] Total debt balances overridden for scenario: $${totalDebtBalances}`);
    }
    console.log(`[calculate-borrowing-capacity] Total debt balances for DTI: $${totalDebtBalances}`);

    // Phase I11 — APS 220 denominator binding is ON by default in base path.
    const dtiIncomeComponents = buildDtiIncomeComponents(incomeRecords, incomeSources, properties);
    const dtiDenominatorResult = computeDtiDenominator({
      incomeComponents: dtiIncomeComponents,
      fallbackGrossAnnual: effectiveGrossIncome,
    });
    const effectiveDtiAdjustedAnnualIncome = dtiDenominatorResult.dtiAdjustedAnnualIncome;
    
    // debt_capitalised mode: Add LMI to total debt balances so it impacts DTI and capacity
    const lmiMode = overrides?.lmiMode || 'none';
    const lmiAmount = overrides?.lmiAmount || 0;
    if (lmiMode === 'debt_capitalised' && lmiAmount > 0) {
      totalDebtBalances += lmiAmount;
      console.log(`[calculate-borrowing-capacity] LMI capitalised: +$${lmiAmount} → total debt now $${totalDebtBalances}`);
    }
    
    // Calculate monthly servicing cost of capitalised LMI
    // When LMI is added to the loan, it must be serviced at the assessment rate
    let lmiMonthlyServicing = 0;
    if (lmiMode === 'debt_capitalised' && lmiAmount > 0) {
      const lmiAssessmentRate = ((overrides?.interestRate ?? activePolicy.loanDefaults.interestRate) + (overrides?.bufferRate ?? activePolicy.loanDefaults.bufferRate)) / 100;
      const lmiMonthlyRate = lmiAssessmentRate / 12;
      const lmiPeriods = (overrides?.loanTermYears ?? activePolicy.loanDefaults.loanTermYears) * 12;
      lmiMonthlyServicing = lmiAmount * (lmiMonthlyRate * Math.pow(1 + lmiMonthlyRate, lmiPeriods)) 
                            / (Math.pow(1 + lmiMonthlyRate, lmiPeriods) - 1);
      console.log(`[calculate-borrowing-capacity] LMI monthly servicing: $${lmiMonthlyServicing.toFixed(2)}/mo at ${(lmiAssessmentRate * 100).toFixed(2)}%`);
    }

    const effectiveCommitments = overrides?.existingCommitments != null
      ? overrides.existingCommitments + lmiMonthlyServicing
      : overrides?.additionalLiabilities 
        ? liabilityServicing + overrides.additionalLiabilities + lmiMonthlyServicing
        : liabilityServicing + lmiMonthlyServicing;

    // Set calculation parameters (use policy defaults if no overrides)
    const interestRate = earlyInterestRate;
    const bufferRate = earlyBufferRate;
    const loanTermYears = overrides?.loanTermYears ?? activePolicy.loanDefaults.loanTermYears;

    // Perform calculation - uses after-tax income internally
    // NOTE: Uses totalLivingExpenses which includes negative property cash flows
    const result = calculateBorrowingCapacity({
      grossAnnualIncome: effectiveGrossIncome,
      shadedAnnualIncome: effectiveShadedIncome,
      monthlyLivingExpenses: totalLivingExpenses,
      monthlyCommitments: effectiveCommitments,
      interestRate,
      bufferRate,
      loanTermYears,
      totalDebtBalances,
      calculationMode: overrides?.calculationMode || 'bank',
      dtiCapEnabled: overrides?.dtiCapEnabled || false,
      dtiCapLimit: overrides?.dtiCapLimit || activePolicy.loanDefaults.dtiCap,
      dtiAdjustedAnnualIncome: effectiveDtiAdjustedAnnualIncome,
      policy: activePolicy,
    });

    mark('compute');
    console.log(`[calculate-borrowing-capacity] Result: Capacity $${result.borrowingCapacity}, Band: ${result.serviceabilityBand}`);

    // ── Phase 2: Hybrid Segment Reconciliation (commercial/industrial) ──
    // Flag-gated. When off OR no cmc/ind rows linked → triggered=false → zero overlays.
    let segmentReconciliation;
    try {
      segmentReconciliation = await reconcileSegments({
        supabase,
        clientId,
        userId: userId && userId !== 'service_role' ? userId : null,
      });
      if (segmentReconciliation.triggered) {
        console.log(`[calculate-borrowing-capacity] Segment engine TRIGGERED: ${segmentReconciliation.segmentBreakdown.length} segment(s), portfolio Δ=$${segmentReconciliation.overlays.portfolioCapacityDelta}`);
      }
    } catch (segErr) {
      console.warn(`[calculate-borrowing-capacity] Segment reconciliation failed (non-fatal):`, segErr);
      segmentReconciliation = { enabled: false, triggered: false, segmentBreakdown: [], totals: { additionalAnnualNoi: 0, additionalAnnualDebtService: 0, additionalHeadroom: 0 }, overlays: { extraMonthlyCommitments: 0, extraShadedAnnualIncome: 0, extraDtiDenominator: 0, portfolioCapacityDelta: 0 }, warnings: [`segment engine error: ${(segErr as any)?.message || 'unknown'}`] };
    }

    mark('segments');

    // Portfolio capacity (additive — never replaces residential `borrowingCapacity`).
    // When the segment engine is triggered, this surfaces the hybrid capacity for UI.
    const portfolioCapacity = segmentReconciliation.triggered
      ? Math.max(0, result.borrowingCapacity + segmentReconciliation.overlays.portfolioCapacityDelta)
      : result.borrowingCapacity;


    // Calculate tax breakdown for the gross income
    const taxBreakdown = getTaxBreakdown(effectiveGrossIncome);
    console.log(`[calculate-borrowing-capacity] Tax breakdown: Marginal rate ${(taxBreakdown.marginalTaxRate * 100).toFixed(0)}%, After-tax income $${taxBreakdown.afterTaxIncome}`);

    // ── PHASE 5: Build Audit Trail ──
    const audit = new AuditTrailBuilder();

    // Policy selection
    if (activePolicy.name !== 'Default APRA') {
      audit.add('policy', 'lender_profile_selected', 'Lender Profile', 0, 0, activePolicy.name, `Policy: ${activePolicy.name}`);
    }
    if (overrides?.interestRate !== undefined) audit.add('policy', 'override_applied', 'Interest Rate Override', activePolicy.loanDefaults.interestRate, overrides.interestRate, 'Manual override');
    if (overrides?.bufferRate !== undefined) audit.add('policy', 'override_applied', 'Buffer Rate Override', activePolicy.loanDefaults.bufferRate, overrides.bufferRate, 'Manual override');

    // Income shading audit
    for (const item of incomeBreakdown) {
      if (item.grossAmount > 0) {
        audit.add('income', 'shading_applied', item.component, item.grossAmount, item.shadedAmount, `${(item.shadingRate * 100).toFixed(0)}% shading`);
      }
    }

    // Tax audit
    audit.add('tax', 'tax_calculated', 'Income Tax', effectiveGrossIncome, taxBreakdown.afterTaxIncome, `${(taxBreakdown.effectiveTaxRate * 100).toFixed(1)}% effective rate`, `Tax: $${taxBreakdown.totalTax}`);
    audit.add('tax', 'medicare_levy_applied', 'Medicare Levy', 0, taxBreakdown.medicareLevy, `${(activePolicy.tax.medicareLevyRate * 100).toFixed(0)}% of gross`);

    // Expense audit
    audit.add('expense', expenseMethodUsed === 'hem' ? 'hem_benchmark_applied' : expenseMethodUsed === 'declared_higher' ? 'declared_expenses_used' : 'override_applied',
      'Living Expenses', totalDeclaredExpenses, livingExpenses, `Method: ${titleCase(expenseMethodUsed)}`,
      // The household classification is stated because it is what moves the
      // HEM figure beside it, and audit item 9 was two screens disagreeing
      // about it with nothing on either saying so.
      `${describeHousehold(household)} — HEM ${fmtCurrencyServer(hemBenchmark)}/mo vs Declared ${fmtCurrencyServer(totalDeclaredExpenses)}/mo`);
    for (const ncf of negativeCashFlowBreakdown) {
      audit.add('property', 'negative_cf_layered', `Neg CF: ${ncf.address}`, 0, ncf.monthlyCashflow, 'Layered on expenses');
    }

    // Liability audit
    for (const l of liabilityBreakdown) {
      const action = l.type.includes('Credit') ? 'credit_card_limit_rate' : l.type.includes('HECS') ? 'hecs_threshold_applied' : l.type.includes('Loan P&I') ? 'pi_conversion' : 'assessment_rate_applied';
      audit.add('liability', action, l.type, l.balance || 0, l.monthlyServicing, `$${l.monthlyServicing.toFixed(0)}/mo servicing`);
    }

    // LMI audit
    if (lmiMode === 'debt_capitalised' && lmiAmount > 0) {
      audit.add('constraint', 'lmi_capitalised', 'LMI Capitalised', 0, lmiAmount, `+$${lmiMonthlyServicing.toFixed(0)}/mo servicing`);
    }

    // Stress test audit
    audit.add('constraint', 'stress_test_applied', 'Stress Test', result.borrowingCapacity, result.stressTestedCapacity, `+${activePolicy.loanDefaults.stressTestIncrement}% above assessment`);

    const auditTrail = audit.build();
    console.log(`[calculate-borrowing-capacity] Phase 5: Audit trail with ${auditTrail.entries.length} entries`);

    // ── PHASE 5: Generate Explanation ──
    const explanation = generateExplanationServer({
      borrowingCapacity: result.borrowingCapacity, monthlySurplus: result.monthlySurplus,
      serviceabilityBand: result.serviceabilityBand, stressTestedCapacity: result.stressTestedCapacity,
      dtiRatio: result.dtiRatio, assessmentRate: result.assessmentRate,
      grossAnnualIncome: effectiveGrossIncome, shadedAnnualIncome: effectiveShadedIncome,
      incomeBreakdownCount: incomeBreakdown.length,
      afterTaxAnnualIncome: taxBreakdown.afterTaxIncome, totalTax: taxBreakdown.totalTax,
      effectiveTaxRate: taxBreakdown.effectiveTaxRate, marginalTaxRate: taxBreakdown.marginalTaxRate,
      livingExpensesMonthly: livingExpenses, hemBenchmark, declaredExpenses: totalDeclaredExpenses,
      expenseMethod: expenseMethodUsed, negativePropertyCashFlows, totalLivingExpenses,
      existingCommitmentsMonthly: effectiveCommitments, totalDebtBalances, liabilityCount: liabilityBreakdown.length,
      interestRate, bufferRate, loanTermYears,
      policyName: activePolicy.name, calculationMode: overrides?.calculationMode || 'bank',
      dtiCapEnabled: overrides?.dtiCapEnabled || false, dtiCapLimit: overrides?.dtiCapLimit || activePolicy.loanDefaults.dtiCap,
      lmiAmount, lmiMode, propertyCount: properties.length,
    });
    console.log(`[calculate-borrowing-capacity] Phase 5: Explanation with ${explanation.steps.length} steps`);

    // ── PHASE 2: Build Three-Output Structure ──
    const calculatedAt = new Date().toISOString();
    const effectiveLmiAmount = overrides?.lmiAmount || 0;
    const effectiveLmiMode = overrides?.lmiMode || 'none';
    const effectiveCalcMode = overrides?.calculationMode || 'bank';
    const effectiveDtiCapEnabled = overrides?.dtiCapEnabled || false;
    const effectiveDtiCapLimit = overrides?.dtiCapLimit || DEFAULT_DTI_CAP;
    
    const assumptionItems = [
      { key: "Policy Profile", value: activePolicy.name },
      { key: "Serviceability Basis", value: "After-Tax of SHADED (assessable) income" },
      { key: "Buffer Rate", value: `${bufferRate}%` },
      { key: "Assessment Rate", value: `${result.assessmentRate}%` },
      { key: "Loan Term", value: `${loanTermYears} years` },
      { key: "HEM Benchmark", value: `${fmtCurrencyServer(hemBenchmark)}/mo (income-scaled)` },
      { key: "Repayment Type", value: "Principal & Interest" },
      { key: "Rental Expense Ratio", value: `${activePolicy.propertyPolicy.rentalExpenseRatio * 100}%` },
      { key: "Existing Loan Stress Rate", value: `P&I at ${(effectiveLoanAssessmentRate * 100).toFixed(2)}% (max of policy ${(activePolicy.propertyPolicy.loanAssessmentRate * 100).toFixed(1)}% and assessment rate ${(userAssessmentRateDecimal * 100).toFixed(2)}%)` },
      { key: "Tax Year", value: `${activePolicy.tax.taxYear} (incl. ${(activePolicy.tax.medicareLevyRate * 100).toFixed(0)}% Medicare Levy)` },
      { key: "Assessable Income (Shaded)", value: `${fmtCurrencyServer(effectiveShadedIncome)}/yr` },
      { key: "DTI Denominator (APS 220)", value: `${fmtCurrencyServer(effectiveDtiAdjustedAnnualIncome)}/yr` },
      { key: "After-Tax Income Used", value: `${fmtCurrencyServer(taxBreakdown.afterTaxIncome)}/yr (on shaded income)` },
      { key: "Marginal Tax Rate", value: `${(taxBreakdown.marginalTaxRate * 100).toFixed(0)}%` },
      { key: "Stress Test Increment", value: `+${activePolicy.loanDefaults.stressTestIncrement}%` },
      { key: "Credit Card Servicing", value: `${(activePolicy.liabilityRules.creditCardLimitRate * 100).toFixed(1)}% of limit` },
      { key: "Conservative Surplus Floor", value: `${fmtCurrencyServer(activePolicy.conservativeMode.minimumSurplusFloor)}/mo (zeroed below)` },
    ];

    const propertyContributionData = {
      summary: {
        totalNetMonthlyContribution: propertyContributions.totalNetMonthlyContribution,
        totalLegacyIncome: propertyContributions.totalLegacyIncome,
        totalLegacyExpense: propertyContributions.totalLegacyExpense,
        totalLegacyLiability: propertyContributions.totalLegacyLiability,
        totalLegacyDebtBalance: propertyContributions.totalLegacyDebtBalance,
        parityValidation: parityChecks,
      },
      properties: propertyContributions.properties.map(p => ({
        address: p.address,
        propertyType: p.propertyType,
        rawNetMonthlyCashflow: p.rawNetMonthlyCashflow,
        assessedMonthlyRent: p.assessedMonthlyRent,
        assessedMonthlyDebt: p.assessedMonthlyDebt,
        assessedMonthlyHoldingCosts: p.assessedMonthlyHoldingCosts,
        netMonthlyContribution: p.netMonthlyContribution,
        auditNotes: p.auditNotes,
      })),
    };

    // ── Output 1: Current Capacity ──
    const currentCapacity = {
      borrowingCapacity: result.borrowingCapacity,
      monthlySurplus: result.monthlySurplus,
      serviceabilityBand: result.serviceabilityBand,
      stressTestedCapacity: result.stressTestedCapacity,
      dtiRatio: result.dtiRatio,
      assessmentRate: result.assessmentRate,
      afterTaxAnnualIncome: result.afterTaxAnnualIncome,
      monthlyAfterTaxIncome: result.monthlyAfterTaxIncome,
      grossAnnualIncome: effectiveGrossIncome,
      shadedAnnualIncome: effectiveShadedIncome,
      incomeBreakdown,
      livingExpensesMonthly: livingExpenses,
      expenseMethod: expenseMethodUsed,
      hemBenchmark,
      declaredExpenses: totalDeclaredExpenses,
      negativePropertyCashFlows,
      totalLivingExpenses,
      existingCommitmentsMonthly: effectiveCommitments,
      liabilityBreakdown,
      interestRate,
      bufferRate,
      loanTermYears,
      calculationMode: effectiveCalcMode,
      dtiCapEnabled: effectiveDtiCapEnabled,
      dtiCapLimit: effectiveDtiCapLimit,
      selectedLenderName: overrides?.selectedLenderName || null,
      recommendations: result.recommendations,
      warnings: result.warnings,
      assumptions: assumptionItems,
      taxBreakdown: {
        taxPayable: taxBreakdown.taxPayable,
        medicareLevy: taxBreakdown.medicareLevy,
        totalTax: taxBreakdown.totalTax,
        afterTaxIncome: taxBreakdown.afterTaxIncome,
        effectiveTaxRate: taxBreakdown.effectiveTaxRate,
        marginalTaxRate: taxBreakdown.marginalTaxRate,
        marginalBracket: taxBreakdown.marginalBracket,
        monthlyTakeHome: taxBreakdown.monthlyTakeHome,
      },
      lmiAmount: effectiveLmiAmount,
      lmiMode: effectiveLmiMode,
      netPurchaseCapacity: effectiveLmiAmount ? Math.max(0, result.borrowingCapacity - effectiveLmiAmount) : result.borrowingCapacity,
      propertyContributions: propertyContributionData,
      calculatedAt,
    };

    // ── Output 3: Proposed Loan Check ──
    const proposedLoanAmount = overrides?.proposedLoanAmount || null;
    let proposedLoanCheck = null;
    if (proposedLoanAmount && proposedLoanAmount > 0) {
      const plAssessmentRate = interestRate + bufferRate;
      const plMonthlyRate = (plAssessmentRate / 100) / 12;
      const plPeriods = loanTermYears * 12;
      const plMonthlyRepayment = plMonthlyRate > 0
        ? Math.round(proposedLoanAmount * (plMonthlyRate * Math.pow(1 + plMonthlyRate, plPeriods)) / (Math.pow(1 + plMonthlyRate, plPeriods) - 1))
        : 0;
      const plIsServiceable = result.borrowingCapacity >= proposedLoanAmount;
      const plHeadroom = result.borrowingCapacity - proposedLoanAmount;
      const plUtilization = result.borrowingCapacity > 0 
        ? Math.min(Math.round((proposedLoanAmount / result.borrowingCapacity) * 100), 100) 
        : 0;
      const plTotalDebt = totalDebtBalances + proposedLoanAmount;
      const plDti = effectiveGrossIncome > 0 ? Math.round((plTotalDebt / effectiveGrossIncome) * 100) / 100 : 0;
      let plBand: 'green' | 'amber' | 'red' = 'red';
      if (plHeadroom > 0 && plDti < 6) plBand = 'green';
      else if (plHeadroom >= 0 && plDti < 8) plBand = 'amber';

      proposedLoanCheck = {
        proposedLoanAmount,
        isServiceable: plIsServiceable,
        monthlyRepayment: plMonthlyRepayment,
        headroom: plHeadroom,
        utilizationPercent: plUtilization,
        dtiWithProposedLoan: plDti,
        projectedBand: plBand,
      };
      console.log(`[calculate-borrowing-capacity] Proposed loan check: $${proposedLoanAmount} → ${plIsServiceable ? 'SERVICEABLE' : 'NOT SERVICEABLE'}, headroom $${plHeadroom}`);
    }

    // ── Build backward-compatible flat responseData (legacy shape) ──
    // This preserves all existing field paths so consumers don't break
    const responseData = {
      clientId,
      // Legacy flat fields (backward compat)
      grossAnnualIncome: effectiveGrossIncome,
      shadedAnnualIncome: effectiveShadedIncome,
      incomeBreakdown,
      livingExpensesMonthly: livingExpenses,
      negativePropertyCashFlows,
      negativeCashFlowBreakdown,
      totalLivingExpenses,
      expenseMethod: expenseMethodUsed,
      hemBenchmark,
      declaredExpenses: totalDeclaredExpenses,
      existingCommitmentsMonthly: effectiveCommitments,
      liabilityBreakdown,
      interestRate,
      bufferRate,
      assessmentRate: result.assessmentRate,
      loanTermYears,
      proposedLoanAmount,
      borrowingCapacity: result.borrowingCapacity,
      monthlySurplus: result.monthlySurplus,
      serviceabilityBand: result.serviceabilityBand,
      stressTestedCapacity: result.stressTestedCapacity,
      dtiRatio: result.dtiRatio,
      afterTaxAnnualIncome: result.afterTaxAnnualIncome,
      monthlyAfterTaxIncome: result.monthlyAfterTaxIncome,
      recommendations: result.recommendations,
      warnings: result.warnings,
      taxBreakdown: currentCapacity.taxBreakdown,
      assumptions: {
        items: assumptionItems,
        calculationMode: effectiveCalcMode,
        dtiCapEnabled: effectiveDtiCapEnabled,
        dtiCapLimit: effectiveDtiCapLimit,
        selectedLenderName: overrides?.selectedLenderName || null,
        lmiMode: effectiveLmiMode,
        lmiPropertyValue: overrides?.lmiPropertyValue || null,
        lmiDepositAmount: overrides?.lmiDepositAmount || null,
        isFirstHomeBuyer: overrides?.isFirstHomeBuyer || false,
        proposedRentalIncome: overrides?.proposedRentalIncome || null,
        // ── Phase 3: persist hybrid segment results for UI/PDF replay ──
        _segmentReconciliation: segmentReconciliation,
        _portfolioCapacity: portfolioCapacity,
      },
      lmiAmount: effectiveLmiAmount,
      lmiMode: effectiveLmiMode,
      netPurchaseCapacity: currentCapacity.netPurchaseCapacity,
      calculatedAt,
      propertyContributions: propertyContributionData,
      // ── Phase 4: Scenario Delta Engine ──
      currentCapacity,
      scenarios: runServerScenarios(scenarioDeltas, {
        baseInputs: {
          grossAnnualIncome: effectiveGrossIncome,
          shadedAnnualIncome: effectiveShadedIncome,
          monthlyLivingExpenses: totalLivingExpenses,
          monthlyCommitments: effectiveCommitments,
          interestRate,
          bufferRate,
          loanTermYears,
          totalDebtBalances,
          calculationMode: overrides?.calculationMode || 'bank',
          dtiCapEnabled: overrides?.dtiCapEnabled || false,
          dtiCapLimit: overrides?.dtiCapLimit || activePolicy.loanDefaults.dtiCap,
        },
        baseResult: result,
        properties: properties.map((p: any) => ({
          id: p.id,
          address: p.address,
          propertyType: p.property_type,
          currentValue: p.current_value || 0,
          loanRemaining: p.loan_remaining || 0,
          monthlyRepayment: p.monthly_interest_repayment || 0,
          loanRepaymentAmount: p.loan_repayment_amount || p.monthly_interest_repayment || 0,
          netMonthlyCashflow: p.net_monthly_cashflow || 0,
          monthlyRentalIncome: p.monthly_rental_income || 0,
        })),
        liabilities: liabilityBreakdown.map((l: any, i: number) => ({
          id: liabilities[i]?.id || `liability-${i}`,
          type: l.type,
          label: l.type,
          balance: l.balance || 0,
          limit: l.limit,
          monthlyServicing: l.monthlyServicing,
        })),
        // Phase C: optional acquisition context for max-purchase-price math.
        // CRITICAL: include `targetPurchasePrice` so the engine can report
        // meetsTarget / shortfallToTarget / loanRequired / netCashAfterSettlement
        // when the broker is solving for a specific budget (e.g. $700k).
        acquisition: acquisition ? {
          state: acquisition.state,
          intent: acquisition.intent,
          category: acquisition.category,
          isFirstHomeBuyer: acquisition.isFirstHomeBuyer ?? overrides?.isFirstHomeBuyer ?? false,
          isForeignBuyer: acquisition.isForeignBuyer ?? false,
          lmiMode: acquisition.lmiMode ?? overrides?.lmiMode ?? 'display_deduction',
          cashOnHand: acquisition.cashOnHand ?? 0,
          targetPurchasePrice: Number.isFinite(acquisition.targetPurchasePrice) && acquisition.targetPurchasePrice > 0
            ? acquisition.targetPurchasePrice
            : undefined,
        } : undefined,
      }, !!strictScenarioValidation),
      proposedLoanCheck,
      // ── Phase 5: Audit Trail & Explanation ──
      auditTrail,
      explanation,
      // ── Phase 2: Hybrid segment reconciliation (additive, flag-gated) ──
      segmentBreakdown: segmentReconciliation.segmentBreakdown,
      segmentReconciliation,
      portfolioCapacity,
    };


    // Save to database if requested.
    //
    // A failed save used to be logged here and nothing else: the function
    // still answered `success: true` with a null `assessmentId`, and the
    // browser still raised "Borrowing capacity calculated successfully".
    // Nothing about that is harmless — the card reads the STORED assessment,
    // so the operator is told the recalculation worked while the figure
    // beside it stays whatever it was, which is the same symptom as audit
    // item 9 arriving by a different route.
    //
    // The calculation genuinely did succeed and every figure in the response
    // is good, so this stays a 200 with `success: true`. What changes is that
    // the response now SAYS whether the figure was kept, and the browser
    // repeats what it was told rather than assuming.
    let assessmentId: string | null = null;
    let saved = false;
    let saveFailure: string | null = null;
    if (saveResult) {
      const { data: savedAssessment, error: saveError } = await supabase
        .from("borrowing_capacity_assessments")
        .insert({
          client_id: clientId,
          gross_annual_income: effectiveGrossIncome,
          shaded_annual_income: effectiveShadedIncome,
          income_breakdown: incomeBreakdown,
          living_expenses_monthly: livingExpenses,
          expense_method: expenseMethodUsed,
          expense_breakdown: { hemBenchmark, declaredExpenses: totalDeclaredExpenses },
          existing_commitments_monthly: effectiveCommitments,
          liability_breakdown: liabilityBreakdown,
          interest_rate_used: interestRate,
          buffer_rate: bufferRate,
          loan_term_years: loanTermYears,
          proposed_loan_amount: overrides?.proposedLoanAmount || null,
          proposed_lvr: 80,
          borrowing_capacity: result.borrowingCapacity,
          monthly_surplus: result.monthlySurplus,
          serviceability_band: result.serviceabilityBand,
          stress_tested_capacity: result.stressTestedCapacity,
          dti_ratio: result.dtiRatio,
          recommendations: result.recommendations,
          warnings: result.warnings,
          assumptions: responseData.assumptions,
          // LMI fields
          lmi_amount: overrides?.lmiAmount || 0,
          lmi_mode: overrides?.lmiMode || 'none',
          lmi_lvr_trigger: overrides?.lmiPropertyValue && overrides?.lmiDepositAmount 
            ? Math.round(((overrides.lmiPropertyValue - overrides.lmiDepositAmount) / overrides.lmiPropertyValue) * 10000) / 100 
            : null,
          property_value_estimate: overrides?.lmiPropertyValue || null,
          deposit_amount: overrides?.lmiDepositAmount || null,
          net_purchase_capacity: overrides?.lmiAmount 
            ? Math.max(0, result.borrowingCapacity - (overrides.lmiAmount || 0)) 
            : null,
        })
        .select("id")
        .single();

      if (saveError) {
        console.error("Failed to save assessment:", saveError);
        saveFailure = saveError.message || 'the assessment could not be stored';
      } else {
        assessmentId = savedAssessment?.id || null;
        saved = assessmentId !== null;
        console.log(`[calculate-borrowing-capacity] Saved assessment: ${assessmentId}`);
      }

      // The audit trail and the explanation, kept.
      //
      // Both are built above and returned in the response, and until migration
      // 20260814000000 there was nowhere to store them — so every report that
      // read them off the stored row got `undefined`, and the two pages that
      // explain a lending decision to the client have never appeared in a
      // document anyone received (docs/reports/BORROWING_CAPACITY.md F12).
      //
      // A separate UPDATE rather than two more fields on the INSERT above, so
      // that deploy order does not matter: run this function against a project
      // that has not had the migration applied yet and it warns instead of
      // failing every capacity calculation.
      if (assessmentId) {
        const { error: keepError } = await supabase
          .from("borrowing_capacity_assessments")
          .update({ audit_trail: auditTrail, explanation })
          .eq("id", assessmentId);
        if (keepError) {
          console.warn(
            `[calculate-borrowing-capacity] could not store audit trail/explanation `
            + `(migration 20260814000000 applied?): ${keepError.message}`,
          );
        }
      }

      // Update client's borrowing_capacity field.
      //
      // Read the error for the same reason as above: this column is what the
      // client list and several reports show, so a silent failure here leaves
      // one figure on the card and a different one everywhere else. It does
      // not overwrite a save failure already recorded — the first thing that
      // went wrong is the one worth reporting.
      const { error: clientUpdateError } = await supabase
        .from("clients")
        .update({ borrowing_capacity: result.borrowingCapacity })
        .eq("id", clientId);
      if (clientUpdateError) {
        console.error("Failed to update client borrowing_capacity:", clientUpdateError);
        saved = false;
        saveFailure = saveFailure
          ?? (clientUpdateError.message || "the client record could not be updated");
      }
    }
    mark('save');

    console.log(`[calculate-borrowing-capacity] timing ${timingLine()}`);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          assessmentId,
          // Whether the figure was KEPT, which is a different question from
          // whether it was calculated. `saveResult: false` callers never
          // asked for it to be kept, so they read `saved: false` with no
          // failure — hence `saveRequested` beside it.
          saveRequested: saveResult === true,
          saved,
          saveError: saveFailure,
          ...responseData,
        },
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          // Already named in Access-Control-Expose-Headers above and never set
          // by this function until now, so a caller that wants to know how long
          // its own request took has had no way to ask.
          "x-duration-ms": String(Date.now() - t0),
        },
      }
    );

  } catch (error) {
    // Timed as well as logged: a request that fails 55s in and one that fails
    // in 200ms are different faults, and the message alone does not say which.
    console.error(`[calculate-borrowing-capacity] Error after ${timingLine()}:`, error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'calculate-borrowing-capacity'), success: false }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "x-duration-ms": String(Date.now() - t0),
        },
      }
    );
  }
});
