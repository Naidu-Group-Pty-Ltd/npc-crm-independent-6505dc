/**
 * E8 — immutable, atomic, TEMPLATE-FIRST operation application (pure).
 *
 * Operates on the staged ReportTemplate + its E6 composition — never rebuilds
 * the template from CDIR (which would lose E3/E4/E5/E6/page-policy/operator
 * metadata). Deep-clones, validates each operation (forbidden-op guard +
 * preconditions + stale-target-hash), applies ALL operations or NONE (a single
 * failure discards the whole candidate), and re-validates the result. Returns
 * the new template + its hash + changed target hashes. Never partially applies.
 */
import type { DeterministicRepairOperationV2 } from './contracts';
import { hashTemplateProjection, stableJson } from './contracts';
import { validateOperationPreconditions, isForbiddenOperationKind, type SourceContext } from './operationPolicy';
import { fnv1a32 } from '../../../../pdfImport/sourceSceneGraphV2.pure';

type AnyTemplate = { pages?: AnyPage[] } & Record<string, unknown>;
type AnyPage = { id?: string; size?: { width?: number; height?: number }; meta?: Record<string, unknown>; blocks?: AnyBlock[] } & Record<string, unknown>;
type AnyBlock = { id?: string; overlays?: AnyOverlay[] } & Record<string, unknown>;
type AnyOverlay = { id?: string; x?: number; y?: number; width?: number; height?: number; style?: Record<string, unknown>; zIndex?: number } & Record<string, unknown>;

export interface ApplyResult {
  ok: boolean;
  template: AnyTemplate | null;
  templateHash: string | null;
  changedTargetHashes: Record<string, string>;
  appliedOperationIds: string[];
  problems: string[];
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

function findOverlay(t: AnyTemplate, pageId: string, overlayId: string): AnyOverlay | null {
  const page = (t.pages ?? []).find((p) => p.id === pageId);
  for (const b of page?.blocks ?? []) {
    const ov = (b.overlays ?? []).find((o) => o.id === overlayId);
    if (ov) return ov;
  }
  return null;
}
function findPage(t: AnyTemplate, pageId: string): AnyPage | null {
  return (t.pages ?? []).find((p) => p.id === pageId) ?? null;
}
function overlayHash(ov: AnyOverlay | null): string | null {
  return ov ? `ovh-${fnv1a32(stableJson({ x: ov.x, y: ov.y, width: ov.width, height: ov.height, zIndex: ov.zIndex, style: ov.style ?? null }))}` : null;
}
function pageHash(p: AnyPage | null): string | null {
  return p ? `pgh-${fnv1a32(stableJson({ size: p.size ?? null, meta: p.meta ?? null }))}` : null;
}

function num(v: unknown, k: string): number | undefined { const o = v as Record<string, unknown>; const n = o?.[k]; return typeof n === 'number' && Number.isFinite(n) ? n : undefined; }

/** Apply one operation in place on a cloned template. Returns problem codes. */
function applyOne(t: AnyTemplate, op: DeterministicRepairOperationV2): string[] {
  const problems: string[] = [];
  switch (op.kind) {
    case 'set-overlay-bounds': case 'set-image-bounds': {
      const ov = findOverlay(t, op.pageId, op.targetId);
      if (!ov) return ['target_not_found'];
      const x = num(op.after, 'x'), y = num(op.after, 'y'), w = num(op.after, 'width'), h = num(op.after, 'height');
      if (x == null || y == null || w == null || h == null) return ['invalid_after'];
      ov.x = x; ov.y = y; ov.width = w; ov.height = h;
      break;
    }
    case 'set-page-size': {
      const p = findPage(t, op.pageId); if (!p) return ['target_not_found'];
      const w = num(op.after, 'width'), h = num(op.after, 'height'); if (w == null || h == null) return ['invalid_after'];
      p.size = { ...(p.size ?? {}), width: w, height: h };
      break;
    }
    case 'set-text-font-size': case 'set-text-line-height': case 'set-text-letter-spacing':
    case 'set-text-word-spacing': case 'set-text-padding': {
      const ov = findOverlay(t, op.pageId, op.targetId); if (!ov) return ['target_not_found'];
      const v = num(op.after, 'value'); if (v == null) return ['invalid_after'];
      ov.style = { ...(ov.style ?? {}) };
      const key = { 'set-text-font-size': 'fontSize', 'set-text-line-height': 'lineHeight', 'set-text-letter-spacing': 'letterSpacing', 'set-text-word-spacing': 'wordSpacing', 'set-text-padding': 'padding' }[op.kind]!;
      (ov.style as Record<string, unknown>)[key] = v;
      break;
    }
    case 'set-text-white-space': {
      const ov = findOverlay(t, op.pageId, op.targetId); if (!ov) return ['target_not_found'];
      const val = (op.after as { value?: string })?.value;
      if (typeof val !== 'string') return ['invalid_after'];
      ov.style = { ...(ov.style ?? {}), whiteSpace: val };
      break;
    }
    case 'set-overlay-z-index': {
      const ov = findOverlay(t, op.pageId, op.targetId); if (!ov) return ['target_not_found'];
      const z = num(op.after, 'value'); if (z == null) return ['invalid_after'];
      ov.zIndex = z; ov.style = { ...(ov.style ?? {}), zIndex: z };
      break;
    }
    case 'set-image-fit': {
      const ov = findOverlay(t, op.pageId, op.targetId); if (!ov) return ['target_not_found'];
      const fit = (op.after as { value?: string })?.value; if (typeof fit !== 'string') return ['invalid_after'];
      (ov as Record<string, unknown>).imageFit = fit; ov.style = { ...(ov.style ?? {}), objectFit: fit };
      break;
    }
    case 'set-table-column-widths': case 'set-table-row-heights': {
      const ov = findOverlay(t, op.pageId, op.targetId); if (!ov) return ['target_not_found'];
      const arr = (op.after as { value?: number[] })?.value;
      if (!Array.isArray(arr) || arr.some((n) => !Number.isFinite(n) || n <= 0)) return ['invalid_after'];
      (ov as Record<string, unknown>)[op.kind === 'set-table-column-widths' ? 'columnWidths' : 'rowHeights'] = [...arr];
      break;
    }
    case 'select-table-candidate': {
      const ov = findOverlay(t, op.pageId, op.targetId); if (!ov) return ['target_not_found'];
      const cid = (op.after as { candidateId?: string })?.candidateId; if (!cid) return ['invalid_after'];
      ov.meta = { ...((ov.meta as Record<string, unknown>) ?? {}), tablePreservation: { ...(((ov.meta as Record<string, unknown>)?.tablePreservation as Record<string, unknown>) ?? {}), selectedCandidateId: cid } };
      break;
    }
    case 'select-typography-resolution': {
      const ov = findOverlay(t, op.pageId, op.targetId); if (!ov) return ['target_not_found'];
      const rid = (op.after as { resolutionId?: string })?.resolutionId; if (!rid) return ['invalid_after'];
      ov.meta = { ...((ov.meta as Record<string, unknown>) ?? {}), typographyPreservation: { ...(((ov.meta as Record<string, unknown>)?.typographyPreservation as Record<string, unknown>) ?? {}), resolvedFontAssetId: rid } };
      break;
    }
    case 'suppress-overlay': case 'restore-overlay-from-plan': case 'apply-region-render-plan': case 'set-region-output-strategy': {
      const p = findPage(t, op.pageId); if (!p) return ['target_not_found'];
      const meta = (p.meta = { ...(p.meta ?? {}) });
      const rout = (meta.pdfImportRegionOutput = { ...((meta.pdfImportRegionOutput as Record<string, unknown>) ?? {}) }) as Record<string, unknown>;
      const plan = (rout.renderPlan = { ...((rout.renderPlan as Record<string, unknown>) ?? {}) }) as Record<string, unknown>;
      const after = op.after as Record<string, unknown>;
      if (op.kind === 'suppress-overlay') {
        const set = new Set<string>([...(Array.isArray(plan.suppressedOverlayIds) ? plan.suppressedOverlayIds as string[] : []), op.targetId]);
        plan.suppressedOverlayIds = [...set].sort();
      } else if (op.kind === 'restore-overlay-from-plan') {
        plan.suppressedOverlayIds = (Array.isArray(plan.suppressedOverlayIds) ? plan.suppressedOverlayIds as string[] : []).filter((id) => id !== op.targetId);
      } else if (op.kind === 'apply-region-render-plan') {
        // replace the projection wholesale with the provided (already E6-resolved) plan
        if (after.renderPlan && typeof after.renderPlan === 'object') rout.renderPlan = clone(after.renderPlan);
      } else { // set-region-output-strategy — record selected strategy for the region
        const crops = Array.isArray(plan.finalRegionCrops) ? plan.finalRegionCrops as unknown[] : [];
        if (after.strategy === 'source-crop' && after.crop) plan.finalRegionCrops = [...crops.filter((c) => (c as { regionId?: string }).regionId !== op.targetId), clone(after.crop)];
      }
      if (typeof after.renderPlanHash === 'string') plan.renderPlanHash = after.renderPlanHash;
      break;
    }
    case 'set-page-output-strategy': {
      const p = findPage(t, op.pageId); if (!p) return ['target_not_found'];
      const strat = (op.after as { strategy?: string; policy?: unknown })?.strategy;
      const meta = (p.meta = { ...(p.meta ?? {}) });
      const policy = (meta.pdfImport = { ...((meta.pdfImport as Record<string, unknown>) ?? {}) }) as Record<string, unknown>;
      if (strat === 'raster-only') { policy.outputStrategy = 'raster-only'; policy.sourceRasterRole = 'final-output'; policy.nativeLayerPolicy = 'hidden'; }
      else if (strat === 'native') { policy.outputStrategy = 'native'; }
      if ((op.after as { policy?: unknown }).policy) Object.assign(policy, (op.after as { policy?: Record<string, unknown> }).policy);
      break;
    }
    default: return ['unknown_operation_kind'];
  }
  return problems;
}

export interface ApplyOptions {
  /** Validate each operation's expected target hash against the base template. */
  enforceTargetHash?: boolean;
}

/**
 * Apply a full candidate's operations atomically. All operations must be
 * forbidden-op-clean, precondition-valid, target-fresh, and individually
 * applicable — otherwise the whole candidate is rejected with no mutation.
 */
export function applyCandidateOperations(
  baseTemplate: AnyTemplate,
  operations: DeterministicRepairOperationV2[],
  ctx: SourceContext,
  options: ApplyOptions = {},
): ApplyResult {
  const problems: string[] = [];
  if (operations.length === 0) return { ok: false, template: null, templateHash: null, changedTargetHashes: {}, appliedOperationIds: [], problems: ['no_operations'] };
  if (operations.length > 6) return { ok: false, template: null, templateHash: null, changedTargetHashes: {}, appliedOperationIds: [], problems: ['operation_count_exceeds_bound'] };

  // 1. static validation (no mutation yet).
  for (const op of operations) {
    if (isForbiddenOperationKind(op.kind)) return reject(['forbidden_operation_kind']);
    const pre = validateOperationPreconditions(op, ctx);
    if (pre.length) return reject(pre.map((p) => `${op.kind}:${p}`));
    if (options.enforceTargetHash && op.expectedTargetHash != null) {
      const currentHash = op.kind.startsWith('set-page') || op.kind.includes('region') || op.kind.includes('page-output')
        ? pageHash(findPage(baseTemplate, op.pageId))
        : overlayHash(findOverlay(baseTemplate, op.pageId, op.targetId));
      if (currentHash !== op.expectedTargetHash) return reject([`stale_target:${op.id}`]);
    }
  }

  // 2. atomic apply on a clone.
  const draft = clone(baseTemplate);
  const applied: string[] = [];
  for (const op of operations) {
    const opProblems = applyOne(draft, op);
    if (opProblems.length) return reject(opProblems.map((p) => `${op.kind}:${p}`));
    applied.push(op.id);
  }

  // 3. structural sanity: finite numbers, no forbidden fields introduced.
  const struct = validateTemplateStructure(draft);
  if (struct.length) return reject(struct);

  // 4. changed target hashes.
  const changed: Record<string, string> = {};
  for (const op of operations) {
    const h = op.kind.startsWith('set-page') || op.kind.includes('region') || op.kind.includes('page-output')
      ? pageHash(findPage(draft, op.pageId)) : overlayHash(findOverlay(draft, op.pageId, op.targetId));
    if (h) changed[op.targetId] = h;
  }
  return { ok: true, template: draft, templateHash: hashTemplateProjection(templateProjection(draft)), changedTargetHashes: changed, appliedOperationIds: applied, problems };

  function reject(codes: string[]): ApplyResult {
    return { ok: false, template: null, templateHash: null, changedTargetHashes: {}, appliedOperationIds: [], problems: [...problems, ...codes] };
  }
}

/** A JSON-safe projection used for the deterministic template hash (URLs stripped upstream). */
export function templateProjection(t: AnyTemplate): unknown {
  return {
    pages: (t.pages ?? []).map((p) => ({
      id: p.id, size: p.size ?? null, meta: p.meta ?? null,
      blocks: (p.blocks ?? []).map((b) => ({ id: b.id, overlays: (b.overlays ?? []).map((o) => ({ id: o.id, x: o.x, y: o.y, width: o.width, height: o.height, zIndex: o.zIndex, style: o.style ?? null, meta: o.meta ?? null })) })),
    })),
  };
}

function validateTemplateStructure(t: AnyTemplate): string[] {
  const problems: string[] = [];
  for (const p of t.pages ?? []) {
    if (p.size && (!Number.isFinite(p.size.width) || !Number.isFinite(p.size.height))) problems.push('non_finite_page_size');
    for (const b of p.blocks ?? []) for (const o of b.overlays ?? []) {
      for (const k of ['x', 'y', 'width', 'height'] as const) if (o[k] != null && !Number.isFinite(o[k])) problems.push(`non_finite_overlay_${k}`);
      if (o.width != null && o.width < 0) problems.push('negative_overlay_width');
      if (o.height != null && o.height < 0) problems.push('negative_overlay_height');
      // never allow an invisible-text style
      const fs = (o.style as Record<string, unknown>)?.fontSize;
      if (typeof fs === 'number' && fs > 0 && fs < 6) problems.push('sub_readable_font_size');
      const op2 = (o.style as Record<string, unknown>)?.opacity;
      if (typeof op2 === 'number' && op2 === 0) problems.push('opacity_zero_suppression');
    }
  }
  return Array.from(new Set(problems));
}

export { overlayHash, pageHash };
