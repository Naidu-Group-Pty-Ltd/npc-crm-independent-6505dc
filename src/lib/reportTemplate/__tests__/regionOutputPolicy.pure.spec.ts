/**
 * E6 — Unified Region Output Policy & Composition (canonical shared module) specs.
 *
 * Verifies the core invariant (every source region renders 0 or 1 times; every
 * critical region in accepted output renders exactly once), the E3/E4/E5 adapters,
 * the ownership graph + precedence, the render plan + suppression composition,
 * export preflight, operator overrides, policy hashing, and the E0/E3/E4/E5
 * interoperability — all deterministic, JSON-safe, no signed URLs.
 */
import { describe, it, expect } from 'vitest';
import {
  PDF_REGION_OUTPUT_POLICY_VERSION,
  PDF_REGION_RENDER_PLAN_VERSION,
  PDF_REGION_OWNERSHIP_VERSION,
  validateRegionPolicy,
  adaptChartPlanToRegionPolicy,
  adaptTablePlanToRegionPolicy,
  adaptTypographyPlanToRegionPolicy,
  genericRegionPolicy,
  buildRegionOwnershipGraph,
  resolvePdfRegionRenderPlan,
  hashRenderPlan,
  buildExportPreflight,
  validateOperatorOverride,
  applyOperatorOverride,
  buildRegionCompositionReport,
  type PdfImportRegionPolicyV1,
  type RegionGeometry,
  type PdfRegionOperatorOverrideV1,
} from '../pdfImport/regionOutputPolicy.pure';
import {
  buildPageRegionPolicies,
  resolveHydratedPageComposition,
  mapOverlaysToRegions,
} from '../pdfImport/regionOutputPolicyIntegration';
import type { SourceBBox } from '../pdfImport/sourceSceneGraphV2.pure';

const PAGE = 'docling-page-1';
const bb = (x: number, y: number, w: number, h: number): SourceBBox => ({ x, y, width: w, height: h });

// ── Plan fixtures ─────────────────────────────────────────────────────────────

function chartPlan(id: string, mode: 'chart-crop' | 'containment-fallback', bbox: SourceBBox, children: string[] = []) {
  return { regionId: id, pageNumber: 1, bbox, renderMode: mode, hasCrop: mode === 'chart-crop', cropBlank: false,
    cropPath: mode === 'chart-crop' ? `job/${id}.png` : null, cropSha256: mode === 'chart-crop' ? 'a'.repeat(64) : null,
    cropDpi: 300, childRegionIds: children, suppressedChildRegionIds: mode === 'chart-crop' ? children : [],
    orphanSuppressedRegionIds: [], chartType: 'bar', detectionMethod: 'classification' as const, detectionScore: 0.6, complete: mode === 'chart-crop' };
}
function tablePlan(id: string, mode: 'verified-native-table' | 'table-source-crop' | 'containment-fallback' | 'blocked', defects: string[] = []) {
  return { version: 'table-preservation-v1' as const, regionId: id, pageNumber: 1, renderMode: mode,
    selectedCandidateId: mode === 'verified-native-table' ? 'cand-1' : null,
    sourceCropPath: mode === 'table-source-crop' || mode === 'verified-native-table' ? `job/${id}.png` : null,
    suppressRegionIds: [], suppressOverlayIds: [], integrityState: mode === 'verified-native-table' ? 'verified' : 'rejected',
    integrityScore: null, hardDefectCodes: defects, manualReviewRequired: mode === 'table-source-crop' || mode === 'blocked', reason: 'x' };
}
function typoPlan(id: string, mode: 'verified-native-text' | 'source-text-crop' | 'containment-fallback' | 'blocked', overlayId = 'ov-txt') {
  return { version: 'typography-preservation-v1' as const, sourceRunId: id, pageNumber: 1, renderMode: mode,
    candidateOverlayId: overlayId, sourceCropPath: mode === 'source-text-crop' ? `job/${id}.png` : null,
    resolvedFontAssetId: 'fa-1', fontResolutionState: 'exact' as const, suppressOverlayIds: [],
    fidelityState: mode === 'verified-native-text' ? 'verified' : 'rejected', fidelityScore: null,
    hardDefectCodes: [], manualReviewRequired: mode === 'source-text-crop' || mode === 'blocked', reason: 'x' };
}

// ── A. Versions + validation ──────────────────────────────────────────────────

describe('versions + validation', () => {
  it('version constants are exact', () => {
    expect(PDF_REGION_OUTPUT_POLICY_VERSION).toBe('pdf-region-output-policy-v1');
    expect(PDF_REGION_RENDER_PLAN_VERSION).toBe('pdf-region-render-plan-v1');
    expect(PDF_REGION_OWNERSHIP_VERSION).toBe('pdf-region-ownership-v1');
  });
  it('rejects a persisted signed URL in a policy', () => {
    const p = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
    (p.sourceCropRef as { artifactPath: string }).artifactPath = 'https://signed.example/x.png';
    expect(validateRegionPolicy(p)).toContain('signed_url_persisted');
  });
  it('rejects an unknown strategy', () => {
    const p = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
    (p as { strategy: string }).strategy = 'weird';
    expect(validateRegionPolicy(p)).toContain('unknown_region_strategy');
  });
});

// ── B. Adapters ───────────────────────────────────────────────────────────────

describe('E3/E4/E5 adapters', () => {
  it('E3 chart-crop → source-crop / final-output / hidden native', () => {
    const p = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
    expect(p.strategy).toBe('source-crop');
    expect(p.sourceCropRole).toBe('final-output');
    expect(p.nativeLayerPolicy).toBe('hidden');
    expect(p.selectedEvidence.sourceContract).toBe('e3-chart');
  });
  it('E3 containment-fallback → page-fallback (no false crop)', () => {
    const p = adaptChartPlanToRegionPolicy(chartPlan('c1', 'containment-fallback', bb(40, 100, 200, 150)), PAGE);
    expect(p.resolutionState).toBe('page-fallback');
    expect(p.sourceCropRole).toBe('none');
  });
  it('E4 verified table → native-with-source-reference', () => {
    const p = adaptTablePlanToRegionPolicy(tablePlan('t1', 'verified-native-table'), PAGE, null, bb(40, 300, 400, 120));
    expect(p.strategy).toBe('native-with-source-reference');
    expect(p.sourceCropRole).toBe('editor-reference');
  });
  it('E4 table-source-crop → source-crop', () => {
    const p = adaptTablePlanToRegionPolicy(tablePlan('t1', 'table-source-crop'), PAGE, null, bb(40, 300, 400, 120));
    expect(p.strategy).toBe('source-crop');
    expect(p.sourceCropRole).toBe('final-output');
  });
  it('E4 blocked → blocked (defects preserved exactly)', () => {
    const p = adaptTablePlanToRegionPolicy(tablePlan('t1', 'blocked', ['numeric_token_wrong_cell']), PAGE);
    expect(p.resolutionState).toBe('blocked');
    expect(p.hardDefectCodes).toContain('numeric_token_wrong_cell');
  });
  it('E5 verified text → native-reference; text-crop → source-crop; blocked → blocked', () => {
    expect(adaptTypographyPlanToRegionPolicy(typoPlan('y1', 'verified-native-text'), PAGE).strategy).toBe('native-with-source-reference');
    expect(adaptTypographyPlanToRegionPolicy(typoPlan('y1', 'source-text-crop'), PAGE, bb(40, 50, 200, 16)).strategy).toBe('source-crop');
    expect(adaptTypographyPlanToRegionPolicy(typoPlan('y1', 'blocked'), PAGE).resolutionState).toBe('blocked');
  });
  it('a source-crop with no path records region_source_crop_missing (never native)', () => {
    const p = adaptTablePlanToRegionPolicy({ ...tablePlan('t1', 'table-source-crop'), sourceCropPath: null }, PAGE);
    expect(p.hardDefectCodes).toContain('region_source_crop_missing');
    expect(p.strategy).toBe('source-crop');
  });
});

// ── C. Generic region policy ──────────────────────────────────────────────────

describe('genericRegionPolicy', () => {
  it('a picture with a valid crop → source-crop', () => {
    const p = genericRegionPolicy({ regionId: 'p1', pageId: PAGE, pageNumber: 1, regionType: 'picture', bbox: bb(40, 40, 100, 100), sourceCropPath: 'job/p1.png', sourceCropSha: 'a'.repeat(64), hasValidCrop: true });
    expect(p.strategy).toBe('source-crop');
  });
  it('a critical visual with no crop → page-fallback (never blank native)', () => {
    const p = genericRegionPolicy({ regionId: 'u1', pageId: PAGE, pageNumber: 1, regionType: 'unknown-visual', bbox: bb(40, 40, 100, 100), sourceCropPath: null, sourceCropSha: null, hasValidCrop: false });
    expect(p.resolutionState).toBe('page-fallback');
    expect(p.hardDefectCodes).toContain('region_source_crop_missing');
  });
  it('a native image that IS the exact source → native-source-equivalent (no duplicate crop)', () => {
    const p = genericRegionPolicy({ regionId: 'p2', pageId: PAGE, pageNumber: 1, regionType: 'picture', bbox: bb(40, 40, 100, 100), sourceCropPath: 'job/p2.png', sourceCropSha: null, hasValidCrop: true, nativeImageIsExactSource: true });
    expect(p.strategy).toBe('native-with-source-reference');
    expect(p.decision.action).toBe('native-source-equivalent');
  });
  it('plain text → native, non-critical', () => {
    const p = genericRegionPolicy({ regionId: 'tx', pageId: PAGE, pageNumber: 1, regionType: 'text', bbox: bb(40, 40, 100, 20), sourceCropPath: null, sourceCropSha: null, hasValidCrop: false });
    expect(p.strategy).toBe('native');
    expect(p.isCritical).toBe(false);
  });
});

// ── D. Ownership graph ────────────────────────────────────────────────────────

describe('ownership graph', () => {
  it('nested table → chart ownership: chart suppressed under table crop', () => {
    const table = adaptTablePlanToRegionPolicy(tablePlan('t1', 'table-source-crop'), PAGE, null, bb(40, 100, 500, 300));
    (table.sourceCropRef as { bbox: SourceBBox }).bbox = bb(40, 100, 500, 300);
    const chart = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(60, 120, 200, 150)), PAGE);
    const geo: RegionGeometry[] = [
      { regionId: 't1', parentRegionId: null, childRegionIds: ['c1'], bbox: bb(40, 100, 500, 300), zOrderHint: null },
      { regionId: 'c1', parentRegionId: 't1', childRegionIds: [], bbox: bb(60, 120, 200, 150), zOrderHint: null },
    ];
    const g = buildRegionOwnershipGraph(PAGE, 1, [table, chart], geo);
    expect(g.suppressedRegionIds).toContain('c1');
    expect(g.visibleOwnerRegionIds).toContain('t1');
    expect(g.complete).toBe(true);
  });

  it('a cycle is a hard defect (never broken arbitrarily)', () => {
    const a = adaptChartPlanToRegionPolicy(chartPlan('a', 'chart-crop', bb(0, 0, 10, 10)), PAGE);
    const b = adaptChartPlanToRegionPolicy(chartPlan('b', 'chart-crop', bb(0, 0, 10, 10)), PAGE);
    const geo: RegionGeometry[] = [
      { regionId: 'a', parentRegionId: 'b', childRegionIds: [], bbox: bb(0, 0, 10, 10), zOrderHint: null },
      { regionId: 'b', parentRegionId: 'a', childRegionIds: [], bbox: bb(0, 0, 10, 10), zOrderHint: null },
    ];
    const g = buildRegionOwnershipGraph(PAGE, 1, [a, b], geo);
    expect(g.complete).toBe(false);
    expect(g.ownershipConflicts.some((c) => c.code === 'region_ownership_cycle')).toBe(true);
  });

  it('self-parent is rejected', () => {
    const a = adaptChartPlanToRegionPolicy(chartPlan('a', 'chart-crop', bb(0, 0, 10, 10)), PAGE);
    const g = buildRegionOwnershipGraph(PAGE, 1, [a], [{ regionId: 'a', parentRegionId: 'a', childRegionIds: [], bbox: bb(0, 0, 10, 10), zOrderHint: null }]);
    expect(g.problems.length).toBeGreaterThan(0);
  });

  it('explicit relationship outranks bbox inference; adjacent regions independent', () => {
    const a = adaptChartPlanToRegionPolicy(chartPlan('a', 'chart-crop', bb(40, 40, 100, 100)), PAGE);
    const b = adaptChartPlanToRegionPolicy(chartPlan('b', 'chart-crop', bb(300, 40, 100, 100)), PAGE);
    const g = buildRegionOwnershipGraph(PAGE, 1, [a, b], [
      { regionId: 'a', parentRegionId: null, childRegionIds: [], bbox: bb(40, 40, 100, 100), zOrderHint: null },
      { regionId: 'b', parentRegionId: null, childRegionIds: [], bbox: bb(300, 40, 100, 100), zOrderHint: null },
    ]);
    expect(g.suppressedRegionIds).toEqual([]);
    expect(g.visibleOwnerRegionIds.sort()).toEqual(['a', 'b']);
  });
});

// ── E. Precedence + render plan ───────────────────────────────────────────────

function ownershipFor(policies: PdfImportRegionPolicyV1[], geo: RegionGeometry[]) {
  return buildRegionOwnershipGraph(PAGE, 1, policies, geo);
}

describe('render plan precedence', () => {
  it('raster-only page suppresses ALL region visuals', () => {
    const chart = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
    const ow = ownershipFor([chart], [{ regionId: 'c1', parentRegionId: null, childRegionIds: [], bbox: bb(40, 100, 200, 150), zOrderHint: null }]);
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'raster-only', pageRasterAvailable: true, regionPolicies: [chart], ownership: ow, overlays: [{ overlayId: 'ov1', sourceRegionId: 'c1' }] });
    expect(plan.renderFullPageRaster).toBe(true);
    expect(plan.renderRegionCrops).toEqual([]);
    expect(plan.suppressedOverlayIds).toContain('ov1');
  });

  it('raster-only + no raster → page_raster_missing', () => {
    const ow = ownershipFor([], []);
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'raster-only', pageRasterAvailable: false, regionPolicies: [], ownership: ow, overlays: [] });
    expect(plan.hardDefectCodes).toContain('page_raster_missing');
  });

  it('outermost table crop renders; nested chart crop suppressed', () => {
    const table = adaptTablePlanToRegionPolicy(tablePlan('t1', 'table-source-crop'), PAGE, 'a'.repeat(64), bb(40, 100, 500, 300));
    const chart = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(60, 120, 200, 150)), PAGE);
    const geo: RegionGeometry[] = [
      { regionId: 't1', parentRegionId: null, childRegionIds: ['c1'], bbox: bb(40, 100, 500, 300), zOrderHint: null },
      { regionId: 'c1', parentRegionId: 't1', childRegionIds: [], bbox: bb(60, 120, 200, 150), zOrderHint: null },
    ];
    const ow = ownershipFor([table, chart], geo);
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [table, chart], ownership: ow, overlays: [] });
    const cropIds = plan.renderRegionCrops.map((c) => c.regionId);
    expect(cropIds).toContain('t1');
    expect(cropIds).not.toContain('c1');
    expect(plan.suppressedRegionIds).toContain('c1');
    expect(plan.hiddenSemanticRegionIds).toContain('c1');
  });

  it('adjacent chart + table crops both render', () => {
    const chart = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 40, 200, 150)), PAGE);
    const table = adaptTablePlanToRegionPolicy(tablePlan('t1', 'table-source-crop'), PAGE, 'a'.repeat(64), bb(320, 40, 200, 150));
    const geo: RegionGeometry[] = [
      { regionId: 'c1', parentRegionId: null, childRegionIds: [], bbox: bb(40, 40, 200, 150), zOrderHint: null },
      { regionId: 't1', parentRegionId: null, childRegionIds: [], bbox: bb(320, 40, 200, 150), zOrderHint: null },
    ];
    const ow = ownershipFor([chart, table], geo);
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [chart, table], ownership: ow, overlays: [] });
    expect(plan.renderRegionCrops.map((c) => c.regionId).sort()).toEqual(['c1', 't1']);
    expect(plan.hardDefectCodes).not.toContain('unresolved_region_crop_overlap');
  });

  it('overlapping final crops with NO ownership fail closed → page fallback', () => {
    const a = adaptChartPlanToRegionPolicy(chartPlan('a', 'chart-crop', bb(40, 40, 200, 150)), PAGE);
    const b = adaptChartPlanToRegionPolicy(chartPlan('b', 'chart-crop', bb(80, 60, 200, 150)), PAGE);
    const geo: RegionGeometry[] = [
      { regionId: 'a', parentRegionId: null, childRegionIds: [], bbox: bb(40, 40, 200, 150), zOrderHint: null },
      { regionId: 'b', parentRegionId: null, childRegionIds: [], bbox: bb(80, 60, 200, 150), zOrderHint: null },
    ];
    const ow = ownershipFor([a, b], geo);
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [a, b], ownership: ow, overlays: [] });
    expect(plan.hardDefectCodes).toContain('unresolved_region_crop_overlap');
    expect(plan.requiresPageFallback).toBe(true);
  });

  it('editor-reference crop only appears with the editor option, never in final', () => {
    const table = adaptTablePlanToRegionPolicy(tablePlan('t1', 'verified-native-table'), PAGE, 'a'.repeat(64), bb(40, 100, 400, 120));
    const geo: RegionGeometry[] = [{ regionId: 't1', parentRegionId: null, childRegionIds: [], bbox: bb(40, 100, 400, 120), zOrderHint: null }];
    const ow = ownershipFor([table], geo);
    const final = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [table], ownership: ow, overlays: [] });
    const editor = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [table], ownership: ow, overlays: [], options: { includeEditorReferences: true } });
    expect(final.editorReferenceCrops).toEqual([]);
    expect(editor.editorReferenceCrops.map((c) => c.regionId)).toEqual(['t1']);
    // Final-output plan hash identical regardless of editor references.
    expect(hashRenderPlan(final)).toBe(hashRenderPlan(editor));
  });

  it('final crop instructions contain durable paths only (no signed URL)', () => {
    const chart = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
    const ow = ownershipFor([chart], [{ regionId: 'c1', parentRegionId: null, childRegionIds: [], bbox: bb(40, 100, 200, 150), zOrderHint: null }]);
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [chart], ownership: ow, overlays: [] });
    for (const c of plan.renderRegionCrops) expect(c.artifactPath.startsWith('http')).toBe(false);
  });

  it('plan hash is deterministic and unaffected by a signed URL', () => {
    const chart = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
    const ow = ownershipFor([chart], [{ regionId: 'c1', parentRegionId: null, childRegionIds: [], bbox: bb(40, 100, 200, 150), zOrderHint: null }]);
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [chart], ownership: ow, overlays: [] });
    expect(hashRenderPlan(plan)).toBe(hashRenderPlan(plan));
  });
});

// ── F. Suppression ────────────────────────────────────────────────────────────

describe('suppression composition', () => {
  it('an overlay mapped to a cropped region is suppressed', () => {
    const chart = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
    const ow = buildRegionOwnershipGraph(PAGE, 1, [chart], [{ regionId: 'c1', parentRegionId: null, childRegionIds: [], bbox: bb(40, 100, 200, 150), zOrderHint: null }]);
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [chart], ownership: ow, overlays: [{ overlayId: 'axis-1', sourceRegionId: 'c1' }, { overlayId: 'prose', sourceRegionId: null }] });
    expect(plan.suppressedOverlayIds).toContain('axis-1');
    expect(plan.renderNativeOverlayIds).toContain('prose');
  });
});

// ── G. Export preflight ───────────────────────────────────────────────────────

describe('buildExportPreflight', () => {
  const chart = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
  const ow = buildRegionOwnershipGraph(PAGE, 1, [chart], [{ regionId: 'c1', parentRegionId: null, childRegionIds: [], bbox: bb(40, 100, 200, 150), zOrderHint: null }]);
  const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [chart], ownership: ow, overlays: [] });

  it('ready when every final crop is ready', () => {
    const pf = buildExportPreflight([{ pageId: PAGE, plan, assetStates: [{ regionId: 'c1', state: 'ready' }], pageRasterReady: true }]);
    expect(pf.ok).toBe(true);
  });
  it('fails closed when a final crop is missing', () => {
    const pf = buildExportPreflight([{ pageId: PAGE, plan, assetStates: [{ regionId: 'c1', state: 'missing' }], pageRasterReady: true }]);
    expect(pf.ok).toBe(false);
    expect(pf.pages[0].missingAssets).toContain('c1');
  });
});

// ── H. Operator overrides ─────────────────────────────────────────────────────

function override(action: PdfRegionOperatorOverrideV1['action'], over: Partial<PdfRegionOperatorOverrideV1> = {}): PdfRegionOperatorOverrideV1 {
  return { version: 'pdf-region-operator-override-v1', id: 'ov-1', importId: 'imp', templateId: null, pageId: PAGE, regionId: 'c1', action, scope: 'final-output', hardDefectsAcknowledged: false, reason: null, actorId: 'srv', createdAt: '2026-01-01T00:00:00Z', supersedesOverrideId: null, ...over };
}

describe('operator overrides', () => {
  const ctx = { authorized: true, trustedActorId: 'srv', regionExists: true, cropAvailable: true, pageRasterOnly: false };
  it('unauthorized override is rejected', () => {
    expect(validateOperatorOverride(override('force-native'), { ...ctx, authorized: false })).toContain('operator_override_unauthorized');
  });
  it('force-native with unacknowledged hard defects cannot become final', () => {
    expect(validateOperatorOverride(override('force-native'), ctx)).toContain('operator_override_unacknowledged');
  });
  it('force-source-crop without a crop is rejected', () => {
    expect(validateOperatorOverride(override('force-source-crop'), { ...ctx, cropAvailable: false })).toContain('region_source_crop_missing');
  });
  it('orphaned override (region id changed) is rejected', () => {
    expect(validateOperatorOverride(override('force-source-crop'), { ...ctx, regionExists: false })).toContain('operator_override_invalid');
  });
  it('a region override cannot override a page raster-only final policy', () => {
    const auto = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
    const out = applyOperatorOverride(auto, override('force-native', { hardDefectsAcknowledged: true }), { ...ctx, pageRasterOnly: true });
    expect(out).toEqual(auto);
  });
  it('a valid acknowledged force-native applies', () => {
    const auto = adaptTablePlanToRegionPolicy(tablePlan('t1', 'table-source-crop'), PAGE, 'a'.repeat(64), bb(40, 100, 400, 120));
    const out = applyOperatorOverride(auto, override('force-native', { regionId: 't1', hardDefectsAcknowledged: true }), { ...ctx });
    expect(out.strategy).toBe('native-with-source-reference');
    expect(out.decision.decidedBy).toBe('operator');
  });
});

// ── I. Composition report + integration bridge ────────────────────────────────

describe('integration bridge + report', () => {
  it('buildPageRegionPolicies adapts every evidence source', () => {
    const policies = buildPageRegionPolicies({
      pageId: PAGE, pageNumber: 1,
      chartPlans: [chartPlan('c1', 'chart-crop', bb(40, 40, 100, 100))],
      tablePlans: [tablePlan('t1', 'table-source-crop')],
      typographyPlans: [typoPlan('y1', 'verified-native-text')],
      genericRegions: [{ regionId: 'p1', pageId: PAGE, pageNumber: 1, regionType: 'picture', bbox: bb(300, 300, 80, 80), sourceCropPath: 'job/p1.png', sourceCropSha: null, hasValidCrop: true }],
    });
    expect(policies.map((p) => p.regionId).sort()).toEqual(['c1', 'p1', 't1', 'y1']);
  });

  it('resolveHydratedPageComposition returns durable crop paths + a plan hash', () => {
    const comp = resolveHydratedPageComposition({
      evidence: { pageId: PAGE, pageNumber: 1, chartPlans: [chartPlan('c1', 'chart-crop', bb(40, 40, 200, 150))],
        geometry: [{ regionId: 'c1', parentRegionId: null, childRegionIds: [], bbox: bb(40, 40, 200, 150), zOrderHint: null }] },
      pageOutputStrategy: 'native', pageRasterAvailable: true, overlays: [],
    });
    expect(comp.requiredCropRegionIds).toEqual(['c1']);
    expect(comp.requiredCropPaths[0].startsWith('http')).toBe(false);
    expect(comp.planHash).toMatch(/^rplanh-/);
  });

  it('mapOverlaysToRegions prefers explicit sourceRegionId, ambiguous bbox → null', () => {
    const page = { id: 'p', blocks: [{ id: 'b', overlays: [
      { id: 'ov-explicit', type: 'image', sourceRegionId: 'c1', x: 0, y: 0, width: 10, height: 10 },
      { id: 'ov-bbox', type: 'text', x: 60, y: 60, width: 10, height: 10 },
    ] }] } as unknown as import('../templateSchema').Page;
    const refs = mapOverlaysToRegions(page, { c1: bb(40, 40, 200, 150), c2: bb(50, 50, 200, 150) });
    expect(refs.find((r) => r.overlayId === 'ov-explicit')?.sourceRegionId).toBe('c1');
    // bbox centre (65,65) lands in BOTH c1 and c2 → ambiguous → unmapped.
    expect(refs.find((r) => r.overlayId === 'ov-bbox')?.sourceRegionId).toBeNull();
  });

  it('composition report counts strategies + mixed pages', () => {
    const policies = buildPageRegionPolicies({ pageId: PAGE, pageNumber: 1, chartPlans: [chartPlan('c1', 'chart-crop', bb(40, 40, 200, 150))], typographyPlans: [typoPlan('y1', 'verified-native-text', 'ov-prose')] });
    const ow = buildRegionOwnershipGraph(PAGE, 1, policies, policies.map((p) => ({ regionId: p.regionId, parentRegionId: null, childRegionIds: [], bbox: p.sourceCropRef?.bbox ?? bb(40, 40, 10, 10), zOrderHint: null })));
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: policies, ownership: ow, overlays: [{ overlayId: 'ov-prose', sourceRegionId: 'y1' }] });
    const report = buildRegionCompositionReport([{ policies, plan }]);
    expect(report.sourceCropRegionCount).toBe(1);
    expect(report.nativeReferenceRegionCount).toBe(1);
    expect(report.pageCount).toBe(1);
  });
});

// ── J. Core invariant ─────────────────────────────────────────────────────────

describe('core invariant — one visible representation per source region', () => {
  it('a critical region with a crop renders exactly once; its native overlay is suppressed', () => {
    const chart = adaptChartPlanToRegionPolicy(chartPlan('c1', 'chart-crop', bb(40, 100, 200, 150)), PAGE);
    const ow = buildRegionOwnershipGraph(PAGE, 1, [chart], [{ regionId: 'c1', parentRegionId: null, childRegionIds: [], bbox: bb(40, 100, 200, 150), zOrderHint: null }]);
    const plan = resolvePdfRegionRenderPlan({ pageId: PAGE, pageNumber: 1, pageOutputStrategy: 'native', pageRasterAvailable: true, regionPolicies: [chart], ownership: ow, overlays: [{ overlayId: 'axis', sourceRegionId: 'c1' }] });
    const visibleForC1 = plan.renderRegionCrops.filter((c) => c.regionId === 'c1').length + (plan.renderNativeOverlayIds.includes('axis') ? 1 : 0);
    expect(visibleForC1).toBe(1); // exactly one visible representation
    expect(plan.hardDefectCodes).not.toContain('crop_and_native_both_visible');
  });
});
