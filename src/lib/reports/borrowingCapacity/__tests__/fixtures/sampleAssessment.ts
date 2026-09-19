/**
 * One fictional assessment, shared by every Borrowing Capacity test.
 *
 * It lives here rather than inside a spec because two things need to agree
 * about it: the golden capture of the shipping generator
 * (`src/components/borrowing-capacity/__tests__/snapshotGolden.spec.ts`) and
 * the payload contract that replaces it. If they drift, the golden stops being
 * a comparison and becomes decoration.
 *
 * **Fictional, and it must stay that way.** A golden is written to disk,
 * rasterised and pasted into review threads. Real client financials must never
 * be the thing that gets shared.
 *
 * ## Every field name here was read from its producer
 *
 * Four drafts of this fixture were written from summaries of the code instead
 * of the code, and each one produced plausible, wrong output — rows all
 * labelled "Income", 100% shading on everything, `Rate NaN%`. The provenance of
 * each shape is noted where it is not obvious. When adding to it, open the
 * producer.
 */

/**
 * The audit trail, as `calculate-borrowing-capacity` builds it.
 *
 * `category` is lowercase singular (`index.ts:194`); `action` is one of the
 * strings passed at the `audit.add(…)` call sites (`:1639`–`:1674`) — **not** a
 * free-text verb, because `audit.pure.ts` keys its unit and polarity tables on
 * it; `rawValue`/`assessedValue`/`delta` are numbers; the summary keys are the
 * four the renderer reads (`:214`–`:217`).
 *
 * The entries below are chosen to cover the interesting cases rather than to be
 * a plausible trail:
 *
 *  - `income/shading_applied` — an ordinary annual money pair.
 *  - `expense/hem_benchmark_applied` — a **monthly** pair, in the same table as
 *    the annual ones, and one whose positive delta *reduces* capacity.
 *  - `liability/credit_card_limit_rate` — a balance against a monthly
 *    repayment: two different units, and therefore no meaningful delta.
 *  - `policy/override_applied` — an interest **rate**, the entry the shipping
 *    report prints as "$6 → $9".
 *  - `policy/lender_profile_selected` — two zeroes that mean "not applicable".
 */
export const SAMPLE_AUDIT_TRAIL = {
  summary: {
    totalTransformations: 5,
    byCategory: { income: 2, expense: 1, liability: 1, policy: 1, tax: 0, property: 0, constraint: 0 },
    totalIncomeShading: 14_600,
    totalExpenseAdjustments: 700,
    totalLiabilityAdjustments: 240,
    totalTaxImpact: 0,
    hasOverrides: true,
    hasConstraints: false,
  },
  entries: [
    { seq: 1, category: 'income', action: 'shading_applied', label: 'Rental income', rawValue: 20_000, assessedValue: 16_000, delta: -4_000, impact: 'decrease', rule: '80% shading' },
    { seq: 2, category: 'income', action: 'shading_applied', label: 'Bonus', rawValue: 21_200, assessedValue: 10_600, delta: -10_600, impact: 'decrease', rule: '50% shading' },
    { seq: 3, category: 'expense', action: 'hem_benchmark_applied', label: 'Living Expenses', rawValue: 4_120, assessedValue: 4_820, delta: 700, impact: 'increase', rule: 'Method: hybrid', note: 'HEM $4,820/mo vs Declared $4,120/mo' },
    { seq: 4, category: 'liability', action: 'credit_card_limit_rate', label: 'Credit Card', rawValue: 8_000, assessedValue: 240, delta: -7_760, impact: 'decrease', rule: '$240/mo servicing' },
    { seq: 5, category: 'policy', action: 'override_applied', label: 'Interest Rate Override', rawValue: 6.15, assessedValue: 8.65, delta: 2.5, impact: 'increase', rule: 'Manual override' },
    { seq: 6, category: 'policy', action: 'lender_profile_selected', label: 'Lender Profile', rawValue: 0, assessedValue: 0, delta: 0, impact: 'neutral', rule: 'Example Bank — Investor P&I' },
  ],
};

/** The explanation report. Its figures arrive pre-formatted as prose. */
export const SAMPLE_EXPLANATION = {
  executiveSummary:
    'Capacity is set by serviceability rather than deposit: the assessed surplus supports '
    + '$785,000 at the 8.65% assessment rate, while the deposit would support more.',
  steps: [
    {
      step: 1,
      title: 'Shade the income',
      narrative: 'Rental income is shaded to 80% under the selected lender policy; PAYG salary is taken in full.',
      figures: [
        { label: 'Gross annual income', value: '$186,000' },
        { label: 'Shaded annual income', value: '$171,400' },
      ],
    },
    {
      step: 2,
      title: 'Deduct assessed expenses',
      narrative: 'The greater of declared expenses and the HEM benchmark is used, then existing commitments are deducted.',
      figures: [
        { label: 'Assessed living expenses', value: '$4,820 / month' },
        { label: 'Existing commitments', value: '$1,310 / month' },
      ],
    },
    {
      step: 3,
      title: 'Convert surplus to capacity',
      narrative: 'The residual surplus is capitalised over 30 years at the assessment rate of 8.65%.',
      figures: [{ label: 'Borrowing capacity', value: '$785,000' }],
    },
  ],
};

/**
 * A `borrowing_capacity_assessments` row.
 *
 * `income_breakdown` uses the shape `calculateIncomeBreakdown` writes
 * (`calculate-borrowing-capacity/index.ts:755`): `component`, `grossAmount`,
 * `shadingRate` as a **0–1 fraction**, `shadedAmount`.
 *
 * `lmi_mode` is one of `none | display_deduction | debt_capitalised` — the
 * values the insert actually writes (`:1972`). The renderer only tests
 * `!== 'none'`, so a made-up value renders; it just renders the wrong branch.
 *
 * The third income row carries `shadingRate: 0` deliberately: income the lender
 * counts none of. Every `||`-based reader in the repo turns that into 100%.
 */
export const SAMPLE_ASSESSMENT = {
  id: '11111111-2222-4333-8444-555555555555',
  created_at: '2026-08-01T00:00:00.000Z',
  borrowing_capacity: 785_000,
  stress_tested_capacity: 712_000,
  monthly_surplus: 1_840,
  serviceability_band: 'green',
  dti_ratio: 5.4,
  assessment_rate: 8.65,
  interest_rate_used: 6.15,
  buffer_rate: 2.5,
  loan_term_years: 30,
  gross_annual_income: 186_000,
  shaded_annual_income: 171_400,
  living_expenses_monthly: 4_820,
  existing_commitments_monthly: 1_310,
  expense_method: 'hybrid',
  deposit_amount: 157_000,
  property_value_estimate: 942_000,
  proposed_loan_amount: 760_000,
  net_purchase_capacity: 942_000,
  lmi_mode: 'debt_capitalised',
  lmi_amount: 18_640,
  lmi_lvr_trigger: 80,
  income_breakdown: [
    { component: 'PAYG salary — applicant 1', grossAmount: 124_000, shadingRate: 1, shadedAmount: 124_000 },
    { component: 'PAYG salary — applicant 2', grossAmount: 42_000, shadingRate: 1, shadedAmount: 42_000 },
    { component: 'Rental income', grossAmount: 20_000, shadingRate: 0.8, shadedAmount: 16_000 },
    { component: 'Unbanked cash income', grossAmount: 9_000, shadingRate: 0, shadedAmount: 0 },
  ],
  liability_breakdown: [
    { type: 'mortgage', label: 'Example Bank', balance: 412_000, monthlyServicing: 2_480 },
    { type: 'car_loan', label: 'Example Finance', balance: 21_400, monthlyServicing: 610 },
    { type: 'credit_card', label: 'Example Bank', balance: 8_000, limit: 8_000, monthlyServicing: 240 },
  ],
  assumptions: {
    selectedLenderName: 'Example Bank — Investor P&I',
    items: [
      { key: 'hem_benchmark', value: '$4,820 / month (2 adults, 1 dependant)' },
      { key: 'shading_policy', value: 'Rental 80%, overtime 80%, bonus 50%' },
    ],
  },
  recommendations: [
    'Clear the credit card limit before application — the limit, not the balance, is assessed.',
    'A twelve-month rental ledger would remove the 20% shading on the investment income.',
  ],
  warnings: ['DTI of 5.4 is above the 5.0 threshold at several lenders.'],
};

/**
 * Saved what-if presets.
 *
 * `adjustedInputs` is a **whole** `BorrowingCapacityInput` and `result` a whole
 * `BorrowingCapacityResult` (`StrategyScenarioModeling.tsx:174`). A partial one
 * is not a smaller version of the real thing — it is a different thing, and it
 * makes the shipping generator print `Rate NaN%`, which the product never
 * produces.
 */
const BASE_INPUTS = {
  grossAnnualIncome: 186_000,
  shadedAnnualIncome: 171_400,
  monthlyLivingExpenses: 4_820,
  monthlyCommitments: 1_310,
  interestRate: 6.15,
  bufferRate: 2.5,
  loanTermYears: 30,
  totalDebtBalances: 441_400,
};

const acquisition = (maxPurchasePrice: number, loan: number) => ({
  releasedCapital: 0,
  lmi: 18_640,
  lmiMode: 'debt_capitalised' as const,
  stampDuty: 37_290,
  otherAcquisitionCosts: 3_200,
  maxPurchasePrice,
  loanAvailableForPurchase: loan,
  cashAvailable: 157_000,
});

export const SAMPLE_SCENARIO_PRESETS = [
  {
    id: 'base',
    name: 'Base Case (Original)',
    isBase: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    adjustedInputs: { ...BASE_INPUTS },
    result: {
      borrowingCapacity: 785_000,
      monthlySurplus: 1_840,
      serviceabilityBand: 'green',
      stressTestedCapacity: 712_000,
      dtiRatio: 5.4,
      assessmentRate: 8.65,
      recommendations: [],
      warnings: [],
      afterTaxAnnualIncome: 131_800,
      monthlyAfterTaxIncome: 10_983,
    },
    acquisitionCapacity: acquisition(942_000, 785_000),
  },
  {
    id: 'clear-card',
    name: 'Clear the credit card',
    isBase: false,
    createdAt: '2026-08-01T00:05:00.000Z',
    adjustedInputs: { ...BASE_INPUTS, monthlyCommitments: 1_070, totalDebtBalances: 433_400 },
    result: {
      borrowingCapacity: 812_000,
      monthlySurplus: 2_080,
      serviceabilityBand: 'green',
      stressTestedCapacity: 736_000,
      dtiRatio: 5.2,
      assessmentRate: 8.65,
      recommendations: [],
      warnings: [],
      afterTaxAnnualIncome: 131_800,
      monthlyAfterTaxIncome: 10_983,
    },
    acquisitionCapacity: acquisition(975_000, 812_000),
    scenarioDeltas: [
      { id: 'cc-1', label: 'Close credit card', type: 'liability_removed', value: 8_000, unit: 'absolute' },
    ],
  },
  {
    id: 'rate-rise',
    name: 'Rate rise 100bp',
    isBase: false,
    createdAt: '2026-08-01T00:10:00.000Z',
    adjustedInputs: { ...BASE_INPUTS, interestRate: 7.15 },
    result: {
      borrowingCapacity: 704_000,
      monthlySurplus: 1_180,
      serviceabilityBand: 'amber',
      stressTestedCapacity: 638_000,
      dtiRatio: 5.9,
      assessmentRate: 9.65,
      recommendations: [],
      warnings: [],
      afterTaxAnnualIncome: 131_800,
      monthlyAfterTaxIncome: 10_983,
    },
    acquisitionCapacity: acquisition(845_000, 704_000),
    scenarioDeltas: [
      { id: 'rate-1', label: 'Interest rate', type: 'rate_change', value: 1, unit: 'percent' },
    ],
  },
];

/** A white-label tenant that is deliberately not us — see `BORROWING_CAPACITY.md` F1. */
export const SAMPLE_GLOBAL_SETTINGS = {
  contactDetails: {
    company_name: 'Meridian Property Partners',
    website: 'meridianpartners.example',
    email: 'advice@meridianpartners.example',
    phone: '+61 7 5555 0100',
    address: 'Level 8, 100 Example Street, Brisbane QLD 4000',
    abn: '11 222 333 444',
  },
  disclaimer: {
    is_enabled: true,
    font_size: 'small',
    text: 'This report is general in nature and does not take into account your '
      + 'objectives, financial situation or needs.',
  },
};

/** The client name the fixture uses, already cased for display. */
export const SAMPLE_CLIENT_NAME = 'A. & J. Sample';
