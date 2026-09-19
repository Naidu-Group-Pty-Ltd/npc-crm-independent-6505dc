/**
 * W3 — chart integrity arbitration.
 *
 * The important tests here are the ones that prove the gate REFUSES. A chart
 * reconstruction that ships a misread bar height into a borrowing-capacity
 * report is worse than a picture of the correct chart: it looks authoritative,
 * it is editable, and it is wrong. Every hard defect below therefore has a test
 * showing it vetoes native rendering outright — a weighted score must never
 * override one.
 */
import { describe, it, expect } from 'vitest';
import {
  arbitrateChart,
  isNativeChartMode,
  AXIS_SCALE_MIN_R2,
  CHART_ARBITRATION_VERSION,
  CHART_HARD_DEFECT_CODES,
  type ChartCandidateEvidence,
} from '@/lib/reportTemplate/pdfImport/chartArbitration.pure';

/** A candidate that passes every check, with printed labels corroborating it. */
function goodEvidence(over: Partial<ChartCandidateEvidence> = {}): ChartCandidateEvidence {
  return {
    chartType: 'bar',
    detectionMethod: 'classification',
    hasCrop: true,
    series: [{ label: 'Sales', value: 100 }, { label: 'Rentals', value: 50 }],
    axisScale: { kind: 'linear', tickCount: 4, r2: 0.9999 },
    valueLabelPairs: [{ derived: 100, printed: 100 }, { derived: 50, printed: 50 }],
    smallestTickInterval: 25,
    unaccountedNumericTokens: [],
    ...over,
  };
}

describe('arbitrateChart — the happy path is narrow on purpose', () => {
  it('goes native only when clean AND corroborated by printed labels', () => {
    const r = arbitrateChart(goodEvidence());
    expect(r.renderMode).toBe('verified-native-chart');
    expect(r.defects).toEqual([]);
    expect(r.crossValidated).toBe(true);
    expect(r.manualReviewRequired).toBe(false);
    expect(r.version).toBe(CHART_ARBITRATION_VERSION);
  });

  it('a chart printing no numbers is native but demands sign-off', () => {
    // Nothing to check the geometry against. Probably right; not proven.
    const r = arbitrateChart(goodEvidence({ valueLabelPairs: [] }));
    expect(r.renderMode).toBe('native-with-source-reference');
    expect(r.crossValidated).toBe(false);
    expect(r.manualReviewRequired).toBe(true);
    expect(isNativeChartMode(r.renderMode)).toBe(true);
  });

  it('pie and donut need no axis scale — value comes from angle', () => {
    for (const chartType of ['pie', 'donut']) {
      const r = arbitrateChart(goodEvidence({ chartType, axisScale: null }));
      expect(r.renderMode, chartType).toBe('verified-native-chart');
    }
  });
});

describe('arbitrateChart — hard defects veto absolutely', () => {
  const cases: Array<[string, Partial<ChartCandidateEvidence>, string]> = [
    ['a printed label disagreeing with the geometry',
      { valueLabelPairs: [{ derived: 100, printed: 100 }, { derived: 61, printed: 50 }] },
      'value_label_disagreement'],
    ['an unexplained number inside the chart region',
      { unaccountedNumericTokens: ['1,250'] }, 'numeric_token_unaccounted'],
    ['a log axis, which linearises into plausible wrong numbers',
      { axisScale: { kind: 'log', tickCount: 5, r2: 0.9999 } }, 'axis_scale_nonlinear'],
    ['too few ticks to fit a scale',
      { axisScale: { kind: 'linear', tickCount: 2, r2: 1 } }, 'axis_scale_underdetermined'],
    ['a poor axis fit, meaning ticks were paired wrongly',
      { axisScale: { kind: 'linear', tickCount: 5, r2: 0.99 } }, 'axis_r2_below_floor'],
    ['an unrecognised chart type', { chartType: 'combo' }, 'chart_type_unknown'],
    ['no series extracted', { series: [] }, 'series_empty'],
    ['a non-finite value',
      { series: [{ label: 'a', value: Number.NaN }] }, 'non_finite_value'],
    ['a series count the detector did not expect',
      { expectedSeriesCount: 5 }, 'series_count_mismatch'],
  ];

  for (const [name, over, code] of cases) {
    it(`refuses native for ${name}`, () => {
      const r = arbitrateChart(goodEvidence(over));
      expect(r.defects).toContain(code);
      expect(r.renderMode).toBe('chart-source-crop');
      expect(isNativeChartMode(r.renderMode)).toBe(false);
      expect(r.crossValidated).toBe(false);
    });
  }

  it('one bad bar vetoes the WHOLE chart, not just that series', () => {
    // The rest of the chart being right is exactly what makes the wrong part
    // credible, so partial acceptance is not an option.
    const r = arbitrateChart(goodEvidence({
      series: [
        { label: 'a', value: 10 }, { label: 'b', value: 20 },
        { label: 'c', value: 30 }, { label: 'd', value: 99 },
      ],
      valueLabelPairs: [
        { derived: 10, printed: 10 }, { derived: 20, printed: 20 },
        { derived: 30, printed: 30 }, { derived: 99, printed: 40 },
      ],
      expectedSeriesCount: 4,
    }));
    expect(r.renderMode).toBe('chart-source-crop');
    expect(r.defects).toContain('value_label_disagreement');
  });

  it('reports every defect, not just the first', () => {
    const r = arbitrateChart(goodEvidence({
      chartType: 'combo',
      series: [],
      unaccountedNumericTokens: ['7'],
    }));
    expect(r.defects.length).toBeGreaterThanOrEqual(3);
    expect(new Set(r.defects).size).toBe(r.defects.length);
  });

  it('falls to containment, not crop, when there is no crop to fall back to', () => {
    const r = arbitrateChart(goodEvidence({ hasCrop: false }));
    expect(r.defects).toContain('source_chart_crop_missing');
    expect(r.renderMode).toBe('containment-fallback');
  });
});

describe('arbitrateChart — value tolerance', () => {
  it('accepts rounding-scale disagreement', () => {
    // A label printed as 100 against a derived 100.4 is a rounding artefact.
    const r = arbitrateChart(goodEvidence({
      valueLabelPairs: [{ derived: 100.4, printed: 100 }],
      smallestTickInterval: 25,
    }));
    expect(r.renderMode).toBe('verified-native-chart');
  });

  it('does not hold small values to an impossible relative standard', () => {
    // 0.5% of 2 is 0.01, below what reading a position off a chart resolves.
    // The tick floor absorbs that quantisation — and nothing more.
    const r = arbitrateChart(goodEvidence({
      series: [{ label: 'a', value: 2 }],
      valueLabelPairs: [{ derived: 2.03, printed: 2 }],
      smallestTickInterval: 1,
      expectedSeriesCount: 1,
    }));
    expect(r.renderMode).toBe('verified-native-chart');
  });

  it('still catches a real disagreement on a small value', () => {
    const r = arbitrateChart(goodEvidence({
      series: [{ label: 'a', value: 2 }],
      valueLabelPairs: [{ derived: 2.4, printed: 2 }],
      smallestTickInterval: 1,
      expectedSeriesCount: 1,
    }));
    expect(r.defects).toContain('value_label_disagreement');
  });

  it('the tick floor cannot wave through a materially wrong value', () => {
    // Regression guard on the tolerance itself. With a half-tick floor an axis
    // ticked every 25 units permitted a 12.5 error — 25% on a value of 50.
    const r = arbitrateChart(goodEvidence({
      valueLabelPairs: [{ derived: 61, printed: 50 }],
      smallestTickInterval: 25,
    }));
    expect(r.defects).toContain('value_label_disagreement');
  });
});

describe('arbitrateChart — contract', () => {
  it('is deterministic', () => {
    const e = goodEvidence();
    expect(arbitrateChart(e)).toEqual(arbitrateChart(e));
  });

  it('never mutates its input', () => {
    const e = goodEvidence();
    const before = JSON.stringify(e);
    arbitrateChart(e);
    expect(JSON.stringify(e)).toBe(before);
  });

  it('only ever emits declared defect codes', () => {
    const declared = new Set<string>(CHART_HARD_DEFECT_CODES);
    const r = arbitrateChart(goodEvidence({
      chartType: null, series: [], hasCrop: false,
      axisScale: null, unaccountedNumericTokens: ['x'],
    }));
    for (const d of r.defects) expect(declared.has(d)).toBe(true);
  });

  it('pins the R2 floor — an axis is linear by construction', () => {
    expect(AXIS_SCALE_MIN_R2).toBe(0.999);
    const justUnder = arbitrateChart(goodEvidence({
      axisScale: { kind: 'linear', tickCount: 4, r2: 0.9989 },
    }));
    expect(justUnder.defects).toContain('axis_r2_below_floor');
  });
});
