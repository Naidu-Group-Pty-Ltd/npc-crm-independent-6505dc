/**
 * W0 — geometry-based text fidelity measurement.
 *
 * These tests exist because the harness could not see the defect users were
 * reporting. `measureTextCoverage` scores bag-of-words recall, so a box whose
 * text is clipped or spilling still scores 1.0 — its `textContent` is intact.
 * Across 117 production imports the CDIR summary reported `textAccuracy == 1`
 * on 89 of them while the visual gate flagged 74% of pages as needing review.
 *
 * `measureTextGeometry` asks the question coverage cannot: does the text occupy
 * the same space as the source?
 */
import { describe, it, expect } from 'vitest';
import {
  measureTextCoverage,
  measureTextGeometry,
  type TextLineGeometry,
} from '@/lib/reportTemplate/ingestion/visualQuality/diff/textMetrics';

const line = (width: number): TextLineGeometry => ({ width });

describe('measureTextGeometry — the measurement coverage cannot make', () => {
  it('a substituted font running 12% wide scores perfect on coverage and fails on geometry', () => {
    // Same words, every line wider. This is the exact production defect: no
    // token is lost, so coverage is blind to it.
    const text = 'Borrowing capacity summary for the applicant';
    expect(measureTextCoverage(text, text).textCoverageScore).toBe(1);

    const source = [line(100), line(120), line(96)];
    const rendered = [line(112), line(134.4), line(107.5)];
    const geo = measureTextGeometry(source, rendered);

    expect(geo.medianAdvanceRatio).toBeCloseTo(1.12, 2);
    expect(geo.overrunLineCount).toBe(3);
    expect(geo.advanceFidelityScore).toBeLessThan(0.9);
  });

  it('an exact match scores 1', () => {
    const lines = [line(100), line(80)];
    const geo = measureTextGeometry(lines, [...lines]);
    expect(geo.advanceFidelityScore).toBe(1);
    expect(geo.overrunLineCount).toBe(0);
    expect(geo.lineCountMatch).toBe(true);
    expect(geo.indeterminate).toBe(false);
  });

  it('penalises text rendering too NARROW as well as too wide', () => {
    // A wrong substitution can under-run as easily as over-run; both are drift.
    const wide = measureTextGeometry([line(100)], [line(115)]);
    const narrow = measureTextGeometry([line(100)], [line(85)]);
    expect(wide.advanceFidelityScore).toBeCloseTo(narrow.advanceFidelityScore, 5);
    // ...but only over-run counts as an overrun of the box.
    expect(wide.overrunLineCount).toBe(1);
    expect(narrow.overrunLineCount).toBe(0);
  });

  it('detects the renderer wrapping a line the source did not', () => {
    // The nowrap case: one source line became two rendered lines.
    const geo = measureTextGeometry([line(200)], [line(120), line(80)]);
    expect(geo.lineCountMatch).toBe(false);
    expect(geo.expectedLineCount).toBe(1);
    expect(geo.renderedLineCount).toBe(2);
    // The line-count penalty must bite even when the compared line is narrower.
    expect(geo.advanceFidelityScore).toBeLessThan(0.75);
  });

  it('tolerance is respected — 2% drift is not an overrun', () => {
    expect(measureTextGeometry([line(100)], [line(101.5)]).overrunLineCount).toBe(0);
    expect(measureTextGeometry([line(100)], [line(103)]).overrunLineCount).toBe(1);
  });

  it('reports indeterminate rather than inventing a score', () => {
    // An empty side is not a failure and must not read as one.
    expect(measureTextGeometry([], []).indeterminate).toBe(true);
    expect(measureTextGeometry([], []).advanceFidelityScore).toBe(1);

    const missing = measureTextGeometry([line(100)], []);
    expect(missing.indeterminate).toBe(true);
    expect(missing.advanceFidelityScore).toBe(0);

    // Zero-width source lines carry no information — skipped, not divided by.
    expect(measureTextGeometry([line(0)], [line(50)]).indeterminate).toBe(true);
  });

  it('never throws on hostile input', () => {
    const nasty: TextLineGeometry[] = [
      { width: Number.NaN }, { width: Number.POSITIVE_INFINITY }, { width: -5 },
    ];
    expect(() => measureTextGeometry(nasty, nasty)).not.toThrow();
    expect(() => measureTextGeometry([line(10)], nasty)).not.toThrow();
  });

  it('scores are bounded to 0..1 under extreme drift', () => {
    const geo = measureTextGeometry([line(10)], [line(1000)]);
    expect(geo.advanceFidelityScore).toBeGreaterThanOrEqual(0);
    expect(geo.advanceFidelityScore).toBeLessThanOrEqual(1);
    expect(geo.maxAdvanceRatio).toBe(100);
  });
});
