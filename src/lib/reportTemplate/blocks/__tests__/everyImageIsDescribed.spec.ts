/**
 * Every picture the print path draws carries alternative text.
 *
 * The render routes ask WeasyPrint for `pdf_variant: 'pdf/ua-1'`, and clause
 * 7.3 requires every `/Figure` to carry `/Alt` or `/ActualText`. Asking for
 * the variant is an export setting and proves nothing about the file, so this
 * was found by validating the artefact: veraPDF 1.30.2 reported `7.3 test 1`
 * failing twice on the 36-page Templates render and once on each single-tier
 * page, while all ten flowing formats passed.
 *
 * Nine emitters in this tree wrote their own `<img>`. Two passed `alt=""`,
 * believing an empty string marks a picture decorative. **It does not on this
 * engine** — measured on WeasyPrint 69.0, `<img alt="">` and `<img>` produce a
 * byte-identical PDF, and in both the figure is tagged with no `/Alt`. So an
 * empty alt is not a weaker form of compliance; it is the failure itself, and
 * the two sites that had one were two of the three production failures.
 *
 * `imgTag` is the one emitter now, and it substitutes `MISSING_ALT` rather
 * than nothing, so an undescribed picture is a visible gap instead of an
 * invisible conformance failure.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { imgTag, MISSING_ALT } from '../_shared.html';

const DIR = resolve(__dirname, '..');
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.html.ts'))
  .map((f) => [f, readFileSync(resolve(DIR, f), 'utf8')] as const);

/** Comments describe the rule; they are not the rule. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('every image the print path draws is described', () => {
  it('finds the block renderers', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('writes no <img> outside the one emitter', () => {
    // `_shared.html.ts` IS the emitter; everything else must go through it.
    const offenders = sources
      .filter(([f, src]) => f !== '_shared.html.ts' && /<img\b/.test(code(src)))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('and the one emitter writes exactly one', () => {
    const shared = sources.find(([f]) => f === '_shared.html.ts')![1];
    expect(code(shared).match(/<img\b/g) ?? []).toHaveLength(1);
  });

  it('always emits a non-empty alt, because an empty one is the failure', () => {
    expect(imgTag('x.png', { alt: 'An aerial photograph', style: '' }))
      .toContain('alt="An aerial photograph"');
    for (const nothing of ['', '   ', null, undefined]) {
      expect(imgTag('x.png', { alt: nothing, style: '' })).toContain(`alt="${MISSING_ALT}"`);
    }
    expect(imgTag('x.png', { style: '' })).toContain(`alt="${MISSING_ALT}"`);
  });

  it('escapes the alt, which is author- and data-supplied', () => {
    const html = imgTag('x.png', { alt: '" onerror="alert(1)', style: '' });
    expect(html).not.toContain('onerror="alert');
    expect(html).toContain('&quot;');
  });

  it('falls back to the block\'s own designer label before giving up', () => {
    // Not a guess: the label is text a person wrote about this block. The
    // catalogue's cover monogram is named "Brand mark", and on the 36-page
    // Templates render that is the difference between a reader hearing
    // "Brand mark" and hearing that the description is missing. After this the
    // production document carries zero undescribed images.
    const src = readFileSync(resolve(DIR, 'image.html.ts'), 'utf8');
    expect(code(src)).toMatch(/alt:[\s\S]*?\|\|\s*block\.name/);
  });

  it('names a missing description rather than inventing a plausible one', () => {
    // A picture nobody described is a gap. A gap that reads as a description
    // is worse than one that reads as a gap.
    expect(MISSING_ALT).toMatch(/no description/i);
  });
});
