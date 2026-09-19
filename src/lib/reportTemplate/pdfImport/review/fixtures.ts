/**
 * PDF Extraction V3 · E11 — deterministic review fixtures (no private data).
 *
 * Synthetic, fully in-memory authority inputs a test/story can feed to the pure
 * builders. No private PDF, source text, financial value, signed URL, credential
 * or artifact path ever appears here — only structural, already-decided state.
 * These also seed the E12 golden-corpus handoff.
 */
import type { PdfReviewDefectSummaryV1, PdfReviewOverrideSummaryV1 } from './contracts';
import type { RegionAuthorityInput } from './buildRegionReviewModel';
import type { PageAuthorityInput } from './buildPageReviewModel';
import type { DocumentAuthorityInput } from './buildDocumentReviewModel';

export function hardDefect(code: string, over: Partial<PdfReviewDefectSummaryV1> = {}): PdfReviewDefectSummaryV1 {
  return {
    code,
    severity: 'hard',
    scope: 'region',
    pageNumber: null,
    regionId: null,
    overlayId: null,
    measuredValue: null,
    threshold: null,
    explanation: `Hard defect ${code}`,
    sourceContract: 'critical-quality-defects-v1',
    resolved: false,
    ...over,
  };
}

export function forceNativeOverride(over: Partial<PdfReviewOverrideSummaryV1> = {}): PdfReviewOverrideSummaryV1 {
  return {
    overrideId: 'ovr-force-native-1',
    kind: 'force-native',
    actorLabel: 'operator',
    createdAt: '2026-07-24T00:00:00.000Z',
    reason: 'Operator accepted residual defect',
    acknowledgesHardDefects: true,
    ...over,
  };
}

// ── Region fixtures ──────────────────────────────────────────────────────────

export function nativeTextRegion(id = 'r-text-1', pageNumber = 1): RegionAuthorityInput {
  return {
    regionId: id, pageNumber, regionType: 'text', strategy: 'native',
    editable: true, cropAvailable: true, sourceEvidenceComplete: true, score: 0.97,
    bbox: { x: 40, y: 60, width: 400, height: 30 },
  };
}

export function chartCropRegion(id = 'r-chart-1', pageNumber = 3): RegionAuthorityInput {
  return {
    regionId: id, pageNumber, regionType: 'chart', strategy: 'source-crop',
    editable: false, cropAvailable: true, cropRole: 'final-output', sourceEvidenceComplete: true,
    score: 0.9, suppressedOverlayCount: 4,
    chart: {
      chartType: 'bar', detectionScore: 0.92, renderMode: 'source-crop',
      axisLabelCount: 6, legendLabelCount: 3, numericLabelCount: 12, suppressedChildCount: 4,
      representationCount: 1, metadataOrigin: 'source',
    },
    bbox: { x: 30, y: 120, width: 500, height: 300 },
  };
}

export function tableCropRegion(id = 'r-table-1', pageNumber = 2): RegionAuthorityInput {
  return {
    regionId: id, pageNumber, regionType: 'table', strategy: 'source-crop',
    editable: false, cropAvailable: true, sourceEvidenceComplete: true, score: 0.84,
    hardDefects: [hardDefect('table_row_clipped', { scope: 'region', regionId: id, pageNumber, measuredValue: 0.6, threshold: 0.9, explanation: 'A table row is clipped at the page edge.' })],
    table: {
      sourceRows: 12, sourceColumns: 5, selectedCandidateIdPrefix: 'cand-abc123…', candidateProfile: 'accurate_table',
      arbitrationState: 'source-crop-fallback', integrityScore: 0.6, headerAgreement: 0.9, rowCoverage: 0.83,
      columnCoverage: 1, numericTokenRecall: 0.88, numericCellAssociation: 0.7, spanAgreement: 1,
      overflowOrClipping: true, genericHeaderDefect: false, sourceCropAvailable: true, finalRenderMode: 'source-crop',
    },
    bbox: { x: 30, y: 400, width: 520, height: 260 },
  };
}

export function typographyCropRegion(id = 'r-typo-1', pageNumber = 4): RegionAuthorityInput {
  return {
    regionId: id, pageNumber, regionType: 'text', strategy: 'source-crop',
    editable: false, cropAvailable: true, sourceEvidenceComplete: true, score: 0.7,
    hardDefects: [hardDefect('range_separator_missing', { scope: 'run', regionId: id, pageNumber, explanation: 'A numeric range separator was lost.' })],
    typography: {
      sourceFontIdentity: 'EmbeddedSerif', normalizedFamily: 'serif', subset: true, selectedFont: 'source-text-crop',
      resolutionState: 'text-crop', glyphCoverage: 0.72, rawUnicodeIntegrity: 0.8, punctuationRecall: 0.5,
      numericTokenRecall: 0.9, lineCountAgreement: 1, clipping: false, baselineDrift: 0.02, exportParity: 0.95,
      sourceTextCropAvailable: true,
    },
    bbox: { x: 40, y: 700, width: 460, height: 40 },
  };
}

// ── Page fixtures ────────────────────────────────────────────────────────────

export function nativePage(pageNumber = 1): PageAuthorityInput {
  return {
    pageId: `p${pageNumber}`, pageNumber, complexityClass: 'native_simple',
    serviceClass: 'fast_cpu', targetState: 'runtime-proven', pageOutputStrategy: 'native',
    renderPlanHash: `plan-hash-${pageNumber}00000`, score: 0.96, metricCoverage: 1,
    sourceFidelityScore: 0.95, finalOutputScore: 0.96, exportScore: 0.96,
    recommendedAction: 'accept-native', approved: false, manualReviewRequired: false,
    artifacts: { source: true, browserFinal: true, exportFinal: true, diff: true },
    cacheReplayed: false, cacheArtifactComplete: true,
    regions: [nativeTextRegion(`r-text-${pageNumber}`, pageNumber)],
  };
}

export function mixedChartPage(pageNumber = 3): PageAuthorityInput {
  return {
    pageId: `p${pageNumber}`, pageNumber, complexityClass: 'design_heavy',
    serviceClass: 'heavy_cpu_au', targetState: 'runtime-proven', pageOutputStrategy: 'mixed',
    renderPlanHash: `plan-hash-${pageNumber}00000`, score: 0.88, metricCoverage: 0.9,
    sourceFidelityScore: 0.9, finalOutputScore: 0.88, exportScore: 0.87,
    recommendedAction: 'accept-mixed', manualReviewRequired: true,
    artifacts: { source: true, browserFinal: true, exportFinal: true, diff: true, foregroundSource: true, edgeSource: true },
    regions: [nativeTextRegion(`r-text-${pageNumber}`, pageNumber), chartCropRegion(`r-chart-${pageNumber}`, pageNumber)],
  };
}

export function rasterOnlyPage(pageNumber = 6): PageAuthorityInput {
  return {
    pageId: `p${pageNumber}`, pageNumber, complexityClass: 'unreadable',
    serviceClass: 'raster_only', targetState: 'runtime-proven', pageOutputStrategy: 'raster-only',
    pageRaster: true, renderPlanHash: `plan-hash-${pageNumber}00000`, score: null, metricCoverage: 0.3,
    recommendedAction: 'accept-page-raster', manualReviewRequired: true,
    artifacts: { source: true, browserFinal: true, exportFinal: true },
    regions: [],
  };
}

export function blockedPage(pageNumber = 7): PageAuthorityInput {
  return {
    pageId: `p${pageNumber}`, pageNumber, complexityClass: 'design_heavy',
    serviceClass: 'heavy_cpu_au', pageOutputStrategy: 'blocked',
    score: 0.3, metricCoverage: 0.5, recommendedAction: 'block-finalization', manualReviewRequired: true,
    defects: [hardDefect('chart_region_missing', { scope: 'page', pageNumber, explanation: 'A required chart region is missing from the output.' })],
    artifacts: { source: true },
    regions: [],
  };
}

// ── Document fixtures ────────────────────────────────────────────────────────

export function nativeAcceptedDocument(): DocumentAuthorityInput {
  const pages = [nativePage(1), nativePage(2), nativePage(3)];
  return {
    importId: 'imp-native-1', templateId: 'tpl-1', jobId: 'job-1',
    source: { displayName: 'native.pdf', pageCount: 3, byteSize: 400000, sourceHash: 'abcdef0123456789' },
    lifecycle: { status: 'succeeded', createdAt: '2026-07-24T00:00:00Z', completedAt: '2026-07-24T00:01:00Z', durationMs: 60000, chunked: false, chunkCount: 1 },
    plan: { version: 'pdf-extraction-plan-v3', planId: 'plan3-99e3a652', planStage: 'finalized', documentComplexity: 'low', planComplete: true, shadowMode: true },
    routing: { serviceClasses: ['fast_cpu'], remotePageCount: 0, remoteRegionCount: 0, policyState: 'local-only' },
    quality: { qualityVersion: 'visual-quality-report-v2', documentScore: 0.96, minimumPageScore: 0.95, hardDefectCount: 0, pagesWithHardDefects: 0, pagesUnscored: 0, coverage: 'complete', browserExportParity: 0.98 },
    extraction: { sourceSceneComplete: true, providerAttemptCount: 0, repairAttemptCount: 0, artifactCompleteness: true },
    cache: { lookupState: 'miss', hit: false, namespace: 'pdf-cache-fingerprint-v3', complete: null, cacheable: true },
    costPerformance: { totalProviderElapsedMs: 0, totalExecutionMs: 60000, estimatedCostAmount: 0, estimatedCostCurrency: 'USD', estimateState: 'known' },
    finalDecision: 'native',
    pages,
  };
}

export function mixedReviewDocument(): DocumentAuthorityInput {
  const pages = [nativePage(1), tablePage(2), mixedChartPage(3), typographyPage(4), nativePage(5), rasterOnlyPage(6), blockedPage(7)];
  return {
    importId: 'imp-mixed-1', templateId: 'tpl-2', jobId: 'job-2',
    source: { displayName: 'mixed.pdf', pageCount: 7, byteSize: 2500000, sourceHash: '0123456789abcdef' },
    lifecycle: { status: 'succeeded', createdAt: '2026-07-24T00:00:00Z', completedAt: '2026-07-24T00:03:00Z', durationMs: 180000, chunked: true, chunkCount: 3 },
    plan: { version: 'pdf-extraction-plan-v3', planId: 'plan3-abc12345', planStage: 'finalized', documentComplexity: 'high', planComplete: true, shadowMode: true },
    routing: { serviceClasses: ['fast_cpu', 'heavy_cpu_au', 'raster_only'], remotePageCount: 0, remoteRegionCount: 0, policyState: 'local-only' },
    quality: { qualityVersion: 'visual-quality-report-v2', documentScore: 0.82, minimumPageScore: 0.3, hardDefectCount: 3, pagesWithHardDefects: 3, pagesUnscored: 1, coverage: 'partial', browserExportParity: 0.9 },
    extraction: { sourceSceneComplete: true, providerAttemptCount: 1, repairAttemptCount: 2, artifactCompleteness: false },
    cache: { lookupState: 'miss', hit: false, namespace: 'pdf-cache-fingerprint-v3', complete: null, cacheable: true },
    costPerformance: { totalProviderElapsedMs: 4200, totalExecutionMs: 180000, estimatedCostAmount: null, estimatedCostCurrency: null, estimateState: 'unknown' },
    finalDecision: 'mixed-review',
    pages,
  };
}

export function tablePage(pageNumber = 2): PageAuthorityInput {
  return {
    pageId: `p${pageNumber}`, pageNumber, complexityClass: 'native_rich',
    serviceClass: 'heavy_cpu_au', targetState: 'runtime-proven', pageOutputStrategy: 'mixed',
    renderPlanHash: `plan-hash-${pageNumber}00000`, score: 0.84, metricCoverage: 0.9,
    sourceFidelityScore: 0.88, finalOutputScore: 0.84, exportScore: 0.83,
    recommendedAction: 'accept-mixed-with-review', manualReviewRequired: true,
    defects: [hardDefect('table_row_clipped', { scope: 'region', regionId: 'r-table-2', pageNumber })],
    artifacts: { source: true, browserFinal: true, exportFinal: true, diff: true },
    providerAttempts: [{
      providerId: 'docling-standard-vnext', executionMode: 'local', purpose: 'table-extraction', status: 'succeeded',
      remote: false, policyBlocked: false, pageNumbers: [pageNumber], regionCount: 1,
      configurationIdPrefix: 'pcfg-c3d8…', requestIdPrefix: 'preq-7f61…', attemptIdPrefix: 'patt-0001…',
      elapsedMs: 1200, estimatedCostAmount: null, estimatedCostState: 'not-applicable',
      privacyClass: 'confidential', residencyClass: 'local-only', remoteApproved: null, sourceAgreement: 'agree',
    }],
    repair: { passes: 1, candidateCount: 3, selectedCandidateId: 'cand-abc123def456', resolvedDefectCount: 1, introducedHardDefectCount: 0 },
    regions: [tableCropRegion(`r-table-${pageNumber}`, pageNumber)],
  };
}

export function typographyPage(pageNumber = 4): PageAuthorityInput {
  return {
    pageId: `p${pageNumber}`, pageNumber, complexityClass: 'native_rich',
    serviceClass: 'heavy_cpu_au', pageOutputStrategy: 'mixed',
    renderPlanHash: `plan-hash-${pageNumber}00000`, score: 0.7, metricCoverage: 0.85,
    sourceFidelityScore: 0.8, finalOutputScore: 0.7, exportScore: 0.95,
    recommendedAction: 'accept-mixed-with-review', manualReviewRequired: true,
    defects: [hardDefect('range_separator_missing', { scope: 'run', regionId: 'r-typo-4', pageNumber })],
    artifacts: { source: true, browserFinal: true, exportFinal: true, diff: true },
    regions: [typographyCropRegion(`r-typo-${pageNumber}`, pageNumber)],
  };
}

export function legacyV2Document(): DocumentAuthorityInput {
  return {
    importId: 'imp-legacy-v2', templateId: 'tpl-legacy', jobId: 'job-legacy',
    source: { displayName: 'legacy.pdf', pageCount: 2, byteSize: 100000, sourceHash: 'deadbeef' },
    lifecycle: { status: 'succeeded', createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:30Z', durationMs: 30000, chunked: false, chunkCount: 1 },
    plan: null,
    routing: null,
    quality: { qualityVersion: 'visual-quality-report-v1', documentScore: 0.7, minimumPageScore: 0.6, hardDefectCount: 0, pagesWithHardDefects: 0, pagesUnscored: 0, coverage: 'complete', browserExportParity: null },
    extraction: { sourceSceneComplete: null, providerAttemptCount: 0, repairAttemptCount: 0, artifactCompleteness: null },
    cache: null,
    costPerformance: null,
    finalDecision: 'native',
    legacyState: 'legacy-v2',
    pages: [
      { pageId: 'p1', pageNumber: 1, pageOutputStrategy: 'native', score: 0.7, artifacts: { source: true, browserFinal: true }, regions: [] },
      { pageId: 'p2', pageNumber: 2, pageOutputStrategy: 'native', score: 0.65, artifacts: { source: true, browserFinal: true }, regions: [] },
    ],
  };
}

/** A large N-page document for virtualization/perf fixtures. */
export function largeDocument(pageCount: number): DocumentAuthorityInput {
  const pages: PageAuthorityInput[] = [];
  for (let i = 1; i <= pageCount; i += 1) {
    if (i % 7 === 0) pages.push(blockedPage(i));
    else if (i % 5 === 0) pages.push(rasterOnlyPage(i));
    else if (i % 3 === 0) pages.push(mixedChartPage(i));
    else if (i % 2 === 0) pages.push(tablePage(i));
    else pages.push(nativePage(i));
  }
  return {
    importId: `imp-large-${pageCount}`, templateId: 'tpl-large', jobId: 'job-large',
    source: { displayName: `large-${pageCount}.pdf`, pageCount, byteSize: pageCount * 200000, sourceHash: 'cafebabe1234' },
    lifecycle: { status: 'succeeded', createdAt: '2026-07-24T00:00:00Z', completedAt: '2026-07-24T00:10:00Z', durationMs: 600000, chunked: true, chunkCount: Math.ceil(pageCount / 4) },
    plan: { version: 'pdf-extraction-plan-v3', planId: 'plan3-large000', planStage: 'finalized', documentComplexity: 'high', planComplete: true, shadowMode: true },
    routing: { serviceClasses: ['fast_cpu', 'heavy_cpu_au', 'raster_only'], remotePageCount: 0, remoteRegionCount: 0, policyState: 'local-only' },
    quality: { qualityVersion: 'visual-quality-report-v2', documentScore: 0.85, minimumPageScore: null, hardDefectCount: Math.floor(pageCount / 7), pagesWithHardDefects: Math.floor(pageCount / 7), pagesUnscored: Math.floor(pageCount / 5), coverage: 'partial', browserExportParity: 0.9 },
    extraction: { sourceSceneComplete: true, providerAttemptCount: 0, repairAttemptCount: Math.floor(pageCount / 2), artifactCompleteness: true },
    cache: { lookupState: 'miss', hit: false, namespace: 'pdf-cache-fingerprint-v3', complete: null, cacheable: true },
    costPerformance: { totalProviderElapsedMs: 0, totalExecutionMs: 600000, estimatedCostAmount: 0, estimatedCostCurrency: 'USD', estimateState: 'known' },
    finalDecision: 'mixed-review',
    pages,
  };
}
