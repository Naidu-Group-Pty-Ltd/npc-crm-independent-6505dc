import type { PageContextRenderArtifactManifest } from '../pageContextArtifacts';
import {
  captureGeneratedTemplatePageRasters,
  type CaptureGeneratedRenderOptions,
  type GeneratedRenderPageRaster,
} from '../generatedRenderCapture';
import {
  loadSourceRastersFromManifest,
  type SourceRenderPageRaster,
} from '../renderDiffPersistence';
import {
  runImportReviewVisualQualityPipeline,
  type LoadedImportReviewForVisualQuality,
  type RunImportReviewVisualQualityPipelineOptions,
  type RunImportReviewVisualQualityPipelineResult,
} from '../importReviewPipeline';
import type { VisualImportFinalMode, VisualImportQualityReport } from '../schema';
import { runVisualDiff, type VisualDiffInput } from '../diff';
import {
  isSourceFidelityUsable,
  resolveQualityCoverage,
  sourceExpectationBundleToExpectationsLike,
  type VisualQualityCoverage,
  type VisualSourceExpectationBundle,
} from '../sourceExpectations';
import {
  buildRepairLoopBridgeInput,
  generatedRastersToRenderedPageRasters,
  sourceRenderRastersToVisualDiffSourceRasters,
  type RepairLoopBridgeInput,
} from './repairBridge';
import {
  runDeterministicVisualRepair,
  type DeterministicRepairStatus,
  type DeterministicVisualRepairResult,
  type RunDeterministicVisualRepairOptions,
} from './deterministicRepairRunner';

export const VISUAL_REPAIR_ORCHESTRATION_PIPELINE_VERSION = 'visual-repair-orchestration-pipeline-v1';

export interface VisualRepairOrchestrationSummary {
  version: typeof VISUAL_REPAIR_ORCHESTRATION_PIPELINE_VERSION;
  importId: string;
  templateId: string | null;
  visualQaScore: number;
  finalScore: number;
  scoreDelta: number;
  visualQaPersisted: boolean;
  repairStatus: DeterministicRepairStatus;
  canRunRepairLoop: boolean;
  eligiblePageCount: number;
  totalApplied: number;
  passesAttempted: number;
  patchesAccepted: number;
  patchesRejected: number;
  requiresFallback: boolean;
  requiresManualReview: boolean;
  /** C3: whether the headline score used full source expectations, was partial, or image-only. */
  qualityCoverage: VisualQualityCoverage;
  expectationStrategy: RepairLoopBridgeInput['expectationStrategy'];
  problemCount: number;
  problems: string[];
}

export interface RunVisualRepairOrchestrationPipelineOptions {
  loaded: LoadedImportReviewForVisualQuality;
  generatedRasters?: GeneratedRenderPageRaster[] | null;
  sourceRasters?: SourceRenderPageRaster[] | null;
  templateId?: string | null;
  finalMode?: VisualImportFinalMode;
  persistVisualQa?: boolean;
  maxRasterDim?: number;
  maxRepairPasses?: number;
  /** C3: immutable source-derived expectations. When usable, the headline score + repair loop compare against these. */
  sourceExpectations?: VisualSourceExpectationBundle | null;
  /** Injectable authoritative scorer (tests). Defaults to `runVisualDiff`. */
  runVisualDiffImpl?: (input: VisualDiffInput) => Promise<VisualImportQualityReport>;
  captureOptions?: Partial<Omit<CaptureGeneratedRenderOptions, 'importId' | 'template'>>;
  captureGeneratedRasters?: (options: CaptureGeneratedRenderOptions) => Promise<GeneratedRenderPageRaster[]>;
  loadSourceRasters?: (
    manifest: PageContextRenderArtifactManifest,
    opts?: { maxPixelDim?: number },
  ) => Promise<SourceRenderPageRaster[]>;
  runVisualQaPipelineImpl?: (
    options: RunImportReviewVisualQualityPipelineOptions,
  ) => Promise<RunImportReviewVisualQualityPipelineResult>;
  runDeterministicRepairImpl?: (
    options: RunDeterministicVisualRepairOptions,
  ) => Promise<DeterministicVisualRepairResult>;
  runRepairLoopImpl?: RunDeterministicVisualRepairOptions['runRepairLoopImpl'];
  now?: () => Date;
}

export interface VisualRepairOrchestrationPipelineResult {
  version: typeof VISUAL_REPAIR_ORCHESTRATION_PIPELINE_VERSION;
  importId: string;
  templateId: string | null;
  loaded: LoadedImportReviewForVisualQuality;
  generatedRasters: GeneratedRenderPageRaster[];
  sourceRasters: SourceRenderPageRaster[];
  visualQa: RunImportReviewVisualQualityPipelineResult;
  /** C3: authoritative source-scored report (equals the image-first report when no source expectations). */
  headlineReport: VisualImportQualityReport;
  qualityCoverage: VisualQualityCoverage;
  bridge: RepairLoopBridgeInput;
  repair: DeterministicVisualRepairResult;
  draft: DeterministicVisualRepairResult['draft'];
  summary: VisualRepairOrchestrationSummary;
}

async function resolveGeneratedRasters(
  options: RunVisualRepairOrchestrationPipelineOptions,
): Promise<GeneratedRenderPageRaster[]> {
  if (options.generatedRasters?.length) return options.generatedRasters;

  const capture = options.captureGeneratedRasters ?? captureGeneratedTemplatePageRasters;
  return capture({
    ...(options.captureOptions ?? {}),
    importId: options.loaded.record.id,
    template: options.loaded.draft.template,
  });
}

async function resolveSourceRasters(
  options: RunVisualRepairOrchestrationPipelineOptions,
): Promise<SourceRenderPageRaster[]> {
  if (options.sourceRasters?.length) return options.sourceRasters;

  const load = options.loadSourceRasters ?? loadSourceRastersFromManifest;
  return load(options.loaded.renderArtifactManifest, {
    maxPixelDim: options.maxRasterDim ?? 1400,
  });
}

function buildSummary(options: {
  importId: string;
  templateId: string | null;
  headlineReport: VisualImportQualityReport;
  qualityCoverage: VisualQualityCoverage;
  visualQa: RunImportReviewVisualQualityPipelineResult;
  bridge: RepairLoopBridgeInput;
  repair: DeterministicVisualRepairResult;
}): VisualRepairOrchestrationSummary {
  const problems = [
    ...(options.bridge.problems ?? []),
    ...(options.visualQa.visualQa.problems ?? []),
    ...(options.repair.errorMessage ? [`repair_error:${options.repair.errorMessage}`] : []),
  ];

  // C3.5: a partial-coverage headline (source expectations expected but a page
  // is missing) must not be treated as a clean full-metric pass.
  const coverageForcesReview = options.qualityCoverage === 'partial';

  return {
    version: VISUAL_REPAIR_ORCHESTRATION_PIPELINE_VERSION,
    importId: options.importId,
    templateId: options.templateId,
    visualQaScore: options.headlineReport.overallScore,
    finalScore: options.repair.finalReport.overallScore,
    scoreDelta: options.repair.finalReport.overallScore - options.headlineReport.overallScore,
    visualQaPersisted: options.visualQa.visualQa.summary.persisted,
    repairStatus: options.repair.status,
    canRunRepairLoop: options.bridge.canRunRepairLoop,
    eligiblePageCount: options.bridge.eligibility.eligiblePageCount,
    totalApplied: options.repair.totalApplied,
    passesAttempted: options.repair.summary.passesAttempted,
    patchesAccepted: options.repair.summary.patchesAccepted,
    patchesRejected: options.repair.summary.patchesRejected,
    requiresFallback: options.bridge.eligibility.requiresFallback,
    requiresManualReview: options.bridge.eligibility.requiresManualReview
      || options.repair.finalReport.manualReviewRequired
      || coverageForcesReview,
    qualityCoverage: options.qualityCoverage,
    expectationStrategy: options.bridge.expectationStrategy,
    problemCount: problems.length,
    problems,
  };
}

export async function runVisualRepairOrchestrationPipeline(
  options: RunVisualRepairOrchestrationPipelineOptions,
): Promise<VisualRepairOrchestrationPipelineResult> {
  const loaded = options.loaded;
  const importId = loaded.record.id;
  if (!importId) throw new Error('importId is required for visual repair orchestration.');

  const templateId = options.templateId ?? loaded.record.created_template_id ?? null;
  const finalMode = options.finalMode ?? 'hybrid';

  const generatedRasters = await resolveGeneratedRasters(options);
  const sourceRasters = await resolveSourceRasters(options);

  const visualQaRunner = options.runVisualQaPipelineImpl ?? runImportReviewVisualQualityPipeline;
  const visualQa = await visualQaRunner({
    loaded,
    generatedRasters,
    sourceRasters,
    templateId,
    finalMode,
    persist: options.persistVisualQa ?? false,
    maxRasterDim: options.maxRasterDim,
  });

  const repairLoaded: LoadedImportReviewForVisualQuality = {
    ...loaded,
    draft: visualQa.draft,
  };

  // C3.5/C3.6: when source expectations are usable, the AUTHORITATIVE headline
  // report comes from runVisualDiff scored against the immutable source — not the
  // image-first renderDiffPersistence report, whose text/layout/missing metrics
  // are neutral placeholders. renderDiffPersistence still owns image pairing and
  // persistence (source/generated/diff rasters).
  const qualityCoverage = resolveQualityCoverage(options.sourceExpectations);
  let headlineReport = visualQa.visualQa.report;
  if (isSourceFidelityUsable(options.sourceExpectations)) {
    const scorer = options.runVisualDiffImpl ?? runVisualDiff;
    headlineReport = await scorer({
      importId,
      templateId,
      cdir: repairLoaded.draft.cdir,
      expectations: sourceExpectationBundleToExpectationsLike(options.sourceExpectations),
      renderedRasters: generatedRastersToRenderedPageRasters(generatedRasters),
      sourceRasters: sourceRenderRastersToVisualDiffSourceRasters(sourceRasters, repairLoaded.draft.cdir),
      finalMode,
    });
  }

  const bridge = buildRepairLoopBridgeInput({
    loaded: repairLoaded,
    visualReport: headlineReport,
    generatedRasters,
    sourceRasters,
    finalMode,
    maxPasses: options.maxRepairPasses,
    sourceExpectations: options.sourceExpectations,
  });

  const repairRunner = options.runDeterministicRepairImpl ?? runDeterministicVisualRepair;
  const repair = await repairRunner({
    loaded: repairLoaded,
    bridge,
    runRepairLoopImpl: options.runRepairLoopImpl,
    now: options.now,
  });

  const summary = buildSummary({
    importId,
    templateId,
    headlineReport,
    qualityCoverage,
    visualQa,
    bridge,
    repair,
  });

  return {
    version: VISUAL_REPAIR_ORCHESTRATION_PIPELINE_VERSION,
    importId,
    templateId,
    loaded: repairLoaded,
    generatedRasters,
    sourceRasters,
    visualQa,
    headlineReport,
    qualityCoverage,
    bridge,
    repair,
    draft: repair.draft,
    summary,
  };
}
