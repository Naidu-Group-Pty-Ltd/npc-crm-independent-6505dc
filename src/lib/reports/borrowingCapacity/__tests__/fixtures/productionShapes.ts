/**
 * Two assessments in the shapes production actually writes.
 *
 * `sampleAssessment.ts` is the Phase 0 fixture, and it is easier than
 * production in the ways that mattered on 28 Sep 2026: its assumptions are two
 * invented keys, not the seventeen `calculate-borrowing-capacity` writes; its
 * advice is hand-written, not the engine's fixed strings; it has no
 * `After-Tax Income Used`, so nothing could show that the working did not add
 * up; and every client in it has income. The two documents that were reviewed
 * that day were a client with **no income recorded** and a client whose band
 * was **limited by the DTI with a healthy surplus** — neither shape existed in
 * any fixture.
 *
 * **Fictional.** The shapes are production's — every key, every engine string,
 * the thirty-character address cut — and the names and figures are invented.
 * The serviceable one is internally consistent with the engine's arithmetic
 * (`calculateBorrowingCapacity`): after-tax income less living expenses, less
 * commitments, less $1,150 of negative property cash flow, is the stored
 * surplus, and the capacity and stress-tested capacity are that surplus at
 * 9.50% and 10.50% over 30 years.
 */

/** The seventeen assumption items, as `assumptionItems` writes them (`index.ts`). */
function engineAssumptions(p: {
  hem: string;
  assessable: string;
  dtiDenominator: string;
  afterTax: string;
  marginal: string;
}) {
  return [
    { key: 'Policy Profile', value: 'Default APRA' },
    { key: 'Serviceability Basis', value: 'After-Tax of SHADED (assessable) income' },
    { key: 'Buffer Rate', value: '3%' },
    { key: 'Assessment Rate', value: '9.5%' },
    { key: 'Loan Term', value: '30 years' },
    { key: 'HEM Benchmark', value: `${p.hem}/mo (income-scaled)` },
    { key: 'Repayment Type', value: 'Principal & Interest' },
    { key: 'Rental Expense Ratio', value: '20%' },
    { key: 'Existing Loan Stress Rate', value: 'P&I at 9.50% (max of policy 9.5% and assessment rate 9.50%)' },
    { key: 'Tax Year', value: '2025-26 (incl. 2% Medicare Levy)' },
    { key: 'Assessable Income (Shaded)', value: `${p.assessable}/yr` },
    { key: 'DTI Denominator (APS 220)', value: `${p.dtiDenominator}/yr` },
    { key: 'After-Tax Income Used', value: `${p.afterTax}/yr (on shaded income)` },
    { key: 'Marginal Tax Rate', value: p.marginal },
    { key: 'Stress Test Increment', value: '+1%' },
    { key: 'Credit Card Servicing', value: '3.0% of limit' },
    { key: 'Conservative Surplus Floor', value: '$1000/mo (zeroed below)' },
  ];
}

const COMMON = {
  interest_rate_used: 6.5,
  buffer_rate: 3,
  assessment_rate: 9.5,
  loan_term_years: 30,
  proposed_lvr: 80,
  lmi_mode: 'none',
  lmi_amount: 0,
};

/** A client with no income on the record — the engine still returns $0, 0.0x and a band. */
export const NO_INCOME_ASSESSMENT = {
  ...COMMON,
  id: '9a9a9a9a-0000-4000-8000-000000000001',
  created_at: '2026-07-09T02:00:00.000Z',
  gross_annual_income: 0,
  shaded_annual_income: 0,
  income_breakdown: [],
  living_expenses_monthly: 2_100,
  expense_method: 'hem',
  expense_breakdown: { hemBenchmark: 2_100, declaredExpenses: 0 },
  existing_commitments_monthly: 0,
  liability_breakdown: [],
  proposed_loan_amount: null,
  borrowing_capacity: 0,
  monthly_surplus: -2_100,
  serviceability_band: 'red',
  stress_tested_capacity: 0,
  dti_ratio: 0,
  recommendations: [
    'Limited borrowing capacity - focus on strengthening financial position',
    'Consider paying down high-interest debts first',
  ],
  warnings: ['Monthly expenses exceed income - unable to service new debt'],
  assumptions: {
    items: engineAssumptions({
      hem: '$2,100', assessable: '$0', dtiDenominator: '$0', afterTax: '$0', marginal: '0%',
    }),
    calculationMode: 'bank',
    dtiCapEnabled: false,
    dtiCapLimit: 6,
    selectedLenderName: null,
    lmiMode: 'none',
  },
  audit_trail: null,
  explanation: null,
};

/** The engine's own label for a property's positive cash flow, cut as it cuts it. */
const PROPERTY_ADDRESS = '14 Wattle Grove Sampleton, NSW 2380';
export const ENGINE_PROPERTY_LABEL = `Positive Cash Flow (${PROPERTY_ADDRESS.substring(0, 30)}...)`;

/**
 * A serviceable client whose band is limited by the DTI, not the surplus: the
 * shape that printed "Limited" in red beside a positive surplus and a loan
 * inside the limit, with nothing on the page saying why.
 */
export const DTI_LIMITED_ASSESSMENT = {
  ...COMMON,
  id: '9a9a9a9a-0000-4000-8000-000000000002',
  created_at: '2026-07-13T02:00:00.000Z',
  gross_annual_income: 164_400,
  shaded_annual_income: 161_520,
  income_breakdown: [
    { component: 'Primary Salary', grossAmount: 150_000, shadingRate: 1, shadedAmount: 150_000 },
    { component: ENGINE_PROPERTY_LABEL, grossAmount: 14_400, shadingRate: 0.8, shadedAmount: 11_520 },
  ],
  living_expenses_monthly: 2_600,
  expense_method: 'declared',
  expense_breakdown: { hemBenchmark: 3_120, declaredExpenses: 2_600 },
  existing_commitments_monthly: 2_450,
  liability_breakdown: [
    { type: 'Mortgage', label: 'Mortgage', balance: 420_000, monthlyServicing: 2_450 },
  ],
  proposed_loan_amount: 400_000,
  borrowing_capacity: 441_146,
  monthly_surplus: 3_709,
  serviceability_band: 'red',
  stress_tested_capacity: 405_510,
  // (420,000 listed + 610,000 of loans on properties held + 441,146) / 158,640
  dti_ratio: 9.27,
  recommendations: [
    'Limited borrowing capacity - focus on strengthening financial position',
    'Consider paying down high-interest debts first',
  ],
  warnings: ['DTI ratio exceeds most lender thresholds'],
  assumptions: {
    items: engineAssumptions({
      hem: '$3,120', assessable: '$161,520', dtiDenominator: '$158,640', afterTax: '$118,912.4', marginal: '37%',
    }),
    calculationMode: 'bank',
    dtiCapEnabled: false,
    dtiCapLimit: 6,
    selectedLenderName: null,
    lmiMode: 'none',
  },
  audit_trail: null,
  explanation: null,
};

/**
 * The explanation `calculate-borrowing-capacity` writes for the DTI-limited
 * client above, in the engine's own words — `generateExplanationServer`, run on
 * this fixture's figures (after-tax $118,912.40, $1,150 a month of negative
 * property cash flow, $1,030,000 of debt).
 *
 * Every assessment calculated since 14 Aug 2026 carries one of these, and the
 * two documents read on 28 Sep predated it, so no fixture had ever held one:
 * its narratives are a log's shorthand ("1 commitment(s)", "→ max loan",
 * "RED band"), its figures are pre-formatted strings, and its DTI step divides
 * by gross income, $164,400, where the stored 9.27x divides by the $158,640 the
 * ratio is defined over — so its own arithmetic does not reach the ratio it
 * prints (BORROWING_CAPACITY.md §21).
 */
export const DTI_LIMITED_ENGINE_EXPLANATION = {
  headline: 'Borrowing capacity of $441,146 on $164,400 gross income — RED serviceability.',
  steps: [
    { step: 1, title: 'Income Assessment', narrative: 'Gross income of $164,400 from 2 source(s) assessed at $161,520 after APRA shading (−$2,880 reduction).', figures: [{ label: 'Gross', value: '$164,400' }, { label: 'Shaded', value: '$161,520' }], icon: 'income' },
    { step: 2, title: 'Tax & After-Tax Income', narrative: 'Tax of $42,608 calculated (26.4% effective, 39.0% marginal). After-tax income: $118,912/yr ($9,909/mo).', figures: [{ label: 'Tax', value: '$42,608' }, { label: 'After-Tax', value: '$118,912' }], icon: 'tax' },
    { step: 3, title: 'Living Expenses', narrative: 'Expenses of $2,600/mo via override. Plus $1,150/mo negative property CF → total $3,750/mo.', figures: [{ label: 'Base', value: '$2,600/mo' }, { label: 'Total', value: '$3,750/mo' }], icon: 'expense' },
    { step: 4, title: 'Existing Commitments', narrative: '1 commitment(s) at $2,450/mo. Total debt: $1,030,000.', figures: [{ label: 'Monthly', value: '$2,450/mo' }, { label: 'Debt', value: '$1,030,000' }], icon: 'liability' },
    { step: 5, title: 'Capacity Derivation', narrative: 'Surplus = $9,909 − $3,750 − $2,450 = $3,709/mo. At 9.50% over 30yr → max loan $441,146.', figures: [{ label: 'Surplus', value: '$3,709/mo' }, { label: 'Capacity', value: '$441,146' }], icon: 'capacity' },
    { step: 6, title: 'DTI Ratio', narrative: 'DTI = ($1,030,000 + $441,146) / $164,400 = 9.3x.', figures: [{ label: 'DTI', value: '9.3x' }], icon: 'dti' },
    { step: 7, title: 'Stress Test', narrative: 'At +1% (10.50%), stressed capacity is $405,510 (−$35,636).', figures: [{ label: 'Stressed', value: '$405,510' }], icon: 'stress' },
    { step: 8, title: 'Serviceability Band', narrative: 'RED band. Limited — focus on debt reduction.', figures: [{ label: 'Band', value: 'RED' }], icon: 'band' },
  ],
  executiveSummary: 'On $164,400 gross ($161,520 shaded), after-tax $118,912, expenses $3,750/mo, commitments $2,450/mo → capacity $441,146 at 9.50% over 30yr. DTI 9.3x. Band: RED.',
  generatedAt: '2026-07-13T02:00:00.000Z',
};

/**
 * The audit trail the engine writes for the same client — the
 * `AuditTrailBuilder` calls in `calculate-borrowing-capacity/index.ts`, with its
 * own `build()` summary. Two of that summary's four totals are not totals of
 * anything a client can check: `totalLiabilityAdjustments` is each repayment
 * less its BALANCE ($417,550 beside a $420,000 mortgage), and `totalTaxImpact`
 * adds the Medicare levy to an after-tax figure that already nets it ($45,838
 * against $42,607.60 of tax). The shortfall entry stores the cost as a positive
 * figure (`Math.abs`), which is what the polarity table read backwards.
 */
export const DTI_LIMITED_ENGINE_AUDIT_TRAIL = {
  entries: [
    { seq: 1, category: 'income', action: 'shading_applied', label: 'Primary Salary', rawValue: 150_000, assessedValue: 150_000, rule: '100% shading', delta: 0, impact: 'neutral' },
    { seq: 2, category: 'income', action: 'shading_applied', label: ENGINE_PROPERTY_LABEL, rawValue: 14_400, assessedValue: 11_520, rule: '80% shading', delta: -2_880, impact: 'decrease' },
    { seq: 3, category: 'tax', action: 'tax_calculated', label: 'Income Tax', rawValue: 161_520, assessedValue: 118_912.4, rule: '26.4% effective rate', delta: -42_607.6, impact: 'decrease', note: 'Tax: $42607.6' },
    { seq: 4, category: 'tax', action: 'medicare_levy_applied', label: 'Medicare Levy', rawValue: 0, assessedValue: 3_230.4, rule: '2% of gross', delta: 3_230.4, impact: 'increase' },
    { seq: 5, category: 'expense', action: 'override_applied', label: 'Living Expenses', rawValue: 2_600, assessedValue: 2_600, rule: 'Method: Declared', delta: 0, impact: 'neutral', note: 'Couple, 1 dependant — HEM $3,120/mo vs Declared $2,600/mo' },
    { seq: 6, category: 'property', action: 'negative_cf_layered', label: 'Neg CF: 22 Example Road Sampleton NSW 2380', rawValue: 0, assessedValue: 1_150, rule: 'Layered on expenses', delta: 1_150, impact: 'increase' },
    { seq: 7, category: 'liability', action: 'assessment_rate_applied', label: 'Mortgage', rawValue: 420_000, assessedValue: 2_450, rule: '$2450/mo servicing', delta: -417_550, impact: 'decrease' },
    { seq: 8, category: 'constraint', action: 'stress_test_applied', label: 'Stress Test', rawValue: 441_146, assessedValue: 405_510, rule: '+1% above assessment', delta: -35_636, impact: 'decrease' },
  ],
  summary: {
    totalTransformations: 8,
    byCategory: { income: 2, expense: 1, liability: 1, property: 1, tax: 2, policy: 0, constraint: 1 },
    totalIncomeShading: 2_880,
    totalExpenseAdjustments: 0,
    totalLiabilityAdjustments: 417_550,
    totalTaxImpact: 45_838,
    hasOverrides: false,
    hasConstraints: true,
  },
  generatedAt: '2026-07-13T02:00:00.000Z',
};
