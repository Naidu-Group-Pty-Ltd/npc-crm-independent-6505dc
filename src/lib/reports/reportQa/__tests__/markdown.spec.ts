/**
 * The Markdown renderer, against hostile input.
 *
 * This module parses model output, so every case here is either something the
 * 562-answer corpus actually contains or something a model could plausibly emit
 * that would take a document down. The measured constructs are covered because
 * they are the ordinary case; the adversarial ones are covered because they are
 * the ones that ship silently.
 */
import { describe, expect, it } from 'vitest';
import {
  estimateLines,
  markdownToPlainText,
  renderInlineMarkdown,
  renderMarkdown,
  sanitiseGlyphs,
  MAX_MARKDOWN_CHARS,
  MAX_LIST_DEPTH,
  MAX_TABLE_ROWS,
} from '../markdown.pure';
import { escapeHtml } from '@/lib/reportDesign/primitives.pure';
import { assertSafeRenderResources } from '../../../../../supabase/functions/_shared/renderResourcePolicy.pure';

const SUPABASE = 'https://dduzbchuswwbefdunfct.supabase.co';
const html = (src: string, opts = {}) => renderMarkdown(src, opts).html;

// ── Escaping, and the property the whole design rests on ────────────────────

describe('escaping', () => {
  it('escapes markup in the source', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=y>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
  });

  it('applies emphasis around escaped text, not before it', () => {
    // If escaping ran second this would be `<strong>&lt;b&gt;` with the tags
    // themselves escaped, or worse, a live `<b>`.
    expect(renderInlineMarkdown('**<b>x</b>**')).toBe('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });

  it('never prints its own tags as text', () => {
    expect(html('**bold** and *ital*')).not.toContain('&lt;strong&gt;');
  });

  it('does not split an entity with an emphasis span', () => {
    const out = renderInlineMarkdown("It's a **test**");
    expect(out).toContain('&#39;');
    expect(out).toContain('<strong>test</strong>');
  });

  /**
   * The invariant escape-first safety rests on.
   *
   * `escapeHtml` produces five entities and none of them contains a Markdown
   * inline marker, so no marker can land inside one and no emphasis span can
   * split one. If a sixth entity is ever added this fails here rather than in a
   * client's document.
   */
  it('produces no entity containing an inline marker', () => {
    const entities = escapeHtml(`&<>"'`).match(/&[#\w]+;/g) ?? [];
    expect(entities).toHaveLength(5);
    for (const entity of entities) {
      for (const marker of ['*', '_', '`', '[', ']', '(', ')']) {
        expect(entity, `${entity} contains ${marker}`).not.toContain(marker);
      }
    }
  });
});

// ── The resource policy: the failure that takes the whole document down ─────

describe('urls', () => {
  it('neutralises a bare url and counts it', () => {
    const r = renderMarkdown('See https://corelogic.com.au/median for the basis.');
    expect(r.html).not.toContain('https://');
    expect(r.html).not.toContain('//');
    expect(r.html).toContain('corelogic.com.au/median');
    expect(r.notices.urlsNeutralised).toBe(1);
  });

  it('flattens a link and never emits an anchor', () => {
    const r = renderMarkdown('See [CoreLogic](https://corelogic.com.au/median) now.');
    expect(r.html).not.toContain('<a');
    expect(r.html).not.toContain('href');
    expect(r.html).toContain('CoreLogic');
    expect(r.notices.linksFlattened).toBe(1);
  });

  it('drops an image and keeps its alt text', () => {
    const r = renderMarkdown('![the chart](https://x.test/a.png)');
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('the chart');
    expect(r.notices.imagesDropped).toBe(1);
  });

  it.each([
    ['a table cell', '| src | v |\n| --- | --- |\n| https://evil.test/a | 1 |'],
    ['a code block', '```\nfetch("https://evil.test/a")\n```'],
    ['a heading', '## See https://evil.test/a'],
    ['a list item', '- per https://evil.test/a'],
  ])('neutralises a url in %s', (_label, src) => {
    expect(html(src)).not.toContain('//');
  });

  /**
   * The ordering rule, and it is a real bug reversed.
   *
   * Stripping a zero-width character is what *creates* a scheme-relative URL, so
   * `sanitiseGlyphs` has to run before `neutraliseUrls`. Reversed, this input
   * produces a live `//` and the render throws.
   */
  it('strips zero-width characters before neutralising, not after', () => {
    const r = renderMarkdown('a /​/ evil.test b');
    expect(r.html).not.toContain('//');
    expect(r.notices.glyphsDropped).toBe(1);
  });

  it('leaves an authored numeric entity inert through the policy decoder', () => {
    // `escapeHtml` turns `&#47;` into `&amp;#47;`. The policy decodes `&#\d+;`
    // *before* `&amp;` and never re-decodes, so the `//` cannot be reassembled.
    // Pinned because it depends on that statement order in the policy.
    const out = html('x &#47;&#47;evil.test y');
    expect(out).toContain('&amp;#47;');
    expect(() => assertSafeRenderResources(out, SUPABASE)).not.toThrow();
  });

  it.each([
    ['a bare url', 'See https://corelogic.com.au/x'],
    ['a link', '[CoreLogic](https://corelogic.com.au/median)'],
    ['an image', '![chart](https://x.test/a.png)'],
    ['other schemes', 'file:///etc/passwd and ftp://x.test/y and gopher://z.test'],
    ['a url in a table', '| src | v |\n| --- | --- |\n| https://evil.test/a | 1 |'],
    ['a url in code', '```\nfetch("https://evil.test/a")\n```'],
  ])('passes the render resource policy — %s', (_label, src) => {
    expect(() => assertSafeRenderResources(html(src), SUPABASE)).not.toThrow();
  });
});

// ── Tables ──────────────────────────────────────────────────────────────────

const T = (rows: string) => `| a | b | c |\n| --- | --- | --- |\n${rows}`;

describe('tables', () => {
  it('renders a well-formed table through the design system primitive', () => {
    const out = html(T('| 1 | 2 | 3 |'));
    expect(out).toContain('<table class="data">');
    expect(out).toContain('<div class="table-block">');
    expect(out).toContain('<th scope="row"');
  });

  it('pads a short row and truncates a long one, counting both', () => {
    const r = renderMarkdown(T('| 1 | 2 |\n| 1 | 2 | 3 | 4 |'));
    expect(r.notices.tablesRagged).toBe(2);
    expect(r.notices.tableColumnsDropped).toBe(1);
    expect(r.degraded).toBe(true);
  });

  it.each([
    ['no delimiter row', '| a | b |\n| 1 | 2 |'],
    ['a delimiter row of the wrong width', '| a | b | c |\n| --- | --- |\n| 1 | 2 | 3 |'],
  ])('refuses to build a table from %s and keeps the words as a paragraph', (_label, src) => {
    const r = renderMarkdown(src);
    expect(r.html).not.toContain('<table');
    expect(r.html).toContain('<p>');
    expect(r.notices.tablesRejected).toBe(1);
  });

  it('a header and delimiter with no body is nothing to show, and prints nothing', () => {
    // A table the model started and never filled has no content — only the
    // column labels and the separator. Printed as a paragraph it was
    // `| a | b | | --- | --- |` raw on a client's page (a stored Market
    // Intelligence layer ended exactly so). It is consumed and counted.
    const r = renderMarkdown('| a | b |\n| --- | --- |');
    expect(r.html).not.toContain('<table');
    expect(r.html).not.toContain('|');
    expect(r.html).toBe('');
    expect(r.notices.tablesRejected).toBe(1);
  });

  it('demotes a one-column table to a labelled list', () => {
    const out = html('| Risks |\n| --- |\n| Vacancy |\n| Rates |');
    expect(out).not.toContain('<table');
    expect(out).toContain('<h4>Risks</h4>');
    expect(out).toContain('<li>Vacancy</li>');
  });

  it('right-aligns a numeric column the model gave no alignment for', () => {
    const out = html(T('| x | 1,234 | y |'));
    expect(out).toContain('class="num"');
  });

  it('tones a negative figure', () => {
    const out = html('| item | value |\n| --- | ---: |\n| a | -1,234 |\n| b | (500) |');
    expect((out.match(/neg/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps two columns of the same name distinct', () => {
    // Keyed positionally. Keyed by header text, one of these would blank.
    const out = html('| Value | Value |\n| --- | --- |\n| left | right |');
    expect(out).toContain('left');
    expect(out).toContain('right');
  });

  it('keeps six columns portrait and sends seven to the landscape page', () => {
    const six = `| ${'abcdef'.split('').join(' | ')} |\n|${' --- |'.repeat(6)}\n| ${'123456'.split('').join(' | ')} |`;
    const seven = `| ${'abcdefg'.split('').join(' | ')} |\n|${' --- |'.repeat(7)}\n| ${'1234567'.split('').join(' | ')} |`;
    expect(html(six)).not.toContain('page-landscape-table');
    expect(html(seven)).toContain('page-landscape-table');
    expect(renderMarkdown(seven).notices.tablesLandscaped).toBe(1);
  });

  it('keeps twelve of a nineteen-column table and names the rest', () => {
    const head = Array.from({ length: 19 }, (_, i) => `h${i}`);
    const src = `| ${head.join(' | ')} |\n|${' --- |'.repeat(19)}\n| ${head.map((_, i) => i).join(' | ')} |`;
    const r = renderMarkdown(src);
    expect(r.notices.tableColumnsDropped).toBe(7);
    expect(r.html).toContain('Columns not shown');
    expect(r.html).toContain('h18');
    expect(r.html).not.toContain('>h12<');
  });

  it('caps a very long table and says so', () => {
    const rows = Array.from({ length: 300 }, (_, i) => `| r${i} | ${i} | x |`).join('\n');
    const r = renderMarkdown(T(rows));
    expect(r.notices.tableRowsDropped).toBe(300 - MAX_TABLE_ROWS);
    expect(r.degraded).toBe(true);
  });

  it('marks a total row and leaves a row that merely begins with the word', () => {
    const out = html('| x | y |\n| --- | --- |\n| Total | 1 |\n| Total addressable market | 2 |');
    expect((out.match(/class="total"/g) ?? []).length).toBe(1);
  });

  it('strips emphasis inside a cell rather than printing the markers', () => {
    const out = html('| a | b |\n| --- | --- |\n| **Yes** | no |');
    expect(out).toContain('Yes');
    expect(out).not.toContain('**');
  });
});

// ── Headings ────────────────────────────────────────────────────────────────

describe('headings', () => {
  it('never emits an h1, h5 or h6, whatever the input', () => {
    for (const src of [
      '# one', '## two', '### three', '#### four', '##### five', '###### six',
      '#'.repeat(40) + ' many', 'Setext\n===',
    ]) {
      const out = html(src);
      expect(out, src).not.toContain('<h1');
      expect(out, src).not.toContain('<h5');
      expect(out, src).not.toContain('<h6');
    }
  });

  it('treats forty hashes as a paragraph, not a heading', () => {
    const r = renderMarkdown('#'.repeat(40) + ' Heading\n\nafter');
    expect(r.html).not.toContain('<h');
    expect(r.headings).toHaveLength(0);
  });

  it('treats seven hashes as prose and six as a heading', () => {
    expect(html('####### seven')).not.toContain('<h');
    expect(html('###### six', { dropEmptyHeadings: false })).toContain('<h2');
  });

  it('treats a hash with no space as prose', () => {
    expect(html('#Heading\n\nbody')).not.toContain('<h');
  });

  it('emits nothing for a bare hash rather than an empty heading', () => {
    const out = html('#\n\nbody');
    expect(out).not.toContain('<h');
    expect(out).toBe('<p>body</p>');
  });

  /**
   * The demotion is relative to the answer's own shallowest heading.
   *
   * Models are inconsistent about whether they open at `#` or `##`, and an
   * answer written entirely in `##`/`###` must render with the same hierarchy as
   * one written in `#`/`##`.
   */
  it('produces the same hierarchy from two different starting levels', () => {
    const a = renderMarkdown('# One\n\ntext\n\n## Two\n\ntext').headings.map((h) => h.level);
    const b = renderMarkdown('## One\n\ntext\n\n### Two\n\ntext').headings.map((h) => h.level);
    expect(a).toEqual([2, 3]);
    expect(b).toEqual(a);
  });

  it('clamps everything past h4 onto h4', () => {
    const levels = renderMarkdown('# a\n\n## b\n\n### c\n\n#### d\n\n##### e', { dropEmptyHeadings: false }).headings.map((h) => h.level);
    expect(levels).toEqual([2, 3, 4, 4, 4]);
  });

  it('strips a closing hash sequence', () => {
    expect(renderMarkdown('## Title ##', { dropEmptyHeadings: false }).headings[0].text).toBe('Title');
  });

  it('gives every heading a unique id over a safe charset', () => {
    const r = renderMarkdown('## Same\n\nx\n\n## Same\n\ny');
    const ids = r.headings.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(id).not.toContain('//');
    }
  });

  it('reads a setext heading and drops a thematic break', () => {
    expect(renderMarkdown('Title\n===', { dropEmptyHeadings: false }).headings[0]?.text).toBe('Title');
    const r = renderMarkdown('Text\n\n---\n\nmore');
    expect(r.notices.thematicBreaks).toBe(1);
    expect(r.headings).toHaveLength(0);
  });

  it('indexes each heading at the block it produced', () => {
    const r = renderMarkdown('## One\n\ntext\n\n## Two\n\ntext');
    for (const h of r.headings) {
      expect(r.blocks[h.blockIndex].kind).toBe('heading');
      expect(r.blocks[h.blockIndex].html).toContain(h.id);
    }
  });

  it('carries plain text, not markup, on the heading record', () => {
    expect(renderMarkdown('## A **bold** title', { dropEmptyHeadings: false }).headings[0].text).toBe('A bold title');
  });
});

// ── Inline ──────────────────────────────────────────────────────────────────

describe('inline', () => {
  it('drops an unmatched flanking marker and counts it', () => {
    const r = renderMarkdown('**Important thing');
    expect(r.html).toContain('Important thing');
    expect(r.html).not.toContain('*');
    expect(r.notices.unmatchedEmphasis).toBeGreaterThan(0);
  });

  it('keeps asterisks that are arithmetic', () => {
    const r = renderMarkdown('2 * 3 * 4');
    expect(r.html).toContain('2 * 3 * 4');
    expect(r.notices.unmatchedEmphasis).toBe(0);
  });

  it('does not emphasise inside a word', () => {
    const out = renderInlineMarkdown('the edited_content field and _real_ emphasis');
    expect(out).toContain('edited_content');
    expect(out).toContain('<em>real</em>');
  });

  it('nests bold and italic', () => {
    expect(renderInlineMarkdown('***both***')).toBe('<strong><em>both</em></strong>');
  });

  it('does not parse emphasis inside a code span', () => {
    const out = renderInlineMarkdown('`**not bold**` but **yes**');
    expect(out).toContain('<code>**not bold**</code>');
    expect(out).toContain('<strong>yes</strong>');
  });

  it('distinguishes a hard break from a soft one', () => {
    expect(html('one  \ntwo')).toContain('<br>');
    expect(html('one\ntwo')).toBe('<p>one two</p>');
  });

  it('terminates on a hundred thousand markers', () => {
    const r = renderMarkdown('*'.repeat(100_000));
    expect(r.html.length).toBeLessThan(MAX_MARKDOWN_CHARS);
    expect(r.degraded).toBe(true);
  });
});

// ── Glyphs ──────────────────────────────────────────────────────────────────

describe('glyphs', () => {
  it('strips the variation selector so a dingbat gets its text form', () => {
    const r = sanitiseGlyphs('⚠️ Warning');
    expect(r.text).toBe('⚠ Warning');
    expect(r.dropped).toBe(1);
  });

  it('transliterates the verdict emoji', () => {
    const r = sanitiseGlyphs('✅ ❌ ⭐');
    expect(r.text).toBe('✓ ✗ ★');
    expect(r.transliterated).toBe(3);
  });

  it('drops a pictograph and leaves the words', () => {
    expect(sanitiseGlyphs('🏠 Owner Occupied').text).toBe(' Owner Occupied');
  });

  /**
   * The regression this module criticises the legacy for, and then shipped
   * itself.
   *
   * `sanitizeForPDF` deletes every non-ASCII character; the first version of
   * this pass dropped everything at or above U+2600, which is above Han. Both
   * delete a client's name. Found by rendering `A non-Latin name: 李小龍` and
   * reading `A non-Latin name:` back off the page.
   */
  it('keeps a non-Latin name', () => {
    expect(sanitiseGlyphs('李小龍 · Ελληνικά · Кириллица · العربية').text)
      .toBe('李小龍 · Ελληνικά · Кириллица · العربية');
  });

  it('keeps the symbols the installed faces cover', () => {
    const kept = '→ ← ↑ ↓ ≤ ≥ ≈ ≠ ± × ÷ ° € £ • ★ ✓ ✗ ⚠';
    expect(sanitiseGlyphs(kept).text).toBe(kept);
  });

  it('keeps smart punctuation, which the legacy transliterates away', () => {
    const kept = '— – … ‘curly’ “double”';
    expect(sanitiseGlyphs(kept).text).toBe(kept);
  });

  it('strips zero-width joiners and bidi overrides', () => {
    expect(sanitiseGlyphs('a‍b‮c').text).toBe('abc');
  });

  it('reduces a keycap to its digit', () => {
    expect(sanitiseGlyphs('1️⃣').text).toBe('1');
  });

  it('emits no pictograph or private-use codepoint for any input', () => {
    const out = sanitiseGlyphs('🏠📈💸🔴🟢✨⚡� Owner').text;
    for (const ch of out) {
      const cp = ch.codePointAt(0)!;
      expect(cp, `U+${cp.toString(16)} survived`).toBeLessThan(0x1f000);
      expect(cp === 0xfffd, 'replacement character survived').toBe(false);
    }
  });
});

// ── Bounds ──────────────────────────────────────────────────────────────────

describe('bounds', () => {
  it('truncates 200 KB with an exact residue and never throws', () => {
    const src = 'word '.repeat(40_000);
    const r = renderMarkdown(src);
    expect(r.notices.truncatedAtChars).toBe(src.length - MAX_MARKDOWN_CHARS);
    expect(r.html).toContain('tone-caution');
    expect(r.degraded).toBe(true);
  });

  it('survives the largest conversation in the record as one input', () => {
    const r = renderMarkdown('The sub-market absorbed 240 new dwellings. '.repeat(8_500));
    expect(r.degraded).toBe(true);
    expect(r.blocks.length).toBeGreaterThan(0);
  });

  it('flattens a six-deep list without losing an item', () => {
    const src = Array.from({ length: 6 }, (_, d) => `${'  '.repeat(d)}- level ${d}`).join('\n');
    const r = renderMarkdown(src);
    expect(r.notices.listsFlattened).toBe(6 - MAX_LIST_DEPTH);
    for (let d = 0; d < 6; d++) expect(r.html).toContain(`level ${d}`);
  });

  it('nests a sublist inside its parent item, not beside it', () => {
    // Beside it is invalid HTML and WeasyPrint renders it at the parent's own
    // indent, so the nesting the author wrote is simply not on the page.
    expect(html('- a\n  - b\n- c'))
      .toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
  });

  it('caps a very long list', () => {
    const r = renderMarkdown(Array.from({ length: 500 }, (_, i) => `- item ${i}`).join('\n'));
    expect(r.notices.listItemsDropped).toBe(300);
  });

  it('closes an unclosed fence and never emits pre', () => {
    const out = html('```js\nconst x = 1;\nconst y = 2;');
    expect(out).not.toContain('<pre');
    expect(out).toContain('<code>');
    expect(out).toContain('<br>');
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe('contract', () => {
  it('is deterministic', () => {
    const src = '## A\n\ntext **bold**\n\n| a | b |\n| --- | --- |\n| 1 | 2 |';
    expect(html(src)).toBe(html(src));
  });

  it.each([['empty', ''], ['whitespace', '   \n\n  ']])(
    'handles %s input without throwing',
    (_label, src) => {
      const r = renderMarkdown(src);
      expect(r.blocks).toHaveLength(0);
      expect(r.html).toBe('');
      expect(r.degraded).toBe(false);
    },
  );

  it('leaves every notice at zero for a clean answer', () => {
    const r = renderMarkdown('## Summary\n\nA sentence with **bold** in it.\n\n- one\n- two');
    for (const [key, value] of Object.entries(r.notices)) {
      expect(value, `${key} is not clean`).toBeFalsy();
    }
    expect(r.degraded).toBe(false);
  });

  it('is degraded only when content was lost, not when glyphs were normalised', () => {
    expect(renderMarkdown('🏠 Owner Occupied').degraded).toBe(false);
    expect(renderMarkdown('**unclosed').degraded).toBe(false);
    const rows = Array.from({ length: 200 }, (_, i) => `| r${i} | ${i} |`).join('\n');
    expect(renderMarkdown(`| a | b |\n| --- | --- |\n${rows}`).degraded).toBe(true);
  });

  it('counts lines the caller can turn into pages', () => {
    const r = renderMarkdown('## A\n\n' + 'word '.repeat(200));
    expect(estimateLines(r.blocks)).toBe(r.lines);
    expect(r.lines).toBeGreaterThan(10);
  });

  it('reduces markdown to plain text for a contents entry', () => {
    expect(markdownToPlainText('## **Heading** with `code` and 🏠')).toBe('Heading with code and');
  });

  it('truncates on a word, inside the budget, and says it was cut', () => {
    // Changed when the Market Intelligence render showed a chapter standfirst
    // ending mid-word on a hyphenated compound — "…the board's statement noting
    // trimmed" — which reads as a truncated database column rather than a
    // summary. The ellipsis is inside the cap, not added to it, so a caller's
    // budget still means what it says.
    const cut = markdownToPlainText('a very long heading indeed about interest rates', 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).toBe('a very long heading…');

    // A single very long token is cut where it falls rather than collapsing the
    // whole string to an ellipsis.
    expect(markdownToPlainText('Supercalifragilisticexpialidocious', 10)).toBe('Supercali…');

    // Under the cap, nothing happens at all.
    expect(markdownToPlainText('short', 40)).toBe('short');
  });
});

/**
 * A chapter's own name, said again as its first heading.
 *
 * The natural way to write a section is to head it with its own name, and a
 * model asked for the prose of *Executive Summary* opens with `## Executive
 * Summary`. The renderer has already printed that as a 34pt chapter title, so
 * the page says the same words twice, four lines apart, at 34pt and 17pt — seen
 * on two consecutive chapters of a Market Intelligence render.
 */
describe('a leading heading that repeats the chapter title', () => {
  const render = (src: string, chapterTitle?: string) =>
    renderMarkdown(src, chapterTitle ? { chapterTitle } : {}).html;

  it('is dropped when it matches', () => {
    expect(render('## Executive Summary\n\nThe body.', 'Executive Summary'))
      .toBe('<p>The body.</p>');
  });

  it('ignores case, punctuation and spacing', () => {
    expect(render('## Sources:\n\nThe body.', 'Sources')).toBe('<p>The body.</p>');
    expect(render('## your 60-second briefing\n\nThe body.', 'Your 60-Second Briefing'))
      .toBe('<p>The body.</p>');
  });

  it('keeps a heading of the same name further down, which is a real subsection', () => {
    // Only the *leading* one is an echo of the title.
    const html = render('Opening line.\n\n## Overview\n\nMore.', 'Overview');
    expect(html).toContain('Overview</h2>');
  });

  it('keeps a leading heading that says something else', () => {
    expect(render('## What moved\n\nThe body.', 'Executive Summary')).toContain('What moved</h2>');
  });

  it('changes nothing when no chapter title is given', () => {
    expect(render('## Executive Summary\n\nThe body.')).toContain('Executive Summary</h2>');
  });

  it('does not renumber the headings it keeps', () => {
    // The dropped heading must not consume an id slot, or two chapters that
    // both open with their own title would collide on the ones below.
    const { headings } = renderMarkdown('## Overview\n\n## What moved\n\nx', { chapterTitle: 'Overview' });
    expect(headings.map((h) => h.text)).toEqual(['What moved']);
  });
});
