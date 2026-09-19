/** QA-21 — a recorded area names what it is an area of. */
import { describe, expect, it } from 'vitest';
import { describeLandArea, UNRESOLVED_AREA_NOTE } from '@/lib/reports/investment/landAreaScope.pure';

describe('describeLandArea', () => {
  it('labels 1.25 ha on a strata townhouse as unresolved and blocks its use', () => {
    const r = describeLandArea({ landSizeSqm: 12_500, propertyType: 'Townhouse', isStrata: true })!;
    expect(r.scope).toBe('unresolved');
    expect(r.label).toBe('Recorded area (scope unresolved: scheme/site or individual lot)');
    expect(r.value).toBe('1.25 ha (12,500 m²)');
    expect(r.usableForCalculation).toBe(false);
    expect(r.note).toBe(UNRESOLVED_AREA_NOTE);
  });

  it('treats a site-scale area on an unresolved dwelling type as unresolved too', () => {
    // The audited row's type was unresolved, so size is the second witness.
    expect(describeLandArea({ landSizeSqm: 12_500, propertyType: null })?.scope).toBe('unresolved');
    expect(describeLandArea({ landSizeSqm: 3_999, propertyType: null })?.scope).toBe('lot');
  });

  it('reads a large area on acreage or land as the lot', () => {
    const r = describeLandArea({ landSizeSqm: 20_000, propertyType: 'Acreage' })!;
    expect(r.scope).toBe('lot');
    expect(r.label).toBe('Land size');
    expect(r.value).toBe('2 ha (20,000 m²)');
  });

  it('prefers a recorded individual lot area over the site area', () => {
    const r = describeLandArea({ landSizeSqm: 12_500, lotAreaSqm: 210, propertyType: 'Townhouse' })!;
    expect(r.label).toBe('Land size (individual lot)');
    expect(r.value).toBe('210 m²');
    expect(r.usableForCalculation).toBe(true);
  });

  it('answers null for no area rather than a placeholder', () => {
    expect(describeLandArea({ landSizeSqm: null })).toBeNull();
    expect(describeLandArea({ landSizeSqm: 0 })).toBeNull();
  });
});
