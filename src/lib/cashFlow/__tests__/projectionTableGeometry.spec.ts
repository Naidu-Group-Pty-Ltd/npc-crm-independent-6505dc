import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { twMerge } from 'tailwind-merge';
import {
  PROJECTION_LABEL_COL_WIDTH,
  PROJECTION_LABEL_HEAD_CLASS,
  PROJECTION_TABLE_CLASS,
  PROJECTION_TABLE_MIN_WIDTH,
  PROJECTION_YEAR_CELL_CLASS,
  PROJECTION_YEAR_COL_COUNT,
  PROJECTION_YEAR_COL_MIN_WIDTH,
  PROJECTION_YEAR_EDIT_CELL_CLASS,
  PROJECTION_YEAR_HEAD_CLASS,
  PROJECTION_SECTION_LABEL_CELL_CLASS,
  PROJECTION_SECTION_LABEL_INNER_CLASS,
  PROJECTION_TOTAL_LABEL_CELL_CLASS,
  PROJECTION_TOTAL_LABEL_INNER_CLASS,
} from '../projectionTableGeometry.pure';

// The primitives these classes are merged onto. Copied from
// `src/components/ui/table.tsx`; the last test in this file fails if they drift.
const TABLE_CELL_BASE = 'px-3 py-2.5 sm:p-4 align-middle [&:has([role=checkbox])]:pr-0';
const TABLE_HEAD_BASE =
  'h-11 px-3 sm:h-12 sm:px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0';

const classesOf = (merged: string) => merged.split(/\s+/).filter(Boolean);

describe('10-Year Projection Overview column geometry', () => {
  it('the floor is the label column plus eleven year columns', () => {
    expect(PROJECTION_YEAR_COL_COUNT).toBe(11); // Today + Years 1-10
    expect(PROJECTION_TABLE_MIN_WIDTH).toBe(
      PROJECTION_LABEL_COL_WIDTH + PROJECTION_YEAR_COL_COUNT * PROJECTION_YEAR_COL_MIN_WIDTH,
    );
    // ...and the table's own class states that same number. A literal at each
    // end is how two ends drift.
    expect(PROJECTION_TABLE_CLASS).toContain(`min-w-[${PROJECTION_TABLE_MIN_WIDTH}px]`);
  });

  it('the floor fits inside the widest scrollport this workspace can offer', () => {
    // Measured against the real page in Chromium: the dashboard shell caps
    // content at 1600px and the padding between there and the table costs
    // 122px, so 1478px is the ceiling on any monitor. The old geometry needed
    // 1525px, which is why Year 10 was cut off on every one of them.
    expect(PROJECTION_TABLE_MIN_WIDTH).toBeLessThan(1478);
  });

  it('a year column holds the widest figure the report draws', () => {
    // "1,034,829" measures 72px at text-sm; the cell adds 8px of padding a
    // side. The editable control needs 62px at text-xs plus its own 8px of
    // padding a side, a 1px border a side and the cell's 4px a side.
    expect(PROJECTION_YEAR_COL_MIN_WIDTH).toBeGreaterThanOrEqual(72 + 8 + 8);
    expect(PROJECTION_YEAR_COL_MIN_WIDTH).toBeGreaterThanOrEqual(62 + 8 + 8 + 1 + 1 + 4 + 4);
  });

  it('fixed layout is scoped to md and up', () => {
    // Under 768px `.responsive-table-scroll > table { min-width: 560px }` is
    // in range and outranks a utility class, so fixed layout would divide
    // 560px into 31px columns. Automatic layout ignores that rule because the
    // content is wider. See the module header.
    expect(PROJECTION_TABLE_CLASS).toContain('md:table-fixed');
    expect(classesOf(PROJECTION_TABLE_CLASS)).not.toContain('table-fixed');
  });

  it('the heads declare a width for fixed layout and a minimum for automatic', () => {
    expect(PROJECTION_LABEL_HEAD_CLASS).toContain(`w-[${PROJECTION_LABEL_COL_WIDTH}px]`);
    expect(PROJECTION_LABEL_HEAD_CLASS).toContain(`min-w-[${PROJECTION_LABEL_COL_WIDTH}px]`);
    expect(PROJECTION_YEAR_HEAD_CLASS).toContain(`min-w-[${PROJECTION_YEAR_COL_MIN_WIDTH}px]`);
    // A year column must NOT declare a width, or fixed layout would stop
    // dividing the remainder between the eleven of them.
    expect(PROJECTION_YEAR_HEAD_CLASS).not.toMatch(/(?:^|\s)w-\[/);
  });

  it('the sticky label column survives the change', () => {
    expect(PROJECTION_LABEL_HEAD_CLASS).toContain('sticky');
    expect(PROJECTION_LABEL_HEAD_CLASS).toContain('left-0');
  });

  it('the year cells actually displace the primitive\'s sm:p-4', () => {
    // The defect this module was written for: `p-1` and `sm:p-4` carry
    // different modifiers, so tailwind-merge keeps both and the media-query
    // rule wins in the cascade. Only a class with the SAME key at the SAME
    // modifier removes it. Both cell classes are asserted against the real
    // merge rather than read for intent.
    for (const cls of [PROJECTION_YEAR_CELL_CLASS, PROJECTION_YEAR_EDIT_CELL_CLASS]) {
      const merged = classesOf(twMerge(TABLE_CELL_BASE, cls));
      expect(merged).not.toContain('sm:p-4');
      expect(merged).not.toContain('px-3');
    }
    // The heads too: `sm:px-4` would put 16px back on every year column.
    expect(classesOf(twMerge(TABLE_HEAD_BASE, PROJECTION_YEAR_HEAD_CLASS))).not.toContain('sm:px-4');
  });

  it('every year cell keeps its centring', () => {
    expect(PROJECTION_YEAR_CELL_CLASS).toContain('text-center');
    expect(PROJECTION_YEAR_EDIT_CELL_CLASS).toContain('text-center');
    expect(PROJECTION_YEAR_EDIT_CELL_CLASS).toContain('align-middle');
  });

  it('the editable control no longer floors its column', () => {
    // `min-w-[88px]` on the control plus 16px of cell padding is exactly the
    // 120px the year columns used to measure.
    const src = readFileSync(
      resolve(__dirname, '../../../components/reports/CashFlowAnalysisModal.tsx'),
      'utf8',
    );
    const cellBox = src.match(/const cellBox = '([^']+)'/);
    expect(cellBox, 'cellBox declaration not found').not.toBeNull();
    expect(cellBox![1]).toContain('w-full');
    expect(cellBox![1]).not.toMatch(/min-w-\[/);
  });

  it('the projection table binds every year column through this module', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../components/reports/CashFlowAnalysisModal.tsx'),
      'utf8',
    );
    // The file holds several tables; take the one that opens with this
    // module's class and stop at ITS close, not the first close in the file.
    const start = src.indexOf('PROJECTION_TABLE_CLASS}>');
    expect(start, 'projection table not found').toBeGreaterThan(-1);
    const table = src.slice(start, src.indexOf('</Table>', start));
    expect(table.length).toBeGreaterThan(0);
    // No year cell may carry a hand-written class again: that is how one row
    // comes to be 16px wider than the ten beside it.
    const handWritten = table.match(/<TableCell key=\{p\.year\} className="[^"]*"/g) ?? [];
    expect(handWritten).toEqual([]);
    expect(table).toContain('PROJECTION_YEAR_CELL_CLASS');
    expect(table).toContain('PROJECTION_YEAR_EDIT_CELL_CLASS');
  });

  it('the primitives this module is merged onto have not drifted', () => {
    const src = readFileSync(resolve(__dirname, '../../../components/ui/table.tsx'), 'utf8');
    expect(src).toContain(TABLE_CELL_BASE);
    expect(src).toContain(TABLE_HEAD_BASE);
  });
});

/**
 * Audit item 2, second pass: "the entire left section should be frozen".
 *
 * The first pass pinned each section heading as a sticky inline-block inside a
 * `colSpan={12}` cell, which holds the TEXT still but leaves the row with no
 * frozen CELL — and it left the two highlighted total rows untouched, whose
 * sticky cells were `bg-primary/10`. A translucent sticky cell does not
 * occlude what scrolls beneath it: the year figures slid under "After-Tax
 * Cash Flow p/a $" and showed through the tint, which on the dark theme is
 * exactly the reported "the sections highlighted in dark blue move while the
 * rows beside them are frozen".
 *
 * The rule these tests hold: a frozen cell is OPAQUE, and the tint is an
 * inner layer. Measured in Chromium against the built stylesheet: with the
 * scroller at +500px, the section cell, the total cell and an ordinary data
 * cell all hold the same left edge, and both new cells compute an opaque
 * background.
 */
describe('the frozen rail runs through the banded rows', () => {
  const modal = () =>
    readFileSync(resolve(__dirname, '../../../components/reports/CashFlowAnalysisModal.tsx'), 'utf8');

  it('a banded row\'s frozen cell is sticky, opaque, and unpadded', () => {
    for (const cell of [PROJECTION_SECTION_LABEL_CELL_CLASS, PROJECTION_TOTAL_LABEL_CELL_CLASS]) {
      const merged = classesOf(twMerge(TABLE_CELL_BASE, cell));
      expect(merged).toContain('sticky');
      expect(merged).toContain('left-0');
      // Opaque base — the whole defect was a translucent one.
      expect(merged).toContain('bg-background');
      expect(cell).not.toMatch(/bg-\w+\/\d/);
      // BOTH paddings must be displaced: `p-0` alone loses to the primitive's
      // `sm:p-4` from 640px up — the tailwind-merge lesson this module's own
      // header records. The tint layer inside carries the real padding.
      expect(merged).toContain('p-0');
      expect(merged).toContain('sm:p-0');
      expect(merged).not.toContain('sm:p-4');
    }
  });

  it('the tint lives on the inner layer, at the padding the cell gave up', () => {
    expect(PROJECTION_SECTION_LABEL_INNER_CLASS).toContain('bg-primary/5');
    expect(PROJECTION_SECTION_LABEL_INNER_CLASS).toContain('px-4 py-3');
    expect(PROJECTION_TOTAL_LABEL_INNER_CLASS).toContain('bg-primary/10');
    // The total row's neighbours keep the primitive's own padding, so its
    // inner layer mirrors it and the row height cannot change.
    expect(PROJECTION_TOTAL_LABEL_INNER_CLASS).toContain('px-3 py-2.5 sm:p-4');
  });

  it('every banded row in the modal goes through these classes', () => {
    const src = modal();
    const sections = src.match(/PROJECTION_SECTION_LABEL_CELL_CLASS/g) ?? [];
    const totals = src.match(/PROJECTION_TOTAL_LABEL_CELL_CLASS/g) ?? [];
    // The import line plus four section rows; the import line plus two totals.
    expect(sections.length).toBe(5);
    expect(totals.length).toBe(3);
    // The first pass's mechanism is gone rather than dormant.
    expect(src).not.toContain('sticky left-0 inline-block');
    expect(src).not.toContain('colSpan={12}');
  });

  it('no sticky cell in the projection table paints a translucent background', () => {
    const src = modal();
    const start = src.indexOf('PROJECTION_TABLE_CLASS}>');
    const table = src.slice(start, src.indexOf('</Table>', start));
    // Every hand-written sticky cell must declare the opaque base beside it.
    for (const sticky of table.match(/className="[^"]*sticky left-0[^"]*"/g) ?? []) {
      expect(sticky, `translucent frozen cell: ${sticky}`).toContain('bg-background');
      expect(sticky).not.toMatch(/sticky[^"]*bg-\w+\/\d/);
    }
  });
});
