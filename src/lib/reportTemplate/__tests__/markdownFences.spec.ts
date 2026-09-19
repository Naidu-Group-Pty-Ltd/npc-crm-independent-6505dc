/**
 * The fenced blocks the generator writes are drawn, never printed.
 *
 * The prompt asks the model for `::: pullquote`, `::: sidenote`, `::: stat`,
 * `::: divider` and `::: quote-page`; the flowing route draws all five and
 * this renderer drew none, so each printed raw in the client document —
 * `::: stat label="Mining share of workforce" unit="%" sub="ABS Census 2021,
 * POA" 41.2 :::` set as body copy on page 14 of the medium reference report
 * (RS-4, 14 Sep 2026).
 */
import { describe, expect, it } from 'vitest';
import { FENCE_KINDS, fenceAttrs, renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { renderMarkdownBlockHtml } from '../blocks/markdownBlock.html';
import type { NarrativeGeometry } from '../../../../supabase/functions/_shared/reports/narrativeGeometry.pure';

const G: NarrativeGeometry = { bodyPt: 9.5, lineHeight: 1.55, widthPt: 459, charsPerLine: 96, firstPageLines: 34, contLines: 40 };
const html = (source: string, geometry?: NarrativeGeometry) => renderMarkdown(source, { geometry }).blocks.map((b) => b.html).join('\n');

describe('fenceAttrs', () => {
  it('reads double-quoted, single-quoted and bare values, case-insensitively', () => {
    expect(fenceAttrs('label="Median yield" unit=% sub=\'ABS, 2021\' Eyebrow="Chapter 04"'))
      .toEqual({ label: 'Median yield', unit: '%', sub: 'ABS, 2021', eyebrow: 'Chapter 04' });
    expect(fenceAttrs('')).toEqual({});
  });
});

describe('the five kinds the prompt asks for', () => {
  it('names them', () => {
    expect([...FENCE_KINDS]).toEqual(['pullquote', 'quote-page', 'sidenote', 'stat', 'divider']);
  });

  it('a stat card carries its label, value, unit and caption, and no fence reaches the page', () => {
    const out = html('Before.\n\n::: stat label="Mining share of workforce" unit="%" sub="ABS Census 2021, POA"\n41.2\n:::\n\nAfter.');
    expect(out).not.toContain(':::');
    expect(out).toContain('<div class="stat-card">');
    expect(out).toContain('<span class="stat-label">Mining share of workforce</span>');
    expect(out).toContain('<div class="stat-value">41.2<span class="stat-unit">%</span></div>');
    expect(out).toContain('<span class="stat-sub">ABS Census 2021, POA</span>');
    expect(out).toContain('<p>Before.</p>');
    expect(out).toContain('<p>After.</p>');
  });

  it('a stat card with nothing to state is not drawn — not its unit, not its label', () => {
    const out = html('::: stat label="Nearest station access" unit="m" sub="From local transport references"\n\n:::\n\nAfter.');
    expect(out).not.toContain('stat-card');
    expect(out).not.toContain('Nearest station');
    expect(out).not.toContain(':::');
    expect(out).toContain('<p>After.</p>');
  });

  it('a pull quote and a quote page are one sentence behind a rule, with the attribution', () => {
    const quote = html('::: pullquote\nA weighted score of **78/100** places this property in the top quartile.\n:::');
    expect(quote.trim()).toBe('<blockquote class="pull-quote">A weighted score of 78/100 places this property in the top quartile.</blockquote>');
    const page = html('::: quote-page attribution="RBA Statement on Monetary Policy, May 2026" eyebrow="Market context"\n"Housing demand remains underpinned by population growth."\n:::');
    expect(page).toContain('<blockquote class="pull-quote">');
    expect(page).toContain('<cite>RBA Statement on Monetary Policy, May 2026</cite>');
    expect(page).not.toContain(':::');
  });

  it('a sidenote is the sidenote primitive, labelled', () => {
    const out = html('::: sidenote\nCouncil rezoning to MU3 was gazetted March 2026.\n:::');
    expect(out).toContain('<aside class="sidenote">');
    expect(out).toContain('<span class="sidenote-label">Note</span>');
    expect(out).toContain('Council rezoning to MU3 was gazetted March 2026.');
  });

  it('a divider states its stat and carries its headline; one with no stat is not drawn', () => {
    const out = html('::: divider stat="78" label="Composite investment score" eyebrow="Chapter 04 · Verdict"\nWhy this property earns a top-quartile rating.\n:::');
    expect(out).toContain('<div class="stat-card stat-divider">');
    expect(out).toContain('<span class="stat-label">Chapter 04 · Verdict</span>');
    expect(out).toContain('<div class="stat-value">78</div>');
    expect(out).toContain('<span class="stat-sub">Composite investment score</span>');
    expect(out).toContain('<p class="stat-headline">Why this property earns a top-quartile rating.</p>');
    expect(html('::: divider label="Score"\nHeadline.\n:::')).toBe('');
  });

  it('a kind with no drawing here is unwrapped: the body is read as Markdown and the fence is gone', () => {
    const out = html('::: cols\nLeft **column** prose.\n\nRight column prose.\n:::\n\nAfter.');
    expect(out).not.toContain(':::');
    expect(out).toContain('<p>Left <strong>column</strong> prose.</p>');
    expect(out).toContain('<p>Right column prose.</p>');
    expect(out).toContain('<p>After.</p>');
  });

  it('every kind is escape-first: markup in an attribute or body cannot reach the page as markup', () => {
    const out = html('::: stat label="<b>x</b>" unit="<i>"\n<script>1</script>\n:::\n\n::: pullquote attribution="<em>a</em>"\n<u>q</u>\n:::');
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<u>');
    expect(out).not.toContain('<em>a</em>');
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('charges each block by the geometry, and a stat card costs what its parts take', () => {
    const { blocks } = renderMarkdown('::: stat label="L" unit="%" sub="S"\n41.2\n:::\n\n::: pullquote attribution="A"\nOne sentence.\n:::', { geometry: G });
    expect(blocks).toHaveLength(2);
    // Two rules, the figure at 2.4× body, a label, a caption and the margins: about five body lines.
    expect(blocks[0].lines).toBeGreaterThan(4);
    expect(blocks[0].lines).toBeLessThan(7);
    expect(blocks[1].lines).toBeGreaterThan(2);
    expect(blocks[1].lines).toBeLessThan(5);
  });
});

describe('the block styles them from the same type scale', () => {
  it('a stat card and a pull quote print with their rules, sizes and inks', () => {
    const block = {
      id: 'm', type: 'markdown-block',
      props: { source: '::: stat label="Yield" unit="%"\n4.8\n:::\n\n::: pullquote\nA sentence.\n:::', bodySize: 9.5, x: 68, y: 114, width: 459, lineHeight: 1.55, bodyFont: 'token:body', headingFont: 'token:heading' },
    };
    const ctx = {
      data: { report: { type: 'investment' } }, tokens: { colors: { ink: '#111', surface: '#fff', primary: '#2F4858', text: '#111', muted: '#666', line: '#ccc' }, fonts: { body: 'Inter, sans-serif', heading: 'Playfair Display, serif' }, spacing: {} },
      page: { width: 595, height: 842 }, pageIndex: 0, pages: [], slots: {},
    } as never;
    const out = renderMarkdownBlockHtml(block as never, ctx);
    expect(out).toMatch(/<div class="stat-card" style="[^"]*border-top:0\.75pt solid/);
    expect(out).toMatch(/<div class="stat-value" style="[^"]*font-size:22\.8pt/);
    // 9.5 × 1.3 = 12.35pt, printed to a tenth.
    expect(out).toMatch(/<blockquote class="pull-quote" style="[^"]*font-size:12\.[34]pt;line-height:1\.35;font-style:italic/);
    expect(out).not.toContain(':::');
  });
});
