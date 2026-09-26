import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import {
  standardCoverBand,
  containFit,
  coverFit,
  fitCoverAddress,
  fitLine,
  floorPlanSheetLayout,
  winAnsiSafe,
  winAnsiTypographic,
  drawStandardCoverPhotograph,
  type InvestmentPdfPicture,
} from '../investmentPdfPictures';

/**
 * The property's photograph and floor plans in the STANDARD presentation — the
 * document a report comes out in when no template is chosen.
 *
 * Three promises, each of which a client would see broken:
 *   - **Without pictures the document is the one it always was.** Most reports
 *     have none; the cover and every page stay exactly as drawn.
 *   - **The photograph goes on the cover, the plan on a sheet of its own**,
 *     after the contents and before the report's first page — where the
 *     templates put it, so the two presentations read the same way.
 *   - **A picture never costs the document.** One that will not embed is left
 *     out, and a plan that will not embed costs no page.
 */
/**
 * The deployment the document is drawn on. Most of this file draws NPC's own
 * document on NPC's own deployment — the template cover — and the white-label
 * cases below change it.
 */
const deployment = vi.hoisted(() => ({
  prime: true,
  company: 'Naidu Property Consulting Services',
  brandName: null as string | null,
  markMono: null as string | null,
  disclaimer: 'Test disclaimer.',
}));

vi.mock('@/hooks/useGlobalReportSettings', async (orig) => ({
  ...(await orig() as object),
  fetchGlobalReportSettings: async () => ({
    contactDetails: {
      company_name: deployment.company, phone: '', email: '', website: '', address: '', abn: '',
    },
    disclaimer: { text: deployment.disclaimer, font_size: 'medium', is_enabled: true },
  }),
}));
vi.mock('@/lib/reportTemplate/adapters/organisation', async (orig) => ({
  ...(await orig() as object),
  loadOrganisation: async () => (deployment.brandName ? { company_name: deployment.brandName } : null),
  loadBrandMarks: async () => (deployment.markMono ? { markMono: deployment.markMono } : {}),
}));
vi.mock('@/lib/primeDeployment', async (orig) => ({
  ...(await orig() as object),
  isPrimeDeployment: () => deployment.prime,
}));

const ADDRESS = 'Lot 1629 Hornsea Street, Armstrong Creek VIC 3217';

const CONTENT = [
  `# Investment Report: ${ADDRESS}`,
  '',
  '## Alpha Chapter',
  '',
  'Alpha prose that is comfortably longer than the forty-character floor the section filter applies.',
  '',
  '## Beta Chapter',
  '',
  'Beta prose that is comfortably longer than the forty-character floor the section filter applies.',
  '',
].join('\n');

const REPORT = {
  id: 'test-report',
  address: ADDRESS,
  content: CONTENT,
  created_at: '2026-09-25T00:00:00.000Z',
  enhanced_data: { financialData: {}, investmentScore: {} },
};

/** A real PNG, built here so the test needs no image library. */
function png(width: number, height: number, rgbAt: (x: number, y: number) => [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) rows.push(...rgbAt(x, y));
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/** A 3:2 "photograph" and a line-drawn "plan", both unmistakably synthetic. */
const PHOTOGRAPH: InvestmentPdfPicture = { format: 'png', bytes: png(60, 40, (x, y) => [80 + x, 120 + y, 160]) };
const PLAN: InvestmentPdfPicture = {
  format: 'png',
  bytes: png(64, 40, (x, y) => (x % 16 === 0 || y % 10 === 0 ? [20, 20, 20] : [255, 255, 255])),
};
const BROKEN: InvestmentPdfPicture = { format: 'jpeg', bytes: new Uint8Array([1, 2, 3, 4]) };

const NPC_PRIME = Object.freeze({
  prime: true,
  company: 'Naidu Property Consulting Services',
  brandName: null,
  markMono: null,
  disclaimer: 'Test disclaimer.',
});
beforeEach(() => { Object.assign(deployment, NPC_PRIME); });

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input);
    if (url.startsWith('/')) {
      const file = path.resolve(process.cwd(), 'public', url.replace(/^\//, ''));
      if (!fs.existsSync(file)) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(fs.readFileSync(file)), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

interface Drawn { pages: string[]; images: number[]; bytes: Uint8Array }

/** Draw the standard document and read back each page's text and image count. */
async function draw(pictures: {
  photographs?: InvestmentPdfPicture[];
  floorPlans?: InvestmentPdfPicture[];
} = {}, reportTier: 'compass' | 'snapshot' = 'compass'): Promise<Drawn> {
  const { generateInvestmentPdfBlob } = await import('../investmentPdfDocument');
  const { blob } = await generateInvestmentPdfBlob({ report: REPORT as any, reportTier, ...pictures });
  const data = new Uint8Array(await blob.arrayBuffer());
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: false }).promise;
  const pages: string[] = [];
  const images: number[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it: any) => it.str ?? '').join(' ').replace(/\s+/g, ' ').trim());
    const ops = await page.getOperatorList();
    images.push(ops.fnArray.filter((fn: number) => fn === pdfjs.OPS.paintImageXObject).length);
  }
  return { pages, images, bytes: data };
}

/**
 * Every font name and every image size anywhere in the file — reachable from a
 * page or not — so a test can say what the file CONTAINS, not only what it shows.
 */
async function fileContents(bytes: Uint8Array): Promise<{ fonts: string[]; images: string[]; info: Record<string, string> }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fonts = new Set<string>();
  const images = new Set<string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict: any = (object as any).dict ?? object;
    if (!dict || typeof dict.get !== 'function') continue;
    for (const key of ['BaseFont', 'FontName']) {
      const name = dict.get(PDFName.of(key));
      if (name) fonts.add(String(name));
    }
    if (String(dict.get(PDFName.of('Subtype'))) === '/Image') {
      images.add(`${dict.get(PDFName.of('Width'))}x${dict.get(PDFName.of('Height'))}`);
    }
  }
  return {
    fonts: [...fonts],
    images: [...images],
    info: {
      author: doc.getAuthor() ?? '',
      creator: doc.getCreator() ?? '',
      producer: doc.getProducer() ?? '',
    },
  };
}

/** The template cover's own visible box — which does not start at zero. */
async function templateCoverBox() {
  const bytes = fs.readFileSync(path.resolve(process.cwd(), 'public/templates/npc_template.pdf'));
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  return doc.getPage(0).getCropBox();
}

describe('the geometry', () => {
  it('fills the cover band, cropping evenly, and never leaves a bar', async () => {
    const band = standardCoverBand(await templateCoverBox());
    const wide = coverFit({ width: 3000, height: 1000 }, band);
    expect(wide.height).toBeCloseTo(band.height, 6);
    expect(wide.width).toBeGreaterThanOrEqual(band.width);
    expect(wide.x + wide.width / 2).toBeCloseTo(band.x + band.width / 2, 6);
    const tall = coverFit({ width: 1000, height: 3000 }, band);
    expect(tall.width).toBeCloseTo(band.width, 6);
    expect(tall.height).toBeGreaterThanOrEqual(band.height);
  });

  it('draws a plan whole, centred, touching the box on one axis', () => {
    const box = { x: 55, y: 144, width: 485, height: 555 };
    for (const image of [{ width: 1199, height: 751 }, { width: 751, height: 1199 }, { width: 485, height: 555 }]) {
      const placed = containFit(image, box);
      expect(placed.width).toBeLessThanOrEqual(box.width + 1e-9);
      expect(placed.height).toBeLessThanOrEqual(box.height + 1e-9);
      expect(Math.max(placed.width / box.width, placed.height / box.height)).toBeCloseTo(1, 9);
      expect(placed.width / placed.height).toBeCloseTo(image.width / image.height, 9);
      expect(placed.x + placed.width / 2).toBeCloseTo(box.x + box.width / 2, 9);
      expect(placed.y + placed.height / 2).toBeCloseTo(box.y + box.height / 2, 9);
    }
  });

  it('takes the whole field under the cover lockup, inside the gold borders, on the page as it prints', async () => {
    // Measured off npc_template.pdf from the sheet's visible top edge: the
    // borders end at 12.5 and resume at 581.5, the divider's lower edge is
    // 560.5pt down, and the ornament's first grey is 592pt down — so a band
    // from 590pt down hides all of it. The template's box starts at y 7.83,
    // not 0, which is why the band is placed against the box and not 842.
    const box = await templateCoverBox();
    expect(box.y).toBeCloseTo(7.83, 2);
    const band = standardCoverBand(box);
    const topFromTop = box.y + box.height - (band.y + band.height);
    expect(topFromTop).toBeCloseTo(590, 6);
    expect(topFromTop).toBeGreaterThan(560.5);
    expect(topFromTop).toBeLessThan(592);
    expect(band.y).toBe(box.y);
    expect([band.x, band.x + band.width]).toEqual([12.5, 581.5]);
  });

  it('seats the plan between the heading and a title block that clears the footer', () => {
    const layout = floorPlanSheetLayout({ pageWidth: 595, pageHeight: 842, margin: 55, topMargin: 75, footerRuleY: 52 });
    expect(layout.noteBaselines).toHaveLength(3);
    expect(Math.min(...layout.noteRules)).toBeGreaterThan(52);
    expect(layout.drawing.y).toBeGreaterThan(Math.max(...layout.noteRules));
    expect(layout.drawing.y + layout.drawing.height).toBeLessThan(layout.addressY);
    expect(layout.addressY).toBeLessThan(layout.underlineY);
    expect(layout.drawing.width).toBe(485);
    expect(layout.drawing.height).toBeGreaterThan(500);
  });
});

describe('the cover address', () => {
  const measureWith = async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    return (text: string, size: number) => font.widthOfTextAtSize(text, size);
  };

  it('sets an ordinary address in tracked capitals, like the tagline above it', async () => {
    const setting = fitCoverAddress(ADDRESS, await measureWith());
    expect(setting).toMatchObject({ text: ADDRESS.toUpperCase(), size: 9, tracking: 1.2 });
    expect(setting!.width).toBeLessThanOrEqual(495);
  });

  it('fits the longest address the corpus holds without cutting it', async () => {
    const longest = "Apartment 1204A, 'Waterline Residences', 145-149 Marine Parade, Kingscliff, NSW 2487";
    expect(longest).toHaveLength(84);
    const setting = fitCoverAddress(longest, await measureWith());
    expect(setting).not.toBeNull();
    expect(setting!.text.replace(/\.\.\.$/, '')).toHaveLength(longest.length);
    expect(setting!.width).toBeLessThanOrEqual(495);
    expect(setting!.size).toBeGreaterThanOrEqual(8);
  });

  it('cuts only at a word, and says so, past anything the corpus holds', async () => {
    const absurd = Array.from({ length: 30 }, (_, i) => `Word${i}`).join(' ');
    const setting = fitCoverAddress(absurd, await measureWith());
    expect(setting!.text.endsWith('...')).toBe(true);
    expect(absurd.startsWith(setting!.text.replace(/\.\.\.$/, ''))).toBe(true);
  });

  it('answers nothing for no address, and never throws on characters the font cannot encode', async () => {
    const measure = await measureWith();
    expect(fitCoverAddress('', measure)).toBeNull();
    expect(winAnsiSafe('12 O’Brien Street – Unit 3 🏠')).toBe("12 O'Brien Street - Unit 3");
    expect(fitLine('   ', (t) => t.length, 100)).toBeNull();
  });

  it("keeps the typography WinAnsi carries on an issuer's cover, and the prime's address line exactly as it was", async () => {
    // The dashes, curly quotes, bullet, ellipsis and euro are all WinAnsi, and
    // the standard fonts draw them; only what WinAnsi lacks is mapped or dropped.
    expect(winAnsiTypographic('12–14 O’Brien Street — “Lot 3” • … € 🏠')).toBe('12–14 O’Brien Street — “Lot 3” • … €');
    expect(winAnsiTypographic('a\u00A0b\u2011c\u2212d\u2012e\u2015f\u201Bg\u2032h\u201Fi')).toBe("a b-c-d–e—f’g'h”i");
    expect(winAnsiTypographic('   ')).toBe('');
    // The standard fonts encode every character it keeps: nothing it answers can throw.
    const pdf = await PDFDocument.create();
    const kept = winAnsiTypographic('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ ¡¢£¤¥ ÀÉÎÕÜ àéîõü ÿ');
    for (const face of [StandardFonts.Helvetica, StandardFonts.TimesRoman, StandardFonts.TimesRomanItalic]) {
      const font = await pdf.embedFont(face);
      expect(() => font.widthOfTextAtSize(kept, 10)).not.toThrow();
      expect(() => font.encodeText(kept)).not.toThrow();
    }
    // The prime's cover passes nothing, and is drawn through `winAnsiSafe` as it always was.
    const measure = await measureWith();
    expect(fitCoverAddress('12–14 O’Brien Street', measure)!.text).toBe("12-14 O'BRIEN STREET");
    expect(fitCoverAddress('12–14 O’Brien Street', measure, undefined, winAnsiTypographic)!.text).toBe('12–14 O’BRIEN STREET');
  });
});

describe('the cover photograph', () => {
  it('leaves the cover untouched when the photograph will not embed', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    const before = page.node.Contents();
    const drawn = await drawStandardCoverPhotograph(doc, page, BROKEN, ADDRESS, font);
    expect(drawn).toBe(false);
    expect(page.node.Contents()).toBe(before);
  });
});

describe('the standard document', () => {
  it('is the document it always was when the report has no pictures', async () => {
    const none = await draw();
    const empty = await draw({ photographs: [], floorPlans: [] });
    expect(empty.pages).toEqual(none.pages);
    expect(empty.images).toEqual(none.images);
    expect(none.pages.join(' ')).not.toMatch(/Floor plan/);
    expect(none.pages[0]).not.toContain(ADDRESS.toUpperCase());
  }, 120_000);

  it('puts the lead photograph and the address on the cover, and nothing else moves', async () => {
    const none = await draw();
    const pictured = await draw({ photographs: [PHOTOGRAPH] });
    expect(pictured.images[0]).toBe(none.images[0] + 1);
    expect(pictured.pages[0].replace(/\s+/g, '')).toContain(ADDRESS.toUpperCase().replace(/\s+/g, ''));
    expect(pictured.pages.length).toBe(none.pages.length);
    expect(pictured.pages.slice(1)).toEqual(none.pages.slice(1));
  }, 120_000);

  it('gives each plan a sheet after the contents and before the first chapter', async () => {
    const none = await draw();
    const planned = await draw({ floorPlans: [PLAN, PLAN] });
    expect(planned.pages.length).toBe(none.pages.length + 2);

    const contents = planned.pages.findIndex((p) => /TABLE OF CONTENTS/.test(p));
    const first = planned.pages.findIndex((p) => /Floor plan/.test(p));
    const chapter = planned.pages.findIndex((p) => /Alpha Chapter/.test(p) && !/TABLE OF CONTENTS/.test(p));
    expect(contents).toBeGreaterThan(0);
    expect(first).toBe(contents + 1);
    expect(planned.pages[first + 1]).toMatch(/Floor plan \(continued\)/);
    expect(chapter).toBe(first + 2);

    for (const sheet of [first, first + 1]) {
      expect(planned.images[sheet]).toBeGreaterThan(none.images[contents + 1] ?? 0);
      expect(planned.pages[sheet]).toContain('Not to scale. Printed to fit the page.');
      expect(planned.pages[sheet]).toContain('Confirm dimensions and areas against the contract drawings.');
      expect(planned.pages[sheet]).toContain(ADDRESS);
    }
  }, 120_000);

  it('costs no page for a plan that will not embed, and still draws the one that will', async () => {
    const none = await draw();
    const one = await draw({ floorPlans: [BROKEN, PLAN] });
    expect(one.pages.length).toBe(none.pages.length + 1);
    expect(one.pages.filter((p) => /Floor plan/.test(p) && !/continued/.test(p))).toHaveLength(1);
    expect(one.pages.join(' ')).not.toMatch(/Floor plan \(continued\)/);
    const broken = await draw({ photographs: [BROKEN] });
    expect(broken.images).toEqual(none.images);
    expect(broken.pages).toEqual(none.pages);
  }, 120_000);
});

/**
 * The brand is the deployment's own. NPC's artwork opens NPC's document on
 * NPC's deployment and nothing else; every other document opens on a cover
 * drawn for its issuer, from the settings the closing page already reads.
 */
describe('the cover belongs to whoever issues the document', () => {
  const flat = (text: string) => text.replace(/\s+/g, '');
  const ARTWORK_FONTS = /PlayfairDisplay|Kudryashev/;
  /** A knockout mark, as the Branding page stores one for a dark ground. */
  const MARK = `data:image/png;base64,${Buffer.from(png(120, 40, () => [240, 240, 240])).toString('base64')}`;

  it("keeps NPC's artwork, and what the file has always said, on NPC's own document", async () => {
    const npc = await draw();
    expect(flat(npc.pages[0])).toContain('NAIDUPROPERTY');
    const contents = await fileContents(npc.bytes);
    expect(contents.fonts.some((f) => ARTWORK_FONTS.test(f))).toBe(true);
    expect(contents.info).toEqual({ author: 'NPC Services', creator: 'NPC Command Centre', producer: 'NPC Command Centre' });
  }, 120_000);

  it("never carries NPC's artwork into a clone's file, even where its settings still hold NPC's name", async () => {
    deployment.prime = false;
    const clone = await draw({ photographs: [PHOTOGRAPH] });
    expect(clone.pages.join(' ')).not.toMatch(/DEDICATED PROPERTY PARTNER/);
    const contents = await fileContents(clone.bytes);
    // Not merely hidden: the artwork's faces and its 640 x 512 monogram are
    // nowhere in the file, reachable or not.
    expect(contents.fonts.filter((f) => ARTWORK_FONTS.test(f))).toEqual([]);
    expect(contents.images).not.toContain('640x512');
    // Nor its name: a clone whose rows still hold the house's name does not
    // issue under it (the owner's rule, 26 Sep 2026 — NPC's identity is the
    // prime's alone). With no other name the platform issues, on every page.
    expect(flat(clone.pages[0])).toContain('AURIXASYSTEMS');
    expect(flat(clone.pages[0])).toContain(flat(ADDRESS.toUpperCase()));
    expect(flat(clone.pages.join(' '))).not.toMatch(/NAIDUPROPERTY|NPCSERVICES/);
    expect(JSON.stringify(contents.info)).not.toMatch(/NPC|Naidu/);
  }, 120_000);

  it("draws a tenant's cover from its own settings: its name, its mark, its closing page, its metadata", async () => {
    Object.assign(deployment, { prime: false, company: 'Harbour & Vine Property Advisory', markMono: MARK });
    const tenant = await draw({ photographs: [PHOTOGRAPH] });
    const cover = flat(tenant.pages[0]);
    expect(cover).toContain('HARBOUR&VINE');
    expect(cover).toContain('INVESTMENTCOMPASS');
    expect(cover).toContain(flat(ADDRESS.toUpperCase()));
    expect(tenant.images[0]).toBe(2); // the mark and the photograph
    expect(flat(tenant.pages[tenant.pages.length - 1])).toContain('HARBOUR&VINE');
    const contents = await fileContents(tenant.bytes);
    expect(contents.info).toEqual({
      author: 'Harbour & Vine Property Advisory',
      creator: 'Harbour & Vine Property Advisory',
      producer: 'Harbour & Vine Property Advisory',
    });
    expect(JSON.stringify(contents.info)).not.toMatch(/NPC/);
  }, 120_000);

  it("takes the Branding page's name where the report settings name nobody", async () => {
    Object.assign(deployment, { prime: false, company: '', brandName: 'Coastline Realty' });
    const branded = await draw();
    expect(flat(branded.pages[0])).toContain('COASTLINEREALTY');
    expect(flat(branded.pages[branded.pages.length - 1])).toContain('COASTLINEREALTY');
  }, 120_000);

  it("issues an unbranded clone's document under the platform, with the platform's own disclaimer", async () => {
    Object.assign(deployment, {
      prime: false,
      company: '',
      brandName: null,
      // The prime's wording, as a clone seeded from its settings would hold it.
      disclaimer: 'As a Professional Property Consultant & Buyers Agent, we provide information and advice.',
    });
    const platform = await draw();
    expect(flat(platform.pages[0])).toContain('AURIXASYSTEMS');
    expect(platform.images[0]).toBe(1); // the platform emblem
    const closing = flat(platform.pages[platform.pages.length - 1]);
    expect(closing).toContain('AurixaSystemsisatechnologyprovider');
    expect(closing).not.toContain('BuyersAgent,weprovide');
  }, 120_000);

  it('follows the prime when it issues under another name', async () => {
    deployment.company = 'Harbour & Vine Property Advisory';
    const renamed = await draw();
    expect(flat(renamed.pages[0])).toContain('HARBOUR&VINE');
    const contents = await fileContents(renamed.bytes);
    expect(contents.fonts.filter((f) => ARTWORK_FONTS.test(f))).toEqual([]);
  }, 120_000);

  it('says what the document is where a photograph would be, and gives the photograph its place when there is one', async () => {
    deployment.prime = false;
    const plain = await draw();
    const pictured = await draw({ photographs: [PHOTOGRAPH] });
    expect(flat(plain.pages[0])).toContain(flat('What the property is, what it costs to hold'));
    expect(flat(pictured.pages[0])).not.toContain(flat('What the property is'));
    expect(pictured.images[0]).toBe(plain.images[0] + 1);
    expect(pictured.pages.slice(1)).toEqual(plain.pages.slice(1));
  }, 120_000);
});

