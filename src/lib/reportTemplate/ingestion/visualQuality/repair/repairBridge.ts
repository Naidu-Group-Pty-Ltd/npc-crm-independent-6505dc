import type { CdirDocument, CdirLayer, CdirPage, CdirRect } from '../../cdir/schema';
import type { SourceBoundsExpectation, SourceTextExpectation } from '../../fidelity';
import type { LoadedImportReviewForVisualQuality } from '../importReviewPipeline';
import type { GeneratedRenderPageRaster } from '../generatedRenderCapture';
import type { SourceRenderPageRaster } from '../renderDiffPersistence';
import type { VisualImportFinalMode, VisualImportQualityReport } from '../schema';
import type {
  DoclingExpectationsLike,
  RenderedPageRaster,
  VisualDiffInput,
} from '../diff';
import type { RunRepairLoopOptions } from './runRepairLoop';
import {
  classifyVisualQualityRepairIssues,
  type ClassifiedRepairIssues,
} from './issueClassifier';
import {
  evaluateVisualRepairEligibility,
  type VisualRepairEligibility,
} from './repairEligibility';
import {
  isSourceFidelityUsable,
  resolveQualityCoverage,
  sourceExpectationBundleToExpectationsLike,
  type VisualQualityCoverage,
  type VisualSourceExpectationBundle,
} from '../sourceExpectations';

export const REPAIR_LOOP_BRIDGE_VERSION = 'repair-loop-bridge-v1';

// `docling_source` — expectations come from the immutable source (authoritative).
// `cdir_self_baseline` — expectations derived from the candidate CDIR; a fallback
// used only when a source bundle is unavailable. It is NOT source-fidelity and
// must not drive a headline score presented as full-coverage.
export type RepairExpectationStrategy = 'cdir_self_baseline' | 'docling_source';

export interface BuildRepairLoopBridgeOptions {
  loaded: LoadedImportReviewForVisualQuality;
  visualReport: VisualImportQualityReport;
  generatedRasters: GeneratedRenderPageRaster[];
  sourceRasters?: SourceRenderPageRaster[] | null;
  finalMode?: VisualImportFinalMode;
  maxPasses?: number;
  /** C3: immutable source-derived expectations. When usable, they replace the CDIR-self baseline. */
  sourceExpectations?: VisualSourceExpectationBundle | null;
}

export interface RepairLoopBridgeInput {
  version: typeof REPAIR_LOOP_BRIDGE_VERSION;
  importId: string;
  templateId: string | null;
  expectationStrategy: RepairExpectationStrategy;
  expectationCoverage: VisualQualityCoverage;
  cdir: CdirDocument;
  expectations: DoclingExpectationsLike;
  renderedRasters: RenderedPageRaster[];
  sourceRasters: NonNullable<VisualDiffInput['sourceRasters']>;
  classified: ClassifiedRepairIssues;
  eligibility: VisualRepairEligibility;
  eligiblePageNumbers: number[];
  problems: string[];
  canRunRepairLoop: boolean;
  runOptions: RunRepairLoopOptions;
}

function stablePageNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function finiteRect(rect: CdirRect | undefined | null): CdirRect | null {
  if (!rect) return null;
  if (
    !Number.isFinite(rect.x)
    || !Number.isFinite(rect.y)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width <= 0
    || rect.height <= 0
  ) {
    return null;
  }

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    ...(Number.isFinite(rect.rotation) ? { rotation: rect.rotation } : {}),
  };
}

function layerText(layer: CdirLayer): string {
  if (layer.kind === 'text') {
    const runText = (layer.runs ?? []).map((run) => run.text).filter(Boolean).join(' ');
    return (runText || layer.text || '').trim();
  }

  if (layer.kind === 'table') {
    return (layer.rows ?? []).flat().filter(Boolean).join(' ').trim();
  }

  if (layer.kind === 'group') {
    return (layer.children ?? []).map(layerText).filter(Boolean).join(' ').trim();
  }

  return '';
}

function flattenLayers(layers: CdirLayer[]): CdirLayer[] {
  const out: CdirLayer[] = [];

  for (const layer of layers ?? []) {
    if (!layer) continue;
    out.push(layer);
    if (layer.kind === 'group') out.push(...flattenLayers(layer.children ?? []));
  }

  return out;
}

function pageText(page: CdirPage): string {
  return flattenLayers(page.layers ?? []).map(layerText).filter(Boolean).join(' ').trim();
}

export function buildCdirSelfExpectations(cdir: CdirDocument): DoclingExpectationsLike {
  const expectedText: SourceTextExpectation[] = [];
  const expectedBounds: SourceBoundsExpectation[] = [];

  for (const page of cdir.pages ?? []) {
    const text = pageText(page);
    if (text) expectedText.push({ pageId: page.id, text });

    for (const layer of flattenLayers(page.layers ?? [])) {
      if (layer.kind === 'image' && layer.fallbackRaster) continue;

      const bounds = finiteRect(layer.bounds ?? null);
      if (!bounds) continue;

      expectedBounds.push({
        pageId: page.id,
        layerId: layer.id,
        bounds: bounds as { x: number; y: number; width: number; height: number },
      });
    }
  }

  return {
    expectedText,
    expectedBounds,
  };
}

export function generatedRastersToRenderedPageRasters(
  generatedRasters: GeneratedRenderPageRaster[],
): RenderedPageRaster[] {
  return [...(generatedRasters ?? [])]
    .filter((raster) => Boolean(raster?.imageData))
    .map((raster) => ({
      pageId: raster.pageId || `docling-page-${raster.pageNumber}`,
      pageNumber: raster.pageNumber,
      imageData: raster.imageData,
    }));
}

export function sourceRenderRastersToVisualDiffSourceRasters(
  sourceRasters: SourceRenderPageRaster[] | null | undefined,
  cdir: CdirDocument,
): NonNullable<VisualDiffInput['sourceRasters']> {
  const byPageNumber = new Map<number, CdirPage>();

  cdir.pages.forEach((page, index) => {
    byPageNumber.set(index + 1, page);
    const parsed = stablePageNumber(String(page.id).match(/docling-page-(\d+)/)?.[1]);
    if (parsed) byPageNumber.set(parsed, page);
  });

  const out: NonNullable<VisualDiffInput['sourceRasters']> = [];

  for (const source of sourceRasters ?? []) {
    if (!source?.imageData) continue;

    const page = byPageNumber.get(source.pageNumber);
    out.push({
      pageNumber: source.pageNumber,
      imageData: source.imageData,
      widthPt: page?.width ?? source.imageData.width,
      heightPt: page?.height ?? source.imageData.height,
    });
  }

  return out;
}

export function buildRepairLoopBridgeInput(
  options: BuildRepairLoopBridgeOptions,
): RepairLoopBridgeInput {
  const loaded = options.loaded;
  const importId = loaded.record.id;
  if (!importId) throw new Error('importId is required to build repair loop bridge input.');

  const cdir = loaded.draft.cdir;
  const templateId = options.visualReport.templateId
    ?? loaded.record.created_template_id
    ?? null;

  const classified = classifyVisualQualityRepairIssues(options.visualReport);
  const eligibility = evaluateVisualRepairEligibility(classified);
  // C3.4: prefer immutable source-derived expectations. The CDIR-self baseline
  // is only a fallback (and is not source fidelity) — never let a self-consistent
  // but source-wrong CDIR pass by scoring against itself.
  const useSource = isSourceFidelityUsable(options.sourceExpectations);
  const expectationStrategy: RepairExpectationStrategy = useSource ? 'docling_source' : 'cdir_self_baseline';
  const expectationCoverage = resolveQualityCoverage(options.sourceExpectations);
  const expectations = useSource
    ? sourceExpectationBundleToExpectationsLike(options.sourceExpectations)
    : buildCdirSelfExpectations(cdir);
  const renderedRasters = generatedRastersToRenderedPageRasters(options.generatedRasters);
  const sourceDiffRasters = sourceRenderRastersToVisualDiffSourceRasters(options.sourceRasters, cdir);

  const problems: string[] = [];

  if (options.visualReport.importId !== importId) {
    problems.push(`visual_report_import_id_mismatch:${options.visualReport.importId}`);
  }

  if (renderedRasters.length === 0) {
    problems.push('generated_render_rasters_missing');
  }

  if (sourceDiffRasters.length === 0) {
    problems.push('source_render_rasters_missing');
  }

  if (!expectations.expectedBounds.length) {
    problems.push('repair_expectations_bounds_missing');
  }

  if (!expectations.expectedText.length) {
    problems.push('repair_expectations_text_missing');
  }

  if (!eligibility.canRunRepairLoop) {
    problems.push('no_eligible_repair_pages');
  }

  const eligiblePageNumbers = eligibility.pages
    .filter((page) => page.eligibleForRepairLoop)
    .map((page) => page.pageNumber);

  const finalMode = options.finalMode ?? options.visualReport.finalMode ?? 'hybrid';

  const runOptions: RunRepairLoopOptions = {
    importId,
    templateId,
    cdir,
    expectations,
    renderedRasters,
    sourceRasters: sourceDiffRasters,
    finalMode,
    ...(options.maxPasses !== undefined ? { maxPasses: options.maxPasses } : {}),
  };

  return {
    version: REPAIR_LOOP_BRIDGE_VERSION,
    importId,
    templateId,
    expectationStrategy,
    expectationCoverage,
    cdir,
    expectations,
    renderedRasters,
    sourceRasters: sourceDiffRasters,
    classified,
    eligibility,
    eligiblePageNumbers,
    problems,
    canRunRepairLoop: eligibility.canRunRepairLoop && renderedRasters.length > 0,
    runOptions,
  };
}
