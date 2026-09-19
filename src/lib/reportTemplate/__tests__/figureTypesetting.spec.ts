/**
 * How a figure's sign is set.
 *
 * Two blocks draw the same numbers — `dataTable` in a ruled column and
 * `kpiGrid` in the cover band — and until they shared these helpers they
 * disagreed about both things a sign carries. `dataTable` printed a negative in
 * the brand's print-weight red; `kpiGrid` printed it in body ink, which is why
 * a cover headlining "WEEKLY POSITION −$697" set the one figure a client looks
 * at first as though it were a gain. REPORT_RULES §7: "the sign is the
 * most-read thing on the page."
 *
 * The glyph is the other half. A hyphen-minus is a short dash on the lowercase
 * axis; U+2212 is drawn to the width of a digit and sits on the figure's own
 * axis. Down a right-aligned column of tabular numerals, hyphens do not line up
 * with each other, let alone with the digits above them.
 *
 * The conversion is deliberately narrow, and the cases it must NOT touch are
 * the point of this file: the damage from over-converting runs into every
 * hyphenated word and date range in a model-authored report.
 */
import { describe, expect, it } from 'vitest';
import { isNegativeFigure, typesetFigure } from '../blocks/_data';

describe('typesetFigure', () => {
  it.each([
    ['-$697', '−$697', 'a bare currency figure'],
    ['-1,234', '−1,234', 'a bare number'],
    ['-1.2%', '−1.2%', 'a percentage'],
    ['-(1,234)', '−(1,234)', 'an accounting parenthesis'],
    ['Net cash position: -$1,183 a month', 'Net cash position: −$1,183 a month', 'a figure inside a sentence'],
    ['-$50 and -$60', '−$50 and −$60', 'every figure in the string, not just the first'],
  ])('converts %s', (input, expected) => {
    expect(typesetFigure(input)).toBe(expected);
  });

  it.each([
    ['cost-benefit', 'a hyphenated word'],
    ['well-located', 'another hyphenated word'],
    ['Ex-Melbourne', 'a hyphenated proper noun'],
    ['3-bedroom', 'a hyphenated compound opening with a digit'],
    ['2024-2026', 'a date range'],
    ['the price - 5% off', 'a spaced hyphen used as a dash'],
    ['$1,234', 'a positive figure'],
    ['', 'an empty string'],
  ])('leaves %s alone', (input) => {
    expect(typesetFigure(input)).toBe(input);
  });

  it('is safe on absent values', () => {
    expect(typesetFigure(null)).toBe('');
    expect(typesetFigure(undefined)).toBe('');
  });

  it('is idempotent', () => {
    // The projections are not the only thing that can reach a block, and a
    // value that has already been set must not be re-scanned into something
    // else.
    const once = typesetFigure('-$1,183');
    expect(typesetFigure(once)).toBe(once);
  });
});

describe('isNegativeFigure', () => {
  it('recognises a negative however its sign is drawn', () => {
    // Both glyphs, because the check runs after `typesetFigure` in one block
    // and could run before it in another.
    expect(isNegativeFigure('-$697')).toBe(true);
    expect(isNegativeFigure('−$697')).toBe(true);
    expect(isNegativeFigure('−1,234')).toBe(true);
    expect(isNegativeFigure('  −$697  ')).toBe(true);
  });

  it('does not call a positive figure, a word or a placeholder negative', () => {
    expect(isNegativeFigure('$697')).toBe(false);
    expect(isNegativeFigure('—')).toBe(false);
    expect(isNegativeFigure('Pending')).toBe(false);
    expect(isNegativeFigure('')).toBe(false);
    expect(isNegativeFigure(null)).toBe(false);
    // A mid-string figure is not the cell's own sign.
    expect(isNegativeFigure('Net position: -$1,183')).toBe(false);
  });
});
