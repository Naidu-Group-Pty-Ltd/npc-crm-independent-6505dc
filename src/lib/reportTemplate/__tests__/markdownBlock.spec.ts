/**
 * The `markdown-block`, and the two properties that let it into
 * `PRODUCTION_SAFE_BLOCK_TYPES`.
 *
 * This file replaces the argument in `reportQaNotOnTheFamilies.spec.ts`, which
 * held that model-authored Markdown could not be drawn by a family master. That
 * was true of the vocabulary as it stood — no block rendered Markdown and none
 * accepted HTML — and the second half of it is still true and must stay true.
 *
 * What changed is that a block can take **source** rather than markup. The
 * programme's Markdown renderer is escape-first, so a block that renders its
 * own input cannot emit markup the content's author chose, whatever is bound to
 * it. That is a property of the renderer rather than of the caller, which is
 * what makes it safe to rely on.
 *
 * Two things are therefore asserted here, and the second matters more than the
 * first:
 *
 *  1. Markdown becomes structure — headings, bold, tables, lists.
 *  2. Markup in the source stays inert, including when it is the whole input.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { packMarkdownPages } from '@/lib/reportTemplate/blocks/markdownBlock.html';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { PRODUCTION_SAFE_BLOCK_TYPES } from '../../../../supabase/functions/_shared/productionBlockTypes';

/** One assistant answer, in the shape 70% of the corpus is written in. */
const ANSWER = [
  '## Yield analysis',
  '',
  'The **gross yield** is 3.71% on the purchase price, and the *net* yield is 2.44%.',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  '| Gross yield | 3.71% |',
  '| Net yield | 2.44% |',
  '',
  '- Land-led inner-west holding',
  '- Below the suburb median',
].join('\n');

function schemaWith(props: Record<string, unknown>) {
  return {
    version: 1 as const,
    name: 'Answer',
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'p1',
      name: 'Answer',
      size: { width: 595, height: 842 },
      background: { color: '#ffffff' },
      blocks: [{
        id: 'b1',
        type: 'markdown-block',
        props: { x: 40, y: 40, width: 515, ...props },
        overlays: [],
      }],
    }],
  };
}

const render = (props: Record<string, unknown>, data: Record<string, unknown>) =>
  renderTemplateToHtml(schemaWith(props) as any, { data }).html;

describe('markdown-block draws Markdown as structure', () => {
  it('sets a heading, bold, a table and a list', () => {
    const html = render({ source: '{{qa.answer}}' }, { qa: { answer: ANSWER } });

    expect(html).toContain('<strong>');
    expect(html).toContain('<table');
    expect(html).toContain('<li');
    // And none of it is left as its own source, which is what a text-block did.
    expect(html).not.toContain('## Yield analysis');
    expect(html).not.toContain('**gross yield**');
    expect(html).not.toContain('| Gross yield |');
  });

  it('renders nothing at all when the binding is absent', () => {
    // Consistent with every other block: an unresolved binding is the empty
    // string, and an empty source must not draw an empty styled container.
    expect(render({ source: '{{nothing.here}}' }, {})).not.toContain('<table');
    expect(render({ source: '{{nothing.here}}' }, {})).not.toContain('markdown');
  });
});

describe('markup in the source stays inert', () => {
  // The property the allow-list entry rests on. If any of these fail, the block
  // must come back out of PRODUCTION_SAFE_BLOCK_TYPES.
  const HOSTILE = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<strong>not bold</strong>',
    '<iframe src="https://example.com"></iframe>',
    '<a href="javascript:alert(1)">link</a>',
  ];

  /**
   * The tags the renderer is allowed to emit. Anything else in the output came
   * from the source, which would mean escaping failed.
   *
   * Asserting on the tag set rather than on substrings, because substrings give
   * false failures that train you to loosen the test: a fully-escaped
   * `&lt;a href=&quot;javascript:alert(1)&quot;&gt;` still *contains* the text
   * "javascript:", and it is inert. What matters is that no tag the model wrote
   * survived as a tag.
   */
  const EMITTED = new Set([
    'p', 'strong', 'em', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'table', 'thead',
    'tbody', 'tr', 'th', 'td', 'blockquote', 'code', 'pre', 'br', 'span', 'div',
    'figure', 'figcaption', 'svg', 'g', 'rect', 'text', 'line', 'path', 'circle',
  ]);

  /** Tag names inside <body>, which is where the block's output lands. */
  function tagsIn(html: string): string[] {
    const from = html.indexOf('<body>') + '<body>'.length;
    // The renderer emits the document's own title as an `<h1>` ahead of the
    // first page, off the visual surface — it is what makes the file's heading
    // sequence start at level 1, which PDF/UA-1 clause 7.4.2 requires. It is
    // the renderer's and not the block's, so it is not evidence about
    // escaping. Only the LEADING one is dropped: an `<h1>` anywhere else would
    // have come from the source and still fails.
    const body = html.slice(from, html.indexOf('</body>'))
      .replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/, '');
    return [...body.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());
  }

  for (const source of HOSTILE) {
    it(`renders ${source.slice(0, 30)}… as inert text`, () => {
      const html = render({ source: '{{x}}' }, { x: source });

      const foreign = tagsIn(html).filter((t) => !EMITTED.has(t) && t !== 'section' && t !== 'body');
      expect(foreign, `these tags survived from the source: ${foreign.join(', ')}`).toEqual([]);

      // And the angle brackets are present as entities, so the text is shown.
      expect(html).toContain('&lt;');
    });
  }

  it('escapes markup even when it is wrapped in legitimate Markdown', () => {
    // The realistic shape: a model writes prose and happens to include a tag.
    const html = render(
      { source: '{{x}}' },
      { x: '## Heading\n\nSome **bold** text and <script>alert(1)</script> after it.' },
    );
    expect(html).toContain('<strong>');   // the Markdown still works
    expect(html).not.toContain('<script'); // the markup still does not
    expect(html).toContain('&lt;script&gt;');
  });

  it('is the only production-safe block that renders Markdown', () => {
    // Guards against a second, differently-escaping implementation being added
    // to the allow-list later.
    expect(PRODUCTION_SAFE_BLOCK_TYPES.has('markdown-block')).toBe(true);
    expect(PRODUCTION_SAFE_BLOCK_TYPES.has('html-block')).toBe(false);
    expect(PRODUCTION_SAFE_BLOCK_TYPES.has('raw-html')).toBe(false);
  });
});

describe('paging a body whose length is not known when the master is built', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}. ${'word '.repeat(40)}`)
    .join('\n\n');

  it('packs blocks into buckets and never splits one', () => {
    const { blocks } = renderMarkdown(long);
    const pages = packMarkdownPages(blocks, 34);

    expect(pages.length).toBeGreaterThan(1);
    // Every source block appears exactly once, in order.
    expect(pages.flat()).toEqual([...blocks]);
  });

  it('gives an oversized block a page of its own rather than cutting it', () => {
    const { blocks } = renderMarkdown(long);
    const pages = packMarkdownPages(blocks, 1);
    // Budget of 1 line cannot fit anything, so each block lands alone.
    expect(pages.length).toBe(blocks.length);
  });

  it('emits successive pageIndexes and stops when the content runs out', () => {
    const first = render({ source: '{{x}}', pageIndex: 0, linesPerPage: 34 }, { x: long });
    const second = render({ source: '{{x}}', pageIndex: 1, linesPerPage: 34 }, { x: long });
    expect(first).toContain('Paragraph 1.');
    expect(second).not.toContain('Paragraph 1.');
    expect(second).toContain('<p');

    // The page beyond the content draws nothing, which is what lets a master
    // declare a fixed run of pages and have short answers cost nothing.
    const far = render({ source: '{{x}}', pageIndex: 99, linesPerPage: 34 }, { x: long });
    expect(far).not.toContain('<p');
  });

  it('a median-length answer fits one page', () => {
    // p50 of the corpus is 2,193 characters. If this stops being true the
    // masters' page budget needs re-fitting, not this assertion relaxing.
    const median = 'Some analysis. '.repeat(146); // ~2,190 chars
    const { blocks } = renderMarkdown(median);
    expect(packMarkdownPages(blocks, 34).length).toBe(1);
  });
});
