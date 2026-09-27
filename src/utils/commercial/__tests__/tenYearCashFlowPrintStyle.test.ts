/**
 * The stylesheet the C&I 10-year cash flow report is printed in
 * (`tenYearCashFlowPrintStyle.ts`).
 *
 * The rules pinned here:
 *
 *  - with no design chosen it is the house sheet the report has always printed
 *    in, byte for byte;
 *  - a design reaches colours, rules and the heading face, and never the layout
 *    — every rule the house sheet states is stated again, and nothing is hidden;
 *  - the head is the design's cover: a field panel on a field or band design, a
 *    rule in its accent on a paper one;
 *  - the card prints through this module and states no type or colour of its own.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOUSE_PRINT_STYLE, tenYearCashFlowPrintStyle } from '@/utils/commercial/tenYearCashFlowPrintStyle';
import { drawnDesignOf, type DrawnDocumentDesign } from '@/lib/reportDesign/drawnDesign.pure';
import { resolveCatalogueDesign } from '@/lib/reportDesign/templateDesign.pure';

function design(code: string, colourway?: string): DrawnDocumentDesign {
  const result = resolveCatalogueDesign({ code, colourway });
  if (result.ok === false) throw new Error(`${code}: ${result.reason}`);
  return drawnDesignOf(result.design);
}

const FIELD = design('pb-01', 'pb-navy-signet');   // Private Banking — a field cover
const BAND = design('ir-01', 'ir-oxford');         // Institutional Research — a band cover
const PAPER = design('ap-01', 'ap-blueprint');     // Architectural — a paper cover

/** The selectors a sheet states, in order. */
const selectors = (css: string) => [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());

describe('the printed 10-year cash flow report', () => {
  it('is in the house sheet with no design chosen — the one it has always printed in', () => {
    expect(tenYearCashFlowPrintStyle(null)).toBe(HOUSE_PRINT_STYLE);
    // The sheet the card inlined before designs existed, measured from that commit.
    expect(createHash('sha256').update(HOUSE_PRINT_STYLE).digest('hex'))
      .toBe('5f598098373b7d13522d7a493c2177ae9ddfa9645937a88ca594ff06b32de8b7');
  });

  it("keeps every rule of the house sheet in a design, in the design's own inks", () => {
    for (const d of [FIELD, BAND, PAPER]) {
      const css = tenYearCashFlowPrintStyle(d);
      const stated = selectors(css);
      for (const selector of selectors(HOUSE_PRINT_STYLE)) {
        expect(stated.some((s) => s.split(',').map((x) => x.trim()).some((x) => selector.split(',').map((y) => y.trim()).includes(x)))).toBe(true);
      }
      // The layout is the house layout: the grid, the cards, the page break, the table.
      expect(css).toContain('.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}');
      expect(css).toContain('.page-break{break-before:page}');
      expect(css).toContain('table{width:100%;border-collapse:collapse;margin-top:8px}');
      // Nothing is hidden that the house sheet prints: its print button, and only that.
      expect(css.match(/display:\s*none/g)).toEqual(HOUSE_PRINT_STYLE.match(/display:\s*none/g));
      expect(css).toContain('button{display:none}');
      expect(css).not.toMatch(/visibility:\s*hidden/);
      // The design's inks, not the house's.
      expect(css).toContain(`color:${d.family.bodyInk}`);
      expect(css).toContain(`th{background:${d.family.deep};color:${d.family.onDeep}}`);
      // eslint-disable-next-line no-restricted-syntax -- the house sheet's accent, asserted absent
      expect(css).not.toContain('#2563eb');
    }
  });

  it("heads the report with the design's cover", () => {
    for (const d of [FIELD, BAND]) {
      expect(d.cover.ground).not.toBe('paper');
      expect(tenYearCashFlowPrintStyle(d)).toContain(`.cover{background:${d.family.field};color:${d.family.onField};`);
    }
    expect(PAPER.cover.ground).toBe('paper');
    const paper = tenYearCashFlowPrintStyle(PAPER);
    expect(paper).toContain(`.cover{border-bottom:3px solid ${PAPER.family.accent};`);
    expect(paper).not.toContain('.cover{background:');
  });

  it("sets the headings in a serif only where the design's are one", () => {
    const serif = [FIELD, BAND, PAPER].filter((d) => d.faces.heading === 'times');
    const sans = [FIELD, BAND, PAPER].filter((d) => d.faces.heading !== 'times');
    expect(serif.length + sans.length).toBe(3);
    for (const d of serif) expect(tenYearCashFlowPrintStyle(d)).toContain("h1,h2,h3{color:" + d.family.deep + ";font-family:Georgia,'Times New Roman',serif}");
    for (const d of sans) expect(tenYearCashFlowPrintStyle(d)).toContain('font-family:Arial,sans-serif}');
    // The body copy keeps the house face in every design.
    for (const d of [FIELD, BAND, PAPER]) expect(tenYearCashFlowPrintStyle(d)).toMatch(/^body\{font-family:Arial,sans-serif;/);
  });

  it('is what the card prints in, for the design chosen for the C&I Capacity report', () => {
    const card = readFileSync(resolve(__dirname, '../../../components/commercial/calculators/TenYearCashFlowCard.tsx'), 'utf8');
    expect(card).toContain('<style>${tenYearCashFlowPrintStyle(design)}</style>');
    expect(card).toContain("drawnDesignFor('commercial_cash_flow')");
    // The card states no type or colour of the printed report itself.
    const printed = card.slice(card.indexOf('const buildPdfHtml'), card.indexOf('const runPdfGeneration'));
    expect(printed).not.toMatch(/font-family|#[0-9a-fA-F]{3,6}\b/);
  });
});
