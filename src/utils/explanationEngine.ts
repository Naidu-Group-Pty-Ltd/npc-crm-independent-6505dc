/**
 * Explanation Engine (Phase 5)
 * 
 * Generates human-readable, plain-English narratives explaining
 * how the borrowing capacity figure was derived. Designed for:
 * - Client-facing PDF reports
 * - In-app "How was this calculated?" panel
 * - Advisor talking points
 * 
 * Each explanation step maps to a calculation stage and references
 * the audit trail entries for traceability.
 */

import type { AuditTrail, AuditEntry } from './auditEngine';

// ============================================
// EXPLANATION TYPES
// ============================================

export interface ExplanationStep {
  /** Step number (1-based) */
  step: number;
  /** Short heading */
  title: string;
  /** Plain-English paragraph explaining this step */
  narrative: string;
  /** Key figures referenced */
  figures: { label: string; value: string }[];
  /** Related audit entry sequence numbers */
  auditRefs: number[];
  /** Icon hint for UI rendering */
  icon: 'income' | 'expense' | 'liability' | 'tax' | 'capacity' | 'dti' | 'stress' | 'band' | 'policy' | 'property';
}

export interface ExplanationReport {
  /** Overall summary sentence */
  headline: string;
  /** Ordered explanation steps */
  steps: ExplanationStep[];
  /** One-paragraph executive summary */
  executiveSummary: string;
  /** Generated timestamp */
  generatedAt: string;
}

// ============================================
// EXPLANATION INPUT (mirrors edge function outputs)
// ============================================

export interface ExplanationInput {
  // Core results
  borrowingCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  stressTestedCapacity: number;
  dtiRatio: number;
  assessmentRate: number;

  // Income
  grossAnnualIncome: number;
  shadedAnnualIncome: number;
  incomeBreakdownCount: number;

  // Tax
  afterTaxAnnualIncome: number;
  totalTax: number;
  effectiveTaxRate: number;
  marginalTaxRate: number;

  // Expenses
  livingExpensesMonthly: number;
  hemBenchmark: number;
  declaredExpenses: number;
  expenseMethod: string;
  negativePropertyCashFlows: number;
  totalLivingExpenses: number;

  // Liabilities
  existingCommitmentsMonthly: number;
  totalDebtBalances: number;
  liabilityCount: number;

  // Loan params
  interestRate: number;
  bufferRate: number;
  loanTermYears: number;

  // Policy
  policyName: string;
  calculationMode: string;
  dtiCapEnabled: boolean;
  dtiCapLimit: number;

  // LMI
  lmiAmount: number;
  lmiMode: string;

  // Properties
  propertyCount: number;

  // Optional audit trail for cross-referencing
  auditTrail?: AuditTrail;
}

// ============================================
// HELPER: format currency
// ============================================

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function fmtPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function getAuditRefs(auditTrail: AuditTrail | undefined, category: string): number[] {
  if (!auditTrail) return [];
  return auditTrail.entries.filter(e => e.category === category).map(e => e.seq);
}

// ============================================
// GENERATE EXPLANATION REPORT
// ============================================

export function generateExplanation(input: ExplanationInput): ExplanationReport {
  const steps: ExplanationStep[] = [];
  let stepNum = 0;

  // Step 1: Policy
  if (input.policyName !== 'Default APRA') {
    steps.push({
      step: ++stepNum,
      title: 'Lender Policy Applied',
      narrative: `The calculation uses the "${input.policyName}" lender profile, which applies specific buffer rates, income shading rules, and serviceability thresholds that may differ from the standard APRA defaults.`,
      figures: [
        { label: 'Profile', value: input.policyName },
        { label: 'Mode', value: input.calculationMode === 'conservative' ? 'Conservative' : 'Bank Standard' },
      ],
      auditRefs: getAuditRefs(input.auditTrail, 'policy'),
      icon: 'policy',
    });
  }

  // Step 2: Income Assessment
  const shadingReduction = input.grossAnnualIncome - input.shadedAnnualIncome;
  const shadingPct = input.grossAnnualIncome > 0 ? (shadingReduction / input.grossAnnualIncome) * 100 : 0;
  steps.push({
    step: ++stepNum,
    title: 'Income Assessment',
    narrative: `Gross annual income of ${fmtCurrency(input.grossAnnualIncome)} from ${input.incomeBreakdownCount} source${input.incomeBreakdownCount !== 1 ? 's' : ''} was assessed. After applying APRA income shading rules (which discount variable income streams like bonuses, overtime, and rental income to reflect sustainability), the assessed income is ${fmtCurrency(input.shadedAnnualIncome)}${shadingReduction > 0 ? ` — a reduction of ${fmtCurrency(shadingReduction)} (${shadingPct.toFixed(1)}%)` : ''}.`,
    figures: [
      { label: 'Gross Income', value: fmtCurrency(input.grossAnnualIncome) },
      { label: 'Shaded Income', value: fmtCurrency(input.shadedAnnualIncome) },
      { label: 'Shading Reduction', value: fmtCurrency(shadingReduction) },
      { label: 'Income Sources', value: String(input.incomeBreakdownCount) },
    ],
    auditRefs: getAuditRefs(input.auditTrail, 'income'),
    icon: 'income',
  });

  // Step 3: Tax Calculation
  steps.push({
    step: ++stepNum,
    title: 'Tax & After-Tax Income',
    narrative: `Income tax of ${fmtCurrency(input.totalTax)} was calculated using the 2025-26 Australian tax brackets (including 2% Medicare Levy), resulting in an effective tax rate of ${fmtPercent(input.effectiveTaxRate)} and a marginal rate of ${fmtPercent(input.marginalTaxRate)}. The after-tax annual income of ${fmtCurrency(input.afterTaxAnnualIncome)} (${fmtCurrency(Math.round(input.afterTaxAnnualIncome / 12))}/month) is the basis for serviceability.`,
    figures: [
      { label: 'Total Tax', value: fmtCurrency(input.totalTax) },
      { label: 'After-Tax Income', value: fmtCurrency(input.afterTaxAnnualIncome) },
      { label: 'Monthly Take-Home', value: `${fmtCurrency(Math.round(input.afterTaxAnnualIncome / 12))}/mo` },
      { label: 'Effective Tax Rate', value: fmtPercent(input.effectiveTaxRate) },
    ],
    auditRefs: getAuditRefs(input.auditTrail, 'tax'),
    icon: 'tax',
  });

  // Step 4: Living Expenses
  let expenseNarrative = '';
  if (input.expenseMethod === 'hem') {
    expenseNarrative = `Living expenses were set at the Household Expenditure Measure (HEM) benchmark of ${fmtCurrency(input.hemBenchmark)}/month, as this exceeds the declared expenses of ${fmtCurrency(input.declaredExpenses)}/month. Banks use the higher of HEM or declared expenses.`;
  } else if (input.expenseMethod === 'declared_higher') {
    expenseNarrative = `Declared living expenses of ${fmtCurrency(input.declaredExpenses)}/month were used as they exceed the HEM benchmark of ${fmtCurrency(input.hemBenchmark)}/month. Banks use the higher of the two.`;
  } else {
    expenseNarrative = `Living expenses of ${fmtCurrency(input.livingExpensesMonthly)}/month were used based on the provided override.`;
  }
  if (input.negativePropertyCashFlows > 0) {
    expenseNarrative += ` Additionally, ${fmtCurrency(input.negativePropertyCashFlows)}/month in negative property cash flows were layered on top, bringing total assessed expenses to ${fmtCurrency(input.totalLivingExpenses)}/month.`;
  }
  steps.push({
    step: ++stepNum,
    title: 'Living Expenses',
    narrative: expenseNarrative,
    figures: [
      { label: 'Base Expenses', value: `${fmtCurrency(input.livingExpensesMonthly)}/mo` },
      { label: 'HEM Benchmark', value: `${fmtCurrency(input.hemBenchmark)}/mo` },
      { label: 'Method', value: input.expenseMethod.replace('_', ' ').toUpperCase() },
      ...(input.negativePropertyCashFlows > 0 ? [{ label: 'Negative Property CF', value: `${fmtCurrency(input.negativePropertyCashFlows)}/mo` }] : []),
      { label: 'Total Expenses', value: `${fmtCurrency(input.totalLivingExpenses)}/mo` },
    ],
    auditRefs: getAuditRefs(input.auditTrail, 'expense'),
    icon: 'expense',
  });

  // Step 5: Existing Commitments
  steps.push({
    step: ++stepNum,
    title: 'Existing Commitments',
    narrative: `${input.liabilityCount} existing commitment${input.liabilityCount !== 1 ? 's' : ''} totalling ${fmtCurrency(input.existingCommitmentsMonthly)}/month were assessed. Existing property loans are stress-tested at P&I repayments at the assessment rate (regardless of actual loan type), credit cards at a percentage of the limit, and HECS/HELP based on income thresholds.${input.totalDebtBalances > 0 ? ` Total outstanding debt balance: ${fmtCurrency(input.totalDebtBalances)}.` : ''}`,
    figures: [
      { label: 'Monthly Commitments', value: `${fmtCurrency(input.existingCommitmentsMonthly)}/mo` },
      { label: 'Total Debt Balance', value: fmtCurrency(input.totalDebtBalances) },
      { label: 'Liability Count', value: String(input.liabilityCount) },
    ],
    auditRefs: getAuditRefs(input.auditTrail, 'liability'),
    icon: 'liability',
  });

  // Step 6: Capacity Calculation
  const monthlyAfterTax = Math.round(input.afterTaxAnnualIncome / 12);
  steps.push({
    step: ++stepNum,
    title: 'Borrowing Capacity Derivation',
    narrative: `Monthly surplus is calculated as after-tax income (${fmtCurrency(monthlyAfterTax)}/mo) minus total living expenses (${fmtCurrency(input.totalLivingExpenses)}/mo) minus existing commitments (${fmtCurrency(input.existingCommitmentsMonthly)}/mo), resulting in a surplus of ${fmtCurrency(input.monthlySurplus)}/month. This surplus is the maximum new repayment the client can afford. Using a P&I amortisation formula at the assessment rate of ${input.assessmentRate.toFixed(2)}% over ${input.loanTermYears} years, the maximum loan is ${fmtCurrency(input.borrowingCapacity)}.`,
    figures: [
      { label: 'Monthly After-Tax', value: `${fmtCurrency(monthlyAfterTax)}/mo` },
      { label: 'Monthly Surplus', value: `${fmtCurrency(input.monthlySurplus)}/mo` },
      { label: 'Assessment Rate', value: `${input.assessmentRate.toFixed(2)}%` },
      { label: 'Borrowing Capacity', value: fmtCurrency(input.borrowingCapacity) },
    ],
    auditRefs: [],
    icon: 'capacity',
  });

  // Step 7: DTI Check
  steps.push({
    step: ++stepNum,
    title: 'Debt-to-Income Ratio',
    narrative: `The DTI ratio is calculated as total debt (existing ${fmtCurrency(input.totalDebtBalances)} + new loan ${fmtCurrency(input.borrowingCapacity)}) divided by gross annual income (${fmtCurrency(input.grossAnnualIncome)}), yielding a DTI of ${input.dtiRatio.toFixed(1)}x.${input.dtiCapEnabled ? ` A DTI cap of ${input.dtiCapLimit}x is active${input.dtiRatio >= input.dtiCapLimit ? ' and has constrained the capacity.' : '.'}` : ' No DTI cap is currently active.'}`,
    figures: [
      { label: 'DTI Ratio', value: `${input.dtiRatio.toFixed(1)}x` },
      ...(input.dtiCapEnabled ? [{ label: 'DTI Cap', value: `${input.dtiCapLimit}x` }] : []),
    ],
    auditRefs: getAuditRefs(input.auditTrail, 'constraint'),
    icon: 'dti',
  });

  // Step 8: Stress Test
  steps.push({
    step: ++stepNum,
    title: 'Stress Test',
    narrative: `A stress test was performed at +1% above the assessment rate (${(input.assessmentRate + 1).toFixed(2)}%). Under this higher rate scenario, the stress-tested capacity is ${fmtCurrency(input.stressTestedCapacity)}, which is ${fmtCurrency(input.borrowingCapacity - input.stressTestedCapacity)} less than the base capacity.`,
    figures: [
      { label: 'Stress-Tested Capacity', value: fmtCurrency(input.stressTestedCapacity) },
      { label: 'Reduction', value: fmtCurrency(input.borrowingCapacity - input.stressTestedCapacity) },
    ],
    auditRefs: [],
    icon: 'stress',
  });

  // Step 9: LMI (if applicable)
  if (input.lmiMode !== 'none' && input.lmiAmount > 0) {
    const netCapacity = Math.max(0, input.borrowingCapacity - input.lmiAmount);
    steps.push({
      step: ++stepNum,
      title: 'Lenders Mortgage Insurance',
      narrative: input.lmiMode === 'debt_capitalised'
        ? `LMI of ${fmtCurrency(input.lmiAmount)} has been capitalised onto the loan, increasing the total debt balance and the monthly servicing obligation. This reduces the effective capacity available for the property purchase.`
        : `LMI of ${fmtCurrency(input.lmiAmount)} is displayed as a deduction from loan proceeds. The maximum borrowing capacity remains unchanged, but ${fmtCurrency(input.lmiAmount)} of the loan is allocated to the LMI premium, leaving ${fmtCurrency(netCapacity)} available for the property purchase.`,
      figures: [
        { label: 'LMI Amount', value: fmtCurrency(input.lmiAmount) },
        { label: 'Mode', value: input.lmiMode === 'debt_capitalised' ? 'Capitalised' : 'Display Deduction' },
        { label: 'Net for Purchase', value: fmtCurrency(netCapacity) },
      ],
      auditRefs: [],
      icon: 'capacity',
    });
  }

  // Step 10: Serviceability Band
  const bandDescriptions = {
    green: 'Strong borrowing position — the client has comfortable surplus and a healthy DTI ratio.',
    amber: 'Moderate capacity — the client can borrow but should proceed with caution. Consider debt reduction strategies.',
    red: 'Limited capacity — existing commitments constrain borrowing. Focus on improving financial position before new debt.',
  };
  steps.push({
    step: ++stepNum,
    title: 'Serviceability Band',
    narrative: `Based on the monthly surplus of ${fmtCurrency(input.monthlySurplus)}/month and DTI of ${input.dtiRatio.toFixed(1)}x, the serviceability band is ${input.serviceabilityBand.toUpperCase()}. ${bandDescriptions[input.serviceabilityBand]}`,
    figures: [
      { label: 'Band', value: input.serviceabilityBand.toUpperCase() },
    ],
    auditRefs: [],
    icon: 'band',
  });

  // Build headline
  const headline = `Borrowing capacity of ${fmtCurrency(input.borrowingCapacity)} assessed on ${fmtCurrency(input.grossAnnualIncome)} gross income with ${input.serviceabilityBand.toUpperCase()} serviceability.`;

  // Build executive summary
  const executiveSummary = `Based on a gross annual income of ${fmtCurrency(input.grossAnnualIncome)} (${fmtCurrency(input.shadedAnnualIncome)} after APRA shading), after-tax income of ${fmtCurrency(input.afterTaxAnnualIncome)}, living expenses of ${fmtCurrency(input.totalLivingExpenses)}/month, and existing commitments of ${fmtCurrency(input.existingCommitmentsMonthly)}/month, the maximum borrowing capacity is ${fmtCurrency(input.borrowingCapacity)} at an assessment rate of ${input.assessmentRate.toFixed(2)}% over ${input.loanTermYears} years. The DTI ratio is ${input.dtiRatio.toFixed(1)}x and the serviceability band is ${input.serviceabilityBand.toUpperCase()}.${input.stressTestedCapacity < input.borrowingCapacity ? ` Under stress testing at +1%, capacity reduces to ${fmtCurrency(input.stressTestedCapacity)}.` : ''}`;

  return {
    headline,
    steps,
    executiveSummary,
    generatedAt: new Date().toISOString(),
  };
}
