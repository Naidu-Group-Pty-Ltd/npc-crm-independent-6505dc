/**
 * Deciding whether a picture is a chart, from geometry the import already holds.
 *
 * The discipline is the same as everywhere else in this programme: it refuses
 * rather than guesses. A picture wrongly labelled "Bar chart" puts a false
 * description into a tagged PDF, which is worse than the honest absence it
 * replaces — and this module never reads a VALUE, so it cannot misstate a
 * figure in a client's financial report.
 */
import { describe, it, expect } from 'vitest';
import {
  detectChartCandidate,
  chartCandidateAltText,
  readsAsNumber,
  MIN_CHART_AREA_PT2,
  MIN_REPORTED_CONFIDENCE,
  CHART_CANDIDATE_VERSION,
} from '@/lib/reportTemplate/pdfImport/chartCandidate.pure';

/** A plot area big enough to be a chart. */
const PICTURE = { x: 60, y: 300, width: 300, height: 180 };

/** `n` bars standing on one baseline inside PICTURE. */
const bars = (n: number, baseline = 460) =>
  Array.from({ length: n }, (_, i) => ({
    x: 80 + i * 30, y: baseline - (40 + i * 10), width: 18, height: 40 + i * 10,
  }));

const axes = () => [
  { x: 70, y: 460, width: 280, height: 1 },   // x axis
  { x: 70, y: 310, width: 1, height: 150 },   // y axis
];

const numbers = (values: string[]) =>
  values.map((text, i) => ({ x: 80 + i * 30, y: 465, width: 24, height: 8, text }));

describe('readsAsNumber', () => {
  it('accepts the forms a chart prints', () => {
    for (const value of ['186,000', '$785,000', '97%', '8.65', '2026', '1.2M', '-5']) {
      expect(readsAsNumber(value), value).toBe(true);
    }
  });

  it('rejects prose and anything oversized', () => {
    for (const value of ['Gross income', 'Q1 2026 results by source', '', '   ', null, 42]) {
      expect(readsAsNumber(value as never), String(value)).toBe(false);
    }
  });
});

describe('detectChartCandidate — what it recognises', () => {
  it('recognises a bar chart from bars on a shared baseline', () => {
    const candidate = detectChartCandidate(PICTURE, [...bars(4), ...axes()], numbers(['10', '20', '30', '40']))!;
    expect(candidate.kind).toBe('bar');
    expect(candidate.version).toBe(CHART_CANDIDATE_VERSION);
    expect(candidate.confidence).toBeGreaterThanOrEqual(MIN_REPORTED_CONFIDENCE);
    expect(candidate.evidence).toMatchObject({ sharedBaselineBars: 4, axisLikeVectors: 2, numericLabels: 4 });
  });

  it('recognises a pie from wedge paths', () => {
    const wedges = Array.from({ length: 3 }, (_, i) => ({
      x: 100 + i, y: 320 + i, width: 120, height: 120,
      paths: ['M150 380 L150 320 A60 60 0 0 1 200 400 Z'],
    }));
    const candidate = detectChartCandidate(PICTURE, wedges, numbers(['40%', '35%', '25%']))!;
    expect(candidate.kind).toBe('pie');
  });

  it('recognises a line plot from two axes and marks between them', () => {
    const marks = Array.from({ length: 5 }, (_, i) => ({ x: 90 + i * 40, y: 350 + i * 5, width: 4, height: 4 }));
    const candidate = detectChartCandidate(PICTURE, [...axes(), ...marks], numbers(['1', '2']))!;
    expect(candidate.kind).toBe('line');
  });

  it('scores a chart with printed numbers above one without', () => {
    // Numbers inside the picture are what separate a chart from a decorative
    // diagram of the same shape.
    const withNumbers = detectChartCandidate(PICTURE, [...bars(4), ...axes()], numbers(['10', '20']))!;
    const without = detectChartCandidate(PICTURE, [...bars(4), ...axes()], [])!;
    expect(withNumbers.confidence).toBeGreaterThan(without.confidence);
  });
});

describe('detectChartCandidate — what it refuses', () => {
  it('refuses anything too small to be a chart', () => {
    // An icon and a rule are not charts, and this gate removes most of a page
    // before any shape analysis runs.
    const icon = { x: 60, y: 300, width: 30, height: 30 };
    expect(detectChartCandidate(icon, bars(4), numbers(['1', '2']))).toBeNull();
    expect(icon.width * icon.height).toBeLessThan(MIN_CHART_AREA_PT2);
  });

  it('refuses marks that do not share a baseline', () => {
    // A scattering of rectangles at unrelated heights is a diagram, not a plot.
    const scattered = [
      { x: 80, y: 320, width: 18, height: 40 },
      { x: 140, y: 380, width: 18, height: 25 },
      { x: 200, y: 340, width: 18, height: 60 },
    ];
    expect(detectChartCandidate(PICTURE, scattered, [])).toBeNull();
  });

  it('refuses a picture with no geometry inside it at all', () => {
    expect(detectChartCandidate(PICTURE, [], [])).toBeNull();
    expect(detectChartCandidate(PICTURE, null, null)).toBeNull();
  });

  it('ignores geometry that belongs to a different part of the page', () => {
    // Bars elsewhere on the page are another figure's bars.
    const elsewhere = bars(4).map((b) => ({ ...b, x: b.x + 400 }));
    expect(detectChartCandidate(PICTURE, [...elsewhere, ...axes()], [])).toBeNull();
  });

  it('refuses a photograph — one big rectangle is not a plot', () => {
    const photo = [{ x: 60, y: 300, width: 300, height: 180 }];
    expect(detectChartCandidate(PICTURE, photo, [])).toBeNull();
  });

  it('refuses unusable geometry rather than throwing', () => {
    expect(detectChartCandidate(null, bars(4), [])).toBeNull();
    expect(detectChartCandidate({ x: 0, y: 0, width: 0, height: 0 }, bars(4), [])).toBeNull();
    expect(detectChartCandidate(PICTURE, [{ x: Number.NaN, y: 1, width: 2, height: 3 }] as never, [])).toBeNull();
  });

  it('never reports below the confidence floor', () => {
    const all = [
      detectChartCandidate(PICTURE, [...bars(3)], []),
      detectChartCandidate(PICTURE, [...bars(8), ...axes()], numbers(['1', '2', '3'])),
    ].filter(Boolean);
    for (const candidate of all) {
      expect(candidate!.confidence).toBeGreaterThanOrEqual(MIN_REPORTED_CONFIDENCE);
      expect(candidate!.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('chartCandidateAltText', () => {
  it('describes only what was detected', () => {
    // "Bar chart showing income rising to $186,000" would be a reading of the
    // data. This module does not read data and must never appear to.
    const candidate = detectChartCandidate(PICTURE, [...bars(4), ...axes()], numbers(['186,000']))!;
    expect(chartCandidateAltText(candidate)).toBe('Bar chart');
    expect(chartCandidateAltText(candidate)).not.toMatch(/186/);
  });

  it('is null when nothing was detected', () => {
    expect(chartCandidateAltText(null)).toBeNull();
    expect(chartCandidateAltText(undefined)).toBeNull();
  });
});
