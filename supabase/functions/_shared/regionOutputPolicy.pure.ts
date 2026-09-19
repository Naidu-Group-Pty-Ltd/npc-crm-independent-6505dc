/**
 * pdf-region-output-policy-v1 · pdf-region-render-plan-v1 · pdf-region-ownership-v1 ·
 * pdf-region-composition-report-v1 · pdf-region-operator-override-v1
 * — PDF Extraction V3 · Package E6 (canonical shared pure module).
 *
 * The single authoritative, deterministic, renderer-neutral REGION OUTPUT POLICY
 * that COMPOSES the specialized preservation decisions — E0 page containment,
 * E3 chart preservation, E4 table arbitration, E5 typography preservation — plus
 * generic picture/logo/vector/unknown-visual policy, the existing page-level
 * output policy, and operator overrides, into ONE ownership graph + ONE render
 * plan that every surface (editor, preview, print, export, visual-QA) consumes.
 *
 * CORE INVARIANT — for every source region the visible source-representation
 * count ∈ {0, 1}; for every required critical region in accepted final output it
 * is exactly 1. No source pixel renders twice; no critical region renders zero
 * times. SOURCE FIDELITY OUTRANKS EDITABILITY, and a weighted score never
 * overrides a composition hard defect.
 *
 * This module ADAPTS E3/E4/E5 decisions — it never re-scores or reinterprets a
 * hard defect, never improves extraction, and never replaces E0 or the page
 * policy (`pdf-page-output-policy-v1` stays authoritative for page-wide raster).
 * Pure + deterministic + JSON-safe: no signed URLs in any contract, no DOM, no
 * network, no I/O; inputs are never mutated.
 */

import { fnv1a32, type SourceBBox } from './sourceSceneGraphV2.pure.ts';
import type { ChartRegionRenderPlan } from './chartPreservation.pure.ts';
import type { TablePreservationRegionPlanV1 } from './tableArbitration.pure.ts';
import type { TypographyPreservationRunPlanV1 } from './typographyFidelity.pure.ts';

export const PDF_REGION_OUTPUT_POLICY_VERSION = 'pdf-region-output-policy-v1';
export const PDF_REGION_RENDER_PLAN_VERSION = 'pdf-region-render-plan-v1';
export const PDF_REGION_OWNERSHIP_VERSION = 'pdf-region-ownership-v1';
export const PDF_REGION_COMPOSITION_REPORT_VERSION = 'pdf-region-composition-report-v1';
export const PDF_REGION_OPERATOR_OVERRIDE_VERSION = 'pdf-region-operator-override-v1';

// ── Enums ────────────────────────────────────────────────────────────────────

export type RegionOutputStrategy = 'native' | 'source-crop' | 'native-with-source-reference' | 'hidden-semantic';
export type RegionResolutionState = 'resolved' | 'page-fallback' | 'blocked';
export type RegionNativeLayerPolicy = 'editable' | 'locked' | 'hidden';
export type RegionSourceCropRole = 'none' | 'editor-reference' | 'final-output';
export type RegionSemanticLayerPolicy = 'visible-native' | 'hidden-metadata' | 'accessibility-only';
export type RegionType = 'text' | 'table' | 'chart' | 'picture' | 'logo' | 'vector-cluster' | 'background' | 'unknown-visual';
export type RegionSourceContract = 'e3-chart' | 'e4-table' | 'e5-typography' | 'source-scene' | 'legacy' | 'operator';

// ── Region output policy ─────────────────────────────────────────────────────

export interface RegionSourceCropRef {
  artifactPath: string | null; sha256: string | null; bbox: SourceBBox | null;
  mime: 'image/png' | null; widthPx: number | null; heightPx: number | null; dpi: number | null;
}

export interface PdfImportRegionPolicyV1 {
  version: typeof PDF_REGION_OUTPUT_POLICY_VERSION;
  pageId: string; pageNumber: number; regionId: string; regionType: RegionType;
  strategy: RegionOutputStrategy; resolutionState: RegionResolutionState;
  nativeLayerPolicy: RegionNativeLayerPolicy; sourceCropRole: RegionSourceCropRole;
  semanticLayerPolicy: RegionSemanticLayerPolicy; sourceCropRef: RegionSourceCropRef | null;
  nativeOverlayIds: string[]; sourceRegionIds: string[]; sourceRunIds: string[]; childRegionIds: string[];
  ownerRegionId: string | null; ownershipReason: string | null;
  selectedEvidence: { sourceContract: RegionSourceContract; sourceDecisionId: string | null; sourceDecisionVersion: string | null };
  hardDefectCodes: string[]; manualReviewRequired: boolean;
  decision: { decidedBy: 'automatic' | 'quality-gate' | 'operator' | 'migration' | 'legacy'; action: string; reason: string; decidedAt: string | null; operatorOverrideId: string | null };
  isCritical: boolean; complete: boolean; problems: string[];
}

// ── Composition hard defects ─────────────────────────────────────────────────

export type RegionCompositionDefectCode =
  | 'region_policy_missing' | 'region_policy_invalid' | 'unknown_region_strategy'
  | 'region_source_crop_missing' | 'region_source_crop_invalid' | 'region_native_candidate_missing'
  | 'region_native_candidate_invalid' | 'unresolved_critical_region' | 'region_ownership_cycle'
  | 'region_owner_missing' | 'region_parent_mismatch' | 'region_page_mismatch' | 'duplicate_region_id'
  | 'duplicate_source_pixels' | 'source_region_not_rendered' | 'unresolved_region_crop_overlap'
  | 'crop_and_native_both_visible' | 'nested_crop_both_visible' | 'suppression_target_missing'
  | 'suppression_conflict' | 'hidden_semantic_visible' | 'editor_reference_visible_in_final'
  | 'page_policy_region_policy_conflict' | 'page_raster_missing' | 'region_crop_asset_unavailable'
  | 'region_crop_asset_expired' | 'region_crop_asset_hash_mismatch' | 'region_crop_bbox_invalid'
  | 'region_crop_outside_page' | 'final_output_blank_region' | 'final_output_blank_page'
  | 'renderer_parity_failed' | 'export_preflight_failed' | 'operator_override_invalid'
  | 'operator_override_unauthorized' | 'operator_override_unacknowledged' | 'signed_url_persisted'
  | 'composition_unscored';

const SIGNED_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
function bboxOk(b: unknown): b is SourceBBox {
  const o = b as SourceBBox | undefined;
  const r = o as unknown as Record<string, number>;
  return Boolean(o && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])) && o.width > 0 && o.height > 0);
}
function isDurablePath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !SIGNED_URL_RE.test(p) && !p.startsWith('data:') && !p.split('/').includes('..');
}

/** Validate a persisted region policy (defensive). Never accepts a signed URL. */
export function validateRegionPolicy(input: unknown): string[] {
  const problems: string[] = [];
  if (!input || typeof input !== 'object') return ['region_policy_invalid'];
  const p = input as PdfImportRegionPolicyV1;
  if (p.version !== PDF_REGION_OUTPUT_POLICY_VERSION) problems.push('region_policy_invalid');
  if (!['native', 'source-crop', 'native-with-source-reference', 'hidden-semantic'].includes(p.strategy)) problems.push('unknown_region_strategy');
  const cropPath = p.sourceCropRef?.artifactPath ?? null;
  if (cropPath != null && !isDurablePath(cropPath)) problems.push(SIGNED_URL_RE.test(String(cropPath)) ? 'signed_url_persisted' : 'region_source_crop_invalid');
  if (p.strategy === 'source-crop' && p.sourceCropRole === 'final-output' && !cropPath) problems.push('region_source_crop_missing');
  return Array.from(new Set(problems));
}

// ── E3/E4/E5 adapters (Phase 3) — never re-score, never downgrade a defect ───

function cropRef(path: string | null, sha: string | null, bbox: SourceBBox | null, dpi: number | null): RegionSourceCropRef | null {
  if (!path) return null;
  return { artifactPath: isDurablePath(path) ? path : null, sha256: sha ?? null, bbox: bbox ?? null, mime: 'image/png', widthPx: null, heightPx: null, dpi: dpi ?? null };
}
function basePolicy(pageId: string, pageNumber: number, regionId: string, regionType: RegionType): PdfImportRegionPolicyV1 {
  return {
    version: PDF_REGION_OUTPUT_POLICY_VERSION, pageId, pageNumber, regionId, regionType,
    strategy: 'native', resolutionState: 'resolved', nativeLayerPolicy: 'editable',
    sourceCropRole: 'none', semanticLayerPolicy: 'visible-native', sourceCropRef: null,
    nativeOverlayIds: [], sourceRegionIds: [regionId], sourceRunIds: [], childRegionIds: [],
    ownerRegionId: null, ownershipReason: null,
    selectedEvidence: { sourceContract: 'source-scene', sourceDecisionId: null, sourceDecisionVersion: null },
    hardDefectCodes: [], manualReviewRequired: false,
    decision: { decidedBy: 'automatic', action: 'auto', reason: 'auto', decidedAt: null, operatorOverrideId: null },
    isCritical: regionType !== 'text' && regionType !== 'background', complete: true, problems: [],
  };
}

/** E3 chart plan → region policy. chart-crop → source-crop; fallback → page-fallback. */
export function adaptChartPlanToRegionPolicy(plan: ChartRegionRenderPlan, pageId: string): PdfImportRegionPolicyV1 {
  const b = basePolicy(pageId, plan.pageNumber ?? 0, plan.regionId, 'chart');
  b.selectedEvidence = { sourceContract: 'e3-chart', sourceDecisionId: plan.regionId, sourceDecisionVersion: 'chart-preservation-v1' };
  b.childRegionIds = [...plan.childRegionIds];
  b.isCritical = true;
  if (plan.renderMode === 'chart-crop') {
    b.strategy = 'source-crop'; b.resolutionState = 'resolved'; b.nativeLayerPolicy = 'hidden';
    b.sourceCropRole = 'final-output'; b.semanticLayerPolicy = 'hidden-metadata';
    b.sourceCropRef = cropRef(plan.cropPath, plan.cropSha256, plan.bbox, plan.cropDpi);
    if (!b.sourceCropRef?.artifactPath) { b.hardDefectCodes.push('region_source_crop_missing'); b.complete = false; }
    b.decision.action = 'chart-source-crop';
  } else {
    b.resolutionState = 'page-fallback'; b.decision.action = 'chart-containment-fallback';
  }
  return b;
}

/** E4 table plan → region policy. */
export function adaptTablePlanToRegionPolicy(plan: TablePreservationRegionPlanV1, pageId: string, cropSha: string | null = null, bbox: SourceBBox | null = null): PdfImportRegionPolicyV1 {
  const b = basePolicy(pageId, plan.pageNumber ?? 0, plan.regionId, 'table');
  b.selectedEvidence = { sourceContract: 'e4-table', sourceDecisionId: plan.selectedCandidateId, sourceDecisionVersion: plan.version };
  b.hardDefectCodes = [...plan.hardDefectCodes];
  b.manualReviewRequired = plan.manualReviewRequired;
  b.isCritical = true;
  switch (plan.renderMode) {
    case 'verified-native-table':
      b.strategy = 'native-with-source-reference'; b.resolutionState = 'resolved'; b.nativeLayerPolicy = 'editable';
      b.sourceCropRole = plan.sourceCropPath ? 'editor-reference' : 'none'; b.semanticLayerPolicy = 'visible-native';
      b.sourceCropRef = cropRef(plan.sourceCropPath, cropSha, bbox, null); b.decision.action = 'verified-native-table'; break;
    case 'table-source-crop':
      b.strategy = 'source-crop'; b.resolutionState = 'resolved'; b.nativeLayerPolicy = 'hidden';
      b.sourceCropRole = 'final-output'; b.semanticLayerPolicy = 'hidden-metadata';
      b.sourceCropRef = cropRef(plan.sourceCropPath, cropSha, bbox, null);
      if (!b.sourceCropRef?.artifactPath) { b.hardDefectCodes.push('region_source_crop_missing'); b.complete = false; }
      b.decision.action = 'table-source-crop'; break;
    case 'blocked': b.resolutionState = 'blocked'; b.manualReviewRequired = true; b.decision.action = 'table-blocked'; break;
    default: b.resolutionState = 'page-fallback'; b.decision.action = 'table-containment-fallback';
  }
  return b;
}

/** E5 typography plan → region policy (per source run). */
export function adaptTypographyPlanToRegionPolicy(plan: TypographyPreservationRunPlanV1, pageId: string, bbox: SourceBBox | null = null): PdfImportRegionPolicyV1 {
  const b = basePolicy(pageId, plan.pageNumber ?? 0, plan.sourceRunId, 'text');
  b.selectedEvidence = { sourceContract: 'e5-typography', sourceDecisionId: plan.resolvedFontAssetId, sourceDecisionVersion: plan.version };
  b.hardDefectCodes = [...plan.hardDefectCodes];
  b.manualReviewRequired = plan.manualReviewRequired;
  b.sourceRunIds = [plan.sourceRunId];
  b.nativeOverlayIds = plan.candidateOverlayId ? [plan.candidateOverlayId] : [];
  // Typography is critical only when the fidelity state flags it (financial/legal);
  // ordinary verified prose stays non-critical so the page need not fall back.
  b.isCritical = plan.renderMode === 'source-text-crop' || plan.renderMode === 'blocked';
  switch (plan.renderMode) {
    case 'verified-native-text':
      b.strategy = 'native-with-source-reference'; b.resolutionState = 'resolved'; b.nativeLayerPolicy = 'editable';
      b.sourceCropRole = plan.sourceCropPath ? 'editor-reference' : 'none'; b.semanticLayerPolicy = 'visible-native';
      b.sourceCropRef = cropRef(plan.sourceCropPath, null, bbox, null); b.decision.action = 'verified-native-text'; break;
    case 'source-text-crop':
      b.strategy = 'source-crop'; b.resolutionState = 'resolved'; b.nativeLayerPolicy = 'hidden';
      b.sourceCropRole = 'final-output'; b.semanticLayerPolicy = 'hidden-metadata';
      b.sourceCropRef = cropRef(plan.sourceCropPath, null, bbox, null);
      if (!b.sourceCropRef?.artifactPath) { b.hardDefectCodes.push('region_source_crop_missing'); b.complete = false; }
      b.decision.action = 'text-source-crop'; break;
    case 'blocked': b.resolutionState = 'blocked'; b.manualReviewRequired = true; b.decision.action = 'text-blocked'; break;
    default: b.resolutionState = 'page-fallback'; b.decision.action = 'text-containment-fallback';
  }
  return b;
}

// ── Generic source-region policy (Phase 4/31) ────────────────────────────────

export interface GenericRegionInput {
  regionId: string; pageId: string; pageNumber: number; regionType: RegionType;
  bbox: SourceBBox | null; sourceCropPath: string | null; sourceCropSha: string | null;
  hasValidCrop: boolean; childRegionIds?: string[]; nativeImageIsExactSource?: boolean;
}

/** Conservative default policy for a region with no E3/E4/E5 plan. Fail-closed. */
export function genericRegionPolicy(input: GenericRegionInput): PdfImportRegionPolicyV1 {
  const b = basePolicy(input.pageId, input.pageNumber, input.regionId, input.regionType);
  b.childRegionIds = [...(input.childRegionIds ?? [])];
  const crop = input.hasValidCrop && input.sourceCropPath
    ? cropRef(input.sourceCropPath, input.sourceCropSha, input.bbox, null) : null;
  const cropReady = Boolean(crop?.artifactPath);
  switch (input.regionType) {
    case 'text': case 'background':
      b.strategy = 'native'; b.isCritical = false; b.decision.action = 'generic-native'; break;
    case 'picture': case 'logo': case 'vector-cluster': case 'unknown-visual': case 'chart': case 'table':
      b.isCritical = true;
      if (input.nativeImageIsExactSource && input.regionType === 'picture') {
        // The native image already IS the exact source crop → no duplicate crop.
        b.strategy = 'native-with-source-reference'; b.resolutionState = 'resolved';
        b.sourceCropRole = 'none'; b.semanticLayerPolicy = 'visible-native'; b.decision.action = 'native-source-equivalent';
      } else if (cropReady) {
        b.strategy = 'source-crop'; b.resolutionState = 'resolved'; b.nativeLayerPolicy = 'hidden';
        b.sourceCropRole = 'final-output'; b.semanticLayerPolicy = 'hidden-metadata'; b.sourceCropRef = crop;
        b.decision.action = 'generic-source-crop';
      } else {
        // No usable crop for a critical visual → page fallback (never blank native).
        b.resolutionState = 'page-fallback'; b.hardDefectCodes.push('region_source_crop_missing'); b.decision.action = 'generic-page-fallback';
      }
      break;
    default: b.strategy = 'native';
  }
  return b;
}

// ── Ownership graph (Phase 5) ────────────────────────────────────────────────

export interface PdfRegionOwnershipNodeV1 {
  regionId: string; parentRegionId: string | null; childRegionIds: string[];
  strategy: RegionOutputStrategy; visibleOwnerRegionId: string | null;
  bbox: SourceBBox | null; zOrderHint: number | null; sourceContract: RegionSourceContract; ownershipReason: string | null;
}
export interface RegionOwnershipConflictV1 { regionIdA: string; regionIdB: string; code: RegionCompositionDefectCode; reason: string }
export interface PdfRegionOwnershipGraphV1 {
  version: typeof PDF_REGION_OWNERSHIP_VERSION; pageId: string; pageNumber: number;
  nodes: PdfRegionOwnershipNodeV1[]; visibleOwnerRegionIds: string[]; suppressedRegionIds: string[];
  ownershipConflicts: RegionOwnershipConflictV1[]; complete: boolean; problems: string[];
}

export interface RegionGeometry { regionId: string; parentRegionId: string | null; childRegionIds: string[]; bbox: SourceBBox | null; zOrderHint: number | null }

/**
 * Build the deterministic ownership graph. Explicit relationships outrank
 * inferred bbox containment. Cycles / self-parent / missing owner are hard
 * composition defects (never broken arbitrarily → page fallback / block).
 */
export function buildRegionOwnershipGraph(
  pageId: string, pageNumber: number, policies: PdfImportRegionPolicyV1[], geometry: RegionGeometry[],
): PdfRegionOwnershipGraphV1 {
  const problems: string[] = [];
  const conflicts: RegionOwnershipConflictV1[] = [];
  const geoById = new Map(geometry.map((g) => [g.regionId, g]));
  const polById = new Map(policies.map((p) => [p.regionId, p]));
  const ids = policies.map((p) => p.regionId);
  if (new Set(ids).size !== ids.length) problems.push('duplicate_region_id');

  // Parent map: explicit relationship first, else bbox containment (bounded).
  const parentOf = new Map<string, string | null>();
  for (const p of policies) {
    const g = geoById.get(p.regionId);
    let parent = g?.parentRegionId ?? null;
    if (parent === p.regionId) { problems.push('region_owner_missing'); conflicts.push({ regionIdA: p.regionId, regionIdB: p.regionId, code: 'region_ownership_cycle', reason: 'self_parent' }); parent = null; }
    if (parent && !polById.has(parent)) { problems.push('region_owner_missing'); parent = null; }
    if (!parent && bboxOk(g?.bbox)) {
      // bbox fallback: smallest strictly-containing region becomes the parent.
      let best: { id: string; area: number } | null = null;
      for (const q of policies) {
        if (q.regionId === p.regionId) continue;
        const qg = geoById.get(q.regionId);
        if (!bboxOk(qg?.bbox) || !strictlyContains(qg!.bbox!, g!.bbox!)) continue;
        const area = qg!.bbox!.width * qg!.bbox!.height;
        if (!best || area < best.area) best = { id: q.regionId, area };
      }
      if (best) parent = best.id;
    }
    parentOf.set(p.regionId, parent ?? null);
  }

  // Cycle detection.
  for (const p of policies) {
    const seen = new Set<string>(); let cur: string | null = p.regionId;
    while (cur) { if (seen.has(cur)) { problems.push('region_ownership_cycle'); conflicts.push({ regionIdA: p.regionId, regionIdB: cur, code: 'region_ownership_cycle', reason: 'cycle' }); break; } seen.add(cur); cur = parentOf.get(cur) ?? null; }
  }

  // Visible owner: a region is suppressed when it has a SOURCE-CROP ancestor.
  const suppressed = new Set<string>();
  const nodes: PdfRegionOwnershipNodeV1[] = [];
  for (const p of [...policies].sort((a, b) => a.regionId.localeCompare(b.regionId))) {
    const g = geoById.get(p.regionId);
    let ancestor: string | null = parentOf.get(p.regionId) ?? null;
    let cropOwner: string | null = null; const guard = new Set<string>();
    while (ancestor && !guard.has(ancestor)) {
      guard.add(ancestor);
      const ap = polById.get(ancestor);
      if (ap && ap.strategy === 'source-crop' && ap.sourceCropRole === 'final-output') { cropOwner = ancestor; break; }
      ancestor = parentOf.get(ancestor) ?? null;
    }
    if (cropOwner) suppressed.add(p.regionId);
    nodes.push({
      regionId: p.regionId, parentRegionId: parentOf.get(p.regionId) ?? null, childRegionIds: [...(g?.childRegionIds ?? [])],
      strategy: p.strategy, visibleOwnerRegionId: cropOwner ?? (isVisible(p) ? p.regionId : null),
      bbox: g?.bbox ?? p.sourceCropRef?.bbox ?? null, zOrderHint: g?.zOrderHint ?? null,
      sourceContract: p.selectedEvidence.sourceContract, ownershipReason: cropOwner ? `nested_under:${cropOwner}` : null,
    });
  }
  const visibleOwnerRegionIds = nodes.filter((n) => !suppressed.has(n.regionId) && isVisibleStrategy(n.strategy)).map((n) => n.regionId);
  return {
    version: PDF_REGION_OWNERSHIP_VERSION, pageId, pageNumber, nodes,
    visibleOwnerRegionIds, suppressedRegionIds: [...suppressed].sort(),
    ownershipConflicts: conflicts, complete: problems.length === 0 && conflicts.length === 0,
    problems: Array.from(new Set(problems)),
  };
}
function isVisible(p: PdfImportRegionPolicyV1): boolean { return isVisibleStrategy(p.strategy); }
function isVisibleStrategy(s: RegionOutputStrategy): boolean { return s === 'native' || s === 'source-crop' || s === 'native-with-source-reference'; }
function strictlyContains(outer: SourceBBox, inner: SourceBBox, tol = 1.0): boolean {
  return inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.width <= outer.x + outer.width + tol
    && inner.y + inner.height <= outer.y + outer.height + tol && (outer.width * outer.height) > (inner.width * inner.height);
}
function overlapsMaterially(a: SourceBBox, b: SourceBBox): boolean {
  const ix = Math.max(a.x, b.x), iy = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.width, b.x + b.width), iy2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, ix2 - ix) * Math.max(0, iy2 - iy);
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 && inter / minArea > 0.25;
}

// ── Render plan (Phase 8) ────────────────────────────────────────────────────

export interface RegionCropRenderInstructionV1 {
  regionId: string; ownerRegionId: string; bbox: SourceBBox; artifactPath: string; sha256: string | null;
  zOrder: number; locked: true; altText: string | null;
  cropRole: 'final-output' | 'editor-reference'; sourceContract: RegionSourceContract;
}
export interface PdfRegionRenderPlanV1 {
  version: typeof PDF_REGION_RENDER_PLAN_VERSION; pageId: string; pageNumber: number;
  pagePolicyVersion: string; pageOutputStrategy: 'native' | 'raster-only'; renderFullPageRaster: boolean;
  renderNativeOverlayIds: string[]; renderRegionCrops: RegionCropRenderInstructionV1[];
  editorReferenceCrops: RegionCropRenderInstructionV1[]; suppressedOverlayIds: string[];
  suppressedRegionIds: string[]; hiddenSemanticRegionIds: string[]; accessibilityRegionIds: string[];
  requiresPageFallback: boolean; blocked: boolean; manualReviewRequired: boolean;
  hardDefectCodes: RegionCompositionDefectCode[]; problems: string[];
}

export interface CandidateOverlayRef { overlayId: string; sourceRegionId: string | null; bbox?: SourceBBox | null }
export interface ResolveRenderPlanArgs {
  pageId: string; pageNumber: number;
  pageOutputStrategy: 'native' | 'raster-only'; pageRasterAvailable: boolean;
  regionPolicies: PdfImportRegionPolicyV1[]; ownership: PdfRegionOwnershipGraphV1;
  overlays: CandidateOverlayRef[]; options?: { includeEditorReferences?: boolean };
}

/**
 * Resolve ONE deterministic render plan. Precedence: full-page raster-only owns
 * everything; else the outermost selected source-crop owner renders (nested crops
 * + native suppressed); adjacent crops render independently; a verified native
 * region renders only with no source-crop ancestor; hidden-semantic never renders;
 * editor-reference crops only when the editor requests them. Overlapping
 * final-output crops without an ownership relation fail closed
 * (`unresolved_region_crop_overlap` → page fallback). Never mutates inputs; never
 * emits a signed URL.
 */
export function resolvePdfRegionRenderPlan(args: ResolveRenderPlanArgs): PdfRegionRenderPlanV1 {
  const { pageId, pageNumber, regionPolicies, ownership, overlays } = args;
  const includeEditorRefs = args.options?.includeEditorReferences === true;
  const hard = new Set<RegionCompositionDefectCode>();
  const problems: string[] = [];
  const polById = new Map(regionPolicies.map((p) => [p.regionId, p]));
  const suppressedRegions = new Set(ownership.suppressedRegionIds);

  // Page raster-only: the source page raster is the only visible representation.
  if (args.pageOutputStrategy === 'raster-only') {
    if (!args.pageRasterAvailable) hard.add('page_raster_missing');
    return plan(pageId, pageNumber, 'raster-only', true, [], [], [], overlays.map((o) => o.overlayId),
      [...suppressedRegions], regionPolicies.map((p) => p.regionId), regionPolicies.map((p) => p.regionId),
      false, hard.has('page_raster_missing'), false, [...hard], problems, ownership);
  }

  // Native / mixed page.
  const renderCrops: RegionCropRenderInstructionV1[] = [];
  const editorCrops: RegionCropRenderInstructionV1[] = [];
  const hiddenSemantic: string[] = [];
  const accessibility: string[] = [];
  const renderedRegionIds = new Set<string>();
  let requiresPageFallback = false; let blocked = false; let manualReview = false;

  for (const p of regionPolicies) {
    if (p.resolutionState === 'blocked') { blocked = true; manualReview = true; hard.add('unresolved_critical_region'); }
    if (p.resolutionState === 'page-fallback') requiresPageFallback = true;
    if (p.manualReviewRequired) manualReview = true;
    if (suppressedRegions.has(p.regionId)) { if (p.semanticLayerPolicy !== 'visible-native') hiddenSemantic.push(p.regionId); continue; }
    if (p.strategy === 'hidden-semantic') { hiddenSemantic.push(p.regionId); if (p.semanticLayerPolicy === 'accessibility-only') accessibility.push(p.regionId); continue; }
    if (p.strategy === 'source-crop' && p.sourceCropRole === 'final-output') {
      const ref = p.sourceCropRef;
      if (!ref?.artifactPath || !bboxOk(ref.bbox)) { hard.add('region_source_crop_missing'); requiresPageFallback = true; continue; }
      renderCrops.push({ regionId: p.regionId, ownerRegionId: p.regionId, bbox: ref.bbox, artifactPath: ref.artifactPath, sha256: ref.sha256, zOrder: zOrderFor(p, ownership), locked: true, altText: null, cropRole: 'final-output', sourceContract: p.selectedEvidence.sourceContract });
      renderedRegionIds.add(p.regionId);
      if (p.semanticLayerPolicy === 'hidden-metadata') hiddenSemantic.push(p.regionId);
    } else if (p.strategy === 'native' || p.strategy === 'native-with-source-reference') {
      renderedRegionIds.add(p.regionId);
      if (includeEditorRefs && p.sourceCropRole === 'editor-reference' && p.sourceCropRef?.artifactPath && bboxOk(p.sourceCropRef.bbox)) {
        editorCrops.push({ regionId: p.regionId, ownerRegionId: p.regionId, bbox: p.sourceCropRef.bbox, artifactPath: p.sourceCropRef.artifactPath, sha256: p.sourceCropRef.sha256, zOrder: zOrderFor(p, ownership), locked: true, altText: null, cropRole: 'editor-reference', sourceContract: p.selectedEvidence.sourceContract });
      }
    }
  }

  // Overlap conflict: two final crops overlapping materially with no ancestry.
  for (let i = 0; i < renderCrops.length; i += 1) for (let j = i + 1; j < renderCrops.length; j += 1) {
    const a = renderCrops[i]; const b = renderCrops[j];
    if (overlapsMaterially(a.bbox, b.bbox) && !relatedInOwnership(a.regionId, b.regionId, ownership)) {
      hard.add('unresolved_region_crop_overlap'); requiresPageFallback = true;
    }
  }

  // Overlay suppression: an overlay mapped to a suppressed/cropped region is hidden.
  const suppressedOverlays = new Set<string>();
  for (const ov of overlays) {
    const rid = ov.sourceRegionId;
    if (!rid) continue;
    const p = polById.get(rid);
    const regionCropped = p && p.strategy === 'source-crop' && p.sourceCropRole === 'final-output';
    if (suppressedRegions.has(rid) || regionCropped) suppressedOverlays.add(ov.overlayId);
  }

  const renderNativeOverlayIds = overlays.filter((o) => !suppressedOverlays.has(o.overlayId)).map((o) => o.overlayId);

  // Invariant: a critical region must have exactly one visible representation.
  for (const p of regionPolicies) {
    if (!p.isCritical) continue;
    const visible = renderedRegionIds.has(p.regionId);
    const suppressedByOwner = suppressedRegions.has(p.regionId);
    if (!visible && !suppressedByOwner && p.resolutionState === 'resolved') hard.add('source_region_not_rendered');
  }

  const cropIds = new Set(renderCrops.map((c) => c.regionId));
  for (const c of renderCrops) { // crop + native both visible is a defect
    const p = polById.get(c.regionId);
    if (p && p.nativeOverlayIds.some((id) => renderNativeOverlayIds.includes(id))) hard.add('crop_and_native_both_visible');
  }
  void cropIds;

  return plan(pageId, pageNumber, 'native', false, renderNativeOverlayIds, renderCrops, editorCrops,
    [...suppressedOverlays].sort(), [...suppressedRegions].sort(), dedupe(hiddenSemantic), dedupe(accessibility),
    requiresPageFallback, blocked, manualReview, [...hard], problems, ownership);
}

function plan(pageId: string, pageNumber: number, pageOutputStrategy: 'native' | 'raster-only', renderFullPageRaster: boolean,
  renderNativeOverlayIds: string[], renderRegionCrops: RegionCropRenderInstructionV1[], editorReferenceCrops: RegionCropRenderInstructionV1[],
  suppressedOverlayIds: string[], suppressedRegionIds: string[], hiddenSemanticRegionIds: string[], accessibilityRegionIds: string[],
  requiresPageFallback: boolean, blocked: boolean, manualReviewRequired: boolean, hardDefectCodes: RegionCompositionDefectCode[], problems: string[], ownership: PdfRegionOwnershipGraphV1): PdfRegionRenderPlanV1 {
  const hard = new Set(hardDefectCodes);
  for (const c of ownership.ownershipConflicts) hard.add(c.code);
  return {
    version: PDF_REGION_RENDER_PLAN_VERSION, pageId, pageNumber, pagePolicyVersion: PDF_PAGE_OUTPUT_POLICY_VERSION_REF,
    pageOutputStrategy, renderFullPageRaster, renderNativeOverlayIds,
    renderRegionCrops: [...renderRegionCrops].sort((a, b) => a.zOrder - b.zOrder || a.regionId.localeCompare(b.regionId)),
    editorReferenceCrops, suppressedOverlayIds, suppressedRegionIds, hiddenSemanticRegionIds, accessibilityRegionIds,
    requiresPageFallback, blocked, manualReviewRequired, hardDefectCodes: [...hard], problems,
  };
}
const PDF_PAGE_OUTPUT_POLICY_VERSION_REF = 'pdf-page-output-policy-v1';
function dedupe(a: string[]): string[] { return [...new Set(a)].sort(); }
function relatedInOwnership(a: string, b: string, g: PdfRegionOwnershipGraphV1): boolean {
  const parent = new Map(g.nodes.map((n) => [n.regionId, n.parentRegionId]));
  const isAncestor = (x: string, y: string) => { let cur = parent.get(y) ?? null; const seen = new Set<string>(); while (cur && !seen.has(cur)) { if (cur === x) return true; seen.add(cur); cur = parent.get(cur) ?? null; } return false; };
  return isAncestor(a, b) || isAncestor(b, a);
}
function zOrderFor(p: PdfImportRegionPolicyV1, g: PdfRegionOwnershipGraphV1): number {
  const n = g.nodes.find((x) => x.regionId === p.regionId);
  if (n?.zOrderHint != null && Number.isFinite(n.zOrderHint)) return n.zOrderHint;
  return 1000; // deterministic default; final sort tie-breaks on region id
}

// ── Operator override (Phase 2/18) ───────────────────────────────────────────

export interface PdfRegionOperatorOverrideV1 {
  version: typeof PDF_REGION_OPERATOR_OVERRIDE_VERSION; id: string; importId: string; templateId: string | null;
  pageId: string; regionId: string | null;
  action: 'accept-automatic' | 'force-native' | 'force-source-crop' | 'force-page-raster' | 'restore-automatic' | 'preview-native-reconstruction' | 'show-source-reference';
  scope: 'editor-only' | 'final-output'; hardDefectsAcknowledged: boolean; reason: string | null;
  actorId: string; createdAt: string; supersedesOverrideId: string | null;
}

/** Validate an override. `authorized` + `actorId` come from the TRUSTED server
 * context, never the client body. Returns defect codes (empty = valid). */
export function validateOperatorOverride(o: unknown, ctx: { authorized: boolean; trustedActorId: string; regionExists: boolean; cropAvailable: boolean }): RegionCompositionDefectCode[] {
  const defects: RegionCompositionDefectCode[] = [];
  if (!o || typeof o !== 'object') return ['operator_override_invalid'];
  const v = o as PdfRegionOperatorOverrideV1;
  if (v.version !== PDF_REGION_OPERATOR_OVERRIDE_VERSION) defects.push('operator_override_invalid');
  if (!ctx.authorized) defects.push('operator_override_unauthorized');
  if (v.action === 'force-source-crop' && !ctx.cropAvailable) defects.push('region_source_crop_missing');
  if (v.action === 'force-native' && v.scope === 'final-output' && !v.hardDefectsAcknowledged) defects.push('operator_override_unacknowledged');
  if (v.regionId && !ctx.regionExists) defects.push('operator_override_invalid'); // orphaned (region id changed)
  return defects;
}

/**
 * Apply operator-override precedence to an automatic policy. Precedence: valid
 * page-raster override > valid region final-output override > automatic. A
 * region override can never escape a page raster-only final policy; a force-native
 * with unacknowledged hard defects can never become final output.
 */
export function applyOperatorOverride(auto: PdfImportRegionPolicyV1, override: PdfRegionOperatorOverrideV1 | null, ctx: { authorized: boolean; trustedActorId: string; regionExists: boolean; cropAvailable: boolean; pageRasterOnly: boolean }): PdfImportRegionPolicyV1 {
  if (!override) return auto;
  const defects = validateOperatorOverride(override, ctx);
  if (defects.length) return { ...auto, hardDefectCodes: [...auto.hardDefectCodes, ...defects], problems: [...auto.problems, ...defects] };
  if (ctx.pageRasterOnly) return auto; // region override cannot override page raster-only final policy
  const out: PdfImportRegionPolicyV1 = { ...auto, decision: { decidedBy: 'operator', action: override.action, reason: override.reason ?? 'operator', decidedAt: override.createdAt, operatorOverrideId: override.id } };
  switch (override.action) {
    case 'force-native': out.strategy = 'native-with-source-reference'; out.resolutionState = 'resolved'; out.nativeLayerPolicy = 'editable'; out.sourceCropRole = 'editor-reference'; out.manualReviewRequired = true; break;
    case 'force-source-crop': out.strategy = 'source-crop'; out.resolutionState = 'resolved'; out.nativeLayerPolicy = 'hidden'; out.sourceCropRole = 'final-output'; out.semanticLayerPolicy = 'hidden-metadata'; break;
    case 'restore-automatic': return auto;
    case 'accept-automatic': return { ...auto, decision: out.decision };
    default: return auto; // editor-only actions never change final policy
  }
  return out;
}

// ── Policy hashing (Phase 27) — deterministic, no timestamps/URLs ────────────

export function hashRegionPolicyInput(policies: PdfImportRegionPolicyV1[]): string {
  const canon = [...policies].sort((a, b) => a.regionId.localeCompare(b.regionId)).map((p) =>
    [p.regionId, p.regionType, p.strategy, p.resolutionState, p.sourceCropRole, p.sourceCropRef?.sha256 ?? '', p.selectedEvidence.sourceContract, [...p.hardDefectCodes].sort().join(','), p.ownerRegionId ?? ''].join('~')).join('|');
  return `rpolh-${fnv1a32(canon)}`;
}
export function hashRenderPlan(plan: PdfRegionRenderPlanV1, opts: { includeEditor?: boolean } = {}): string {
  const crops = plan.renderRegionCrops.map((c) => `${c.regionId}:${c.artifactPath}:${c.zOrder}:${c.cropRole}`).join(',');
  const parts = [plan.pageOutputStrategy, String(plan.renderFullPageRaster), [...plan.renderNativeOverlayIds].sort().join(','), crops, [...plan.suppressedOverlayIds].sort().join(','), [...plan.suppressedRegionIds].sort().join(','), [...plan.hiddenSemanticRegionIds].sort().join(','), String(plan.requiresPageFallback), String(plan.blocked)];
  if (opts.includeEditor) parts.push(plan.editorReferenceCrops.map((c) => c.regionId).sort().join(','));
  return `rplanh-${fnv1a32(parts.join('|'))}`;
}

// ── Export preflight (Phase 24) ──────────────────────────────────────────────

export interface HydratedRegionCropState { regionId: string; state: 'ready' | 'expired' | 'missing' | 'invalid' }
export interface PdfExportCompositionPreflightV1 {
  ok: boolean;
  pages: Array<{ pageId: string; ready: boolean; missingAssets: string[]; invalidAssets: string[]; hardDefectCodes: RegionCompositionDefectCode[]; fallbackApplied: boolean }>;
  problems: string[];
}

/** Deterministic export preflight. Export may proceed only when every page is
 * ready: all final crops + selected page raster ready, no blocked region, no
 * unresolved overlap. Fails closed. */
export function buildExportPreflight(
  pages: Array<{ pageId: string; plan: PdfRegionRenderPlanV1; assetStates: HydratedRegionCropState[]; pageRasterReady: boolean }>,
): PdfExportCompositionPreflightV1 {
  const out: PdfExportCompositionPreflightV1['pages'] = [];
  let ok = true;
  for (const page of pages) {
    const stateById = new Map(page.assetStates.map((a) => [a.regionId, a.state]));
    const missing: string[] = []; const invalid: string[] = [];
    const hard = new Set<RegionCompositionDefectCode>(page.plan.hardDefectCodes);
    for (const c of page.plan.renderRegionCrops) {
      const s = stateById.get(c.regionId) ?? 'missing';
      if (s === 'missing' || s === 'expired') { missing.push(c.regionId); hard.add('region_crop_asset_unavailable'); }
      else if (s === 'invalid') { invalid.push(c.regionId); hard.add('region_crop_asset_invalid' as RegionCompositionDefectCode); }
    }
    if (page.plan.renderFullPageRaster && !page.pageRasterReady) hard.add('page_raster_missing');
    if (page.plan.blocked) hard.add('unresolved_critical_region');
    const ready = missing.length === 0 && invalid.length === 0 && !page.plan.blocked
      && !(page.plan.renderFullPageRaster && !page.pageRasterReady)
      && !page.plan.hardDefectCodes.includes('unresolved_region_crop_overlap');
    if (!ready) ok = false;
    out.push({ pageId: page.pageId, ready, missingAssets: missing.sort(), invalidAssets: invalid.sort(), hardDefectCodes: [...hard], fallbackApplied: page.plan.requiresPageFallback });
  }
  return { ok, pages: out, problems: ok ? [] : ['export_preflight_failed'] };
}

// ── Composition report (Phase 28) ────────────────────────────────────────────

export interface PdfRegionCompositionReportV1 {
  version: typeof PDF_REGION_COMPOSITION_REPORT_VERSION;
  pageCount: number; regionCount: number; nativeRegionCount: number; sourceCropRegionCount: number;
  nativeReferenceRegionCount: number; hiddenSemanticRegionCount: number; pageFallbackRegionCount: number;
  blockedRegionCount: number; suppressedOverlayCount: number; suppressedNestedCropCount: number;
  duplicateSourcePixelCount: number; missingVisibleRegionCount: number; unresolvedOverlapCount: number;
  rendererParityFailureCount: number; cropAssetAvailability: number | null; compositionCompleteness: number | null;
  mixedPageCount: number; fullRasterPageCount: number; manualReviewPageCount: number; operatorOverrideCount: number;
  hardDefectCount: number; renderStrategyCounts: Record<string, number>; problems: string[];
}

export function buildRegionCompositionReport(pages: Array<{ policies: PdfImportRegionPolicyV1[]; plan: PdfRegionRenderPlanV1 }>): PdfRegionCompositionReportV1 {
  const strategyCounts: Record<string, number> = {};
  let regions = 0, native = 0, crop = 0, ref = 0, hidden = 0, fallback = 0, blocked = 0, suppressedOverlays = 0, suppressedNested = 0;
  let missingVisible = 0, unresolvedOverlap = 0, hardDefects = 0, manualPages = 0, mixed = 0, fullRaster = 0, overrides = 0, dup = 0;
  for (const page of pages) {
    for (const p of page.policies) { regions += 1; strategyCounts[p.strategy] = (strategyCounts[p.strategy] ?? 0) + 1;
      if (p.strategy === 'native') native += 1; else if (p.strategy === 'source-crop') crop += 1;
      else if (p.strategy === 'native-with-source-reference') ref += 1; else if (p.strategy === 'hidden-semantic') hidden += 1;
      if (p.resolutionState === 'page-fallback') fallback += 1; if (p.resolutionState === 'blocked') blocked += 1;
      if (p.decision.operatorOverrideId) overrides += 1; }
    suppressedOverlays += page.plan.suppressedOverlayIds.length; suppressedNested += page.plan.suppressedRegionIds.length;
    hardDefects += page.plan.hardDefectCodes.length;
    if (page.plan.hardDefectCodes.includes('source_region_not_rendered')) missingVisible += 1;
    if (page.plan.hardDefectCodes.includes('unresolved_region_crop_overlap')) unresolvedOverlap += 1;
    if (page.plan.hardDefectCodes.includes('duplicate_source_pixels') || page.plan.hardDefectCodes.includes('crop_and_native_both_visible')) dup += 1;
    if (page.plan.manualReviewRequired) manualPages += 1;
    if (page.plan.renderFullPageRaster) fullRaster += 1;
    else if (page.plan.renderRegionCrops.length > 0 && page.plan.renderNativeOverlayIds.length > 0) mixed += 1;
  }
  return {
    version: PDF_REGION_COMPOSITION_REPORT_VERSION, pageCount: pages.length, regionCount: regions,
    nativeRegionCount: native, sourceCropRegionCount: crop, nativeReferenceRegionCount: ref, hiddenSemanticRegionCount: hidden,
    pageFallbackRegionCount: fallback, blockedRegionCount: blocked, suppressedOverlayCount: suppressedOverlays,
    suppressedNestedCropCount: suppressedNested, duplicateSourcePixelCount: dup, missingVisibleRegionCount: missingVisible,
    unresolvedOverlapCount: unresolvedOverlap, rendererParityFailureCount: 0,
    cropAssetAvailability: crop > 0 ? round4((crop - countMissingCrops(pages)) / crop) : null,
    compositionCompleteness: regions > 0 ? round4(1 - hardDefects / Math.max(1, regions)) : null,
    mixedPageCount: mixed, fullRasterPageCount: fullRaster, manualReviewPageCount: manualPages, operatorOverrideCount: overrides,
    hardDefectCount: hardDefects, renderStrategyCounts: strategyCounts, problems: [],
  };
}
function countMissingCrops(pages: Array<{ plan: PdfRegionRenderPlanV1 }>): number {
  let n = 0; for (const p of pages) if (p.plan.hardDefectCodes.includes('region_source_crop_missing') || p.plan.hardDefectCodes.includes('region_crop_asset_unavailable')) n += 1; return n;
}
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
