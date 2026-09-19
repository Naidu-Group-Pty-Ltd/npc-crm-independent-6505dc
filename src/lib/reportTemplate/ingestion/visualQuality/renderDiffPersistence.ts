import type { PageContextRenderArtifactManifest } from './pageContextArtifacts';
import type { GeneratedRenderPageRaster } from './generatedRenderCapture';
import type { VisualImportFinalMode, VisualImportQualityReport, VisualWarning } from './schema';
import type { SaveVisualQualityResult, VisualQualityPageRasters } from './persist';
import { saveVisualQuality } from './persist';
import { compareImages, buildDiffImage } from './diff/imageMetrics';
import { aggregateImportQuality, scorePage } from './score';

export const RENDER_DIFF_PERSISTENCE_VERSION = 'render-diff-persistence-v1';

export interface SourceRenderPageRaster {
  pageId: string;
  pageNumber: number;
  imageData: ImageData | null;
  signedUrl?: string | null;
  storagePath?: string | null;
}

export interface PairedRenderPageRaster {
  pageId: string;
  pageNumber: number;
  source: SourceRenderPageRaster | null;
  generated: GeneratedRenderPageRaster | null;
  sourceAvailable: boolean;
  generatedAvailable: boolean;
  sourceSignedUrl?: string | null;
  sourceStoragePath?: string | null;
}

export interface BuildVisualQualityFromRenderPairsOptions {
  importId: string;
  templateId?: string | null;
  finalMode?: VisualImportFinalMode;
  repairPassesApplied?: number;
  comparisonMaxDim?: number;
  generatedAt?: string;
}

export interface VisualQualityFromRenderPairs {
  version: typeof RENDER_DIFF_PERSISTENCE_VERSION;
  report: VisualImportQualityReport;
  rasters: VisualQualityPageRasters[];
  pairs: PairedRenderPageRaster[];
  problems: string[];
}

export interface PersistRenderDiffOptions extends BuildVisualQualityFromRenderPairsOptions {
  sourceManifest: PageContextRenderArtifactManifest;
  generatedRasters: GeneratedRenderPageRaster[];
  sourceRasters?: SourceRenderPageRaster[] | null;
  skipUpload?: boolean;
  skipAutoDiff?: boolean;
  maxRasterDim?: number;
}

export interface PersistRenderDiffResult extends VisualQualityFromRenderPairs {
  persistResult: SaveVisualQualityResult;
}

function pageIdFor(pageNumber: number): string {
  return `docling-page-${pageNumber}`;
}

function sortedUniquePageNumbers(numbers: number[]): number[] {
  return [...new Set(numbers.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n)))]
    .sort((a, b) => a - b);
}

function blankImageData(width = 1, height = 1): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
}

function makeCanvas(width: number, height: number): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
    return { canvas, ctx };
  }
  if (typeof document === 'undefined') {
    throw new Error('Image raster loading requires a browser canvas environment.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2d context unavailable');
  return { canvas, ctx };
}

export async function imageUrlToImageData(url: string, opts: { maxPixelDim?: number } = {}): Promise<ImageData> {
  if (!url) throw new Error('image url is required');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch source raster: HTTP ${res.status}`);

  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > (opts.maxPixelDim ?? 1400) ? (opts.maxPixelDim ?? 1400) / longest : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  try {
    const { ctx } = makeCanvas(width, height);
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close?.();
  }
}

export function sourceRasterRefsFromManifest(
  manifest: PageContextRenderArtifactManifest,
): SourceRenderPageRaster[] {
  return [...(manifest.pages ?? [])]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => ({
      pageId: page.pageId || pageIdFor(page.pageNumber),
      pageNumber: page.pageNumber,
      imageData: null,
      signedUrl: page.sourceRasterSignedUrl ?? null,
      storagePath: page.sourceRasterPath ?? null,
    }));
}

export async function loadSourceRastersFromManifest(
  manifest: PageContextRenderArtifactManifest,
  opts: { maxPixelDim?: number } = {},
): Promise<SourceRenderPageRaster[]> {
  const refs = sourceRasterRefsFromManifest(manifest);
  const out: SourceRenderPageRaster[] = [];

  for (const ref of refs) {
    if (!ref.signedUrl) {
      out.push(ref);
      continue;
    }

    try {
      out.push({
        ...ref,
        imageData: await imageUrlToImageData(ref.signedUrl, opts),
      });
    } catch {
      out.push(ref);
    }
  }

  return out;
}

export function pairSourceAndGeneratedRasters(options: {
  sourceManifest: PageContextRenderArtifactManifest;
  generatedRasters: GeneratedRenderPageRaster[];
  sourceRasters?: SourceRenderPageRaster[] | null;
}): PairedRenderPageRaster[] {
  const sourceRefs = options.sourceRasters?.length
    ? options.sourceRasters
    : sourceRasterRefsFromManifest(options.sourceManifest);

  const sourceByPage = new Map<number, SourceRenderPageRaster>();
  for (const source of sourceRefs) {
    sourceByPage.set(source.pageNumber, source);
  }

  const generatedByPage = new Map<number, GeneratedRenderPageRaster>();
  for (const generated of options.generatedRasters ?? []) {
    generatedByPage.set(generated.pageNumber, generated);
  }

  const pageNumbers = sortedUniquePageNumbers([
    ...sourceRefs.map((source) => source.pageNumber),
    ...(options.generatedRasters ?? []).map((generated) => generated.pageNumber),
  ]);

  return pageNumbers.map((pageNumber) => {
    const source = sourceByPage.get(pageNumber) ?? null;
    const generated = generatedByPage.get(pageNumber) ?? null;
    return {
      pageId: generated?.pageId ?? source?.pageId ?? pageIdFor(pageNumber),
      pageNumber,
      source,
      generated,
      sourceAvailable: Boolean(source?.imageData),
      generatedAvailable: Boolean(generated?.imageData),
      sourceSignedUrl: source?.signedUrl ?? null,
      sourceStoragePath: source?.storagePath ?? null,
    };
  });
}

export function buildVisualQualityFromRenderPairs(
  pairs: PairedRenderPageRaster[],
  options: BuildVisualQualityFromRenderPairsOptions,
): VisualQualityFromRenderPairs {
  const comparisonMaxDim = Math.max(64, options.comparisonMaxDim ?? 384);
  const problems: string[] = [];

  const pageReports = [...pairs].sort((a, b) => a.pageNumber - b.pageNumber).map((pair) => {
    const sourceImage = pair.source?.imageData ?? null;
    const generatedImage = pair.generated?.imageData ?? null;

    const warnings: VisualWarning[] = [];
    if (!sourceImage) {
      warnings.push({
        code: 'source_raster_missing',
        severity: 'warning',
        message: `Source raster unavailable for page ${pair.pageNumber}; pixel/color metrics are degraded.`,
      });
      problems.push(`page_${pair.pageNumber}_source_raster_missing`);
    }
    if (!generatedImage) {
      warnings.push({
        code: 'generated_raster_missing',
        severity: 'warning',
        message: `Generated raster unavailable for page ${pair.pageNumber}; pixel/color metrics are degraded.`,
      });
      problems.push(`page_${pair.pageNumber}_generated_raster_missing`);
    }

    const metrics = sourceImage && generatedImage
      ? compareImages(sourceImage, generatedImage, { maxDim: comparisonMaxDim })
      : compareImages(blankImageData(), blankImageData(), { maxDim: comparisonMaxDim });

    return scorePage({
      pageId: pair.pageId,
      pageNumber: pair.pageNumber,
      sourceRasterAssetId: pair.sourceStoragePath ?? null,
      renderedRasterAssetId: pair.generated ? `generated-raster-page-${pair.pageNumber}` : null,
      diffRasterAssetId: sourceImage && generatedImage ? `diff-raster-page-${pair.pageNumber}` : null,
      pixelDifferenceScore: sourceImage && generatedImage ? metrics.pixelDifferenceScore : 0.5,
      colorSimilarityScore: sourceImage && generatedImage ? metrics.colorSimilarityScore : 0.5,
      // Phase 5D is image-first. Text/layout metrics are filled by later
      // Docling/CDIR expectation passes; keep neutral instead of falsely bad.
      textCoverageScore: 0.5,
      layoutDriftScore: 0.5,
      missingElementScore: 0.5,
      confidenceScore: sourceImage && generatedImage ? 0.75 : 0.35,
      warnings,
    });
  });

  const report = aggregateImportQuality(pageReports, {
    importId: options.importId,
    templateId: options.templateId ?? null,
    finalMode: options.finalMode ?? 'hybrid',
    repairPassesApplied: options.repairPassesApplied ?? 0,
    generatedAt: options.generatedAt,
  });

  const rasters: VisualQualityPageRasters[] = pairs.map((pair) => {
    const source = pair.source?.imageData ?? null;
    const generated = pair.generated?.imageData ?? null;
    const diff = source && generated
      ? buildDiffImage(source, generated, { maxDim: comparisonMaxDim })
      : null;

    return {
      pageNumber: pair.pageNumber,
      source,
      generated,
      diff,
    };
  });

  return {
    version: RENDER_DIFF_PERSISTENCE_VERSION,
    report,
    rasters,
    pairs,
    problems,
  };
}

export async function persistRenderDiffVisualQuality(
  options: PersistRenderDiffOptions,
): Promise<PersistRenderDiffResult> {
  const sourceRasters = options.sourceRasters?.length
    ? options.sourceRasters
    : await loadSourceRastersFromManifest(options.sourceManifest, { maxPixelDim: options.maxRasterDim ?? 1400 });

  const pairs = pairSourceAndGeneratedRasters({
    sourceManifest: options.sourceManifest,
    sourceRasters,
    generatedRasters: options.generatedRasters,
  });

  const built = buildVisualQualityFromRenderPairs(pairs, {
    importId: options.importId,
    templateId: options.templateId,
    finalMode: options.finalMode,
    repairPassesApplied: options.repairPassesApplied,
    comparisonMaxDim: options.maxRasterDim ?? 384,
  });

  const persistResult = options.skipUpload
    ? { kind: 'ok' as const, summaryPath: '', uploadedCount: 0 }
    : await saveVisualQuality(options.importId, built.report, built.rasters, {
        skipAutoDiff: options.skipAutoDiff,
        maxRasterDim: options.maxRasterDim,
      });

  return {
    ...built,
    persistResult,
  };
}
