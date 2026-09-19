/**
 * The trust boundary, tested from the outside.
 *
 * This payload comes from a browser. Everything below is a way the wire can be
 * wrong that would otherwise reach a client's letterhead — a `NaN` in a
 * projection table, a rate that is off by a factor of a hundred, an equity
 * figure that disagrees with the value and loan printed beside it.
 *
 * The fixtures are fictional. A golden is committed, rasterised and shared;
 * real client financials must never be the thing that gets shared.
 */
import { describe, expect, it } from 'vitest';

import {
  buildProjection,
  CashFlowPayloadError,
  describeProjection,
  loanTypeLabel,
  MAX_PROJECTION_YEARS,
  toAcquisition,
  toOutcome,
  toProjectionYear,
} from '../normalise.pure';
import { formatMeasure } from '@/lib/reportDesign/measure.pure';

const YEAR = {
  year: 1,
  propertyValue: 815_100,
  loanBalance: 612_768,
  rentalIncome: 32_240,
  grossYield: 3.96,
  netYield: 2.53,
  expenses: 11_657,
  interestRate: 6.15,
  interest: 37_685,
  principal: 11_232,
  preTaxAnnual: -29_534,
  afterTaxAnnual: -18_692,
  depreciation: 11_000,
  taxRefund: 10_842,
  landTax: 1_200,
  capitalGrowth: 4.5,
  cpiGrowth: 2.5,
};

const ACQUISITION = {
  purchasePrice: 780_000,
  marketValue: 780_000,
  deposit: 156_000,
  loanAmount: 624_000,
  loanTermYears: 30,
  interestRate: 6.15,
  loanType: 'principal_interest',
  weeklyRent: 620,
  costs: [
    { label: 'Stamp duty', amount: 31_090 },
    { label: 'Lenders mortgage insurance', amount: 0 },
  ],
};

const years = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...YEAR, year: i + 1 }));

const source = (over: Record<string, unknown> = {}) => ({
  acquisition: ACQUISITION,
  years: years(10),
  assumptions: [{ label: 'Capital growth', value: '4.5% per year' }],
  notes: ['Land tax is treated as a cash expense.'],
  ...over,
});

const build = (over: Record<string, unknown> = {}) => buildProjection({
  source: source(over),
  propertyAddress: '14 Wattlebird Grove, Marsden Park NSW 2765',
  clientName: 'Sample Client',
  now: '2026-08-02T00:00:00.000Z',
});

describe('toProjectionYear', () => {
  it('attaches a unit to every figure', () => {
    const y = toProjectionYear(YEAR, 0);
    expect(y.propertyValue.unit).toBe('aud');
    expect(y.rentalIncome.unit).toBe('aud/year');
    expect(y.afterTaxWeekly.unit).toBe('aud/week');
    expect(y.lvr.unit).toBe('percent');
    expect(y.interestRate.unit).toBe('percent');
  });

  /**
   * The modal has both an equity column and an LVR column. Reading them would
   * mean two sources for one relationship, which is how a document ends up
   * saying the loan is 75% of a value it also prints, and 71% two rows down.
   */
  it('derives equity and LVR rather than reading them', () => {
    const y = toProjectionYear({ ...YEAR, equityInProperty: 1, loanToValueRatio: 99 }, 0);
    expect(y.equity.value).toBe(815_100 - 612_768);
    expect(formatMeasure(y.lvr)).toBe('75.2%');
  });

  it('derives the weekly figure from the annual one', () => {
    const y = toProjectionYear(YEAR, 0);
    expect(y.afterTaxWeekly.value).toBeCloseTo(-18_692 / 52, 6);
    expect(formatMeasure(y.afterTaxWeekly)).toBe('-$359/wk');
  });

  it('names the field when a required figure is missing or not finite', () => {
    expect(() => toProjectionYear({ ...YEAR, rentalIncome: undefined }, 3))
      .toThrow(/years\[3\]\.rentalIncome/);
    expect(() => toProjectionYear({ ...YEAR, propertyValue: Number.NaN }, 0))
      .toThrow(/propertyValue must be a finite number/);
    expect(() => toProjectionYear({ ...YEAR, loanBalance: Infinity }, 0))
      .toThrow(CashFlowPayloadError);
  });

  it('treats an omitted optional figure as zero and a broken one as an error', () => {
    expect(toProjectionYear({ ...YEAR, landTax: undefined }, 0).landTax.value).toBe(0);
    expect(() => toProjectionYear({ ...YEAR, landTax: 'lots' }, 0)).toThrow(/landTax/);
  });

  it('does not divide by a zero property value', () => {
    const y = toProjectionYear({ ...YEAR, propertyValue: 0, loanBalance: 0 }, 0);
    expect(y.lvr.value).toBe(0);
    expect(Number.isFinite(y.lvr.value)).toBe(true);
  });
});

describe('toAcquisition', () => {
  it('drops a cost line the client did not incur', () => {
    const a = toAcquisition(ACQUISITION);
    expect(a.costs.map((c) => c.label)).toEqual(['Stamp duty']);
  });

  it('computes the LVR from the loan and the market value', () => {
    expect(formatMeasure(toAcquisition(ACQUISITION).lvr)).toBe('80.0%');
  });

  it('falls back to the purchase price when no market value was sent', () => {
    const a = toAcquisition({ ...ACQUISITION, marketValue: 0 });
    expect(a.marketValue.value).toBe(780_000);
  });

  it('reads a loan type a person would recognise, and keeps an unknown one', () => {
    expect(loanTypeLabel('interest_only')).toBe('Interest only');
    expect(loanTypeLabel('Principal & Interest')).toBe('Principal & Interest');
    expect(loanTypeLabel('')).toBe('Not stated');
  });
});

describe('toOutcome', () => {
  it('adds every after-tax year together', () => {
    const rows = years(10).map((y, i) => toProjectionYear(y, i));
    expect(toOutcome(rows).cumulativeAfterTax.value).toBe(-18_692 * 10);
  });

  it('reports no break-even year when none of them is positive', () => {
    const rows = years(10).map((y, i) => toProjectionYear(y, i));
    expect(toOutcome(rows).breakEvenYear).toBeNull();
  });

  it('reports the first positive year when there is one', () => {
    const rows = years(10)
      .map((y, i) => (i >= 6 ? { ...y, afterTaxAnnual: 2_400 } : y))
      .map((y, i) => toProjectionYear(y, i));
    expect(toOutcome(rows).breakEvenYear).toBe(7);
  });
});

describe('describeProjection', () => {
  /**
   * The sentence a client reads first. It is built from the same blocks the
   * tables are built from precisely so it cannot disagree with them — the
   * defect that killed the Borrowing Capacity waterfall.
   */
  it('says "costs to hold" for a negative position and quotes the table figure', () => {
    const cf = build();
    expect(cf.narrative).toContain('costs $359 a week after tax to hold in year one');
    expect(cf.narrative).toContain('does not turn cash-flow positive');
  });

  it('says "returns" for a positive one', () => {
    const cf = build({ years: years(10).map((y) => ({ ...y, afterTaxAnnual: 5_200 })) });
    expect(cf.narrative).toContain('returns $100 a week after tax');
    expect(cf.narrative).toContain('cash-flow positive from the first year');
  });

  it('is derived, so it cannot name a figure the outcome block does not carry', () => {
    const cf = build();
    const sentence = describeProjection(cf.meta, cf.yearOne, cf.outcome);
    expect(sentence).toBe(cf.narrative);
  });
});

describe('buildProjection', () => {
  it('reads the address and the client from the caller, not from the wire', () => {
    const cf = buildProjection({
      source: { ...source(), propertyAddress: 'Somewhere else', clientName: 'Someone else' },
      propertyAddress: '14 Wattlebird Grove, Marsden Park NSW 2765',
      clientName: 'Sample Client',
      now: '2026-08-02T00:00:00.000Z',
    });
    expect(cf.meta.propertyAddress).toBe('14 Wattlebird Grove, Marsden Park NSW 2765');
    expect(cf.meta.clientName).toBe('Sample Client');
  });

  it('takes the term from the years it was given', () => {
    expect(build({ years: years(7) }).meta.termYears).toBe(7);
  });

  it('refuses a projection with no years', () => {
    expect(() => build({ years: [] })).toThrow(/at least one year/);
  });

  it('refuses one longer than the cap rather than rendering it', () => {
    expect(() => build({ years: years(MAX_PROJECTION_YEARS + 1) }))
      .toThrow(new RegExp(`at most ${MAX_PROJECTION_YEARS}`));
  });

  it('refuses a body that is not an object', () => {
    for (const bad of [null, 'projection', 42, []]) {
      expect(() => buildProjection({
        source: bad,
        propertyAddress: 'a',
        clientName: 'b',
        now: '2026-08-02T00:00:00.000Z',
      })).toThrow(CashFlowPayloadError);
    }
  });

  it('keeps only assumptions that carry both halves', () => {
    const cf = build({
      assumptions: [
        { label: 'Capital growth', value: '4.5% per year' },
        { label: 'Missing value', value: '' },
        { label: '', value: 'orphan' },
      ],
    });
    expect(cf.assumptions).toEqual([{ label: 'Capital growth', value: '4.5% per year' }]);
  });
});
