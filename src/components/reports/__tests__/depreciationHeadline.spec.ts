/**
 * The Depreciation Value Calculator's headline figure stays a headline.
 *
 * The Reports page is wrapped in `.ci-foundation`, and report-qa.css styles
 * every `<p>` that is a direct child of `.space-y-1` / `.space-y-2` there as
 * small muted helper text. That selector out-ranks a utility class, so the
 * `text-4xl font-bold text-primary` figure — the ten-year claim total — was
 * drawn at 12px in the muted colour from the day the page was wrapped. jsdom
 * applies no stylesheet, so a render test cannot see it; this reads the two
 * sources instead.
 *
 * The guarded classes are read from the stylesheet rather than restated, so a
 * new `.space-y-N > p` rule there reaches this guard without editing it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../..');
const component = readFileSync(
  resolve(root, 'src/components/reports/DepreciationValueCalculator.tsx'),
  'utf8',
);
const stylesheet = readFileSync(resolve(root, 'src/styles/report-qa.css'), 'utf8');

/** Every `space-y-N` class whose direct `<p>` children .ci-foundation restyles. */
function restyledSpacingClasses(css: string): string[] {
  const found = new Set<string>();
  for (const m of css.matchAll(/\.ci-foundation\s+\.(space-y-[\w.-]+)\s*>\s*p\b/g)) {
    found.add(m[1]);
  }
  return [...found];
}

/** The className of the element that directly encloses the headline figure. */
function headlineContainerClasses(source: string): string[] {
  const headline = source.indexOf('<p className="text-4xl font-bold text-primary">');
  expect(headline, 'the headline figure is no longer where this guard expects it').toBeGreaterThan(0);
  const before = source.slice(0, headline);
  const opener = before.lastIndexOf('<div className="');
  expect(opener).toBeGreaterThan(0);
  const classAttr = before.slice(opener).match(/^<div className="([^"]*)"/);
  return (classAttr?.[1] ?? '').split(/\s+/).filter(Boolean);
}

describe('Depreciation Value Calculator headline figure', () => {
  it('reads the restyled spacing classes from the stylesheet', () => {
    expect(restyledSpacingClasses(stylesheet)).toEqual(
      expect.arrayContaining(['space-y-1', 'space-y-2']),
    );
  });

  it('still binds the ten-year total in the headline', () => {
    expect(component).toMatch(
      /<p className="text-4xl font-bold text-primary">\s*\{formatDepreciationValue\(result\.dvTotal\)\}/,
    );
  });

  it('is not a direct child of a container .ci-foundation shrinks to helper text', () => {
    const container = headlineContainerClasses(component);
    for (const cls of restyledSpacingClasses(stylesheet)) {
      expect(container, `the headline's container carries ${cls}`).not.toContain(cls);
    }
    // The spacing the container had is kept, by a mechanism the rule cannot see.
    expect(container).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-2']));
  });
});
