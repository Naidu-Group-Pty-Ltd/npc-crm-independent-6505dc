/**
 * What the normaliser must do with a stored row.
 *
 * Every case below is one this format has actually met. `report_data.analysis`
 * is model output parsed out of a fenced code block with no schema validation,
 * and `portfolio_reviews` is written by a second pass over the client's live
 * records, so "the two disagree" and "the field is not the shape it should be"
 * are ordinary states rather than corruption.
 *
 * The fixtures are fictional. Real client financials were used to *find* these
 * cases — the address spellings, the contradicting cash-flow verdicts and the
 * 1,620-character paragraph are all real shapes — but a committed fixture gets
 * shared, so none of the figures here belong to anyone.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPortfolioReview,
  MAX_PARAGRAPH,
  mergeRepeatedActions,
  PortfolioPayloadError,
  propertyTypeLabel,
  toBand,
  toPriority,
} from '../normalise.pure';
import type { ActionRow } from '../payload.pure';
import { formatMeasure } from '@/lib/reportDesign/measure.pure';

const NOW = '2026-08-02T00:00:00.000Z';

const holding = (over: Record<string, unknown> = {}) => ({
  propertyNumber: 1,
  address: '12 Wattle Street, Example Bay, QLD 4000',
  propertyType: 'investment',
  value: 500_000,
  loan: 400_000,
  equity: 100_000,
  lvr: 80,
  monthlyRentalIncome: 2_000,
  monthlyExpenses: 800,
  netMonthlyCashflow: 1_200,
  annualCashflow: 14_400,
  grossYield: 4.8,
  cashOnCashReturn: 12,
  ownershipPercentage: 100,
  portfolioContribution: 100,
  isOwnerOccupied: false,
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  created_at: '2026-05-01T00:00:00.000Z',
  overall_health: 'Good',
  report_data: {
    portfolioMetrics: {
      totalValue: 500_000,
      totalDebt: 400_000,
      totalEquity: 100_000,
      netMonthlyCashflow: 1_200,
      totalMonthlyRentalIncome: 2_000,
      totalMonthlyExpenses: 800,
      averageLVR: 80,
      averageYield: 4.8,
      totalProperties: 1,
      investmentCount: 1,
      ownerOccupiedCount: 0,
      includeOwnerOccupied: true,
    },
    propertyAnalyses: [holding()],
    analysis: {},
    ...over,
  },
});

const build = (over: Record<string, unknown> = {}, review: Record<string, unknown> | null = null) =>
  buildPortfolioReview({ report: report(over), review, clientName: 'Sample Client', now: NOW });

describe('the hard failures', () => {
  it('refuses a report with no properties, naming the field', () => {
    expect(() => buildPortfolioReview({
      report: { report_data: { propertyAnalyses: [] } },
      review: null,
      clientName: 'Sample Client',
      now: NOW,
    })).toThrow(PortfolioPayloadError);
  });

  it('refuses a portfolio larger than the cap rather than rendering sixty pages', () => {
    const many = Array.from({ length: 61 }, (_, i) => holding({ propertyNumber: i + 1 }));
    expect(() => build({ propertyAnalyses: many })).toThrow(/61 entries/);
  });
});

describe('figures carry units', () => {
  const p = build();

  it('gives every total a unit rather than a bare number', () => {
    expect(formatMeasure(p.totals.value)).toBe('$500,000');
    expect(formatMeasure(p.totals.netMonthlyCashflow)).toBe('$1,200/mo');
    expect(formatMeasure(p.totals.averageLvr)).toBe('80.0%');
    expect(formatMeasure(p.totals.propertyCount)).toBe('1');
  });

  it('renders a figure the record does not hold as an em dash, not as nil', () => {
    const thin = build({ propertyAnalyses: [holding({ grossYield: 'N/A', interestRate: null })] });
    expect(formatMeasure(thin.holdings[0].grossYield)).toBe('—');
    expect(formatMeasure(thin.holdings[0].interestRate)).toBe('—');
  });

  it('reads a numeric string, because models emit those', () => {
    const p2 = build({ propertyAnalyses: [holding({ value: '$750,000' })] });
    expect(formatMeasure(p2.holdings[0].value)).toBe('$750,000');
  });

  it('derives LVR when the record omits it', () => {
    const p2 = build({ propertyAnalyses: [holding({ lvr: null, value: 400_000, loan: 300_000 })] });
    expect(formatMeasure(p2.holdings[0].lvr)).toBe('75.0%');
  });
});

describe('a malformed block drops its section rather than rendering', () => {
  it('leaves every optional narrative null when the analysis is empty', () => {
    const p = build();
    expect(p.composition).toBeNull();
    expect(p.financialHealth).toBeNull();
    expect(p.risk).toBeNull();
    expect(p.projection).toBeNull();
    expect(p.capacity).toBeNull();
  });

  it('ignores a block that arrived as the wrong type', () => {
    const p = build({ analysis: { riskAssessment: 'not an object', projections: [] } });
    expect(p.risk).toBeNull();
    expect(p.projection).toBeNull();
  });
});

describe('prose is cut on a word boundary, or not at all', () => {
  it('leaves a long-but-plausible paragraph whole', () => {
    // The longest field in the real record is 1,620 characters.
    const long = 'word '.repeat(340).trim();
    const p = build({ analysis: { financialHealth: { analysis: long } } });
    expect(p.financialHealth?.paragraphs[0]).toBe(long);
  });

  it('ends a runaway at a word, with an ellipsis, never mid-word', () => {
    const runaway = 'alpha '.repeat(2_000);
    const p = build({ analysis: { financialHealth: { analysis: runaway } } });
    const written = p.financialHealth!.paragraphs[0];
    expect(written.length).toBeLessThanOrEqual(MAX_PARAGRAPH + 1);
    expect(written.endsWith('…')).toBe(true);
    // The character before the ellipsis closes a word: "state-spe…" is the
    // failure this replaced.
    expect(written.slice(0, -1)).toMatch(/alpha$/);
  });
});

describe('bullet groups stay apart', () => {
  it('keeps risks and their mitigations under separate headings', () => {
    const p = build({
      analysis: {
        riskAssessment: {
          marketRisks: ['Regional concentration'],
          mitigationStrategies: ['Build a cash buffer'],
        },
      },
    });
    expect(p.risk?.bullets.map((g) => g.label)).toEqual(['What could go wrong', 'How to reduce it']);
    expect(p.risk?.bullets[0].items).toEqual(['Regional concentration']);
    expect(p.risk?.bullets[1].items).toEqual(['Build a cash buffer']);
  });
});

describe('the review, folded in', () => {
  const review = {
    id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    status: 'completed',
    risk_level: 'critical',
    review_date: '2026-05-20T00:00:00.000Z',
    overall_score: 52,
    executive_summary: 'A summary.',
    key_findings: ['One finding'],
    property_scores: [{
      // Deliberately spelt differently from the analysis's address: the two
      // tables disagree about suburbs on real rows.
      address: '12 Wattle Street, North Example Bay, QLD 4000',
      overallScore: 64,
      classification: 'Underperformer',
      strengths: ['Strong cash flow'],
      concerns: ['Negative cash flow'],
    }],
    scenarios: [{
      name: '+1% Interest Rate',
      description: 'Impact of a rate rise',
      impact: { cashFlowChange: -1_010, newNetCashflow: 812 },
    }],
    recommendations: [{
      title: 'Reduce non-property debt',
      priority: 'high',
      description: 'Clear the car loan.',
      actionItems: ['Redirect surplus'],
    }],
  };

  const withRanking = {
    analysis: {
      propertyRankings: [{
        address: '12 Wattle Street, Example Bay, QLD 4000',
        rank: 1,
        performanceRating: 'Good',
        strengths: ['Positive net monthly cashflow'],
      }],
    },
  };

  it('is absent cleanly when there is none', () => {
    const p = build(withRanking);
    expect(p.review).toBeNull();
    expect(p.verdicts[0].review).toBeNull();
    expect(p.scenarios).toEqual([]);
  });

  it('matches a score to its property despite a different suburb spelling', () => {
    const p = build(withRanking, review);
    expect(formatMeasure(p.verdicts[0].score)).toBe('64');
  });

  it('keeps the review’s verdict apart from the analysis’s, so they can disagree', () => {
    const p = build(withRanking, review);
    // The analysis says the cash flow is positive; the review's rubric says it
    // is negative. Both are printed, attributed, rather than merged into one
    // self-contradicting list.
    expect(p.verdicts[0].strengths).toEqual(['Positive net monthly cashflow']);
    expect(p.verdicts[0].review).toEqual({
      classification: 'Underperformer',
      strengths: ['Strong cash flow'],
      concerns: ['Negative cash flow'],
    });
  });

  it('reads a scenario’s impact object rather than printing it', () => {
    const p = build(withRanking, review);
    expect(formatMeasure(p.scenarios[0].cashFlowChange)).toBe('-$1,010/mo');
    expect(formatMeasure(p.scenarios[0].newNetCashflow)).toBe('$812/mo');
  });

  it('sentence-cases values stored as database enums', () => {
    const p = build(withRanking, review);
    expect(p.review?.status).toBe('Completed');
    expect(p.review?.riskLevel).toBe('Critical');
  });

  it('labels a review recommendation in the document’s own vocabulary', () => {
    const p = build(withRanking, review);
    const fromReview = p.actions.find((a) => a.source === 'review');
    expect(fromReview?.priorityLabel).toBe('Priority');
    expect(fromReview?.priorityLabel).not.toBe('high');
  });

  it('says out loud when the review it drew on is a draft', () => {
    const p = build(withRanking, { ...review, status: 'draft' });
    expect(p.notes.map((n) => n.text).join(' ')).toMatch(/still a draft/i);
  });
});

describe('free text mapped to a band', () => {
  it.each([
    ['Excellent', 'strong'],
    ['moderate', 'moderate'],
    ['NEEDS ATTENTION', 'unrated'],
    ['Poor', 'watch'],
    ['', 'unrated'],
  ])('%s → %s', (raw, expected) => {
    expect(toBand(raw)).toBe(expected);
  });

  it.each([
    ['high', 'high'],
    ['P2', 'medium'],
    ['later', 'low'],
    ['banana', 'unset'],
  ])('priority %s → %s', (raw, expected) => {
    expect(toPriority(raw)).toBe(expected);
  });
});

/**
 * The Portfolio audit (PORTFOLIO.md §10). Each case is a defect read off a
 * rendered review, pinned where the normaliser decides it.
 */
describe('the audit — what a reader is handed', () => {
  const home = holding({
    propertyNumber: 2,
    address: '9 Banksia Grove, Kellyville NSW 2155',
    propertyType: 'owner_occupied',
    isOwnerOccupied: true,
    value: 1_000_000,
    loan: 600_000,
    equity: 400_000,
    monthlyRentalIncome: 0,
    monthlyExpenses: 3_000,
    netMonthlyCashflow: -3_000,
    grossYield: 'N/A',
  });
  const tenancy = holding({
    propertyNumber: 3,
    address: '3/18 Station Street, Penrith NSW 2750',
    propertyType: 'rental',
    value: 0,
    loan: 0,
    monthlyRentalIncome: 2_400,
    monthlyExpenses: 2_400,
    netMonthlyCashflow: -2_400,
  });

  it('leaves a rented home out of the holdings, renumbers around it, and says so once', () => {
    const p = build({
      propertyAnalyses: [holding(), home, tenancy],
      analysis: {
        propertyRankings: [
          { address: '12 Wattle Street, Example Bay, QLD 4000', rank: 1 },
          { address: '3/18 Station Street, Penrith NSW 2750', rank: 2 },
        ],
      },
    });
    expect(p.holdings.map((h) => h.address)).toEqual([
      '12 Wattle Street, Example Bay, QLD 4000',
      '9 Banksia Grove, Kellyville NSW 2155',
    ]);
    expect(p.holdings.map((h) => h.number)).toEqual([1, 2]);
    expect(p.verdicts.map((v) => v.address)).toEqual(['12 Wattle Street, Example Bay, QLD 4000']);
    const said = p.notes.filter((n) => /Station Street/.test(n.text));
    expect(said).toHaveLength(1);
    expect(said[0].section).toBe('holdings');
  });

  it('refuses a review of a rented home alone rather than calling it a portfolio', () => {
    expect(() => build({ propertyAnalyses: [tenancy] })).toThrow(/only a property the client rents/);
  });

  it('prints a property type as a reader reads it, never the stored enum', () => {
    expect(propertyTypeLabel('investment', false)).toBe('Investment');
    expect(propertyTypeLabel('smsf', false)).toBe('SMSF');
    expect(propertyTypeLabel('owner_occupied', false)).toBe('Owner-occupied');
    expect(propertyTypeLabel('investment', true)).toBe('Owner-occupied');
    expect(propertyTypeLabel('holiday_let', false)).toBe('Holiday let');
    const p = build({ propertyAnalyses: [holding(), home] });
    expect(p.holdings.map((h) => h.typeLabel)).toEqual(['Investment', 'Owner-occupied']);
  });

  it('splits the monthly lines by what they describe, and says whether they foot', () => {
    const p = build({ propertyAnalyses: [holding(), home] });
    // The investments' rent, less the investments' costs, is the net the
    // analysis reports; the home's outgoings are a line of their own.
    expect(formatMeasure(p.totals.investmentExpenses)).toBe('$800/mo');
    expect(formatMeasure(p.totals.ownerOccupiedOutgoings)).toBe('$3,000/mo');
    expect(p.totals.cashflowFoots).toBe(true);

    const off = build({
      propertyAnalyses: [holding(), home],
      portfolioMetrics: { ...report().report_data.portfolioMetrics, netMonthlyCashflow: 900 },
    });
    expect(off.totals.cashflowFoots).toBe(false);
  });

  it('opens with the figures in words, and names whose cash flow it is', () => {
    const p = build();
    expect(p.narrative).toBe(
      'The portfolio holds one property worth $500,000, carrying $400,000 of debt against $100,000 of equity. '
        + 'After costs, it returns $1,200 a month. Overall health is assessed as good.',
    );
    const withHome = build({
      propertyAnalyses: [holding(), home],
      portfolioMetrics: { ...report().report_data.portfolioMetrics, totalProperties: 2, ownerOccupiedCount: 1 },
    });
    expect(withHome.narrative).toMatch(/holds two properties/);
    expect(withHome.narrative).toMatch(/After costs, the investment properties return \$1,200 a month\./);
  });

  it('carries the reference as the first eight characters, never clipped with an ellipsis', () => {
    expect(build().meta.reference).toBe('AAAAAAAA');
  });

  it('keeps the analysis’s own opening words for the page under the contents', () => {
    const p = build({ analysis: { personalizedNarrative: { openingStatement: 'Jordan and Priya, thank you.' } } });
    expect(p.opening).toBe('Jordan and Priya, thank you.');
    expect(build().opening).toBe('');
  });

  it('files each note under the section it is about', () => {
    const p = build({
      propertyAnalyses: [holding(), home],
      portfolioMetrics: { ...report().report_data.portfolioMetrics, includeOwnerOccupied: false, ownerOccupiedCount: 1 },
    }, { status: 'draft', overall_score: 60 });
    expect(p.notes.map((n) => n.section).sort()).toEqual(['review', 'standing']);
  });

  it('prints a property’s growth analysis once — as its outlook when it has none', () => {
    const ranking = { propertyRankings: [{ address: '12 Wattle Street, Example Bay, QLD 4000', rank: 1 }] };
    const both = build({
      analysis: {
        ...ranking,
        propertyStrategicContext: [{
          address: '12 Wattle Street, Example Bay, QLD 4000',
          individualOutlook: 'Rents should track inflation.',
          capitalGrowthAnalysis: 'Values rose off a low base.',
        }],
      },
    });
    expect(both.verdicts[0].outlook).toBe('Rents should track inflation.');
    expect(both.verdicts[0].growth).toBe('Values rose off a low base.');
    const growthOnly = build({
      analysis: {
        ...ranking,
        propertyStrategicContext: [{
          address: '12 Wattle Street, Example Bay, QLD 4000',
          capitalGrowthAnalysis: 'Values rose off a low base.',
        }],
      },
    });
    expect(growthOnly.verdicts[0].outlook).toBe('Values rose off a low base.');
    expect(growthOnly.verdicts[0].growth).toBe('');
  });
});

describe('the audit — what a rate rise would do', () => {
  const stamped = {
    available: true,
    loansCovered: 2,
    balanceCovered: 700_000,
    currentMonthlyCashflow: 500,
    plusOnePercentImpact: -580,
    plusTwoPercentImpact: -1_160,
  };

  it('reads only the calculator’s block, recognised by its stamp', () => {
    const modelWritten = build({
      analysis: { interestRateSensitivity: { investmentProperties: { plusOnePercentImpact: -9_999 } } },
    });
    expect(modelWritten.rateSensitivity).toBeNull();

    const p = build({ analysis: { interestRateSensitivity: { investmentProperties: stamped } } });
    expect(formatMeasure(p.rateSensitivity!.investment!.plusOne)).toBe('-$580/mo');
    expect(formatMeasure(p.rateSensitivity!.investment!.current)).toBe('$500/mo');
  });

  it('names why a class could not be calculated, and drops a class with no loans', () => {
    const p = build({
      analysis: {
        interestRateSensitivity: {
          investmentProperties: { available: false, loansCovered: 0, unavailableReason: 'no_loans' },
          ownerOccupiedProperties: { available: false, loansCovered: 1, unavailableReason: 'amortising_loan_without_term' },
        },
      },
    });
    expect(p.rateSensitivity!.investment).toBeNull();
    expect(p.rateSensitivity!.ownerOccupied!.gap).toBe('amortising_loan_without_term');
    expect(p.rateSensitivity!.ownerOccupied!.plusOne.unit).toBe('none');
  });
});

describe('the audit — the projection', () => {
  // `projectPortfolio`'s own arithmetic on the fixture's totals: $500,000 at 5%
  // for ten years, rounded to the dollar, with $400,000 of debt held.
  const calculated = {
    years: 10,
    projectedPortfolioValue: Math.round(500_000 * 1.05 ** 10),
    projectedDebt: 400_000,
    projectedEquity: Math.round(500_000 * 1.05 ** 10) - 400_000,
    projectedMonthlyCashflow: null,
    assumptionDetail: {
      scenario: 'moderate',
      annualCapitalGrowthPercent: 5,
      horizonYears: 10,
      debtTreatment: 'held_constant',
      cashflowTreatment: 'not_projected',
    },
    assumptions: ['Debt is held at today\'s balance. The record does not carry a loan term.'],
  };

  it('prints today beside the projection where it provably starts there', () => {
    const p = build({ analysis: { projections: calculated } });
    expect(p.projection!.today).not.toBeNull();
    expect(formatMeasure(p.projection!.today!.value)).toBe('$500,000');
    expect(formatMeasure(p.projection!.today!.equity)).toBe('$100,000');
  });

  it('holds today back when the stored figure is not today compounded to the dollar', () => {
    const off = build({
      analysis: { projections: { ...calculated, projectedPortfolioValue: calculated.projectedPortfolioValue - 50 } },
    });
    expect(off.projection!.today).toBeNull();
    // A projection the model wrote carries no recorded growth, so nothing proves
    // where it starts.
    const modelWritten = build({
      analysis: { projections: { projectedPortfolioValue: 900_000, projectedEquity: 500_000, years: 10 } },
    });
    expect(modelWritten.projection!.today).toBeNull();
  });

  it('states its assumptions in the document’s voice, composed from the recorded fields', () => {
    const p = build({ analysis: { projections: calculated } });
    expect(p.projection!.assumptions).toEqual([
      'Capital growth of 5% a year, compounding, over 10 years (the moderate scenario).',
      'Debt stays at today\'s balance throughout: an interest-only loan does not reduce, '
        + 'and no remaining term is on file for a loan that would.',
      'Rental cash flow is not projected: no rent or expense growth rate is on file for this portfolio.',
    ]);
    expect(p.projection!.assumptions.join(' ')).not.toMatch(/the record/i);
  });
});

describe('the audit — what to do, in order', () => {
  const row = (over: Partial<ActionRow>): ActionRow => ({
    title: 'Act.',
    detail: '',
    priority: 'medium',
    priorityLabel: 'Medium term',
    category: 'Medium term',
    steps: [],
    source: 'analysis',
    ...over,
  });

  it('orders the actions as time: now, the short term, twelve months, then the longer horizons', () => {
    const p = build({
      analysis: {
        strategicRecommendations: { longTerm: ['Later.'], priorityActions: ['Now.'], mediumTerm: ['Medium.'] },
        actionPlan: { twelveMonthActions: ['This year.'] },
      },
    });
    expect(p.actions.map((a) => a.priorityLabel)).toEqual(['Priority', 'Next 12 months', 'Medium term', 'Long term']);
  });

  it('prints an action named twice in the same words once, at the earlier horizon', () => {
    const merged = mergeRepeatedActions([
      row({ title: 'Review the rent at renewal.', priorityLabel: 'Short term' }),
      row({ title: 'Something else.' }),
      row({
        title: 'Review the rent at renewal',
        priorityLabel: 'Medium term',
        detail: 'Comparable houses lease higher.',
        steps: ['Ask for an appraisal.'],
        source: 'review',
      }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      title: 'Review the rent at renewal',
      priorityLabel: 'Short term',
      detail: 'Comparable houses lease higher.',
      steps: ['Ask for an appraisal.'],
      source: 'both',
    });
  });

  it('leaves two sentences that only mean the same thing as they were written', () => {
    const kept = mergeRepeatedActions([
      row({ title: 'Bring Circular Way below 90% LVR.' }),
      row({ title: 'Reduce the Circular Way loan below 90% LVR', source: 'review' }),
    ]);
    expect(kept).toHaveLength(2);
    expect(kept.map((a) => a.source)).toEqual(['analysis', 'review']);
  });

  it('keeps one assessment’s repeat as that assessment’s', () => {
    const merged = mergeRepeatedActions([row({ title: 'Build a buffer.' }), row({ title: 'build a buffer' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('analysis');
  });
});
