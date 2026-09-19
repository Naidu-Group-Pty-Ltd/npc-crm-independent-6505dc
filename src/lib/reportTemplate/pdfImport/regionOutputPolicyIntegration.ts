/**
 * Region output policy integration (E6) — orchestration bridge.
 *
 * Composes the specialized E3/E4/E5 preservation plans + generic region policy
 * + the page-level output policy into ONE set of region policies, builds the
 * ownership graph + render plan, and exposes the renderer-neutral facade every
 * surface (editor, preview, print, export, visual-QA) consumes. The pure render
 * plan carries only durable artifact paths; a SEPARATE hydration layer maps them
 * to ephemeral signed/object URLs that are NEVER persisted.
 *
 * Pure orchestration (no I/O, no DOM, no signed URLs in any returned policy or
 * plan). The hydration layer's `signedUrl` is runtime-only and must be revoked
 * by the caller; it never enters template JSON.
 */
import type { Page } from '../templateSchema';
import type { SourceBBox } from './sourceSceneGraphV2.pure';
import type { ChartRegionRenderPlan } from './chartPreservation.pure';
import type { TablePreservationRegionPlanV1 } from './tableArbitration.pure';
import type { TypographyPreservationRunPlanV1 } from './typographyFidelity.pure';
import {
  adaptChartPlanToRegionPolicy,
  adaptTablePlanToRegionPolicy,
  adaptTypographyPlanToRegionPolicy,
  genericRegionPolicy,
  buildRegionOwnershipGraph,
  resolvePdfRegionRenderPlan,
  hashRenderPlan,
  type PdfImportRegionPolicyV1,
  type PdfRegionRenderPlanV1,
  type PdfRegionOwnershipGraphV1,
  type RegionGeometry,
  type GenericRegionInput,
  type CandidateOverlayRef,
} from './regionOutputPolicy.pure';

// ── Runtime-only hydrated crop asset (NEVER persisted) ───────────────────────

export interface HydratedRegionCropAssetV1 {
  regionId: string;
  durablePath: string;
  /** Runtime-only ephemeral URL — must be revoked; never stored in template JSON. */
  signedUrl: string;
  expiresAt: string;
  sha256: string | null;
  widthPx: number | null;
  heightPx: number | null;
  state: 'ready' | 'expired' | 'missing' | 'invalid';
}

// ── Build region policies for a page from all evidence ───────────────────────

export interface PageEvidence {
  pageId: string;
  pageNumber: number;
  chartPlans?: ChartRegionRenderPlan[];
  tablePlans?: TablePreservationRegionPlanV1[];
  typographyPlans?: TypographyPreservationRunPlanV1[];
  genericRegions?: GenericRegionInput[];
  /** Region geometry (relationships + bbox + zOrderHint) from the scene graph. */
  geometry?: RegionGeometry[];
}

/**
 * Adapt every specialized decision + generic region into one region-policy list.
 * A region covered by an E3/E4/E5 plan is owned by that plan; only regions with
 * no specialized plan fall through to the generic conservative policy.
 */
export function buildPageRegionPolicies(evidence: PageEvidence): PdfImportRegionPolicyV1[] {
  const byId = new Map<string, PdfImportRegionPolicyV1>();
  for (const c of evidence.chartPlans ?? []) byId.set(c.regionId, adaptChartPlanToRegionPolicy(c, evidence.pageId));
  for (const t of evidence.tablePlans ?? []) byId.set(t.regionId, adaptTablePlanToRegionPolicy(t, evidence.pageId));
  for (const y of evidence.typographyPlans ?? []) byId.set(y.sourceRunId, adaptTypographyPlanToRegionPolicy(y, evidence.pageId));
  for (const g of evidence.genericRegions ?? []) if (!byId.has(g.regionId)) byId.set(g.regionId, genericRegionPolicy(g));
  return [...byId.values()].sort((a, b) => a.regionId.localeCompare(b.regionId));
}

// ── Hydrated page composition facade ─────────────────────────────────────────

export interface HydratedPageComposition {
  policies: PdfImportRegionPolicyV1[];
  ownership: PdfRegionOwnershipGraphV1;
  plan: PdfRegionRenderPlanV1;
  planHash: string;
  /** Durable paths of final-output crops the caller must hydrate (bounded). */
  requiredCropRegionIds: string[];
  requiredCropPaths: string[];
  /** Editor-reference crops (only present when includeEditorReferences). */
  editorReferenceRegionIds: string[];
}

export interface ResolvePageCompositionArgs {
  evidence: PageEvidence;
  pageOutputStrategy: 'native' | 'raster-only';
  pageRasterAvailable: boolean;
  overlays: CandidateOverlayRef[];
  options?: { includeEditorReferences?: boolean };
}

/**
 * Resolve the full page composition (policies → ownership → plan) that every
 * renderer consumes. Deterministic; the returned plan references only durable
 * paths — call a hydration layer to map `requiredCropPaths` to ephemeral URLs.
 * The plan hash is identical across surfaces except for editor-only options.
 */
export function resolveHydratedPageComposition(args: ResolvePageCompositionArgs): HydratedPageComposition {
  const policies = buildPageRegionPolicies(args.evidence);
  const ownership = buildRegionOwnershipGraph(args.evidence.pageId, args.evidence.pageNumber, policies, args.evidence.geometry ?? geometryFromPolicies(policies));
  const plan = resolvePdfRegionRenderPlan({
    pageId: args.evidence.pageId, pageNumber: args.evidence.pageNumber,
    pageOutputStrategy: args.pageOutputStrategy, pageRasterAvailable: args.pageRasterAvailable,
    regionPolicies: policies, ownership, overlays: args.overlays, options: args.options,
  });
  return {
    policies, ownership, plan,
    planHash: hashRenderPlan(plan, { includeEditor: args.options?.includeEditorReferences === true }),
    requiredCropRegionIds: plan.renderRegionCrops.map((c) => c.regionId),
    requiredCropPaths: plan.renderRegionCrops.map((c) => c.artifactPath),
    editorReferenceRegionIds: plan.editorReferenceCrops.map((c) => c.regionId),
  };
}

function geometryFromPolicies(policies: PdfImportRegionPolicyV1[]): RegionGeometry[] {
  return policies.map((p) => ({ regionId: p.regionId, parentRegionId: p.ownerRegionId, childRegionIds: p.childRegionIds, bbox: p.sourceCropRef?.bbox ?? null, zOrderHint: null }));
}

// ── Overlay-to-region mapping (Phase 10) ─────────────────────────────────────

/**
 * Map a template page's overlays to source region IDs, in precedence: explicit
 * `sourceRegionId` → explicit `sourceTypographyRunIds` → bounded bbox match. An
 * ambiguous bbox match (two candidate regions) yields `null` (never guessed by
 * name or text content). Pure.
 */
export function mapOverlaysToRegions(page: Page, regionBBoxes: Record<string, SourceBBox>): CandidateOverlayRef[] {
  const out: CandidateOverlayRef[] = [];
  for (const block of page.blocks ?? []) {
    for (const ov of block.overlays ?? []) {
      const o = ov as { id?: string; sourceRegionId?: string; sourceTypographyRunIds?: string[]; x?: number; y?: number; width?: number; height?: number };
      const overlayId = o.id ?? 'overlay';
      let sourceRegionId: string | null = null;
      if (typeof o.sourceRegionId === 'string') sourceRegionId = o.sourceRegionId;
      else if (Array.isArray(o.sourceTypographyRunIds) && o.sourceTypographyRunIds.length === 1) sourceRegionId = o.sourceTypographyRunIds[0];
      const bbox = typeof o.x === 'number' && typeof o.y === 'number' && typeof o.width === 'number' && typeof o.height === 'number'
        ? { x: o.x, y: o.y, width: o.width, height: o.height } : null;
      if (!sourceRegionId && bbox) sourceRegionId = matchByBBox(bbox, regionBBoxes);
      out.push({ overlayId, sourceRegionId, bbox });
    }
  }
  return out;
}

function matchByBBox(bbox: SourceBBox, regionBBoxes: Record<string, SourceBBox>): string | null {
  const cx = bbox.x + bbox.width / 2, cy = bbox.y + bbox.height / 2;
  const hits: string[] = [];
  for (const [rid, rb] of Object.entries(regionBBoxes)) {
    if (cx >= rb.x && cx <= rb.x + rb.width && cy >= rb.y && cy <= rb.y + rb.height) hits.push(rid);
  }
  return hits.length === 1 ? hits[0] : null; // ambiguous / none → unmapped (never guessed)
}
