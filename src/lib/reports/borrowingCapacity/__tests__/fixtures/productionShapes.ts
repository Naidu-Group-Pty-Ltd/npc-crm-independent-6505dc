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
