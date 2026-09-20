/**
 * One scale per quantity per document — the Cowra 1.6 km discrepancy.
 */
import { describe, expect, it } from 'vitest';
import { alignChartScales, niceMax } from '../investment/chartScale.pure';
import { parseVizDirectives } from '../vizDirectives.pure';

describe('niceMax', () => {
  it('chooses a maximum a person would choose for an axis', () => {
    expect(niceMax(1.6)).toBe(2);
    expect(niceMax(2)).toBe(2);
    expect(niceMax(3)).toBe(3);
    expect(niceMax(4.2)).toBe(5);
    expect(niceMax(12)).toBe(15);
    expect(niceMax(47)).toBe(50);
    expect(niceMax(480)).toBe(500);
  });

  it('never returns a binary-floating-point artefact, because it is printed', () => {
    // 3 * 0.1 * 10 is 3.0000000000000004, and `max=3.0000000000000004` would
    // reach a directive and then an axis label.
    for (let v = 0.1; v < 200; v += 0.37) {
      expect(String(niceMax(v))).not.toMatch(/\d{6,}/);
    }
  });
});

describe('the Cowra 1.6 km discrepancy', () => {
  const DOC = [
    '{{bars: Core CBD & shops 1.6 km, Primary school ~0.7 km, Hospital & medical hub ~2.0 km '
    + '| title=Proximity of 48 Redfern Street to key Cowra amenities | max=3 | unit=km}}',
    '',
    'Prose between the two.',
    '',
    '{{bars: Cowra CBD ~1.6 km, Supermarkets ~2.0 km, Hospital ~3.0 km '
    + '| title=Indicative reach from 48 Redfern Street | max=5 | unit=km}}',
  ].join('\n');

  it('draws the same 1.6 km at the same length on both pages', () => {
    // Before: 1.6 of 3 is 53% of the track, 1.6 of 5 is 32% — the same
    // distance to the same place, 21 points shorter two pages later.
    const { markdown, aligned } = alignChartScales(DOC);
    expect(aligned).toEqual([{ unit: 'km', max: 5, charts: 2, wasDeclared: [3, 5] }]);
    const maxima = parseVizDirectives(markdown)
      .filter((d): d is Extract<typeof d, { kind: 'bars' }> => d.kind === 'bars')
      .map((d) => d.max);
    expect(maxima).toEqual([5, 5]);
  });

  it('changes the axis and never a value', () => {
    const { markdown } = alignChartScales(DOC);
    for (const figure of ['1.6 km', '~0.7 km', '~2.0 km', '~3.0 km']) {
      expect(markdown).toContain(figure);
    }
    expect(markdown).toContain('Prose between the two.');
  });

  it('respects a larger declared maximum rather than tightening the axis', () => {
    // An author who chose 5 for a chart peaking at 3 left headroom on purpose.
    // The fix is agreement, not the tightest axis available.
    const { aligned } = alignChartScales(DOC);
    expect(aligned[0].max).toBe(5);
  });
});

describe('what it leaves alone', () => {
  it('a document with one chart per unit is byte-identical', () => {
    const doc = '{{bars: CBD 1.6 km, School 0.7 km | max=3 | unit=km}}';
    expect(alignChartScales(doc)).toEqual({ markdown: doc, aligned: [] });
  });

  it('two charts that already agree are byte-identical', () => {
    const doc = '{{bars: A 1 km | max=3 | unit=km}}\n{{bars: B 2 km | max=3 | unit=km}}';
    expect(alignChartScales(doc)).toEqual({ markdown: doc, aligned: [] });
  });

  it('never unifies per-cent charts, which share 100 for unrelated reasons', () => {
    const doc = '{{bars: A 80 | max=100 | unit=%}}\n{{bars: B 40 | max=50 | unit=%}}';
    expect(alignChartScales(doc).aligned).toEqual([]);
  });

  it('never unifies ratings — making two invented scales agree makes them look measured', () => {
    const doc = '{{bars: Planning 90 | max=100}}\n{{bars: Fit 7.5 | max=10 | unit=/10}}';
    expect(alignChartScales(doc).aligned).toEqual([]);
  });

  it('never unifies across units — kilometres and minutes are different quantities', () => {
    const doc = '{{bars: CBD 1.6 km | max=3 | unit=km}}\n{{bars: CBD 15 min | max=30 | unit=min}}';
    expect(alignChartScales(doc).aligned).toEqual([]);
  });

  it('grows the axis where the data needs more than either chart declared', () => {
    const doc = '{{bars: A 12 km | max=3 | unit=km}}\n{{bars: B 2 km | max=5 | unit=km}}';
    const { aligned } = alignChartScales(doc);
    expect(aligned[0].max).toBe(15);
  });
});
