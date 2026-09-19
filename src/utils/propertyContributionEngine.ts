/**
 * Property Contribution Engine (Phase 1)
 * 
 * Implements the unified "Net Contribution" model per property:
 *   Net Contribution = Assessed Rent − Assessed Debt − Assessed Holding Costs
 * 
 * This replaces the legacy split approach where:
 *   - Positive net_monthly_cashflow → added to income (shaded 80%)
 *   - Negative net_monthly_cashflow → added to expenses
 *   - Property loans → assessed separately in liabilities
 * 
 * CRITICAL: During Phase 1, the engine produces outputs that are mapped back
 * to the legacy income/expense/liability buckets to ensure numerical parity.
 * The unified net contribution is tracked for audit/reporting but does NOT
 * yet change the final borrowing capacity number.
 */

import { 
  DEFAULT_PROPERTY_POLICY as POLICY_ENGINE_DEFAULT,
  type PropertyPolicy,
} from './policyEngine';

// ============================================
// TYPES — PropertyContributionPolicy is now an alias for PolicyEngine's PropertyPolicy
// ============================================

export type PropertyContributionPolicy = PropertyPolicy;
export const DEFAULT_PROPERTY_POLICY: PropertyContributionPolicy = POLICY_ENGINE_DEFAULT;

export interface PropertyContributionResult {
  /** Property identifier */
  propertyId: string;
  /** Truncated address for display */
  address: string;
  /** Property type from database */
  propertyType: string;

  // ── Raw Values (as-stored in DB) ──
  /** Raw monthly rental income from DB */
  rawMonthlyRent: number;
  /** Raw net monthly cashflow from DB (pre-calculated field) */
  rawNetMonthlyCashflow: number;
  /** Raw loan remaining balance */
  rawLoanBalance: number;
  /** Raw monthly loan repayment recorded */
  rawMonthlyRepayment: number;

  // ── Assessed Values (after policy application) ──
  /** Assessed monthly rent = rawMonthlyRent × shadingRate × (1 - vacancyRate) */
  assessedMonthlyRent: number;
  /** Assessed monthly debt = max(P&I at assessment rate, actual repayment) */
  assessedMonthlyDebt: number;
  /** Assessed monthly holding costs (placeholder — Phase 2+ will itemize) */
  assessedMonthlyHoldingCosts: number;

  // ── Net Contribution ──
  /** Unified: assessedRent - assessedDebt - assessedHoldingCosts */
  netMonthlyContribution: number;

  // ── Legacy Bucket Mapping (for numerical parity) ──
  /** Amount to add to income bucket (positive cashflow × shading, annualized) */
  legacyIncomeContribution: number;
  /** Amount to add to expense bucket (abs of negative cashflow, monthly) */
  legacyExpenseContribution: number;
  /** Amount to add to liability bucket (P&I servicing at assessment rate, monthly) */
  legacyLiabilityContribution: number;
  /** Loan balance for DTI calculation */
  legacyDebtBalance: number;

  // ── Audit Trail ──
  /** Rules applied and transformations made */
  auditNotes: string[];
}

export interface PropertyContributionSummary {
  /** Individual property results */
  properties: PropertyContributionResult[];

  // ── Aggregated Legacy Buckets (for parity check) ──
  /** Total annual income from positive cash flow properties (shaded) */
  totalLegacyIncome: number;
  /** Total monthly expense from negative cash flow properties */
  totalLegacyExpense: number;
  /** Total monthly liability servicing from property loans */
  totalLegacyLiability: number;
  /** Total debt balances for DTI */
  totalLegacyDebtBalance: number;

  // ── Unified View ──
  /** Sum of all property net contributions (monthly) */
  totalNetMonthlyContribution: number;
}

// ============================================
// CORE ENGINE
// ============================================

/**
 * Assess a single property's contribution to borrowing capacity.
 * 
 * This function computes both the unified net contribution AND the legacy
 * bucket mapping to ensure numerical parity during transition.
 */
export function assessPropertyContribution(
  property: any,
  policy: PropertyContributionPolicy = DEFAULT_PROPERTY_POLICY,
): PropertyContributionResult {
  const propertyType = property.property_type?.toLowerCase() || '';
  const address = property.address?.substring(0, 40) || 'Property';
  const auditNotes: string[] = [];

  // ── Handle Rental Properties (client is tenant, not owner) ──
  if (propertyType === 'rental') {
    const monthlyRentPaid = property.monthly_rental_income || 0;
    auditNotes.push(`Rental property: client pays $${monthlyRentPaid}/mo rent as tenant`);
    auditNotes.push('Treated as liability commitment (not a property contribution)');

    return {
      propertyId: property.id || '',
      address,
      propertyType,
      rawMonthlyRent: 0,
      rawNetMonthlyCashflow: 0,
      rawLoanBalance: 0,
      rawMonthlyRepayment: 0,
      assessedMonthlyRent: 0,
      assessedMonthlyDebt: 0,
      assessedMonthlyHoldingCosts: 0,
      netMonthlyContribution: -monthlyRentPaid,
      // Legacy: rent paid appears in liability breakdown (handled by calculateLiabilityBreakdown)
      legacyIncomeContribution: 0,
      legacyExpenseContribution: 0,
      legacyLiabilityContribution: monthlyRentPaid,
      legacyDebtBalance: 0,
      auditNotes,
    };
  }

  // ── Investment / Owner-Occupied Properties ──
  const rawNetMonthlyCashflow = property.net_monthly_cashflow || 0;
  const rawMonthlyRent = property.monthly_rental_income || 0;
  const rawLoanBalance = property.loan_remaining || 0;
  const rawMonthlyRepayment = property.monthly_interest_repayment || 0;

  // --- Assessed Rent ---
  // In legacy: rent is embedded in net_monthly_cashflow, not assessed separately
  // For Phase 1, we track assessed rent for audit but use legacy cashflow for parity
  const assessedMonthlyRent = rawMonthlyRent * policy.rentalShadingRate * (1 - policy.vacancyRate);
  auditNotes.push(`Raw rent: $${rawMonthlyRent}/mo → Assessed: $${assessedMonthlyRent.toFixed(2)}/mo (${policy.rentalShadingRate * 100}% shading, ${policy.vacancyRate * 100}% vacancy)`);

  // --- Assessed Debt (Loan Servicing) ---
  // For P&I loans: stored repayment is already amortized → use directly (no double-stress)
  // For IO / unknown legacy: stress-test against P&I at assessment rate (Math.max floor)
  let assessedMonthlyDebt = 0;
  if (rawLoanBalance > 0) {
    const repaymentType = property.repayment_type || null;
    const monthlyRate = policy.loanAssessmentRate / 12;
    const piRepayment = rawLoanBalance *
      (monthlyRate * Math.pow(1 + monthlyRate, policy.loanTermMonths)) /
      (Math.pow(1 + monthlyRate, policy.loanTermMonths) - 1);

    if (repaymentType === 'principal_and_interest' && rawMonthlyRepayment > 0) {
      assessedMonthlyDebt = rawMonthlyRepayment;
      auditNotes.push(`Loan: $${rawLoanBalance.toLocaleString('en-AU')} P&I (user-supplied) → Using: $${assessedMonthlyDebt.toFixed(2)}/mo`);
    } else {
      assessedMonthlyDebt = Math.max(piRepayment, rawMonthlyRepayment);
      auditNotes.push(`Loan: $${rawLoanBalance.toLocaleString('en-AU')} → P&I @ ${(policy.loanAssessmentRate * 100).toFixed(1)}%: $${piRepayment.toFixed(2)}/mo, actual: $${rawMonthlyRepayment}/mo → Using: $${assessedMonthlyDebt.toFixed(2)}/mo${repaymentType === 'interest_only' ? ' (IO stress-tested to P&I)' : ''}`);
    }
  }

  // --- Assessed Holding Costs (Phase 2+ will itemize land tax, strata, insurance, etc.) ---
  // For Phase 1: holding costs = 0 (they're embedded in net_monthly_cashflow from DB)
  const assessedMonthlyHoldingCosts = 0;
  auditNotes.push('Holding costs: embedded in DB net_monthly_cashflow (Phase 2 will itemize)');

  // --- Net Contribution (unified model) ---
  const netMonthlyContribution = assessedMonthlyRent - assessedMonthlyDebt - assessedMonthlyHoldingCosts;
  auditNotes.push(`Net contribution: $${assessedMonthlyRent.toFixed(2)} - $${assessedMonthlyDebt.toFixed(2)} - $${assessedMonthlyHoldingCosts.toFixed(2)} = $${netMonthlyContribution.toFixed(2)}/mo`);

  // ── Legacy Bucket Mapping (MUST match existing edge function behavior) ──
  
  // Legacy income: if net_monthly_cashflow > 0, add to income at 80% shading (annualized)
  let legacyIncomeContribution = 0;
  if (rawNetMonthlyCashflow > 0) {
    legacyIncomeContribution = rawNetMonthlyCashflow * 12 * policy.rentalShadingRate;
    auditNotes.push(`Legacy income: positive cashflow $${rawNetMonthlyCashflow}/mo × 12 × ${policy.rentalShadingRate} = $${legacyIncomeContribution.toFixed(2)}/yr`);
  }

  // Legacy expense: if net_monthly_cashflow < 0, add absolute value to expenses
  let legacyExpenseContribution = 0;
  if (rawNetMonthlyCashflow < 0) {
    legacyExpenseContribution = Math.abs(rawNetMonthlyCashflow);
    auditNotes.push(`Legacy expense: negative cashflow $${rawNetMonthlyCashflow}/mo → expense $${legacyExpenseContribution}/mo`);
  }

  // Legacy liability: P&I servicing at assessment rate (already calculated above)
  const legacyLiabilityContribution = rawLoanBalance > 0 ? Math.round(assessedMonthlyDebt * 100) / 100 : 0;
  auditNotes.push(`Legacy liability: $${legacyLiabilityContribution}/mo P&I servicing`);

  return {
    propertyId: property.id || '',
    address,
    propertyType,
    rawMonthlyRent,
    rawNetMonthlyCashflow,
    rawLoanBalance,
    rawMonthlyRepayment,
    assessedMonthlyRent,
    assessedMonthlyDebt,
    assessedMonthlyHoldingCosts,
    netMonthlyContribution,
    legacyIncomeContribution,
    legacyExpenseContribution,
    legacyLiabilityContribution,
    legacyDebtBalance: rawLoanBalance,
    auditNotes,
  };
}

/**
 * Assess all properties for a client and produce both unified
 * and legacy-compatible outputs.
 */
export function assessAllPropertyContributions(
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
    totalLegacyIncome,
    totalLegacyExpense,
    totalLegacyLiability,
    totalLegacyDebtBalance,
    totalNetMonthlyContribution,
  };
}

/**
 * Validate that the property contribution engine produces outputs that match
 * the legacy system's behavior. Used during testing/transition.
 * 
 * @returns Array of discrepancy messages, empty if parity is achieved
 */
export function validateParityWithLegacy(
  summary: PropertyContributionSummary,
  legacyIncomeFromProperties: number,
  legacyExpenseFromProperties: number,
  legacyLiabilityFromProperties: number,
): string[] {
  const discrepancies: string[] = [];
  const tolerance = 1; // $1 tolerance for rounding

  if (Math.abs(summary.totalLegacyIncome - legacyIncomeFromProperties) > tolerance) {
    discrepancies.push(
      `Income mismatch: engine=$${summary.totalLegacyIncome.toFixed(2)}, legacy=$${legacyIncomeFromProperties.toFixed(2)}`
    );
  }

  if (Math.abs(summary.totalLegacyExpense - legacyExpenseFromProperties) > tolerance) {
    discrepancies.push(
      `Expense mismatch: engine=$${summary.totalLegacyExpense.toFixed(2)}, legacy=$${legacyExpenseFromProperties.toFixed(2)}`
    );
  }

  if (Math.abs(summary.totalLegacyLiability - legacyLiabilityFromProperties) > tolerance) {
    discrepancies.push(
      `Liability mismatch: engine=$${summary.totalLegacyLiability.toFixed(2)}, legacy=$${legacyLiabilityFromProperties.toFixed(2)}`
    );
  }

  return discrepancies;
}
