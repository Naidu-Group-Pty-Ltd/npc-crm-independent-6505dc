/**
 * The brochure walk, run against a real PDF through the real pdf.js.
 *
 * `brochurePhotographs.spec.ts` pins the rules against operator lists written
 * by hand. What this proves is the wiring: that pdf.js is driven the way the
 * rules assume, that the operator codes are pdf.js's own, and that every place
 * a brochure can put a picture reaches the walk — drawn on the page, drawn
 * inside a form (which is how a Canva or InDesign export arrives), and carried
 * in a form field's appearance (which is how a filled-in template carries its
 * facade render). The pictures are synthetic, drawn by this file; nothing here
 * is anybody's photograph.
 *
 * The canvas half — encoding and the 64-pixel judgement — needs a browser and
 * is exercised in Chromium, not here.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { encode } from 'fast-png';

// The app's loader resolves the worker through Vite's `?url`, which yields a
// browser path Node cannot import. Same pdf.js, same version — only how the
// worker is found differs, and that is not what this file tests.
vi.mock('@/lib/pdf/pdfjs', async () => {
  const pdfjs: typeof import('pdfjs-dist') = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href;
  return { loadPdfjs: async () => pdfjs };
});

const { loadPdfjs } = await import('@/lib/pdf/pdfjs');
const {
  operatorCodes,
  rgbaFromPdfImage,
  reductionFactor,
  scanBrochure,
  MAX_CANVAS_PIXELS,
} = await import('../brochurePhotographs');
const { pageShare, passesBrochureFloors, isPictureOfPage, pixelKey } = await import('../brochurePhotographs.pure');

/** A synthetic picture: smooth bands with a seeded texture, so two seeds never share pixels. */
function picture(width: number, height: number, seed: number): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3;
      data[at] = (x * 3 + seed * 41 + ((x * y) % 7)) & 255;
      data[at + 1] = (y * 2 + seed * 17) & 255;
      data[at + 2] = ((x + y) * 5 + seed * 29) & 255;
    }
  }
  return encode({ width, height, data, channels: 3, depth: 8 });
}

/** A 64-pixel square sampled from the decoded samples, the size the judgement reads. */
function square(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const from = (Math.floor((y * height) / 64) * width + Math.floor((x * width) / 64)) * 4;
      out.set(rgba.subarray(from, from + 4), (y * 64 + x) * 4);
    }
  }
  return out;
}

async function brochure(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const facade = await doc.embedPng(picture(1600, 1000, 1));
  const logo = await doc.embedPng(picture(300, 120, 2));
  const render = await doc.embedPng(picture(1500, 1000, 3));
  const scan = await doc.embedPng(picture(1240, 1754, 4));

  // Page 1: the facade, large, beside the property's own address; a small logo.
  const cover = doc.addPage([595, 842]);
  cover.drawImage(facade, { x: 40, y: 400, width: 515, height: 322 });
  cover.drawImage(logo, { x: 40, y: 780, width: 100, height: 40 });
  cover.drawText('Lot 12 Smith Street, Box Hill NSW 2765', { x: 40, y: 360, size: 14, font });

  // Page 2: the same facade again, smaller, and a picture drawn from inside a
  // form — another document's page, embedded, so the render inside it is a
  // different object with the same pixels as the one on page 3.
  const other = await PDFDocument.create();
  const inner = other.addPage([595, 842]);
  inner.drawImage(await other.embedPng(picture(1500, 1000, 3)), { x: 0, y: 0, width: 595, height: 397 });
  const [embedded] = await doc.embedPdf(await other.save());
  const second = doc.addPage([595, 842]);
  second.drawImage(facade, { x: 300, y: 600, width: 250, height: 156 });
  second.drawPage(embedded, { x: 50, y: 50, xScale: 0.5, yScale: 0.5 });
  second.drawText('Inclusions', { x: 40, y: 780, size: 14, font });

  // Page 3: a form field carrying a render in its appearance, as a filled template does.
  const third = doc.addPage([595, 842]);
  const field = doc.getForm().createButton('facade.image');
  field.addToPage('', third, { x: 60, y: 300, width: 480, height: 320 });
  field.setImage(render);
  third.drawText('Lot 12 — The Aspen 25', { x: 40, y: 780, size: 14, font });

  // Page 4: a page that is one picture and no text — a scan.
  const fourth = doc.addPage([595, 842]);
  fourth.drawImage(scan, { x: 0, y: 0, width: 595, height: 842 });

  return doc.save();
}

describe('the brochure walk, through the real pdf.js', () => {
  it('reads pdf.js\'s own operator codes', async () => {
    const pdfjs = await loadPdfjs();
    const ops = operatorCodes(pdfjs.OPS as unknown as Record<string, number>);
    expect(Object.values(ops).every((code) => Number.isInteger(code) && code > 0)).toBe(true);
    expect(ops.paintImageXObject).toBe(pdfjs.OPS.paintImageXObject);
    expect(ops.beginAnnotation).toBe(pdfjs.OPS.beginAnnotation);
  });

  it('finds every picture wherever the brochure put it, drawn where the page draws it', async () => {
    const pdfjs = await loadPdfjs();
    const kinds = pdfjs.ImageKind as unknown as { RGB_24BPP: number; RGBA_32BPP: number };
    const pages: Array<{ page: number; text: string; drawn: Array<{ width: number; height: number; share: number; key: string | null }> }> = [];

    const { pageCount, pagesRead } = await scanBrochure(await brochure(), async (scan, image) => {
      const drawn = [];
      for (const placement of scan.placements) {
        const decoded = await image(placement.objId);
        const rgba = decoded ? rgbaFromPdfImage(decoded, kinds) : null;
        drawn.push({
          width: placement.width,
          height: placement.height,
          share: pageShare(placement.drawn, scan.view),
          key: rgba ? pixelKey(square(rgba.rgba, rgba.width, rgba.height), placement.width, placement.height) : null,
        });
      }
      pages.push({ page: scan.page, text: scan.text, drawn });
    }, { pdfjs });

    expect(pageCount).toBe(4);
    expect(pagesRead).toBe(4);
    expect(pages[0].text).toContain('Lot 12 Smith Street, Box Hill NSW 2765');

    // Page 1: the facade at its drawn size, and the logo far below any floor.
    const [facade, logo] = pages[0].drawn;
    expect(facade).toMatchObject({ width: 1600, height: 1000 });
    expect(facade.share).toBeCloseTo((515 * 322) / (595 * 842), 3);
    expect(logo.share).toBeLessThan(0.01);
    expect(passesBrochureFloors({ ...facade, pageShare: facade.share })).toBe(true);
    expect(passesBrochureFloors({ ...logo, pageShare: logo.share })).toBe(false);

    // Page 2: the same facade under another pdf.js id, known by its pixels;
    // and the render drawn from inside a form, at half the form's size.
    const again = pages[1].drawn.find((d) => d.width === 1600);
    const fromForm = pages[1].drawn.find((d) => d.width === 1500);
    expect(again?.key).toBe(facade.key);
    expect(again?.share).toBeCloseTo((250 * 156) / (595 * 842), 3);
    expect(fromForm?.share).toBeCloseTo((297.5 * 198.5) / (595 * 842), 2);
    expect(fromForm?.key).not.toBe(facade.key);

    // Page 3: the render carried in a form field's appearance, placed on the field's rectangle.
    const inField = pages[2].drawn.find((d) => d.width === 1500);
    expect(inField).toBeDefined();
    expect(inField!.share).toBeGreaterThan(0.2);
    expect(inField!.share).toBeLessThanOrEqual((480 * 320) / (595 * 842) + 1e-6);
    expect(inField!.key).toBe(fromForm?.key);

    // Page 4: one picture over the whole page and no text of its own.
    const [scanned] = pages[3].drawn;
    expect(scanned.share).toBeCloseTo(1, 6);
    expect(isPictureOfPage({ pageShare: scanned.share, pageTextLength: pages[3].text.replace(/\s+/g, '').length })).toBe(true);
  }, 30_000);

  it('averages a very large picture down before it meets a canvas, and refuses a layout that is not a photograph\'s', () => {
    expect(reductionFactor(4000, 4000)).toBe(1);
    expect(reductionFactor(8000, 6000)).toBe(2);
    expect(reductionFactor(1, MAX_CANVAS_PIXELS + 1)).toBe(2);
    const kinds = { RGB_24BPP: 2, RGBA_32BPP: 3 };
    const rgb = new Uint8Array([10, 20, 30, 50, 60, 70, 90, 100, 110, 130, 140, 150]);
    const halved = rgbaFromPdfImage({ width: 2, height: 2, data: rgb, kind: 2 }, kinds, 2);
    expect(halved).toEqual({ rgba: new Uint8ClampedArray([70, 80, 90, 255]), width: 1, height: 1 });
    expect(rgbaFromPdfImage({ width: 2, height: 2, data: rgb, kind: 1 }, kinds)).toBeNull();
    expect(rgbaFromPdfImage({ width: 4, height: 4, data: rgb, kind: 2 }, kinds)).toBeNull();
  });
});
