/**
 * Stage 3 — the derived reports agree with the record, and with each other.
 *
 * Three defects, all found by running the current engine against a real parent
 * row (`1/27D Mitchell Street`, `0478c410`) rather than by reading the corpus:
 * every one of the 71 stored children predates the September fixes, so the
 * stored documents cannot testify about the code that runs today.
 *
 *  1. **One annual rent.** The projection published `weeklyRent ×
 *     occupancyWeeks` under the bare name `annualRent`, beside a yield computed
 *     on 52 weeks.
 *  2. **The Snapshot composed nothing**, while its siblings composed 7 and 8
 *     sections — and four of its nine model-authored sections were numeric.
 *  3. **Composed sections were appended**, so the Briefing's financial tables
 *     printed after its recommendation and after its sources appendix.
 *
 * As in Stages 1 and 2 the adoption-safety cases carry the most weight: a
 * record with no occupancy assumption must behave as it did, a tier with
 * nothing composed must come out unchanged, and nothing may be dropped to fix
 * an order.
 */
import { describe, expect, it } from 'vitest';

import {
  composeFinancialChapters,
  composeFinancialSnapshotSection,
} from '../investment/financialChapters.pure';
import { readAnnualRent } from '../investment/rentBasis.pure';
import {
  composeScoreBreakdownSection,
  composeScoreDimensionsSection,
  composeVerdictSection,
} from '../investment/scoreSections.pure';
import { assembleInDeclaredOrder, type ComposedPlacement } from '../investment/tierAssembly.pure';
import { projectInvestmentReport } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';

// Verbatim from the production row, trimmed to what these rules read.
const FIN = {
  income: { weeklyRent: 600, annualRent: 31200 },
  keyMetrics: {
    lvr: 80, annualNet: -10833, weeklyNet: -208,
    netRentalYield: 4.1, totalInvestment: 131237,
    cashOnCashReturn: -8.25, grossRentalYield: 5.67,
  },
  assumptions: { capitalGrowth: 5, occupancyWeeks: 50 },
  initialCosts: { propertyValue: 550000, deposit: 110000, loanAmount: 440000, totalUpfront: 131237 },
  loanDetails: { loanAmount: 440000, interestRate: 6.5, monthlyPayment: 2781.1, lvr: 80 },
  projections: {
    moderate: [
      { year: 1, propertyValue: 577500, equity: 142273, cashFlow: -10226 },
      { year: 10, propertyValue: 895892, equity: 520304, cashFlow: -2757 },
    ],
  },
};

const SCORE = {
  grade: 'B',
  totalScore: 62,
  recommendation: 'HOLD/BUY - Moderate investment potential, consider your personal circumstances',
  coverage: { coverageRatio: 0.6, partialLabel: 'Partial score: 3 of 5 dimensions' },
  breakdown: {
    riskScore: { score: 75, weight: 11, hasData: true, excluded: false },
    yieldScore: { score: 65, weight: 33, hasData: true, excluded: false },
    locationScore: { score: 58, weight: 56, hasData: true, excluded: false },
    // The engine's own "could not score this" shape: a placeholder 50 that is
    // not a score, with zero weight and both flags set.
    demandScore: { score: 50, weight: 0, hasData: false, excluded: true },
    growthScore: { score: 50, weight: 0, hasData: false, excluded: true },
  },
};

describe('one annual rent, and the basis it is stated on', () => {
  it('publishes the contractual rent, which is what the stored yield rests on', () => {
    // A tier that MAY carry the modelling, because this asserts the
    // projection's arithmetic. What a tier may publish is the test below.
    const p = projectInvestmentReport({ financial_calculations: FIN, investment_score: SCORE, report_tier: 'financial' });
    const f = p.financials as Record<string, unknown>;
    expect(f.annualRent).toBe(31200);
    // The whole point: the figure and the yield beside it reconcile.
    expect((31200 / 550000) * 100).toBeCloseTo(Number(f.grossYield), 2);
  });

  it('withholds the modelling from a tier that may not carry it, and keeps the rent', () => {
    /*
     * `compassSectionRegistry` has said since v2.0 that a Compass carries no
     * financial modelling, and the masters drew it anyway because the rule
     * was enforced on the prose and the bindings came from here.
     * `tierContent.pure.ts` decides it now, at the projection, so one rule
     * reaches all 500 seeded masters and both render routes.
     *
     * The rent and the price stay: withholding the modelling is not
     * withholding the price, and a location report that will not say what the
     * property costs is coy rather than focused.
     */
    const compass = projectInvestmentReport({ financial_calculations: FIN, investment_score: SCORE, report_tier: 'compass' });
    const f = compass.financials as Record<string, unknown>;
    expect(f.weeklyRent).toBe(600);
    expect(f.annualRent).toBe(31200);
    expect(f.purchasePrice).toBe(550000);
    for (const withheld of ['grossYield', 'netYield', 'lvr', 'loanAmount', 'weeklyNet', 'annualNet', 'cashOnCash']) {
      expect(f, withheld).not.toHaveProperty(withheld);
    }
    expect(compass.equitySeries).toEqual([]);
    expect((compass.report as Record<string, unknown>).drawsFinancialModelling).toBe(false);

    // And the Snapshot, which condenses from a Compass parent, still gets the
    // figures — because the tier being PRODUCED decides, not the row read.
    const forSnapshot = projectInvestmentReport(
      { financial_calculations: FIN, investment_score: SCORE, report_tier: 'compass' },
      { tier: 'snapshot' },
    );
    expect((forSnapshot.financials as Record<string, unknown>).grossYield).toBeDefined();
  });

  it('keeps the occupancy assumption under its own name', () => {
    const p = projectInvestmentReport({ financial_calculations: FIN, investment_score: SCORE });
    const f = p.financials as Record<string, unknown>;
    expect(f.annualRentAtOccupancy).toBe(30000);
    expect(f.annualRentAtOccupancyLabel).toBe('Annual rent at 50 occupied weeks');
  });

  it('answers with 52 weeks where the record states no occupancy', () => {
    // 44 of 170 reports with a weekly rent carry no `occupancyWeeks`. The old
    // expression returned undefined for all of them, so a template's "p.a."
    // note rendered as the empty string.
    const r = readAnnualRent({ weeklyRent: 700 }, {});
    expect(r.contractual).toBe(36400);
    expect(r.atOccupancy).toBeUndefined();
    expect(r.occupancyLabel).toBeUndefined();
  });

  it('adds no second row where the report assumes a full year', () => {
    const r = readAnnualRent({ weeklyRent: 700 }, { occupancyWeeks: 52 });
    expect(r.contractual).toBe(36400);
    expect(r.atOccupancy).toBeUndefined();
  });

  it('says nothing at all where the record establishes no rent', () => {
    const r = readAnnualRent({}, { occupancyWeeks: 50 });
    expect(r.contractual).toBeUndefined();
    expect(r.atOccupancy).toBeUndefined();
  });

  it('prints both rents as separate rows in the composed rental chapter', () => {
    const chapter = composeFinancialChapters(
      { financialCalculations: FIN, investmentScore: SCORE },
      { scenarios: 'primary' },
    ).find((c) => c.ordinal === 5);
    expect(chapter).toBeTruthy();
    expect(chapter!.markdown).toContain('| Annual rent | $31,200 |');
    expect(chapter!.markdown).toContain('| Annual rent at 50 occupied weeks | $30,000 |');
    // The defect, stated as a test: the occupancy figure must never be the one
    // labelled plainly "Annual rent" beside a 52-week yield.
    expect(chapter!.markdown).not.toContain('| Annual rent | $30,000 |');
  });
});

describe('the snapshot states the record\'s verdict, not one of its own', () => {
  it('carries the recommendation the engine actually issued', () => {
    const md = composeVerdictSection(SCORE, 'Investment Score');
    expect(md).toContain('HOLD/BUY');
    expect(md).toContain('**Grade:** B · **Score:** 62/100');
  });

  it('discloses a partial score, as the in-app viewer already did', () => {
    expect(composeVerdictSection(SCORE, 'Investment Score')).toContain('Partial score: 3 of 5 dimensions');
  });

  it('says nothing about coverage when the score rests on every dimension', () => {
    const full = { ...SCORE, coverage: { coverageRatio: 1, partialLabel: 'Full score' } };
    expect(composeVerdictSection(full, 'Investment Score')).not.toContain('Full score');
  });

  it('omits a dimension the engine could not score rather than printing its placeholder 50', () => {
    const md = composeScoreDimensionsSection(SCORE, 'Score Breakdown');
    expect(md).toContain('| Risk | 11% | 75/100 |');
    expect(md).toContain('| Yield | 33% | 65/100 |');
    expect(md).toContain('| Location | 56% | 58/100 |');
    expect(md).not.toContain('Growth');
    expect(md).not.toContain('Demand');
    expect(md).not.toContain('50/100');
  });

  it('is null rather than an empty heading when the record carries no verdict', () => {
    expect(composeVerdictSection({ breakdown: {} }, 'Investment Score')).toBeNull();
    expect(composeScoreDimensionsSection({ grade: 'B', totalScore: 62 }, 'Score Breakdown')).toBeNull();
    expect(composeVerdictSection(null, 'Investment Score')).toBeNull();
  });

  it('leaves the briefing\'s combined section carrying both halves', () => {
    // Splitting the composer must not change the tier that used the whole one.
    const md = composeScoreBreakdownSection(SCORE, 'Investment Score Breakdown');
    expect(md).toContain('**Grade:** B · **Score:** 62/100');
    expect(md).toContain('| Risk | 11% | 75/100 |');
  });
});

describe('the snapshot\'s financial table is typed from the record', () => {
  const md = composeFinancialSnapshotSection(FIN, 'Financial Snapshot')!;

  it('states the rent the yield rests on', () => {
    expect(md).toContain('| Annual rent | $31,200 |');
    expect(md).toContain('| Gross yield | 5.67% |');
  });

  it('carries the ten-year value the guide asked a model to produce', () => {
    // `10-Year Projected Value` was in the snapshot guide's metric list and in
    // no facts block, so a model asked for it had to project one itself.
    expect(md).toContain('| Projected value, year 10 | $895,892 |');
  });

  it('withholds both yields where the record establishes no rent', () => {
    const noRent = { ...FIN, income: {} };
    const out = composeFinancialSnapshotSection(noRent, 'Financial Snapshot')!;
    expect(out).toContain('| Purchase price | $550,000 |');
    expect(out).not.toContain('Gross yield');
    expect(out).not.toContain('Net yield');
  });

  it('is null rather than an empty table when the record holds nothing', () => {
    expect(composeFinancialSnapshotSection({}, 'Financial Snapshot')).toBeNull();
    expect(composeFinancialSnapshotSection(null, 'Financial Snapshot')).toBeNull();
  });
});

describe('sections come out in the order the registry declares', () => {
  const AUTHORED = [
    '# Briefing', '',
    '## Executive Summary', 'A considered purchase.', '',
    '## Risk Overview', 'Cash flow.', '',
    '## Top 3 Opportunities', '- One.', '',
    '## Recommendation', 'Hold/buy.', '',
    '## Market Data Sources', '- NPC internal assessment.', '',
  ].join('\n');

  /*
   * Two composed sections the Briefing DECLARES, so the ordering rule is
   * exercised on a real slot rather than on an appended one.
   *
   * This used to be `rentalYield` + `scorecard`. The Briefing declared the
   * five financial chapters then; it does not from 18 Sep 2026 (S5/S6 §4,
   * `TIER_FRAMEWORK` Decision F), so `rentalYield` is now an UNDECLARED id for
   * this tier and appends — which is the behaviour the "no slot" test below
   * covers, not this one. `swot` and `scorecard` are the Briefing's own.
   */
  const COMPOSED: ComposedPlacement[] = [
    { id: 'scorecard', markdown: '## Investment Score Breakdown\n\nscores\n' },
    { id: 'swot', markdown: '## SWOT Analysis\n\nstrengths\n' },
  ];

  const headings = (md: string) => [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);

  it('places a composed section at its declared order, not at the end', () => {
    const out = assembleInDeclaredOrder(AUTHORED, COMPOSED, 'briefing');
    expect(headings(out.markdown)).toEqual([
      'Executive Summary',
      'Risk Overview',
      // Both sit before Top 3 Opportunities, Recommendation and Market Data
      // Sources. Appending put them after all three.
      'Investment Score Breakdown',
      'SWOT Analysis',
      'Top 3 Opportunities',
      'Recommendation',
      'Market Data Sources',
    ]);
    expect(out.placed).toEqual(['scorecard', 'swot']);
    expect(out.unplaced).toEqual([]);
  });

  it('keeps the preamble and every authored body', () => {
    const out = assembleInDeclaredOrder(AUTHORED, COMPOSED, 'briefing');
    expect(out.markdown).toContain('# Briefing');
    expect(out.markdown).toContain('A considered purchase.');
    expect(out.markdown).toContain('- NPC internal assessment.');
  });

  it('replaces an authored section outright when one is composed for the same id', () => {
    const withModelScorecard = `${AUTHORED}\n## Investment Score Breakdown\n\nthe model's version\n`;
    const out = assembleInDeclaredOrder(withModelScorecard, COMPOSED, 'briefing');
    expect(out.markdown).toContain('scores');
    expect(out.markdown).not.toContain("the model's version");
    // ...and exactly once, not twice.
    expect(headings(out.markdown).filter((h) => h === 'Investment Score Breakdown')).toHaveLength(1);
  });

  it('returns a document unchanged in shape when nothing is composed', () => {
    // Adoption safety: a tier with no composed sections must come out as it
    // went in, in its own order.
    const out = assembleInDeclaredOrder(AUTHORED, [], 'briefing');
    expect(headings(out.markdown)).toEqual([
      'Executive Summary', 'Risk Overview', 'Top 3 Opportunities',
      'Recommendation', 'Market Data Sources',
    ]);
    expect(out.placed).toEqual([]);
  });

  it('appends and NAMES a composed section the tier declares no slot for', () => {
    // Never lose a client's content to fix its order.
    const out = assembleInDeclaredOrder(AUTHORED, [
      { id: 'planning', markdown: '## Planning, Zoning and Title Due Diligence\n\nzoning\n' },
    ], 'briefing');
    expect(out.markdown).toContain('zoning');
    expect(out.unplaced).toEqual(['planning']);
  });

  it('keeps every occurrence when the model repeats a heading', () => {
    // A repeat is an occurrence, never a merge: one production briefing carries
    // `marketPosition` four times, so keying by id and taking the last copy
    // would lose a client's content to fix its order.
    const repeated = [
      '## Risk Overview', 'First pass.', '',
      '## Risk Overview', 'Second pass.', '',
      '## Recommendation', 'Hold/buy.', '',
    ].join('\n');
    const out = assembleInDeclaredOrder(repeated, [], 'briefing');
    expect(out.markdown).toContain('First pass.');
    expect(out.markdown).toContain('Second pass.');
    expect(headings(out.markdown)).toEqual(['Risk Overview', 'Risk Overview', 'Recommendation']);
  });

  it('handles an empty document without inventing sections', () => {
    const out = assembleInDeclaredOrder('', COMPOSED, 'briefing');
    expect(headings(out.markdown)).toEqual([
      'Investment Score Breakdown',
      'SWOT Analysis',
    ]);
  });
});
