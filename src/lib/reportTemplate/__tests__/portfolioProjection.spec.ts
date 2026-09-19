/**
 * The Portfolio Performance Review projection.
 *
 * The fixture's shapes are read from the live `portfolio_analysis_reports`
 * table across all 21 stored reports — `portfolioMetrics` with its sixteen
 * keys, `propertyAnalyses` as an **array** of per-property objects, and
 * `analysis` carrying four model-authored objects whose names read like
 * paragraphs and are not: `executiveSummary` is an object with two string
 * arrays inside it, `strategicRecommendations` is four horizon buckets. Only
 * the values are invented.
 *
 * That distinction is the whole point of the file. `docs/reports/PORTFOLIO.md`
 * and `BORROWING_CAPACITY.md` both record what a fixture written from
 * imagination costs: it passes while production renders "plausible-looking
 * wrong output". Here the specific failure it would hide is an object bound
 * where a paragraph belongs, which prints `[object Object]` on a client's page.
 */
import { describe, it, expect } from 'vitest';
import {
  projectPortfolio,
  applyPortfolioProjection,
} from '../../../../supabase/functions/_shared/portfolioProjection.pure';
import { getAdapter, supportsProduction } from '../adapters';

/** Shaped exactly like a stored row. */
const ROW = {
  id: 'pf-1',
  client_name: 'Jordan & Sarah Nguyen',
  health_score: 68,
  overall_health: 'Moderate',
  portfolio_value: 3410000,
  total_equity: 1322000,
  total_properties: 4,
  average_lvr: 55.96,
  average_yield: 4.31,
  net_monthly_cashflow: -1183.33,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-08-12T00:00:00.000Z',
  report_data: {
    portfolioMetrics: {
      totalValue: 3410000,
      totalDebt: 2088000,
      totalEquity: 1322000,
      totalProperties: 4,
      investmentCount: 3,
      ownerOccupiedCount: 1,
      rentalCount: 3,
      averageLVR: 55.96,
      averageYield: 4.31,
      netMonthlyCashflow: -1183.33,
      totalMonthlyRentalIncome: 11691.58,
      totalMonthlyExpenses: 12874.91,
      personalExpenses: 6420,
      bestPerformer: {
        address: '7 Wardell Road, Dulwich Hill',
        property_type: 'House',
        value: 640000,
        net_monthly_cashflow: 283.33,
        lender_name: 'CommBank',
      },
      worstPerformer: {
        address: '14 Marlborough Street, Leichhardt NSW 2040',
        property_type: 'House',
        value: 1285000,
        net_monthly_cashflow: -1789.67,
        lender_name: 'Meridian Mutual',
      },
    },
    propertyAnalyses: [
      {
        address: '9/44 Regent Street, Newtown', propertyType: 'Apartment',
        value: 1125000, loan: 612000, equity: 513000, lvr: 54.4, grossYield: 3.9,
        monthlyRentalIncome: 3656.25, monthlyExpenses: 3481.25,
        netMonthlyCashflow: 175, annualCashflow: 2100, cashOnCashReturn: 0.41,
        propertyContribution: 0, lenderName: 'Westpac', interestRate: 5.89,
        ownershipPercentage: 100, portfolioContribution: 38.8, isOwnerOccupied: true,
      },
      {
        address: '12/3 Denison Road, Lewisham', propertyType: 'Apartment',
        value: 360000, loan: 160000, equity: 200000, lvr: 44.4, grossYield: 4.9,
        netMonthlyCashflow: 148, annualCashflow: 1776,
        lenderName: 'CommBank', interestRate: 6.02, isOwnerOccupied: false,
      },
    ],
    analysis: {
      executiveSummary: {
        healthScore: 68,
        overallHealth: 'Moderate',
        keyStrengths: ['Growth ahead of the metro average', 'LVR leaves headroom'],
        keyConcerns: ['Concentrated by geography', 'Net position negative'],
        primaryRecommendation: 'Diversify the next acquisition outside the inner west.',
      },
      financialHealth: {
        analysis: 'Performing on growth, under-performing on income.',
        cashflowStatus: 'Negative — funded from surplus income',
        debtServiceability: 'Comfortable',
        equityPosition: 'Strong',
        lvrRisk: 'Moderate',
      },
      riskAssessment: {
        overallRiskLevel: 'Moderate',
        concentrationRisk: 'Four assets inside a 6km radius.',
        vacancyRisk: 'Single-dwelling income is stepped rather than smooth.',
        interestRateSensitivity: 'A 100bp rise adds roughly $1,740 a month.',
        // Arrays, like the table. See 'publishes the list-shaped prose as lists'.
        marketRisks: ['Prices have run ahead of rents for six years.'],
        mitigationStrategies: ['Fix the majority of the debt before the next roll-off.'],
      },
      strategicRecommendations: {
        priorityActions: ['Refinance the Newtown facility', 'Order a depreciation schedule'],
        shortTerm: ['Rebuild the offset balance.'],
        mediumTerm: ['Add one income-positive holding.'],
        longTerm: ['Hold to the ten-year horizon.'],
      },
    },
  },
};

describe('units and magnitudes', () => {
  const p = projectPortfolio(ROW);

  it('carries the health score as a score, not a percentage', () => {
    // 25-90 across the 21 stored reports. Setting it with `| percent` would
    // print "68%" of nothing, and the `percent` filter does not multiply, so
    // nothing about the rendered output would look wrong enough to notice.
    expect(p.summary.healthScore).toBe(68);
  });

  it('passes whole-number percent rates through untouched', () => {
    // `average_lvr` 33.17-86.57 and `average_yield` 4.24-10.35 across the
    // sample: already percent. Dividing or multiplying either by 100 here is
    // the single most likely defect in a projection like this.
    expect(p.portfolio.averageLvr).toBe(55.96);
    expect(p.portfolio.averageYield).toBe(4.31);
  });

  it('annualises the monthly position and derives nothing else', () => {
    expect(p.portfolio.monthlyCashflow).toBe(-1183.33);
    expect(p.portfolio.annualCashflow).toBeCloseTo(-1183.33 * 12, 9);
  });

  it('prefers the typed columns over their jsonb copies', () => {
    // The list view reads the columns; a report that disagreed with the row it
    // was opened from would be read as a rendering bug.
    const drifted = {
      ...ROW,
      portfolio_value: 3500000,
      report_data: { ...ROW.report_data, portfolioMetrics: { ...ROW.report_data.portfolioMetrics, totalValue: 1 } },
    };
    expect(projectPortfolio(drifted).portfolio.value).toBe(3500000);
  });
});

describe('prose whose names lie about their shapes', () => {
  it('publishes a leaf only when it is genuinely a string', () => {
    const p = projectPortfolio({
      report_data: {
        analysis: {
          executiveSummary: { primaryRecommendation: { headline: 'x' }, overallHealth: 'Moderate' },
          financialHealth: { analysis: ['a', 'b'], lvrRisk: 'Moderate' },
          riskAssessment: { marketRisks: { note: 'x' }, vacancyRisk: 'Low' },
          strategicRecommendations: { longTerm: 42, shortTerm: ['Hold'] },
        },
      },
    });
    expect(p.summary.primaryRecommendation).toBeUndefined();
    expect(p.summary.overallHealth).toBe('Moderate');
    expect(p.health.analysis).toBeUndefined();
    expect(p.health.lvrRisk).toBe('Moderate');
    // A list field handed an object publishes nothing, exactly as a prose field
    // handed one does.
    expect(p.risk.marketRisks).toBeUndefined();
    expect(p.risk.vacancyRisk).toBe('Low');
    expect(p.actions.longTerm).toBeUndefined();
    expect(p.actions.shortTerm).toEqual(['Hold']);
  });

  it('drops non-string entries out of the string lists rather than the list', () => {
    const p = projectPortfolio({
      report_data: {
        analysis: {
          executiveSummary: { keyStrengths: ['real', { nested: true }, '', 'also real'] },
          strategicRecommendations: { priorityActions: [null, 'do this'] },
        },
      },
    });
    expect(p.summary.strengths).toEqual(['real', 'also real']);
    expect(p.actions.priority).toEqual(['do this']);
  });

  it('keeps the portfolio vacancy exposure off the client risk profile key', () => {
    // `risk.vacancy` is "reaction to three months vacancy" to the voice
    // catalogue — a tolerance, not an exposure. One key cannot carry both.
    const p = projectPortfolio(ROW);
    expect(p.risk.vacancyRisk).toBe('Single-dwelling income is stepped rather than smooth.');
    expect(p.risk).not.toHaveProperty('vacancy');
    expect(p.risk).not.toHaveProperty('market');
  });
});

describe('the inventory', () => {
  it('projects each stored property and keeps their order', () => {
    const p = projectPortfolio(ROW);
    expect(p.properties).toHaveLength(2);
    expect(p.properties[0].address).toBe('9/44 Regent Street, Newtown');
    expect(p.properties[0].netMonthlyCashflow).toBe(175);
    expect(p.properties[0].isOwnerOccupied).toBe(true);
    expect(p.properties[1].address).toBe('12/3 Denison Road, Lewisham');
  });

  it('coerces the numeric strings the table actually stores', () => {
    // `lvr` and `grossYield` are strings — "83.7", "6.74" — on all 66 stored
    // property elements. Read as numbers they would publish nothing, blanking
    // two columns of the inventory on every report.
    const p = projectPortfolio({
      report_data: {
        propertyAnalyses: [{ address: 'a', lvr: '83.7', grossYield: '6.74', value: '1125000' }],
      },
    });
    expect(p.properties[0].lvr).toBe(83.7);
    expect(p.properties[0].grossYield).toBe(6.74);
    expect(p.properties[0].value).toBe(1125000);
  });

  it('leaves a null cash position blank rather than calling it zero', () => {
    // 11 of the 66 stored property elements have netMonthlyCashflow,
    // annualCashflow and monthlyRentalIncome all JSON null — owner-occupied
    // holdings with no rental data. "$0 a month" is a claim, and the wrong one.
    const p = projectPortfolio({
      report_data: {
        propertyAnalyses: [{
          address: 'a', value: 900000, loan: 400000,
          netMonthlyCashflow: null, annualCashflow: null, monthlyRentalIncome: null,
          monthlyExpenses: 1200, isOwnerOccupied: true,
        }],
      },
    });
    expect(p.properties[0]).not.toHaveProperty('netMonthlyCashflow');
    expect(p.properties[0]).not.toHaveProperty('annualCashflow');
    expect(p.properties[0].monthlyExpenses).toBe(1200);
    expect(p.properties[0].address).toBe('a');
  });

  it('publishes the list-shaped prose as lists', () => {
    // `marketRisks`, `mitigationStrategies` and all three horizons are arrays of
    // strings on all 21 stored reports, whatever their names suggest. Bound as
    // prose they print `[object Object]`; refused as non-strings they print
    // nothing — and the first draft of this file did the second.
    const p = projectPortfolio(ROW);
    expect(p.risk.marketRisks).toEqual(['Prices have run ahead of rents for six years.']);
    expect(p.risk.mitigationStrategies)
      .toEqual(['Fix the majority of the debt before the next roll-off.']);
    expect(p.actions.shortTerm).toEqual(['Rebuild the offset balance.']);
    expect(p.actions.mediumTerm).toEqual(['Add one income-positive holding.']);
    expect(p.actions.longTerm).toEqual(['Hold to the ten-year horizon.']);
    expect(p.actions.priority)
      .toEqual(['Refinance the Newtown facility', 'Order a depreciation schedule']);
  });

  it('reads a performer whether the row is snake_case or camelCase', () => {
    // `bestPerformer` is a whole property row, and the two writers of that
    // column do not agree on the case.
    const p = projectPortfolio(ROW);
    expect(p.portfolio.bestPerformer).toEqual({
      address: '7 Wardell Road, Dulwich Hill', propertyType: 'House',
      value: 640000, netMonthlyCashflow: 283.33, lender: 'CommBank',
    });
    const camel = projectPortfolio({
      report_data: {
        portfolioMetrics: {
          bestPerformer: { address: 'a', propertyType: 'Unit', netMonthlyCashflow: 5, lenderName: 'X' },
        },
      },
    });
    expect(camel.portfolio.bestPerformer).toEqual({
      address: 'a', propertyType: 'Unit', netMonthlyCashflow: 5, lender: 'X',
    });
  });

  it('omits a performer that is null rather than publishing an empty one', () => {
    // Both are null on the reports with a single holding. An empty object here
    // would render "— a month on a  holding".
    const p = projectPortfolio({
      report_data: { portfolioMetrics: { bestPerformer: null, worstPerformer: null } },
    });
    expect(p.portfolio.bestPerformer).toBeUndefined();
    expect(p.portfolio.worstPerformer).toBeUndefined();
  });
});

describe('an empty row', () => {
  it('publishes nothing rather than zeroes', () => {
    // A zero is a claim. `$0` of equity across a portfolio is a different
    // statement from "this report did not record equity", and only one of them
    // is true of a row that has not finished analysing.
    const p = projectPortfolio({});
    expect(p.portfolio).toEqual({});
    expect(p.properties).toEqual([]);
    expect(p.summary).toEqual({});
    expect(p.health).toEqual({});
    expect(p.risk).toEqual({});
    expect(p.actions).toEqual({});
  });
});

describe('applying it to a binding context', () => {
  it('merges into the namespaces rather than replacing them', () => {
    const data: Record<string, any> = {
      report: { id: 'pf-1', type: 'portfolio' },
      client: { email: 'someone@example.com' },
      analysis: ROW,
    };
    applyPortfolioProjection(data, ROW);

    expect(data.report.id).toBe('pf-1');
    expect(data.report.generatedDate).toBe('2026-08-12T00:00:00.000Z');
    expect(data.client.email).toBe('someone@example.com');
    expect(data.client.name).toBe('Jordan & Sarah Nguyen');
    // The raw row stays reachable under its own column names.
    expect(data.analysis.health_score).toBe(68);
    expect(data.properties).toHaveLength(2);
  });

  it('leaves an untouched context untouched when the row is empty', () => {
    const data: Record<string, any> = { report: { id: 'x' } };
    applyPortfolioProjection(data, {});
    expect(data).toEqual({ report: { id: 'x' } });
  });
});

describe('the adapter registry', () => {
  it('treats portfolio as a production report type', () => {
    expect(supportsProduction('portfolio')).toBe(true);
    expect(getAdapter('portfolio')?.legacyFallback?.reason).toBeTruthy();
  });
});

describe('the legacy document, restated through its own normaliser', () => {
  /*
   * Everything here goes through `buildPortfolioReview` — the legacy engine's
   * own normaliser — rather than being re-derived: the built narrative, the
   * band vocabulary, a verdict's pairing of the ranking with the review's
   * scoring, a scenario's impact split into a signed delta and a level. The
   * document fixture extends ROW with the analysis blocks shaped as the
   * generator writes them, and the review row is shaped from the live
   * `portfolio_reviews` table.
   *
   * One shape rule bit while writing this: the verdict pairing matches the
   * strategic context by full address, falling back to the street line — and
   * the street key does not normalise abbreviations, so `Regent St` does not
   * match `Regent Street`. That is the legacy's own behaviour, kept.
   */
  const DOC_ROW = {
    ...ROW,
    report_data: {
      ...ROW.report_data,
      analysis: {
        ...ROW.report_data.analysis,
        compositionAnalysis: {
          propertyMixAssessment: 'Two apartments and two houses, weighted to houses by value.',
          assetAllocation: 'Four-fifths of the value sits inside one postcode ring.',
          recommendations: ['Diversify the next purchase by geography', 'Hold the current mix otherwise'],
        },
        marketConditions: {
          marketCycleSummary: 'Mid-cycle.', clientPositioning: 'Well placed.',
          lendingEnvironment: 'Tightening.', rbaOutlook: 'On hold.',
        },
        projections: {
          years: 10, projectedPortfolioValue: 5560000, projectedEquity: 3470000,
          projectedMonthlyCashflow: 2150,
          plainEnglishSummary: 'If growth holds, the debt stays static while the value compounds.',
          assumptions: ['5.2% capital growth', '3.1% rental growth', 'Rates flat'],
        },
        borrowingCapacityUtilisation: {
          estimatedCapacity: 2900000, totalDebtDeployed: 2088000, availableCapacity: 812000,
          utilisationPercentage: 72,
          commentary: 'Roughly a quarter of assessed capacity remains available.',
        },
        propertyRankings: [{
          address: '9/44 Regent Street, Newtown', rank: 1, performanceRating: 'Strong',
          strengths: ['Low vacancy'], concerns: ['Strata costs'],
          recommendation: 'Hold and refinance off the expiring fixed rate.',
        }],
        propertyStrategicContext: [{
          address: '9/44 Regent Street, Newtown', strategicRole: 'Equity Builder',
          individualOutlook: 'Inner-ring apartments lag houses but hold occupancy.',
        }],
      },
    },
  };
  /** Shaped from the live `portfolio_reviews` table. */
  const REVIEW = {
    status: 'completed',
    review_date: '2026-08-02T14:16:14.279Z',
    next_review_due: '2027-08-02T14:16:21.98Z',
    overall_score: 55, portfolio_health: 67, cash_flow_score: 30,
    growth_potential: 80, data_completeness_score: 97,
    risk_level: 'medium',
    executive_summary: 'Portfolio review completed with an overall score of 55/100.',
    key_findings: ['Portfolio consists of 4 properties worth $3,410,000', 'Current LVR: 61.2%'],
    recommendations: [{
      title: 'Improve Portfolio Cash Flow', category: 'Cash Flow', priority: 'high',
      description: 'Portfolio is cash-flow negative.',
      actionItems: ['Review expenses', 'Consider rent reviews'],
    }],
    property_scores: [{
      address: '9/44 Regent Street, Newtown', classification: 'Star', overallScore: 88,
      strengths: ['Low leverage'], concerns: ['Low rental yield'],
    }],
    scenarios: [{
      name: '+1% Interest Rate', description: 'Impact of a 1% rate rise',
      impact: { cashFlowChange: -1188.69, newNetCashflow: -2173.82 },
    }],
  };
  const data: any = applyPortfolioProjection({}, DOC_ROW, REVIEW);
  const pf = data.portfolio;

  it('writes the overview from the totals, so it cannot disagree with them', () => {
    expect(pf.overview).toBe(
      '4 properties worth $3,410,000, carrying $2,088,000 of debt against $1,322,000 of equity, '
      + 'and costs $1,183 a month to hold. Overall health is assessed as moderate.',
    );
    expect(data.summary.band).toBe('moderate');
    expect(data.summary.bandLabel).toBe('Moderate');
  });

  it('publishes the composition as the legacy composes it', () => {
    expect(pf.composition.paragraphs).toHaveLength(2);
    expect(pf.composition.groups).toEqual([{
      label: 'What we recommend',
      items: ['Diversify the next purchase by geography', 'Hold the current mix otherwise'],
    }]);
  });

  it('pairs the ranking with the review score and context, by address', () => {
    expect(pf.verdicts.rows[0]).toEqual({
      address: '9/44 Regent Street, Newtown',
      rating: 'Strong',
      scoreLabel: '88',
      recommendation: 'Hold and refinance off the expiring fixed rate.',
      strategicRole: 'Equity Builder',
      outlook: 'Inner-ring apartments lag houses but hold occupancy.',
      strengths: ['Low vacancy'],
      concerns: ['Strata costs'],
      reviewClassification: 'Star',
    });
    expect(pf.verdicts.rowCount).toBe(1);
  });

  it('formats the forward-looking figures through the engine', () => {
    expect(pf.projection.yearsLabel).toBe('10 years');
    expect(pf.projection.valueLabel).toBe('$5,560,000');
    expect(pf.projection.cashflowLabel).toBe('$2,150/mo');
    expect(pf.projection.assumptions).toHaveLength(3);
    expect(pf.capacity.utilisationLabel).toBe('72.0%');
    expect(pf.capacity.estimatedLabel).toBe('$2,900,000');
  });

  it('splits a scenario impact into a signed delta and a level', () => {
    // Flattening `{ cashFlowChange, newNetCashflow }` to one number plots a
    // delta against a level; the legacy keeps both and so does this.
    expect(pf.scenarios.rows[0]).toEqual({
      name: '+1% Interest Rate',
      description: 'Impact of a 1% rate rise',
      changeLabel: '-$1,189/mo',
      resultLabel: '-$2,174/mo',
    });
  });

  it('carries the review record with its scores labelled', () => {
    expect(pf.review.statusLabel).toBe('Completed');
    expect(pf.review.riskLevel).toBe('Medium');
    expect(pf.review.scores.map((s: any) => [s.label, s.scoreLabel])).toEqual([
      ['Overall', '55'], ['Portfolio health', '67'], ['Cash flow', '30'],
      ['Growth potential', '80'], ['Data completeness', '97'],
    ]);
    expect(pf.review.findings).toHaveLength(2);
  });

  it('merges the review recommendations into the action plan, attributed', () => {
    // Under `actionPlan`, not `actions` — the voice template binds
    // `portfolio.actions` as an array, and an object would break it. The
    // analysis's own priority actions sort first at equal priority (the
    // legacy's stable order); the review's entries keep their detail and
    // steps, and say where they came from.
    expect(pf.actionPlan.rows[0].sourceLabel).toBe('The analysis');
    expect(pf.actionPlan.rows[0].title).toBe('Refinance the Newtown facility');
    const fromReview = pf.actionPlan.rows.find((r: any) => r.sourceLabel === 'The review');
    expect(fromReview).toEqual({
      title: 'Improve Portfolio Cash Flow',
      detail: 'Portfolio is cash-flow negative.',
      priorityLabel: 'Priority',
      category: 'Cash Flow',
      sourceLabel: 'The review',
      steps: ['Review expenses', 'Consider rent reviews'],
    });
  });

  it('cascades without a review: analysis sections stay, review ones go dark', () => {
    // The join is the caller's, exactly as `render-portfolio-review-pdf`
    // performs it, and `includeReview: false` is a real render mode.
    const solo: any = applyPortfolioProjection({}, DOC_ROW);
    expect(solo.portfolio.composition).toBeTruthy();
    expect(solo.portfolio.projection).toBeTruthy();
    expect(solo.portfolio.verdicts.rows[0].rating).toBe('Strong');
    expect(solo.portfolio.verdicts.rows[0].scoreLabel).toBeUndefined();
    expect(solo.portfolio.verdicts.rows[0].reviewClassification).toBeUndefined();
    expect(solo.portfolio.review).toBeUndefined();
    expect(solo.portfolio.scenarios).toBeUndefined();
  });

  it('publishes none of it for a row the legacy engine refuses', () => {
    // `buildPortfolioReview` throws on a report with no holdings — a
    // portfolio review of no properties is a different document — so the
    // document namespaces stay absent rather than shells.
    const gated: any = applyPortfolioProjection({}, {
      id: 'x', client_name: 'X',
      report_data: { portfolioMetrics: {}, propertyAnalyses: [], analysis: {} },
    });
    for (const key of ['overview', 'composition', 'verdicts', 'projection', 'capacity', 'scenarios', 'review', 'actionPlan']) {
      expect((gated.portfolio ?? {})[key], key).toBeUndefined();
    }
  });
});
