/**
 * The older browser-drawn documents, in a template design somebody chose.
 *
 * `legacyDocumentBrand.spec.ts` holds the two templates a deployment decides —
 * NPC's artwork on the prime, the issuer's own on a clone. This file holds the
 * third, which a PERSON decides: a design chosen for the report type a drawn
 * document is made from (`drawnDocumentDesign.ts`). The claims:
 *
 *  - a design is a choice to leave the house artwork, on every deployment, and
 *    it never changes whose document it is: on the prime the issuer is still
 *    the house;
 *  - the design supplies the colours, so the brand colour is not read;
 *  - the cover takes the design's ground (field, band or paper), its frame and
 *    its faces, with every ink the one its audit holds to the ground under it;
 *  - with no design every one of those is exactly what it was.
 */
import { jsPDF } from 'jspdf';
import { describe, expect, it, vi } from 'vitest';
import {
  headingFaceFor,
  loadLegacyDocumentBrand,
  rgbTriple,
  type IssuerLegacyBrand,
} from '@/lib/reports/legacyDocumentBrand';
import { drawLegacyIssuerCover } from '@/lib/reports/legacyIssuerCover';
import type { StandardPresentationBrandDeps } from '@/lib/reports/investment/standardPresentationBrand';
import { resolveBrandFamily } from '@/lib/reportDesign/brandFamily.pure';
import { drawnDesignOf, type DrawnDocumentDesign } from '@/lib/reportDesign/drawnDesign.pure';
import { resolveCatalogueDesign } from '@/lib/reportDesign/templateDesign.pure';

const deps = (over: Partial<StandardPresentationBrandDeps> = {}): StandardPresentationBrandDeps => ({
  loadOrganisation: vi.fn(async () => null),
  loadBrandMarks: vi.fn(async () => ({ mark: 'data:image/png;base64,Q09MT1VS', markMono: 'data:image/png;base64,S05PQ0s=' })),
  loadBrandColour: vi.fn(async () => '#1E3A8A'),
  prime: () => false,
  picture: vi.fn(async (uri: string) => ({ bytes: new TextEncoder().encode(uri), format: 'png' as const })),
  staticPicture: vi.fn(async () => ({ bytes: new Uint8Array([2]), format: 'png' as const })),
  ...over,
});

/** A catalogue design, drawn. */
function design(code: string, colourway?: string): DrawnDocumentDesign {
  const result = resolveCatalogueDesign({ code, colourway });
  if (result.ok === false) throw new Error(`${code}: ${result.reason}`);
  return drawnDesignOf(result.design);
}

const FIELD = design('pb-01', 'pb-navy-signet');      // Private Banking — a field cover
const BAND = design('ir-01', 'ir-oxford');            // Institutional Research — a band cover
const PAPER = design('ap-01', 'ap-blueprint');        // Architectural — a framed paper cover
const DARK_PAPER = design('sm-01', 'sm-inverse');     // Swiss Minimal inverse — a paper cover on dark stock

describe('a document given a design', () => {
  it("leaves the house artwork on the prime and is still the house's document", async () => {
    const prime = deps({ prime: () => true });
    const brand = await loadLegacyDocumentBrand('Naidu Property Consulting Services', prime, FIELD) as IssuerLegacyBrand;
    expect(brand.artwork).toBe('issuer');
    expect(brand.deployment).toEqual({ prime: true });
    // A design changes how a document looks, never whose it is.
    expect(brand.issuer).toEqual({ name: 'Naidu Property Consulting Services', kind: 'workspace' });
    expect(brand.family).toBe(FIELD.family);
    expect(brand.design).toBe(FIELD);
  });

  it('is in the design on a clone as well, under the clone\'s own name', async () => {
    const clone = deps();
    const brand = await loadLegacyDocumentBrand('Coastline Realty', clone, BAND) as IssuerLegacyBrand;
    expect(brand.artwork).toBe('issuer');
    expect(brand.issuer.name).toBe('Coastline Realty');
    expect(brand.family).toBe(BAND.family);
  });

  it('takes its colours from the design, so the brand colour is never read', async () => {
    const d = deps();
    await loadLegacyDocumentBrand('Coastline Realty', d, FIELD);
    expect(d.loadBrandColour).not.toHaveBeenCalled();
  });

  it('draws the knockout mark on a dark ground and reads the colour mark only where the lockup sits on light paper', async () => {
    const onField = deps();
    const field = await loadLegacyDocumentBrand('Coastline Realty', onField, FIELD) as IssuerLegacyBrand;
    expect(onField.picture).toHaveBeenCalledTimes(1);
    expect(onField.picture).toHaveBeenCalledWith('data:image/png;base64,S05PQ0s=');
    expect(field.paperMark).toBeNull();

    const onPaper = deps();
    const paper = await loadLegacyDocumentBrand('Coastline Realty', onPaper, PAPER) as IssuerLegacyBrand;
    expect(onPaper.picture).toHaveBeenCalledWith('data:image/png;base64,Q09MT1VS');
    expect(paper.paperMark?.bytes).toEqual(new TextEncoder().encode('data:image/png;base64,Q09MT1VS'));

    // A dark paper is a dark ground: the knockout serves, and nothing more is read.
    const onDarkPaper = deps();
    const dark = await loadLegacyDocumentBrand('Coastline Realty', onDarkPaper, DARK_PAPER) as IssuerLegacyBrand;
    expect(onDarkPaper.picture).toHaveBeenCalledTimes(1);
    expect(dark.paperMark).toBeNull();
  });

  it('is exactly what it was without one: the prime reads nothing, a clone takes its brand family', async () => {
    const prime = deps({ prime: () => true });
    expect(await loadLegacyDocumentBrand('Naidu Property Consulting Services', prime, null))
      .toEqual({ artwork: 'house', deployment: { prime: true } });
    expect(prime.loadBrandMarks).not.toHaveBeenCalled();
    const clone = await loadLegacyDocumentBrand('Coastline Realty', deps(), null) as IssuerLegacyBrand;
    expect(clone.family).toEqual(resolveBrandFamily('#1E3A8A'));
    expect(clone.design).toBeUndefined();
  });
});

describe("a document's heading face", () => {
  it('is Helvetica as it always was, on the prime and on a clone', async () => {
    expect(headingFaceFor({ artwork: 'house', deployment: { prime: true } })).toBe('helvetica');
    expect(headingFaceFor(await loadLegacyDocumentBrand('Coastline Realty', deps(), null))).toBe('helvetica');
  });

  it("is Times where the design sets its headings in a serif, and Helvetica where it does not", async () => {
    expect(headingFaceFor(await loadLegacyDocumentBrand('Coastline Realty', deps(), FIELD))).toBe('times');
    expect(headingFaceFor(await loadLegacyDocumentBrand('Coastline Realty', deps(), design('mf-01')))).toBe('helvetica');
    // A monospace design's headings stay in Helvetica: Courier is wider than they were placed for.
    expect(headingFaceFor(await loadLegacyDocumentBrand('Coastline Realty', deps(), design('da-01')))).toBe('helvetica');
  });
});

// ── The cover ────────────────────────────────────────────────────────────────

/** Every fill (`rg`) and stroke (`RG`) colour set on page one, in order. */
/** A number as jsPDF writes one: `0.`, `.5`, `12.340`, `-841.88`. */
const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)`;

function colours(ops: string, operator: 'rg' | 'RG') {
  return [...ops.matchAll(new RegExp(`(${NUM}) (${NUM}) (${NUM}) ${operator}\n`, 'g'))]
    .map((m) => ({ at: m.index ?? 0, rgb: [Number(m[1]), Number(m[2]), Number(m[3])] }));
}
const near = (rgb: number[], hex: string) => rgbTriple(hex).every((c, i) => Math.abs(c / 255 - rgb[i]) <= 0.006);
/** The colour in force for the text drawn at `text`. */
function inkOf(ops: string, text: string): number[] | null {
  const at = ops.indexOf(`(${text}) Tj`);
  return at < 0 ? null : colours(ops, 'rg').filter((c) => c.at < at).pop()?.rgb ?? null;
}
/** Filled rectangles, in points: `x y w h re f`. */
function filledRects(ops: string): Array<{ at: number; w: number; h: number }> {
  return [...ops.matchAll(new RegExp(`(${NUM}) (${NUM}) (${NUM}) (${NUM}) re\nf\n`, 'g'))]
    .map((m) => ({ at: m.index ?? 0, w: Number(m[3]), h: Math.abs(Number(m[4])) }));
}
const strokedRects = (ops: string) => (ops.match(/re\nS\n/g) ?? []).length;

function drawCover(drawn: DrawnDocumentDesign | null, over: Partial<Parameters<typeof drawLegacyIssuerCover>[1]> = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const family = drawn?.family ?? resolveBrandFamily('#1E3A8A');
  const result = drawLegacyIssuerCover(doc, {
    issuerName: 'Coastline Realty',
    mark: null,
    documentTitle: 'Strategy Rationale Brief',
    subject: 'Jane Citizen',
    standfirst: 'Borrowing Capacity Scenario, Finance Hand-off',
    family,
    design: drawn,
    ...over,
  });
  return { doc, result, ops: doc.output() };
}

describe('the cover, in a design', () => {
  it("is the issuer's own cover with no design — the field, one frame, the name in Times", () => {
    const withNull = drawCover(null);
    const withoutKey = (() => {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      drawLegacyIssuerCover(doc, {
        issuerName: 'Coastline Realty', mark: null, documentTitle: 'Strategy Rationale Brief',
        subject: 'Jane Citizen', standfirst: 'Borrowing Capacity Scenario, Finance Hand-off',
        family: resolveBrandFamily('#1E3A8A'),
      });
      return doc.output();
    })();
    const strip = (s: string) => s.replace(/\/CreationDate \(D:[^)]*\)/, '').replace(/\/ID \[[^\]]*\]/, '');
    expect(strip(withNull.ops)).toBe(strip(withoutKey));
    expect(strokedRects(withNull.ops)).toBe(1);
    expect(withNull.ops).toMatch(/\/BaseFont \/Times-Roman/);
  });

  it('fills the whole sheet with the field on a field cover, and draws no frame the design does not have', () => {
    const { ops } = drawCover(FIELD);
    const first = filledRects(ops)[0];
    expect(first.w).toBeCloseTo(595.28, 0);
    expect(near(colours(ops, 'rg')[0].rgb, FIELD.family.field)).toBe(true);
    expect(FIELD.cover.frame).toBe(false);
    expect(strokedRects(ops)).toBe(0);
    // Field inks in the field.
    expect(near(inkOf(ops, 'COASTLINE REALTY')!, FIELD.family.accentOnField)).toBe(true);
    expect(near(inkOf(ops, 'Borrowing Capacity Scenario, Finance Hand-off')!, FIELD.family.onField)).toBe(true);
  });

  it("carries the lockup in a band of the field, with the subject and standfirst on the design's paper", () => {
    const { ops } = drawCover(BAND);
    const [sheet, band] = filledRects(ops);
    expect(near(colours(ops, 'rg')[0].rgb, BAND.family.palette.paper)).toBe(true);
    expect(sheet.h).toBeCloseTo(841.89, 0);
    // The band runs across the head of the sheet, well short of its foot.
    expect(band.w).toBeCloseTo(595.28, 0);
    expect(band.h).toBeGreaterThan(250);
    expect(band.h).toBeLessThan(350);
    expect(near(inkOf(ops, 'COASTLINE REALTY')!, BAND.family.accentOnField)).toBe(true);
    expect(near(inkOf(ops, 'Borrowing Capacity Scenario, Finance Hand-off')!, BAND.family.palette.mutedInk)).toBe(true);
    // Every lockup baseline sits inside the band.
    const nameAt = ops.indexOf('(COASTLINE REALTY) Tj');
    const td = [...ops.slice(0, nameAt).matchAll(new RegExp(`(${NUM}) (${NUM}) Td`, 'g'))].pop()!;
    const fromTop = 841.89 - Number(td[2]);
    expect(fromTop).toBeLessThan(band.h);
  });

  it('sets a paper cover in paper inks, framed where the design is framed, with the colour mark', () => {
    const colourMark = new Uint8Array(require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../../../public/brand/aurixa-emblem-240.png'),
    ));
    const { ops, result } = drawCover(PAPER, { mark: null, paperMark: { bytes: colourMark, format: 'png' } });
    expect(near(colours(ops, 'rg')[0].rgb, PAPER.family.palette.paper)).toBe(true);
    expect(PAPER.cover.frame).toBe(true);
    expect(strokedRects(ops)).toBe(1);
    expect(near(inkOf(ops, 'COASTLINE REALTY')!, PAPER.family.palette.accentOnPaper)).toBe(true);
    expect(near(inkOf(ops, 'STRATEGY RATIONALE BRIEF')!, PAPER.family.palette.bodyInk)).toBe(true);
    expect(result.markDrawn).toBe(true);
  });

  it("draws the knockout mark on a dark paper, never the colour mark drawn for a light one", () => {
    const emblem = new Uint8Array(require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../../../public/brand/aurixa-emblem-240.png'),
    ));
    const onDark = drawCover(DARK_PAPER, { mark: { bytes: emblem, format: 'png' }, paperMark: null });
    expect(onDark.result.markDrawn).toBe(true);
    const onLight = drawCover(PAPER, { mark: { bytes: emblem, format: 'png' }, paperMark: null });
    expect(onLight.result.markDrawn).toBe(false);
  });

  it("sets the issuer's name in the design's face — Times for a serif, Helvetica for a sans, Courier for a monospace", () => {
    expect(drawCover(FIELD).ops).toMatch(/\/BaseFont \/Times-Roman/);
    const sans = drawCover(design('mf-01'));
    expect(sans.ops).not.toMatch(/\/BaseFont \/Times-Roman\n[\s\S]*?\(COASTLINE REALTY\) Tj/);
    const mono = drawCover(design('da-01'));
    expect(mono.ops).toMatch(/\/BaseFont \/Courier/);
    expect(mono.result.nameLines).toEqual(['COASTLINE REALTY']);
  });

  it('keeps every word of the cover whatever the design', () => {
    for (const drawn of [null, FIELD, BAND, PAPER, DARK_PAPER]) {
      const { ops } = drawCover(drawn);
      for (const text of ['COASTLINE REALTY', 'STRATEGY RATIONALE BRIEF', 'JANE CITIZEN']) {
        expect(ops.replace(/\\\(|\\\)/g, '')).toContain(`(${text}) Tj`);
      }
    }
  });
});
