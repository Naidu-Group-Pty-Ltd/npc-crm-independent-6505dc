import { describe, expect, it } from 'vitest';
import {
  assertPdfChunkPlanLimits,
  PDF_CHUNK_MAX_COUNT,
  PDF_CHUNK_MAX_PAGES,
} from './pdfChunkLimits.pure';

describe('PDF chunk fan-out limits', () => {
  it('accepts plans at both hard limits', () => {
    expect(() => assertPdfChunkPlanLimits(PDF_CHUNK_MAX_PAGES, PDF_CHUNK_MAX_COUNT)).not.toThrow();
  });

  it('rejects an oversized page count before ranges are generated', () => {
    expect(() => assertPdfChunkPlanLimits(PDF_CHUNK_MAX_PAGES + 1)).toThrow(/page count/i);
  });

  it('rejects excessive chunk fan-out before rows are inserted', () => {
    expect(() => assertPdfChunkPlanLimits(100, PDF_CHUNK_MAX_COUNT + 1)).toThrow(/chunk count/i);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid page count %s',
    (pageCount) => {
      expect(() => assertPdfChunkPlanLimits(pageCount)).toThrow(/page count/i);
    },
  );
});
