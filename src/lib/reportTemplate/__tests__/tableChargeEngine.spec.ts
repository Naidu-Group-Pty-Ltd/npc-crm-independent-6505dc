/**
 * The table charge against the pinned engine, and the chunk a split makes.
 *
 * Every figure under `ENGINE` was read from WeasyPrint 69 on 23 Sep 2026 with
 * the faces the render container installs (`fonts-noto-core`, `fonts-lato`,
 * `fonts-roboto`, Inter), setting each table with the exact inline styles
 * `markdownBlock.html.ts` emits, and measuring from the table's top to the
 * next block's top (head, rows, borders and the table's 8pt margin).
 *
 * The rule a charge answers to is the one `narrativeGeometry.spec.ts` states:
 * never below what the engine drew — a charge below the engine is a page that
 * sets through its running foot — and not far above it, because a charge
 * above the engine is the white space the owner sent the 23 Sep 2026 Compass
 * back for.
 */
import { describe, expect, it } from 'vitest';
import {
  FACE_CLASS_ADVANCE_EM, TABLE_WIDTH_SAFETY, UNKNOWN_FACE_CLASS_ADVANCE_EM, faceClassAdvance,
  narrativeGeometry, pitchPt, tableCharge, type NarrativeGeometry,
} from '../../../../supabase/functions/_shared/reports/narrativeGeometry.pure';
import { renderMarkdown, splitTableBlock } from '../../../../supabase/functions/_shared/reports/markdown.pure';

const A4 = { width: 595, height: 842 };
function geometry(face: string, size: number, width: number): NarrativeGeometry {
  const x = (A4.width - width) / 2;
  return narrativeGeometry(
    { x, y: 199, width, bodyPt: size, lineHeight: 1.55, face },
    { x, y: 114, width, bodyPt: size, lineHeight: 1.55, face },
    A4,
  );
}

/**
 * The loan table of the 18 Annabelle Crescent Financial report, verbatim, on
 * Lato 9pt over 441pt. The old model shared the measure by characters, so
 * the long value took the width and it charged the labels one line each —
 * and the engine, which interpolates between min- and max-content widths,
 * set five rows on two lines (four labels and that value). The table sat 3.7
 * lines below the engine: the worst of 1,036 table layouts measured.
 */
const LOAN_TABLE = {
  head: ['Item', 'Value'],
  cells: [
    ['Loan amount', '$1,192,000'],
    ['Loan-to-value ratio', '80%'],
    ['Loan type', 'Interest only'],
    ['Loan structure', 'Interest only for 5 years (term not recorded; assumed), then principal and interest over the remaining 25 years (30-year term)'],
    ['Interest-only period', '5 years, then principal and interest'],
    ['Loan term', '30 years'],
    ['Interest rate (User specified)', '6.5%'],
    ['Monthly repayment (first year)', '$6,457'],
    ['Weekly repayment', '$1,490'],
    ['Annual repayments (first year)', '$77,480'],
    ['Total interest over the term', '$1,609,941'],
  ],
  /** Head, eleven rows, borders and margin, in points. */
  engineTotalPt: 304.95,
  /** The rows the engine set on two lines. */
  twoLineRows: [3, 6, 7, 9, 10],
};

/** A two-column assumptions table (Pallas Street), Inter 9.5pt over 481pt: every row one line. */
const ASSUMPTIONS_TABLE = {
  head: ['Modelling assumption', 'Value'],
  cells: [
    ['Capital growth', '9.7%'],
    ['Conservative scenario growth', '7.7% value, 2.5% rent'],
    ['Base case scenario growth', '9.7% value, 3% rent'],
    ['Optimistic scenario growth', '11.7% value, 3.5% rent'],
    ['Occupancy', '52 weeks a year'],
    ['Percentage fees charged on', 'rent collected'],
    ['Growth timing', 'Year-1 figures carry one year of growth; settlement is year 0.'],
    ['Cash-flow basis', 'pre-tax; each year is rent less operating costs less loan repayments'],
  ],
  engineTotalPt: 188.11,
};

describe('a table is charged as the engine lays it out', () => {
  it('charges the loan table no lower than the engine drew it, and within a line of it', () => {
    const g = geometry('Lato, sans-serif', 9, 441);
    const charged = tableCharge(g, LOAN_TABLE.cells, 2, LOAN_TABLE.head).total * pitchPt(g);
    expect(charged).toBeGreaterThanOrEqual(LOAN_TABLE.engineTotalPt - 0.5);
    expect(charged).toBeLessThanOrEqual(LOAN_TABLE.engineTotalPt + pitchPt(g));
  });

  it('wraps a label the engine wraps: auto layout shares the measure by min and max content', () => {
    const g = geometry('Lato, sans-serif', 9, 441);
    const { rowLines } = tableCharge(g, LOAN_TABLE.cells, 2, LOAN_TABLE.head);
    const oneLine = Math.min(...rowLines);
    for (const row of LOAN_TABLE.twoLineRows) {
      expect(rowLines[row], `row ${row}: ${LOAN_TABLE.cells[row][0]}`).toBeGreaterThan(oneLine + 0.5);
    }
  });

  it('charges a table of one-line rows at one line a row', () => {
    const g = geometry('Inter, sans-serif', 9.5, 481);
    const charged = tableCharge(g, ASSUMPTIONS_TABLE.cells, 2, ASSUMPTIONS_TABLE.head).total * pitchPt(g);
    expect(charged).toBeGreaterThanOrEqual(ASSUMPTIONS_TABLE.engineTotalPt - 0.5);
    expect(charged).toBeLessThanOrEqual(ASSUMPTIONS_TABLE.engineTotalPt + 2);
  });

  it('charges a wrapped column head', () => {
    const g = geometry('Noto Serif, serif', 9.5, 459);
    const narrow = [['A', 'B', 'x'.repeat(40), 'y'.repeat(40), 'z'.repeat(40)]];
    const plain = tableCharge(g, narrow, 5, ['R', 'L', 'W', 'C', 'E']);
    const long = tableCharge(g, narrow, 5, ['Risk', 'Exposure level stated by the register', 'W', 'C', 'E']);
    expect(long.headLines).toBeGreaterThan(plain.headLines);
  });

  it('charges a caption above the head', () => {
    const g = geometry('Noto Serif, serif', 8.25, 505);
    const rows = [['Health Care and Social Assistance', '12.9%'], ['Retail Trade', '9.5%']];
    const bare = tableCharge(g, rows, 2, ['Item', 'Value (%)']);
    const captioned = tableCharge(g, rows, 2, ['Item', 'Value (%)'], 'Key industries in postcode 2155 workforce');
    expect(captioned.total - bare.total).toBeGreaterThan(0.8);
  });
});

describe('the face table', () => {
  it('holds the four body faces the masters set, at the three weights a table uses', () => {
    for (const face of ['inter', 'noto serif', 'lato', 'roboto']) {
      for (const w of [400, 500, 600] as const) {
        const a = FACE_CLASS_ADVANCE_EM[face][w];
        expect(a.digit, `${face} ${w}`).toBeGreaterThan(a.space);
        expect(a.upper, `${face} ${w}`).toBeGreaterThan(a.punct);
      }
    }
  });

  it('charges an unknown face at the widest measured width of every class', () => {
    expect(faceClassAdvance('Some Unmeasured Face')).toBe(UNKNOWN_FACE_CLASS_ADVANCE_EM);
    for (const w of [400, 500, 600] as const) {
      for (const face of Object.values(FACE_CLASS_ADVANCE_EM)) {
        for (const k of Object.keys(face[w]) as (keyof typeof face[400])[]) {
          expect(UNKNOWN_FACE_CLASS_ADVANCE_EM[w][k]).toBeGreaterThanOrEqual(face[w][k]);
        }
      }
    }
  });

  it('keeps a margin over the measured widths', () => {
    expect(TABLE_WIDTH_SAFETY).toBeGreaterThan(1);
    expect(TABLE_WIDTH_SAFETY).toBeLessThan(1.1);
  });
});

describe('a chunk is charged as the table it becomes', () => {
  const REGISTER = [
    '| Risk | Level | Why it matters | Required check |',
    '|---|---|---|---|',
    ...Array.from({ length: 8 }, (_, i) => `| Risk number ${i + 1} with a longer label | ${i % 2 ? 'Moderate' : 'Low'} | ${'A sentence of reasons that runs across the column. '.repeat(i % 3 + 2)} | ${'Confirm the matter with the council. '.repeat(2)} |`),
  ].join('\n');

  it('re-lays each chunk from its own rows rather than slicing the whole table', () => {
    const g = geometry('Noto Serif, serif', 8.25, 505);
    const { blocks } = renderMarkdown(REGISTER, { geometry: g });
    const table = blocks.find((b) => b.kind === 'table')!;
    expect(table.table?.charge, 'the geometry model keeps what it charged').toBeDefined();
    const chunks = splitTableBlock(table, 25, 40);
    expect(chunks.length).toBeGreaterThan(1);
    let from = 0;
    for (const chunk of chunks) {
      const rows = chunk.table!.rows.length;
      const own = tableCharge(g, table.table!.charge!.cells.slice(from, from + rows), 4, table.table!.charge!.head);
      expect(chunk.lines).toBeCloseTo(own.total, 6);
      expect(chunk.table!.rowLines).toEqual(own.rowLines);
      from += rows;
    }
    expect(from).toBe(table.table!.rows.length);
  });
});

describe('a chart set as a table is charged as the table it is', () => {
  it('charges rows, head, caption and margin at the page\'s own measure', async () => {
    const { scanVizDirectives } = await import('../../../../supabase/functions/_shared/reports/vizDirectives.pure');
    const { renderVizDirective, planningChartContext } = await import('../../../../supabase/functions/_shared/reports/vizFigures.pure');
    const g = geometry('Noto Serif, serif', 8.25, 505);
    // A range cannot be plotted, so the bars decline and the same data is set
    // as a table (`asTable`) — the 18 Annabelle Crescent industries chart was
    // one of these, charged seven lines where the engine drew ten.
    const { directives } = scanVizDirectives('{{bars: Health care ~12–13%, Retail 9.5%, Education 8.1%, Construction 7.9%, Professional services 10.9% | title=Key industries in postcode 2155 workforce}}');
    expect(directives.length).toBe(1);
    const figure = renderVizDirective(planningChartContext(), directives[0], g);
    expect(figure?.html).toContain('<table');
    const rows = (figure!.html.match(/<tr>/g) ?? []).length - 1;
    expect(rows).toBe(5);
    // At least the rows the engine draws (a 7.6pt row is 18.3pt) plus the head
    // and the caption line — never the old `rows + 2` body lines.
    expect(figure!.lines * pitchPt(g)).toBeGreaterThanOrEqual(5 * 18.28 + 18.5 + 11.7);
  });
});
