/**
 * A chart of market figures is a claim, and the record has to hold it.
 *
 * The case is verbatim from 18 Annabelle Crescent's stored report: two
 * unsourced growth rates three lines apart, and a five-point sparkline whose
 * first three values are those two ranges' endpoints and whose last two appear
 * nowhere at all.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  suppressUnevidencedMarketSeries,
  type MarketFactRow,
  type MarketFacts,
} from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';

const row = (key: MarketFactRow['key'], label: string, value: string): MarketFactRow => ({
  key, label, value,
  describes: 'postcode 2155, NSW — houses, 162 sales, 2026-03-31',
  publisher: 'NSW Department of Communities and Justice — Rent and Sales Report',
  note: null, benchmark: false,
});

const facts = (rows: MarketFactRow[]): MarketFacts => ({
  rows, withheld: [], unavailable: [], consulted: ['nsw_dcj_rent_sales'],
  anyStated: rows.length > 0, evidenceMissing: false,
});

const KELLYVILLE = facts([
  row('medianPrice', 'Median sale price', '$1,808,000'),
  row('growth1Year', 'Price growth, 1 year', '6.3%'),
  row('growth3YearCagr', 'Price growth, 3 years (compound annual)', '4.4%'),
  row('growth5YearCagr', 'Price growth, 5 years (compound annual)', '6.2%'),
  row('salesCount', 'Sales in the period', '162'),
]);

const REPORTED = '{{margin: Kellyville house value momentum | spark=9.6,7.1,5.9,4.8,3.5 '
  + '| note=Long-run growth strong, recent growth moderating from high levels. | label=Growth profile}}';

describe('the reported defect', () => {
  it('removes the sparkline of five growth rates the record does not hold', () => {
    const out = suppressUnevidencedMarketSeries(`Before.\n${REPORTED}\nAfter.`, KELLYVILLE);
    expect(out.markdown).not.toContain('spark=');
    expect(out.markdown).toContain('Before.');
    expect(out.markdown).toContain('After.');
    expect(out.removed).toHaveLength(1);
    expect(out.removed[0].kind).toBe('margin');
    expect(out.removed[0].values).toEqual([9.6, 7.1, 5.9, 4.8, 3.5]);
  });

  it('names the words that made it a market chart', () => {
    const [removed] = suppressUnevidencedMarketSeries(REPORTED, KELLYVILLE).removed;
    expect(removed.matchedOn).toContain('growth');
    expect(removed.matchedOn).toContain('value');
  });

  it('removes it on an empty table too — no figures is not permission', () => {
    const empty: MarketFacts = { ...facts([]), evidenceMissing: true };
    expect(suppressUnevidencedMarketSeries(REPORTED, empty).removed).toHaveLength(1);
  });
});

describe('what it keeps', () => {
  it('keeps a growth chart whose values the table states', () => {
    const good = '{{bars: Price growth by horizon | 6.3, 4.4, 6.2 | labels=1y,3y,5y}}';
    const out = suppressUnevidencedMarketSeries(good, KELLYVILLE);
    expect(out.removed).toHaveLength(0);
    expect(out.markdown).toBe(good);
  });

  it('keeps a median drawn at a chart’s scale', () => {
    for (const drawn of ['1808000', '1808', '1.8']) {
      const line = `{{bars: Median sale price | ${drawn}}}`;
      expect(suppressUnevidencedMarketSeries(line, KELLYVILLE).removed, drawn).toHaveLength(0);
    }
  });

  it('leaves a chart that is not about the market alone', () => {
    for (const line of [
      '{{bars: Amenities within 5 km | 10, 10, 4, 7}}',
      '{{bars: SEIFA indices | 1146, 1100, 1148, 1112 | labels=IRSAD,IRSD,IER,IEO}}',
      '{{glance: ✓ Established family location | ◆ Active development pipeline}}',
    ]) {
      expect(suppressUnevidencedMarketSeries(line, KELLYVILLE).removed, line).toHaveLength(0);
    }
  });

  it('reads the series options and never a digit in prose', () => {
    // 2026 and 5 are in the note, not the series; the series itself is sound.
    const line = '{{margin: Median sale price | values=1808000 | note=As at the March 2026 quarter, 5 periods}}';
    expect(suppressUnevidencedMarketSeries(line, KELLYVILLE).removed).toHaveLength(0);
  });

  it('leaves a market chart with no readable series — malformed is not untrue', () => {
    const line = '{{margin: Price growth profile | note=Growth has moderated}}';
    const out = suppressUnevidencedMarketSeries(line, KELLYVILLE);
    expect(out.removed).toHaveLength(0);
    expect(out.markdown).toBe(line);
  });

  it('leaves ordinary prose alone, including a line that mentions growth', () => {
    const prose = 'Measured growth over five years is 6.2% a year, and 9.6% appears nowhere in the record.';
    expect(suppressUnevidencedMarketSeries(prose, KELLYVILLE).markdown).toBe(prose);
  });
});

describe('something calls it', () => {
  it('the generator runs it beside the verdict-visual guard', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
      'utf8',
    );
    expect(src).toContain('suppressUnevidencedMarketSeries(reportContent, marketFacts)');
  });
});
