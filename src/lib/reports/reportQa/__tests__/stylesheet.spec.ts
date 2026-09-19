/**
 * Every element the Markdown renderer can emit is dressed by the stylesheet.
 *
 * This guard exists only for this format, because only this format emits HTML
 * chosen by a *model* rather than by code. Every other renderer in the programme
 * emits a fixed set of primitives whose classes the sheet was written for. Here
 * the tag set is the Markdown grammar's, and the failure mode is quiet: an
 * unstyled `h5` prints at body size with the user agent's own margins, and the
 * document looks slightly wrong in a way nobody can name.
 *
 * Read the sheet the way `reportTypography.spec.ts` reads the Dockerfile —
 * against the thing itself, not against a copy of what it is believed to say.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../markdown.pure';

const REPO = resolve(__dirname, '../../../../..');
const CSS_SOURCE = readFileSync(
  resolve(REPO, 'supabase/functions/_shared/reportDesign/css.pure.ts'),
  'utf8',
);

/**
 * True when `css.pure.ts` carries a rule that reaches this element.
 *
 * Selectors, not declarations — the source is a template literal, so the check
 * looks at the text before each `{` and asks whether the tag appears in it as a
 * word of its own. That admits `p {` and `h1, h2, h3 {` and also `table.data th
 * {` and `.callout .label {`, which is right: an element the sheet reaches
 * through a class its own primitive puts on it is dressed, and demanding a bare
 * tag selector would fail every table cell in the design system.
 *
 * `\b` alone would match `h1` inside `.h1-rule`, so the boundaries are
 * explicit about what may precede and follow a tag in a selector.
 */
function isStyled(tag: string): boolean {
  const word = new RegExp(`(^|[\\s,>+~(])${tag}(?=[\\s,{:.\\[>+~)]|$)`);
  for (const block of CSS_SOURCE.split('{')) {
    // The selector is the tail of the text preceding a `{`, after the last `}`
    // or `;` that closed whatever came before it.
    const selector = block.split(/[};]/).pop() ?? '';
    if (word.test(selector)) return true;
  }
  return false;
}

/**
 * Elements emitted with no rule of their own, and why that is acceptable.
 *
 * An exemption is a decision recorded, not a gap ignored. Anything not on this
 * list and not styled fails.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  br: 'A line break has nothing to style. Used inside a code callout so a long '
    + 'line wraps rather than running off the trim edge, which `<pre>` would.',
  code: 'Inherits `monospace` from the user agent sheet, which fontconfig '
    + 'resolves to DejaVu Sans Mono — installed, and confirmed embedded by '
    + '`pdffonts` on a real render. Adding `.callout code { font-family: '
    + "PRINT_STACK.mono }` to the shared sheet would improve it, but that is a "
    + 'design-system change for six formats and not a format module\'s to make.',
};

/**
 * Tags this module writes itself, read out of its own source.
 *
 * The scope is deliberate. A rendered document also contains `div`, `span`,
 * `tbody` and friends, and those come from `renderDataTable`, `renderCallout`
 * and `renderSidenote` — structural wrappers the sheet reaches through the
 * classes those primitives put on them, exercised by six shipping formats. They
 * are not this module's choice and not this guard's business.
 *
 * What *is* its business is the prose vocabulary, because that is chosen by a
 * model's Markdown rather than by code, and it is where an unstyled element can
 * appear without anyone deciding it should.
 */
const OWN_TAGS = (() => {
  const source = readFileSync(
    resolve(REPO, 'supabase/functions/_shared/reports/markdown.pure.ts'),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Intersected with real element names, because the source is TypeScript: a
  // generic reads as `<readonly …>` and an interpolated heading as `<h${level}>`.
  // The heading levels are asserted separately, against a rendered document.
  const HTML = new Set([
    'a', 'aside', 'br', 'blockquote', 'caption', 'code', 'del', 'div', 'em', 'h1',
    'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'li', 'ol', 'p', 'pre', 'section',
    'span', 'strong', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
  ]);
  return [...new Set([...code.matchAll(/<([a-z][a-z0-9]*)(?:[ >]|\$\{)/g)].map((m) => m[1]))]
    .filter((t) => HTML.has(t))
    .sort();
})();

/** Everything that actually reaches a page, from a document exercising the grammar. */
const RENDERED = (() => {
  const source = [
    '# One', '## Two', '### Three', '#### Four',
    'A paragraph with **bold**, *italic* and `code` in it.',
    'Two  \nlines',
    '- a\n  - b',
    '1. one\n2. two',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '| ' + 'abcdefg'.split('').join(' | ') + ' |\n|' + ' --- |'.repeat(7) + '\n| '
      + '1234567'.split('').join(' | ') + ' |',
    '> quoted',
    '```js\nconst x = 1;\n```',
    '![alt](x.png)',
    '[text](x)',
    'A cited claim.[^n]',
    '[^n]: The note the citation points at.',
  ].join('\n\n');
  const html = renderMarkdown(source, { idPrefix: 't' }).html
    + renderMarkdown('x'.repeat(200_000)).html; // the truncation callout
  return [...new Set([...html.matchAll(/<([a-z][a-z0-9]*)[\s/>]/g)].map((m) => m[1]))].sort();
})();

describe('the markdown renderer emits only elements the sheet dresses', () => {
  it('writes exactly this prose vocabulary, and no more', () => {
    // Pinned so a new construct has to be considered here rather than appearing
    // on a page unnoticed. The interpolated ones — `<h${level}>` and the
    // `<${tag}>` a list opens with — are asserted below against a document that
    // was actually rendered, which is a stronger check than reading a template
    // literal anyway.
    expect(OWN_TAGS).toEqual(['br', 'code', 'em', 'h4', 'li', 'ol', 'p', 'strong', 'sup']);
  });

  it.each(['ul', 'ol', 'li', 'p', 'strong', 'em', 'code', 'sup'])(
    'reaches the page with a styled <%s>',
    (tag) => {
      expect(RENDERED, `<${tag}> never reached the page`).toContain(tag);
      expect(EXEMPT[tag] !== undefined || isStyled(tag), `<${tag}> is unstyled`).toBe(true);
    },
  );

  it.each(OWN_TAGS)('%s is styled, or exempt with a reason', (tag) => {
    if (EXEMPT[tag]) {
      expect(EXEMPT[tag].length, `the exemption for <${tag}> gives no reason`).toBeGreaterThan(40);
      return;
    }
    expect(isStyled(tag), `<${tag}> is emitted but css.pure.ts has no rule for it`).toBe(true);
  });

  it('emits every heading level the sheet dresses and none it does not', () => {
    // The levels are interpolated (`<h${level}>`), so they are not in OWN_TAGS.
    expect(RENDERED).toEqual(expect.arrayContaining(['h2', 'h3', 'h4']));
    for (const tag of ['h1', 'h5', 'h6']) {
      expect(isStyled(tag) || !RENDERED.includes(tag), `<${tag}> is emitted and unstyled`).toBe(true);
      expect(RENDERED, `<${tag}> reached the page`).not.toContain(tag);
    }
  });

  it('never reaches for an element the sheet does not dress at all', () => {
    for (const tag of ['hr', 'pre', 'img', 'a', 'blockquote', 'del']) {
      expect(RENDERED, `<${tag}> reached the page`).not.toContain(tag);
      expect(OWN_TAGS, `<${tag}> is written by the module`).not.toContain(tag);
    }
  });

  it('leaves the structural wrappers to the primitives that own them', () => {
    for (const tag of ['div', 'span', 'section', 'table', 'thead', 'tbody', 'tr', 'th', 'td']) {
      expect(OWN_TAGS, `<${tag}> is written by hand rather than by a primitive`).not.toContain(tag);
    }
    expect(RENDERED).toEqual(expect.arrayContaining(['div', 'table', 'th', 'td']));
  });

  /**
   * The check has to be able to fail.
   *
   * A selector matcher that returned true for everything would pass every
   * assertion above and guard nothing — which is the shape of the two Client
   * Details assertions that passed while their subjects were broken.
   */
  it('reports an element the sheet has no rule for', () => {
    expect(isStyled('marquee')).toBe(false);
    expect(isStyled('h5')).toBe(false);
    expect(isStyled('pre')).toBe(false);
    expect(isStyled('p')).toBe(true);
    expect(isStyled('em')).toBe(true);
    expect(isStyled('h2')).toBe(true);
  });
});
