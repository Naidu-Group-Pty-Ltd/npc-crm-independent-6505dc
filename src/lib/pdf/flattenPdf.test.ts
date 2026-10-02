import { describe, expect, it } from 'vitest';
import {
  PDF_FLATTEN_LIMITS,
  flattenPdfBlob,
  validateFlattenOptions,
  validateFlattenPage,
  withFlattenedSuffix,
} from './flattenPdf';

describe('PDF flattening resource limits', () => {
  it('stops before loading an already-cancelled document', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(flattenPdfBlob(new Blob(), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('accepts the default rendering options', () => {
    expect(validateFlattenOptions({})).toEqual({ dpi: 150, quality: 0.85 });
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY, PDF_FLATTEN_LIMITS.maxDpi + 1])(
    'rejects unsafe DPI %s',
    (dpi) => expect(() => validateFlattenOptions({ dpi })).toThrow(/DPI must be between/),
  );

  it.each([-0.1, 1.1, Number.NaN])('rejects invalid JPEG quality %s', (jpegQuality) => {
    expect(() => validateFlattenOptions({ jpegQuality })).toThrow(/quality must be between/);
  });

  it('accepts ordinary rendered page dimensions', () => {
    expect(validateFlattenPage(1275, 1650, 0)).toBe(2_103_750);
  });

  it('rejects an excessive canvas dimension', () => {
    expect(() => validateFlattenPage(PDF_FLATTEN_LIMITS.maxCanvasDimension + 1, 100, 0))
      .toThrow(/page dimensions exceed/);
  });

  it('rejects excessive per-page pixel area', () => {
    expect(() => validateFlattenPage(10_000, 10_000, 0))
      .toThrow(/page pixel area/);
  });

  it('rejects excessive cumulative rendered pixels', () => {
    expect(() => validateFlattenPage(1_000, 1_000, PDF_FLATTEN_LIMITS.maxTotalPixels))
      .toThrow(/total rendered pixel area/);
  });

  it('rejects non-finite page dimensions', () => {
    expect(() => validateFlattenPage(Number.POSITIVE_INFINITY, 100, 0))
      .toThrow(/invalid page dimensions/);
  });
});

describe('the flattened copy\'s name', () => {
  it('adds the word before the extension, or adds both', () => {
    expect(withFlattenedSuffix('Property Comparison - A and B - 1 Oct 2026.pdf'))
      .toBe('Property Comparison - A and B - 1 Oct 2026-flattened.pdf');
    expect(withFlattenedSuffix('Report')).toBe('Report-flattened.pdf');
  });

  /** Audit 8: a caller that already named the copy flattened got the word twice. */
  it('never says it twice', () => {
    expect(withFlattenedSuffix('10 Year Cash Flow - flattened - 1 Test St - 1 Oct 2026.pdf'))
      .toBe('10 Year Cash Flow - flattened - 1 Test St - 1 Oct 2026.pdf');
    expect(withFlattenedSuffix('report-flattened.pdf')).toBe('report-flattened.pdf');
    expect(withFlattenedSuffix('report-flattened')).toBe('report-flattened.pdf');
  });
});
