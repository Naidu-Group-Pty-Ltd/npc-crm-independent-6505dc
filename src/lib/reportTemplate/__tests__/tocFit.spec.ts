import { describe, expect, it } from 'vitest';
import { fitTocEntries, splitTocColumns, tocOmittedLine } from '../blocks/tocFit';

/**
 * RS-5c.5 — a contents list fits the page it is printed on.
 *
 * Measured 14 Sep 2026 on a 43-page Market Intelligence document: 41 entries
 * from a fixed top of 80pt at 18pt a line ran to 818pt on an 842pt page whose
 * foot begins at ~778pt, and WeasyPrint carried the overflow onto page 3 under
 * that page's own blocks — an illegible run and an overlap the measurer read,
 * and a reader could not.
 */
const A4 = { availablePt: 842 - 80 - 64, titlePt: 22 * 1.6, lineHeightPt: 18, sizePt: 11 };

describe('fitting a contents list to its page', () => {
  it('leaves a short list exactly as authored', () => {
    const fit = fitTocEntries({ ...A4, entries: 12 });
    expect(fit).toEqual({ columns: 1, lineHeightPt: 18, sizePt: 11, shown: 12, omitted: 0, scale: 1 });
  });

  it('takes a second column before it shrinks anything (the measured document)', () => {
    const fit = fitTocEntries({ ...A4, entries: 41 });
    expect(fit.columns).toBe(2);
    expect(fit.scale).toBe(1);
    expect(fit.shown).toBe(41);
    expect(fit.omitted).toBe(0);
    // Two columns of 21 and 20 at 18pt = 378pt, inside the 662pt of room.
    expect(splitTocColumns(Array.from({ length: 41 }, (_, i) => i), 2).map((c) => c.length)).toEqual([21, 20]);
  });

  it('shrinks both columns together, and no further than the floor', () => {
    const fit = fitTocEntries({ ...A4, entries: 80 });
    expect(fit.columns).toBe(2);
    expect(fit.scale).toBeLessThan(1);
    expect(fit.scale).toBeGreaterThanOrEqual(0.8);
    expect(fit.shown).toBe(80);
    expect(fit.omitted).toBe(0);
    expect(fit.sizePt).toBeCloseTo(11 * fit.scale, 5);
  });

  it('cuts what still cannot fit and keeps one line to say so', () => {
    const fit = fitTocEntries({ ...A4, entries: 200 });
    expect(fit.scale).toBe(0.8);
    expect(fit.shown + fit.omitted).toBe(200);
    expect(fit.omitted).toBeGreaterThan(0);
    // The drawn lines plus the closing line never exceed the fitted capacity.
    const perColumn = Math.floor((A4.availablePt - A4.titlePt) / fit.lineHeightPt);
    expect(fit.shown + 1).toBeLessThanOrEqual(2 * perColumn);
    expect(tocOmittedLine(fit.omitted)).toMatch(/^… and \d+ more sections$/);
    expect(tocOmittedLine(1)).toBe('… and 1 more section');
  });

  it('never divides by nothing', () => {
    const fit = fitTocEntries({ entries: 5, availablePt: 0, titlePt: 0, lineHeightPt: 18, sizePt: 11 });
    expect(fit.shown).toBeGreaterThanOrEqual(1);
  });
});
