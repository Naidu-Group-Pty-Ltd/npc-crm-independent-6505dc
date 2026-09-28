/**
 * A chosen template, as the design of a document drawn in the browser
 * (`drawnDesign.pure.ts`, `familyFromDesignPalette`).
 *
 * The claims these tests have to earn, over every design the catalogue offers
 * in every colourway its family has (50 designs, 100 colourways):
 *
 *  - **Legible on the sheet it prints on.** A drawn document prints on white,
 *    and the catalogue composes a third of its colourways on a dark paper. Every
 *    role a drawn document paints clears the floor the brand family already
 *    clears for a tenant's colour, on white and on the washes behind it.
 *  - **The design's own, never another's.** The field is the design's field,
 *    the accent is the design's accent wherever a rule can be seen, and an ink
 *    that had to be darkened for white keeps the design's hue.
 *  - **The cover and the faces the design declares.** Its ground and frame are
 *    the catalogue's, and a face stands in for the design's by its generic
 *    family: a serif sets Times, a monospace sets Courier only where the line
 *    is fitted to its measure.
 */
import { describe, expect, it } from 'vitest';
import { ACCENT_FLOOR, DEEP_FLOOR, familyFromDesignPalette, resolveBrandFamily } from '@/lib/reportDesign/brandFamily.pure';
import { contrastRatio, hexToHsl, parseHsl } from '@/lib/reportDesign/color.pure';
import {
  drawnDesignOf,
  drawnFaceFor,
  genericOfStack,
  isLightGround,
  lockupGround,
} from '@/lib/reportDesign/drawnDesign.pure';
import {
  catalogueDesigns,
  catalogueColourways,
  designFromTemplateRow,
  resolveCatalogueDesign,
  type ReportTemplateDesign,
} from '@/lib/reportDesign/templateDesign.pure';
import { PRINT_SURFACE } from '@/lib/reportDesign/tokens.pure';

const SHEET = PRINT_SURFACE.paperBright;
const WHITE = '#FFFFFF';

const hueOf = (hex: string) => parseHsl(hexToHsl(hex)).h;
const satOf = (hex: string) => parseHsl(hexToHsl(hex)).s;
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Every catalogue design in every colourway of its family. */
function everyDesign(): Array<{ id: string; design: ReportTemplateDesign }> {
  const out: Array<{ id: string; design: ReportTemplateDesign }> = [];
  for (const variant of catalogueDesigns()) {
    for (const colourway of catalogueColourways(variant.familyKey)) {
      const result = resolveCatalogueDesign({ code: variant.code, colourway: colourway.id });
      if (result.ok === false) throw new Error(`${variant.code} × ${colourway.id} did not resolve: ${result.reason}`);
      out.push({ id: `${variant.code} × ${colourway.id}`, design: result.design });
    }
  }
  return out;
}

const DESIGNS = everyDesign();

describe('the catalogue it is measured over', () => {
  it('is every design in every colourway', () => {
    expect(DESIGNS.length).toBe(catalogueDesigns().reduce((n, v) => n + catalogueColourways(v.familyKey).length, 0));
    expect(DESIGNS.length).toBeGreaterThanOrEqual(500);
  });

  it('includes the colourways composed on a dark paper — the case white cannot carry as drawn', () => {
    const dark = DESIGNS.filter(({ design }) => !isLightGround(design.palette.paper));
    expect(dark.length).toBeGreaterThan(100);
  });
});

describe('every colour a drawn document paints is legible where it is painted', () => {
  it.each(DESIGNS.map((d) => [d.id, d.design] as const))('%s', (_id, design) => {
    const f = drawnDesignOf(design).family;
    expect(f.source).toBe('design');
    // Rules and bars: seen on the sheet.
    expect(contrastRatio(f.accent, SHEET)).toBeGreaterThanOrEqual(ACCENT_FLOOR - 0.01);
    // Brand type on paper and on the field: 7:1, the small-type floor.
    expect(contrastRatio(f.accentInk, SHEET)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(f.accentInk, WHITE)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(f.accentOnField, f.field)).toBeGreaterThanOrEqual(7);
    // Headings and table heads.
    expect(contrastRatio(f.deep, SHEET)).toBeGreaterThanOrEqual(DEEP_FLOOR);
    expect(contrastRatio(f.onDeep, f.deep)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(f.onField, f.field)).toBeGreaterThanOrEqual(7);
    // Body ink and captions on the washes the family paints behind them.
    for (const ground of [f.wash, f.stripe]) {
      expect(contrastRatio(f.bodyInk, ground)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(f.accentInk, ground)).toBeGreaterThanOrEqual(4.5);
      // Quiet lines are set on the washes too: 225 of the 500 designs put the
      // muted ink there at 6.33–6.99:1 while it was held to the sheet alone.
      expect(contrastRatio(f.mutedInk, ground)).toBeGreaterThanOrEqual(7 - 0.01);
    }
    // Captions: measured on the sheet the family is derived against, which
    // holds on white with room to spare.
    expect(contrastRatio(f.mutedInk, SHEET)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(f.mutedInk, WHITE)).toBeGreaterThanOrEqual(7);
  });
});

describe("the family is the design's own", () => {
  it('prints the cover and the headings on the design\'s own field', () => {
    for (const { id, design } of DESIGNS) {
      const f = drawnDesignOf(design).family;
      expect(f.field, id).toBe(design.palette.field.toUpperCase());
      // Every catalogue field is dark enough to be the deep shade itself.
      expect(f.deep, id).toBe(f.field);
    }
  });

  it("keeps the design's accent wherever a rule drawn in it can be seen on white", () => {
    for (const { id, design } of DESIGNS) {
      const f = drawnDesignOf(design).family;
      if (contrastRatio(design.palette.accentFill, SHEET) >= ACCENT_FLOOR) {
        expect(f.accent, id).toBe(design.palette.accentFill.toUpperCase());
      }
    }
  });

  it('keeps every ink a light-paper design already prints legibly on white', () => {
    for (const { id, design } of DESIGNS.filter((d) => isLightGround(d.design.palette.paper))) {
      const f = drawnDesignOf(design).family;
      expect(f.bodyInk, id).toBe(design.palette.bodyInk.toUpperCase());
      expect(f.onField, id).toBe(design.palette.onFieldInk.toUpperCase());
      expect(f.accentOnField, id).toBe(design.palette.accentOnField.toUpperCase());
    }
  });

  it("takes a dark-paper design's light inks down their own hue rather than swapping in another colour", () => {
    for (const { id, design } of DESIGNS.filter((d) => !isLightGround(d.design.palette.paper))) {
      const f = drawnDesignOf(design).family;
      for (const [role, drawn, declared] of [
        ['body ink', f.bodyInk, design.palette.bodyInk],
        ['accent ink', f.accentInk, design.palette.accentOnPaper],
      ] as const) {
        // A grey has no hue to keep; a colour keeps its own.
        if (satOf(declared) < 12) continue;
        expect(hueDistance(hueOf(drawn), hueOf(declared)), `${id} ${role}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it("is never the tenant's or the platform's family in disguise", () => {
    const platform = resolveBrandFamily(null);
    const differs = DESIGNS.filter(({ design }) => drawnDesignOf(design).family.field !== platform.field);
    expect(differs.length).toBeGreaterThan(DESIGNS.length * 0.9);
  });

  it("falls back to a deep shade of the design's accent where a hand-edited field is too light to be one", () => {
    const base = DESIGNS[0].design.palette;
    const f = familyFromDesignPalette({ ...base, field: '#9FB8D8', accentFill: '#1E3A8A' });
    expect(contrastRatio(f.deep, SHEET)).toBeGreaterThanOrEqual(DEEP_FLOOR);
    expect(hueDistance(hueOf(f.deep), hueOf('#1E3A8A'))).toBeLessThanOrEqual(3);
  });
});

describe('the cover the design declares', () => {
  it('takes the catalogue ground and frame of every design', () => {
    for (const variant of catalogueDesigns()) {
      const result = resolveCatalogueDesign({ code: variant.code });
      if (result.ok === false) throw new Error(variant.code);
      const drawn = drawnDesignOf(result.design);
      expect(drawn.cover, variant.code).toEqual({ ground: variant.cover.ground, frame: variant.cover.frame });
    }
  });

  it('covers all three grounds the catalogue draws — field, band and paper', () => {
    const grounds = new Set(catalogueDesigns().map((v) => {
      const r = resolveCatalogueDesign({ code: v.code });
      return r.ok ? drawnDesignOf(r.design).cover.ground : null;
    }));
    expect([...grounds].sort()).toEqual(['band', 'field', 'paper']);
  });

  it('sets the lockup on paper only on a paper cover, and knows a dark paper from a light one', () => {
    for (const { id, design } of DESIGNS) {
      const drawn = drawnDesignOf(design);
      const ground = lockupGround(drawn);
      expect(ground, id).toBe(drawn.cover.ground === 'paper' ? design.palette.paper : drawn.family.field);
    }
    expect(isLightGround('#FAF7EF')).toBe(true);
    expect(isLightGround('#121212')).toBe(false);
  });

  it("is a field cover, unframed, for a template with no catalogue lineage", () => {
    const base = DESIGNS[0].design.palette;
    const result = designFromTemplateRow({
      id: '00000000-0000-4000-8000-000000000000',
      name: 'Hand-built',
      tokens: {
        colors: {
          surface: base.paper, bg: base.field, ink: base.bodyInk, primary: base.accentFill, line: base.rule,
        },
      },
      lineage: null,
    });
    if (result.ok === false) throw new Error(result.reason);
    expect(drawnDesignOf(result.design).cover).toEqual({ ground: 'field', frame: false });
  });
});

describe('the faces that stand in for the design\'s', () => {
  it('reads the generic family a stack ends in', () => {
    expect(genericOfStack("'Playfair Display', Georgia, serif")).toBe('serif');
    expect(genericOfStack("'Inter', 'Helvetica Neue', Arial, sans-serif")).toBe('sans-serif');
    expect(genericOfStack("'IBM Plex Mono', monospace")).toBe('monospace');
    expect(genericOfStack("'Something'")).toBeNull();
    expect(genericOfStack('')).toBeNull();
    expect(genericOfStack(null)).toBeNull();
  });

  it('sets a serif in Times, a sans in Helvetica, and Courier only on the fitted cover line', () => {
    expect(drawnFaceFor("'Noto Serif', serif", 'heading')).toBe('times');
    expect(drawnFaceFor("'Noto Serif', serif", 'cover')).toBe('times');
    expect(drawnFaceFor("'Inter', sans-serif", 'heading')).toBe('helvetica');
    expect(drawnFaceFor("'IBM Plex Mono', monospace", 'cover')).toBe('courier');
    // A heading is placed for Helvetica's widths, and Courier is wider.
    expect(drawnFaceFor("'IBM Plex Mono', monospace", 'heading')).toBe('helvetica');
    // A stack naming no generic is what the document always set.
    expect(drawnFaceFor("'Unknown Face'", 'heading')).toBe('helvetica');
  });

  it('never sets a heading in Courier, in any design', () => {
    for (const { id, design } of DESIGNS) {
      expect(drawnDesignOf(design).faces.heading, id).not.toBe('courier');
    }
  });

  it("follows each family's own faces: its serif families set Times headings, its sans families Helvetica", () => {
    for (const variant of catalogueDesigns()) {
      const r = resolveCatalogueDesign({ code: variant.code });
      if (r.ok === false) throw new Error(variant.code);
      const drawn = drawnDesignOf(r.design);
      const expected = variant.fonts.headingGeneric === 'serif' ? 'times' : 'helvetica';
      expect(drawn.faces.heading, variant.code).toBe(expected);
    }
  });
});

describe('what a drawn design carries', () => {
  it('is named as the chooser names it', () => {
    for (const { design } of DESIGNS.slice(0, 20)) {
      expect(drawnDesignOf(design).label).toBe(design.label);
    }
  });
});
