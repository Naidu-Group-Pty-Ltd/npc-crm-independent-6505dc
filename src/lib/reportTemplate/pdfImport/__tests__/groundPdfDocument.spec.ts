/**
 * The grounding pass, run against a real PDF.
 *
 * The pure modules are covered elsewhere; what this proves is the wiring — that
 * PDF.js is driven correctly, that the viewport transform reaches the geometry,
 * and that the numbers coming out the far end are the numbers an independent
 * parser reads from the same file.
 *
 * `reports/golden/borrowing-capacity-snapshot.pdf` is checked in and is a real
 * generated report, not a synthetic fixture. Its page 2 header was measured with
 * PyMuPDF (origin 56.69, 85.04; advance 125.05) and those are the numbers
 * asserted below.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The app's loader resolves the worker through Vite's `?url`, which yields a
// browser path Node cannot import. Same PDF.js, same version — only how the
// worker is located differs, and that is the one thing this file is not testing.
vi.mock('@/lib/pdf/pdfjs', async () => {
  const pdfjs: typeof import('pdfjs-dist') = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href;
  return { loadPdfjs: async () => pdfjs };
});

const { groundPdfDocument, probeTextLayer, DEFAULT_MAX_GROUNDED_PAGES } = await import('../groundPdfDocument');

const GOLDEN = resolve(__dirname, '../../../../../reports/golden/borrowing-capacity-snapshot.pdf');
const present = existsSync(GOLDEN);
const bytes = () => new Uint8Array(readFileSync(GOLDEN));

describe.runIf(present)('groundPdfDocument — against the golden report', () => {
  it('measures the document and agrees with PyMuPDF on the header', async () => {
    const result = await groundPdfDocument(bytes());
    expect(result.totalPages).toBe(8);
    expect(result.pages.length).toBeGreaterThan(1);

    const page2 = result.pages.find((p) => p.pageNumber === 2)!;
    expect(page2.reference.pageWidth).toBeCloseTo(595.28, 1);
    expect(page2.reference.pageHeight).toBeCloseTo(841.89, 1);

    const header = page2.reference.elements.find((e) => e.text.startsWith('A. & J. Sample'))!;
    expect(header).toBeDefined();
    // PyMuPDF: origin=(56.69, 85.04), advance 125.05, size 18.
    expect(header.x).toBeCloseTo(56.69, 1);
    expect(header.fontSize).toBeCloseTo(18, 1);
    // y is the ink top: baseline 85.04 − 0.718×18.
    expect(header.y).toBeCloseTo(72.12, 1);
  });

  it('reads the document\'s actual copy, not a summary of it', async () => {
    const result = await groundPdfDocument(bytes());
    const text = result.pages.flatMap((p) => p.reference.elements.map((e) => e.text)).join('\n');
    expect(text).toContain('Executive Summary');
    expect(text).toContain('Income Analysis');
    // A body line that arrives as one fragment must not be chopped up.
    expect(text).toMatch(/Based on the financial information provided, A\. & J\. Sample has an estimated/);
  });

  it('keeps table cells apart instead of merging a row into a sentence', async () => {
    const result = await groundPdfDocument(bytes());
    const texts = result.pages.flatMap((p) => p.reference.elements.map((e) => e.text));
    expect(texts).toContain('Source');
    expect(texts).toContain('Gross Amount');
    expect(texts.some((t) => t.includes('Source') && t.includes('Gross Amount'))).toBe(false);
  });

  it('every element sits on the page it was measured from', async () => {
    const result = await groundPdfDocument(bytes());
    for (const page of result.pages) {
      for (const element of page.reference.elements) {
        expect(element.x).toBeGreaterThanOrEqual(-1);
        expect(element.y).toBeGreaterThanOrEqual(-1);
        expect(element.x + element.width).toBeLessThanOrEqual(page.reference.pageWidth + 1);
        expect(element.y + element.height).toBeLessThanOrEqual(page.reference.pageHeight + 1);
        expect(element.text.trim()).toBe(element.text);
      }
    }
  });

  it('reports what a cap excluded rather than truncating in silence', async () => {
    const capped = await groundPdfDocument(bytes(), { maxPages: 2, maxElementsPerPage: 3 });
    expect(capped.totalPages).toBe(8);
    expect(capped.pagesOmitted).toBe(6);
    expect(capped.pages.every((p) => p.reference.elements.length <= 3)).toBe(true);
    expect(capped.elementsDropped).toBeGreaterThan(0);
  });

  it('skips a page with no text layer instead of asserting it is blank', async () => {
    // The cover is vector and image only. A grounding entry for it would tell
    // the model the page has no text; no entry means "read it yourself".
    const result = await groundPdfDocument(bytes());
    expect(result.pages.some((p) => p.pageNumber === 1)).toBe(false);
  });

  it('accepts base64 as well as bytes', async () => {
    const b64 = Buffer.from(readFileSync(GOLDEN)).toString('base64');
    const fromBase64 = await groundPdfDocument(b64, { maxPages: 2 });
    const fromBytes = await groundPdfDocument(bytes(), { maxPages: 2 });
    expect(fromBase64.pages).toEqual(fromBytes.pages);
  });

  it('leaves the caller\'s bytes intact for the model', async () => {
    // PDF.js transfers the buffer it is given. If that were the caller's copy,
    // grounding would empty the array we then send to Claude.
    const source = bytes();
    const before = source.byteLength;
    await groundPdfDocument(source, { maxPages: 1 });
    expect(source.byteLength).toBe(before);
    expect(source[0]).toBe(0x25); // '%' of %PDF
  });
});

describe('groundPdfDocument — degrading to no measurements', () => {
  it('returns nothing measurable rather than throwing', async () => {
    // Every failure here must restore the behaviour that shipped before
    // grounding existed: the model reads the document itself.
    for (const bad of [new Uint8Array(0), new Uint8Array([1, 2, 3, 4]), 'not-base64-@@@']) {
      const result = await groundPdfDocument(bad as never);
      expect(result.pages).toEqual([]);
      expect(result.totalPages).toBe(0);
    }
  });

  it('bounds pages by default', () => {
    expect(DEFAULT_MAX_GROUNDED_PAGES).toBeGreaterThan(0);
  });
});

describe('probeTextLayer — telling a scan from a native document', () => {
  /**
   * A real image-only PDF, built here rather than checked in: one page whose
   * entire content is an embedded PNG and which carries no text operator at all.
   * That is what a scan is, and it is the case the deterministic importer cannot
   * read a word from.
   */
  async function scannedPdf(): Promise<Uint8Array> {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    // 1×1 PNG, scaled to fill the page — pixels, no glyphs.
    // `Buffer` is jsdom's shim here and does not satisfy pdf-lib's Uint8Array
    // check, so hand it a plain typed array.
    const png = await doc.embedPng(Uint8Array.from(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )));
    page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
    return await doc.save();
  }

  it('reports no characters for a page that is only pixels', async () => {
    const probe = await probeTextLayer(await scannedPdf());
    expect(probe.totalPages).toBe(1);
    expect(probe.pages).toEqual([{ pageNumber: 1, characters: 0 }]);

    const { assessTextLayer, describeScannedRouting } = await import('../scannedDocumentPolicy.pure');
    const routing = describeScannedRouting(assessTextLayer(probe.pages, probe.totalPages));
    expect(routing.preferClaude).toBe(true);
    expect(routing.message).toContain('no text layer');
  });

  it.runIf(present)('reports real characters for a native document', async () => {
    const probe = await probeTextLayer(bytes());
    expect(probe.totalPages).toBe(8);
    // Measured: the cover is vector-only (0 characters) and the body pages
    // carry 275–1,148 — all far above the threshold, which is the point.
    expect(probe.pages.find((p) => p.pageNumber === 1)!.characters).toBe(0);
    const body = probe.pages.filter((p) => p.pageNumber > 1);
    expect(body).toHaveLength(7);
    expect(Math.min(...body.map((p) => p.characters))).toBeGreaterThan(200);

    const { assessTextLayer, describeScannedRouting } = await import('../scannedDocumentPolicy.pure');
    const assessment = assessTextLayer(probe.pages, probe.totalPages);
    // One text-less cover out of eight is not a scanned document.
    expect(assessment.verdict).toBe('native');
    expect(describeScannedRouting(assessment).notify).toBe(false);
  });

  it('degrades to nothing measurable rather than throwing', async () => {
    for (const bad of [new Uint8Array(0), new Uint8Array([1, 2, 3, 4]), 'not-base64-@@@']) {
      const probe = await probeTextLayer(bad as never);
      expect(probe.pages).toEqual([]);
      expect(probe.totalPages).toBe(0);
    }
  });

  it('leaves the caller\'s bytes intact', async () => {
    const source = await scannedPdf();
    const before = source.byteLength;
    await probeTextLayer(source);
    expect(source.byteLength).toBe(before);
  });
});

