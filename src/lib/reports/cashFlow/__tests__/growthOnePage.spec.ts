/**
 * "Value, debt and equity" is read on ONE page — the owner's rule of
 * 28 Sep 2026: the two charts together, not split across two pages.
 *
 * The one-page property itself is a fact about a render, so it was measured in
 * WeasyPrint 69.0 over the standard document and all 50 catalogue designs —
 * established, new build, a land-only purchase with a planned build and a term
 * that turns cash-positive (204 documents, every one on one page; each document
 * one page shorter than before) — `docs/reports/CASH_FLOW.md` §11. What this
 * file pins is what that measurement depends on.
 */
import { describe, expect, it } from 'vitest';

import { cashPositionChart, compactMoney, equityBuildChart, niceScale } from '../charts.pure';
import { buildProjection } from '../normalise.pure';
import { cashFlowSections } from '../sections.pure';
import { renderCashFlowBody } from '../render.pure';

const PALETTE = {
  paper: '#faf7f0', paperAlt: '#f3ece0', paperBright: '#fffdf8', field: '#1c1b19', rule: '#d8cfbf',
  bodyInk: '#2a2723', mutedInk: '#6b6356', onFieldInk: '#f5f0e6', accentFill: '#c9a55a',
  accentOnPaper: '#7a5d1f', accentOnField: '#d9b870', positive: '#2f6b3a', caution: '#8a5a00',
  negative: '#a3261b', informative: '#1f4f7a',
};

function project(afterTax: number[]) {
  const years = afterTax.map((a, i) => ({
    year: i + 1, calendarYear: 2027 + i, propertyValue: 700_000 * 1.05 ** (i + 1), loanBalance: 630_000 - i * 5_000,
    rentalIncome: 28_000, grossYield: 3.8, netYield: 2.8, expenses: 7_700, interestRate: 6.5, interest: 41_000,
    principal: 0, preTaxAnnual: a - 5_000, afterTaxAnnual: a, depreciation: 10_000, taxRefund: 5_000,
    taxEffect: 5_000, landTax: 0, capitalGrowth: 5, cpiGrowth: 3,
  }));
  return buildProjection({
    source: {
      acquisition: {
        purchasePrice: 700_000, marketValue: 700_000, deposit: 70_000, loanAmount: 630_000, loanTermYears: 30,
        interestRate: 6.5, loanType: 'interest_only', weeklyRent: 550, costs: [],
      },
      years, assumptions: [], notes: [],
      settlement: { propertyValue: 700_000, loanBalance: 630_000 },
    },
    propertyAddress: '1 Test Street, Lara VIC 3212',
    clientName: '',
    now: '2026-09-28T00:00:00.000Z',
  });
}

/** The SVG a chart figure carries, decoded. */
function svgOf(figure: string): string {
  const b64 = figure.match(/base64,([^"]+)"/)?.[1];
  return b64 ? Buffer.from(b64, 'base64').toString('utf8') : figure;
}

const ALL_NEGATIVE = [-10_300, -10_400, -18_600, -18_900, -19_100, -19_000, -18_900, -18_800, -18_700, -18_200];
const MIXED = [-9_200, -6_100, -3_500, -1_200, 400, 2_600, 4_900, 7_300, 9_800, 12_400];

describe('"What this assumes" is one page too (Audit 7)', () => {
  // At the full opener the page held the table, three notes and the caution
  // with a line or two to spare: a fourth note (depreciation excluded) or a
  // longer one sent the caution alone onto a page of its own in 23 of 51
  // designs. Measured in WeasyPrint — CASH_FLOW.md §12.
  it('opens as a one-page chapter', () => {
    const cf = { ...project(ALL_NEGATIVE), notes: ['Depreciation is excluded from this projection at the adviser\'s direction.'] };
    const assumptions = cashFlowSections(cf).find((s) => s.id === 'assumptions')!;
    expect(assumptions.pageBudget).toBe(1);
    expect(assumptions.onePage).toBe(true);
    const html = renderCashFlowBody({
      projection: cf, palette: PALETTE as never,
      company: { name: { lead: 'Kestrel', tail: '' }, rows: [], disclaimer: { paragraphs: [], fontPt: 8 } } as never,
      masthead: 'Kestrel',
    });
    expect(html).toMatch(/class="chapter cf-onepage page-body"[^>]*data-chapter-title="What this assumes"/);
  });
});

describe('the section is one page', () => {
  it('is budgeted one page and opens as a one-page chapter', () => {
    const growth = cashFlowSections(project(ALL_NEGATIVE)).find((s) => s.id === 'growth')!;
    expect(growth.pageBudget).toBe(1);
    expect(growth.onePage).toBe(true);
    const html = renderCashFlowBody({
      projection: project(ALL_NEGATIVE), palette: PALETTE as never,
      company: { name: { lead: 'Kestrel', tail: '' }, rows: [], disclaimer: { paragraphs: [], fontPt: 8 } } as never,
      masthead: 'Kestrel',
    });
    expect(html).toMatch(/class="chapter cf-onepage page-body"[^>]*data-chapter-title="Value, debt and equity"/);
  });

  it('draws both charts together, then the end of the term beside what it means', () => {
    const html = renderCashFlowBody({
      projection: project(ALL_NEGATIVE), palette: PALETTE as never,
      company: { name: { lead: 'Kestrel', tail: '' }, rows: [], disclaimer: { paragraphs: [], fontPt: 8 } } as never,
      masthead: 'Kestrel',
    });
    const section = html.slice(html.indexOf('data-chapter-title="Value, debt and equity"'));
    const charts = section.slice(section.indexOf('cf-growth-charts'), section.indexOf('cf-growth-end'));
    expect(charts.match(/<figure/g)).toHaveLength(2);
    expect(section.indexOf('cf-growth-end')).toBeGreaterThan(section.indexOf('cf-growth-charts'));
    // The cumulative figure is the strip's; the table is not a second copy of it.
    const end = section.slice(section.indexOf('cf-growth-end'), section.indexOf('</section>'));
    expect(end).not.toContain('Cumulative cash flow after tax');
    expect(end).toContain('Capital growth over the term');
  });
});

describe('the two charts read as one picture', () => {
  it('share one column geometry, so each year sits over the same year', () => {
    const cf = project(ALL_NEGATIVE);
    const xs = (svg: string, fill: string) => [...svg.matchAll(new RegExp(`<rect x="([\\d.]+)" y="[\\d.]+" width="([\\d.]+)" height="[\\d.]+" fill="${fill}"`, 'g'))]
      .map((m) => [Number(m[1]), Number(m[2])])
      // The legend swatch is a rect in the same colour; a column is wider.
      .filter(([, width]) => width > 20);
    const equity = xs(svgOf(equityBuildChart(cf, PALETTE as never)), PALETTE.accentFill);
    const cash = xs(svgOf(cashPositionChart(cf, PALETTE as never)), PALETTE.negative);
    expect(equity).toHaveLength(10);
    expect(cash).toHaveLength(10);
    expect(cash).toEqual(equity);
  });

  it('labels every year, not every other one', () => {
    for (const chart of [equityBuildChart, cashPositionChart]) {
      const svg = svgOf(chart(project(ALL_NEGATIVE), PALETTE as never));
      for (let y = 1; y <= 10; y++) expect(svg).toContain(`>Yr ${y}</text>`);
    }
  });

  it('steps the value axis on round figures', () => {
    const svg = svgOf(equityBuildChart(project(ALL_NEGATIVE), PALETTE as never));
    const ticks = [...svg.matchAll(/text-anchor="end"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(ticks).toEqual(['$0', '$500k', '$1m', '$1.5m']);
  });

  it('keys only what it draws', () => {
    const allNeg = svgOf(cashPositionChart(project(ALL_NEGATIVE), PALETTE as never));
    expect(allNeg).toContain('Costs the owner');
    expect(allNeg).not.toContain('Pays the owner');
    const mixed = svgOf(cashPositionChart(project(MIXED), PALETTE as never));
    expect(mixed).toContain('Costs the owner');
    expect(mixed).toContain('Pays the owner');
  });

  it('prints every year\'s figure, and the zero line is the break-even line', () => {
    const svg = svgOf(cashPositionChart(project(MIXED), PALETTE as never));
    for (const v of MIXED) expect(svg).toContain(`>${compactMoney(v)}</text>`);
    expect(svg).toMatch(/stroke="#2a2723" stroke-width="0.9"/);
  });
});

describe('the axis vocabulary', () => {
  it('niceScale picks 1, 2, 2.5 or 5 of a power of ten', () => {
    expect(niceScale(1_162_479, 4)).toEqual({ step: 500_000, top: 1_500_000 });
    expect(niceScale(2_287_745, 4)).toEqual({ step: 1_000_000, top: 3_000_000 });
    expect(niceScale(1_598_108, 4)).toEqual({ step: 500_000, top: 2_000_000 });
    expect(niceScale(19_100, 4)).toEqual({ step: 5_000, top: 20_000 });
  });

  it('compactMoney says a figure the way a person would', () => {
    expect(compactMoney(0)).toBe('$0');
    expect(compactMoney(1_500_000)).toBe('$1.5m');
    expect(compactMoney(2_000_000)).toBe('$2m');
    expect(compactMoney(500_000)).toBe('$500k');
    expect(compactMoney(-19_100)).toBe('-$19.1k');
    expect(compactMoney(-19_000)).toBe('-$19k');
    expect(compactMoney(400)).toBe('$400');
  });
});
