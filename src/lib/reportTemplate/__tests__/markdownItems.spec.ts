import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import {
  vizDirectiveRenderer, planningChartContext,
} from '../../../../supabase/functions/_shared/reports/vizFigures.pure';
import { decodeEntities, markdownBlockToItems, type MarkdownItem } from '../blocks/markdownItems';

const render = (src: string) => renderMarkdown(src, {
  renderDirective: vizDirectiveRenderer(planningChartContext()),
});

const itemsOf = (src: string): MarkdownItem[] =>
  render(src).blocks.flatMap((b) => markdownBlockToItems(b));

const plain = (runs: readonly { text: string }[]) => runs.map((r) => r.text).join('');

describe('markdownItems — reading our own emitter', () => {
  it('reads every heading level the renderer emits', () => {
    const items = itemsOf('# One\n\ntext\n\n## Two\n\ntext\n\n### Three\n\ntext\n');
    const headings = items.filter((i) => i.kind === 'heading');
    expect(headings.map((h) => (h.kind === 'heading' ? h.level : 0))).toEqual([2, 3, 4]);
  });

  it('keeps inline emphasis as styled runs, with the words either side intact', () => {
    const [para] = itemsOf('The town supports a **diversified** agricultural economy.');
    expect(para.kind).toBe('paragraph');
    if (para.kind !== 'paragraph') return;
    expect(plain(para.runs)).toBe('The town supports a diversified agricultural economy.');
    expect(para.runs.find((r) => r.bold)?.text).toBe('diversified');
  });

  it('numbers an ordered list and nests a bullet list', () => {
    const ordered = itemsOf('1. first\n2. second\n3. third\n')
      .filter((i) => i.kind === 'listItem');
    expect(ordered.map((i) => (i.kind === 'listItem' ? i.marker : ''))).toEqual(['1.', '2.', '3.']);

    const nested = itemsOf('- outer\n- second\n  - inner\n')
      .filter((i) => i.kind === 'listItem');
    expect(nested.map((i) => (i.kind === 'listItem' ? i.depth : -1))).toEqual([0, 0, 1]);
  });

  it('reads a blockquote as the callout the renderer turns it into', () => {
    const [callout] = itemsOf('> Independent valuation was not commissioned.');
    expect(callout.kind).toBe('callout');
    if (callout.kind !== 'callout') return;
    expect(callout.label).toBe('Note');
    expect(callout.items.map((i) => (i.kind === 'paragraph' ? plain(i.runs) : '')))
      .toContain('Independent valuation was not commissioned.');
  });

  /**
   * A table is taken from the renderer's own `cols`/`rows`, never from its
   * markup — and a row is a RECORD keyed by column. Reading it positionally
   * would transpose a table whose columns were reordered.
   */
  it('takes a table structurally, keyed by column', () => {
    const [table] = itemsOf(
      '| Metric | Value |\n| --- | --- |\n| Purchase price | $700,000 |\n',
    );
    expect(table.kind).toBe('table');
    if (table.kind !== 'table') return;
    expect(table.meta.cols.map((c) => c.label)).toEqual(['Metric', 'Value']);
    expect(table.meta.rows).toHaveLength(1);
    const [row] = table.meta.rows;
    expect(Object.values(row)).toContain('$700,000');
  });

  it('decodes a chart directive to the SVG the chart renderer drew', () => {
    const [figure] = itemsOf('{{bars: Transport 80, Schools 70}}');
    expect(figure.kind).toBe('figure');
    if (figure.kind !== 'figure') return;
    expect(figure.svg).toMatch(/^<svg\b/);
    expect(figure.svg).toContain('viewBox=');
    expect(figure.alt).toMatch(/transport/i);
  });

  /**
   * `compact` is the chart renderer's own decision, and drawing a gauge across
   * the full measure spends 136mm of a 253mm text block on one number.
   */
  it('carries the chart renderer’s compact decision', () => {
    const gauge = itemsOf('{{gauge: 72 | Transport | Rail access is strong}}')[0];
    const bars = itemsOf('{{bars: Transport 80, Schools 70}}')[0];
    expect(gauge.kind === 'figure' && gauge.compact).toBe(true);
    expect(bars.kind === 'figure' && bars.compact).toBe(false);
  });

  it('flattens a link to text, because the renderer already did', () => {
    const [para] = itemsOf('See [the source](https://example.com/data) for detail.');
    expect(para.kind).toBe('paragraph');
    if (para.kind !== 'paragraph') return;
    expect(plain(para.runs)).toContain('example.com/data');
    expect(plain(para.runs)).not.toContain('<a');
  });

  it('decodes the entities the escape-first renderer wrote', () => {
    expect(decodeEntities('Smith &amp; Co &lt;tag&gt; &#39;x&#39; &quot;y&quot;'))
      .toBe(`Smith & Co <tag> 'x' "y"`);
  });

  /**
   * The safety property this whole arrangement rests on: `renderMarkdown` is
   * escape-first, so markup in the source is already text by the time this
   * reads it. Nothing a model writes can become an element here.
   */
  it('cannot be made to produce markup from the source', () => {
    const items = itemsOf('A paragraph with <script>alert(1)</script> in it.');
    const text = items.map((i) => (i.kind === 'paragraph' ? plain(i.runs) : '')).join('');
    expect(text).toContain('<script>alert(1)</script>');
    expect(items.every((i) => i.kind !== 'figure' && i.kind !== 'table')).toBe(true);
  });
});
