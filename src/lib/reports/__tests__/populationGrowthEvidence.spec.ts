/**
 * ABS estimated resident population → the Demand dimension's population
 * driver. A rate over a real span, open-licensed, at the SA2's own grain —
 * and null over anything shorter than three years.
 */
import { describe, expect, it } from 'vitest';

import {
  MINIMUM_SPAN_YEARS,
  PREFERRED_SPAN_YEARS,
  populationGrowthPoint,
} from '../market/populationGrowthEvidence.pure';
import { GEOGRAPHIC_LEVELS, levelRank, mayEnterProductionEvidence, mayReachClientReport } from '../market/marketEvidence.pure';

const rows = (start: number, end: number, base: number, rate: number) => {
  const out = [];
  let erp = base;
  for (let y = start; y <= end; y += 1) { out.push({ year: y, erp: Math.round(erp) }); erp *= 1 + rate / 100; }
  return out;
};

describe('populationGrowthPoint', () => {
  it('prefers the five-year compound rate and stamps the point as open ABS evidence at SA2 grain', () => {
    const point = populationGrowthPoint(rows(2014, 2025, 10_000, 2), { name: 'Kellyville - South', level: 'sa2' })!;
    expect(point.value).toBeCloseTo(2, 1);
    expect(point.level).toBe('sa2');
    expect(point.areaName).toBe('Kellyville - South');
    expect(point.provider).toBe('abs_erp');
    expect(point.method).toBe('calculated');
    expect(point.dwellingType).toBe('any');
    expect(point.asOf).toBe('2025-06-30');
    expect(point.periodsAvailable).toBe(12);
    expect(point.licensingStatus).toBe('open');
    expect(point.acquisition).toBe('open_public');
    expect(point.sourceNote).toContain('2020 to 2025');
    expect(mayReachClientReport(point)).toBe(true);
    expect(mayEnterProductionEvidence(point)).toBe(true);
    expect(PREFERRED_SPAN_YEARS).toBe(5);
  });

  it('falls back to the longest span of at least three years, and refuses shorter', () => {
    expect(populationGrowthPoint(rows(2022, 2025, 10_000, 1), { name: 'X', level: 'sa2' })?.sourceNote).toContain('2022 to 2025');
    expect(populationGrowthPoint(rows(2023, 2025, 10_000, 1), { name: 'X', level: 'sa2' })).toBeNull();
    expect(populationGrowthPoint([{ year: 2025, erp: 10_000 }], { name: 'X', level: 'sa2' })).toBeNull();
    expect(populationGrowthPoint([], { name: 'X', level: 'sa2' })).toBeNull();
    expect(MINIMUM_SPAN_YEARS).toBe(3);
  });

  it('a zero or unusable population is an absent observation, never a rate of nothing', () => {
    expect(populationGrowthPoint([{ year: 2020, erp: 0 }, { year: 2025, erp: 0 }], { name: 'X', level: 'sa2' })).toBeNull();
    expect(populationGrowthPoint([{ year: 2020, erp: Number.NaN }, { year: 2025, erp: 500 }], { name: 'X', level: 'sa2' })).toBeNull();
  });

  it('SA2 is a geography the evidence hierarchy knows, finer than an LGA and coarser than a postcode', () => {
    expect(GEOGRAPHIC_LEVELS).toContain('sa2');
    expect(levelRank('sa2')).toBeGreaterThan(levelRank('postcode'));
    expect(levelRank('sa2')).toBeLessThan(levelRank('lga'));
  });
});
