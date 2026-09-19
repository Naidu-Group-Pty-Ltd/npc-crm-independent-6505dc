import { describe, expect, it } from 'vitest';
import {
  DEPRECIATION_YEARS,
  parseFinancialInput,
  hasManualDepreciationOverride,
  resolveYearDepreciation,
  cloneYearlyOverrides,
  hydrateYearlyOverrides,
  getDirtyDepreciationYears,
  isDepreciationDirty,
} from '../cashFlowDepreciation';

// Reproduces the exact depreciation resolution the projection table uses, so
// these tests exercise the real Save/rehydrate/recalculation contract.
type Overrides = { [year: number]: { depreciation?: number | null } };

const resolveScheduleForYear = (
  year: number,
  overrides: Overrides,
  schedule: Record<number, number> | undefined,
  defaultValue: number,
) =>
  resolveYearDepreciation({
    year,
    override: overrides[year]?.depreciation,
    scheduleValue: schedule?.[year],
    defaultValue,
  });

describe('cashFlowDepreciation - canonical model', () => {
  it('exposes a 10-year schedule', () => {
    expect(DEPRECIATION_YEARS).toBe(10);
  });

  it('Year 1 maps to key 1 and Year 10 maps to key 10 (no Year 0 / Year 11)', () => {
    const schedule: Record<number, number> = {
      1: 16000, 2: 14000, 3: 12000, 4: 10000, 5: 9000,
      6: 8000, 7: 7000, 8: 6000, 9: 5000, 10: 5000,
    };
    expect(resolveScheduleForYear(1, {}, schedule, 6000)).toBe(16000);
    expect(resolveScheduleForYear(10, {}, schedule, 6000)).toBe(5000);
    // Year 0 (today column) never carries depreciation.
    expect(resolveScheduleForYear(0, {}, schedule, 6000)).toBe(0);
  });
});

describe('parseFinancialInput', () => {
  it('parses plain numbers', () => {
    expect(parseFinancialInput('16000')).toBe(16000);
    expect(parseFinancialInput('12000.5')).toBe(12000.5);
  });

  it('strips currency symbols and thousands separators', () => {
    expect(parseFinancialInput('$16,000')).toBe(16000);
    expect(parseFinancialInput('16 000')).toBe(16000);
    expect(parseFinancialInput('$1,234.56')).toBe(1234.56);
  });

  it('treats zero as a valid value, not missing', () => {
    expect(parseFinancialInput('0')).toBe(0);
    expect(parseFinancialInput(0)).toBe(0);
    expect(parseFinancialInput('$0')).toBe(0);
  });

  it('returns null for empty / whitespace / partial input', () => {
    expect(parseFinancialInput('')).toBeNull();
    expect(parseFinancialInput('   ')).toBeNull();
    expect(parseFinancialInput('.')).toBeNull();
    expect(parseFinancialInput('-')).toBeNull();
    expect(parseFinancialInput(null)).toBeNull();
    expect(parseFinancialInput(undefined)).toBeNull();
  });

  it('rejects invalid text', () => {
    expect(parseFinancialInput('abc')).toBeNull();
    expect(parseFinancialInput('N/A')).toBeNull();
  });

  it('accepts negative numbers (parsing layer stays neutral on sign policy)', () => {
    expect(parseFinancialInput('-500')).toBe(-500);
  });
});

describe('hasManualDepreciationOverride', () => {
  it('is true for any real number including zero', () => {
    expect(hasManualDepreciationOverride(0)).toBe(true);
    expect(hasManualDepreciationOverride(16000)).toBe(true);
  });
  it('is false for null / undefined', () => {
    expect(hasManualDepreciationOverride(null)).toBe(false);
    expect(hasManualDepreciationOverride(undefined)).toBe(false);
  });
});

describe('resolveYearDepreciation - priority', () => {
  const schedule = { 1: 16000, 2: 14000 };

  it('uses the manual override ahead of the generated schedule', () => {
    expect(
      resolveYearDepreciation({ year: 1, override: 20000, scheduleValue: 16000, defaultValue: 6000 }),
    ).toBe(20000);
  });

  it('honours a manual override of zero (does not fall through to schedule/default)', () => {
    expect(
      resolveYearDepreciation({ year: 1, override: 0, scheduleValue: 16000, defaultValue: 6000 }),
    ).toBe(0);
  });

  it('falls back to the schedule when there is no override', () => {
    expect(resolveScheduleForYear(2, {}, schedule, 6000)).toBe(14000);
  });

  it('falls back to the single default when neither override nor schedule exist', () => {
    expect(resolveScheduleForYear(3, {}, schedule, 6000)).toBe(6000);
  });

  it('recalculation uses the edited depreciation value', () => {
    const overrides: Overrides = { 1: { depreciation: 25000 } };
    expect(resolveScheduleForYear(1, overrides, schedule, 6000)).toBe(25000);
  });

  it('generated schedule does NOT overwrite a saved manual value', () => {
    // Year 1 was edited to 20000 and saved; schedule still says 16000.
    const savedOverrides: Overrides = { 1: { depreciation: 20000 } };
    const hydrated = hydrateYearlyOverrides<{ depreciation?: number | null }>(savedOverrides);
    expect(resolveScheduleForYear(1, hydrated, schedule, 6000)).toBe(20000);
    // Non-edited year still tracks the generated schedule.
    expect(resolveScheduleForYear(2, hydrated, schedule, 6000)).toBe(14000);
  });
});

describe('cloneYearlyOverrides / hydrateYearlyOverrides - immutability', () => {
  it('deep-clones so editing the draft never mutates the source', () => {
    const source: Overrides = { 1: { depreciation: 16000 } };
    const draft = cloneYearlyOverrides(source);
    draft[1].depreciation = 99999;
    expect(source[1].depreciation).toBe(16000); // original untouched
  });

  it('hydrate returns saved overrides without seeding the schedule', () => {
    const saved: Overrides = { 1: { depreciation: 20000 } };
    const hydrated = hydrateYearlyOverrides<{ depreciation?: number | null }>(saved);
    // Only the explicitly-saved year is present; other years remain absent so
    // they fall back to the generated schedule at projection time.
    expect(hydrated[1].depreciation).toBe(20000);
    expect(hydrated[2]).toBeUndefined();
  });

  it('handles null / empty input safely', () => {
    expect(cloneYearlyOverrides(null)).toEqual({});
    expect(cloneYearlyOverrides(undefined)).toEqual({});
  });
});

describe('dirty state', () => {
  it('is not dirty when draft equals saved', () => {
    const saved: Overrides = { 1: { depreciation: 16000 } };
    const draft: Overrides = { 1: { depreciation: 16000 } };
    expect(isDepreciationDirty(draft, saved)).toBe(false);
    expect(getDirtyDepreciationYears(draft, saved)).toEqual([]);
  });

  it('is dirty when exactly one year differs', () => {
    const saved: Overrides = { 1: { depreciation: 16000 } };
    const draft: Overrides = { 1: { depreciation: 20000 } };
    expect(isDepreciationDirty(draft, saved)).toBe(true);
    expect(getDirtyDepreciationYears(draft, saved)).toEqual([1]);
  });

  it('treats a change to zero as dirty (0 is a real edit, not "missing")', () => {
    const saved: Overrides = { 5: { depreciation: 9000 } };
    const draft: Overrides = { 5: { depreciation: 0 } };
    expect(getDirtyDepreciationYears(draft, saved)).toEqual([5]);
  });

  it('editing Year 5 marks only Year 5 dirty', () => {
    const saved: Overrides = {};
    const draft: Overrides = { 5: { depreciation: 12345 } };
    expect(getDirtyDepreciationYears(draft, saved)).toEqual([5]);
  });
});

describe('save payload completeness', () => {
  it('all ten years resolve to a value for the persisted schedule', () => {
    const schedule: Record<number, number> = {
      1: 16000, 2: 14000, 3: 12000, 4: 10000, 5: 9000,
      6: 8000, 7: 7000, 8: 6000, 9: 5000, 10: 5000,
    };
    const overrides: Overrides = { 1: { depreciation: 20000 }, 7: { depreciation: 0 } };
    const payload: number[] = [];
    for (let year = 1; year <= DEPRECIATION_YEARS; year++) {
      payload.push(resolveScheduleForYear(year, overrides, schedule, 6000));
    }
    expect(payload).toHaveLength(10);
    expect(payload[0]).toBe(20000); // Year 1 edited
    expect(payload[6]).toBe(0); // Year 7 edited to zero persists
    expect(payload[9]).toBe(5000); // Year 10 from schedule
    expect(payload.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
  });
});
