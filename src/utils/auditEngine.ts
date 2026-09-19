/**
 * Audit Engine (Phase 5)
 * 
 * Tracks every raw→assessed transformation across income, expenses,
 * liabilities, and properties. Produces a structured audit trail that
 * enables full transparency into how each input was treated.
 * 
 * Consumed by:
 * - Edge function (calculate-borrowing-capacity) 
 * - ResultsPanel audit trail UI
 * - PDF report generators
 */

// ============================================
// AUDIT ENTRY TYPES
// ============================================

export type AuditCategory = 'income' | 'expense' | 'liability' | 'property' | 'tax' | 'policy' | 'constraint';

export type AuditAction = 
  | 'shading_applied'
  | 'vacancy_deduction'
  | 'frequency_conversion'
  | 'hem_benchmark_applied'
  | 'declared_expenses_used'
  | 'hybrid_max_applied'
  | 'assessment_rate_applied'
  | 'pi_conversion'
  | 'credit_card_limit_rate'
  | 'bnpl_limit_rate'
  | 'hecs_threshold_applied'
  | 'negative_cf_layered'
  | 'positive_cf_as_income'
  | 'tax_calculated'
  | 'medicare_levy_applied'
  | 'dti_cap_applied'
  | 'conservative_surplus_buffer'
  | 'conservative_residual_floor'
  | 'stress_test_applied'
  | 'lmi_capitalised'
  | 'rental_expense_treated'
  | 'override_applied'
  | 'lender_profile_selected'
  | 'proposed_rental_shaded';

export interface AuditEntry {
  /** Unique sequential ID */
  seq: number;
  /** Category of the transformation */
  category: AuditCategory;
  /** What action was performed */
  action: AuditAction;
  /** Human-readable label for the line item */
  label: string;
  /** Raw input value (before transformation) */
  rawValue: number;
  /** Assessed/output value (after transformation) */
  assessedValue: number;
  /** The rule or rate applied */
  rule: string;
  /** Delta = assessedValue - rawValue */
  delta: number;
  /** Impact direction */
  impact: 'increase' | 'decrease' | 'neutral';
  /** Optional: additional context */
  note?: string;
}

// ============================================
// AUDIT TRAIL (collector)
// ============================================

export interface AuditTrail {
  /** All audit entries in order */
  entries: AuditEntry[];
  /** Summary statistics */
  summary: AuditSummary;
  /** ISO timestamp */
  generatedAt: string;
}

export interface AuditSummary {
  /** Total number of transformations applied */
  totalTransformations: number;
  /** Breakdown by category */
  byCategory: Record<AuditCategory, number>;
  /** Total income reduction from shading */
  totalIncomeShading: number;
  /** Total expense adjustments */
  totalExpenseAdjustments: number;
  /** Total liability adjustments */
  totalLiabilityAdjustments: number;
  /** Total tax impact */
  totalTaxImpact: number;
  /** Whether any overrides were applied */
  hasOverrides: boolean;
  /** Whether any constraints capped the result */
  hasConstraints: boolean;
}

// ============================================
// AUDIT TRAIL BUILDER
// ============================================

export class AuditTrailBuilder {
  private entries: AuditEntry[] = [];
  private seq = 0;

  /** Add an audit entry */
  add(
    category: AuditCategory,
    action: AuditAction,
    label: string,
    rawValue: number,
    assessedValue: number,
    rule: string,
    note?: string,
  ): void {
    const delta = assessedValue - rawValue;
    this.entries.push({
      seq: ++this.seq,
      category,
      action,
      label,
      rawValue: Math.round(rawValue * 100) / 100,
      assessedValue: Math.round(assessedValue * 100) / 100,
      rule,
      delta: Math.round(delta * 100) / 100,
      impact: delta > 0.01 ? 'increase' : delta < -0.01 ? 'decrease' : 'neutral',
      note,
    });
  }

  /** Add an income shading entry */
  addIncomeShading(label: string, grossAmount: number, shadingRate: number, shadedAmount: number, note?: string): void {
    this.add('income', 'shading_applied', label, grossAmount, shadedAmount, `${(shadingRate * 100).toFixed(0)}% shading`, note);
  }

  /** Add an expense determination entry */
  addExpenseDetermination(hemBenchmark: number, declaredExpenses: number, usedAmount: number, method: string): void {
    if (method === 'hem') {
      this.add('expense', 'hem_benchmark_applied', 'Living Expenses (HEM)', declaredExpenses, hemBenchmark, 'HEM > Declared', `HEM $${hemBenchmark}/mo vs Declared $${declaredExpenses}/mo`);
    } else if (method === 'declared_higher') {
      this.add('expense', 'declared_expenses_used', 'Living Expenses (Declared)', hemBenchmark, declaredExpenses, 'Declared > HEM', `Declared $${declaredExpenses}/mo vs HEM $${hemBenchmark}/mo`);
    } else if (method === 'declared') {
      this.add('expense', 'override_applied', 'Living Expenses (Override)', hemBenchmark, usedAmount, 'User override', 'Manual override from UI');
    }
  }

  /** Add a negative property cash flow entry */
  addNegativeCashFlow(address: string, monthlyAmount: number): void {
    this.add('property', 'negative_cf_layered', `Negative CF: ${address}`, 0, monthlyAmount, 'Added to expenses', `$${monthlyAmount.toFixed(0)}/mo negative cash flow layered on expenses`);
  }

  /** Add a positive property cash flow entry */
  addPositiveCashFlow(address: string, grossAnnual: number, shadedAnnual: number, shadingRate: number): void {
    this.add('property', 'positive_cf_as_income', `Positive CF: ${address}`, grossAnnual, shadedAnnual, `${(shadingRate * 100).toFixed(0)}% shading`, `$${(grossAnnual / 12).toFixed(0)}/mo → $${(shadedAnnual / 12).toFixed(0)}/mo after shading`);
  }

  /** Add a liability assessment entry */
  addLiabilityAssessment(type: string, rawServicing: number, assessedServicing: number, rule: string, note?: string): void {
    this.add('liability', rawServicing !== assessedServicing ? 'assessment_rate_applied' : 'pi_conversion', type, rawServicing, assessedServicing, rule, note);
  }

  /** Add a credit card assessment entry */
  addCreditCardAssessment(balance: number, limit: number, monthlyServicing: number, rate: number): void {
    this.add('liability', 'credit_card_limit_rate', 'Credit Card', balance, monthlyServicing, `${(rate * 100).toFixed(1)}% of $${limit.toLocaleString('en-AU')} limit`);
  }

  /** Add HECS assessment */
  addHecsAssessment(balance: number, monthlyRepayment: number, rate: number, annualIncome: number): void {
    this.add('liability', 'hecs_threshold_applied', 'HECS/HELP', balance, monthlyRepayment, `${(rate * 100).toFixed(1)}% of $${annualIncome.toLocaleString('en-AU')} income`);
  }

  /** Add tax calculation entry */
  addTaxCalculation(grossIncome: number, totalTax: number, afterTax: number, effectiveRate: number): void {
    this.add('tax', 'tax_calculated', 'Income Tax', grossIncome, afterTax, `${(effectiveRate * 100).toFixed(1)}% effective rate`, `Tax $${totalTax.toLocaleString('en-AU')}`);
  }

  /** Add Medicare levy entry */
  addMedicareLevy(grossIncome: number, levyAmount: number, rate: number): void {
    this.add('tax', 'medicare_levy_applied', 'Medicare Levy', 0, levyAmount, `${(rate * 100).toFixed(0)}% of gross income`);
  }

  /** Add DTI cap constraint */
  addDtiCapApplied(uncappedCapacity: number, cappedCapacity: number, dtiCap: number): void {
    this.add('constraint', 'dti_cap_applied', 'DTI Cap', uncappedCapacity, cappedCapacity, `DTI capped at ${dtiCap}x`, `Capacity reduced by $${(uncappedCapacity - cappedCapacity).toLocaleString('en-AU')}`);
  }

  /** Add conservative mode adjustments */
  addConservativeAdjustment(action: AuditAction, label: string, before: number, after: number, rule: string): void {
    this.add('constraint', action, label, before, after, rule);
  }

  /** Add stress test entry */
  addStressTest(baseCapacity: number, stressedCapacity: number, increment: number): void {
    this.add('constraint', 'stress_test_applied', 'Stress Test', baseCapacity, stressedCapacity, `+${increment}% above assessment rate`);
  }

  /** Add LMI capitalisation entry */
  addLmiCapitalised(lmiAmount: number, monthlyServicing: number): void {
    this.add('constraint', 'lmi_capitalised', 'LMI Capitalised', 0, lmiAmount, `+$${monthlyServicing.toFixed(0)}/mo servicing`, `LMI premium added to loan balance and serviced at assessment rate`);
  }

  /** Add lender profile selection */
  addLenderProfile(profileName: string): void {
    this.add('policy', 'lender_profile_selected', 'Lender Profile', 0, 0, profileName, `Policy parameters adjusted for ${profileName}`);
  }

  /** Add override entry */
  addOverride(field: string, originalValue: number, overrideValue: number): void {
    this.add('policy', 'override_applied', `Override: ${field}`, originalValue, overrideValue, 'Manual override');
  }

  /** Add property loan P&I conversion */
  addPropertyLoanPIConversion(address: string, actualRepayment: number, piRepayment: number, assessmentRate: number): void {
    this.add('liability', 'pi_conversion', `Loan P&I: ${address}`, actualRepayment, Math.max(actualRepayment, piRepayment), `P&I at ${(assessmentRate * 100).toFixed(1)}%`, actualRepayment < piRepayment ? 'Actual repayment lower than assessed P&I' : 'Actual repayment used (higher than P&I)');
  }

  /** Build the final audit trail */
  build(): AuditTrail {
    const byCategory: Record<AuditCategory, number> = {
      income: 0, expense: 0, liability: 0, property: 0, tax: 0, policy: 0, constraint: 0,
    };

    let totalIncomeShading = 0;
    let totalExpenseAdjustments = 0;
    let totalLiabilityAdjustments = 0;
    let totalTaxImpact = 0;
    let hasOverrides = false;
    let hasConstraints = false;

    for (const entry of this.entries) {
      byCategory[entry.category]++;
      if (entry.category === 'income') totalIncomeShading += Math.abs(entry.delta);
      if (entry.category === 'expense') totalExpenseAdjustments += Math.abs(entry.delta);
      if (entry.category === 'liability') totalLiabilityAdjustments += Math.abs(entry.delta);
      if (entry.category === 'tax') totalTaxImpact += Math.abs(entry.delta);
      if (entry.action === 'override_applied') hasOverrides = true;
      if (entry.category === 'constraint') hasConstraints = true;
    }

    return {
      entries: this.entries,
      summary: {
        totalTransformations: this.entries.length,
        byCategory,
        totalIncomeShading,
        totalExpenseAdjustments,
        totalLiabilityAdjustments,
        totalTaxImpact,
        hasOverrides,
        hasConstraints,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

// ============================================
// FACTORY
// ============================================

export function createAuditTrailBuilder(): AuditTrailBuilder {
  return new AuditTrailBuilder();
}
