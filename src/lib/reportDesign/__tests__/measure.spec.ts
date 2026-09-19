/**
 * A number in this report is never just a number.
 *
 * Most of what is asserted here would be obvious if the shipping report did not
 * get it wrong. It tells a client their assessment rate went from **$6 to $9**
 * (`BORROWING_CAPACITY.md` F2) because one formatter is applied to every value
 * regardless of what the value is. These tests pin the alternative.
 */
import { describe, expect, it } from 'vitest';

import {
  aud,
  audPerMonth,
  audPerYear,
  comparable,
  count,
  formatDelta,
  formatMeasure,
  isMoney,
  NO_MEASURE,
  percent,
  rate,
  ratio,
  subtract,
  years,
} from '../measure.pure';

describe('formatMeasure', () => {
  it.each([
    ['a capacity', aud(785_000), '$785,000'],
    ['a monthly repayment', audPerMonth(2_480), '$2,480/mo'],
    ['an annual income', audPerYear(186_000), `$186,000\u00A0pa`],
    ['an interest rate', percent(8.65), '8.65%'],
    ['a shading fraction', rate(0.8), '80%'],
    ['a DTI', ratio(5.4), '5.4x'],
    ['a loan term', years(30), '30 years'],
    ['a count', count(6), '6'],
  ])('renders %s', (_label, measure, expected) => {
    expect(formatMeasure(measure)).toBe(expected);
  });

  /**
   * The finding, stated as a test. `percent(8.65)` and `aud(8.65)` are the same
   * number; only the unit tells them apart, and the unit has to survive as far
   * as the formatter for that to be worth anything.
   */
  it('does not render an interest rate as money (F2)', () => {
    expect(formatMeasure(percent(8.65))).toBe('8.65%');
    expect(formatMeasure(percent(8.65))).not.toBe('$9');
    expect(formatMeasure(aud(8.65))).toBe('$9');
  });

  /**
   * Shading is stored as a 0–1 fraction and interest rates are stored already
   * scaled. Reading one as the other is how a 0.8 shading rate has been printed
   * as both "1%" and "80%" by generators looking at the same column.
   */
  it('keeps a 0–1 fraction and an already-scaled percentage apart', () => {
    expect(formatMeasure(rate(0.8))).toBe('80%');
    expect(formatMeasure(percent(0.8))).toBe('0.80%');
  });

  it('renders a zero shading rate as 0%, not 100%', () => {
    expect(formatMeasure(rate(0))).toBe('0%');
  });

  it('groups thousands', () => {
    expect(formatMeasure(aud(1_234_567))).toBe('$1,234,567');
    expect(formatMeasure(aud(999))).toBe('$999');
    expect(formatMeasure(aud(1_000))).toBe('$1,000');
  });

  it('puts the minus sign outside the dollar sign', () => {
    expect(formatMeasure(aud(-4_820))).toBe('-$4,820');
    expect(formatMeasure(audPerMonth(-1_310))).toBe('-$1,310/mo');
  });

  /** A value that rounds to zero is zero. `-$0` is noise dressed as precision. */
  it('does not render a negative sign on a value that rounds to zero', () => {
    expect(formatMeasure(aud(-0.4))).toBe('$0');
    expect(formatMeasure(aud(-0))).toBe('$0');
  });

  it('honours an explicit precision', () => {
    expect(formatMeasure(rate(0.875, 1))).toBe('87.5%');
    expect(formatMeasure(aud(1_234.56, 2))).toBe('$1,234.56');
  });

  it('says "1 year", not "1 years"', () => {
    expect(formatMeasure(years(1))).toBe('1 year');
    expect(formatMeasure(years(2))).toBe('2 years');
  });

  /**
   * `audit.add('policy', 'lender_profile_selected', …, 0, 0, …)` is a real
   * entry whose two zeroes mean "not applicable". Rendering `$0 → $0` states a
   * fact that is not true (F14).
   */
  it('renders an inapplicable value as an em dash, not as zero', () => {
    expect(formatMeasure(NO_MEASURE)).toBe('—');
    expect(formatMeasure(NO_MEASURE, '')).toBe('');
  });

  it('renders a non-finite value as an em dash rather than NaN', () => {
    expect(formatMeasure(aud(Number.NaN))).toBe('—');
    expect(formatMeasure(percent(Number.POSITIVE_INFINITY))).toBe('—');
  });
});

describe('formatDelta', () => {
  it('always signs a change', () => {
    expect(formatDelta(audPerMonth(700))).toBe('+$700/mo');
    expect(formatDelta(audPerYear(-4_000))).toBe(`-$4,000\u00A0pa`);
    expect(formatDelta(percent(2.5))).toBe('+2.50%');
  });

  it('renders no change as an em dash rather than +$0', () => {
    expect(formatDelta(aud(0))).toBe('—');
    expect(formatDelta(aud(0.2))).toBe('—');
  });
});

describe('comparable / subtract', () => {
  it('subtracts two measures of the same unit', () => {
    expect(subtract(percent(8.65), percent(6.15))).toEqual({ value: 2.5, unit: 'percent', precision: undefined });
  });

  /**
   * The liability audit entry compares a **balance** against a **monthly
   * repayment** and the shipping report prints the difference as though it
   * meant something (F13). Both are money. They are not the same unit.
   */
  it('refuses to subtract a balance from a monthly repayment (F13)', () => {
    expect(comparable(aud(412_000), audPerMonth(2_480))).toBe(false);
    expect(subtract(audPerMonth(2_480), aud(412_000))).toBeNull();
  });

  it('treats all three money units as money, and as distinct', () => {
    expect(isMoney('aud')).toBe(true);
    expect(isMoney('aud/month')).toBe(true);
    expect(isMoney('aud/year')).toBe(true);
    expect(isMoney('percent')).toBe(false);
    expect(comparable(audPerYear(1), audPerMonth(1))).toBe(false);
  });
});
