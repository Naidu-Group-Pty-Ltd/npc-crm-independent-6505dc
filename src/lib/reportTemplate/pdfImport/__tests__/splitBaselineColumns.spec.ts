import { describe, it, expect } from 'vitest';
import {
  splitBaselineColumns,
  MIN_COLUMN_GAP_EM,
  MIN_COLUMN_GAP_PT,
  SAME_BASELINE_TOLERANCE_PT,
  type MeasuredLineGeometry,
} from '../splitBaselineColumns.pure';

const line = (x0: number, x1: number, y: number): MeasuredLineGeometry =>
  ({ x0Pt: x0, x1Pt: x1, baselineYPt: y });

/**
 * The BC Snapshot footer, measured from the source with PyMuPDF: two fields at
 * opposite ends of one 9pt strip, which Docling groups into a single text item.
 */
const FOOTER = [line(72.0, 199.7, 774.2), line(460.3, 521.6, 774.2)];
const FOOTER_FONT_PT = 6.75;

/** The cover title: two lines, stacked, 33.7pt apart. One field. */
const TITLE = [line(103.3, 489.6, 389.0), line(208.4, 384.5, 422.7)];
const TITLE_FONT_PT = 27.75;

describe('splitBaselineColumns', () => {
  it('separates the two footer fields', () => {
    const columns = splitBaselineColumns(FOOTER, FOOTER_FONT_PT);
    expect(columns).toEqual([
      { lineIndices: [0], xPt: 72.0, widthPt: 127.7 },
      { lineIndices: [1], xPt: 460.3, widthPt: 61.3 },
    ]);
  });

  it('keeps the stacked title as one field', () => {
    // Different baselines — a paragraph, whatever its horizontal gaps look like.
    expect(splitBaselineColumns(TITLE, TITLE_FONT_PT)).toBeNull();
  });

  it('does not split a wide word gap', () => {
    // Just under the threshold: max(6.75 × 4, 24) = 27pt.
    const tight = [line(72, 150, 774.2), line(176, 240, 774.2)];
    expect(splitBaselineColumns(tight, FOOTER_FONT_PT)).toBeNull();
    const wide = [line(72, 150, 774.2), line(178, 240, 774.2)];
    expect(splitBaselineColumns(wide, FOOTER_FONT_PT)).not.toBeNull();
  });

  it('scales the threshold with the type size', () => {
    // At 24pt the em rule dominates the absolute floor: 24 × 4 = 96pt.
    const gap80 = [line(72, 150, 500), line(230, 300, 500)];
    expect(splitBaselineColumns(gap80, 24)).toBeNull();
    expect(splitBaselineColumns(gap80, 6.75)).not.toBeNull();
    expect(MIN_COLUMN_GAP_EM * 24).toBeGreaterThan(MIN_COLUMN_GAP_PT);
  });

  it('groups three fields into three columns and keeps source order', () => {
    // The cover's three stat labels sit on one baseline at x 106 / 257 / 423.
    const stats = [line(106.1, 186.1, 705.2), line(256.8, 336.2, 705.2), line(422.7, 471.9, 705.2)];
    const columns = splitBaselineColumns(stats, 6.75);
    expect(columns?.map((c) => c.lineIndices)).toEqual([[0], [1], [2]]);
  });

  it('sorts columns left to right whatever order the lines arrive in', () => {
    const reversed = [line(460.3, 521.6, 774.2), line(72.0, 199.7, 774.2)];
    const columns = splitBaselineColumns(reversed, FOOTER_FONT_PT);
    expect(columns?.map((c) => c.xPt)).toEqual([72.0, 460.3]);
    expect(columns?.map((c) => c.lineIndices)).toEqual([[1], [0]]);
  });

  it('tolerates a baseline that wobbles within a point and a half', () => {
    const wobble = [line(72.0, 199.7, 774.2), line(460.3, 521.6, 774.2 + SAME_BASELINE_TOLERANCE_PT - 0.1)];
    expect(splitBaselineColumns(wobble, FOOTER_FONT_PT)).not.toBeNull();
    const beyond = [line(72.0, 199.7, 774.2), line(460.3, 521.6, 774.2 + SAME_BASELINE_TOLERANCE_PT + 0.1)];
    expect(splitBaselineColumns(beyond, FOOTER_FONT_PT)).toBeNull();
  });
});

describe('splitBaselineColumns — refuses rather than guesses', () => {
  it('needs v2 geometry on every line', () => {
    // A v1 artifact ships widths only. Absent geometry is not geometry at the
    // origin — one missing line disqualifies the item.
    expect(splitBaselineColumns([{}, {}], FOOTER_FONT_PT)).toBeNull();
    expect(splitBaselineColumns([FOOTER[0], {}], FOOTER_FONT_PT)).toBeNull();
    expect(splitBaselineColumns([FOOTER[0], { x0Pt: 460.3, x1Pt: 521.6 }], FOOTER_FONT_PT)).toBeNull();
  });

  it('needs a usable font size', () => {
    for (const size of [0, -1, Number.NaN, undefined as unknown as number]) {
      expect(splitBaselineColumns(FOOTER, size)).toBeNull();
    }
  });

  it('returns null for fewer than two lines or no lines at all', () => {
    expect(splitBaselineColumns(undefined, FOOTER_FONT_PT)).toBeNull();
    expect(splitBaselineColumns([], FOOTER_FONT_PT)).toBeNull();
    expect(splitBaselineColumns([FOOTER[0]], FOOTER_FONT_PT)).toBeNull();
  });

  it('rejects a degenerate line box', () => {
    expect(splitBaselineColumns([line(72, 72, 774.2), FOOTER[1]], FOOTER_FONT_PT)).toBeNull();
    expect(splitBaselineColumns([line(200, 72, 774.2), FOOTER[1]], FOOTER_FONT_PT)).toBeNull();
  });
});
