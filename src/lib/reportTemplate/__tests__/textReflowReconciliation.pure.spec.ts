/**
 * W1 — text reflow reconciliation.
 *
 * The importer copies a box's bbox verbatim from the source, then re-lays the
 * text in a substituted font. A substitute running 8% wide overflows a box
 * sized for the original — the reported "text boxes constricting their
 * contents". These tests pin the remedy ladder and, more importantly, its
 * bounds: a remedy that is allowed to go too far stops being a fix and becomes
 * a different defect.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_FONT_SHRINK,
  MAX_NEGATIVE_TRACKING_PT,
  MIN_FONT_SIZE_PT,
  reconcileTextReflow,
  type ReflowInput,
} from '@/lib/reportTemplate/pdfImport/textReflowReconciliation.pure';

const base: ReflowInput = {
  sourceWidthPt: 100,
  renderedWidthPt: 100,
  boxWidthPt: 100,
  charCount: 40,
  fontSizePt: 12,
};
const input = (over: Partial<ReflowInput> = {}): ReflowInput => ({ ...base, ...over });

describe('reconcileTextReflow — when nothing is wrong', () => {
  it('does nothing when the substitute fits', () => {
    expect(reconcileTextReflow(input()).remedy).toBe('none');
    expect(reconcileTextReflow(input({ renderedWidthPt: 101.5 })).remedy).toBe('none');
  });

  it('does nothing when the substitute renders NARROWER', () => {
    // Narrow is a fidelity difference, not an overflow. Stretching text to fill
    // a box it does not need would make the page worse, not better.
    const d = reconcileTextReflow(input({ renderedWidthPt: 85 }));
    expect(d.remedy).toBe('none');
    expect(d.ratio).toBeLessThan(1);
  });
});

describe('reconcileTextReflow — the remedy ladder', () => {
  it('tightens tracking for a small overrun', () => {
    const d = reconcileTextReflow(input({ renderedWidthPt: 103 }));
    expect(d.remedy).toBe('letter-spacing');
    expect(d.letterSpacingPt).toBeLessThan(0);
    // 3pt spread over 39 gaps, rounded to 3dp so emitted values carry no
    // float noise into a style attribute.
    expect(d.letterSpacingPt).toBeCloseTo(-3 / 39, 3);
  });

  it('never tightens beyond the tracking bound', () => {
    // A short string cannot absorb much: 8pt over 3 gaps would be -2.67pt.
    const d = reconcileTextReflow(input({ renderedWidthPt: 108, charCount: 4 }));
    expect(d.remedy).not.toBe('letter-spacing');
  });

  it('grows the box into measured free space when tracking is not enough', () => {
    const d = reconcileTextReflow(input({ renderedWidthPt: 108, availableGrowthPt: 20 }));
    expect(d.remedy).toBe('grow-box');
    expect(d.boxWidthPt).toBeCloseTo(108, 3);
  });

  it('refuses to grow without measured space — unknown is not permission', () => {
    // Growing over a sibling trades one defect for a worse one.
    const d = reconcileTextReflow(input({ renderedWidthPt: 108 }));
    expect(d.remedy).not.toBe('grow-box');
    const noRoom = reconcileTextReflow(input({ renderedWidthPt: 108, availableGrowthPt: 2 }));
    expect(noRoom.remedy).not.toBe('grow-box');
  });

  it('shrinks the type only as a last resort, and only within bounds', () => {
    const d = reconcileTextReflow(input({ renderedWidthPt: 103.5, charCount: 2 }));
    expect(d.remedy).toBe('font-size');
    expect(d.fontSizePt!).toBeLessThan(12);
    expect(d.fontSizePt!).toBeGreaterThanOrEqual(12 * (1 - MAX_FONT_SHRINK));
  });

  it('gives up rather than shrinking text past recognition', () => {
    const d = reconcileTextReflow(input({ renderedWidthPt: 200, charCount: 3 }));
    expect(d.remedy).toBe('source-crop-recommended');
    expect(d.reason).toBe('overflow_exceeds_all_bounded_remedies');
  });
});

describe('reconcileTextReflow — sizes that are not ours to change', () => {
  it('never shrinks a disclaimer or footnote', () => {
    // These often carry a legally-required minimum size. Shrinking one to
    // resolve a layout problem is not a layout decision.
    for (const label of ['footnote', 'disclaimer', 'legal', 'caption']) {
      const d = reconcileTextReflow(input({ renderedWidthPt: 103.5, charCount: 2, label }));
      expect(d.remedy, label).toBe('source-crop-recommended');
      expect(d.reason).toBe('size_locked_label_cannot_shrink');
    }
  });

  it('still grows a locked label into free space', () => {
    const d = reconcileTextReflow(input({
      renderedWidthPt: 108, charCount: 2, availableGrowthPt: 20, label: 'footnote',
    }));
    expect(d.remedy).toBe('grow-box');
  });

  it('never reduces below the absolute floor', () => {
    const d = reconcileTextReflow(input({
      fontSizePt: MIN_FONT_SIZE_PT, renderedWidthPt: 103.5, charCount: 2,
    }));
    expect(d.remedy).not.toBe('font-size');
  });
});

describe('reconcileTextReflow — bad measurements', () => {
  it('does nothing rather than acting on a measurement it does not have', () => {
    // Doing nothing leaves a visible defect; acting on a bad number silently
    // corrupts a page. The first is recoverable.
    for (const over of [
      { sourceWidthPt: 0 }, { sourceWidthPt: -5 }, { sourceWidthPt: Number.NaN },
      { renderedWidthPt: 0 }, { renderedWidthPt: Number.NaN },
    ]) {
      const d = reconcileTextReflow(input(over));
      expect(d.remedy).toBe('none');
      expect(d.reason).toMatch(/no_(source|rendered)_measurement/);
    }
  });

  it('never throws on hostile input', () => {
    const nasty = [
      { charCount: 0 }, { charCount: 1 }, { charCount: -3 },
      { fontSizePt: 0 }, { boxWidthPt: 0 },
      { availableGrowthPt: Number.NaN }, { availableGrowthPt: -10 },
    ];
    for (const over of nasty) {
      expect(() => reconcileTextReflow(input({ renderedWidthPt: 130, ...over }))).not.toThrow();
    }
  });
});

describe('reconcileTextReflow — contract', () => {
  it('is deterministic', () => {
    const i = input({ renderedWidthPt: 106, availableGrowthPt: 30 });
    expect(reconcileTextReflow(i)).toEqual(reconcileTextReflow(i));
  });

  it('always reports the ratio it decided on', () => {
    const d = reconcileTextReflow(input({ renderedWidthPt: 112 }));
    expect(d.ratio).toBeCloseTo(1.12, 3);
  });

  it('tracking is always negative and bounded', () => {
    for (let w = 101; w <= 104; w += 0.5) {
      const d = reconcileTextReflow(input({ renderedWidthPt: w }));
      if (d.remedy !== 'letter-spacing') continue;
      expect(d.letterSpacingPt!).toBeLessThan(0);
      expect(Math.abs(d.letterSpacingPt!)).toBeLessThanOrEqual(MAX_NEGATIVE_TRACKING_PT);
    }
  });
});
