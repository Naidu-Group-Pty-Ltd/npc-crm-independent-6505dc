/**
 * The sales-register vocabulary: periods, tokens and the number cells the
 * publishers actually write.
 */
import { describe, expect, it } from 'vitest';

import {
  comparePeriods,
  dwellingWords,
  isPeriod,
  parseNumberCell,
  periodEndDate,
  periodLabel,
  periodOf,
  periodYearsBefore,
  quarterEndMonth,
  salesAreaToken,
} from '@/lib/reports/market/openData/salesRegister.pure';

describe('periods are the quarter the sales settled in', () => {
  it('reads the publisher\'s month and year cells', () => {
    expect(periodOf('Jun', 2008)).toBe('2008-06');
    expect(periodOf('Mar', '2026')).toBe('2026-03');
    expect(periodOf('September', 2024)).toBe('2024-09');
    expect(periodOf('Jan', 2020)).toBeNull();   // no quarter ends in January
    expect(periodOf('Jun', 'x')).toBeNull();
    expect(quarterEndMonth('dec')).toBe('12');
    expect(quarterEndMonth('may')).toBeNull();
  });

  it('knows a period when it sees one', () => {
    expect(isPeriod('2026-03')).toBe(true);
    expect(isPeriod('2026-04')).toBe(false);
    expect(isPeriod('26-03')).toBe(false);
  });

  it('steps back whole years and ends on the quarter\'s last day', () => {
    expect(periodYearsBefore('2026-03', 5)).toBe('2021-03');
    expect(periodEndDate('2026-03')).toBe('2026-03-31');
    expect(periodEndDate('2025-06')).toBe('2025-06-30');
    expect(periodEndDate('2025-09')).toBe('2025-09-30');
    expect(periodEndDate('2025-12')).toBe('2025-12-31');
    expect(periodLabel('2026-03')).toBe('March 2026 quarter');
    expect(['2025-12', '2026-03', '2019-06'].sort(comparePeriods)).toEqual(['2019-06', '2025-12', '2026-03']);
  });
});

describe('an area is looked up by a token, never by the publisher\'s dressing', () => {
  it('makes the cadastre and the statistician agree on a council', () => {
    expect(salesAreaToken('lga', 'Moreton Bay (C)')).toBe(salesAreaToken('lga', 'MORETON BAY REGIONAL'));
    expect(salesAreaToken('lga', 'Moreton Bay (C)')).toBe(salesAreaToken('lga', 'Moreton Bay Regional Council'));
    expect(salesAreaToken('lga', 'Isaac (R)')).toBe(salesAreaToken('lga', 'Isaac Regional'));
    expect(salesAreaToken('lga', 'Brisbane (C)')).toBe(salesAreaToken('lga', 'BRISBANE CITY'));
    expect(salesAreaToken('lga', 'The Hills Shire')).toBe(salesAreaToken('lga', 'The Hills'));
  });

  it('keeps distinct councils distinct', () => {
    expect(salesAreaToken('lga', 'Moreton Bay (C)')).not.toBe(salesAreaToken('lga', 'Bayside (C)'));
    expect(salesAreaToken('lga', 'Canterbury-Bankstown')).not.toBe(salesAreaToken('lga', 'Bankstown'));
  });

  it('a postcode token is its digits', () => {
    expect(salesAreaToken('postcode', ' 2155 ')).toBe('2155');
    expect(salesAreaToken('postcode', '2155')).toBe('2155');
  });
});

describe('a suppressed figure is null, never zero', () => {
  it('reads the publishers\' own suppression marks as absent', () => {
    for (const mark of ['-', '–', '..', 'n.p.', 'np', 'n.a.', '', '   ', '*']) {
      expect(parseNumberCell(mark), JSON.stringify(mark)).toBeNull();
    }
  });
  it('reads numbers however they are written', () => {
    expect(parseNumberCell(1435)).toBe(1435);
    expect(parseNumberCell('1435')).toBe(1435);
    expect(parseNumberCell('31,434')).toBe(31434);
    expect(parseNumberCell('$1,050')).toBe(1050);
    expect(parseNumberCell('-9.68%')).toBeNull();   // a percentage is not a price or a count
    expect(parseNumberCell(null)).toBeNull();
    expect(parseNumberCell(Number.NaN)).toBeNull();
  });
  it('names dwellings for a reader', () => {
    expect(dwellingWords('house')).toBe('houses');
    expect(dwellingWords('attached')).toBe('units and townhouses');
    expect(dwellingWords('any')).toBe('all dwellings');
  });
});
