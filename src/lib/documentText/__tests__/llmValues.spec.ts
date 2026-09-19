import { describe, expect, it } from 'vitest';
import {
  coerceAuPostcode,
  coerceAuState,
  coerceBoolean,
  coerceEnum,
  coerceInteger,
  coerceIsoDate,
  coerceNumber,
  coercePercent,
  coerceStringArray,
  coerceText,
  extractJsonBlock,
  isNullish,
  parseLlmJson,
} from '../llmValues';

describe('extractJsonBlock / parseLlmJson', () => {
  it('reads plain JSON', () => {
    expect(parseLlmJson('{"price": 1}')).toEqual({ price: 1 });
  });

  it('unwraps a markdown code fence', () => {
    expect(parseLlmJson('```json\n{"price": 2}\n```')).toEqual({ price: 2 });
  });

  it('ignores prose around the JSON', () => {
    expect(parseLlmJson('Here is what I found:\n{"price": 3}\nHope that helps!')).toEqual({ price: 3 });
  });

  it('does not stop at a brace inside a string value', () => {
    expect(parseLlmJson('{"note": "closes } here", "price": 4}')).toEqual({
      note: 'closes } here',
      price: 4,
    });
  });

  it('handles an escaped quote before a brace', () => {
    expect(parseLlmJson('{"note": "say \\"} \\" ok", "price": 5}')).toEqual({
      note: 'say "} " ok',
      price: 5,
    });
  });

  it('repairs a trailing comma', () => {
    expect(parseLlmJson('{"price": 6,}')).toEqual({ price: 6 });
  });

  it('repairs bare undefined/NaN values', () => {
    expect(parseLlmJson('{"a": undefined, "b": NaN, "c": 1}')).toEqual({ a: null, b: null, c: 1 });
  });

  it('reads a top-level array', () => {
    expect(parseLlmJson('[{"a": 1}, {"a": 2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('returns null rather than throwing on unrecoverable output', () => {
    expect(parseLlmJson('I could not read the document.')).toBeNull();
    expect(extractJsonBlock('{"unbalanced": ')).toBeNull();
    expect(parseLlmJson('')).toBeNull();
  });
});

describe('isNullish', () => {
  it.each(['', 'N/A', 'n/a', 'not stated', 'TBC', '-', 'null', 'Unknown'])(
    'treats %s as absent',
    (value) => expect(isNullish(value)).toBe(true),
  );

  it('treats real content as present', () => {
    expect(isNullish('Richmond')).toBe(false);
    expect(isNullish(0)).toBe(false);
    expect(isNullish(false)).toBe(false);
  });
});

describe('coerceText', () => {
  it('drops null-ish sentinels instead of storing them as content', () => {
    expect(coerceText('Not stated')).toBeUndefined();
    expect(coerceText('N/A')).toBeUndefined();
    expect(coerceText(null)).toBeUndefined();
  });

  it('collapses whitespace and trims', () => {
    expect(coerceText('  12  Example   Street ')).toBe('12 Example Street');
  });

  it('truncates at a word boundary when capped', () => {
    expect(coerceText('alpha bravo charlie delta', { maxLength: 15 })).toBe('alpha bravo');
  });
});

describe('coerceNumber', () => {
  it('passes through real numbers', () => {
    expect(coerceNumber(850000)).toBe(850000);
    expect(coerceNumber(0)).toBe(0);
  });

  it.each([
    ['850000', 850000],
    ['$850,000', 850000],
    ['AU$1,250,000', 1250000],
    ['  1,200 ', 1200],
    ['6.25%', 6.25],
    ['approx. 450', 450],
    ['$800,000 - $850,000', 800000],
  ])('recovers %s that a strict typeof check would have dropped', (input, expected) => {
    expect(coerceNumber(input)).toBe(expected);
  });

  it('applies unambiguous magnitude words', () => {
    expect(coerceNumber('12.5 million')).toBe(12_500_000);
    expect(coerceNumber('850k')).toBe(850_000);
    expect(coerceNumber('1.4 bn')).toBe(1_400_000_000);
  });

  it('reads a trailing m as million only after a currency marker', () => {
    expect(coerceNumber('$1.2m')).toBe(1_200_000);
    expect(coerceNumber('AUD 1.2 m')).toBe(1_200_000);
    expect(coerceNumber('5.5m')).toBe(5.5);
    expect(coerceNumber('5.5m clearance')).toBe(5.5);
  });

  it('never reads a unit as a magnitude', () => {
    expect(coerceNumber('1,200 sqm')).toBe(1200);
    expect(coerceNumber('500 kVA')).toBe(500);
    expect(coerceNumber('3.2 ha')).toBe(3.2);
  });

  it('reads accounting-style negatives', () => {
    expect(coerceNumber('(12,500)')).toBe(-12500);
  });

  it('enforces range and precision guards', () => {
    expect(coerceNumber('1850', { min: 1900, max: 2100 })).toBeUndefined();
    expect(coerceNumber('1995', { min: 1900, max: 2100 })).toBe(1995);
    expect(coerceNumber('6.256789', { decimals: 2 })).toBe(6.26);
  });

  it('returns undefined for non-numeric and null-ish input', () => {
    expect(coerceNumber('Not stated')).toBeUndefined();
    expect(coerceNumber('house')).toBeUndefined();
    expect(coerceNumber(true)).toBeUndefined();
    expect(coerceNumber(null)).toBeUndefined();
  });
});

describe('coerceInteger', () => {
  it('rounds and range-checks', () => {
    expect(coerceInteger('4 bedrooms')).toBe(4);
    expect(coerceInteger('3.6')).toBe(4);
    expect(coerceInteger('40', { max: 20 })).toBeUndefined();
  });
});

describe('coercePercent', () => {
  it('keeps values that are already percent units', () => {
    expect(coercePercent('6.25%')).toBe(6.25);
    expect(coercePercent(6.25)).toBe(6.25);
  });

  it('scales a bare fraction to percent units', () => {
    expect(coercePercent(0.0625)).toBe(6.25);
  });

  it('does not rescale a small value that carried a percent sign', () => {
    expect(coercePercent('0.5%')).toBe(0.5);
  });

  it('respects an explicit fraction threshold of zero', () => {
    expect(coercePercent(0.0625, { fractionThreshold: 0 })).toBe(0.0625);
  });
});

describe('coerceBoolean', () => {
  it.each([['yes', true], ['Y', true], ['true', true], ['no', false], ['0', false]] as const)(
    'reads %s',
    (input, expected) => expect(coerceBoolean(input)).toBe(expected),
  );

  it('returns undefined when there is no yes/no signal', () => {
    expect(coerceBoolean('maybe')).toBeUndefined();
  });
});

describe('coerceEnum', () => {
  const allowed = ['going_concern', 'margin_scheme', 'standard'] as const;

  it('matches across case, spacing and punctuation', () => {
    expect(coerceEnum('Going Concern', allowed)).toBe('going_concern');
    expect(coerceEnum('margin-scheme', allowed)).toBe('margin_scheme');
  });

  it('resolves aliases', () => {
    expect(coerceEnum('GST free', allowed, { 'gst free': 'going_concern' })).toBe('going_concern');
  });

  it('drops values outside the enum instead of passing them through', () => {
    expect(coerceEnum('input taxed', allowed)).toBeUndefined();
  });
});

describe('coerceStringArray', () => {
  it('splits a delimited string and de-duplicates', () => {
    expect(coerceStringArray('Woolworths; Chemist Warehouse, Woolworths')).toEqual([
      'Woolworths',
      'Chemist Warehouse',
    ]);
  });

  it('filters null-ish members and caps length', () => {
    expect(coerceStringArray(['A', 'N/A', 'B', 'C'], { maxItems: 2 })).toEqual(['A', 'B']);
  });

  it('returns undefined when nothing survives', () => {
    expect(coerceStringArray(['N/A', ''])).toBeUndefined();
    expect(coerceStringArray(42)).toBeUndefined();
  });
});

describe('coerceIsoDate', () => {
  it.each([
    ['2027-12-31', '2027-12-31'],
    ['31/12/2027', '2027-12-31'],
    ['1.3.2028', '2028-03-01'],
    ['31 December 2027', '2027-12-31'],
    ['1st Jul 2026', '2026-07-01'],
    ['December 31, 2027', '2027-12-31'],
    ['Jun 2029', '2029-06-01'],
  ])('reads %s day-first', (input, expected) => {
    expect(coerceIsoDate(input)).toBe(expected);
  });

  it('falls back to month-first when day-first is impossible', () => {
    expect(coerceIsoDate('03/25/2027')).toBe('2027-03-25');
  });

  it('rejects impossible dates rather than rolling them over', () => {
    expect(coerceIsoDate('31/02/2027')).toBeUndefined();
    expect(coerceIsoDate('sometime next year')).toBeUndefined();
  });
});

describe('Australian address helpers', () => {
  it('normalises state names and abbreviations', () => {
    expect(coerceAuState('nsw')).toBe('NSW');
    expect(coerceAuState('Victoria')).toBe('VIC');
    expect(coerceAuState('Auckland')).toBeUndefined();
  });

  it('normalises postcodes, including a number and a 3-digit NT code', () => {
    expect(coerceAuPostcode(3121)).toBe('3121');
    expect(coerceAuPostcode(' 2000 ')).toBe('2000');
    expect(coerceAuPostcode('800')).toBe('0800');
    expect(coerceAuPostcode('12345')).toBeUndefined();
    expect(coerceAuPostcode('N/A')).toBeUndefined();
  });
});
