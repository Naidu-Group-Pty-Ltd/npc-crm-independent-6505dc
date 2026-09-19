/**
 * Synthetic `investment_reports` rows — one per tier, for the ownership
 * regression that MUST run in CI.
 *
 * ## Why these exist
 *
 * `tierOwnership.spec.ts` originally read `.verify/fixtures/`, which holds
 * real production rows and is gitignored. That passed locally and **failed
 * `verify` in CI at commit `247dd4683`**, because the file is not in the
 * repository:
 *
 *     .verify/fixtures/89b451f6-93d9-4fb5-ba62-c554b1b83e4e/report.json
 *
 * The two wrong ways out of that are skipping the ownership assertions — the
 * regression then guards nothing where it matters most, on every push — and
 * committing the production rows, which puts customer data in the repository.
 * So the assertions run against rows built here instead.
 *
 * ## What makes them safe, and what makes them sufficient
 *
 * **Safe:** nothing here is derived from a customer record. The address is
 * fictional, every figure is a round invented number, and no date is read from
 * the clock. Two identical runs produce two identical rows.
 *
 * **Sufficient:** every assertion in the ownership regression is about
 * STRUCTURE — which namespaces a tier publishes, which sections it declares,
 * what its cover promises — and none is about a particular property's values.
 * A synthetic row exercises each of those exactly as a production row does,
 * because `projectInvestmentReport` branches on `report_tier` and on whether a
 * field is present, never on what a figure happens to be.
 *
 * The retained production rows are still read, separately and under their own
 * heading, by the replay half of that spec — which skips where the fixtures
 * are absent and says so. The two halves are never mixed: one proves the rule
 * on every push, the other proves the rule holds on real records when someone
 * has them.
 *
 * ## The record is self-consistent on purpose
 *
 * `reconcileStoredFinancials` heals a stored finance block whose deposit and
 * loan contradict its LVR. These rows satisfy the identity outright —
 * 120,000 + 480,000 = 600,000, and 480,000 / 600,000 = 80% — so the
 * regression measures the projection rather than the healer.
 */

/** Deterministic, fictional, and recognisable as such in any output. */
export const SYNTHETIC_ADDRESS = '1 Specimen Street, Exampleton NSW 2000';

const PRICE = 600_000;
const WEEKLY_RENT = 500;
const OCCUPANCY_WEEKS = 50;
const DEPOSIT = 120_000;
const LOAN = 480_000;

const projectionRow = (year: number) => ({
  year,
  propertyValue: PRICE + year * 18_000,
  annualRent: WEEKLY_RENT * 52 + year * 500,
  cashFlow: -4_000 + year * 300,
  cumulativeCashFlow: -4_000 * year,
  loanBalance: LOAN,
  equity: PRICE + year * 18_000 - LOAN,
  roi: year,
});
const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(projectionRow);

/** The finance block, in the shape the production rows carry. */
export const syntheticFinancials = () => ({
  income: { weeklyRent: WEEKLY_RENT, annualRent: WEEKLY_RENT * 52 },
  keyMetrics: {
    lvr: 80,
    weeklyNet: -80,
    annualNet: -4_160,
    grossRentalYield: 4.33,
    netRentalYield: 2.1,
    cashOnCashReturn: 1.2,
    totalInvestment: 150_000,
  },
  annualCosts: {
    councilRates: 2_000, waterRates: 1_000, landlordInsurance: 1_200,
    propertyManagement: 1_820, propertyManagementPercent: 7, lettingFees: 500,
    maintenance: 1_500, strataFees: 0, landTax: 0,
    totalAnnual: 8_020, totalAnnualExcludingLandTax: 8_020,
  },
  assumptions: { capitalGrowth: 3, occupancyWeeks: OCCUPANCY_WEEKS },
  loanDetails: {
    loanAmount: LOAN, lvr: 80, lvrTier: 'standard', loanType: 'principal_and_interest',
    interestRate: 6, rateSource: 'assumption', borrowerType: 'investor',
    weeklyPayment: 553, monthlyPayment: 2_397, totalInterest: 383_000,
  },
  initialCosts: {
    propertyValue: PRICE, deposit: DEPOSIT, loanAmount: LOAN,
    stampDuty: 22_000, stampDutyBeforeConcession: 22_000, stampDutyConcession: 0,
    stampDutyScheduleSource: 'synthetic fixture', stampDutyScheduleYear: 2026,
    legalFees: 1_500, inspectionFees: 800, lmi: 0,
    lmiRequired: false, fhbEligible: false, totalUpfront: 144_300,
  },
  taxBenefits: { depreciation: 3_000 },
  projections: { conservative: series, moderate: series, optimistic: series },
});

/** A score the composed sections can render from. */
export const syntheticScore = () => ({
  totalScore: 62,
  grade: 'C',
  recommendation: 'Proceed to contract review.',
  breakdown: [
    { dimension: 'growth', score: 58, weight: 40, scored: true },
    { dimension: 'location', score: 65, weight: 25, scored: true },
    { dimension: 'yield', score: 75, weight: 15, scored: true },
  ],
  coverage: { weightCovered: 0.8 },
  strengths: ['Established dwelling on a level lot.'],
  weaknesses: ['Holding cost is negative in year one.'],
  opportunities: ['Rent review at the next lease.'],
  risks: ['Interest rate movement.'],
});

/**
 * One synthetic row for a tier.
 *
 * `id` is derived from the tier so two runs agree and no id collides with a
 * real record: the `synthetic-` prefix is not a uuid any row carries.
 */
export const syntheticRow = (tier: string): Record<string, unknown> => ({
  id: `synthetic-${tier}`,
  property_address: SYNTHETIC_ADDRESS,
  report_tier: tier,
  report_variant: tier,
  status: 'completed',
  // An isolated, non-client record by construction.
  client_property_id: null,
  generated_by: null,
  is_client_report: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  generation_engine: 'compass',
  financial_calculations: syntheticFinancials(),
  investment_score: syntheticScore(),
  property_specs: { bedrooms: 3, bathrooms: 1, parking: 1, property_type: 'house' },
  manual_overrides: {},
  demographics_data: { state: 'NSW' },
  economic_data: {},
  location_intelligence: {},
  data_sources: {},
  report_content: '# Synthetic report\n\n## Executive Verdict\n\nA specimen record.\n',
  sources_content: null,
});
