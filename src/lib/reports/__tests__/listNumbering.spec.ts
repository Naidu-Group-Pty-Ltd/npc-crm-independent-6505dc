import { describe, expect, it } from 'vitest';
import { renderMarkdown, splitListBlock } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { markdownBlockToItems } from '../../reportTemplate/blocks/markdownItems';
import { renderMarkdownBlockHtml } from '../../reportTemplate/blocks/markdownBlock.html';

/**
 * RS-5c.6 — an ordered list keeps its numbering.
 *
 * Two faults, one symptom. The scanner ended a numbered run on any change of
 * marker kind, so a step with bulleted sub-points (`1.` over four-space `*`
 * children — the shape a model writes a plan in) opened a new list at every
 * step; and the emitter wrote the resumed ordinal as `<ol start="N">`, which
 * WeasyPrint 69.0 ignores (measured: `<ol start="2">` set "1."). Every numbered
 * step of a Market Intelligence layer printed as "1." (Chancery render, 14 Sep
 * 2026). A nested run of the other kind now belongs to the item above it, and
 * the ordinal is written as the CSS counter the engine does read.
 */
const PLAN = [
  '1.  **Established homes:** the mid-$600k band.',
  '    *   **Signals:** long-term ownership.',
  '    *   **Access:** local networks.',
  '2.  **Tenanted investments:** robust rental market.',
  '    *   **Signals:** leases expiring.',
  '3.  **Larger lots:** subdivision potential.',
].join('\n');

describe('a numbered step keeps its bulleted sub-points, and its number', () => {
  it('reads the plan as ONE ordered list with nested bullets', () => {
    const { blocks, html } = renderMarkdown(PLAN);
    expect(blocks.filter((b) => b.kind === 'list')).toHaveLength(1);
    expect((html.match(/<ol/g) ?? []).length).toBe(1);
    expect((html.match(/<ul>/g) ?? []).length).toBe(2);
    // The bullets sit INSIDE the step's own <li>, so the engine numbers 1, 2, 3.
    expect(html).toMatch(/<li><strong>Established homes:<\/strong>[^<]*<ul><li>/);
    expect(html).toMatch(/<\/ul><\/li><li><strong>Tenanted investments/);
    expect(html).not.toContain('start=');
    expect(blocks[0].list?.items.map((it) => it.ordered)).toEqual([true, false, false, true, false, true]);
  });

  it('a sibling list of the other kind at the same depth still ends the run', () => {
    const { blocks } = renderMarkdown('1. one\n2. two\n- a bullet\n- another');
    expect(blocks.filter((b) => b.kind === 'list')).toHaveLength(2);
    expect(blocks[0].list?.ordered).toBe(true);
    expect(blocks[1].list?.ordered).toBe(false);
  });

  it('a run resumed after prose writes its ordinal as the CSS counter beside the attribute', () => {
    const { html } = renderMarkdown('1. one\n\nSome prose between.\n\n2. two\n3. three');
    expect(html).toContain('<ol start="2" style="counter-reset:list-item 1">');
  });

  it('a chunk the packer cuts from a long list resumes its count the same way', () => {
    const { blocks } = renderMarkdown(Array.from({ length: 12 }, (_, i) => `${i + 1}. Item ${i + 1}`).join('\n'));
    const pieces = splitListBlock(blocks[0], 5, 5, (items) => items.length);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[1].html).toMatch(/<ol start="(\d+)" style="counter-reset:list-item (\d+)">/);
    const m = /<ol start="(\d+)" style="counter-reset:list-item (\d+)">/.exec(pieces[1].html)!;
    expect(Number(m[2])).toBe(Number(m[1]) - 1);
  });
});

describe('the block keeps a tag\'s own style when it adds its own', () => {
  it('merges rather than doubling the attribute', () => {
    const ctx = {
      data: { report: { type: 'qa' }, s: '1. one\n\nProse.\n\n2. two' },
      tokens: {
        colors: { ink: '#111', surface: '#fff', primary: '#2F4858', text: '#111', muted: '#666', border: '#ddd', line: '#ccc', bg: '#eee', panel: '#f4f4f4' },
        fonts: { body: 'Inter, sans-serif', heading: 'Inter, sans-serif' }, spacing: {},
      },
      page: { width: 595, height: 842 }, pageIndex: 0, pages: [], slots: {},
    } as never;
    const html = renderMarkdownBlockHtml({
      id: 'md', type: 'markdown-block', overlays: [],
      props: { source: '{{s}}', pageIndex: 0, linesPerPage: 34, bodySize: 9.5, lineHeight: 1.55, x: 57, y: 100, width: 481 },
    } as never, ctx);
    const ols = html.match(/<ol[^>]*>/g) ?? [];
    expect(ols.length).toBe(2);
    const resumed = ols.find((o) => o.includes('start="2"'))!;
    expect(resumed).toBeDefined();
    expect((resumed.match(/style="/g) ?? []).length).toBe(1);
    expect(resumed).toMatch(/style="counter-reset:list-item 1;margin:0 0 [\d.]+pt;padding-left:[\d.]+pt;"/);
  });
});

describe('the browser painter counts from the same start', () => {
  it('marks a resumed list 3., 4.', () => {
    const items = markdownBlockToItems({ kind: 'list', html: '<ol start="3" style="counter-reset:list-item 2"><li>x</li><li>y</li></ol>', lines: 2 });
    expect(items.map((it) => (it.kind === 'listItem' ? it.marker : it.kind))).toEqual(['3.', '4.']);
  });

  it('paints nested bullets under a numbered step at depth one', () => {
    const { blocks } = renderMarkdown(PLAN);
    const items = markdownBlockToItems(blocks[0]);
    const markers = items.map((it) => (it.kind === 'listItem' ? `${it.depth}:${it.marker}` : it.kind));
    expect(markers).toEqual(['0:1.', '1:•', '1:•', '0:2.', '1:•', '0:3.']);
  });
});
