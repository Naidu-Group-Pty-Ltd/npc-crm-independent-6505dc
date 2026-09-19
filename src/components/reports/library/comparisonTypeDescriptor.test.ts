/**
 * The display identity of a stored comparison's family.
 *
 * The producer stores one of five canonical values; this module maps THOSE and
 * nothing else — no alias table, because normalisation happens once,
 * server-side. An untyped row (legacy, dangling, or mixed evidence) presents
 * as a plain "Comparison", never as a guess.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPARISON_TYPE_DESCRIPTORS,
  countComparisonTypes,
  describeComparisonType,
} from './comparisonTypeDescriptor.pure';

describe('describing a stored comparison_type', () => {
  it('names each canonical family the producer can store', () => {
    expect(describeComparisonType('compass').label).toBe('Compass Comparison');
    expect(describeComparisonType('briefing').label).toBe('Briefing Comparison');
    expect(describeComparisonType('snapshot').label).toBe('Snapshot Comparison');
    expect(describeComparisonType('financial').label).toBe('Financial Comparison');
    expect(describeComparisonType('strategic').label).toBe('Strategic Comparison');
  });

  it('tolerates stray casing and whitespace on the stored value', () => {
    expect(describeComparisonType(' Compass ').key).toBe('compass');
    expect(describeComparisonType('BRIEFING').key).toBe('briefing');
  });

  it('presents anything else as untyped, never as a guess', () => {
    // No alias table here on purpose: 'investment' is a valid TIER alias the
    // SERVER normalises at creation; a stored value is already canonical, so
    // an unexpected one means the row predates the column or was written by
    // something this module does not know — say so plainly.
    for (const value of [null, undefined, '', 'investment', 'mixed', 42, {}]) {
      const d = describeComparisonType(value);
      expect(d.key).toBeNull();
      expect(d.label).toBe('Comparison');
    }
  });

  it('gives every descriptor a label, a blurb and a badge style', () => {
    for (const d of [...COMPARISON_TYPE_DESCRIPTORS, describeComparisonType(null)]) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.blurb.length).toBeGreaterThan(0);
      expect(d.badgeClassName.length).toBeGreaterThan(0);
    }
  });

  it('makes every typed label end in "Comparison" so the family reads as one', () => {
    for (const d of COMPARISON_TYPE_DESCRIPTORS) {
      expect(d.label.endsWith(' Comparison')).toBe(true);
    }
  });
});

describe('counting the families in a view', () => {
  it('counts typed families in summary order and untyped last', () => {
    const rows = [
      { comparison_type: 'compass' },
      { comparison_type: 'compass' },
      { comparison_type: 'briefing' },
      { comparison_type: null },
      {},
    ];
    const counts = countComparisonTypes(rows);
    expect(counts.map(([d, n]) => [d.label, n])).toEqual([
      ['Compass Comparison', 2],
      ['Briefing Comparison', 1],
      ['Comparison', 2],
    ]);
  });

  it('omits families with no rows — a zero chip is noise', () => {
    const counts = countComparisonTypes([{ comparison_type: 'snapshot' }]);
    expect(counts).toHaveLength(1);
    expect(counts[0][0].label).toBe('Snapshot Comparison');
  });

  it('is empty for an empty view', () => {
    expect(countComparisonTypes([])).toEqual([]);
  });
});
