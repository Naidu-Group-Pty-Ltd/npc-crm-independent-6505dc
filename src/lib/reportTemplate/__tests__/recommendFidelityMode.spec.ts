import { describe, expect, it } from 'vitest';
import { recommendFidelityMode } from '../pdfImport/recommendFidelityMode';
import type { DoclingDocument } from '../pdfImport/docling/doclingTypes';

const doc = (d: Partial<DoclingDocument>): DoclingDocument => d as DoclingDocument;

describe('Phase 6D — recommendFidelityMode', () => {
  it('recommends semantic for high-confidence, no-OCR documents', () => {
    const rec = recommendFidelityMode(doc({
      pages: { '1': {}, '2': {} } as any,
      summary: { ocr_pages: [], avg_text_confidence: 0.93 },
      texts: [{ text: 'a', confidence: 0.95 }, { text: 'b', confidence: 0.9 }] as any,
    }));
    expect(rec.mode).toBe('semantic');
  });

  it('recommends ocr when most pages are scanned', () => {
    const rec = recommendFidelityMode(doc({
      pages: { '1': {}, '2': {}, '3': {}, '4': {} } as any,
      summary: { ocr_pages: [1, 2, 3] },
    }));
    expect(rec.mode).toBe('ocr');
  });

  it('falls back to hybrid for mixed/low confidence', () => {
    const rec = recommendFidelityMode(doc({
      pages: { '1': {} } as any,
      summary: { ocr_pages: [], avg_text_confidence: 0.7 },
      texts: [{ text: 'a', confidence: 0.5 }, { text: 'b', confidence: 0.55 }] as any,
    }));
    expect(rec.mode).toBe('hybrid');
  });

  it('falls back to hybrid when there are no confidence signals (image-only cover)', () => {
    expect(recommendFidelityMode(doc({})).mode).toBe('hybrid');
    expect(recommendFidelityMode(doc({ pages: { '1': {} } as any, pictures: [{}] as any })).mode).toBe('hybrid');
  });

  it('does not recommend semantic when low-confidence blocks exceed the threshold', () => {
    const rec = recommendFidelityMode(doc({
      pages: { '1': {} } as any,
      summary: { ocr_pages: [], avg_text_confidence: 0.9 },
      // 1 of 4 blocks low-confidence = 25% > 10% threshold
      texts: [
        { text: 'a', confidence: 0.95 }, { text: 'b', confidence: 0.95 },
        { text: 'c', confidence: 0.95 }, { text: 'd', confidence: 0.3 },
      ] as any,
    }));
    expect(rec.mode).toBe('hybrid');
  });
});
