/**
 * Phase 6D — smart fidelity-mode recommendation.
 *
 * The import mode is chosen before the PDF is parsed, so the user can't know which
 * mode best fits the document. After the parse we DO have the Docling document's
 * quality signals (OCR pages, text confidence), so we compute a recommendation and
 * surface it as a non-blocking "try this mode" nudge in the import result.
 *
 * Recommendation policy (Hybrid stays the safe fallback; Pixel-perfect is never
 * auto-recommended — it's a deliberate "match the source exactly" choice):
 *   - mostly scanned/OCR pages          → `ocr`      (image-based text)
 *   - high confidence + no OCR + few    → `semantic` (fully editable, no raster)
 *     low-confidence blocks
 *   - anything else / unknown signals   → `hybrid`   (editable overlays + raster net)
 */
import type { DoclingDocument } from './docling/doclingTypes';
import type { FidelityMode } from './types';

export interface FidelityModeRecommendation {
  mode: FidelityMode;
  reason: string;
}

/** Below this per-block confidence a text item counts as "low confidence". */
const LOW_CONFIDENCE_BLOCK = 0.6;
/** Above this average text confidence the document is "high confidence". */
const HIGH_CONFIDENCE_AVG = 0.85;
/** Allowed share of low-confidence text blocks for a Semantic recommendation. */
const MAX_LOW_CONFIDENCE_RATIO = 0.1;
/** Share of OCR pages at/above which the doc is treated as scanned. */
const OCR_MAJORITY_RATIO = 0.5;

function pageCountOf(doc: DoclingDocument): number {
  const fromPages = doc.pages ? Object.keys(doc.pages).length : 0;
  if (fromPages > 0) return fromPages;
  return doc.summary?.page_confidence?.length ?? 0;
}

/** Best available average text confidence, or null when no signal exists. */
function averageConfidence(doc: DoclingDocument): number | null {
  const summaryAvg = doc.summary?.avg_text_confidence;
  if (typeof summaryAvg === 'number') return summaryAvg;

  const pageAvgs = (doc.summary?.page_confidence ?? [])
    .map((p) => p.avg_text_confidence)
    .filter((v): v is number => typeof v === 'number');
  if (pageAvgs.length) return pageAvgs.reduce((a, b) => a + b, 0) / pageAvgs.length;

  const textConfs = (doc.texts ?? [])
    .map((t) => t.confidence)
    .filter((v): v is number => typeof v === 'number');
  if (textConfs.length) return textConfs.reduce((a, b) => a + b, 0) / textConfs.length;

  return null;
}

/** Share of text blocks (that report a confidence) below the low-confidence bar. */
function lowConfidenceRatio(doc: DoclingDocument): number {
  const confs = (doc.texts ?? [])
    .map((t) => t.confidence)
    .filter((v): v is number => typeof v === 'number');
  if (!confs.length) return 0;
  return confs.filter((c) => c < LOW_CONFIDENCE_BLOCK).length / confs.length;
}

export function recommendFidelityMode(doc: DoclingDocument): FidelityModeRecommendation {
  const pageCount = pageCountOf(doc);
  const ocrPages = doc.summary?.ocr_pages?.length ?? 0;
  const ocrRatio = pageCount > 0 ? ocrPages / pageCount : 0;

  if (ocrRatio >= OCR_MAJORITY_RATIO) {
    return {
      mode: 'ocr',
      reason: 'Most pages are scanned/OCR — OCR mode reconstructs image-based text most reliably.',
    };
  }

  const avgConf = averageConfidence(doc);
  const lowRatio = lowConfidenceRatio(doc);
  if (ocrPages === 0 && avgConf !== null && avgConf >= HIGH_CONFIDENCE_AVG && lowRatio < MAX_LOW_CONFIDENCE_RATIO) {
    return {
      mode: 'semantic',
      reason: 'High extraction confidence with no OCR — Semantic produces fully editable output with no raster fallback.',
    };
  }

  return {
    mode: 'hybrid',
    reason: 'Mixed or unknown confidence — Hybrid keeps a source-raster safety net behind the editable overlays.',
  };
}
