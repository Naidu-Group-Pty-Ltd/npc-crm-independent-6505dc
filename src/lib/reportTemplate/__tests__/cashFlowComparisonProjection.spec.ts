/**
 * The Cash Flow Comparison projection.
 *
 * The fixture is a `CashFlowComparison` payload — the shape
 * `_shared/reports/cashFlowComparison/normalise.pure.ts` produces — because
 * that is what this projection is given.
 *
 * ## Its magnitudes come from the payload's caps, not from production
 *
 * Every other projection spec in this directory says its fixture is shaped from
 * measured production rows. This one cannot, and saying so is the point: the
 * format's ledger holds **0 rows**, `cash_flow_analyses` holds 0 and
 * structurally cannot hold any, and the projections it compares are the
 * browser's and are never persisted. That is also why the 50 masters are
 * preview-only — see `cashFlowComparisonProjection.pure.ts`.
 *
 * So what this file asserts is the **contract**, which is where this format's
 * risk actually sits: that model prose never names a property, that `avoid` and
 * `highestRisk` stay where the contract puts them, that the two break-evens are
 * never merged, and that a score is never printed with a denominator the record
 * does not name.
 */
import { describe, it, expect } from 'vitest';
import {
  projectCashFlowComparison,
  applyCashFlowComparisonProjection,
  MIN_PROPERTIES,
  MAX_PROPERTIES,
} from '../../../../supabase/functions/_shared/cashFlowComparisonProjection.pure';
import { getAdapter, supportsProduction } from '../adapters';

const aud = (value: number) => ({ value, unit: 'aud' as const });
const perYear = (value: number) => ({ value, unit: 'aud/year' as const });
const pct = (value: number) => ({ value, unit: 'percent' as const });
const ratio = (value: number) => ({ value, unit: 'rate' as const });

function years(afterTaxYearOne: number, value: number, loan: number) {
  return Array.from({ length: 10 }, (_, i) => ({
    year: i + 1, calendarYear: 2026 + i,
    propertyValue: aud(Math.round(value * 1.05 ** (i + 1))),
    loanBalance: aud(Math.round(loan * (1 - 0.0114 * (i + 1)))),
    equity: aud(0), lvr: pct(80),
    rentalIncome: perYear(40000), grossYield: pct(3.7), netYield: pct(2.4),
    expenses: perYear(12000), interestRate: pct(6.14),
    interest: perYear(60000), principal: perYear(8000),
    preTaxAnnual: perYear(afterTaxYearOne - 5000),
    preTaxWeekly: { value: 0, unit: 'aud/week' as const },
    afterTaxAnnual: perYear(afterTaxYearOne + i * 2000),
    afterTaxWeekly: { value: 0, unit: 'aud/week' as const },
    depreciation: perYear(8000), taxRefund: perYear(5000), landTax: perYear(0),
    capitalGrowth: pct(5), cpiGrowth: pct(2.8),
  }));
}

function outcome(over: Partial<Record<string, unknown>> = {}) {
  return {
    cumulativeAfterTax: aud(-180000), capitalGain: aud(560000),
    endingValue: aud(1845000), endingEquity: aud(920000),
    totalReturn: aud(380000), initialInvestment: aud(315890),
    roi: pct(120.3), annualisedRoi: pct(8.2), cashOnCash: pct(-10.0),
    equityMultiple: ratio(2.34), firstPositiveYear: 7, paybackYear: null,
    grossYield: pct(3.7), netYield: pct(2.4), capitalGrowthRate: pct(5),
    ...over,
  };
}

function property(number: number, address: string, isPrimary = false, over = {}) {
  return {
    reportId: `r-${number}`, number, address,
    shortAddress: address.split(',')[0], isPrimary,
    projection: { years: years(-31600, 1285000, 1028000) },
    outcome: outcome(over),
  };
}

const note = (reason: string, detail = '') => ({ reason, detail });

function comparison(over: Record<string, unknown> = {}) {
  return {
    meta: {
      primaryReportId: 'a41f8c92-0000-4000-8000-000000000000',
      clientName: 'Jordan & Sarah Nguyen',
      preparedOn: '2026-08-02T00:00:00.000Z',
      investorProfile: 'balanced', investorProfileLabel: 'Balanced investor',
      termYears: 10, propertyCount: 3,
    },
    narrative: 'Three properties compared over ten years.',
    properties: [
      property(1, '14 Marlborough Street, Leichhardt NSW 2040', true),
      property(2, '7 Wardell Road, Dulwich Hill NSW 2203', false, { totalReturn: aud(260000) }),
      property(3, '12/3 Denison Road, Lewisham NSW 2049', false, { totalReturn: aud(150000) }),
    ],
    scoreboard: {
      order: [1, 2, 3],
      leadMargin: pct(31.6),
      winners: [{
        key: 'totalReturn', label: 'Best total return', property: 1,
        value: aud(380000), margin: aud(120000), lowerIsBetter: false,
      }, {
        key: 'initialInvestment', label: 'Cheapest to enter', property: null,
        value: null, margin: null, lowerIsBetter: true,
      }],
    },
    analysis: null,
    ...over,
  } as never;
}

const ANALYSIS = {
  summary: 'All three run negative in the early years.',
  rankings: [
    {
      rank: 1, property: 1, statedAddress: '14 Marlborough Street, Leichhardt NSW 2040',
      score: 84, strengths: ['Largest capital gain'], weaknesses: ['Highest cash requirement'],
      verdict: 'The strongest total return of the three.',
    },
    {
      rank: 2, property: null, statedAddress: '7 Wardell Rd, Dulwich Hill',
      score: null, strengths: [], weaknesses: [], verdict: 'Sits between the other two.',
    },
  ],
  trajectory: { fastestPositive: note('The smallest turns positive first.'), strongestGrowth: null, concerns: [] },
  capitalGrowth: { strongestEquity: note('Ending equity is greatest on the largest.'), wealthBuilder: null, endingValues: [] },
  yields: { bestGross: note('Highest gross yield on the smallest.'), bestNet: null, bestRoi: null },
  risk: {
    mostStable: note('The smallest requires the least cash.'),
    highestRisk: note('The largest carries the greatest exposure.'),
    risks: ['Rate sensitivity'], breakEven: [],
  },
  investorMatches: [
    { key: 'growthFocused', label: 'Growth focused', note: note('Favours the largest.') },
  ],
  recommendation: {
    best: note('The largest, on total return.'),
    avoid: [note('None should be ruled out on these figures alone.')],
    scenarios: ['A five-year hold would reverse the ranking.'],
  },
  missing: ['alternativeScenarios'],
};

describe('the format is preview-only, and honestly marked', () => {
  it('has no production adapter', () => {
    expect(supportsProduction('cash_flow_comparison')).toBe(false);
  });

  it('says why, rather than "not configured yet"', () => {
    // The default `previewOnlyAdapter` reason is a placeholder. This format has
    // a real one, and an operator reading the card deserves it.
    const reason = getAdapter('cash_flow_comparison')?.legacyFallback?.reason ?? '';
    expect(reason).toContain('persisted');
    expect(reason).not.toContain('has not been configured yet');
  });

  it('matches the payload’s own property bounds', () => {
    expect(MIN_PROPERTIES).toBe(2);
    expect(MAX_PROPERTIES).toBe(5);
  });
});

describe('the arithmetic half', () => {
  const p = projectCashFlowComparison(comparison());

  it('unwraps every Measure, because a template binds a number', () => {
    const props = p.cashFlowComparison.properties as any[];
    expect(props[0].totalReturn).toBe(380000);
    expect(props[0].roi).toBe(120.3);
    expect(props[0].equityMultiple).toBe(2.34);
  });

  it('publishes a ranked list separately from the display list', () => {
    // The document ranks on one axis and lists on another. A template that
    // sorted a display list would have to know which.
    const ranked = p.cashFlowComparison.ranked as any[];
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked[0].number).toBe(1);
    expect((p.cashFlowComparison.properties as any[])[0].number).toBe(1);
  });

  it('leads with the gap, not the winner’s figure', () => {
    // A 40% lead is a decision and a 2% lead is a coin toss, and a ranked list
    // of numbers says neither.
    expect((p.cashFlowComparison.scoreboard as any).leadMargin).toBe(31.6);
    expect((p.cashFlowComparison.scoreboard as any).hasLeadMargin).toBe(true);
  });

  it('says so in words when nothing separates the field', () => {
    const flat = projectCashFlowComparison(comparison({
      scoreboard: { order: [1, 2, 3], leadMargin: null, winners: [] },
    }));
    expect((flat.cashFlowComparison.scoreboard as any).leadMargin).toBe('Too close to separate');
    expect((flat.cashFlowComparison.scoreboard as any).hasLeadMargin).toBe(false);
  });

  it('resolves the leader to its street line, and names a tie in words', () => {
    /*
     * The winner was once published as the raw property number, and a master
     * printing "1" as a leader's name is a database index on a client's page.
     * Scoreboard winners are computed server-side over the real property list
     * — unlike the model prose's pointers — so this one is safe to resolve,
     * and the legacy wins table's own cell is what it resolves to.
     */
    const winners = (p.cashFlowComparison.scoreboard as any).winners;
    expect(winners[0].winner).toBe('14 Marlborough Street');
    expect(winners[0].winnerNumber).toBe(1);
    expect(winners[1].winner).toBe('No clear leader');
    expect(winners[1].winnerNumber).toBeUndefined();
    // The clear air to second place, because a win by $400 over ten years is
    // not a difference a client should act on.
    expect(winners[0].margin).toBe(120000);
  });

  it('composes the figure and margin labels, because the units differ by row', () => {
    // Eight categories mix dollars, percent and years in one column; a
    // template cannot pick one filter for the table, so the labels arrive
    // formatted by the engine's own measure formatter.
    const winners = (p.cashFlowComparison.scoreboard as any).winners;
    expect(winners[0].valueLabel).toBe('$380,000');
    expect(winners[0].marginLabel).toBe('$120,000');
    expect(winners[1].valueLabel).toBeUndefined();
  });

  it('keeps the two break-evens apart, and words the one that never arrives', () => {
    // The modal calls "break-even" the year cumulative cash flow turns
    // non-negative; the sibling format calls it the year annual does. They are
    // rarely the same year and neither screen could see the other.
    const props = p.cashFlowComparison.properties as any[];
    expect(props[0].firstPositiveYear).toBe(7);
    expect(props[0].paybackYear).toBe('Not within term');
  });

  it('derives the cumulative rather than accepting one', () => {
    // Two sources for one relationship is how a document says one number in a
    // KPI strip and a different one in a table three pages later.
    const rows = (p.cashFlowComparison.properties as any[])[0].years;
    expect(rows).toHaveLength(10);
    expect(rows[0].afterTaxCumulative).toBe(rows[0].afterTaxAnnual);
    expect(rows[9].afterTaxCumulative)
      .toBe(rows.reduce((t: number, r: any) => t + r.afterTaxAnnual, 0));
  });

  it('marks the property the adviser opened without privileging it', () => {
    const props = p.cashFlowComparison.properties as any[];
    expect(props[0].marker).toBe('Opened');
    expect(props[1].marker).toBe('');
  });

  it('publishes a reference the cover and the filename share', () => {
    // A date alone does not separate two comparisons run on the same day, which
    // is the normal case when the whole point of the screen is to try different
    // peer sets.
    expect(p.cashFlowComparison.reference).toBe('A41F8C92');
  });
});

describe('the model half', () => {
  const p = projectCashFlowComparison(comparison({ analysis: ANALYSIS }));
  const analysis = p.cashFlowComparison.analysis as any;

  it('reports whether there is one at all', () => {
    expect(p.cashFlowComparison.hasAnalysis).toBe(true);
    expect(projectCashFlowComparison(comparison()).cashFlowComparison.hasAnalysis).toBe(false);
  });

  it('publishes each block on its own, because a partial analysis is normal', () => {
    // The producer asks for eight sections with maxTokens 4000, and a response
    // that closed its braces early still parses. Gating them together would
    // drop three present sections because a fourth ran out of budget.
    for (const block of ['trajectory', 'capitalGrowth', 'yields', 'risk', 'recommendation']) {
      expect(block in analysis, block).toBe(true);
    }
    const partial = projectCashFlowComparison(comparison({
      analysis: { ...ANALYSIS, risk: null, recommendation: null },
    }));
    const some = partial.cashFlowComparison.analysis as any;
    expect('trajectory' in some).toBe(true);
    expect('risk' in some).toBe(false);
    expect('recommendation' in some).toBe(false);
  });

  it('names no property in any model sentence', () => {
    // `propertyNumber` indexes an ordering that existed inside one function
    // call and was never recorded. Resolving it to an address would assert a
    // mapping the record does not contain, silently, on a client's page.
    const prose = JSON.stringify([
      analysis.trajectory, analysis.capitalGrowth, analysis.yields,
      analysis.risk, analysis.investorMatches, analysis.recommendation,
    ]);
    expect(prose).not.toContain('property');
    expect(prose).not.toContain('propertyNumber');
    expect(prose).not.toContain('number');
  });

  it('keeps the rankings attributed, and says when one matched nothing', () => {
    // The exception, and only because the producer instructs the model to echo
    // the address back.
    expect(analysis.rankings[0].address).toContain('Marlborough');
    // Absent, not empty: the masters set it straight after the verdict, so a
    // matched ranking must publish no key rather than a blank one behind a
    // separator.
    expect('matched' in analysis.rankings[0]).toBe(false);
    expect(analysis.rankings[1].matched).toContain('matches none of the properties');
  });

  it('prints a score with no denominator, because the schema names none', () => {
    // The legacy generator printed `/100` regardless. Fixing the key while
    // keeping the denominator would have turned "undefined" into a confidently
    // wrong number.
    expect(analysis.rankings[0].score).toBe(84);
    expect('score' in analysis.rankings[1]).toBe(false);
    expect(JSON.stringify(analysis.rankings)).not.toContain('100');
  });

  it('keeps the highest risk in prose, never as a scoreboard entry', () => {
    // An award for being the worst is not a category anyone wins.
    expect(analysis.risk.highestRisk.reason).toContain('greatest exposure');
    const winnerKeys = (p.cashFlowComparison.scoreboard as any).winners.map((w: any) => w.key);
    expect(winnerKeys).not.toContain('highestRisk');
  });

  it('publishes what the model did not supply', () => {
    expect(analysis.missing).toEqual(['alternativeScenarios']);
  });

  it('never writes an undefined key, so absent means absent', () => {
    const walk = (o: any, at: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        expect(v, `${at}.${k}`).not.toBeUndefined();
        walk(v, `${at}.${k}`);
      }
    };
    walk(p, 'projection');
  });
});

describe('merging', () => {
  it('nests under `cashFlowComparison`, leaving the Property Comparison alone', () => {
    const data = applyCashFlowComparisonProjection(
      { comparison: { ranked: ['the other format'] } },
      comparison(),
    );
    expect((data.comparison as any).ranked).toEqual(['the other format']);
    expect((data.cashFlowComparison.ranked as any[])[0].rank).toBe(1);
  });

  it('publishes the client only when the payload carried one', () => {
    const data = applyCashFlowComparisonProjection({}, comparison());
    expect(data.client.name).toBe('Jordan & Sarah Nguyen');

    // Zero or several clients across the properties and no name is printed: a
    // comparison spanning two clients' shortlists is a real thing an adviser
    // does, and naming one of them would be wrong.
    const anonymous = applyCashFlowComparisonProjection({}, comparison({
      meta: { ...(comparison() as any).meta, clientName: '' },
    }));
    expect(anonymous.client?.name).toBeUndefined();
  });
});
