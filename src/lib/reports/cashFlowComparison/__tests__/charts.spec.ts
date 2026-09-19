/**
 * The three charts, and the specific ways each of them can lie.
 *
 * Every assertion here corresponds to something a real render did wrong before
 * it was fixed. A chart that draws is not a chart that is right, and none of
 * these would have failed a "does it produce SVG" test.
 */
import { describe, expect, it } from 'vitest';

import { buildComparison } from '../normalise.pure';
import {
  categoryWinsChart as rawCategoryWinsChart,
  cumulativeCashFlowChart as rawCumulativeCashFlowChart,
  MIN_DONUT_SEGMENTS,
  rankedReturnChart as rawRankedReturnChart,
} from '../charts.pure';
import { decodedChart } from '@/lib/reportDesign/__tests__/chartSvg';

// The drawing is base64 inside an `img`, because that is the only form the
// engine tags as a figure with alternative text — see `chartFigure`. These
// assertions are about the SVG, and the SVG is one decode away.
const categoryWinsChart = decodedChart(rawCategoryWinsChart);
const cumulativeCashFlowChart = decodedChart(rawCumulativeCashFlowChart);
const rankedReturnChart = decodedChart(rawRankedReturnChart);
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import { resolveSnapshotBrand } from '@/lib/reportDesign/documentBrand.pure';

const NOW = '2026-08-02T00:00:00.000Z';

const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  capturedAt: NOW,
});
const { palette } = resolveSnapshotBrand({ snapshot });

const projection = (afterTax: number, growth: number) => ({
  acquisition: {
    purchasePrice: 600_000,
    marketValue: 600_000,
    deposit: 120_000,
    loanAmount: 480_000,
    loanTermYears: 30,
    interestRate: 6,
    loanType: 'interest_only',
    weeklyRent: 550,
    costs: [{ label: 'Stamp duty', amount: 24_000 }],
  },
  years: Array.from({ length: 10 }, (_, i) => ({
    year: i + 1,
    calendarYear: 2027 + i,
    propertyValue: 600_000 + i * growth,
    loanBalance: 480_000,
    rentalIncome: 28_600,
    grossYield: 4.8,
    netYield: 3.2,
    expenses: 9_000,
    interestRate: 6,
    interest: 28_800,
    principal: 0,
    preTaxAnnual: afterTax,
    afterTaxAnnual: afterTax,
    depreciation: 6_000,
    taxRefund: 0,
    landTax: 0,
    capitalGrowth: 5,
    cpiGrowth: 2.5,
  })),
  assumptions: [],
  notes: [],
});

/** `count` properties, the last of which is the weakest on every measure. */
const build = (count: number, opts: { collapse?: boolean } = {}) => buildComparison({
  properties: Array.from({ length: count }, (_, i) => ({
    reportId: `${i}`.repeat(8) + '-1111-4111-8111-111111111111',
    address: `${i + 1} Example Street, Suburbia VIC 3000`,
    isPrimary: i === 0,
    projection: opts.collapse
      // Every property identical, so nothing has a clear leader.
      ? projection(-4_000, 30_000)
      : projection(-4_000 - i * 1_000, 30_000 - i * 5_000),
  })),
  primaryReportId: '0'.repeat(8) + '-1111-4111-8111-111111111111',
  clientName: '',
  investorProfile: 'balanced',
  analysis: null,
  now: NOW,
});

/** One property, which `buildComparison` will not produce and a caller might. */
const single = () => {
  const cf = build(2);
  return { ...cf, properties: [cf.properties[0]] };
};

describe('ranked total return', () => {
  /**
   * `renderBars` colours by `|value| / max` when no tone is given, so the
   * property that *lost* the most money would be drawn as the longest, greenest
   * bar in the chart. The tone is passed explicitly for exactly that reason.
   */
  it('gives a negative total return the negative colour, not the strongest one', () => {
    const losing = buildComparison({
      properties: [0, 1].map((i) => ({
        reportId: `${i}`.repeat(8) + '-1111-4111-8111-111111111111',
        address: `${i + 1} Example Street`,
        isPrimary: i === 0,
        // No growth at all, so total return is the cumulative holding cost.
        projection: projection(-40_000 - i * 10_000, 0),
      })),
      primaryReportId: '0'.repeat(8) + '-1111-4111-8111-111111111111',
      clientName: '',
      investorProfile: 'balanced',
      analysis: null,
      now: NOW,
    });
    expect(losing.properties[0].outcome.totalReturn.value).toBeLessThan(0);

    const svg = rankedReturnChart(losing, palette);
    expect(svg).toContain(palette.negative);
    expect(svg).not.toContain(palette.positive);
  });

  it('prints the figure beside each bar, so it reads in monochrome', () => {
    expect(rankedReturnChart(build(3), palette)).toMatch(/\$[\d,]+/);
  });

  /**
   * `buildComparison` refuses a single property, so this reaches the exported
   * chart directly — which is the case the guard exists for, since `charts.pure`
   * is importable by anything.
   */
  it('draws nothing for a single property', () => {
    expect(rankedReturnChart(single(), palette)).toBe('');
  });
});

describe('category wins', () => {
  /** Two segments is a ratio, and a ratio reads better as a sentence. */
  it(`draws nothing below ${MIN_DONUT_SEGMENTS} properties`, () => {
    expect(categoryWinsChart(build(2), palette)).toBe('');
  });

  /**
   * A property that led on nothing still competed. `renderDonut` draws no wedge
   * for a zero value but does list it in the legend, which is the honest
   * reading — dropping it would imply a smaller field than the one compared.
   */
  it('keeps every property in the key, including one that leads on nothing', () => {
    const svg = categoryWinsChart(build(4), palette);
    for (const n of [1, 2, 3, 4]) {
      expect(svg).toContain(`${n} Example Street`);
    }
  });

  /**
   * `renderDonut`'s default centre is the *first* segment's share and its default
   * sub-label is that segment's name — an address, which printed straight through
   * the ring on both sides in the first render. Both are stated here.
   */
  it('states its own centre rather than taking the default', () => {
    const svg = categoryWinsChart(build(4), palette);
    expect(svg).toContain('MEASURES LED');
    expect(svg).toMatch(/>\d+\/\d+</);
  });

  it('says how many measures were tied, in the singular when one was', () => {
    const svg = categoryWinsChart(build(3), palette);
    expect(svg).not.toContain('1 were tied');
  });

  it('draws nothing when nothing has a clear leader', () => {
    expect(categoryWinsChart(build(3, { collapse: true }), palette)).toBe('');
  });
});

describe('cumulative cash flow', () => {
  it('draws one line per property', () => {
    const svg = cumulativeCashFlowChart(build(5), palette);
    expect(svg.match(/<path d="M /g) ?? []).toHaveLength(5);
  });

  /**
   * The series palette is ordered by greyscale separation, which is enough for
   * fills but not for thin strokes — the first render put five lines on a plot
   * and three read as the same grey. Colour is never the only channel.
   */
  it('separates the lines by dash pattern as well as colour', () => {
    const svg = cumulativeCashFlowChart(build(5), palette);
    const dashes = new Set(
      [...svg.matchAll(/stroke-dasharray="([^"]+)"/g)].map((m) => m[1]),
    );
    // Four dashed series plus the break-even threshold.
    expect(dashes.size).toBeGreaterThanOrEqual(5);
  });

  /**
   * The key ran off the right edge at five properties and printed three labels
   * on top of one another. It wraps now, and long addresses are clipped.
   */
  it('wraps its key rather than running past the plot', () => {
    // Addresses the length real ones are. "1 Example Street" happens to fit five
    // to a row; "Lot 2325 Ned Street, Mambourin" does not, and that is the case
    // the first render got wrong.
    const long = build(5);
    const svg = cumulativeCashFlowChart({
      ...long,
      properties: long.properties.map((p, i) => ({
        ...p,
        shortAddress: `Lot ${2300 + i} Ned Street Mambourin`,
      })),
    }, palette);
    const width = Number(/viewBox="0 0 (\d+)/.exec(svg)?.[1] ?? 0);

    // A key swatch is the only 14-unit line in the chart; gridlines and the
    // threshold span the whole plot.
    const swatches = [...svg.matchAll(/<line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)"/g)]
      .map((m) => ({ x1: Number(m[1]), x2: Number(m[2]), y: m[3] }))
      .filter((s) => Math.abs(s.x2 - s.x1 - 14) < 0.001);

    expect(swatches).toHaveLength(5);
    // Five addresses do not fit on one row at this measure. If they ever do, the
    // wrap is untested and this should be told about it.
    expect(new Set(swatches.map((s) => s.y)).size).toBeGreaterThan(1);
    // And nothing runs off the edge, which is what the first render did.
    for (const s of swatches) expect(s.x2).toBeLessThan(width);
  });

  /** Zero is always inside the range, so the threshold is always drawable. */
  it('draws the break-even threshold even when nothing reaches it', () => {
    const svg = cumulativeCashFlowChart(build(3), palette);
    expect(svg).toContain('Breaks even');
  });

  it('draws nothing for a single property', () => {
    expect(cumulativeCashFlowChart(single(), palette)).toBe('');
  });
});
