/**
 * What the comparison normaliser refuses, and what it works out for itself.
 *
 * Two themes. The refusals exist because a comparison is a table with aligned
 * columns, so a payload that cannot fill one is an error rather than something
 * to cope with. The derivations exist because the browser has its own version of
 * every metric here and its version is wrong in two measurable ways — see the
 * module comment.
 */
import { describe, expect, it } from 'vitest';

import {
  buildComparison,
  CashFlowComparisonPayloadError,
  neutraliseUrls,
  paybackYearOf,
  shortAddress,
  toAnalysis,
} from '../normalise.pure';
import type { ComparedProperty } from '../payload.pure';

const NOW = '2026-08-02T00:00:00.000Z';

interface YearShape {
  afterTax: number;
  value?: number;
  loan?: number;
}

function projection(years: YearShape[], acquisition: Record<string, unknown> = {}) {
  return {
    acquisition: {
      purchasePrice: 600_000,
      marketValue: 600_000,
      deposit: 120_000,
      loanAmount: 480_000,
      loanTermYears: 30,
      interestRate: 6,
      loanType: 'interest_only',
      weeklyRent: 550,
      costs: [
        { label: 'Stamp duty', amount: 24_000 },
        { label: 'Legal fees', amount: 2_000 },
      ],
      ...acquisition,
    },
    years: years.map((y, i) => ({
      year: i + 1,
      calendarYear: 2027 + i,
      propertyValue: y.value ?? 600_000 + i * 30_000,
      loanBalance: y.loan ?? 480_000,
      rentalIncome: 28_600,
      grossYield: 4.8,
      netYield: 3.2,
      expenses: 9_000,
      interestRate: 6,
      interest: 28_800,
      principal: 0,
      preTaxAnnual: y.afterTax,
      afterTaxAnnual: y.afterTax,
      depreciation: 6_000,
      taxRefund: 0,
      landTax: 0,
      capitalGrowth: 5,
      cpiGrowth: 2.5,
    })),
    assumptions: [{ label: 'Capital growth', value: '5% per year' }],
    notes: [],
  };
}

const TEN = (afterTax: number) => Array.from({ length: 10 }, () => ({ afterTax }));

const property = (id: string, address: string, years: YearShape[], acq = {}) => ({
  reportId: id,
  address,
  isPrimary: id === 'a',
  projection: projection(years, acq),
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const build = (
  properties: ReturnType<typeof property>[],
  analysis: unknown = null,
) => buildComparison({
  properties,
  primaryReportId: properties[0]?.reportId ?? A,
  clientName: 'A. Example',
  investorProfile: 'balanced',
  analysis,
  now: NOW,
});

const twoProperties = () => [
  property('a', '12 Example Street, Suburbia VIC 3000', TEN(-4_000)),
  property('b', '9 Sample Road, Elsewhere QLD 4000', TEN(-2_000)),
];

describe('what it refuses', () => {
  it('needs at least two properties', () => {
    expect(() => build([twoProperties()[0]])).toThrow(CashFlowComparisonPayloadError);
    expect(() => build([twoProperties()[0]])).toThrow(/at least 2/);
  });

  /**
   * Refused rather than truncated. Silently dropping the sixth produces a
   * document that looks complete and compares something nobody asked about.
   */
  it('refuses a sixth property rather than dropping it', () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      property(`p${i}`, `${i} Test Street`, TEN(-1_000)));
    expect(() => build(six)).toThrow(/at most 5/);
  });

  it('refuses the same report twice', () => {
    const [a] = twoProperties();
    expect(() => build([a, { ...a }])).toThrow(/cannot be compared with itself/);
  });

  /** A four-year property beside a ten-year one is a table that lies. */
  it('refuses a ragged comparison', () => {
    const [a, b] = twoProperties();
    expect(() => build([a, { ...b, projection: projection(TEN(-2_000).slice(0, 4)) }]))
      .toThrow(/same number of years/);
  });

  it('refuses years that do not line up under the same column', () => {
    const [a, b] = twoProperties();
    const shifted = projection(TEN(-2_000));
    shifted.years = shifted.years.map((y) => ({ ...y, year: y.year + 1 }));
    expect(() => build([a, { ...b, projection: shifted }])).toThrow(/same years/);
  });

  /** A table of `NaN` on company letterhead is worse than an error. */
  it('refuses a figure that is not finite, and names the property and the field', () => {
    const [a, b] = twoProperties();
    const broken = projection(TEN(-2_000));
    broken.years[3].rentalIncome = Number.NaN;
    expect(() => build([a, { ...b, projection: broken }]))
      .toThrow(/9 Sample Road[\s\S]*years\[3\]\.rentalIncome/);
  });
});

describe('what it works out for itself', () => {
  it('derives capital in from the deposit and the itemised costs', () => {
    const cf = build(twoProperties());
    // 120,000 deposit + 24,000 stamp duty + 2,000 legal.
    expect(cf.properties[0].outcome.initialInvestment.value).toBe(146_000);
  });

  /**
   * The defect this rule exists for. The modal computes `totalInitialInvestment`
   * without LMI for peer properties, so the primary's return on capital was
   * divided by a larger base than everyone it was ranked against. Here LMI is an
   * acquisition cost like any other and every property is read the same way.
   */
  it('counts LMI for every property, not only the one that was opened', () => {
    const [a, b] = twoProperties();
    const withLmi = {
      ...b,
      projection: projection(TEN(-2_000), {
        costs: [
          { label: 'Stamp duty', amount: 24_000 },
          { label: 'Legal fees', amount: 2_000 },
          { label: 'Lenders mortgage insurance', amount: 14_000 },
        ],
      }),
    };
    const cf = build([a, withLmi]);
    expect(cf.properties[1].outcome.initialInvestment.value).toBe(160_000);
  });

  /**
   * Two different questions with two different answers, which is why they are
   * named apart. This property is annually positive from year 6 and has not
   * repaid what it cost to hold until year 9.
   */
  it('separates the first positive year from the year it repays its holding costs', () => {
    const shape = [
      { afterTax: -5_000 }, { afterTax: -5_000 }, { afterTax: -5_000 },
      { afterTax: -5_000 }, { afterTax: -5_000 }, { afterTax: 5_000 },
      { afterTax: 5_000 }, { afterTax: 5_000 }, { afterTax: 5_000 },
      { afterTax: 5_000 },
    ];
    const cf = build([property('a', '12 Example Street', shape), twoProperties()[1]]);
    expect(cf.properties[0].outcome.firstPositiveYear).toBe(6);
    expect(cf.properties[0].outcome.paybackYear).toBe(10);
  });

  it('reports no payback year when the cumulative figure never turns', () => {
    expect(paybackYearOf(build(twoProperties()).properties[0].projection.years)).toBeNull();
  });

  it('has no ratios at all when nothing was put in', () => {
    const free = property('a', '12 Example Street', TEN(1_000), {
      deposit: 0,
      costs: [],
    });
    const cf = build([free, twoProperties()[1]]);
    // Null rather than Infinity: "infinite return" on a client's page is a bug,
    // not a compliment.
    expect(cf.properties[0].outcome.roi).toBeNull();
    expect(cf.properties[0].outcome.cashOnCash).toBeNull();
    expect(cf.properties[0].outcome.equityMultiple).toBeNull();
  });

  it('ranks on total return and states the gap as a share of the leader', () => {
    const cf = build(twoProperties());
    const [first, second] = cf.scoreboard.order.map(
      (n) => cf.properties.find((p) => p.number === n) as ComparedProperty,
    );
    expect(first.outcome.totalReturn.value).toBeGreaterThan(second.outcome.totalReturn.value);
    expect(cf.scoreboard.leadMargin?.unit).toBe('percent');
  });

  /**
   * A tie goes to nobody. Awarding it to whichever property was added first is a
   * document that changes its mind when the same comparison is run in a
   * different order.
   */
  it('names no winner when two properties tie', () => {
    const cf = build([
      property('a', '12 Example Street', TEN(-3_000)),
      property('b', '9 Sample Road', TEN(-3_000)),
    ]);
    const capitalGain = cf.scoreboard.winners.find((w) => w.key === 'capitalGain');
    expect(capitalGain?.property).toBeNull();
    expect(capitalGain?.margin).toBeNull();
  });

  it('carries a margin so a win by nothing reads as a win by nothing', () => {
    const cf = build(twoProperties());
    const cash = cf.scoreboard.winners.find((w) => w.key === 'cumulativeAfterTax');
    expect(cash?.margin?.value).toBe(20_000);
  });

  it('labels chart points and column heads with the street line', () => {
    expect(shortAddress('12 Example Street, Suburbia VIC 3000')).toBe('12 Example Street');
    expect(shortAddress('No commas here')).toBe('No commas here');
  });

  it('says something true in the opening paragraph', () => {
    const cf = build(twoProperties());
    expect(cf.narrative).toContain('9 Sample Road');
    expect(cf.narrative).toMatch(/Over 10 years/);
  });
});

describe('the model half', () => {
  it('is null when the adviser generated nothing', () => {
    expect(build(twoProperties()).analysis).toBeNull();
    expect(toAnalysis({}, [])).toBeNull();
    expect(toAnalysis('a string', [])).toBeNull();
  });

  /**
   * Not hygiene. `assertSafeRenderResources` decodes entities and then throws on
   * any URL token anywhere in the document, so one citation in an executive
   * summary would fail the whole render with an error naming nothing.
   */
  it('takes the scheme off a URL and leaves the rest readable', () => {
    expect(neutraliseUrls('see https://corelogic.com.au/median for the basis'))
      .toBe('see corelogic.com.au/median for the basis');
    expect(neutraliseUrls('//evil.example/x')).toBe('evil.example/x');
    expect(neutraliseUrls('file:///etc/passwd')).toBe('etc/passwd');

    const cf = build(twoProperties(), {
      executiveSummary: 'Per https://example.com/rates, the assumption holds.',
    });
    expect(cf.analysis?.summary).not.toContain('://');
    expect(cf.analysis?.summary).toContain('example.com/rates');
  });

  /**
   * `propertyNumber` indexes `propertiesData`, which is built by mapping over the
   * rows an `IN` query returned — an ordering Postgres does not guarantee and
   * nobody recorded. Resolving it would name a specific property beside a claim
   * that may belong to another one.
   */
  it('never attributes a note to a property', () => {
    const cf = build(twoProperties(), {
      investorRecommendations: {
        growthFocused: { propertyNumber: 1, reason: 'Largest terminal equity.' },
      },
    });
    const match = cf.analysis?.investorMatches[0];
    expect(match?.note.reason).toBe('Largest terminal equity.');
    expect(match?.note).not.toHaveProperty('property');
  });

  /** The producer's schema says `balanced`; both legacy generators asked for
   * `balancedApproach`, which is why that recommendation has never been printed. */
  it('accepts either spelling of the balanced profile', () => {
    for (const key of ['balanced', 'balancedApproach']) {
      const cf = build(twoProperties(), {
        investorRecommendations: { [key]: { propertyNumber: 2, reason: 'The compromise.' } },
      });
      expect(cf.analysis?.investorMatches.map((m) => m.key)).toEqual(['balanced']);
    }
  });

  it('matches a ranking to a property by the address the producer echoes back', () => {
    const cf = build(twoProperties(), {
      finalRankings: [
        { rank: 1, address: '9 Sample Road, Elsewhere QLD 4000', score: 8.4, verdict: 'Best.' },
        { rank: 2, address: 'Somewhere that was never compared', score: 6, verdict: 'Unknown.' },
      ],
    });
    expect(cf.analysis?.rankings[0].property).toBe(2);
    expect(cf.analysis?.rankings[1].property).toBeNull();
    expect(cf.analysis?.rankings[1].statedAddress).toBe('Somewhere that was never compared');
  });

  /** The schema names no denominator, so none is invented. */
  it('keeps a score as the bare number the model gave', () => {
    const cf = build(twoProperties(), {
      finalRankings: [{ rank: 1, address: '9 Sample Road, Elsewhere QLD 4000', score: 8.4 }],
    });
    expect(cf.analysis?.rankings[0].score).toBe(8.4);
  });

  /**
   * Dropped, not coerced. Coercion is exactly how the legacy generator ends up
   * handing an object to `pdf.splitTextToSize`.
   */
  it('drops a block whose shape does not match, rather than coercing it', () => {
    const cf = build(twoProperties(), {
      executiveSummary: 'Something was written.',
      riskAssessment: 'not an object',
      overallRecommendation: 42,
      cashFlowTrajectory: { fastestPositiveCashFlow: 'also not an object' },
    });
    expect(cf.analysis?.risk).toBeNull();
    expect(cf.analysis?.recommendation).toBeNull();
    expect(cf.analysis?.trajectory).toBeNull();
    expect(cf.analysis?.summary).toBe('Something was written.');
  });

  it('reports which of the eight sections did not arrive, in schema order', () => {
    const cf = build(twoProperties(), { executiveSummary: 'Only this.' });
    expect(cf.analysis?.missing).toEqual([
      'cashFlowTrajectory',
      'capitalGrowth',
      'yieldAnalysis',
      'riskAssessment',
      'investorRecommendations',
      'finalRankings',
      'overallRecommendation',
    ]);
  });

  it('prints the alternative scenarios and not the property they point at', () => {
    const cf = build(twoProperties(), {
      overallRecommendation: {
        bestProperty: { propertyNumber: 1, reason: 'It is the one.' },
        alternativeScenarios: [{ scenario: 'If rates fall', recommendation: 2 }],
      },
    });
    expect(cf.analysis?.recommendation?.scenarios).toEqual(['If rates fall']);
  });
});
