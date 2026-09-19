/**
 * Visual Import Quality Contract (Phase 2).
 *
 * Public entry point for the visual quality gate that sits on top of CDIR.
 * Phase 4 will produce the metrics; Phase 5 will persist them; Phase 6 will
 * drive the AI repair loop off `recommendedAction`.
 *
 * Consumers should import from this barrel, never the individual files:
 *
 *   import {
 *     scorePage,
 *     aggregateImportQuality,
 *     QUALITY_THRESHOLDS,
 *     type VisualImportQualityReport,
 *   } from '@/lib/reportTemplate/ingestion/visualQuality';
 */
export type {
  VisualImportFinalMode,
  VisualImportQualityReport,
  VisualPageQualityReport,
  VisualRecommendedAction,
  VisualWarning,
  VisualWarningSeverity,
} from './schema';

export {
  QUALITY_SCORE_WEIGHTS,
  QUALITY_THRESHOLDS,
  METRIC_WARNING_THRESHOLDS,
  recommendActionForScore,
  warningForMetric,
  type MetricKey,
  type QualityThresholdKey,
} from './thresholds';

export {
  computePageOverallScore,
  scorePage,
  aggregateImportQuality,
  countPagesNeedingReview,
  type PageMetricInput,
  type AggregateOptions,
} from './score';

export {
  loadVisualQuality,
  saveVisualQuality,
  imageDataToPngBase64,
  visualQualityPaths,
  type LoadVisualQualityResult,
  type PersistedVisualQuality,
  type SaveVisualQualityResult,
  type SaveVisualQualityOptions,
  type VisualQualityArtifactPaths,
  type VisualQualityPageRasters,
} from './persist';

// Phase 4 — visual diff harness
export {
  runVisualDiff,
  compareImages,
  buildDiffImage,
  measureTextCoverage,
  measureLayoutMetrics,
  flattenCdirLayerBounds,
  rasterizePdfPages,
  rasterizeFromHtmlImage,
  type VisualDiffInput,
  type RenderedPageRaster,
  type DoclingExpectationsLike,
  type ImageMetricsResult,
  type TextCoverageResult,
  type LayoutMetricsResult,
  type RasterisedPage,
  type RasterizePdfOptions,
} from './diff';

// Phase 6 — repair loop
export {
  runRepairLoop,
  applyPatch,
  applyPatches,
  doclingRepairSolver,
  type RunRepairLoopOptions,
  type ApplyPatchResult,
  type RepairOp,
  type RepairPatch,
  type RepairSolver,
  type RepairContext,
  type RepairPassReport,
  type RepairLoopResult,
} from './repair';


export {
  PAGE_CONTEXT_RENDER_ARTIFACT_MANIFEST_VERSION,
  buildPageContextRenderArtifactManifest,
  pageContextRenderManifestToReviewArtifacts,
  type PageContextRenderArtifactManifest,
  type PageContextSourceRenderArtifact,
} from './pageContextArtifacts';


export {
  GENERATED_RENDER_ARTIFACT_MANIFEST_VERSION,
  buildGeneratedRenderArtifactManifest,
  captureGeneratedTemplatePageRasters,
  generatedRenderRastersToReviewArtifacts,
  type CaptureGeneratedRenderOptions,
  type GeneratedRenderArtifactManifest,
  type GeneratedRenderArtifactPage,
  type GeneratedRenderPageRaster,
} from './generatedRenderCapture';


export {
  RENDER_DIFF_PERSISTENCE_VERSION,
  buildVisualQualityFromRenderPairs,
  imageUrlToImageData,
  loadSourceRastersFromManifest,
  pairSourceAndGeneratedRasters,
  persistRenderDiffVisualQuality,
  sourceRasterRefsFromManifest,
  type BuildVisualQualityFromRenderPairsOptions,
  type PairedRenderPageRaster,
  type PersistRenderDiffOptions,
  type PersistRenderDiffResult,
  type SourceRenderPageRaster,
  type VisualQualityFromRenderPairs,
} from './renderDiffPersistence';


export {
  IMPORT_REVIEW_VISUAL_QA_VERSION,
  attachVisualQualityToImportReview,
  generatedRastersToImportReviewArtifacts,
  persistedVisualQualityToReviewSummary,
  summarizeVisualQualityForReview,
  visualQualityReportToDiffReviewArtifacts,
  type AttachVisualQualityToImportReviewOptions,
  type AttachVisualQualityToImportReviewResult,
  type VisualQaReviewSummary,
} from './importReviewVisualQuality';


export {
  IMPORT_REVIEW_VISUAL_QA_PIPELINE_VERSION,
  runImportReviewVisualQualityPipeline,
  shouldAutoRunVisualQa,
  type LoadedImportReviewForVisualQuality,
  type RunImportReviewVisualQualityPipelineOptions,
  type RunImportReviewVisualQualityPipelineResult,
} from './importReviewPipeline';

export {
  REPAIR_ISSUE_CLASSIFIER_VERSION,
  classifyPageRepairIssues,
  classifyVisualQualityRepairIssues,
  isFallbackAction,
  isRepairAction,
  summarizeRepairIssues,
  type ClassifiedRepairIssues,
  type RepairIssue,
  type RepairIssueCategory,
  type RepairIssueSeverity,
  type RepairIssueSummary,
  type RepairSuggestion,
} from './repair';

export {
  REPAIR_ELIGIBILITY_VERSION,
  evaluatePageRepairEligibility,
  evaluateVisualRepairEligibility,
  type PageRepairEligibility,
  type RepairEligibilityBlockReason,
  type RepairEligibilityDecision,
  type RepairFallbackMode,
  type VisualRepairEligibility,
} from './repair';

export {
  REPAIR_LOOP_BRIDGE_VERSION,
  buildCdirSelfExpectations,
  buildRepairLoopBridgeInput,
  generatedRastersToRenderedPageRasters,
  sourceRenderRastersToVisualDiffSourceRasters,
  type BuildRepairLoopBridgeOptions,
  type RepairExpectationStrategy,
  type RepairLoopBridgeInput,
} from './repair';

export {
  VISUAL_QUALITY_BATCH_VERSION,
  DEFAULT_VISUAL_QUALITY_BATCH_SIZE,
  planVisualQualityBatches,
  runBatchedVisualQuality,
  type VisualQualityBatchContext,
  type BatchCoverage,
  type BatchedVisualQualitySummary,
  type VisualQualityBatchProblem,
  type PlanVisualQualityBatchesResult,
  type VisualQualityBatchRunInput,
  type VisualQualityBatchRunOutput,
  type VisualQualityBatchRunner,
  type RunBatchedVisualQualityOptions,
  type RunBatchedVisualQualityResult,
} from './visualQualityBatchCoordinator';

export {
  VISUAL_SOURCE_EXPECTATIONS_VERSION,
  buildVisualSourceExpectationBundle,
  isSourceFidelityUsable,
  resolveQualityCoverage,
  sourceExpectationBundleToExpectationsLike,
  loadPerPageSourceExpectations,
  pageNumberFromDoclingId,
  type VisualSourceExpectationBundle,
  type VisualSourceExpectationSource,
  type VisualQualityCoverage,
  type PerPageSourceArtifactResult,
  type PerPageSourceArtifactFetcher,
} from './sourceExpectations';

export {
  DETERMINISTIC_REPAIR_RUNNER_VERSION,
  runDeterministicVisualRepair,
  type DeterministicRepairSkipReason,
  type DeterministicRepairStatus,
  type DeterministicRepairSummary,
  type DeterministicVisualRepairResult,
  type RunDeterministicVisualRepairOptions,
} from './repair';

export {
  VISUAL_REPAIR_ORCHESTRATION_PIPELINE_VERSION,
  runVisualRepairOrchestrationPipeline,
  type RunVisualRepairOrchestrationPipelineOptions,
  type VisualRepairOrchestrationPipelineResult,
  type VisualRepairOrchestrationSummary,
} from './repair';

export {
  VISUAL_REPAIR_AUDIT_PERSISTENCE_VERSION,
  buildVisualRepairAuditPayload,
  loadVisualRepairAudit,
  saveVisualRepairAudit,
  visualRepairAuditPaths,
  type LoadVisualRepairAuditResult,
  type PersistedVisualRepairAudit,
  type SaveVisualRepairAuditResult,
  type VisualRepairAuditArtifactPaths,
  type VisualRepairAuditPayload,
} from './repair';

export {
  REPAIRED_TEMPLATE_APPLICATION_VERSION,
  applyRepairedTemplateToRecord,
  type ApplyRepairedTemplateOptions,
  type ApplyRepairedTemplateResult,
} from './repair';

// C7 — per-page review UI view-model + actions.
export {
  PAGE_REVIEW_MODEL_VERSION,
  PAGE_REVIEW_EAGER_IMAGE_LIMIT,
  PAGE_REVIEW_RESPONSIVE_PAGE_LIMIT,
  buildPageReviewModels,
  type BuildPageReviewModelsInput,
  type PageReviewCollection,
  type PageReviewModel,
  type PageReviewImages,
  type PageReviewMetric,
  type PageReviewArtifactAvailability,
  type PageRepairDiaryEntry,
} from './pageReviewModel';

export {
  PAGE_REVIEW_ACTION_VERSION,
  describePageActions,
  applyPageReviewAction,
  isPolicyAction,
  type PageReviewAction,
  type PageReviewPolicyAction,
  type PageActionContext,
  type PageActionDescriptor,
  type PageActionVariant,
  type ApplyPageReviewActionOptions,
  type ApplyPageReviewActionResult,
} from './pageReviewActions';
