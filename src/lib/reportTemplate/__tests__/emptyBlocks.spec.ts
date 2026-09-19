/**
 * A block with nothing to say draws nothing.
 *
 * RS-3 (14 Sep 2026) measured the three active Investment Compass structures
 * against a record with no financials, and every one of these was on the
 * page: an acquisition table with its labels and its "basis" column filled
 * around empty amounts; a ten-year equity chart of an empty series, drawn as
 * a `$1 / $0 / $-1` axis; a verdict band of four em dashes; an assessment
 * table's column head over no rows; and a RECOMMENDATION eyebrow with no
 * headline and no sentence under it. Each is a frame around an absence, and
 * a client cannot tell a frame around an absence from a page that failed to
 * render.
 *
 * The rule is the report rules' own — where a value does not exist, omit the
 * element rather than draw its frame — applied at the renderer, once, for
 * every template that binds the block. Static content is always kept: an
 * author who typed a row, a value or a heading said what they meant.
 */
import { describe, expect, it } from 'vitest';
import type { Block } from '../templateSchema';
import type { HtmlBlockContext } from '../blocks/_shared.html';
import { renderDataTableHtml } from '../blocks/dataTable.html';
import { renderKpiGridHtml } from '../blocks/kpiGrid.html';
import { renderTextBlockHtml } from '../blocks/textBlock.html';
import { renderRiskRegisterHtml } from '../blocks/riskRegister.html';
import { renderDecisionBoxHtml } from '../blocks/decisionBox.html';
import { renderChartHtml } from '../blocks/chart.html';
import {
  renderBarChartHtml,
  renderLineChartHtml,
  renderPieChartHtml,
  renderStackedBarChartHtml,
} from '../blocks/charts.html';
import { renderSparklineHtml } from '../blocks/extras.html';
import { rowsWithSomethingToSay } from '../blocks/_data';

const TOKENS = {
  colors: { ink: '#1A1A1A', text: '#1A1A1A', muted: '#666666', border: '#E2E2E2', primary: '#BF9B50', bg: '#F4F0E6', line: '#DDD1C0', negative: '#B91C1C' },
  fonts: {},
  spacing: {},
} as never;

const ctx = (data: Record<string, unknown> = {}): HtmlBlockContext => ({
  data,
  tokens: TOKENS,
  page: { width: 595, height: 842 },
  pageIndex: 0,
  pages: [],
  slots: {},
} as never);

const block = (type: string, props: Record<string, unknown>): Block =>
  ({ id: `b-${type}`, type, props, overlays: [] } as never);

describe('data-table', () => {
  const acquisition = block('data-table', {
    headers: ['Acquisition', 'Amount', 'Basis'],
    rows: [
      { cells: ['Purchase price', '{{financials.purchasePrice | currency}}', 'Contract'] },
      { cells: ['Stamp duty', '{{financials.stampDuty | currency}}', 'State schedule'] },
      { cells: ['LVR at settlement', '{{financials.lvr | percent:0}}', 'Loan over price'] },
    ],
    x: 40, y: 100, width: 500,
  });

  it('draws nothing when every bound row received nothing', () => {
    expect(renderDataTableHtml(acquisition, ctx({}))).toBe('');
    expect(renderDataTableHtml(acquisition, ctx({ financials: null }))).toBe('');
  });

  it('drops only the rows with nothing in them, and keeps the rest', () => {
    const html = renderDataTableHtml(acquisition, ctx({ financials: { purchasePrice: 555000, lvr: 80 } }));
    expect(html).toContain('Purchase price');
    expect(html).toContain('555,000');
    expect(html).toContain('LVR at settlement');
    expect(html).toContain('80%');
    // The label and the basis of a figure the record does not hold are not
    // printed beside an empty cell.
    expect(html).not.toContain('Stamp duty');
    expect(html).not.toContain('State schedule');
  });

  it('keeps a genuine zero — a zero is a figure', () => {
    const html = renderDataTableHtml(acquisition, ctx({ financials: { purchasePrice: 555000, stampDuty: 0 } }));
    expect(html).toContain('Stamp duty');
    expect(html).toContain('$0');
  });

  it('leaves a wholly static table exactly as authored', () => {
    const table = block('data-table', {
      headers: ['Step', 'Who'],
      rows: [{ cells: ['Exchange', 'Solicitor'] }, { cells: ['Settlement', 'Lender'] }],
    });
    const html = renderDataTableHtml(table, ctx({}));
    expect(html).toContain('Exchange');
    expect(html).toContain('Settlement');
  });

  it('keeps a static band row when the bound rows around it survive, and drops it with them', () => {
    const banded = block('data-table', {
      headers: ['Item', 'Amount'],
      sectionRows: [0],
      rows: [
        { cells: ['CASH FLOW'] },
        { cells: ['Rental income', '{{financials.weeklyRent | currency}}'] },
      ],
    });
    expect(renderDataTableHtml(banded, ctx({ financials: { weeklyRent: 445 } }))).toContain('CASH FLOW');
    expect(renderDataTableHtml(banded, ctx({}))).toBe('');
  });

  it('the shared row rule says the same thing the renderer does', () => {
    const rows = (acquisition.props as { rows: Array<{ cells: string[] }> }).rows;
    const nothing = rowsWithSomethingToSay(rows as never, ctx({}) as never);
    expect(nothing.rows).toEqual([]);
    expect(nothing.saysSomething).toBe(false);
    // One survivor of a table built for three is a line, not the table.
    const lone = rowsWithSomethingToSay(rows as never, ctx({ financials: { lvr: 80 } }) as never);
    expect(lone.rows.map((r) => r.index)).toEqual([2]);
    expect(lone.saysSomething).toBe(false);
    const some = rowsWithSomethingToSay(rows as never, ctx({ financials: { lvr: 80, purchasePrice: 555000 } }) as never);
    expect(some.rows.map((r) => r.index)).toEqual([0, 2]);
    expect(some.saysSomething).toBe(true);
  });

  it('a lone surviving row of a table built for many draws nothing — and a table built for one keeps it', () => {
    expect(renderDataTableHtml(acquisition, ctx({ financials: { lvr: 80 } }))).toBe('');
    const single = block('data-table', { headers: ['Item', 'Amount'], rows: [{ cells: ['LVR', '{{financials.lvr | percent:0}}'] }] });
    expect(renderDataTableHtml(single, ctx({ financials: { lvr: 80 } }))).toContain('80%');
  });

  it('counts a row hidden by its own `when` as a row that said nothing', () => {
    // The Dictionary structure's property table: every attribute row is gated
    // on its own fact, so on a sparse record the `when` filter leaves the
    // address alone — one line, on a page that was otherwise white.
    const property = block('data-table', {
      headers: ['Property', 'Detail'],
      rows: [
        { cells: ['Address', '{{property.address}}'] },
        { cells: ['Type', '{{property.type}}'], when: 'property.type' },
        { cells: ['Bedrooms', '{{property.bedrooms}}'], when: 'property.bedrooms' },
        { cells: ['Land', '{{property.landArea}}'], when: 'property.landArea' },
      ],
      x: 40, y: 100, width: 500,
    });
    expect(renderDataTableHtml(property, ctx({ property: { address: '48 Redfern Street' } }))).toBe('');
    const drawn = renderDataTableHtml(property, ctx({ property: { address: '48 Redfern Street', type: 'House', landArea: '988 m²' } }));
    expect(drawn).toContain('48 Redfern Street');
    expect(drawn).toContain('House');
    expect(drawn).not.toContain('Bedrooms');
  });
});

describe('charts', () => {
  const projection = block('chart-line', {
    dataPath: 'projection.equity', title: 'Projected equity position', axis: 'money',
    x: 40, y: 100, width: 500, height: 180,
  });

  it('draws nothing for a series the record does not hold', () => {
    expect(renderLineChartHtml(projection, ctx({}))).toBe('');
    expect(renderLineChartHtml(projection, ctx({ projection: { equity: [] } }))).toBe('');
  });

  it('draws nothing for a series whose every value is absent — absent is never zero', () => {
    const data = { projection: { equity: [{ label: 'Yr 1', value: null }, { label: 'Yr 2', value: undefined }, { label: 'Yr 3', value: '' }] } };
    expect(renderLineChartHtml(projection, ctx(data))).toBe('');
  });

  it('draws a series that is there, zeros included', () => {
    const data = { projection: { equity: [{ label: 'Yr 1', value: 0 }, { label: 'Yr 2', value: 45000 }] } };
    const html = renderLineChartHtml(projection, ctx(data));
    expect(html).toContain('<svg');
    expect(html).toContain('Projected equity position');
  });

  it('every series chart answers the same way', () => {
    for (const render of [renderBarChartHtml, renderPieChartHtml]) {
      expect(render(block('chart-bar', { dataPath: 'nothing.here' }), ctx({}))).toBe('');
    }
    expect(renderStackedBarChartHtml(block('chart-stacked-bar', { dataPath: 'nothing.here', stackKeys: ['a'] }), ctx({}))).toBe('');
    expect(renderSparklineHtml(block('sparkline', { dataPath: 'nothing.here' }), ctx({}))).toBe('');
  });

  it('an image chart with no image is omitted rather than labelled unavailable', () => {
    const html = renderChartHtml(block('chart', { chartUrl: '{{charts.growth}}', caption: 'Growth' }), ctx({}));
    expect(html).toBe('');
    expect(html).not.toContain('unavailable');
  });
});

describe('kpi-grid', () => {
  const band = (variant?: string) => block('kpi-grid', {
    variant,
    columns: 4,
    items: [
      { label: 'Purchase price', value: '{{financials.purchasePrice | currency}}', note: 'Contract, before costs' },
      { label: 'Weekly rent', value: '{{financials.weeklyRent | currency}}', note: 'p.a.' },
      { label: 'Gross yield', value: '{{financials.grossYield}}', note: 'On the purchase price' },
      { label: 'Weekly position', value: '{{financials.weeklyPosition}}', note: 'p.a., before tax' },
    ],
    x: 40, y: 100, width: 500,
  });

  it.each(['tile', 'ruled', 'display', 'rows', 'stacked'])('%s: draws nothing when every value is absent', (variant) => {
    expect(renderKpiGridHtml(band(variant), ctx({}))).toBe('');
  });

  it.each(['tile', 'ruled', 'rows', 'stacked'])('%s: closes up around the figures the record holds', (variant) => {
    const html = renderKpiGridHtml(band(variant), ctx({ financials: { purchasePrice: 555000, weeklyRent: 445 } }));
    expect(html).toContain('555,000');
    expect(html).toContain('$445');
    expect(html).not.toContain('—');
    expect(html).not.toContain('Gross yield');
    expect(html).not.toContain('Weekly position');
  });

  it('keeps a static value as authored', () => {
    const html = renderKpiGridHtml(block('kpi-grid', { items: [{ label: 'Basis', value: 'Contract' }] }), ctx({}));
    expect(html).toContain('Contract');
  });

  it('sets a sentence in a value slot as prose, not as a 20pt figure', () => {
    const sentence = 'An overall investment grade is only issued when sufficient verified property evidence is available.';
    for (const variant of ['tile', 'ruled']) {
      const html = renderKpiGridHtml(block('kpi-grid', {
        variant, columns: 4,
        items: [{ label: 'Verdict', value: '{{recommendation.gradedLine}}' }, { label: 'Weekly position', value: '{{financials.weeklyPosition}}' }],
      }), ctx({ recommendation: { gradedLine: sentence }, financials: { weeklyPosition: '−$450' } }));
      expect(html).toContain(sentence);
      const verdictStyle = html.slice(html.indexOf('An overall') - 220, html.indexOf('An overall'));
      expect(verdictStyle).toMatch(/line-height:1\.4/);
      expect(verdictStyle).not.toMatch(/font-size:2\d/);
      // The figure beside it is still a figure.
      const figureStyle = html.slice(html.indexOf('−$450') - 220, html.indexOf('−$450'));
      expect(figureStyle).toMatch(/font-size:(1[6-9]|2\d)/);
    }
  });
});

describe('text-block', () => {
  it('draws nothing when its bound heading and body received nothing — an eyebrow over nothing', () => {
    const recommendation = block('text-block', {
      eyebrow: 'Recommendation', heading: '{{recommendation.headline}}', body: '{{recommendation.gradedDetailLine}}',
      x: 40, y: 360, width: 500,
    });
    expect(renderTextBlockHtml(recommendation, ctx({}))).toBe('');
    expect(renderTextBlockHtml(recommendation, ctx({ recommendation: { headline: '', gradedDetailLine: null } }))).toBe('');
  });

  it('draws the block when either bound part resolved', () => {
    const recommendation = block('text-block', {
      eyebrow: 'Recommendation', heading: '{{recommendation.headline}}', body: '{{recommendation.gradedDetailLine}}',
    });
    const html = renderTextBlockHtml(recommendation, ctx({ recommendation: { headline: 'Proceed with caution' } }));
    expect(html).toContain('Recommendation');
    expect(html).toContain('Proceed with caution');
  });

  it('keeps a static heading over a bound body that received nothing', () => {
    const opener = block('text-block', { eyebrow: 'Projections', heading: 'Equity and value over ten years', body: '{{narrative.lead}}' });
    const html = renderTextBlockHtml(opener, ctx({}));
    expect(html).toContain('Equity and value over ten years');
  });

  it('keeps a running head — a bound body that resolved', () => {
    const head = block('text-block', { body: '{{report.documentTitle}} · {{property.address}}', bodySize: 6.25 });
    const html = renderTextBlockHtml(head, ctx({ report: { documentTitle: 'Investment Compass' }, property: { address: '48 Redfern Street' } }));
    expect(html).toContain('Investment Compass · 48 Redfern Street');
  });

  it('leaves a wholly static block alone', () => {
    const html = renderTextBlockHtml(block('text-block', { eyebrow: 'Part 01', heading: 'Contents' }), ctx({}));
    expect(html).toContain('Contents');
  });
});

describe('risk-register', () => {
  const register = (display?: string) => block('risk-register', {
    display, title: 'Hazard · rating · verification',
    items: [{ risk: '{{risks.0.risk}}', rating: 'Noted', confidence: 'Indicative', why: '{{assessment.4.details}}', ddAction: 'Verify before exchange' }],
  });

  it.each(['table', 'bars'])('%s: draws nothing when no hazard is named', (display) => {
    expect(renderRiskRegisterHtml(register(display), ctx({}))).toBe('');
  });

  it('draws the hazards the record names', () => {
    const html = renderRiskRegisterHtml(register('table'), ctx({ risks: [{ risk: 'Bushfire exposure' }] }));
    expect(html).toContain('Bushfire exposure');
  });
});

describe('decision-box', () => {
  const box = block('decision-box', { heading: '{{recommendation.headline}}', body: '{{recommendation.gradedDetailLine}}', x: 40, y: 300, width: 500 });

  it('draws nothing when the recommendation it frames is absent', () => {
    expect(renderDecisionBoxHtml(box, ctx({}))).toBe('');
  });

  it('draws the recommendation when there is one', () => {
    const html = renderDecisionBoxHtml(box, ctx({ recommendation: { headline: 'Proceed with caution', gradedDetailLine: 'Verify the title first.' } }));
    expect(html).toContain('Proceed with caution');
    expect(html).toContain('Verify the title first.');
  });

  it('keeps an author\'s static heading', () => {
    const html = renderDecisionBoxHtml(block('decision-box', { heading: 'What this means', body: '{{recommendation.gradedDetailLine}}' }), ctx({}));
    expect(html).toContain('What this means');
  });
});
