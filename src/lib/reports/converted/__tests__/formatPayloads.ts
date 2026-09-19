/**
 * One maximal payload per bindable format, for the chapter drift guard.
 *
 * `converterChapters.spec.ts` has to compare `FORMAT_CHAPTERS` against what
 * each renderer actually prints, and every one of these formats builds its
 * chapter list conditionally — a section appears only when the payload has
 * something to put in it. So the comparison is only meaningful against a
 * payload that turns *everything* on. That is what these are: the longest
 * document each format can produce.
 *
 * Built through the real normalisers rather than as hand-written typed objects.
 * A cast-together payload would satisfy the compiler and could still be a shape
 * the normaliser never emits, which is the wrong thing to hold a renderer to.
 *
 * Everything here is invented. The names, addresses and figures are fictional
 * and deliberately so — these fixtures are committed.
 */
import { buildProjection } from '../../cashFlow/normalise.pure';
import { buildComparison } from '../../cashFlowComparison/normalise.pure';
import { buildClientDetails } from '../../clientDetails/normalise.pure';
import { buildPortfolioReview } from '../../portfolio/normalise.pure';
import { buildPropertyComparison } from '../../propertyComparison/normalise.pure';
import { buildMarketIntelligenceReport } from '../../marketIntelligence/normalise.pure';
import { cites, PREPARED_ON, prose, reportRow } from '../../marketIntelligence/__tests__/fixtures';

export const NOW = '2026-08-02T00:00:00.000Z';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

// ── Cash Flow ───────────────────────────────────────────────────────────────

/**
 * Ten years, because two of the format's chapter titles interpolate the term
 * and `FORMAT_CHAPTERS` had to pick one. This is where that choice is checked.
 */
const YEAR = {
  year: 1,
  calendarYear: 2027,
  propertyValue: 815_100,
  loanBalance: 612_768,
  rentalIncome: 32_240,
  grossYield: 3.96,
  netYield: 2.53,
  expenses: 11_657,
  interestRate: 6.15,
  interest: 37_685,
  principal: 11_232,
  preTaxAnnual: -29_534,
  afterTaxAnnual: -18_692,
  depreciation: 11_000,
  taxRefund: 10_842,
  landTax: 1_200,
  capitalGrowth: 4.5,
  cpiGrowth: 2.5,
};

const acquisition = {
  purchasePrice: 780_000,
  marketValue: 780_000,
  deposit: 156_000,
  loanAmount: 624_000,
  loanTermYears: 30,
  interestRate: 6.15,
  loanType: 'principal_interest',
  weeklyRent: 620,
  costs: [{ label: 'Stamp duty', amount: 31_090 }],
};

const tenYears = (afterTax = -18_692) =>
  Array.from({ length: 10 }, (_, i) => ({ ...YEAR, year: i + 1, calendarYear: 2027 + i, afterTaxAnnual: afterTax }));

/** Every section on: a projection with assumptions recorded. */
export const cashFlowMaximal = () => buildProjection({
  source: {
    acquisition,
    years: tenYears(),
    assumptions: [{ label: 'Capital growth', value: '4.5% per year' }],
    notes: ['Rent reviewed annually.'],
  },
  propertyAddress: '14 Wattlebird Grove, Marsden Park NSW 2765',
  clientName: 'Sample Client',
  now: NOW,
});

/** Nothing optional: no assumptions and no notes, so `What this assumes` drops. */
export const cashFlowMinimal = () => buildProjection({
  source: { acquisition, years: tenYears(), assumptions: [], notes: [] },
  propertyAddress: '14 Wattlebird Grove, Marsden Park NSW 2765',
  clientName: 'Sample Client',
  now: NOW,
});

// ── Cash Flow Comparison ────────────────────────────────────────────────────

const FULL_CF_ANALYSIS = {
  executiveSummary: 'A written comparison of the two properties.',
  cashFlowTrajectory: { strongestGrowth: { propertyNumber: 1, reason: 'Rent compounds faster.' } },
  capitalGrowth: { wealthBuilder: { propertyNumber: 1, reason: 'Interest only frees cash.' } },
  // `toRankings` reads `finalRankings`, and a ranking earns the "Each property
  // in turn" chapter only when it carries a verdict, strengths or weaknesses.
  finalRankings: [
    {
      rank: 1,
      address: '12 Example Street, Suburbia VIC 3000',
      score: 82,
      verdict: 'The stronger of the two over the full term.',
      strengths: ['Strongest cumulative position'],
      weaknesses: ['Highest entry cost'],
    },
    {
      rank: 2,
      address: '9 Sample Road, Elsewhere QLD 4000',
      score: 71,
      verdict: 'Cheaper to hold, slower to grow.',
      strengths: ['Lower holding cost'],
      weaknesses: ['Slower growth'],
    },
  ],
  // Keyed by investor profile — see `INVESTOR_PROFILES`.
  investorRecommendations: {
    growthFocused: { propertyNumber: 1, reason: 'Capital growth leads the comparison.' },
    balanced: { propertyNumber: 1, reason: 'Growth with a tolerable holding cost.' },
  },
  riskAssessment: {
    mostStable: { propertyNumber: 2, reason: 'Lower leverage and a steadier tenancy.' },
    highestRisk: { propertyNumber: 1, reason: 'Rate sensitivity.', risks: ['Rate movement'] },
  },
  overallRecommendation: {
    bestProperty: { propertyNumber: 1, reason: 'Best on balance.' },
    avoid: [{ propertyNumber: 2, concern: 'Not if cash flow is the priority.' }],
  },
};

const cfProjection = (afterTax: number) => ({
  acquisition: { ...acquisition, loanType: 'interest_only' },
  years: tenYears(afterTax),
  assumptions: [{ label: 'Capital growth', value: '5% per year' }],
  notes: [],
});

/** Both wide matrices, the analysis, the rankings, the matches and the risk. */
export const cashFlowComparisonMaximal = () => buildComparison({
  properties: [
    { reportId: A, address: '12 Example Street, Suburbia VIC 3000', isPrimary: true, projection: cfProjection(-4_000) },
    { reportId: B, address: '9 Sample Road, Elsewhere QLD 4000', isPrimary: false, projection: cfProjection(-2_000) },
  ],
  primaryReportId: A,
  clientName: 'Sample Client',
  investorProfile: 'balanced',
  analysis: FULL_CF_ANALYSIS,
  now: NOW,
});

/** No analysis at all — the four unconditional sections and the basis. */
export const cashFlowComparisonMinimal = () => buildComparison({
  properties: [
    { reportId: A, address: '12 Example Street, Suburbia VIC 3000', isPrimary: true, projection: cfProjection(-4_000) },
    { reportId: B, address: '9 Sample Road, Elsewhere QLD 4000', isPrimary: false, projection: cfProjection(-2_000) },
  ],
  primaryReportId: A,
  clientName: 'Sample Client',
  investorProfile: 'balanced',
  analysis: null,
  now: NOW,
});

// ── Client Details ──────────────────────────────────────────────────────────

const CLIENT_ID = '33333333-3333-4333-8333-333333333333';

/** A home, employment, assets, liabilities, expenses and an investment holding. */
export const clientDetailsMaximal = () => buildClientDetails({
  client: {
    id: CLIENT_ID,
    primary_first_name: 'Ada',
    primary_surname: 'Lovelace',
    current_address: '12 Example Street',
    current_suburb: 'Suburbia',
    current_state: 'vic',
    current_postcode: '3000',
    marital_status: 'married',
    dependents_count: 2,
  },
  properties: [
    { property_type: 'owner_occupied', address: 'Home, Suburbia', value: 900_000, loan_remaining: 400_000 },
    {
      property_type: 'investment',
      address: 'Unit 7, 118 Mariners Quay, Newstead',
      value: 600_000,
      loan_remaining: 500_000,
      monthly_rental_income: 2_400,
    },
  ],
  employment: [{ contact_type: 'primary', employer_name: 'Analytical Engines', gross_annual_salary: 150_000 }],
  assets: [{ asset_type: 'savings', description: 'Offset', value: 40_000 }],
  liabilities: [{ liability_type: 'credit_card', provider_name: 'Meridian', credit_limit: 10_000, monthly_repayment: 0 }],
  expenses: [
    { expense_category: 'groceries', monthly_amount: 900, frequency: 'monthly' },
    { expense_category: 'utilities', monthly_amount: 300, frequency: 'monthly' },
  ],
  now: NOW,
});

/** A name and nothing else — the two unconditional sections. */
export const clientDetailsMinimal = () => buildClientDetails({
  client: { id: CLIENT_ID, primary_first_name: 'Ada', primary_surname: 'Lovelace' },
  now: NOW,
});

// ── Portfolio ───────────────────────────────────────────────────────────────

const holding = (n: number) => ({
  propertyNumber: n,
  address: `${n} Wattle Street, Example Bay, QLD 4000`,
  propertyType: 'investment',
  value: 500_000,
  loan: 400_000,
  equity: 100_000,
  lvr: 80,
  monthlyRentalIncome: 2_000,
  monthlyExpenses: 800,
  netMonthlyCashflow: 1_200,
  grossYield: 4.8,
  isOwnerOccupied: false,
});

const FULL_PORTFOLIO_ANALYSIS = {
  compositionAnalysis: { assetAllocation: 'All investment stock, concentrated in one corridor.' },
  financialHealth: { analysis: 'Serviceable at current rates.', cashflowStatus: 'Positive' },
  riskAssessment: { overallRiskLevel: 'Medium', concentrationRisk: 'High' },
  marketConditions: { marketCycleSummary: 'Flat, with rate relief expected.' },
  growthOpportunities: { nextPurchaseRecommendations: ['Look outside the corridor.'] },
  propertyRankings: [
    { rank: 1, address: '1 Wattle Street, Example Bay, QLD 4000', performanceRating: 'Strong', strengths: ['Yield'] },
    { rank: 2, address: '2 Wattle Street, Example Bay, QLD 4000', performanceRating: 'Fair', concerns: ['Vacancy'] },
  ],
  projections: { projectedPortfolioValue: 2_100_000, years: 5 },
  borrowingCapacityUtilisation: {
    estimatedCapacity: 1_800_000,
    totalDebtDeployed: 1_200_000,
    availableCapacity: 600_000,
    utilisationPercentage: 66.7,
  },
  strategicRecommendations: { immediate: ['Refinance the fixed loan.'] },
  actionPlan: { twelveMonthActions: ['Review insurance.'] },
};

export const portfolioMaximal = () => buildPortfolioReview({
  report: {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    created_at: '2026-05-01T00:00:00.000Z',
    overall_health: 'Good',
    report_data: {
      portfolioMetrics: { totalValue: 1_500_000, totalProperties: 3 },
      propertyAnalyses: [1, 2, 3].map(holding),
      analysis: FULL_PORTFOLIO_ANALYSIS,
    },
  },
  review: {
    id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    review_date: '2026-05-01',
    next_review_date: '2027-05-01',
    overall_score: 72,
    property_scores: [
      { address: '1 Wattle Street, Example Bay, QLD 4000', classification: 'Keep', overallScore: 80 },
    ],
    recommendations: ['Hold the portfolio through the next review.'],
  },
  clientName: 'Sample Client',
  now: NOW,
});

/** Holdings only — everything conditional drops away. */
export const portfolioMinimal = () => buildPortfolioReview({
  report: {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    created_at: '2026-05-01T00:00:00.000Z',
    report_data: {
      portfolioMetrics: { totalValue: 1_500_000, totalProperties: 3 },
      propertyAnalyses: [1, 2, 3].map(holding),
    },
  },
  review: null,
  clientName: 'Sample Client',
  now: NOW,
});

// ── Property Comparison ─────────────────────────────────────────────────────

const pcRanking = (n: number, score: number) => ({
  rank: n,
  propertyNumber: n,
  address: `${n} Example Street, Sampleton, QLD 4000`,
  finalScore: score,
  primaryStrengths: [`Strength for ${n}`],
  primaryConcerns: [`Concern for ${n}`],
  bestSuitedFor: 'Growth investors',
});

/**
 * The salvaged shape, deliberately.
 *
 * `marketTiming` and `competitiveAdvantages` can only reach the document on a
 * salvaged record — the writer that destructures a successful response into
 * columns has nowhere to put them — so the longest this format can print is a
 * salvaged row whose stored response is complete. See the header of
 * `propertyComparison/normalise.pure.ts`.
 */
const PC_SALVAGED = {
  executiveSummary: 'Three properties compared.',
  rankings: [pcRanking(1, 82), pcRanking(2, 71), pcRanking(3, 60)],
  financialComparison: {
    bestYield: { propertyNumber: 1, value: '5.1%', reason: 'Higher rent for the price.' },
  },
  locationComparison: { bestSchools: { propertyNumber: 2, reason: 'Two schools within a kilometre.' } },
  riskComparison: {
    lowestRisk: { propertyNumber: 1, reason: 'Lowest leverage.' },
    riskLevels: [{ propertyNumber: 1, riskLevel: 'Moderate', specificRisks: ['Leverage'] }],
  },
  investorMatches: [{ propertyNumber: 1, investorTypes: ['Growth'], reasoning: 'Capital focus.' }],
  redFlags: [{ propertyNumber: 3, severity: 'High', concerns: ['Body corporate fees'] }],
  marketTiming: {
    buyFirst: { propertyNumber: 1, reason: 'Stock is thin and the corridor is moving.' },
    holdingPeriods: [{ propertyNumber: 1, recommendedPeriod: '7-10 years', reason: 'Growth is back-ended.' }],
  },
  competitiveAdvantages: [{ propertyNumber: 1, advantages: ['Corner block'] }],
  recommendations: { bestOverall: { propertyNumber: 1, reason: 'Best on balance.' } },
};

const pcRow = (over: Record<string, unknown> = {}) => ({
  id: 'cccccccc-dddd-4eee-8fff-000000000000',
  created_at: '2026-05-01T00:00:00.000Z',
  property_count: 3,
  property_addresses: [1, 2, 3].map((n) => `${n} Example Street, Sampleton, QLD 4000`),
  property_states: ['QLD'],
  report_title: 'COMPARISON ANALYSIS - 3 PROPERTIES, QLD',
  report_ids: ['r1', 'r2', 'r3'],
  analysis_summary: '{"timeHorizon":"5-7 years","riskTolerance":"moderate","customWeights":null}',
  is_archived: false,
  ...over,
});

export const propertyComparisonMaximal = () => buildPropertyComparison({
  row: pcRow({ executive_summary: JSON.stringify(PC_SALVAGED) }),
  clientName: 'Sample Client',
  now: NOW,
});

/** The structured shape with only rankings — every optional section drops. */
export const propertyComparisonMinimal = () => buildPropertyComparison({
  row: pcRow({
    executive_summary: 'Three properties compared.',
    rankings: [pcRanking(1, 82), pcRanking(2, 71), pcRanking(3, 60)],
  }),
  clientName: 'Sample Client',
  now: NOW,
});

// ── Market Intelligence ─────────────────────────────────────────────────────

/**
 * `reportRow()` is already the complete report — eight populated layers, both
 * prose blocks, events and citations. The one thing it does not carry is the
 * correlation block, which is the only other chapter this format can print, so
 * it is added here.
 *
 * The events list is cut back from twelve to four. `planSections` applies the
 * document budget from the end, and a full-length report clips the tail — which
 * is correct behaviour and useless for a comparison of lists, because a clipped
 * chapter is missing from the printed one.
 */
export const marketIntelligenceMaximal = () => {
  const built = buildMarketIntelligenceReport({
    row: reportRow({
      data: {
        correlationData: { aiAnalysis: prose(5, 1), perplexityResearch: '' },
        marketEvents: [
          { date: '2026-03-04', event: 'Reserve Bank board meeting', category: 'interest_rate', impact: 'neutral' },
          { date: '2026-05-06', event: 'Federal budget', category: 'regulatory', impact: 'positive' },
        ],
        allCitations: cites(4),
      },
    }) as never,
    preparedOn: PREPARED_ON,
    brandName: 'Tenant Advisory',
  });
  if (built.ok === false) throw new Error(built.error);
  return built.report;
};
