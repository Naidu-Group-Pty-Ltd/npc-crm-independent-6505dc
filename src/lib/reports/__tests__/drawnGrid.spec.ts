/**
 * The Commercial and Industrial reports' grids and tables, measured
 * (`drawnGrid.ts`).
 *
 * A value wider than its column used to print over the next column's value,
 * and a table cell wider than its column lost everything after its first line.
 * The rule pinned here: text gets the room it needs, and a document with
 * nothing too wide is laid out exactly as it always was.
 */
import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import {
  GRID_GUTTER,
  GRID_LINE_STEP,
  GRID_ROW_HEIGHT,
  TABLE_LINE_STEP,
  gridRows,
  tableRowHeight,
} from '@/lib/reports/drawnGrid';

describe('a grid of labels and values', () => {
  it('is laid out exactly as before when every value fits its column', () => {
    const layout = gridRows(['OFFICE', 'FREEHOLD', 'CCZ', '1998', '4,200 m²'], 3);
    expect(layout.top).toEqual([0, GRID_ROW_HEIGHT]);
    expect(layout.height).toBe(2 * GRID_ROW_HEIGHT);
  });

  it('grows a row for its tallest value, and moves every row under it down by the same', () => {
    const layout = gridRows([['Truganina Logistics Estate, 45 Doherty Road,', 'Truganina, VIC, 3029'], ['warehouse'], ['IN1Z'], ['2008']], 2);
    expect(layout.top).toEqual([0, GRID_ROW_HEIGHT + GRID_LINE_STEP]);
    expect(layout.height).toBeCloseTo(2 * GRID_ROW_HEIGHT + GRID_LINE_STEP, 10);
    expect(layout.lines[0]).toHaveLength(2);
  });

  it('never loses a value: every word of a long one is set, inside its own column', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const colW = (210 - 36) / 2;
    const value = 'Truganina Logistics Estate, 45 Doherty Road, Truganina, VIC, 3029';
    const lines = doc.splitTextToSize(value, colW - GRID_GUTTER) as string[];
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(value);
    for (const line of lines) expect(doc.getTextWidth(line)).toBeLessThanOrEqual(colW - GRID_GUTTER + 0.01);
  });

  it('reads an empty value as one empty line, not as no row', () => {
    expect(gridRows([[], ['x']], 2).height).toBe(GRID_ROW_HEIGHT);
  });
});

describe('a table row', () => {
  it('keeps its height when every cell fits', () => {
    expect(tableRowHeight(7, [['Tenant 1 Pty Ltd'], ['Level 1'], ['$420,000']])).toBe(7);
  });

  it('grows for a cell that wraps, rather than keeping only its first line', () => {
    expect(tableRowHeight(7, [['Commonwealth Bank of', 'Australia Limited'], ['Level 1']])).toBeCloseTo(7 + TABLE_LINE_STEP, 10);
  });
});
