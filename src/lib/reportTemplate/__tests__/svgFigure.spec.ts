import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { paintSvgFigure, svgColor } from '../blocks/svgFigure';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import {
  vizDirectiveRenderer, planningChartContext,
} from '../../../../supabase/functions/_shared/reports/vizFigures.pure';
import { markdownBlockToItems } from '../blocks/markdownItems';

const doc = () => new jsPDF({ unit: 'pt', format: 'a4' });

const svgFor = (directive: string): string => {
  const blocks = renderMarkdown(directive, {
    renderDirective: vizDirectiveRenderer(planningChartContext()),
  }).blocks;
  for (const b of blocks) {
    for (const item of markdownBlockToItems(b)) if (item.kind === 'figure') return item.svg;
  }
  return '';
};

/** Ops the painter emitted, read off the uncompressed content stream. */
const opsOf = (d: jsPDF): string => d.output();

describe('svgColor', () => {
  it('reads hex, shorthand, rgb() and the keywords the planning context uses', () => {
    expect(svgColor('#BF9B50')).toEqual({ r: 191, g: 155, b: 80 });
    expect(svgColor('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(svgColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(svgColor('darkgoldenrod')).toEqual({ r: 184, g: 134, b: 11 });
  });

  it('answers null for the absences, so a caller can tell them from black', () => {
    for (const v of ['', 'none', 'transparent', 'currentColor', undefined, null]) {
      expect(svgColor(v)).toBeNull();
    }
  });
});

describe('paintSvgFigure', () => {
  /**
   * Without a viewBox there is no mapping from the SVG's coordinates to the
   * page, and a guess misplaces every mark. Drawing nothing is the honest
   * answer.
   */
  it('draws nothing when the SVG carries no viewBox', () => {
    const d = doc();
    const before = opsOf(d).length;
    const result = paintSvgFigure(d, '<svg><rect x="0" y="0" width="10" height="10"/></svg>',
      { x: 40, y: 40, width: 400 });
    expect(result.height).toBe(0);
    expect(opsOf(d).length).toBe(before);
  });

  it('derives the height from the viewBox aspect, so a chart is never distorted', () => {
    const svg = '<svg viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="100" fill="#000"/></svg>';
    expect(paintSvgFigure(doc(), svg, { x: 0, y: 0, width: 400 }).height).toBe(200);
    expect(paintSvgFigure(doc(), svg, { x: 0, y: 0, width: 100 }).height).toBe(50);
  });

  it('maps the viewBox onto the box it is given', () => {
    const d = doc();
    // A 10×10 square at the viewBox origin, drawn into a 100pt box at (50, 60).
    const sheetHeight = d.internal.pageSize.getHeight();
    paintSvgFigure(d, '<svg viewBox="0 0 100 100"><rect x="0" y="0" width="10" height="10" fill="#000000"/></svg>',
      { x: 50, y: 60, width: 100 });
    // jsPDF writes `x y w h re` with y measured from the foot of the sheet.
    const re = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/.exec(opsOf(d));
    expect(re).not.toBeNull();
    const [x, y, w] = (re ?? []).slice(1).map(Number);
    expect(x).toBeCloseTo(50, 3);
    expect(sheetHeight - y).toBeCloseTo(60, 3);   // the box's own top edge
    expect(w).toBeCloseTo(10, 3);         // 10/100 of a 100pt box
  });

  it('counts what the vocabulary does not cover rather than guessing at it', () => {
    const result = paintSvgFigure(doc(),
      '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/><foreignObject/></svg>',
      { x: 0, y: 0, width: 100 });
    expect(result.skipped).toBe(1);
  });

  describe('over the charts this product actually draws', () => {
    /**
     * Every directive kind that appears in the corpus, drawn through the real
     * chart renderer. A kind whose SVG the painter could not read would draw a
     * blank where a client expects a chart.
     */
    const KINDS: Array<[string, string]> = [
      ['bars', '{{bars: Transport 80, Schools 70, Retail 55}}'],
      ['donut', '{{donut: Health 20, Trades 18, Other 62 | title=Mix}}'],
      ['gauge', '{{gauge: 72 | Transport | Rail access is strong}}'],
      ['heatmap', '{{heatmap: -26, -9 / -13, +4 | rows=IO,P&I | cols=$600k,$400k}}'],
      ['pictograph', '{{pictograph: 1/10 | label=Role | icon=house | cols=10}}'],
      ['quadrant', '{{quadrant: 10.2,4 "This property", 4.5,4 "NSW median" | xlabel=Yield | ylabel=Growth}}'],
      ['tiles', '{{tiles: Economic Moderate int=0.8, Tenant Moderate int=0.7}}'],
      ['timeline', '{{timeline: Existing "Stage 1 complete", 0-2y "Stage 2"}}'],
      ['wheel', '{{wheel: 3,6,5 | labels=Zoning,Infrastructure,Car reliance | max=10}}'],
    ];

    it.each(KINDS)('draws a %s without meeting an element it cannot read', (_kind, directive) => {
      const svg = svgFor(directive);
      expect(svg).toMatch(/^<svg\b/);
      const d = doc();
      const before = opsOf(d).length;
      const result = paintSvgFigure(d, svg, { x: 57, y: 200, width: 481 });
      expect(result.skipped).toBe(0);
      expect(result.height).toBeGreaterThan(0);
      // Something was actually put on the page.
      expect(opsOf(d).length).toBeGreaterThan(before);
    });

    /**
     * A donut and a gauge are arcs. `A` is the one path command that cannot be
     * approximated by a line, so an arc converter that silently produced
     * nothing would draw a legend beside an empty ring.
     */
    it('turns an elliptical arc into curves rather than dropping it', () => {
      const d = doc();
      paintSvgFigure(d, svgFor('{{donut: Health 20, Trades 18, Other 62}}'),
        { x: 57, y: 200, width: 481 });
      // `c` is the PDF curve operator; an arc that drew as nothing emits none.
      expect(opsOf(d)).toMatch(/\bc\b/);
    });
  });
});
