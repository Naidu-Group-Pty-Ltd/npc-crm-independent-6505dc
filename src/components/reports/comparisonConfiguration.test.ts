import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPARISON_WEIGHTS, cloneComparisonWeights, comparisonWeightsEqual, parseComparisonTemplateSettings, validateComparisonWeights } from './comparisonConfiguration';

describe('comparison scoring configuration', () => {
  it('uses immutable canonical defaults totalling 100%', () => {
    expect(DEFAULT_COMPARISON_WEIGHTS).toEqual({ growth: 30, location: 25, yield: 20, demand: 15, risk: 10 });
    expect(validateComparisonWeights(DEFAULT_COMPARISON_WEIGHTS)).toMatchObject({ total: 100, isValid: true });
  });
  it('rejects invalid totals and values', () => {
    expect(validateComparisonWeights({ ...DEFAULT_COMPARISON_WEIGHTS, growth: 29 }).isValid).toBe(false);
    expect(validateComparisonWeights({ ...DEFAULT_COMPARISON_WEIGHTS, growth: 31 }).isValid).toBe(false);
    expect(validateComparisonWeights({ growth: NaN, location: 25, yield: 20, demand: 15, risk: 10 }).isValid).toBe(false);
  });
  it('keeps editable and applied clones independent and detects defaults', () => {
    const draft: { growth: number; location: number; yield: number; demand: number; risk: number } = cloneComparisonWeights(); const applied = cloneComparisonWeights();
    draft.growth = 25;
    expect(applied.growth).toBe(30); expect(DEFAULT_COMPARISON_WEIGHTS.growth).toBe(30);
    expect(comparisonWeightsEqual(applied, DEFAULT_COMPARISON_WEIGHTS)).toBe(true);
  });
  it('maps legacy saved template weights into applied state', () => {
    expect(parseComparisonTemplateSettings({ customWeights: DEFAULT_COMPARISON_WEIGHTS })).toMatchObject({ appliedWeights: DEFAULT_COMPARISON_WEIGHTS });
  });
});
