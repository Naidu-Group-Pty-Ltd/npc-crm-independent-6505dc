/**
 * E7 — export output evidence + browser/export parity (pure).
 *
 * The exported PDF is re-rasterized and compared against the source and the
 * browser final composition. PDF text extraction is a COMPANION signal only —
 * it never proves visible output. Parity requires the SAME policy (strategy,
 * visible regions/crops, suppressed overlays, plan hash, page count, geometry)
 * plus bounded visual agreement — never subpixel-identical anti-aliasing.
 */
import type {
  ExportOutputEvidenceV1, ExportedPageEvidenceV1, RenderedOutputEvidenceV1, RenderedPageEvidenceV1,
} from './contracts';
import { makeDefect, type CriticalQualityDefectV1 } from './criticalDefects';

export interface ParityPageInput {
  browser: RenderedPageEvidenceV1;
  exported: ExportedPageEvidenceV1;
  /** Optional measured visual similarity (browser final vs exported raster). */
  visualSimilarity?: number | null;
  visualSimilarityFloor?: number;
}

export interface ParityResult {
  parityScore: number | null;
  defects: CriticalQualityDefectV1[];
}

/** Compare browser final output to exported PDF output for one page. */
export function validatePageParity(input: ParityPageInput): ParityResult {
  const b = input.browser; const e = input.exported;
  const defects: CriticalQualityDefectV1[] = [];
  const base = { pageId: b.pageId, pageNumber: b.pageNumber, scope: 'page' as const };

  if (b.renderPlanHash != null && e.renderPlanHash != null && b.renderPlanHash !== e.renderPlanHash) {
    defects.push(makeDefect({ code: 'renderer_parity_failed', ...base, observed: e.renderPlanHash, threshold: b.renderPlanHash, reason: 'export plan hash differs from browser' }));
  }
  // dimension parity (allow a small relative tolerance).
  const wRatio = Math.abs(b.widthPt - e.widthPt) / Math.max(1, b.widthPt);
  const hRatio = Math.abs(b.heightPt - e.heightPt) / Math.max(1, b.heightPt);
  if (wRatio > 0.02 || hRatio > 0.02) defects.push(makeDefect({ code: 'export_dimension_mismatch', ...base, reason: 'export page dimensions differ' }));

  // a critical region present in browser must be present in export.
  const exportCrops = new Set(e.finalCropAssetIds);
  for (const rid of b.visibleCropRegionIds) {
    if (!exportCrops.has(rid) && !e.finalCropShas.length) {
      defects.push(makeDefect({ code: 'export_critical_region_missing', ...base, regionId: rid, scope: 'region', reason: 'crop region missing from export' }));
    }
  }
  // an editor-reference crop must never enter export.
  for (const rid of b.editorReferenceRegionIds) if (exportCrops.has(rid)) {
    defects.push(makeDefect({ code: 'editor_reference_visible_in_final', ...base, regionId: rid, scope: 'region', reason: 'editor-reference crop present in export' }));
  }
  // clipped text detected in export.
  for (const p of e.problems) if (p.includes('text_clipped')) defects.push(makeDefect({ code: 'export_text_clipped', ...base, reason: 'text clipped in export' }));

  const floor = input.visualSimilarityFloor ?? 0.75;
  const parityScore = typeof input.visualSimilarity === 'number' ? input.visualSimilarity : null;
  if (parityScore != null && parityScore < floor) {
    defects.push(makeDefect({ code: 'renderer_parity_failed', ...base, metric: 'visualSimilarity', observed: parityScore, threshold: floor, reason: 'export visual output diverges from browser' }));
  }
  return { parityScore, defects };
}

export interface ExportEvidenceValidationInput {
  browser: RenderedOutputEvidenceV1;
  exported: ExportOutputEvidenceV1;
  /** page-number → measured browser/export visual similarity. */
  visualSimilarityByPage?: Record<number, number>;
}

export interface ExportEvidenceValidationResult {
  parity: number | null;
  defects: CriticalQualityDefectV1[];
  perPage: Array<{ pageNumber: number; parityScore: number | null }>;
}

/** Validate the whole export evidence bundle against the browser evidence. */
export function validateExportEvidence(input: ExportEvidenceValidationInput): ExportEvidenceValidationResult {
  const defects: CriticalQualityDefectV1[] = [];
  const perPage: Array<{ pageNumber: number; parityScore: number | null }> = [];

  if (!input.exported.exportPreflightPassed) {
    defects.push(makeDefect({ code: 'export_preflight_failed', scope: 'document', reason: 'export preflight did not pass' }));
  }
  if (input.browser.pages.length !== input.exported.pageCount) {
    defects.push(makeDefect({ code: 'export_page_count_mismatch', scope: 'document', observed: input.exported.pageCount, threshold: input.browser.pages.length, reason: 'export page count differs from browser' }));
  }
  const exportedByNumber = new Map(input.exported.pages.map((p) => [p.pageNumber, p]));
  const scores: number[] = [];
  for (const bp of input.browser.pages) {
    const ep = exportedByNumber.get(bp.pageNumber);
    if (!ep) { defects.push(makeDefect({ code: 'export_page_missing', pageId: bp.pageId, pageNumber: bp.pageNumber, reason: 'browser page missing from export' })); perPage.push({ pageNumber: bp.pageNumber, parityScore: null }); continue; }
    const r = validatePageParity({ browser: bp, exported: ep, visualSimilarity: input.visualSimilarityByPage?.[bp.pageNumber] ?? null });
    defects.push(...r.defects);
    perPage.push({ pageNumber: bp.pageNumber, parityScore: r.parityScore });
    if (typeof r.parityScore === 'number') scores.push(r.parityScore);
  }
  const parity = scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10000) / 10000 : null;
  return { parity, defects, perPage };
}
