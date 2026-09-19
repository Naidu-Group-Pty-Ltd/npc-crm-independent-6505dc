/**
 * E8 — operation policy: source-evidence preconditions + safe bounds (pure).
 *
 * Every operation must PROVE why it is safe from immutable source evidence.
 * A missing precondition makes the operation invalid — E8 never "best-effort"s a
 * destructive change. Bounds cap native geometry/text corrections; anything
 * larger must fall back to a source crop. The forbidden-operation guard rejects
 * any legacy V1 op (replace_text / append_text_layer / set_bounds) and any
 * free-form patch, so E8 can never mutate or invent source content.
 */
import type { DeterministicRepairOperationV2, RepairOperationKind, RepairSourceEvidenceReferenceV1 } from './contracts';

// Legacy/forbidden op kinds that must NEVER appear in an E8 operation.
export const FORBIDDEN_OPERATION_KINDS: ReadonlySet<string> = new Set([
  'replace_text', 'append_text', 'append_text_layer', 'delete_text', 'set_bounds',
  'json_patch', 'set_path', 'set_css', 'set_html', 'set_url', 'add_coverage_layer',
  'set_opacity_zero', 'set_text_content',
]);

const KNOWN_KINDS: ReadonlySet<RepairOperationKind> = new Set<RepairOperationKind>([
  'set-overlay-bounds', 'set-page-size', 'set-text-font-size', 'set-text-line-height',
  'set-text-letter-spacing', 'set-text-word-spacing', 'set-text-padding', 'set-text-white-space',
  'set-overlay-z-index', 'set-image-fit', 'set-image-bounds', 'set-table-column-widths',
  'set-table-row-heights', 'select-table-candidate', 'select-typography-resolution',
  'suppress-overlay', 'restore-overlay-from-plan', 'apply-region-render-plan',
  'set-region-output-strategy', 'set-page-output-strategy',
]);

// ── Safe bounds ──────────────────────────────────────────────────────────────

export const OPERATION_BOUNDS = {
  maxPositionShiftPt: 12,
  maxPositionShiftFraction: 0.10,
  maxSizeChangeFraction: 0.20,
  maxFontReductionFraction: 0.125,
  minReadableFontPx: 6,
  maxFittingAttempts: 2,
  maxOperationsPerCandidate: 6,
} as const;

const SIGNED_URL_RE = /^(https?|blob):/i;
function durablePath(ref: string): boolean {
  return typeof ref === 'string' && ref.length > 0 && !SIGNED_URL_RE.test(ref) && !ref.startsWith('data:') && !ref.startsWith('/') && !ref.split('/').includes('..');
}
function hasEvidence(op: { sourceEvidence: RepairSourceEvidenceReferenceV1[] }, kind: RepairSourceEvidenceReferenceV1['kind']): boolean {
  return op.sourceEvidence.some((e) => e.kind === kind);
}
function num(v: unknown, k: string): number | undefined { const o = v as Record<string, unknown>; const n = o?.[k]; return typeof n === 'number' && Number.isFinite(n) ? n : undefined; }

// ── Forbidden-op guard ───────────────────────────────────────────────────────

/** Reject any legacy/free-form op kind. Called before anything else. */
export function isForbiddenOperationKind(kind: string): boolean {
  return FORBIDDEN_OPERATION_KINDS.has(kind) || !KNOWN_KINDS.has(kind as RepairOperationKind);
}

// ── Precondition validation ──────────────────────────────────────────────────

export interface SourceContext {
  /** exact source bbox for a target id (region/overlay). */
  sourceBBox?: Record<string, { x: number; y: number; width: number; height: number }>;
  /** page geometry. */
  pageWidthPt?: number; pageHeightPt?: number;
  /** durable crop refs (regionId → { path, hash, blank }). */
  cropAssets?: Record<string, { path: string; hash: string | null; blank: boolean }>;
  /** durable page raster (path/hash/dims/blank). */
  pageRaster?: { path: string; hash: string | null; widthPt: number; heightPt: number; blank: boolean } | null;
  /** available E4 table candidates with zero hard defects for a region. */
  tableCandidates?: Record<string, Array<{ candidateId: string; integrityValid: boolean; hardDefectCount: number; numericAssociationComplete: boolean; rowCount: number; columnCount: number }>>;
  /** available E5 typography resolutions for a run. */
  typographyResolutions?: Record<string, Array<{ resolutionId: string; state: string; exactContentPreserved: boolean }>>;
  /** E6 render plan projection (for suppression / policy ops). */
  hasRegionPlan?: boolean;
}

/** Validate one operation's source-evidence preconditions. Returns problem codes. */
export function validateOperationPreconditions(op: DeterministicRepairOperationV2, ctx: SourceContext): string[] {
  const problems: string[] = [];
  if (isForbiddenOperationKind(op.kind)) return ['forbidden_operation_kind'];
  for (const e of op.sourceEvidence) if (e.ref && !durablePath(e.ref) && e.kind !== 'e7-defect' && e.kind !== 'e7-dom-geometry' && e.kind !== 'source-bbox' && e.kind !== 'e6-region-policy' && e.kind !== 'e6-ownership' && e.kind !== 'source-scene-graph' && e.kind !== 'source-typography-run' && e.kind !== 'source-table-topology' && e.kind !== 'e4-candidate-integrity' && e.kind !== 'e5-font-resolution') problems.push('signed_url_in_evidence');

  switch (op.kind) {
    case 'set-overlay-bounds': case 'set-image-bounds': {
      const src = ctx.sourceBBox?.[op.targetId];
      if (!src) { problems.push('missing_source_bbox'); break; }
      if (!hasEvidence(op, 'source-bbox') && !hasEvidence(op, 'source-scene-graph')) problems.push('missing_source_bbox_evidence');
      const ax = num(op.after, 'x'), ay = num(op.after, 'y'), aw = num(op.after, 'width'), ah = num(op.after, 'height');
      if (ax == null || ay == null || aw == null || ah == null) { problems.push('invalid_bounds'); break; }
      if (aw <= 0 || ah <= 0) problems.push('negative_dimensions');
      if (ctx.pageWidthPt != null && ctx.pageHeightPt != null && (ax < -1 || ay < -1 || ax + aw > ctx.pageWidthPt + 1 || ay + ah > ctx.pageHeightPt + 1)) problems.push('result_off_page');
      // geometry adjustment bound vs source
      const shift = Math.hypot(ax - src.x, ay - src.y);
      const maxShift = Math.max(OPERATION_BOUNDS.maxPositionShiftPt, OPERATION_BOUNDS.maxPositionShiftFraction * Math.max(src.width, src.height));
      if (shift > maxShift + 0.5) problems.push('geometry_shift_exceeds_bound');
      const sizeChange = Math.max(Math.abs(aw - src.width) / Math.max(1, src.width), Math.abs(ah - src.height) / Math.max(1, src.height));
      if (sizeChange > OPERATION_BOUNDS.maxSizeChangeFraction + 1e-6) problems.push('geometry_size_exceeds_bound');
      break;
    }
    case 'set-text-font-size': {
      if (!hasEvidence(op, 'e5-font-resolution') && !hasEvidence(op, 'source-typography-run')) problems.push('missing_typography_evidence');
      const before = num(op.before, 'value'); const after = num(op.after, 'value');
      if (after == null || after < OPERATION_BOUNDS.minReadableFontPx) problems.push('font_below_readable_minimum');
      if (before != null && after != null && (before - after) / Math.max(1, before) > OPERATION_BOUNDS.maxFontReductionFraction + 1e-6) problems.push('font_reduction_exceeds_bound');
      break;
    }
    case 'set-text-line-height': case 'set-text-letter-spacing': case 'set-text-word-spacing': case 'set-text-padding': case 'set-text-white-space': {
      if (!hasEvidence(op, 'source-typography-run')) problems.push('missing_typography_evidence');
      break;
    }
    case 'set-overlay-z-index': {
      if (!hasEvidence(op, 'e6-ownership') && !hasEvidence(op, 'source-scene-graph')) problems.push('z_order_requires_evidence');
      break;
    }
    case 'set-image-fit': {
      if (!hasEvidence(op, 'source-bbox') && !hasEvidence(op, 'source-crop')) problems.push('missing_image_source_evidence');
      break;
    }
    case 'select-table-candidate': {
      const cands = ctx.tableCandidates?.[op.targetId] ?? [];
      const chosen = (op.after as { candidateId?: string })?.candidateId;
      const c = cands.find((x) => x.candidateId === chosen);
      if (!c) problems.push('table_candidate_unavailable');
      else {
        if (!c.integrityValid) problems.push('table_candidate_integrity_invalid');
        if (c.hardDefectCount > 0) problems.push('table_candidate_has_hard_defects');
        if (!c.numericAssociationComplete) problems.push('table_candidate_numeric_association_incomplete');
      }
      break;
    }
    case 'set-table-column-widths': case 'set-table-row-heights': {
      if (!hasEvidence(op, 'source-table-topology') && !hasEvidence(op, 'e4-candidate-integrity')) problems.push('missing_table_topology_evidence');
      break;
    }
    case 'select-typography-resolution': {
      const res = ctx.typographyResolutions?.[op.targetId] ?? [];
      const chosen = (op.after as { resolutionId?: string })?.resolutionId;
      const r = res.find((x) => x.resolutionId === chosen);
      if (!r) problems.push('typography_resolution_unavailable');
      else if (!r.exactContentPreserved) problems.push('typography_resolution_alters_content');
      break;
    }
    case 'suppress-overlay': case 'restore-overlay-from-plan': case 'apply-region-render-plan': {
      if (!ctx.hasRegionPlan && !hasEvidence(op, 'e6-region-policy')) problems.push('missing_region_plan');
      break;
    }
    case 'set-region-output-strategy': {
      const strat = (op.after as { strategy?: string })?.strategy;
      if (strat === 'source-crop') {
        const crop = ctx.cropAssets?.[op.targetId];
        if (!crop || !durablePath(crop.path)) problems.push('missing_source_crop');
        else if (crop.blank) problems.push('source_crop_blank');
      } else if (strat === 'native' || strat === 'native-with-source-reference') {
        // native must be independently E7-verified; the cascade enforces this — flag intent only.
        problems.push('native_promotion_requires_verified_candidate');
      }
      break;
    }
    case 'set-page-output-strategy': {
      const strat = (op.after as { strategy?: string })?.strategy;
      if (strat === 'raster-only') {
        if (!ctx.pageRaster || !durablePath(ctx.pageRaster.path)) problems.push('missing_page_raster');
        else if (ctx.pageRaster.blank) problems.push('page_raster_blank');
      }
      break;
    }
    case 'set-page-size': {
      const aw = num(op.after, 'width'), ah = num(op.after, 'height');
      if (aw == null || ah == null || aw <= 0 || ah <= 0) problems.push('invalid_page_size');
      break;
    }
    default: break;
  }
  return Array.from(new Set(problems));
}

export function isOperationValid(op: DeterministicRepairOperationV2, ctx: SourceContext): boolean {
  return validateOperationPreconditions(op, ctx).length === 0;
}
