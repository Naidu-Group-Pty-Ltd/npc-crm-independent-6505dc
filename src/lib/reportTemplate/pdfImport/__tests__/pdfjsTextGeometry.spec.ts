/**
 * Placing a PDF's text from its own content stream.
 *
 * The fixtures below are REAL PDF.js output, taken from
 * `reports/golden/borrowing-capacity-snapshot.pdf` page 2, and the expected
 * numbers are PyMuPDF's reading of the same file — a completely separate
 * implementation. Where the two agree (baseline, x, advance width) that number
 * is in the file and these tests lock it. Where they disagree (box top: PyMuPDF
 * inflates the ascender for base-14 fonts) the test states which one this module
 * follows and why.
 */
import { describe, it, expect } from 'vitest';
import {
  multiplyMatrix,
  placeTextFragment,
  mergeFragmentsIntoLines,
  MAX_INTRA_LINE_GAP_EM,
  SAME_BASELINE_TOLERANCE_PT,
  type Matrix6,
  type PlacedTextFragment,
} from '../pdfjsTextGeometry.pure';

/** A scale-1 A4 viewport: the y-flip and nothing else. */
const A4_VIEWPORT: Matrix6 = [1, 0, 0, -1, 0, 841.89];
/** Helvetica's own AFM metrics, as PDF.js reports them. */
const HELVETICA = { ascent: 0.718, descent: -0.207, fontFamily: 'sans-serif', vertical: false };

function place(over: Record<string, unknown> = {}, style: unknown = HELVETICA) {
  return placeTextFragment(
    { str: 'A. & J. Sample', transform: [18, 0, 0, 18, 56.69, 756.85], width: 125.046, height: 18, fontName: 'g_d0_f1', hasEOL: false, ...over },
    style as never,
    A4_VIEWPORT,
  );
}

describe('multiplyMatrix', () => {
  it('matches PDF.js Util.transform', () => {
    // Verified against pdfjs.Util.transform([1,0,0,-1,0,841.89], [18,0,0,18,56.69,756.85])
    // which returns [18,0,0,-18,56.69,85.04].
    expect(multiplyMatrix(A4_VIEWPORT, [18, 0, 0, 18, 56.69, 756.85]).map((n) => Math.round(n * 100) / 100))
      .toEqual([18, 0, 0, -18, 56.69, 85.04]);
  });

  it('is not commutative — argument order is the contract', () => {
    const a: Matrix6 = [2, 0, 0, 2, 10, 20];
    const b: Matrix6 = [1, 0, 0, 1, 5, 5];
    expect(multiplyMatrix(a, b)).not.toEqual(multiplyMatrix(b, a));
  });
});

describe('placeTextFragment', () => {
  it('reproduces PyMuPDF on the numbers the file actually states', () => {
    const box = place()!;
    // PyMuPDF: origin=(56.69, 85.04), x1−x0 = 125.05.
    expect(box.x).toBeCloseTo(56.69, 2);
    expect(box.baselineYPt).toBeCloseTo(85.04, 2);
    expect(box.width).toBeCloseTo(125.05, 1);
    expect(box.fontSizePt).toBeCloseTo(18, 6);
  });

  it('derives y from the baseline and the font\'s own ascent', () => {
    // 85.04 − 0.718×18 = 72.12. PyMuPDF reports 65.78 for the same run because
    // it uses an inflated ascender (1.07) for the base-14 substitutes. Only the
    // baseline is in the file, so this places from the baseline.
    const box = place()!;
    expect(box.y).toBeCloseTo(72.12, 2);
    expect(box.height).toBeCloseTo((0.718 + 0.207) * 18, 4);
    expect(box.y + box.height).toBeGreaterThan(box.baselineYPt); // descender below the baseline
  });

  it('honours the page height carried by the viewport transform', () => {
    // A letter-size page flips at a different height; hard-coding A4 would put
    // every element ~50pt out.
    const letter = placeTextFragment(
      { str: 'x', transform: [10, 0, 0, 10, 20, 700], width: 5, hasEOL: false },
      HELVETICA as never,
      [1, 0, 0, -1, 0, 792],
    )!;
    expect(letter.baselineYPt).toBeCloseTo(92, 6);
  });

  it('drops the fragments PDF.js synthesises for gaps', () => {
    // A whitespace-only item carries a width spanning the WHOLE gap to the next
    // run (219pt for a single space, on the fixture page). Treating it as text
    // would place a 219pt-wide blank overlay across the header.
    expect(place({ str: ' ', width: 219.05 })).toBeNull();
    expect(place({ str: '', width: 0, hasEOL: true })).toBeNull();
    expect(place({ str: '\n  \t' })).toBeNull();
    expect(place({ str: undefined })).toBeNull();
  });

  it('drops rotated and sheared runs rather than boxing them', () => {
    // An axis-aligned box for rotated text reports a position the glyphs are
    // not at, and the agent treats positions as authoritative.
    expect(place({ transform: [12.7, 12.7, -12.7, 12.7, 100, 700] })).toBeNull();
    expect(place({ transform: [18, 0, 6, 18, 56.69, 756.85] })).toBeNull();
    // A tiny numeric wobble in an unrotated matrix is still unrotated.
    expect(place({ transform: [18, 1e-9, 1e-9, 18, 56.69, 756.85] })).not.toBeNull();
  });

  it('drops vertical text', () => {
    expect(place({}, { ...HELVETICA, vertical: true })).toBeNull();
  });

  it('drops degenerate geometry rather than reporting a guess', () => {
    expect(place({ width: 0 })).toBeNull();
    expect(place({ width: -3 })).toBeNull();
    expect(place({ width: 'wide' })).toBeNull();
    expect(place({ transform: [0, 0, 0, 0, 10, 10] })).toBeNull();
    expect(place({ transform: [18, 0, 0, 18] })).toBeNull();
    expect(place({ transform: null })).toBeNull();
  });

  it('still places at the right baseline when the font reports no metrics', () => {
    // Only the box height is then approximate; the baseline is what matters and
    // it comes from the matrix, not the metrics.
    const box = place({}, { fontFamily: 'sans-serif' })!;
    expect(box.baselineYPt).toBeCloseTo(85.04, 2);
    expect(box.height).toBeGreaterThan(0);
    expect(placeTextFragment(
      { str: 'x', transform: [10, 0, 0, 10, 0, 800], width: 5 }, null, A4_VIEWPORT,
    )!.height).toBeGreaterThan(0);
  });

  it('never reports a CSS generic as the typeface', () => {
    // The agent treats a supplied family as authoritative, so passing on PDF.js's
    // fallback would set every overlay to the literal string "sans-serif"
    // instead of letting the model read the typeface off the page.
    expect(place()!.fontFamily).toBeUndefined();
    expect(place({}, { ...HELVETICA, fontFamily: 'monospace' })!.fontFamily).toBeUndefined();
    expect(place({}, { ...HELVETICA, fontFamily: '"Playfair Display"' })!.fontFamily).toBe('Playfair Display');
  });
});

describe('mergeFragmentsIntoLines', () => {
  const frag = (over: Partial<PlacedTextFragment>): PlacedTextFragment => ({
    text: 'x', x: 0, y: 90, width: 20, height: 10, fontSizePt: 10, baselineYPt: 100, hasEOL: false, ...over,
  });

  it('joins fragments of one rendered line', () => {
    const merged = mergeFragmentsIntoLines([
      frag({ text: 'Assessment', x: 60, width: 50 }),
      frag({ text: 'Date', x: 112, width: 20 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('Assessment Date');
    expect(merged[0].x).toBe(60);
    expect(merged[0].width).toBe(72); // 132 − 60
  });

  it('does not join across a table gutter', () => {
    // Real page-3 geometry: "Source" ends at 92.32 and "Gross Amount" starts at
    // 298.89 on the same baseline — 206pt at 8pt type. Merging that invents a
    // sentence out of two cells.
    const merged = mergeFragmentsIntoLines([
      frag({ text: 'Source', x: 65.2, width: 27.12, fontSizePt: 8 }),
      frag({ text: 'Gross Amount', x: 298.89, width: 55.56, fontSizePt: 8 }),
    ]);
    expect(merged.map((m) => m.text)).toEqual(['Source', 'Gross Amount']);
  });

  it('splits exactly at the documented gap threshold', () => {
    const em = 10;
    const near = mergeFragmentsIntoLines([
      frag({ text: 'a', x: 0, width: 20 }),
      frag({ text: 'b', x: 20 + em * MAX_INTRA_LINE_GAP_EM, width: 10 }),
    ]);
    expect(near).toHaveLength(1);
    const far = mergeFragmentsIntoLines([
      frag({ text: 'a', x: 0, width: 20 }),
      frag({ text: 'b', x: 20 + em * MAX_INTRA_LINE_GAP_EM + 0.1, width: 10 }),
    ]);
    expect(far).toHaveLength(2);
  });

  it('keeps different baselines apart', () => {
    const merged = mergeFragmentsIntoLines([
      frag({ text: 'line one', baselineYPt: 100 }),
      frag({ text: 'line two', baselineYPt: 100 + SAME_BASELINE_TOLERANCE_PT + 0.5, x: 22 }),
    ]);
    expect(merged.map((m) => m.text)).toEqual(['line one', 'line two']);
  });

  it('tolerates a sub-point baseline wobble within one line', () => {
    const merged = mergeFragmentsIntoLines([
      frag({ text: 'super', baselineYPt: 100 }),
      frag({ text: 'script', baselineYPt: 99.4, x: 21 }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('adds no space for a kerned join, and one for a word gap', () => {
    expect(mergeFragmentsIntoLines([
      frag({ text: 'Wa', x: 0, width: 20 }),
      frag({ text: 'ter', x: 20, width: 15 }),
    ])[0].text).toBe('Water');
    expect(mergeFragmentsIntoLines([
      frag({ text: 'Total', x: 0, width: 20 }),
      frag({ text: 'debt', x: 24, width: 20 }),
    ])[0].text).toBe('Total debt');
  });

  it('does not double a space the fragments already carry', () => {
    expect(mergeFragmentsIntoLines([
      frag({ text: 'Total ', x: 0, width: 22 }),
      frag({ text: 'debt', x: 26, width: 20 }),
    ])[0].text).toBe('Total debt');
  });

  it('breaks the line when the source says the line ended', () => {
    const merged = mergeFragmentsIntoLines([
      frag({ text: 'first', x: 0, width: 20, hasEOL: true }),
      frag({ text: 'second', x: 21, width: 20 }),
    ]);
    expect(merged.map((m) => m.text)).toEqual(['first', 'second']);
  });

  it('joins runs that overlap horizontally', () => {
    // Re-positioned or kerned runs can start left of where the previous ended.
    // A negative gap is not a column boundary.
    expect(mergeFragmentsIntoLines([
      frag({ text: 'AV', x: 0, width: 20 }),
      frag({ text: 'A', x: 18, width: 10 }),
    ])).toHaveLength(1);
  });

  it('reads a scrambled content stream in document order', () => {
    // A PDF is under no obligation to emit runs top-to-bottom or left-to-right.
    const merged = mergeFragmentsIntoLines([
      frag({ text: 'second', baselineYPt: 200, x: 0, width: 20 }),
      frag({ text: 'is', baselineYPt: 100, x: 22, width: 8 }),
      frag({ text: 'this', baselineYPt: 100, x: 0, width: 20 }),
    ]);
    expect(merged.map((m) => m.text)).toEqual(['this is', 'second']);
  });

  it('takes the line\'s type size from its largest run', () => {
    const merged = mergeFragmentsIntoLines([
      frag({ text: 'Total', x: 0, width: 20, fontSizePt: 9, y: 92, height: 9 }),
      frag({ text: '$785,000', x: 22, width: 40, fontSizePt: 14, y: 88, height: 14 }),
    ]);
    expect(merged[0].fontSizePt).toBe(14);
    // The box grows to hold both runs.
    expect(merged[0].y).toBe(88);
    expect(merged[0].y + merged[0].height).toBe(102);
  });

  it('is empty for empty input', () => {
    expect(mergeFragmentsIntoLines([])).toEqual([]);
  });
});
