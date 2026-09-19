/**
 * A template's charts are drawn in the template's own ink.
 *
 * The chart block's titles, tick labels, captions and grid rules were literal
 * light-page colours (`#1A1A1A`, `#666`, `#EAE3CB`), so on the Midnight
 * structure every chart title and axis figure printed near-black on an
 * obsidian ground — "Projected equity position" and its `Equity` axis title
 * read as illegible on the long reference report (RS-3, 14 Sep 2026).
 */
import { describe, expect, it } from 'vitest';
import { renderLineChartHtml, renderBarChartHtml } from '../blocks/charts.html';

const block = (type: string, props: Record<string, unknown>) => ({ id: 'c', type, props: { x: 40, y: 100, width: 459, height: 200, ...props } });
const ctx = (colors: Record<string, string>) => ({
  data: { projection: { equity: [{ label: 'Yr 1', value: 1000 }, { label: 'Yr 2', value: 2200 }] } },
  tokens: { colors, fonts: {}, spacing: {} },
  page: { width: 595, height: 842 },
  pageIndex: 0, pages: [], slots: {},
}) as never;

const MIDNIGHT = { ink: '#F1EEE8', muted: '#9C99A4', line: '#2E2E38', primary: '#C9A227', onPrimary: '#14141A', text: '#F1EEE8', surface: '#14141A' };

describe('chart furniture takes the template ink', () => {
  it('a line chart on a dark structure draws its title, ticks, axis title and grid in the template tokens', () => {
    const html = renderLineChartHtml(block('chart-line', { dataPath: 'projection.equity', title: 'Projected equity position', axisTitle: 'Equity' }) as never, ctx(MIDNIGHT));
    expect(html).toContain('color:#F1EEE8');
    expect(html).toContain('fill="#9C99A4"');
    expect(html).toContain('stroke="#2E2E38"');
    expect(html).not.toContain('#1A1A1A');
    expect(html).not.toContain('fill="#666');
    expect(html).not.toContain('#EAE3CB');
  });

  it('a template without the tokens draws exactly the light-page ink it always did', () => {
    const html = renderBarChartHtml(block('chart-bar', { dataPath: 'projection.equity', title: 'Equity' }) as never, ctx({}));
    expect(html).toContain('#1A1A1A');
    expect(html).toContain('#666666');
  });
});

describe('chart text is sized by presentation attribute, which is what the engine reads', () => {
  // WeasyPrint ignores `style="font-size:…"` on SVG text: measured with the
  // pinned engine (RS-4, 14 Sep 2026), a 6.5pt style set at the inherited
  // 9.5pt while a `font-size="6.5"` attribute set at 6.5pt. Every tick label
  // of every chart block was therefore a body-size figure crowding its axis.
  it('every <text> carries font-size and fill as attributes and no style attribute', () => {
    const html = renderLineChartHtml(block('chart-line', { dataPath: 'projection.equity', title: 'Projected equity position', yAxisLabel: 'Equity' }) as never, ctx(MIDNIGHT));
    const texts = html.match(/<text[^>]*>/g) ?? [];
    expect(texts.length).toBeGreaterThan(3);
    for (const t of texts) {
      expect(t).toMatch(/ font-size="[\d.]+"/);
      expect(t).toMatch(/ fill="#[0-9A-Fa-f]{6}"/);
      expect(t).not.toContain('style=');
    }
    // The axis title asked for uppercase through CSS the engine does not read; the string is uppercased.
    expect(html).toContain('>EQUITY</text>');
  });
});
