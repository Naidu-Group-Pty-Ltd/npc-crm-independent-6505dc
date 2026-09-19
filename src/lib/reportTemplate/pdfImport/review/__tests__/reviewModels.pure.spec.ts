/**
 * E11 — pure review view-model specs.
 *
 * Proves the authority-consuming discipline: models are built FROM upstream
 * decisions (E6 strategy, E7 quality, E8 repair, E9 provider, E10 route/cache),
 * never rederived; `null` stays `null` (never `0`); fidelity / final-output /
 * editability stay separate; provider confidence is never quality; legacy V1/V2
 * maps safely; inputs are never mutated; and no signed URL / raw buffer / private
 * path can enter a persisted model.
 */
import { describe, it, expect } from 'vitest';
import {
  PDF_DOCUMENT_REVIEW_MODEL_VERSION,
  PDF_PAGE_REVIEW_MODEL_VERSION,
  PDF_REGION_REVIEW_MODEL_VERSION,
  PDF_REVIEW_ACTION_VERSION,
  PDF_REVIEW_ACTION_RESULT_VERSION,
  PDF_ARTIFACT_VIEWER_MODEL_VERSION,
  PDF_DIAGNOSTICS_VIEW_MODEL_VERSION,
  PDF_REVIEW_WORKSPACE_VERSION,
  buildRegionReviewModel,
  buildPageReviewModel,
  toPageSummary,
  buildDocumentReviewModel,
  buildDiagnosticsSummary,
  buildReviewAction,
  guardHighRiskAction,
  keepsGateFailed,
  validateArtifactSelection,
  availableArtifactKinds,
  buildArtifactViewerModel,
  artifactPrefetchWindow,
  deriveReviewCapabilities,
  canAccessAdminDiagnostics,
  validatePersistableModel,
  isPersistableModel,
} from '../index';
import {
  nativeAcceptedDocument,
  mixedReviewDocument,
  legacyV2Document,
  largeDocument,
  chartCropRegion,
  tableCropRegion,
  hardDefect,
  forceNativeOverride,
} from '../fixtures';

describe('E11 version constants', () => {
  it('are exact', () => {
    expect(PDF_REVIEW_WORKSPACE_VERSION).toBe('pdf-review-workspace-v1');
    expect(PDF_DIAGNOSTICS_VIEW_MODEL_VERSION).toBe('pdf-diagnostics-view-model-v1');
    expect(PDF_DOCUMENT_REVIEW_MODEL_VERSION).toBe('pdf-document-review-model-v1');
    expect(PDF_PAGE_REVIEW_MODEL_VERSION).toBe('pdf-page-review-model-v1');
    expect(PDF_REGION_REVIEW_MODEL_VERSION).toBe('pdf-region-review-model-v1');
    expect(PDF_REVIEW_ACTION_VERSION).toBe('pdf-review-action-v1');
    expect(PDF_REVIEW_ACTION_RESULT_VERSION).toBe('pdf-review-action-result-v1');
    expect(PDF_ARTIFACT_VIEWER_MODEL_VERSION).toBe('pdf-artifact-viewer-model-v1');
  });
});

describe('region review model (E6/E7/E3/E4/E5 authority)', () => {
  it('projects chart-crop strategy from E6, not from image existence', () => {
    const m = buildRegionReviewModel(chartCropRegion());
    expect(m.output.strategy).toBe('source-crop');
    expect(m.output.editable).toBe(false);
    expect(m.chart?.metadataOrigin).toBe('source');
    // crop force is unavailable when already a crop; native force is offered for chart
    expect(m.capabilities.canForceCrop).toBe(false);
    expect(m.capabilities.canInspectStructuredData).toBe(true);
  });
  it('keeps hard defects and does not invent a score', () => {
    const m = buildRegionReviewModel(tableCropRegion());
    expect(m.quality.hardDefects.map((d) => d.code)).toContain('table_row_clipped');
    expect(m.table?.integrityScore).toBe(0.6);
    // an unset foreground recall stays null, never 0
    expect(m.quality.foregroundRecall).toBeNull();
  });
  it('does not mutate its input', () => {
    const input = tableCropRegion();
    const snapshot = JSON.stringify(input);
    buildRegionReviewModel(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('page review model (E10/E6/E7/E8/E9 authority)', () => {
  it('separates fidelity, final-output and export scores', () => {
    const doc = mixedReviewDocument();
    const page = buildPageReviewModel(doc.pages[1]); // table page
    expect(page.quality.sourceFidelityScore).toBe(0.88);
    expect(page.quality.finalOutputScore).toBe(0.84);
    expect(page.quality.exportScore).toBe(0.83);
    // three distinct values — never collapsed
    expect(new Set([page.quality.sourceFidelityScore, page.quality.finalOutputScore, page.quality.exportScore]).size).toBe(3);
  });
  it('derives editability from authoritative region strategies, not similarity', () => {
    const doc = mixedReviewDocument();
    const chartPage = buildPageReviewModel(doc.pages[2]); // native text + chart crop
    // one editable native region, one locked crop => 50% editable
    expect(chartPage.editability.percentage).toBeCloseTo(0.5, 5);
    expect(chartPage.editability.lockedCropCount).toBe(1);
  });
  it('raster-only page has 0% editability but null score stays null', () => {
    const doc = mixedReviewDocument();
    const raster = buildPageReviewModel(doc.pages[5]);
    expect(raster.output.pageStrategy).toBe('raster-only');
    expect(raster.editability.percentage).toBe(0);
    expect(raster.quality.score).toBeNull(); // unscored, not zero
  });
  it('projects provider attempts + repair from E9/E8 authority', () => {
    const page = buildPageReviewModel(mixedReviewDocument().pages[1]);
    expect(page.providerAttempts[0].providerId).toBe('docling-standard-vnext');
    expect(page.repair.selectedCandidateIdPrefix).toBe('cand-abc123d…');
    expect(page.repair.passes).toBe(1);
  });
});

describe('document review model (aggregate authority)', () => {
  it('builds a v3-complete native document with separate axes', () => {
    const doc = buildDocumentReviewModel(nativeAcceptedDocument());
    expect(doc.legacyState).toBe('v3-complete');
    expect(doc.output.nativePageCount).toBe(3);
    expect(doc.quality.hardDefectCount).toBe(0);
    expect(doc.quality.documentScore).toBe(0.96);
    expect(doc.editability.editablePageRatio).toBe(1);
    // cost/perf is its own axis
    expect(doc.costPerformance.estimateState).toBe('known');
  });
  it('a blocked/hard-defect document is never presented as success', () => {
    const doc = buildDocumentReviewModel(mixedReviewDocument());
    expect(doc.quality.hardDefectCount).toBe(3);
    expect(doc.review.manualReviewRequired).toBe(true);
    expect(doc.output.blockedPageCount).toBe(1);
    expect(doc.output.rasterPageCount).toBe(1);
    // fidelity and editability are distinct numbers
    expect(doc.quality.documentScore).not.toBe(doc.editability.editablePageRatio);
  });
  it('unknown cost stays unknown, not zero', () => {
    const doc = buildDocumentReviewModel(mixedReviewDocument());
    expect(doc.costPerformance.estimatedCostAmount).toBeNull();
    expect(doc.costPerformance.estimateState).toBe('unknown');
  });
});

describe('legacy support', () => {
  it('maps a legacy V2 import without inventing V3 data', () => {
    const doc = buildDocumentReviewModel(legacyV2Document());
    expect(doc.legacyState).toBe('legacy-v2');
    expect(doc.plan.version).toBeNull();
    expect(doc.plan.planIdPrefix).toBeNull();
    expect(doc.quality.browserExportParity).toBeNull(); // not recorded, not 0
    expect(doc.extraction.artifactCompleteness).toBeNull();
  });
});

describe('diagnostics summary', () => {
  it('derives a bounded privacy-safe row from the document model', () => {
    const doc = buildDocumentReviewModel(mixedReviewDocument());
    const row = buildDiagnosticsSummary(doc);
    expect(row.version).toBe('pdf-diagnostics-view-model-v1');
    expect(row.hardDefectCount).toBe(3);
    expect(row.serviceClassSummary).toContain('heavy_cpu_au');
    // no private text anywhere in the row
    expect(JSON.stringify(row)).not.toMatch(/https?:\/\//);
  });
});

describe('review actions (server-authorized, no client actor id)', () => {
  it('never carries an actor id', () => {
    const a = buildReviewAction({ importId: 'imp-1', action: 'accept-automatic', clientRequestId: 'req-1' });
    expect(JSON.stringify(a)).not.toMatch(/actorId|actor_id|userId/i);
    expect(a.version).toBe('pdf-review-action-v1');
  });
  it('force-native requires hard-defect acknowledgement and a reason', () => {
    const a = buildReviewAction({ importId: 'imp-1', action: 'force-native', clientRequestId: 'req-2' });
    expect(a.problems).toContain('force_native_requires_hard_defect_acknowledgement');
    expect(a.problems).toContain('force_native_requires_reason');
    const ok = buildReviewAction({ importId: 'imp-1', action: 'force-native', hardDefectsAcknowledged: true, reason: 'accepted', clientRequestId: 'req-3' });
    expect(ok.problems).toEqual([]);
  });
  it('provider recovery requires a server-issued option id (never a raw provider)', () => {
    const a = buildReviewAction({ importId: 'imp-1', action: 'request-provider-recovery', clientRequestId: 'req-4' });
    expect(a.problems).toContain('provider_recovery_requires_option_id');
  });
  it('force-native over unresolved hard defects keeps the gate FAILED', () => {
    expect(keepsGateFailed('force-native', true)).toBe(true);
    expect(keepsGateFailed('accept-automatic', true)).toBe(false);
  });
  it('high-risk guard blocks unsafe force actions', () => {
    expect(guardHighRiskAction('force-source-crop', { hasUnresolvedHardDefects: false, cropAvailable: false, sourceRasterAvailable: false, hardDefectsAcknowledged: false, reasonProvided: false })).toBe('crop_unavailable');
    expect(guardHighRiskAction('force-page-raster', { hasUnresolvedHardDefects: false, cropAvailable: false, sourceRasterAvailable: false, hardDefectsAcknowledged: false, reasonProvided: false })).toBe('source_raster_unavailable');
    expect(guardHighRiskAction('force-native', { hasUnresolvedHardDefects: true, cropAvailable: false, sourceRasterAvailable: false, hardDefectsAcknowledged: false, reasonProvided: false })).toBe('unacknowledged_hard_defects');
    expect(guardHighRiskAction('force-source-crop', { hasUnresolvedHardDefects: false, cropAvailable: true, sourceRasterAvailable: false, hardDefectsAcknowledged: false, reasonProvided: false })).toBeNull();
  });
  it('sanitizes and bounds the reason', () => {
    const a = buildReviewAction({ importId: 'imp-1', action: 'add-review-note', reason: 'x'.repeat(9999), clientRequestId: 'req-5' });
    expect((a.reason ?? '').length).toBeLessThanOrEqual(500);
  });
});

describe('artifact selection (no arbitrary paths)', () => {
  it('rejects paths, traversal and URLs in region id', () => {
    expect(validateArtifactSelection({ importId: 'imp-1', pageNumber: 1, kind: 'source', regionId: 'r-1' })).toEqual([]);
    expect(validateArtifactSelection({ importId: 'imp-1', pageNumber: 1, kind: 'source', regionId: 'a/b' })).toContain('invalid_region_id');
    expect(validateArtifactSelection({ importId: 'imp-1', pageNumber: 1, kind: 'source', regionId: '../secret' })).toContain('invalid_region_id');
    expect(validateArtifactSelection({ importId: 'imp-1', pageNumber: 1, kind: 'source', regionId: 'https://x/y' })).toContain('invalid_region_id');
    expect(validateArtifactSelection({ importId: 'imp-1', pageNumber: 0, kind: 'source', regionId: null })).toContain('invalid_page_number');
    expect(validateArtifactSelection({ importId: 'imp-1', pageNumber: 1, kind: 'nope' as never, regionId: null })).toContain('invalid_artifact_kind');
  });
  it('final-output mode hides debug layers', () => {
    const avail = { source: true, browserFinal: true, exportFinal: true, diff: true, foregroundSource: true, foregroundOutput: false, edgeSource: true, edgeOutput: false, regionSource: false, regionOutput: false };
    const all = availableArtifactKinds(avail);
    const final = availableArtifactKinds(avail, { finalOutputMode: true });
    expect(all).toContain('foreground-source');
    expect(final).not.toContain('foreground-source');
    expect(final).toContain('source');
  });
  it('viewer model never stores a URL; prefetch window is bounded', () => {
    const vm = buildArtifactViewerModel({ pageNumber: 3, availableKinds: ['source'], selectedKind: 'source', assetState: 'ready', widthPx: 800, heightPx: 1000, expiresAt: '2026-07-24T00:00:00Z' });
    expect(JSON.stringify(vm)).not.toMatch(/https?:\/\/|blob:|data:/);
    expect(artifactPrefetchWindow(5, 80, 1)).toEqual([4, 5, 6]);
    expect(artifactPrefetchWindow(1, 80, 1)).toEqual([1, 2]);
  });
});

describe('permissions (UI capability derivation only)', () => {
  const operator = { authenticated: true, ownsImport: true, isStaff: true, isOperator: true, isAdmin: false, manualRepairConfigured: false };
  it('legacy imports never expose V3 operator actions', () => {
    const caps = deriveReviewCapabilities(operator, 'legacy-v2');
    expect(caps.canForceNative).toBe(false);
    expect(caps.canReview).toBe(true);
  });
  it('v3 operator gets force actions but manual repair only when configured', () => {
    const caps = deriveReviewCapabilities(operator, 'v3-complete');
    expect(caps.canForceNative).toBe(true);
    expect(caps.canManualRepair).toBe(false);
    const caps2 = deriveReviewCapabilities({ ...operator, manualRepairConfigured: true }, 'v3-complete');
    expect(caps2.canManualRepair).toBe(true);
  });
  it('admin diagnostics require server-verified admin', () => {
    expect(canAccessAdminDiagnostics(operator)).toBe(false);
    expect(canAccessAdminDiagnostics({ ...operator, isAdmin: true })).toBe(true);
  });
});

describe('persistable-model validators (no leaks)', () => {
  it('the built models are persistable (no signed URLs / buffers / paths)', () => {
    const doc = buildDocumentReviewModel(mixedReviewDocument());
    expect(isPersistableModel(doc)).toBe(true);
    for (const p of mixedReviewDocument().pages) expect(isPersistableModel(buildPageReviewModel(p))).toBe(true);
  });
  it('rejects a signed URL, a raw buffer and a private artifact path', () => {
    expect(validatePersistableModel({ x: 'https://signed/x.png' })).toContain('signed_url_in_model');
    expect(validatePersistableModel({ b: new Uint8Array([1, 2]) })).toContain('raw_buffer_in_model');
    expect(validatePersistableModel({ p: 'job/abc/pages/page-001/raster.png' })).toContain('private_path_in_model');
    expect(validatePersistableModel({ n: Number.POSITIVE_INFINITY })).toContain('non_finite_number');
  });
});

describe('large-document virtualization inputs', () => {
  it('builds 25-page and 80-page documents with compact page summaries', () => {
    for (const n of [25, 80]) {
      const doc = buildDocumentReviewModel(largeDocument(n));
      expect(doc.pageSummaries.length).toBe(n);
      // summaries are compact — no regions array, no defects list
      expect(doc.pageSummaries[0]).not.toHaveProperty('regions');
      expect(doc.pageSummaries.every((s) => typeof s.pageNumber === 'number')).toBe(true);
    }
  });
  it('page summary carries navigator fields (strategy, defects, review)', () => {
    const doc = buildDocumentReviewModel(mixedReviewDocument());
    const blocked = doc.pageSummaries.find((s) => s.pageStrategy === 'blocked');
    expect(blocked).toBeTruthy();
    expect(blocked?.hardDefectCount).toBeGreaterThan(0);
  });
});

describe('provider confidence is never final quality', () => {
  it('region provider evidence keeps confidence distinct from quality score', () => {
    const region = buildRegionReviewModel({
      regionId: 'r-1', pageNumber: 1, regionType: 'table', strategy: 'native', score: 0.6,
      providers: [{ providerId: 'google-document-ai-layout', sourceAgreement: 'agree', providerConfidence: 0.99, remote: true }],
    });
    // the region quality score is authoritative (0.6); provider confidence (0.99) is separate
    expect(region.quality.score).toBe(0.6);
    expect(region.providers[0].providerConfidence).toBe(0.99);
    expect(region.quality.score).not.toBe(region.providers[0].providerConfidence);
  });
});
