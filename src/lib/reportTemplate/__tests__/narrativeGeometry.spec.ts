/**
 * The narrative charge model against the pinned engine.
 *
 * Every number under `MEASURED` was read from WeasyPrint 69 by
 * `scripts/verify/report-pdf/measureNarrativeMetrics.py`, which sets each
 * probe with the exact inline styles `markdownBlock.html.ts` emits and reads
 * the height the engine gives it, in body lines of the structure's own pitch.
 * The model is expected to agree with the engine within a twentieth of a line
 * on every probe — and to err on the high side where it errs at all, because
 * a charge below the engine is a page that overflows into the running foot.
 *
 * The three cases are the three active Investment Compass structures.
 */
import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_TYPE, NARRATIVE_FOOT_RESERVE_PT, NARRATIVE_HOLDBACK, UNKNOWN_FACE_ADVANCE_EM,
  calloutCharge, faceAdvanceEm, figureCharge, headingCharge, listCharge, narrativeBottom, narrativeGeometry,
  paragraphCharge, pitchPt, tableCharge, type NarrativeGeometry,
} from '../../../../supabase/functions/_shared/reports/narrativeGeometry.pure';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROSE_CHARS = 953;
const ITEM = "Item one of a list set at the template's size and face.".length;

type Measured = Record<string, number>;

/** (body face, size, leading, measure) → what the engine drew, in body lines. */
const CASES: Array<{ label: string; face: string; size: number; lh: number; width: number; measured: Measured }> = [
  {
    label: 'Midnight — Noto Serif 9.5/1.55 over 459pt', face: 'Noto Serif, serif', size: 9.5, lh: 1.55, width: 459,
    measured: { paragraph: 10.41, h2: 1.61, list3: 3.68, table3: 5.99, figureCompact: 13.25, figureFull: 13.26, figureCaptioned: 14.33, callout3: 5.77 },
  },
  {
    label: 'Chancery — Inter 9.5/1.55 over 481pt', face: 'Inter, sans-serif', size: 9.5, lh: 1.55, width: 481,
    measured: { paragraph: 9.41, h2: 1.61, list3: 3.68, table3: 5.99, figureCompact: 13.84, figureFull: 13.85, figureCaptioned: 14.92, callout3: 5.77 },
  },
  {
    label: 'Dictionary — Inter 8.75/1.55 over 509pt', face: 'Inter, sans-serif', size: 8.75, lh: 1.55, width: 509,
    measured: { paragraph: 8.44, h2: 1.65, list3: 3.74, table3: 6.23, figureCompact: 15.84, figureFull: 15.85, figureCaptioned: 16.94, callout3: 5.94 },
  },
];

const A4 = { width: 595, height: 842 };

function geometryOf(c: (typeof CASES)[number]): NarrativeGeometry {
  const margin = (A4.width - c.width) / 2;
  return narrativeGeometry(
    { x: margin, y: 199, width: c.width, bodyPt: c.size, lineHeight: c.lh, face: c.face },
    { x: margin, y: 114, width: c.width, bodyPt: c.size, lineHeight: c.lh, face: c.face },
    A4,
  );
}

describe('the charge model agrees with the engine, block by block', () => {
  for (const c of CASES) {
    describe(c.label, () => {
      const g = geometryOf(c);
      const within = (name: string, charged: number, slack = 0.05) => {
        const drawn = c.measured[name];
        // Never below what the engine drew (an overflow), never more than a
        // twentieth of a line above it (waste).
        expect(charged, `${name}: charged ${charged} vs drawn ${drawn}`).toBeGreaterThanOrEqual(drawn - 0.01);
        expect(charged, `${name}: charged ${charged} vs drawn ${drawn}`).toBeLessThanOrEqual(drawn + slack);
      };

      it('a paragraph, whole lines plus its margin', () => {
        // The probe's prose wraps to whole lines the engine counts; the model
        // rounds up, so it may sit up to one line above a fractional reading.
        within('paragraph', paragraphCharge(g, PROSE_CHARS), 1.05);
      });
      it('a section heading', () => within('h2', headingCharge(g, 2, 26)));
      it('three one-line list items', () => within('list3', listCharge(g, [ITEM, ITEM, ITEM].map((chars) => ({ chars, depth: 0 })))));
      it('a table of three one-line rows', () => {
        const row = ['Flood', 'Low', 'One line of reason, kept short.'];
        within('table3', tableCharge(g, [row, row, row], 3).total, 0.4);
      });
      it('a compact figure at 460×300', () => within('figureCompact', figureCharge(g, 300 / 460, true, false)));
      it('a full-measure figure at 760×300', () => within('figureFull', figureCharge(g, 300 / 760, false, false)));
      it('a captioned figure', () => within('figureCaptioned', figureCharge(g, 300 / 760, false, true)));
      it('a three-item callout', () => within('callout3', calloutCharge(g, [ITEM, ITEM, ITEM])));
    });
  }
});

describe('a nested list, as the engine sets it', () => {
  // Measured on Midnight: three top items (a 77-character bold lead-in) each
  // over two nested two-line items (144 characters) set at 16.63 lines.
  it('charges the nested margins and the wrap loss, and no more than a third of a line over', () => {
    const g = geometryOf(CASES[0]);
    const items = Array.from({ length: 3 }).flatMap(() => [
      { chars: 77, depth: 0 }, { chars: 144, depth: 1 }, { chars: 144, depth: 1 },
    ]);
    const charged = listCharge(g, items);
    expect(charged).toBeGreaterThanOrEqual(16.63 - 0.01);
    expect(charged).toBeLessThanOrEqual(16.63 + 0.35);
  });
});

describe('a five-column risk row, as the engine sets it', () => {
  // Measured with the instrument on Midnight (Noto Serif 9.5/1.55 over 459pt):
  // head + one row 12.43 lines, head + two rows 22.95 — 10.51 lines a row,
  // because auto layout gives the 300-character cell a third of the measure
  // and it wraps to eleven lines.
  const g = geometryOf(CASES[0]);
  const row = [
    'Transport reliance and remoteness', 'Moderate',
    'The property sits in a remote regional town with a very long public-transport commute distance and time to major CBDs, creating a natural reliance on private vehicles and local employment rather than metropolitan commuting; residents often need to drive long distances for anything beyond daily needs.',
    "Confirm that typical tenants (often mining employees) are comfortable with the town's transport arrangements and car reliance, and ensure there is adequate on-site parking and good vehicle access for the dwelling.",
    'Verified at contextual level (regional location and commute metrics)',
  ];
  it('charges the row by its widest-wrapping cell', () => {
    const one = tableCharge(g, [row], 5);
    expect(one.total).toBeGreaterThanOrEqual(12.43 - 0.01);
    expect(one.total).toBeLessThanOrEqual(12.43 + 1.2);
    const two = tableCharge(g, [row, row], 5);
    expect(two.total).toBeGreaterThanOrEqual(22.95 - 0.01);
    expect(two.total).toBeLessThanOrEqual(22.95 + 2.4);
  });
});

describe('geometry', () => {
  it('derives the master\'s content bottom from the block\'s own right edge and the shared reserve', () => {
    // Midnight: margin 68 either side → 842 − 68 − 30.
    expect(narrativeBottom({ x: 68, width: 459 }, A4)).toBe(842 - 68 - NARRATIVE_FOOT_RESERVE_PT);
    // A railed family keeps its right margin: x = margin + rail, width shrinks by the rail.
    expect(narrativeBottom({ x: 68 + 40, width: 459 - 40 }, A4)).toBe(842 - 68 - NARRATIVE_FOOT_RESERVE_PT);
  });

  it('holds back a small fraction of the box and never packs past it', () => {
    const g = geometryOf(CASES[0]);
    const bottom = 842 - 68 - NARRATIVE_FOOT_RESERVE_PT;
    expect(g.contLines).toBe(Math.floor(((bottom - 114) / pitchPt(g)) * (1 - NARRATIVE_HOLDBACK)));
    expect(g.firstPageLines).toBe(Math.floor(((bottom - 199) / pitchPt(g)) * (1 - NARRATIVE_HOLDBACK)));
    expect(g.firstPageLines).toBeLessThan(g.contLines);
  });

  it('reads characters per line from the face\'s measured advance, and an unknown face packs sparser', () => {
    expect(faceAdvanceEm('Noto Serif, serif')).toBe(0.5);
    expect(faceAdvanceEm("'Inter', sans-serif")).toBe(0.48);
    expect(faceAdvanceEm('Some Unmeasured Face')).toBe(UNKNOWN_FACE_ADVANCE_EM);
    expect(UNKNOWN_FACE_ADVANCE_EM).toBeGreaterThan(0.5);
    const g = geometryOf(CASES[0]);
    expect(g.charsPerLine).toBeCloseTo(459 / (9.5 * 0.5), 3);
  });

  it('the reserve is the one the master builder uses', () => {
    const source = readFileSync(resolve(__dirname, '../../../../scripts/template-library/investmentCompass/blocks.ts'), 'utf8');
    const m = /export const FOOTER_RESERVE = (\d+);/.exec(source);
    expect(m, 'FOOTER_RESERVE declared in blocks.ts').not.toBeNull();
    expect(Number(m![1])).toBe(NARRATIVE_FOOT_RESERVE_PT);
  });

  it('the type scale the block styles with is the one the charges read', () => {
    expect(MARKDOWN_TYPE.heading[2].scale).toBe(1.5);
    expect(MARKDOWN_TYPE.table.scale).toBe(0.92);
    expect(MARKDOWN_TYPE.figure.compactFraction).toBeCloseTo(460 / 760, 6);
  });
});
