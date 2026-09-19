/**
 * Phase 1 of the tier framework (docs/reports/TIER_FRAMEWORK.md) — pins for
 * the five defects measured on the 4 September 2026 production family of
 * 1/27D Mitchell Street (audit §19):
 *
 *  1. the Financial fork's narrative held ONE dollar sign while its row held
 *     the whole calculation — its chapters are now COMPOSED from the record;
 *  2. the Briefing printed six-row tables of N/A (33 → 87 per report as the
 *     parent lost its financials) — its guide is re-cut and every condense
 *     output is scrubbed: a labelled row is a promise that a figure follows;
 *  3. the Strategic/Due Diligence score was null on 11 of 11 rows because the
 *     scorer counted the same demand dimension twice against a three-of-five
 *     floor — and the verdict page printed "Graded  at  out of 100" with the
 *     holes left in;
 *  4. the Snapshot shipped as two documents stapled together (its 8 sections
 *     plus the parent's 9 echoed back) — output is trimmed to what the tier
 *     declares;
 *  5. every fork/condense child was stamped generation_engine='legacy' by
 *     column default, whatever engine made its parent.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  composeFinancialChapters,
} from '../investment/financialChapters.pure';
import {
  composeScoreBreakdownSection,
  composeSwotSection,
  gradedDetailLine,
  gradedLine,
} from '../investment/scoreSections.pure';
import {
  stripPlaceholderRows,
  trimToDeclaredSections,
} from '../investment/derivedHygiene.pure';
import { money, pct } from '../investment/figures.pure';
import {
  scoreFinancial,
  scorePropertyFundamentals,
} from '../../../../supabase/functions/_shared/investmentScoreEngine';
import { applyInvestmentProjection } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { renderTemplateToHtml } from '../../reportTemplate/htmlRenderer';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

// A production-shaped record. reconcileStoredFinancials recomputes the
// headline metrics from the components (operating line-sum excludes letting
// fees): annualRent 31,200 − holding 9,616 − repayments 28,596 = −7,012 —
// and the chapters state the HEALED figures, the same ones the KPI tiles
// bind, which is the point.
const FIN = {
  initialCosts: {
    propertyValue: 550_000, deposit: 110_000, stampDuty: 20_000, lmi: 0,
    legalFees: 1_500, inspectionFees: 600, totalUpfront: 132_100,
  },
  annualCosts: {
    councilRates: 2_000, waterRates: 1_100, landlordInsurance: 2_200,
    propertyManagement: 1_716, propertyManagementPercent: 5.5,
    maintenance: 2_600, lettingFees: 550,
  },
  income: { weeklyRent: 600 },
  loanDetails: {
    loanAmount: 440_000, lvr: 80, loanType: 'interest_only', interestRate: 6.5,
    monthlyPayment: 2_383, weeklyPayment: 550, totalInterest: 214_470,
    rateSource: 'RBA tiering',
  },
  keyMetrics: {
    lvr: 80, annualNet: -7_562, weeklyNet: -145, totalInvestment: 132_100,
    cashOnCashReturn: -5.72, grossRentalYield: 5.67, netRentalYield: 4.1,
  },
  sensitivityAnalysis: {
    rentChanges: { minus10Percent: -10_682, plus10Percent: -4_442, plus20Percent: -1_322 },
    interestRateChanges: { minus1Percent: -3_162, plus1Percent: -11_962, plus2Percent: -16_362 },
  },
  projections: {
    moderate: [1, 3, 5, 7, 10].map((year) => ({
      year,
      propertyValue: 550_000 + year * 30_000,
      annualRent: 31_200 + year * 900,
      cashFlow: -7_562 + year * 400,
      cumulativeCashFlow: -7_562 * year,
      equity: 110_000 + year * 30_000,
      loanBalance: 440_000,
    })),
  },
  assumptions: { capitalGrowth: 6, cpiGrowth: 3, occupancyWeeks: 52 },
  taxBenefits: { depreciation: 3_000 },
};

const SCORE = {
  grade: 'B', totalScore: 62,
  recommendation: 'HOLD/BUY - Moderate investment potential',
  breakdown: {
    riskScore: { score: 75, weight: 11, hasData: true },
    yieldScore: { score: 65, weight: 33, hasData: true },
    growthScore: { score: 0, weight: 0, hasData: false },
    locationScore: { score: 60, weight: 30, hasData: true },
  },
  strengths: ['High walkability'], weaknesses: ['Negative cashflow'],
  opportunities: [], risks: [],
};

describe('the Financial chapters are composed from the record', () => {
  const chapters = composeFinancialChapters(
    { financialCalculations: FIN, investmentScore: SCORE },
    { scenarios: 'all' },
  );

  it('produces the missing chapters in FIN ordinal order, never a placeholder', () => {
    expect(chapters.map((c) => c.ordinal)).toEqual([4, 5, 6, 8, 9, 11, 12, 14] /* 11: the Financial Risk Dashboard, composed from the record since QA-31 */);
    const all = chapters.map((c) => c.markdown).join('\n');
    expect(all).not.toMatch(/N\/A|TBD/i);
    expect((all.match(/\$/g) ?? []).length).toBeGreaterThan(30);
  });

  it('states the reconciled figures, locale-free', () => {
    const ch8 = chapters.find((c) => c.ordinal === 8)!.markdown;
    /*
     * The record's OWN net position, not a recomputation of it.
     *
     * This asserted -$7,012 and -5.31%, which is what the read-time
     * reconciliation used to write over the stored -$7,562 / -5.72%. The
     * difference is exactly this row's $550 letting fee: the fallback cost
     * base listed seven of the engine's eight components, so a row carrying
     * no footed total was charged seven of its costs and came out $550 better
     * than the record said. The chapter now prints what the calculator wrote.
     */
    expect(ch8).toContain('-$7,562');
    expect(ch8).toContain('$132,100');
    expect(ch8).toContain('-5.72%');
    expect(ch8).toContain('Interest rate +2%');
    const ch4 = chapters.find((c) => c.ordinal === 4)!.markdown;
    expect(ch4).toContain('**$132,100**');
    expect(ch4).toContain('Property management (5.5% of rent)');
  });

  it('an absent fact loses its row; an absent block loses its chapter', () => {
    const noLandTax = chapters.find((c) => c.ordinal === 4)!.markdown;
    expect(noLandTax).not.toContain('Land tax');

    const thin = composeFinancialChapters({
      financialCalculations: { income: { weeklyRent: 600 } },
    });
    expect(thin.map((c) => c.ordinal)).toEqual([5]);
    expect(composeFinancialChapters({})).toEqual([]);
  });

  it('the 10-year table carries only columns every selected row can fill', () => {
    const ch9 = chapters.find((c) => c.ordinal === 9)!.markdown;
    expect(ch9).toContain('| Year | Property value | Annual rent | Cashflow | Cumulative | Equity | LVR |');
    expect(ch9).toContain('### Base case');
    expect(ch9).toContain('Capital growth | 6%');
  });

  it('money and pct never consult the runtime locale', () => {
    expect(money(-7562)).toBe('-$7,562');
    expect(money(1234567)).toBe('$1,234,567');
    expect(pct(5.5)).toBe('5.5%');
    expect(pct(5)).toBe('5%');
  });
});

describe('the verdict sentence exists only when the record can say it', () => {
  it('names the dimensions this score actually carries', () => {
    expect(gradedLine(SCORE)).toBe(
      'Graded B at 62 out of 100, weighted across risk, yield and location.',
    );
    expect(gradedDetailLine(SCORE)).toContain('set out on the assessment page');
  });

  it('an absent score produces no sentence — never one with holes', () => {
    expect(gradedLine(null)).toBeUndefined();
    expect(gradedLine({})).toBeUndefined();
    expect(gradedLine({ grade: 'B' })).toBeUndefined();
    expect(gradedDetailLine(undefined)).toBeUndefined();
  });

  it('the rendered verdict body is empty on a score-less row, not broken', () => {
    const data = applyInvestmentProjection({}, {
      property_address: '28 Bligh Street', report_tier: 'strategic',
      investment_score: null, financial_calculations: FIN,
    } as never);
    const template = {
      id: 'v', name: 'v', version: 1, tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p', name: 'p',
        blocks: [{ id: 'b', type: 'text-block', x: 10, y: 10, width: 100, height: 20, props: { body: '{{recommendation.gradedLine}}' } }],
      }],
    };
    const { html } = renderTemplateToHtml(template as never, { data });
    expect(html).not.toContain('Graded');
    expect(html).not.toContain('{{');
  });

  it('the score breakdown and SWOT tabulate only what was recorded', () => {
    const breakdown = composeScoreBreakdownSection(SCORE, 'Investment Score Breakdown')!;
    expect(breakdown).toContain('| Yield | 33% | 65/100 |');
    expect(breakdown).not.toContain('Growth');
    const swot = composeSwotSection(SCORE, 'SWOT Analysis')!;
    expect(swot).toContain('### Strengths');
    expect(swot).not.toContain('### Opportunities');
    expect(composeSwotSection({ strengths: [], weaknesses: [] }, 'SWOT')).toBeNull();
    expect(composeScoreBreakdownSection(null, 'x')).toBeNull();
  });
});

describe('a labelled row is a promise — the placeholder scrub', () => {
  it('drops broken-promise rows, blanks trailing placeholders, drops empty tables', () => {
    const md = [
      '## Current Market Performance',
      '| Metric | Value | YoY |',
      '| --- | --- | --- |',
      '| Median House Price | N/A | N/A |',
      '| Median Unit Price | N/A | N/A |',
      '',
      '## Industries',
      '| Industry | Share | Growth |',
      '| --- | --- | --- |',
      '| Mining | 30% | N/A |',
      '| Retail | N/A | 2% |',
      '',
      '- Source attribution: N/A (not provided in the original report.)',
      'N/A (Historical price growth data not provided.)',
      'The vacancy rate is genuinely low; N/A entries above were placeholders.',
    ].join('\n');
    const r = stripPlaceholderRows(md);
    expect(r.removedRows).toBe(3);
    expect(r.removedTables).toBe(1);
    expect(r.removedLines).toBe(2);
    expect(r.blankedCells).toBe(1);
    expect(r.markdown).toContain('| Mining | 30% |  |');
    expect(r.markdown).not.toContain('Median House Price');
    expect(r.markdown).not.toContain('Source attribution');
    // Prose that merely mentions the token is the author's business.
    expect(r.markdown).toContain('genuinely low');
  });

  it('cleared the worst production briefing to zero', () => {
    // Row 89b451f6 carried 87 occurrences; the scrub's three rules account
    // for every class found on it (whole rows, trailing cells, confession
    // lines). Pinned structurally rather than on the stored row, which tests
    // cannot read.
    const confession = '- Job Growth Trends table: N/A (Specific growth rates not provided.)';
    expect(stripPlaceholderRows(confession).removedLines).toBe(1);
    // The snapshot's own residual, found by running the pipeline over the
    // stored 4 September row: a score bullet whose value never arrived.
    expect(stripPlaceholderRows('- Score: N/A/100').removedLines).toBe(1);
  });
});

describe('a tier keeps only the sections it declares — the snapshot trim', () => {
  it('drops the parent sections the model echoed back, and names them', () => {
    const md = [
      '## Property Summary', 'ok',
      '## Score Breakdown (simplified)', 'ok',
      '## Property & Locality Snapshot', 'echoed parent section',
      '## Demand Drivers', 'echoed parent section',
    ].join('\n');
    const r = trimToDeclaredSections(md, ['Property Summary', 'Score Breakdown']);
    expect(r.dropped).toEqual(['Property & Locality Snapshot', 'Demand Drivers']);
    expect(r.markdown).toContain('Score Breakdown (simplified)');
    expect(r.markdown).not.toContain('Demand Drivers');
  });
});

describe('the Due Diligence scorer can actually score', () => {
  const raw = {
    property: { price: 550_000, weeklyRent: 600, propertyType: 'house' },
    demographics: { vacancyRate: 1.2, unemploymentRate: 4.0 },
    locationIntelligence: { walkScore: 55, schoolsNearby: 4 },
    financials: FIN,
    state: 'NSW',
  };

  it('no longer counts the same demand dimension twice', () => {
    const dd = scorePropertyFundamentals(raw)!;
    expect(dd).not.toBeNull();
    expect(Object.keys(dd.breakdown)).not.toContain('tenantFitScore');
    expect(Object.keys(dd.breakdown).sort()).toEqual(
      ['demandScore', 'liveabilityScore', 'locationScore', 'planningRiskScore'],
    );
  });

  it('scores on one real dimension plus a proxy, refuses proxies alone', () => {
    const locationOnly = scorePropertyFundamentals({
      ...raw, demographics: {}, locationIntelligence: { walkScore: 55 },
    });
    expect(locationOnly).not.toBeNull();
    // Every proxy's input (state, walk score) also lights the location
    // dimension, so "proxies alone" cannot structurally occur — the floor
    // that matters is that NOTHING measured means no score, not a C+ from
    // thin air, which is what the duplicated dimension used to manufacture.
    const nothingMeasured = scorePropertyFundamentals({
      property: { price: 550_000, weeklyRent: 600, propertyType: 'house' },
      demographics: {}, locationIntelligence: {}, financials: {},
    });
    expect(nothingMeasured).toBeNull();
  });

  it('the financial scorer is untouched', () => {
    expect(scoreFinancial(raw)).not.toBeNull();
  });
});

describe('the engines stamp lineage and compose rather than slice', () => {
  // The handler AND the composition it calls: `forkSplit.pure.ts` holds the
  // routing, the composed chapters and the hygiene pass that used to be 257
  // lines of `index.ts`, and a rule about what the fork does is satisfied by
  // either.
  const fork = read('supabase/functions/fork-investment-report/index.ts')
    + '\n' + read('supabase/functions/_shared/reports/investment/forkSplit.pure.ts');
  // The handler AND the composition it calls: `condenseCompose.pure.ts` holds
  // the composed sections, the registry trim, the declared-order assembly and
  // the hygiene passes that used to be 156 lines of `index.ts`, and a rule
  // about what condensation does is satisfied by either.
  const condense = read('supabase/functions/condense-investment-report/index.ts')
    + '\n' + read('supabase/functions/_shared/reports/investment/condenseCompose.pure.ts');

  it('fork: composed chapters, hygiene, score fallback, engine + scope', () => {
    expect(fork).toContain('composeFinancialChapters');
    expect(fork).toContain('mergeComposedChapters');
    expect(fork).toContain('stripPlaceholderRows');
    expect(fork).toContain('stripEditorialLabelsFromMarkdown');
    expect(fork).toContain('resolveVariantScore');
    // A fork mints no grade: the variant scorer's output goes through the
    // scoring policy, which restates the parent's decision (15 Sep 2026 —
    // the Financial fork wrote D · 39 beside a withheld composite).
    expect(fork).toContain('variantScoreUnderPolicy({ variantScore, parentScore, now: new Date() })');
    expect(fork).toContain("generation_engine: parent.generation_engine ?? 'legacy'");
    expect(fork).toContain('report_scope: parent.report_scope');
  });

  it('condense: the Briefing guide demands nothing the parent cannot give', () => {
    expect(condense).not.toContain('LVR Projections');
    expect(condense).not.toContain('Loan Analysis (P&I and Interest-Only)');
    expect(condense).not.toContain('Current Market Performance (Q3/Q4 2025)');
    expect(condense).toContain('attached programmatically');
    /*
     * `composeFinancialChapters` used to be asserted here. The Briefing no
     * longer composes the five detailed chapters (S5/S6 §4, 18 Sep 2026;
     * `TIER_FRAMEWORK` Decision F) — they contradicted the same tier's
     * `financialModelling: false` and the companion note printed on its own
     * cover. What this test is actually for is that the guide demands nothing
     * the parent cannot give, so the two things that remain composed from the
     * record are asserted instead, and the guide's prohibition with them.
     */
    expect(condense).toContain('composeScoreBreakdownSection');
    expect(condense).toContain('composeSwotSection');
    expect(condense).toContain('Do NOT write any financial table');
    expect(condense).toContain('trimToDeclaredSections');
    expect(condense).toContain('stripPlaceholderRows');
    const engineStamps = condense.match(/generation_engine: parentReport\.generation_engine \?\? 'legacy'/g);
    expect(engineStamps?.length).toBe(2);
  });

  it('the verdict bodies bind the composed line, never the interpolation', () => {
    const templates = read('scripts/template-library/investmentCompass/templates.ts');
    expect(templates).toContain('{{recommendation.gradedLine}}');
    expect(templates).toContain('{{recommendation.gradedDetailLine}}');
    expect(templates).not.toMatch(/Graded \{\{recommendation\.grade\}\}/);
  });

  it('the v12 seed and its active-row refresh ship together', () => {
    expect(statSync(resolve(REPO, 'supabase/migrations/20261112000000_seed_template_library_v12_guarded_verdict_line.sql')).size)
      .toBeGreaterThan(1_000_000);
    const refresh = read('supabase/migrations/20261112010000_refresh_active_masters_from_library_v12.sql');
    expect(refresh).toContain("coalesce(t.schema -> 'tokens' -> 'colors'");
    expect(refresh).not.toMatch(/\bdelete\b/i);
  });
});
