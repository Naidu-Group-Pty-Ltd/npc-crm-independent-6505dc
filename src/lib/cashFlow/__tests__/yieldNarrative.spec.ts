import { describe, expect, it } from 'vitest';
import { describeGrowth, describeYieldMovement } from '../yieldNarrative.pure';

/**
 * Direction-of-change commentary is computed, never asserted (QA-38, QA-39):
 * a zero-to-zero series says "not assessable" or "unchanged", never
 * "compression", and a growth statistic names its own start and end.
 */
describe('describeYieldMovement', () => {
  it('says not assessable when no rent reached the model — the 0.00% series (QA-38)', () => {
    const m = describeYieldMovement({ label: 'Gross yield', yearOne: 0, yearTen: 0, rentEstablished: false });
    expect(m.kind).toBe('not_assessable');
    expect(m.sentence).toMatch(/not assessable/);
    expect(m.sentence).not.toMatch(/compression/i);
  });

  it('says unchanged for a flat series', () => {
    const m = describeYieldMovement({ label: 'Gross yield', yearOne: 3.6, yearTen: 3.6, rentEstablished: true });
    expect(m.kind).toBe('unchanged');
    expect(m.deltaPoints).toBe(0);
    expect(m.sentence).toBe('Gross yield: unchanged at 3.60% from Year 1 to Year 10.');
  });

  it('names compression only when the yield actually falls, and expansion when it rises', () => {
    const down = describeYieldMovement({ label: 'Gross yield', yearOne: 3.6, yearTen: 3.12, rentEstablished: true });
    expect(down.kind).toBe('compression');
    expect(down.deltaPoints).toBe(-0.48);
    expect(down.sentence).toMatch(/compression of 0\.48 percentage points/);
    const up = describeYieldMovement({ label: 'Net yield', yearOne: 2.3, yearTen: 2.9, rentEstablished: true });
    expect(up.kind).toBe('expansion');
    expect(up.sentence).toMatch(/expansion of 0\.60 percentage points/);
  });

  it('treats a missing endpoint as not assessable', () => {
    expect(describeYieldMovement({ label: 'x', yearOne: undefined, yearTen: 3, rentEstablished: true }).kind).toBe('not_assessable');
  });
});

describe('describeGrowth', () => {
  const money = (v: number) => `$${Math.round(v).toLocaleString('en-AU')}`;

  it('measures ten-year equity growth from settlement, and says so (QA-39)', () => {
    const g = describeGrowth({
      label: 'Equity', startValue: 259_800, endValue: 1_258_168, startLabel: 'settlement', endLabel: 'Year 10', formatValue: money,
    });
    expect(g.percent).toBe(384.3);
    expect(g.sentence).toBe('Equity: 384.3% from $259,800 at settlement to $1,258,168 at Year 10.');
  });

  it('a nine-year interval is labelled as one when the caller starts at Year 1', () => {
    const g = describeGrowth({
      label: 'Equity', startValue: 338_749, endValue: 1_258_168, startLabel: 'Year 1', endLabel: 'Year 10', formatValue: money,
    });
    expect(g.percent).toBe(271.4);
    expect(g.startLabel).toBe('Year 1');
  });

  it('forms no percentage from a non-positive start', () => {
    const g = describeGrowth({ label: 'Equity', startValue: 0, endValue: 10, startLabel: 'settlement', endLabel: 'Year 10', formatValue: money });
    expect(g.percent).toBeNull();
    expect(g.sentence).toMatch(/not stated/);
  });
});
