import { describe, it, expect } from 'vitest';
import {
  alignBoxToSourceBaseline,
  firstBaselineOffsetPt,
  MAX_BASELINE_CORRECTION_EM,
  type FontVerticalMetrics,
} from '../firstBaseline.pure';

/** hhea metrics read from the programs the BC Snapshot source embeds. */
const SEGOE_SEMIBOLD: FontVerticalMetrics = { ascender: 1.0791, descender: 0.2510 };
const CINZEL_BOLD: FontVerticalMetrics = { ascender: 0.9760, descender: 0.3720 };
const PLAYFAIR_MEDIUM: FontVerticalMetrics = { ascender: 1.0820, descender: 0.2510 };

describe('firstBaselineOffsetPt', () => {
  /**
   * Measured against WeasyPrint with the production renderer's own declaration
   * set — flex column, nowrap, letter-spacing, weights, centred and left. The
   * worst error over sizes 6.75–34.5pt and leadings 1.0–1.6 was 0.0002pt.
   */
  it.each([
    [6.75, 1.0, 6.170],
    [6.75, 1.3, 7.182],
    [6.75, 1.6, 8.195],
    [10.12, 1.0, 9.250],
    [10.12, 1.3, 10.768],
    [10.12, 1.6, 12.286],
    [34.5, 1.0, 31.535],
    [34.5, 1.3, 36.710],
    [34.5, 1.6, 41.885],
  ])('matches the renderer at %ppt / line-height %p', (size, lh, measured) => {
    expect(firstBaselineOffsetPt(SEGOE_SEMIBOLD, size, lh)!).toBeCloseTo(measured, 2);
  });

  it('grows with leading by exactly half of it', () => {
    const tight = firstBaselineOffsetPt(SEGOE_SEMIBOLD, 10, 1.0)!;
    const loose = firstBaselineOffsetPt(SEGOE_SEMIBOLD, 10, 1.6)!;
    expect(loose - tight).toBeCloseTo((1.6 - 1.0) / 2 * 10, 6);
  });

  it('scales linearly with type size', () => {
    const small = firstBaselineOffsetPt(SEGOE_SEMIBOLD, 10, 1.3)!;
    const large = firstBaselineOffsetPt(SEGOE_SEMIBOLD, 30, 1.3)!;
    expect(large).toBeCloseTo(small * 3, 6);
  });

  it('is a property of the font, not a constant', () => {
    // Cinzel's shorter ascent is why its drift measured 0.256em where
    // SegoeUI-Semibold's measured 0.364em on the same page.
    const segoe = firstBaselineOffsetPt(SEGOE_SEMIBOLD, 10, 1.3)!;
    const cinzel = firstBaselineOffsetPt(CINZEL_BOLD, 10, 1.3)!;
    const playfair = firstBaselineOffsetPt(PLAYFAIR_MEDIUM, 10, 1.3)!;
    expect(cinzel).toBeLessThan(segoe);
    expect(playfair).toBeGreaterThan(segoe);
  });

  it('returns null rather than a number that means nothing', () => {
    expect(firstBaselineOffsetPt(null, 10, 1.3)).toBeNull();
    expect(firstBaselineOffsetPt(undefined, 10, 1.3)).toBeNull();
    expect(firstBaselineOffsetPt({ ascender: 0, descender: 0.25 }, 10, 1.3)).toBeNull();
    expect(firstBaselineOffsetPt({ ascender: -1, descender: 0.25 }, 10, 1.3)).toBeNull();
    expect(firstBaselineOffsetPt({ ascender: 1, descender: -0.1 }, 10, 1.3)).toBeNull();
    expect(firstBaselineOffsetPt(SEGOE_SEMIBOLD, 0, 1.3)).toBeNull();
    expect(firstBaselineOffsetPt(SEGOE_SEMIBOLD, Number.NaN, 1.3)).toBeNull();
    expect(firstBaselineOffsetPt(SEGOE_SEMIBOLD, 10, 0)).toBeNull();
  });
});

/**
 * The BC Snapshot cover, measured between the source PDF and the WeasyPrint
 * render of its reconstruction.
 *
 * `baseline` is the source's own, read with PyMuPDF. `boxTop` is where the
 * importer put the block — recovered from the render as
 * `renderedBaseline − firstBaselineOffset`, since that is the renderer's own
 * relationship. `drift` is what a reader sees: rendered baseline minus source
 * baseline, and every one of them is ~0.36 of its type size.
 */
const OBSERVED = [
  { text: 'ASSESSMENT DATE', size: 6.75, lh: 1.3, boxTop: 701.02, baseline: 705.8, drift: 2.5, font: SEGOE_SEMIBOLD },
  { text: 'PREPARED FOR', size: 7.12, lh: 1.3, boxTop: 452.52, baseline: 457.5, drift: 2.6, font: SEGOE_SEMIBOLD },
  { text: '18 April 2026', size: 12.75, lh: 1.3, boxTop: 718.53, baseline: 727.5, drift: 4.6, font: SEGOE_SEMIBOLD },
  { text: 'Masline Nyawo', size: 34.5, lh: 1.3, boxTop: 476.54, baseline: 501.0, drift: 12.3, font: PLAYFAIR_MEDIUM },
] as const;

describe('the drift these fixtures came from', () => {
  it('is one constant in ems, not a systematic error plus an outlier', () => {
    const ratios = OBSERVED.map((r) => r.drift / r.size);
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(0.35);
      expect(ratio).toBeLessThan(0.38);
    }
  });

  it('is what the box top and the renderer disagree about', () => {
    // drift = firstBaselineOffset − (sourceBaseline − boxTop). Reproducing the
    // observed number from the formula is what ties the two together.
    for (const row of OBSERVED) {
      const predicted = firstBaselineOffsetPt(row.font, row.size, row.lh)! - (row.baseline - row.boxTop);
      expect(predicted, row.text).toBeCloseTo(row.drift, 0);
    }
  });
});

describe('alignBoxToSourceBaseline', () => {
  it('puts the rendered baseline exactly on the source baseline', () => {
    for (const row of OBSERVED) {
      const aligned = alignBoxToSourceBaseline(row.boxTop, row.baseline, row.font, row.size, row.lh)!;
      const renderedBaseline = aligned.y + firstBaselineOffsetPt(row.font, row.size, row.lh)!;
      expect(renderedBaseline, row.text).toBeCloseTo(row.baseline, 6);
    }
  });

  it('moves the biggest type the furthest, in proportion', () => {
    // `Masline Nyawo` drifted 12.3pt against 2.5pt for a 6.75pt label, and read
    // as an outlier. It is the same constant in ems: 12.3/34.5 = 0.357 against
    // 2.5/6.75 = 0.370. One cause, not two.
    const small = alignBoxToSourceBaseline(100, 104.726, SEGOE_SEMIBOLD, 6.75, 1.3)!;
    const large = alignBoxToSourceBaseline(100, 124.15, PLAYFAIR_MEDIUM, 34.5, 1.3)!;
    expect(Math.abs(large.deltaPt)).toBeGreaterThan(Math.abs(small.deltaPt) * 4);
  });

  it('leaves the box alone when the artifact predates the baseline', () => {
    expect(alignBoxToSourceBaseline(100, undefined, SEGOE_SEMIBOLD, 10, 1.3)).toBeNull();
    expect(alignBoxToSourceBaseline(100, null, SEGOE_SEMIBOLD, 10, 1.3)).toBeNull();
    expect(alignBoxToSourceBaseline(100, Number.NaN, SEGOE_SEMIBOLD, 10, 1.3)).toBeNull();
  });

  it('leaves the box alone for a font whose metrics we never got', () => {
    // A substituted font renders with metrics we did not measure. Moving the
    // block on another font's numbers would trade a known drift for an unknown.
    expect(alignBoxToSourceBaseline(100, 110, null, 10, 1.3)).toBeNull();
  });

  it('refuses a correction too large to be line-box geometry', () => {
    // A baseline that belongs to a different line — swept in from a neighbour —
    // would move the block off its own row. The real corrections are under
    // 0.6em; this bound is more than three times the largest of them.
    const absurd = alignBoxToSourceBaseline(100, 100 + 40 * 10, SEGOE_SEMIBOLD, 10, 1.3);
    expect(absurd).toBeNull();
    const justInside = alignBoxToSourceBaseline(
      100, 100 + firstBaselineOffsetPt(SEGOE_SEMIBOLD, 10, 1.3)! + MAX_BASELINE_CORRECTION_EM * 10 - 0.1,
      SEGOE_SEMIBOLD, 10, 1.3,
    );
    expect(justInside).not.toBeNull();
  });

  it('reports which way it moved', () => {
    // Placing by ink top puts text LOW, so the correction is upward.
    const aligned = alignBoxToSourceBaseline(701.02, 705.8, SEGOE_SEMIBOLD, 6.75, 1.3)!;
    expect(aligned.deltaPt).toBeLessThan(0);
    expect(aligned.y).toBeLessThan(701.02);
  });

  it('is a no-op when the box is already right', () => {
    const offset = firstBaselineOffsetPt(SEGOE_SEMIBOLD, 10, 1.3)!;
    const aligned = alignBoxToSourceBaseline(100, 100 + offset, SEGOE_SEMIBOLD, 10, 1.3)!;
    expect(aligned.deltaPt).toBeCloseTo(0, 9);
    expect(aligned.y).toBeCloseTo(100, 9);
  });
});
