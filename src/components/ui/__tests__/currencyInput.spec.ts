import { describe, expect, it } from 'vitest';

import { groupDigits, parseGrouped } from '../currency-input';

describe('groupDigits', () => {
  it('groups an amount the way an adviser reads one', () => {
    expect(groupDigits('1500000')).toBe('1,500,000');
    expect(groupDigits('725000')).toBe('725,000');
    expect(groupDigits('999')).toBe('999');
  });

  it('leaves the fraction exactly as typed, so a decimal can be typed at all', () => {
    // Re-writing these mid-entry is what makes a decimal point impossible.
    expect(groupDigits('1500.')).toBe('1,500.');
    expect(groupDigits('1500.5')).toBe('1,500.5');
    expect(groupDigits('1500.50')).toBe('1,500.50');
    expect(groupDigits('.5')).toBe('0.5');
  });

  it('ignores separators already in the text, so re-formatting is stable', () => {
    expect(groupDigits('1,500,000')).toBe('1,500,000');
    expect(groupDigits(groupDigits('1500000'))).toBe('1,500,000');
  });

  it('drops anything that is not part of a number', () => {
    expect(groupDigits('$1 500 000')).toBe('1,500,000');
    expect(groupDigits('abc')).toBe('');
  });

  it('keeps a leading minus for an adjustment', () => {
    expect(groupDigits('-2500')).toBe('-2,500');
    expect(groupDigits('-')).toBe('-');
  });

  it('keeps only the first decimal point', () => {
    expect(groupDigits('1500.25.75')).toBe('1,500.2575');
  });

  it('is empty for an empty field', () => {
    expect(groupDigits('')).toBe('');
  });
});

describe('parseGrouped', () => {
  it('answers the number the field stands for', () => {
    expect(parseGrouped('1,500,000')).toBe(1500000);
    expect(parseGrouped('1,500.50')).toBe(1500.5);
    expect(parseGrouped('-2,500')).toBe(-2500);
  });

  it('answers null for a field that stands for no number', () => {
    // Empty is not zero. Every consumer in this codebase pays for that
    // distinction somewhere, so the input must not blur it.
    expect(parseGrouped('')).toBeNull();
    expect(parseGrouped('-')).toBeNull();
    expect(parseGrouped('.')).toBeNull();
  });

  it('round-trips whatever groupDigits produced', () => {
    for (const raw of ['0', '5', '999', '1500000', '1500.5', '-2500']) {
      expect(parseGrouped(groupDigits(raw))).toBe(Number(raw));
    }
  });

  it('reads zero as zero, not as empty', () => {
    expect(parseGrouped('0')).toBe(0);
  });
});
