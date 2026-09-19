/**
 * Phase 4 — Visual diff harness: orchestrator.
 *
 * Combines the pure metric modules into a single per-import call that
 * produces a `VisualImportQualityReport`. Designed to be invoked by the
 * Docling import path right after CDIR is built; no I/O of its own.
 *
 *   1. Iterate every CDIR page.
 *   2. For each page, look up:
 *        - the expected source text (Docling expectations, by pageId)
 *        - the expected source bounds (Docling expectations, by pageId)
 *        - the source raster (from `rasterizePdfPages` or caller supplied)
 *        - the rendered raster (caller supplied — template-builder owns it)
 *   3. Measure pixel/color, text-coverage and layout/missing-element scores.
 *   4. Hand the raw metrics to `scorePage`, which applies the weighted
 *      formula, threshold warnings and recommended action policy.
 *   5. Aggregate via `aggregateImportQuality` for the document-wide report.
 *
 * The CDIR layer-id convention must match `buildDoclingExpectations` so
 * bounds align (`docling-<label>-p<page>-<idx36>-ov` for the overlay layer
 * the plan builder emits). Anything mismatched simply doesn't contribute,
 * keeping the harness safe to run against non-Docling imports too.
 */
import type { CdirDocument, CdirLayer, CdirPage } from '@/lib/reportTemplate/ingestion/cdir/schema';
import type {
  SourceBoundsExpectation,
  SourceTextExpectation,
} from '@/lib/reportTemplate/ingestion/fidelity';

import { aggregateImportQuality, scorePage, type PageMetricInput } from '../score';
import type {
  VisualImportFinalMode,
  VisualImportQualityReport,
  VisualWarning,
} from '../schema';

import { compareImages, emptyImageData } from './imageMetrics';
import { measureTextCoverage } from './textMetrics';
import { flattenCdirLayerBounds, measureLayoutMetrics } from './layoutMetrics';
import { rasterizePdfPages, type RasterisedPage } from './rasterize';

export interface DoclingExpectationsLike {
  expectedText: SourceTextExpectation[];
  expectedBounds: SourceBoundsExpectation[];
}

export interface RenderedPageRaster {
  pageId: string;
  pageNumber?: number;
  imageData: ImageData;
}

export interface VisualDiffInput {
  importId: string;
  templateId?: string | null;
  cdir: CdirDocument;
  expectations: DoclingExpectationsLike;
  /** Caller-rendered pages (template preview). Keyed by `pageId`. */
  renderedRasters: RenderedPageRaster[];
  /** Optional: source PDF for rasterising via pdf.js. */
  sourcePdf?: Blob | ArrayBuffer | null;
  /** Optional: pre-rasterised source pages keyed by `pageNumber`. */
  sourceRasters?: RasterisedPage[] | null;
  finalMode: VisualImportFinalMode;
  /** Number of repair passes the orchestrator has already executed. */
  repairPassesApplied?: number;
  /** Render DPI passed to `rasterizePdfPages`. */
  rasterDpi?: number;
  /** Max comparison surface (pixels per side). */
  comparisonMaxDim?: number;
}

/** Extract a page's plain text content from CDIR text layers (recursive). */
function collectCdirPageText(page: CdirPage): string {
  const parts: string[] = [];
  const walk = (layers: CdirLayer[]) => {
    for (const layer of layers) {
      if (!layer) continue;
      if (layer.kind === 'text') {
        for (const run of layer.runs ?? []) {
          if (run && typeof run.text === 'string') parts.push(run.text);
        }
      } else if (layer.kind === 'table') {
        for (const row of layer.rows ?? []) {
          for (const cell of row) if (cell) parts.push(cell);
        }
      } else if (layer.kind === 'group') {
        walk(layer.children ?? []);
      }
    }
  };
  walk(page.layers ?? []);
  return parts.join(' ');
}

/** Page-number heuristic for `docling-page-<n>` ids; falls back to ordinal. */
function pageNumberForId(pageId: string, ordinal: number): number {
  const m = /docling-page-(\d+)/.exec(pageId);
  if (m) return Number(m[1]);
  return ordinal + 1;
}

/**
 * Run the harness end-to-end. Pure(ish) — only side effect is the lazy
 * pdf.js import inside `rasterizePdfPages` (skipped if `sourceRasters`
 * are supplied). All scoring happens through the public `scorePage` /
 * `aggregateImportQuality` so the policy stays single-sourced.
 */
export async function runVisualDiff(input: VisualDiffInput): Promise<VisualImportQualityReport> {
  const {
    importId,
    templateId,
    cdir,
    expectations,
    renderedRasters,
    sourcePdf,
    sourceRasters,
    finalMode,
    repairPassesApplied = 0,
    rasterDpi = 96,
    comparisonMaxDim = 256,
  } = input;

  // Bucket expectations by pageId
  const expectedTextByPage = new Map<string, string>();
  for (const e of expectations.expectedText) {
    if (e.pageId) expectedTextByPage.set(e.pageId, e.text);
  }
  const expectedBoundsByPage = new Map<string, SourceBoundsExpectation[]>();
  for (const e of expectations.expectedBounds) {
    const bucket = expectedBoundsByPage.get(e.pageId) ?? [];
    bucket.push(e);
    expectedBoundsByPage.set(e.pageId, bucket);
  }

  // Rendered rasters by pageId
  const renderedById = new Map<string, RenderedPageRaster>();
  for (const r of renderedRasters) renderedById.set(r.pageId, r);

  // Source rasters: prefer pre-supplied, otherwise rasterise the PDF
  let sourceByPageNumber = new Map<number, RasterisedPage>();
  if (sourceRasters && sourceRasters.length > 0) {
    for (const r of sourceRasters) sourceByPageNumber.set(r.pageNumber, r);
  } else if (sourcePdf) {
    try {
      const pages = await rasterizePdfPages(sourcePdf, {
        dpi: rasterDpi,
        maxPixelDim: Math.max(512, comparisonMaxDim * 2),
        importId,
      });
      for (const r of pages) sourceByPageNumber.set(r.pageNumber, r);
    } catch {
      // Swallow — pixel metrics will degrade to 0 with a warning per page.
    }
  }

  const pageReports = cdir.pages.map((page, idx) => {
    const pageId = page.id;
    const pageNumber = pageNumberForId(pageId, idx);
    const expectedText = expectedTextByPage.get(pageId) ?? '';
    const expectedBounds = expectedBoundsByPage.get(pageId) ?? [];
    const renderedRaster = renderedById.get(pageId)?.imageData ?? null;
    const sourceRaster = sourceByPageNumber.get(pageNumber)?.imageData ?? null;

    const warnings: VisualWarning[] = [];
    if (!sourceRaster) {
      warnings.push({
        code: 'source_raster_missing',
        severity: 'warning',
        message: `Source raster unavailable for page ${pageNumber}; pixel/color metrics skipped.`,
      });
    }
    if (!renderedRaster) {
      warnings.push({
        code: 'rendered_raster_missing',
        severity: 'warning',
        message: `Rendered raster unavailable for page ${pageNumber}; pixel/color metrics skipped.`,
      });
    }

    // ----- Pixel + color metrics
    const imgResult = (sourceRaster && renderedRaster)
      ? compareImages(sourceRaster, renderedRaster, { maxDim: comparisonMaxDim })
      : compareImages(emptyImageData(1, 1), emptyImageData(1, 1), { maxDim: comparisonMaxDim });
    // When rasters are missing, mark metrics as neutral 0.5 (unknown), not 0.
    const pixelDifferenceScore = sourceRaster && renderedRaster ? imgResult.pixelDifferenceScore : 0.5;
    const colorSimilarityScore = sourceRaster && renderedRaster ? imgResult.colorSimilarityScore : 0.5;

    // ----- Text coverage
    const renderedText = collectCdirPageText(page);
    const textResult = measureTextCoverage(expectedText, renderedText);

    // ----- Layout + missing-element
    const renderedBounds = flattenCdirLayerBounds(
      (page.layers ?? []).map((l) => ({
        id: l.id,
        bounds: {
          x: l.bounds?.x ?? 0,
          y: l.bounds?.y ?? 0,
          width: l.bounds?.width ?? 0,
          height: l.bounds?.height ?? 0,
        },
        children: (l as { children?: unknown }).children,
      })),
    );
    const layoutResult = measureLayoutMetrics(
      expectedBounds,
      renderedBounds,
      page.width,
      page.height,
    );

    if (textResult.missingTokens.length > 0 && expectedText) {
      warnings.push({
        code: 'text_tokens_lost',
        severity: 'info',
        message: `Top missing tokens: ${textResult.missingTokens.slice(0, 5).join(', ')}`,
      });
    }
    if (layoutResult.missingLayerIds.length > 0) {
      warnings.push({
        code: 'layers_missing',
        severity: 'warning',
        message: `${layoutResult.missingLayerIds.length} expected layer(s) absent from CDIR.`,
      });
    }

    const metricInput: PageMetricInput = {
      pageId,
      pageNumber,
      pixelDifferenceScore,
      colorSimilarityScore,
      textCoverageScore: textResult.textCoverageScore,
      layoutDriftScore: layoutResult.layoutDriftScore,
      missingElementScore: layoutResult.missingElementScore,
      // CDIR doesn't yet expose per-layer confidence here; leave neutral.
      confidenceScore: null,
      textAccuracy: expectedText ? textResult.textCoverageScore : null,
      medianPositionDrift: layoutResult.medianPositionDrift,
      p95PositionDrift: layoutResult.p95PositionDrift,
      warnings,
    };

    return scorePage(metricInput);
  });

  return aggregateImportQuality(pageReports, {
    importId,
    templateId: templateId ?? null,
    finalMode,
    repairPassesApplied,
  });
}
