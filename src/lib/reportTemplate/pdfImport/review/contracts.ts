/**
 * PDF Extraction V3 · E11 — Review Workspace & Diagnostics versioned UI contracts.
 *
 * These are VIEW MODELS: bounded, privacy-safe, deterministic projections of the
 * authoritative upstream decisions (E0–E10). They REFERENCE upstream contracts;
 * they never replace or rederive them. The UI displays and invokes existing
 * decisions — it must never recompute source truth, table integrity, typography
 * safety, quality acceptance, repair-candidate selection, provider arbitration,
 * service routing or cache validity.
 *
 * HARD RULES encoded across this module:
 *  - a signed URL / private artifact path / raw buffer NEVER appears in a view
 *    model (hydrated URLs stay runtime-only, see the artifact hook);
 *  - `null` means "unavailable" and must never be displayed as `0`;
 *  - source FIDELITY, final-output SAFETY and EDITABILITY are separate axes and
 *    must never be collapsed into one headline score;
 *  - provider CONFIDENCE is never presented as final quality.
 */

/** Top-left, y-down, PDF-point rect (structurally identical to the E1 `SourceBBox`). */
export interface ReviewBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Version constants ────────────────────────────────────────────────────────

export const PDF_REVIEW_WORKSPACE_VERSION = 'pdf-review-workspace-v1' as const;
export const PDF_DIAGNOSTICS_VIEW_MODEL_VERSION = 'pdf-diagnostics-view-model-v1' as const;
export const PDF_DOCUMENT_REVIEW_MODEL_VERSION = 'pdf-document-review-model-v1' as const;
export const PDF_PAGE_REVIEW_MODEL_VERSION = 'pdf-page-review-model-v1' as const;
export const PDF_REGION_REVIEW_MODEL_VERSION = 'pdf-region-review-model-v1' as const;
export const PDF_REVIEW_ACTION_VERSION = 'pdf-review-action-v1' as const;
export const PDF_REVIEW_ACTION_RESULT_VERSION = 'pdf-review-action-result-v1' as const;
export const PDF_ARTIFACT_VIEWER_MODEL_VERSION = 'pdf-artifact-viewer-model-v1' as const;

// ── Shared enums / small summaries ───────────────────────────────────────────

export type LegacyState = 'v3-complete' | 'v3-partial' | 'legacy-v2' | 'legacy-v1' | 'unknown';

export type PageOutputStrategy = 'native' | 'mixed' | 'raster-only' | 'blocked' | 'unknown';

export type RegionOutputStrategy =
  | 'native' | 'source-crop' | 'native-with-source-reference'
  | 'hidden-semantic' | 'page-fallback' | 'blocked' | 'unknown';

export type RegionType =
  | 'text' | 'table' | 'chart' | 'picture' | 'logo'
  | 'vector-cluster' | 'background' | 'unknown-visual';

/** A single hard/critical defect, projected from E7 `CriticalQualityDefectV1`. */
export interface PdfReviewDefectSummaryV1 {
  code: string;
  severity: 'hard' | 'soft';
  scope: 'document' | 'page' | 'region' | 'overlay' | 'run';
  pageNumber: number | null;
  regionId: string | null;
  overlayId: string | null;
  measuredValue: number | null;
  threshold: number | null;
  /** Concise, privacy-safe explanation — never raw private text/financial values. */
  explanation: string;
  sourceContract: string;
  resolved: boolean;
}

/** Availability of the standard per-page artifact kinds (never the URLs). */
export interface PdfPageArtifactAvailabilityV1 {
  source: boolean;
  browserFinal: boolean;
  exportFinal: boolean;
  diff: boolean;
  foregroundSource: boolean;
  foregroundOutput: boolean;
  edgeSource: boolean;
  edgeOutput: boolean;
  regionSource: boolean;
  regionOutput: boolean;
}

/** One E9 provider attempt, projected safely (no endpoint/credential/payload). */
export interface PdfProviderAttemptSummaryV1 {
  providerId: string;
  executionMode: 'local' | 'remote' | 'unknown';
  purpose: string | null;
  status: string;
  remote: boolean;
  policyBlocked: boolean;
  pageNumbers: number[];
  regionCount: number;
  configurationIdPrefix: string | null;
  requestIdPrefix: string | null;
  attemptIdPrefix: string | null;
  elapsedMs: number | null;
  estimatedCostAmount: number | null;
  estimatedCostState: 'known' | 'unknown' | 'not-applicable';
  privacyClass: string | null;
  residencyClass: string | null;
  remoteApproved: boolean | null;
  sourceAgreement: 'agree' | 'conflict' | 'unknown' | null;
}

export interface PdfProviderEvidenceSummaryV1 {
  providerId: string;
  sourceAgreement: 'agree' | 'conflict' | 'unknown';
  /** Provider self-reported confidence — NEVER surfaced as final quality. */
  providerConfidence: number | null;
  remote: boolean;
}

export interface PdfReviewOverrideSummaryV1 {
  overrideId: string;
  kind: 'force-native' | 'force-source-crop' | 'force-page-raster' | 'unknown';
  actorLabel: string | null;
  createdAt: string | null;
  reason: string | null;
  acknowledgesHardDefects: boolean;
}

export interface PdfChartReviewSummaryV1 {
  chartType: string | null;
  detectionScore: number | null;
  renderMode: 'native' | 'source-crop' | 'suppressed' | 'unknown';
  axisLabelCount: number | null;
  legendLabelCount: number | null;
  numericLabelCount: number | null;
  suppressedChildCount: number | null;
  representationCount: number | null;
  metadataOrigin: 'source' | 'docling' | 'provider' | 'ocr-vlm-supplemental' | 'unknown';
}

export interface PdfTableReviewSummaryV1 {
  sourceRows: number | null;
  sourceColumns: number | null;
  selectedCandidateIdPrefix: string | null;
  candidateProfile: string | null;
  arbitrationState: string | null;
  integrityScore: number | null;
  headerAgreement: number | null;
  rowCoverage: number | null;
  columnCoverage: number | null;
  numericTokenRecall: number | null;
  numericCellAssociation: number | null;
  spanAgreement: number | null;
  overflowOrClipping: boolean | null;
  genericHeaderDefect: boolean | null;
  sourceCropAvailable: boolean;
  finalRenderMode: 'native' | 'source-crop' | 'unknown';
}

export interface PdfTypographyReviewSummaryV1 {
  sourceFontIdentity: string | null;
  normalizedFamily: string | null;
  subset: boolean | null;
  selectedFont: string | null;
  resolutionState: 'exact' | 'substituted' | 'text-crop' | 'unknown' | null;
  glyphCoverage: number | null;
  rawUnicodeIntegrity: number | null;
  punctuationRecall: number | null;
  numericTokenRecall: number | null;
  lineCountAgreement: number | null;
  clipping: boolean | null;
  baselineDrift: number | null;
  exportParity: number | null;
  sourceTextCropAvailable: boolean;
}

export interface PdfRegionRepairSummaryV1 {
  passes: number;
  candidateCount: number;
  selectedCandidateIdPrefix: string | null;
  resolvedDefectCount: number;
  introducedHardDefectCount: number;
  legacy: boolean;
}

// ── Region review model ──────────────────────────────────────────────────────

export interface PdfRegionReviewSummaryV1 {
  regionId: string;
  regionType: RegionType;
  strategy: RegionOutputStrategy;
  visibleOwnerRegionId: string | null;
  editable: boolean;
  score: number | null;
  hardDefectCount: number;
  cropAvailable: boolean;
  providerAssisted: boolean;
  repaired: boolean;
  overrideActive: boolean;
}

export interface PdfRegionReviewModelV1 {
  version: typeof PDF_REGION_REVIEW_MODEL_VERSION;
  regionId: string;
  pageNumber: number;
  regionType: RegionType;
  bbox: ReviewBBox | null;
  source: {
    cropAvailable: boolean;
    sourceEvidenceComplete: boolean;
    foregroundOccupancy: number | null;
  };
  output: {
    strategy: RegionOutputStrategy;
    visibleOwnerRegionId: string | null;
    nativeOverlayIds: string[];
    suppressedOverlayCount: number;
    cropRole: string | null;
    editable: boolean;
  };
  quality: {
    score: number | null;
    hardDefects: PdfReviewDefectSummaryV1[];
    foregroundRecall: number | null;
    edgeRecall: number | null;
    occupancyLoss: number | null;
    representationCount: number | null;
    blank: boolean | null;
  };
  chart: PdfChartReviewSummaryV1 | null;
  table: PdfTableReviewSummaryV1 | null;
  typography: PdfTypographyReviewSummaryV1 | null;
  providers: PdfProviderEvidenceSummaryV1[];
  repair: PdfRegionRepairSummaryV1 | null;
  activeOverride: PdfReviewOverrideSummaryV1 | null;
  capabilities: {
    canForceNative: boolean;
    canForceCrop: boolean;
    canRestoreAutomatic: boolean;
    canInspectStructuredData: boolean;
    canRequestProviderRecovery: boolean;
    canOpenEditor: boolean;
  };
  problems: string[];
}

// ── Page review model ────────────────────────────────────────────────────────

export interface PdfPageReviewModelV1 {
  version: typeof PDF_PAGE_REVIEW_MODEL_VERSION;
  pageId: string;
  pageNumber: number;
  geometry: { widthPt: number | null; heightPt: number | null; rotation: number | null };
  complexity: { class: string | null; matchedSignals: string[]; requiredCapabilities: string[] };
  routing: {
    serviceClass: string | null;
    targetState: string | null;
    providerIds: string[];
    routeReason: string | null;
    remote: boolean;
  };
  output: {
    pageStrategy: PageOutputStrategy;
    renderPlanHashPrefix: string | null;
    nativeRegionCount: number;
    sourceCropRegionCount: number;
    hiddenSemanticRegionCount: number;
    pageRaster: boolean;
  };
  quality: {
    score: number | null;
    metricCoverage: number | null;
    hardDefectCount: number;
    defects: PdfReviewDefectSummaryV1[];
    recommendedAction: string | null;
    sourceFidelityScore: number | null;
    finalOutputScore: number | null;
    exportScore: number | null;
  };
  editability: { percentage: number | null; nativeOverlayCount: number; lockedCropCount: number };
  extraction: { chartCount: number; tableCount: number; pictureCount: number; typographyRunCount: number };
  artifacts: PdfPageArtifactAvailabilityV1;
  providerAttempts: PdfProviderAttemptSummaryV1[];
  repair: {
    passes: number;
    candidateCount: number;
    selectedCandidateIdPrefix: string | null;
    resolvedDefectCount: number;
    introducedHardDefectCount: number;
  };
  cache: { replayed: boolean | null; artifactComplete: boolean | null };
  review: {
    activeOverride: PdfReviewOverrideSummaryV1 | null;
    manualReviewRequired: boolean;
    approved: boolean;
  };
  regions: PdfRegionReviewSummaryV1[];
  problems: string[];
}

/** Compact per-page summary for the navigator (never loads private text). */
export interface PdfPageReviewSummaryV1 {
  pageId: string;
  pageNumber: number;
  pageStrategy: PageOutputStrategy;
  score: number | null;
  hardDefectCount: number;
  manualReviewRequired: boolean;
  overrideActive: boolean;
  cacheReplayed: boolean | null;
  providerAssisted: boolean;
  repaired: boolean;
  serviceClass: string | null;
  regionTypes: RegionType[];
}

// ── Capabilities ─────────────────────────────────────────────────────────────

export interface PdfReviewCapabilitiesV1 {
  canReview: boolean;
  canForceNative: boolean;
  canForceCrop: boolean;
  canForceRaster: boolean;
  canRestoreAutomatic: boolean;
  canRequestProviderRecovery: boolean;
  canRequestSameTargetRetry: boolean;
  canManualRepair: boolean;
  canOpenEditor: boolean;
  canAddNote: boolean;
  isAdminDiagnostics: boolean;
}

// ── Document review model ────────────────────────────────────────────────────

export interface PdfDocumentReviewModelV1 {
  version: typeof PDF_DOCUMENT_REVIEW_MODEL_VERSION;
  importId: string;
  templateId: string | null;
  jobId: string | null;
  source: { displayName: string; pageCount: number; byteSize: number | null; sourceHashPrefix: string | null };
  lifecycle: {
    status: string;
    createdAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    chunked: boolean | null;
    chunkCount: number | null;
  };
  plan: {
    version: string | null;
    planIdPrefix: string | null;
    planStage: string | null;
    documentComplexity: string | null;
    planComplete: boolean | null;
    shadowMode: boolean | null;
  };
  routing: {
    routeCounts: Record<string, number>;
    serviceClasses: string[];
    remotePageCount: number;
    remoteRegionCount: number;
    policyState: string | null;
  };
  output: {
    finalDecision: string | null;
    nativePageCount: number;
    mixedPageCount: number;
    rasterPageCount: number;
    blockedPageCount: number;
  };
  quality: {
    qualityVersion: string | null;
    documentScore: number | null;
    minimumPageScore: number | null;
    hardDefectCount: number;
    pagesWithHardDefects: number;
    pagesUnscored: number;
    coverage: string | null;
    browserExportParity: number | null;
  };
  editability: { editablePageRatio: number | null; editableRegionRatio: number | null; nativeOverlayRatio: number | null };
  extraction: {
    sourceSceneComplete: boolean | null;
    providerAttemptCount: number;
    repairAttemptCount: number;
    artifactCompleteness: boolean | null;
  };
  cache: {
    lookupState: string | null;
    hit: boolean | null;
    namespace: string | null;
    complete: boolean | null;
    cacheable: boolean | null;
  };
  costPerformance: {
    totalProviderElapsedMs: number | null;
    totalExecutionMs: number | null;
    estimatedCostAmount: number | null;
    estimatedCostCurrency: string | null;
    estimateState: 'known' | 'partial' | 'unknown';
  };
  review: {
    manualReviewRequired: boolean;
    reviewedPageCount: number;
    activeOverrideCount: number;
    unresolvedActionCount: number;
  };
  pageSummaries: PdfPageReviewSummaryV1[];
  capabilities: PdfReviewCapabilitiesV1;
  legacyState: LegacyState;
  problems: string[];
}

// ── Diagnostics view model ───────────────────────────────────────────────────

export interface PdfDiagnosticsSummaryV1 {
  version: typeof PDF_DIAGNOSTICS_VIEW_MODEL_VERSION;
  importId: string;
  jobId: string | null;
  displayName: string;
  status: string;
  createdAt: string | null;
  completedAt: string | null;
  pageCount: number | null;
  documentComplexity: string | null;
  finalDecision: string | null;
  hardDefectCount: number;
  manualReviewRequired: boolean;
  serviceClassSummary: string[];
  providerAttemptCount: number;
  cacheState: string | null;
  artifactCompleteness: boolean | null;
  recoveryActive: boolean;
  durationMs: number | null;
  estimatedCostState: 'known' | 'partial' | 'unknown';
  legacyState: LegacyState;
  remoteAttempted: boolean;
}

// ── Artifact viewer model ────────────────────────────────────────────────────

export type ArtifactKind =
  | 'source' | 'browser-final' | 'export-final' | 'diff'
  | 'foreground-source' | 'foreground-output' | 'edge-source' | 'edge-output'
  | 'region-source' | 'region-output';

export type ArtifactAssetState =
  | 'idle' | 'loading' | 'ready' | 'expired' | 'missing' | 'invalid' | 'forbidden' | 'error';

export interface PdfArtifactViewerModelV1 {
  version: typeof PDF_ARTIFACT_VIEWER_MODEL_VERSION;
  pageNumber: number;
  availableKinds: ArtifactKind[];
  selectedKind: ArtifactKind;
  assetState: ArtifactAssetState;
  dimensions: { widthPx: number | null; heightPx: number | null };
  hashVerified: boolean | null;
  expiresAt: string | null;
  problems: string[];
}

// ── Review action + result contracts ─────────────────────────────────────────

export type ReviewActionKind =
  | 'accept-automatic' | 'force-native' | 'force-source-crop' | 'force-page-raster'
  | 'restore-automatic' | 'preview-native-reconstruction' | 'show-source-reference'
  | 'request-same-target-retry' | 'request-recovery-plan' | 'request-provider-recovery'
  | 'add-review-note' | 'mark-reviewed';

export interface PdfReviewActionV1 {
  version: typeof PDF_REVIEW_ACTION_VERSION;
  actionId: string;
  importId: string;
  templateId: string | null;
  action: ReviewActionKind;
  scope: { pageId: string | null; pageNumber: number | null; regionId: string | null };
  expectedState: {
    planId: string | null;
    planHash: string | null;
    renderPlanHash: string | null;
    currentOverrideId: string | null;
    qualityReportHash: string | null;
  };
  reason: string | null;
  hardDefectsAcknowledged: boolean;
  requestedRecoveryOptionId: string | null;
  clientRequestId: string;
  problems: string[];
}

export type ReviewActionState =
  | 'applied' | 'queued' | 'rejected' | 'conflict' | 'forbidden' | 'unavailable' | 'failed';

export interface PdfReviewActionResultV1 {
  version: typeof PDF_REVIEW_ACTION_RESULT_VERSION;
  actionId: string;
  state: ReviewActionState;
  currentPlanId: string | null;
  currentRenderPlanHash: string | null;
  currentOverrideId: string | null;
  reviewState: string;
  refreshRequired: boolean;
  safeMessage: string;
  problems: string[];
}

/** A server-provided, allowlisted provider-recovery option (client selects an id only). */
export interface PdfProviderRecoveryOptionV1 {
  optionId: string;
  purpose: string;
  pageScope: number[];
  regionScope: number;
  providerClass: string;
  remote: boolean;
  policyState: string;
  expectedCostState: 'known' | 'unknown' | 'not-applicable';
  targetState: string;
  reason: string;
  enabled: boolean;
}
