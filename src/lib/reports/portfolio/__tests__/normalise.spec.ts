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
  PortfolioPayloadError,
  toBand,
  toPriority,
} from '../normalise.pure';
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
    expect(p.notes.join(' ')).toMatch(/still a draft/i);
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
