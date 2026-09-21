/**
 * A placeholder reached a client page through a door the scrub cannot see.
 *
 * Page 20 of the 9 Hollow Street Compass of 20 Sep 2026, read off the
 * delivered PDF's own geometry — three label cells at x=61 and two values at
 * x=426:
 *
 *     Subject price against Golden Square house market
 *     Item                              | Value ($)
 *     Subject                           | $387,500
 *     Golden Square house median        | $567,500
 *     Victoria dwellings benchmark n/a  |
 *
 * The model wrote `Victoria dwellings benchmark n/a` as a bar item. The
 * directive parser refused it — no figure — and `renderVizDirective` set the
 * chart as the table its data already was, which is the right call: a promise
 * of a figure is a figure, and the other two items are real.
 *
 * Two things then went wrong. `splitRefusedItem` has no rule for a tail with
 * no digits in it, so the `n/a` stayed glued to the LABEL and the value cell
 * printed empty. And `stripPlaceholderRows` could not have removed the row
 * either way: the table is built at RENDER time and never exists as markdown
 * the scrub reads.
 *
 * The owner's rule is "N/A or unavailable, never".
 */
import { describe, expect, it } from 'vitest';
import {
  isPlaceholderValue,
  parseVizDirective,
  splitRefusedItem,
} from '../vizDirectives.pure';
import { directiveAsMarkdown, refusedRows } from '../vizDirectiveTables.pure';
import { presentStoredMarkdown } from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';

const HOLLOW = 'Subject $387,500, Golden Square house median $567,500, '
  + 'Victoria dwellings benchmark n/a | title=Subject price against Golden Square house market';

describe('a placeholder written where a figure belonged', () => {
  it('is read as a VALUE, not as part of the label', () => {
    expect(splitRefusedItem('Victoria dwellings benchmark n/a'))
      .toEqual({ label: 'Victoria dwellings benchmark', value: 'n/a' });
    expect(splitRefusedItem('Vacancy unknown'))
      .toEqual({ label: 'Vacancy', value: 'unknown' });
  });

  it('leaves the two rules that already worked exactly as they were', () => {
    // A numeric tail, and the interpunct form the prompt's own examples use.
    expect(splitRefusedItem('Schools (primary & secondary) ~0.5–1.6 km'))
      .toEqual({ label: 'Schools (primary & secondary)', value: '~0.5–1.6 km' });
    expect(splitRefusedItem('Subject dwelling · 3-bed house'))
      .toEqual({ label: 'Subject dwelling', value: '3-bed house' });
    // And an item with nothing value-shaped on the tail is still the item
    // verbatim: the model wrote a label where a figure belonged.
    expect(splitRefusedItem('Nothing here at all'))
      .toEqual({ label: 'Nothing here at all', value: '' });
  });

  it('does not reach the table', () => {
    const md = directiveAsMarkdown(parseVizDirective('bars', HOLLOW)!)!;
    expect(md).toContain('| Subject | $387,500 |');
    expect(md).toContain('| Golden Square house median | $567,500 |');
    expect(md).not.toMatch(/n\/a/i);
    expect(md).not.toContain('Victoria dwellings benchmark');
  });

  it('draws nothing at all where every row is a placeholder', () => {
    // An absence is omitted, never worded — a table of three dashes is the
    // wording.
    expect(refusedRows(['Vacancy n/a', 'Days on market n/a'])).toEqual([]);
    const md = directiveAsMarkdown(
      parseVizDirective('bars', 'Vacancy n/a, Days on market tbd | title=Market')!,
    );
    expect(md === null || !/n\/a|tbd/i.test(md)).toBe(true);
  });

  it('keeps every real row when a directive carries no placeholder', () => {
    const md = directiveAsMarkdown(parseVizDirective(
      'bars', 'Schools ~0.5–1.6 km, Metro station ~2.1 km | title=Access',
    )!)!;
    expect(md).toContain('| Schools | ~0.5–1.6 km |');
    expect(md).toContain('| Metro station | ~2.1 km |');
  });

  it('names one vocabulary for what a value is not', () => {
    for (const v of ['n/a', 'N/A', 'tbd', 'not available', 'unknown', 'no data', '—', '', '  ']) {
      expect(isPlaceholderValue(v), v).toBe(true);
    }
    for (const v of ['$387,500', '0', '0%', '~2.1 km', '3-bed house']) {
      expect(isPlaceholderValue(v), v).toBe(false);
    }
  });
});

describe('the scrub runs again where the chart passes make tables', () => {
  it('removes a placeholder row a tabulation produced', () => {
    /*
     * `stripPlaceholderRows` is the FIRST pass in `presentStoredMarkdown` and
     * `tabulateMixedUnitCharts` is five passes below it, so a row the scrub
     * exists to remove can be created after it has run. The second pass is
     * idempotent, so it is a no-op on a document whose charts produced none.
     */
    const md = [
      '## Market Positioning',
      '',
      '{{bars: Metro station ~2.1 km, Walk to school 99.1%, Vacancy n/a | title=Access}}',
      '',
      'After.',
    ].join('\n');
    const out = presentStoredMarkdown(md);
    expect(out).not.toMatch(/\|\s*Vacancy\s*\|\s*n\/a\s*\|/i);
    expect(out).toContain('After.');
  });

  it('is byte-identical on a document with no placeholder anywhere', () => {
    const md = '## Market Positioning\n\nThe suburb median is $567,500.\n';
    expect(presentStoredMarkdown(md)).toBe(md);
  });
});
