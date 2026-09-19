import { describe, expect, it } from 'vitest';
import {
  BLOCK_RENDERERS,
  HTML_FIRST_BLOCK_TYPES,
  getBlockRendererCapabilities,
} from '../blocks';
import { drawDefinitionListBlock } from '../blocks/definitionList';
import { drawChartLineBlock } from '../blocks/chartLine';

/** A jsPDF stand-in that records what was drawn rather than drawing it. */
function recorder() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const rec = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); };
  const doc = {
    calls,
    text: rec('text'), line: rec('line'), circle: rec('circle'),
    rect: rec('rect'), roundedRect: rec('roundedRect'),
    setFont: rec('setFont'), setFontSize: rec('setFontSize'),
    setTextColor: rec('setTextColor'), setDrawColor: rec('setDrawColor'),
    setFillColor: rec('setFillColor'), setLineWidth: rec('setLineWidth'),
    setLineDashPattern: rec('setLineDashPattern'),
    splitTextToSize: (t: string, w: number) => {
      // ~5.2pt per char at the sizes these blocks use; enough to exercise wrap.
      const per = Math.max(1, Math.floor(w / 5.2));
      const out: string[] = [];
      for (let i = 0; i < t.length; i += per) out.push(t.slice(i, i + per));
      return out.length ? out : [''];
    },
  };
  const texts = () => calls.filter((c) => c.fn === 'text').flatMap((c) => {
    const a = c.args[0];
    return Array.isArray(a) ? a.map(String) : [String(a)];
  });
  return { doc, calls, texts };
}

/** `ResolveContext` requires `tokens`; every real render supplies them. */
const TOKENS = {
  colors: {
    foreground: '#1A1A1A', muted: '#666666', border: '#E2E2E2', primary: '#BF9B50',
  },
  fonts: {},
  spacing: {},
} as never;

const ctx = (data: Record<string, unknown> = {}) => {
  const r = recorder();
  return {
    r,
    ctx: {
      doc: r.doc as never,
      page: { width: 595, height: 842 },
      data,
      tokens: TOKENS,
    } as never,
  };
};

describe('RC-3.2 — the browser can draw what active templates use', () => {
  it('definition-list and chart-line are no longer placeholders', () => {
    expect(BLOCK_RENDERERS['definition-list']).toBe(drawDefinitionListBlock);
    expect(BLOCK_RENDERERS['chart-line']).toBe(drawChartLineBlock);
    // And they are out of the html-first set, so capability reports and the
    // production guard both see them as fully drawable.
    expect(HTML_FIRST_BLOCK_TYPES.has('definition-list')).toBe(false);
    expect(HTML_FIRST_BLOCK_TYPES.has('chart-line')).toBe(false);
    expect(getBlockRendererCapabilities('definition-list').jspdf).toBe('full');
    expect(getBlockRendererCapabilities('chart-line').jspdf).toBe('full');
  });
});

describe('definition-list', () => {
  it('draws every term and its definition', () => {
    const { r, ctx: c } = ctx();
    drawDefinitionListBlock({
      id: 'b', type: 'definition-list',
      props: {
        x: 24, y: 80, width: 547, title: 'Key terms',
        items: [
          { term: 'LVR', definition: 'Loan to Value Ratio.' },
          { term: 'LMI', definition: 'Lenders Mortgage Insurance.' },
        ],
      },
    } as never, c);

    const all = r.texts().join(' ');
    expect(all).toContain('Key terms');
    expect(all).toContain('LVR');
    expect(all).toContain('LMI');
    expect(all).toMatch(/Loan to Value/);
  });

  it('draws NOTHING for an empty list — never a placeholder panel', () => {
    const { r, ctx: c } = ctx();
    drawDefinitionListBlock({
      id: 'b', type: 'definition-list', props: { items: [] },
    } as never, c);
    expect(r.texts()).toEqual([]);
    expect(r.calls.some((x) => x.fn === 'roundedRect')).toBe(false);
  });

  it('accepts the aliases the HTML twin tolerates', () => {
    const { r, ctx: c } = ctx();
    drawDefinitionListBlock({
      id: 'b', type: 'definition-list',
      props: { items: [{ label: 'CGT', value: 'Capital Gains Tax.' }] },
    } as never, c);
    const all = r.texts().join(' ');
    expect(all).toContain('CGT');
    expect(all).toContain('Capital Gains Tax.');
  });
});

describe('chart-line', () => {
  const series = [
    { label: '2026', value: 620_000 },
    { label: '2030', value: 845_000 },
    { label: '2035', value: 1_100_000 },
  ];

  it('plots the series and LABELS the axis', () => {
    const { r, ctx: c } = ctx({ chartData: series });
    drawChartLineBlock({
      id: 'b', type: 'chart-line',
      props: { x: 24, y: 80, width: 547, height: 240, dataPath: 'chartData', title: 'Equity' },
    } as never, c);

    // A segment per gap, a marker per point.
    expect(r.calls.filter((x) => x.fn === 'circle')).toHaveLength(3);
    const all = r.texts().join(' ');
    expect(all).toContain('Equity');
    // The ends of the x axis are named...
    expect(all).toContain('2026');
    expect(all).toContain('2035');
    // ...and every gridline carries a value, which is the defect its HTML twin
    // was built to fix: a reader must be able to tell 1.1M from 100k.
    expect(all).toMatch(/1\.1M|1M/);
  });

  it('says so plainly when there is no data, in words meant for a client', () => {
    const { r, ctx: c } = ctx({ chartData: [] });
    drawChartLineBlock({
      id: 'b', type: 'chart-line', props: { dataPath: 'chartData' },
    } as never, c);
    const all = r.texts().join(' ');
    expect(all).toMatch(/no data available/i);
    // Never the operator-facing placeholder sentence.
    expect(all).not.toMatch(/pipeline|export via|jsPDF|HTML/i);
  });

  it('does not divide by zero on a flat series', () => {
    const { r, ctx: c } = ctx({ chartData: [{ label: 'a', value: 5 }, { label: 'b', value: 5 }] });
    expect(() => drawChartLineBlock({
      id: 'b', type: 'chart-line', props: { dataPath: 'chartData' },
    } as never, c)).not.toThrow();
    expect(r.calls.filter((x) => x.fn === 'circle')).toHaveLength(2);
  });

  it('reads a bare number series the way the HTML renderer does', () => {
    const { r, ctx: c } = ctx({ chartData: [10, 20, 30] });
    drawChartLineBlock({
      id: 'b', type: 'chart-line', props: { dataPath: 'chartData' },
    } as never, c);
    expect(r.calls.filter((x) => x.fn === 'circle')).toHaveLength(3);
    expect(r.texts().join(' ')).toContain('1');
  });
});
