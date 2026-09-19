/**
 * Phase 2 ingestion fidelity model.
 *
 * This is intentionally pure: it scores CDIR/editability/text/geometry coverage
 * before any browser raster diff is available. The existing SSIM module still
 * owns pixel-level comparison; these metrics give every importer a shared,
 * source-neutral quality contract immediately after extraction.
 */
import type { CdirDocument, CdirLayer, CdirPage } from './cdir/schema';
import { parseCdirDocument } from './cdir/validate';

export type FidelitySeverity = 'info' | 'warning' | 'error';

export interface FidelityWarning {
  code: string;
  message: string;
  severity: FidelitySeverity;
  pageId?: string;
  layerId?: string;
}

export interface SourceTextExpectation {
  /** Page id in CDIR space. Omit to compare against the whole document. */
  pageId?: string;
  text: string;
}

export interface SourceBoundsExpectation {
  pageId: string;
  layerId: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface CdirFidelityOptions {
  /** Optional source text from PDF text extraction / OCR / DOM textContent. */
  expectedText?: SourceTextExpectation[];
  /** Optional measured source boxes keyed to CDIR layer ids. */
  expectedBounds?: SourceBoundsExpectation[];
  /** Minimum native area target before warning. Defaults to 0.9. */
  nativeCoverageTarget?: number;
  /** Maximum fallback raster target before warning. Defaults to 0.1. */
  rasterFallbackLimit?: number;
  /** Minimum text accuracy target before warning. Defaults to 0.99. */
  textAccuracyTarget?: number;
  /** Maximum median box drift target before warning. Defaults to 2pt. */
  medianDriftLimit?: number;
}

export interface PageFidelityReport {
  pageId: string;
  pageLabel: string;
  nativeCoverage: number;
  rasterFallbackCoverage: number;
  editableTextLayers: number;
  editableShapeLayers: number;
  editableImageLayers: number;
  editableTableLayers: number;
  editableVectorLayers: number;
  fallbackRasterLayers: number;
  textAccuracy: number | null;
  medianPositionDrift: number | null;
  p95PositionDrift: number | null;
  warnings: FidelityWarning[];
}

export interface CdirFidelityReport {
  overallScore: number;
  nativeCoverage: number;
  rasterFallbackCoverage: number;
  textAccuracy: number | null;
  medianPositionDrift: number | null;
  p95PositionDrift: number | null;
  editableLayerCount: number;
  fallbackRasterLayerCount: number;
  pages: PageFidelityReport[];
  warnings: FidelityWarning[];
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function flattenLayers(layers: CdirLayer[]): CdirLayer[] {
  const out: CdirLayer[] = [];
  for (const layer of layers) {
    if (layer.kind === 'group') out.push(...flattenLayers(layer.children));
    else out.push(layer);
  }
  return out;
}

function rectArea(rect: { width: number; height: number }): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function isNativeEditable(layer: CdirLayer): boolean {
  if (layer.kind === 'group') return layer.children.some(isNativeEditable);
  if (layer.kind === 'image') return !layer.fallbackRaster;
  return true;
}

function isFallbackRaster(layer: CdirLayer): boolean {
  return layer.kind === 'image' && layer.fallbackRaster === true;
}

/**
 * Approximate union area for axis-aligned layer bounds. This avoids inflated
 * coverage when many editable boxes overlap. Rotation is ignored for the Phase 2
 * contract because every current ingestion source stores axis-aligned bounds.
 */
export function unionArea(rects: Array<{ x: number; y: number; width: number; height: number }>): number {
  const valid = rects.filter((r) => r.width > 0 && r.height > 0);
  if (!valid.length) return 0;
  const xs = Array.from(new Set(valid.flatMap((r) => [r.x, r.x + r.width]))).sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const width = x1 - x0;
    if (width <= 0) continue;
    const spans = valid
      .filter((r) => r.x < x1 && r.x + r.width > x0)
      .map((r) => [r.y, r.y + r.height] as const)
      .sort((a, b) => a[0] - b[0]);
    let coveredY = 0;
    let currentStart: number | null = null;
    let currentEnd: number | null = null;
    for (const [start, end] of spans) {
      if (currentStart === null || currentEnd === null) {
        currentStart = start; currentEnd = end;
      } else if (start <= currentEnd) {
        currentEnd = Math.max(currentEnd, end);
      } else {
        coveredY += Math.max(0, currentEnd - currentStart);
        currentStart = start; currentEnd = end;
      }
    }
    if (currentStart !== null && currentEnd !== null) coveredY += Math.max(0, currentEnd - currentStart);
    area += width * coveredY;
  }
  return area;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Levenshtein is quadratic, so never admit unbounded PDF/OCR-derived strings.
// Sampling both ends retains useful detection of headers and trailing content
// while imposing a fixed upper bound on the scorer's CPU and memory usage.
const MAX_EDIT_DISTANCE_TEXT_LENGTH = 2_048;

function sampleForEditDistance(text: string): string {
  if (text.length <= MAX_EDIT_DISTANCE_TEXT_LENGTH) return text;
  const half = MAX_EDIT_DISTANCE_TEXT_LENGTH / 2;
  return `${text.slice(0, half)}${text.slice(-half)}`;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function textAccuracy(actual: string, expected: string): number {
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);
  if (!normalizedActual && !normalizedExpected) return 1;
  if (normalizedActual === normalizedExpected) return 1;
  const a = sampleForEditDistance(normalizedActual);
  const e = sampleForEditDistance(normalizedExpected);
  const maxLen = Math.max(a.length, e.length, 1);
  return round3(clamp01(1 - levenshtein(a, e) / maxLen));
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round3(sorted[idx]);
}

function boundsDrift(actual: { x: number; y: number; width: number; height: number }, expected: { x: number; y: number; width: number; height: number }): number {
  const centerActual = { x: actual.x + actual.width / 2, y: actual.y + actual.height / 2 };
  const centerExpected = { x: expected.x + expected.width / 2, y: expected.y + expected.height / 2 };
  return Math.hypot(centerActual.x - centerExpected.x, centerActual.y - centerExpected.y);
}

function pageText(page: CdirPage): string {
  return flattenLayers(page.layers).filter((layer) => layer.kind === 'text').map((layer) => layer.text).join(' ');
}

function pageExpectation(page: CdirPage, expectedText: SourceTextExpectation[]): string | null {
  const exact = expectedText.find((item) => item.pageId === page.id)?.text;
  if (exact !== undefined) return exact;
  const documentLevel = expectedText.filter((item) => !item.pageId).map((item) => item.text).join(' ');
  return documentLevel || null;
}

function scorePage(page: CdirPage, opts: Required<Pick<CdirFidelityOptions, 'nativeCoverageTarget' | 'rasterFallbackLimit' | 'textAccuracyTarget' | 'medianDriftLimit'>> & CdirFidelityOptions): PageFidelityReport {
  const flat = flattenLayers(page.layers);
  const pageArea = Math.max(1, page.width * page.height);
  const editableLayers = flat.filter(isNativeEditable);
  const fallbackLayers = flat.filter(isFallbackRaster);
  const editableRects = editableLayers.map((layer) => layer.bounds as any);
  const fallbackRects = fallbackLayers.map((layer) => layer.bounds as any);
  const nativeArea = unionArea(editableRects);
  // Fallback raster coverage = the page area that genuinely *relies* on the raster,
  // i.e. the raster region NOT already reconstructed by native editable layers.
  // A full-page raster trace is intentionally kept (visual-QA reference / underlay),
  // but counting its whole area here pinned rasterFallbackCoverage at 1.0 even for
  // excellent reconstructions — masking real fidelity gains. Compute the set
  // difference instead: area(fallback \ editable) = area(fallback ∪ editable) − area(editable).
  const fallbackOnlyArea = Math.max(0, unionArea([...fallbackRects, ...editableRects]) - nativeArea);
  const nativeCoverage = round3(clamp01(nativeArea / pageArea));
  const rasterFallbackCoverage = round3(clamp01(fallbackOnlyArea / pageArea));
  const expected = pageExpectation(page, opts.expectedText ?? []);
  const accuracy = expected === null ? null : textAccuracy(pageText(page), expected);
  const boundsById = new Map(flat.map((layer) => [layer.id, layer.bounds]));
  const drifts = (opts.expectedBounds ?? [])
    .filter((item) => item.pageId === page.id && boundsById.has(item.layerId))
    .map((item) => boundsDrift(boundsById.get(item.layerId)! as any, item.bounds));
  const medianPositionDrift = percentile(drifts, 50);
  const p95PositionDrift = percentile(drifts, 95);
  const warnings: FidelityWarning[] = [];

  if (nativeCoverage < opts.nativeCoverageTarget) warnings.push({
    code: 'native_coverage_low',
    severity: 'warning',
    pageId: page.id,
    message: `Native editable coverage ${Math.round(nativeCoverage * 100)}% is below target ${Math.round(opts.nativeCoverageTarget * 100)}%.`,
  });
  if (rasterFallbackCoverage > opts.rasterFallbackLimit) warnings.push({
    code: 'raster_fallback_high',
    severity: 'warning',
    pageId: page.id,
    message: `Fallback raster coverage ${Math.round(rasterFallbackCoverage * 100)}% exceeds limit ${Math.round(opts.rasterFallbackLimit * 100)}%.`,
  });
  if (accuracy !== null && accuracy < opts.textAccuracyTarget) warnings.push({
    code: 'text_accuracy_low',
    severity: 'warning',
    pageId: page.id,
    message: `Text accuracy ${Math.round(accuracy * 100)}% is below target ${Math.round(opts.textAccuracyTarget * 100)}%.`,
  });
  if (medianPositionDrift !== null && medianPositionDrift > opts.medianDriftLimit) warnings.push({
    code: 'position_drift_high',
    severity: 'warning',
    pageId: page.id,
    message: `Median position drift ${medianPositionDrift}pt exceeds ${opts.medianDriftLimit}pt.`,
  });

  return {
    pageId: page.id,
    pageLabel: page.label,
    nativeCoverage,
    rasterFallbackCoverage,
    editableTextLayers: flat.filter((layer) => layer.kind === 'text').length,
    editableShapeLayers: flat.filter((layer) => layer.kind === 'shape').length,
    editableImageLayers: flat.filter((layer) => layer.kind === 'image' && !layer.fallbackRaster).length,
    editableTableLayers: flat.filter((layer) => layer.kind === 'table').length,
    editableVectorLayers: flat.filter((layer) => layer.kind === 'vector').length,
    fallbackRasterLayers: fallbackLayers.length,
    textAccuracy: accuracy,
    medianPositionDrift,
    p95PositionDrift,
    warnings,
  };
}

function average(values: number[]): number | null {
  return values.length ? round3(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

export function buildCdirFidelityReport(input: CdirDocument | unknown, options: CdirFidelityOptions = {}): CdirFidelityReport {
  const doc = parseCdirDocument(input);
  const opts = {
    ...options,
    nativeCoverageTarget: options.nativeCoverageTarget ?? 0.9,
    rasterFallbackLimit: options.rasterFallbackLimit ?? 0.1,
    textAccuracyTarget: options.textAccuracyTarget ?? 0.99,
    medianDriftLimit: options.medianDriftLimit ?? 2,
  };
  const pages = doc.pages.map((page) => scorePage(page, opts));
  const nativeCoverage = average(pages.map((page) => page.nativeCoverage)) ?? 0;
  const rasterFallbackCoverage = average(pages.map((page) => page.rasterFallbackCoverage)) ?? 0;
  const textScores = pages.map((page) => page.textAccuracy).filter((value): value is number => value !== null);
  const textScore = average(textScores);
  const driftValues = pages.map((page) => page.medianPositionDrift).filter((value): value is number => value !== null);
  const p95Values = pages.map((page) => page.p95PositionDrift).filter((value): value is number => value !== null);
  const medianPositionDrift = percentile(driftValues, 50);
  const p95PositionDrift = percentile(p95Values, 95);
  const driftScore = medianPositionDrift === null ? 1 : clamp01(1 - medianPositionDrift / 24);
  const overallParts = [nativeCoverage, 1 - rasterFallbackCoverage, textScore ?? 1, driftScore];
  return {
    overallScore: round3(average(overallParts) ?? 0),
    nativeCoverage,
    rasterFallbackCoverage,
    textAccuracy: textScore,
    medianPositionDrift,
    p95PositionDrift,
    editableLayerCount: pages.reduce((sum, page) => sum + page.editableTextLayers + page.editableShapeLayers + page.editableImageLayers + page.editableTableLayers + page.editableVectorLayers, 0),
    fallbackRasterLayerCount: pages.reduce((sum, page) => sum + page.fallbackRasterLayers, 0),
    pages,
    warnings: pages.flatMap((page) => page.warnings),
  };
}
