/**
 * `.passport-cover` is a MATERIAL, not a layout.
 *
 * Two different things wear that class: the navy leather the front board is
 * made of, and — on the partner side — a compliance strip that wanted the same
 * leather behind a single row of text. When the board's own page margins were
 * set on the shared class, that strip inherited 58px/44px/46px of padding and
 * `justify-content: flex-start`, over the `px-5 py-4` it had asked for. The
 * strip is on a partner-facing surface, and nothing in the AML suite renders it
 * with layout, so no test could see it.
 *
 * The board's composition therefore lives on `.passport-cover--board`, and this
 * asserts it stays there. A source assertion rather than a render one for the
 * usual reason: jsdom has no cascade, so only reading the rule catches it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'styles', 'passport-tokens.css'),
  'utf8',
);
const book = readFileSync(join(__dirname, 'PassportBook.tsx'), 'utf8');

/** The declarations of one rule, by exact selector. */
function ruleBody(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) return '';
  return css.slice(at, css.indexOf('}', at));
}

describe('cover material vs cover composition', () => {
  it('sets the board’s page margins on --board, never on the shared class', () => {
    expect(ruleBody('.passport-cover--board')).toMatch(/padding:/);
    expect(ruleBody('.passport-cover')).not.toMatch(/padding:/);
    expect(ruleBody('.passport-cover')).not.toMatch(/justify-content:/);
  });

  it('keeps the leather on the shared class, which is what the strip wants', () => {
    // The partner strip paints itself with `.passport-cover` for the navy and
    // the gold hairline. Moving those to `--board` would blank it.
    const material = ruleBody('.passport-cover');
    expect(material).toMatch(/background:/);
    expect(material).toMatch(/border:/);
    expect(material).toMatch(/color:/);
  });

  it('the front board asks for both, in that order', () => {
    expect(book).toMatch(/className="passport-cover passport-cover--board /);
  });

  it('the miniature states the design ratio once, in CSS', () => {
    // A hand-typed height is how a scaled cover ends up a few pixels stretched.
    expect(ruleBody('.passport-cover-thumb')).toMatch(/aspect-ratio:\s*470\s*\/\s*648/);
    expect(ruleBody('.passport-cover-thumb')).toMatch(/overflow:\s*hidden/);
  });

  it('derives the miniature’s box AND its scale from the same number', () => {
    // The defect this prevents: the box sized from CSS at 112px while the
    // board was scaled from a JS default of 132, so the phone cover was drawn
    // 18% too large and lost its clasp to `overflow: hidden`. Two derivations
    // of one size will disagree; one cannot.
    expect(ruleBody('.passport-cover-thumb')).toMatch(
      /width:\s*calc\(var\(--passport-thumb-w\)\s*\*\s*1px\)/,
    );
    expect(ruleBody('.passport-cover-thumb__art')).toMatch(
      /transform:\s*scale\(calc\(var\(--passport-thumb-w\)\s*\/\s*470\)\)/,
    );
    // …and the component must not write either of them itself.
    const thumb = book.slice(book.indexOf('export function PassportCoverThumb'));
    expect(thumb).not.toMatch(/style=\{\{[^}]*\btransform\b/);
    expect(thumb).toMatch(/"--passport-thumb-w": width/);
  });

  it('sizes the overlay control to the cover it covers', () => {
    // `inset: 0` is what keeps the hit area and the focus ring exactly the
    // artwork, at whatever `--passport-thumb-w` the surface asked for.
    expect(ruleBody('.passport-cover-thumb__open')).toMatch(/position:\s*absolute/);
    expect(ruleBody('.passport-cover-thumb__open')).toMatch(/inset:\s*0/);
    expect(ruleBody('.passport-cover-thumb__slot')).toMatch(/position:\s*relative/);
  });

  it('resizes at the breakpoint by moving that number, not the width', () => {
    const media = css.slice(css.indexOf('.passport-cover-thumb {'));
    const breakpoint = media.slice(media.indexOf('@media (min-width: 640px)'));
    const rule = breakpoint.slice(0, breakpoint.indexOf('}', breakpoint.indexOf('{', 30)));
    expect(rule).toMatch(/--passport-thumb-w:\s*\d+/);
    expect(rule).not.toMatch(/^\s*width:/m);
  });
});
