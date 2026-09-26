/**
 * The older browser-drawn documents: NPC's artwork on the prime, the issuer's
 * own template on every clone.
 *
 * The owner's rule (26 Sep 2026): the artwork is "a legacy, which will be
 * deprecated and hidden on the clone and only available on the prime", with
 * "no changes of the content and how the reports are being pushed, just the
 * template", and "everything from a white labeling component" put through for
 * the clone. So these tests hold three things: the prime reads nothing and
 * changes nothing; a clone's template is its own — name, mark, colours, closing
 * page — or the platform's where it has named nobody; and the cover drawn in
 * jsPDF is the same cover the standard presentation draws in pdf-lib.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jsPDF } from 'jspdf';
import { describe, expect, it, vi } from 'vitest';
import {
  highlightColourFor,
  issuerClosingPage,
  loadCloneIssuerName,
  loadLegacyDocumentBrand,
  rgbObject,
  rgbTriple,
  type IssuerLegacyBrand,
} from '@/lib/reports/legacyDocumentBrand';
import { getBrandPdfPalette } from '@/branding/brandPalette';
import { hexToHsl, parseHsl } from '@/lib/reportDesign/color.pure';
import { drawLegacyIssuerCover } from '@/lib/reports/legacyIssuerCover';
import {
  PLATFORM_COVER_MARK,
  type StandardPresentationBrandDeps,
} from '@/lib/reports/investment/standardPresentationBrand';
import {
  PLATFORM_DISCLAIMER,
  PLATFORM_ISSUER_NAME,
  WORKSPACE_DEFAULT_DISCLAIMER,
} from '@/lib/reports/issuerIdentity.pure';
import { resolveBrandFamily } from '@/lib/reportDesign/brandFamily.pure';

const workspace = (name: string) => ({ name, kind: 'workspace' as const });
const platform = { name: PLATFORM_ISSUER_NAME, kind: 'platform' as const };

const deps = (over: Partial<StandardPresentationBrandDeps> = {}): StandardPresentationBrandDeps => ({
  loadOrganisation: vi.fn(async () => null),
  loadBrandMarks: vi.fn(async () => ({})),
  loadBrandColour: vi.fn(async () => null),
  prime: () => false,
  picture: vi.fn(async () => ({ bytes: new Uint8Array([1]), format: 'png' as const })),
  staticPicture: vi.fn(async () => ({ bytes: new Uint8Array([2]), format: 'png' as const })),
  ...over,
});

describe('which template an older document is printed in', () => {
  it("is NPC's artwork on the prime, and nothing is read to decide it", async () => {
    const prime = deps({ prime: () => true });
    const brand = await loadLegacyDocumentBrand('Naidu Property Consulting Services', prime);
    expect(brand).toEqual({ artwork: 'house', deployment: { prime: true } });
    // Nothing a setting or a failed read could move.
    for (const read of [prime.loadOrganisation, prime.loadBrandMarks, prime.loadBrandColour, prime.picture, prime.staticPicture]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("is the prime's artwork whatever the prime's rows say", async () => {
    for (const name of ['Harbour & Vine', '', 'Aurixa Systems']) {
      expect((await loadLegacyDocumentBrand(name, deps({ prime: () => true }))).artwork).toBe('house');
    }
  });

  it("is the issuer's own on a clone: its name, its knockout mark and its colours", async () => {
    const clone = deps({
      loadBrandMarks: vi.fn(async () => ({ mark: 'data:image/png;base64,AA==', markMono: 'data:image/png;base64,QQ==' })),
      loadBrandColour: vi.fn(async () => '#1E3A8A'),
    });
    const brand = await loadLegacyDocumentBrand('Coastline Realty', clone) as IssuerLegacyBrand;
    expect(brand.artwork).toBe('issuer');
    expect(brand.issuer).toEqual(workspace('Coastline Realty'));
    expect(brand.family).toEqual(resolveBrandFamily('#1E3A8A'));
    expect(clone.picture).toHaveBeenCalledWith('data:image/png;base64,QQ==');
    expect(brand.mark).toEqual({ bytes: new Uint8Array([1]), format: 'png' });
  });

  it("is the platform's where a clone has named nobody — Aurixa's name, emblem and gold", async () => {
    const clone = deps({ loadBrandColour: vi.fn(async () => '#C62828') });
    const brand = await loadLegacyDocumentBrand('', clone) as IssuerLegacyBrand;
    expect(brand.issuer).toEqual(platform);
    expect(brand.family).toEqual(resolveBrandFamily(null));
    expect(clone.staticPicture).toHaveBeenCalledWith(PLATFORM_COVER_MARK);
  });

  it("never issues a clone's document under the house's name, whatever its rows carry", async () => {
    const seeded = deps({ loadOrganisation: async () => ({ company_name: 'NPC Services' }) });
    const brand = await loadLegacyDocumentBrand('Naidu Property Consulting Services', seeded) as IssuerLegacyBrand;
    expect(brand.artwork).toBe('issuer');
    expect(brand.issuer).toEqual(platform);
  });

  it('takes the report contact first, then the Branding page — the order every surface reads them in', async () => {
    const organisation = async () => ({ company_name: 'Coastline Realty' });
    expect(((await loadLegacyDocumentBrand('Harbour & Vine', deps({ loadOrganisation: organisation }))) as IssuerLegacyBrand).issuer)
      .toEqual(workspace('Harbour & Vine'));
    expect(((await loadLegacyDocumentBrand('', deps({ loadOrganisation: organisation }))) as IssuerLegacyBrand).issuer)
      .toEqual(workspace('Coastline Realty'));
  });

  it('never throws: a deployment that cannot be read is a clone, a read that fails is an unset setting', async () => {
    const broken = deps({
      prime: () => { throw new Error('no env'); },
      loadOrganisation: vi.fn(async () => { throw new Error('offline'); }),
      loadBrandMarks: vi.fn(async () => { throw new Error('offline'); }),
      loadBrandColour: vi.fn(async () => { throw new Error('offline'); }),
      staticPicture: vi.fn(async () => { throw new Error('offline'); }),
    });
    const brand = await loadLegacyDocumentBrand('Harbour & Vine', broken) as IssuerLegacyBrand;
    expect(brand.artwork).toBe('issuer');
    expect(brand.issuer).toEqual(workspace('Harbour & Vine'));
    expect(brand.mark).toBeNull();
    expect(brand.family).toEqual(resolveBrandFamily(null));
  });
});

describe("an issuer document's closing page", () => {
  const issuerBrand = (issuer: IssuerLegacyBrand['issuer'], colour: string | null = null): IssuerLegacyBrand => ({
    artwork: 'issuer',
    deployment: { prime: false },
    issuer,
    family: resolveBrandFamily(colour),
    mark: null,
  });
  // The clone's own row, with the house's web address left in it.
  const contactDetails = {
    company_name: 'Coastline Realty',
    website: 'npcservices.com.au',
    email: 'hello@coastline.example',
    phone: '07 5555 0000',
    address: '',
    abn: '',
  };

  it("names the issuer, leaves out the house's web address, and speaks in the issuer's own words", () => {
    const own = 'Coastline Realty provides this report for general information only.';
    const page = issuerClosingPage(issuerBrand(workspace('Coastline Realty'), '#1E3A8A'), {
      contactDetails,
      disclaimer: { text: own, is_enabled: true, font_size: 'medium' as const },
    });
    expect(page.contact).toEqual({ ...contactDetails, company_name: 'Coastline Realty', website: '' });
    expect(page.disclaimer).toEqual({ text: own, is_enabled: true, font_size: 'medium' });
    expect(page.palette).toEqual(resolveBrandFamily('#1E3A8A').palette);
  });

  it("gives a clone none of a row that is the house's own, however much of it was edited", () => {
    // A seeded row whose company is still the house's is the house's row: its
    // line, office and ABN name nobody, so no reading of a value can tell them
    // from the clone's own, and a document that says less is recoverable.
    const seeded = {
      company_name: 'Naidu Property Consulting Services',
      website: 'www.npcservices.com.au',
      email: 'hello@coastline.example',
      phone: '02 8609 3299',
      address: '1 Example Street, Sydney NSW 2000',
      abn: '12 345 678 901',
    };
    const page = issuerClosingPage(issuerBrand(platform), {
      contactDetails: seeded,
      disclaimer: { text: '', is_enabled: true },
    });
    expect(page.contact).toEqual({
      company_name: PLATFORM_ISSUER_NAME, website: '', email: '', phone: '', address: '', abn: '',
    });
  });

  it("replaces wording that names the house with the issuer's default", () => {
    const page = issuerClosingPage(issuerBrand(workspace('Coastline Realty')), {
      contactDetails,
      disclaimer: { text: 'NPC Services accepts no liability for this report.', is_enabled: true },
    });
    expect(page.disclaimer.text).toBe(WORKSPACE_DEFAULT_DISCLAIMER);
    expect(page.disclaimer.is_enabled).toBe(true);
  });

  it("prints the platform's statement for the platform's document, even where a row switched it off", () => {
    const page = issuerClosingPage(issuerBrand(platform), {
      contactDetails: { company_name: '' },
      disclaimer: { text: '', is_enabled: false },
    });
    expect(page.contact.company_name).toBe(PLATFORM_ISSUER_NAME);
    expect(page.disclaimer).toEqual({ text: PLATFORM_DISCLAIMER, is_enabled: true });
  });

  it("honours a named issuer's choice to print no disclaimer", () => {
    const page = issuerClosingPage(issuerBrand(workspace('Coastline Realty')), {
      contactDetails,
      disclaimer: { text: 'anything', is_enabled: false },
    });
    expect(page.disclaimer).toEqual({ text: '', is_enabled: false });
  });
});

/**
 * Portfolio and the Formara form grow their gold ramp from ONE colour. It was
 * the app's accent everywhere — so on a clone the highlights followed the app's
 * accent while the deep shade, the cover and the closing page followed the
 * Branding page, and one document carried two brand colours.
 */
describe("the colour a document's highlight ramp is grown from", () => {
  const hueOf = (hex: string) => parseHsl(hexToHsl(hex)).h;

  it('is the app accent on the prime, exactly as it always was', async () => {
    const brand = await loadLegacyDocumentBrand('Naidu Property Consulting Services', deps({ prime: () => true }));
    expect(highlightColourFor(brand, '43 74% 49%')).toBe('43 74% 49%');
    expect(highlightColourFor(brand, null)).toBeNull();
    expect(highlightColourFor(brand, undefined)).toBeUndefined();
  });

  it("is the Branding page's colour on a clone, whatever the app accent is", async () => {
    const brand = await loadLegacyDocumentBrand('Coastline Realty', deps({ loadBrandColour: vi.fn(async () => '#1E3A8A') }));
    const source = highlightColourFor(brand, '43 74% 49%');
    expect(source).toBe(hexToHsl('#1E3A8A'));
    // The ramp grown from it carries the brand's hue, and not the accent's gold.
    const ramp = getBrandPdfPalette(source);
    expect(Math.abs(hueOf(ramp.gold) - hueOf('#1E3A8A'))).toBeLessThanOrEqual(2);
    expect(Math.abs(hueOf(ramp.gold) - 43)).toBeGreaterThan(90);
  });

  it("is Aurixa's gold on a clone that has named nobody or set no colour", async () => {
    const unbranded = await loadLegacyDocumentBrand('', deps());
    expect(highlightColourFor(unbranded, '200 80% 40%')).toBe(hexToHsl(resolveBrandFamily(null).brand));
  });

  it('is how both documents grow their ramp', () => {
    const read = (path: string) => readFileSync(resolve(__dirname, '../../../..', path), 'utf8');
    expect(read('src/components/clients/PortfolioAnalysisPDFGenerator.tsx'))
      .toMatch(/applyBrandRgb\(highlightColourFor\(legacyBrand, brand\.brandColor\)\);/);
    expect(read('src/components/clients/FormaraPDFGenerator.tsx'))
      .toMatch(/applyBrandGold\(highlightColourFor\(legacyBrand, brand\.brandColor\)\);/);
    for (const path of ['src/components/clients/PortfolioAnalysisPDFGenerator.tsx', 'src/components/clients/FormaraPDFGenerator.tsx']) {
      expect(read(path)).not.toMatch(/apply(BrandRgb|BrandGold)\(brand\.brandColor\)/);
    }
  });
});

describe('colour helpers', () => {
  it('read a hex as the channels jsPDF takes', () => {
    expect(rgbTriple('#1E3A8A')).toEqual([30, 58, 138]);
    expect(rgbObject('#1E3A8A')).toEqual({ r: 30, g: 58, b: 138 });
  });
});

/** The content stream of page one, uncompressed (jsPDF's default). */
function pageOneOperators(doc: jsPDF): string {
  return doc.output();
}

/** The `x y Td` that places a string, in points from the page's foot. */
function placementOf(ops: string, text: string): { x: number; y: number } | null {
  const escaped = text.replace(/[()\\]/g, (c) => `\\${c}`);
  const at = ops.indexOf(`(${escaped}) Tj`);
  if (at < 0) return null;
  const before = ops.slice(0, at);
  const matches = [...before.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) Td/g)];
  const last = matches[matches.length - 1];
  return last ? { x: Number(last[1]), y: Number(last[2]) } : null;
}

describe("the issuer's cover, drawn in jsPDF", () => {
  const PT_PER_MM = 72 / 25.4;
  const emblem = new Uint8Array(readFileSync(resolve(__dirname, '../../../../public/brand/aurixa-emblem-240.png')));

  const draw = (over: Partial<Parameters<typeof drawLegacyIssuerCover>[1]> = {}) => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const result = drawLegacyIssuerCover(doc, {
      issuerName: 'Coastline Realty',
      mark: null,
      documentTitle: 'Borrowing Capacity Snapshot',
      subject: 'Jane Citizen',
      standfirst: 'What this client can borrow, on the assumptions stated.',
      family: resolveBrandFamily('#1E3A8A'),
      ...over,
    });
    return { doc, result, ops: pageOneOperators(doc) };
  };

  it("sets the issuer's name, the document's title and its subject as real text", () => {
    const { ops, result } = draw();
    expect(result.nameLines).toEqual(['COASTLINE REALTY']);
    expect(ops).toContain('(COASTLINE REALTY) Tj');
    expect(ops).toContain('(BORROWING CAPACITY SNAPSHOT) Tj');
    expect(ops).toContain('(JANE CITIZEN) Tj');
    expect(ops).toContain('(What this client can borrow, on the assumptions stated.) Tj');
  });

  it('keeps the typography WinAnsi carries — an em dash, an en dash, a curly quote — and drops only what it cannot draw', async () => {
    const { doc } = draw({
      subject: '12–14 O’Brien Street 🏠',
      standfirst: 'Borrowing Capacity Scenario — Finance Hand-off',
    });
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const read = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: false }).promise;
    const content = await (await read.getPage(1)).getTextContent();
    const text = content.items.map((it: any) => it.str ?? '').join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('Borrowing Capacity Scenario — Finance Hand-off');
    // The subject is set in tracked capitals, which pdf.js reads a letter at a time.
    expect(text.replace(/\s+/g, '')).toContain('12–14O’BRIENSTREET');
    expect(text).not.toMatch(/Scenario - Finance/);
    expect(text).not.toContain('🏠');
  });

  it("paints the issuer's family: the field behind everything, the brand on it", () => {
    const family = resolveBrandFamily('#1E3A8A');
    const { ops } = draw({ family });
    // jsPDF writes a colour to two or three places depending on where it is
    // set, so colours are compared as numbers, never as strings.
    const colours = (operator: 'rg' | 'RG') => [...ops.matchAll(new RegExp(`(\\d*\\.?\\d+) (\\d*\\.?\\d+) (\\d*\\.?\\d+) ${operator}\\n`, 'g'))]
      .map((m) => ({ at: m.index ?? 0, rgb: [Number(m[1]), Number(m[2]), Number(m[3])] }));
    const near = (rgb: number[], hex: string) => rgbTriple(hex).every((c, i) => Math.abs(c / 255 - rgb[i]) <= 0.006);
    const field = colours('rg').find((c) => near(c.rgb, family.field));
    expect(field).toBeDefined();
    expect(colours('RG').some((c) => near(c.rgb, family.accentOnField))).toBe(true);
    // The name is set in the brand's colour for the field.
    const nameAt = ops.indexOf('(COASTLINE REALTY) Tj');
    const nameColour = colours('rg').filter((c) => c.at < nameAt).pop();
    expect(near(nameColour!.rgb, family.accentOnField)).toBe(true);
    // The field is painted before any text is set on it.
    expect(field!.at).toBeLessThan(nameAt);
  });

  it('centres each line on the page, measured as it is drawn', () => {
    const { doc, ops } = draw({ issuerName: 'Harbour & Vine Property Advisory' });
    const pageCentre = (doc.internal.pageSize.getWidth() * PT_PER_MM) / 2;
    for (const [text, size, tracking] of [
      ['BORROWING CAPACITY SNAPSHOT', 9, 2.2],
    ] as const) {
      doc.setFont('helvetica', 'normal');
      const width = doc.getStringUnitWidth(text, { doKerning: false }) * size + tracking * (text.length - 1);
      const placed = placementOf(ops, text);
      expect(placed).not.toBeNull();
      expect(Math.abs(placed!.x + width / 2 - pageCentre)).toBeLessThan(0.6);
    }
  });

  it('breaks a long name over two lines rather than shrinking it past legibility', () => {
    const { result } = draw({ issuerName: 'Harbour & Vine Property Advisory Partners' });
    expect(result.nameLines.length).toBe(2);
  });

  it('draws the mark where one is held, and a cover without one where it cannot be read', () => {
    expect(draw({ mark: { bytes: emblem, format: 'png' } }).result.markDrawn).toBe(true);
    expect(draw({ mark: { bytes: new Uint8Array([1, 2, 3]), format: 'png' } }).result.markDrawn).toBe(false);
    expect(draw({ mark: null }).result.markDrawn).toBe(false);
  });

  it('leaves the document as a caller expects to find it: no letter-spacing carried onto the next page', () => {
    const { doc } = draw();
    expect(doc.getCharSpace()).toBe(0);
    expect(doc.getFont().fontName).toBe('helvetica');
    doc.addPage();
    doc.setFontSize(10);
    doc.text('Body copy', 20, 20);
    const ops = doc.output();
    const body = ops.lastIndexOf('(Body copy) Tj');
    const tc = ops.lastIndexOf(' Tc', body);
    // Whatever the body sets its spacing to, it is none.
    expect(ops.slice(ops.lastIndexOf('\n', tc) + 1, tc)).toBe('0.');
  });

  it("never prints the house's name on a clone's cover, even when asked to", () => {
    // The resolver never hands the house's name to a clone's cover; this is
    // the cover's own guarantee that it draws only what it is given.
    const { ops } = draw({ issuerName: PLATFORM_ISSUER_NAME, family: resolveBrandFamily(null) });
    expect(ops).toContain('(AURIXA SYSTEMS) Tj');
    expect(ops).not.toMatch(/NAIDU|NPC SERVICES/);
  });
});

describe("a clone's business, for a document that carries only its issuer's name", () => {
  // The intake pack (`packPresentation.ts`): its approved files name the house,
  // and a clone's copy names the clone's business there instead — or nobody.
  it('is nothing to decide on the prime, which names itself and reads nothing', async () => {
    const prime = deps({ prime: () => true });
    const read = vi.fn(async () => 'Coastline Realty');
    expect(await loadCloneIssuerName(read, prime)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(prime.loadOrganisation).not.toHaveBeenCalled();
  });

  it('is the business the clone names, in the order every issuer is read', async () => {
    expect(await loadCloneIssuerName('Coastline Realty', deps())).toBe('Coastline Realty');
    const branded = deps({ loadOrganisation: vi.fn(async () => ({ company_name: 'Harbour & Vine' })) });
    expect(await loadCloneIssuerName('', branded)).toBe('Harbour & Vine');
    expect(await loadCloneIssuerName(async () => 'Coastline Realty', branded)).toBe('Coastline Realty');
  });

  it('is nobody — never the house and never the platform — where the clone names nobody', async () => {
    for (const name of ['', 'Naidu Property Consulting Services', 'NPC Services', 'Property Consulting']) {
      expect(await loadCloneIssuerName(name, deps())).toBeNull();
    }
    const failing = deps({ loadOrganisation: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await loadCloneIssuerName(async () => { throw new Error('offline'); }, failing)).toBeNull();
  });
});
