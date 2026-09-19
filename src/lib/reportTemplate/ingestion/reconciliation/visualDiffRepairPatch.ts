/**
 * visual-diff-repair-patch-v1 (Path-to-100 v2 · C9).
 *
 * Runtime-validated, page-scoped AI visual-repair patches. This replaces the
 * unsafe `patches as TemplateImportPatch[]` cast: model-authored output is
 * untrusted and MUST pass a Zod schema + an allowlist before it can touch a
 * template. The corrected policy (repo safety amendment) is:
 *
 *   - AI repair runs ONLY on an explicit operator action — never automatically.
 *   - The response is validated here, applied by the DEDICATED
 *     `applyVisualDiffRepairPatch` (never `applyTemplateImportPlan`), then
 *     re-scored and explicitly applied by the operator.
 *   - The allowlist rejects: unknown/malformed ops, cross-page ids, text-content
 *     edits (the source text is authoritative — AI never invents or rewrites it),
 *     added text overlays, and anything over the per-request operation cap.
 *   - Page add / delete / reorder is unrepresentable in the envelope and can
 *     never be requested.
 *
 * Pure and deterministic; the audit records operation metadata only (no overlay
 * content, no signed URLs).
 */
import { z } from 'zod';
import { OverlaySchema, parseTemplate, type Overlay, type ReportTemplate } from '../../templateSchema';
import type { TemplateImportPatch } from './types';

export const VISUAL_DIFF_REPAIR_PATCH_VERSION = 'visual-diff-repair-patch-v1';
export const DEFAULT_MAX_REPAIR_OPERATIONS = 20;

/**
 * Fields a visual-repair patch may never touch. The source text content and
 * its rendering mode are authoritative — a visual repair aligns geometry, it
 * does not rewrite text or switch to an alternate text/HTML representation.
 */
const FORBIDDEN_CHANGE_FIELDS = ['content', 'text', 'runs', 'rich'] as const;
const TEXT_OVERLAY_TYPES = new Set(['text', 'textOnPath']);

const UpdatePageBackgroundPatchSchema = z.object({
  operation: z.literal('updatePageBackground'),
  pageId: z.string().min(1),
  changes: z.object({
    color: z.string().optional(),
    imageUrl: z.string().optional(),
    opacity: z.number().optional(),
    underlay: z.boolean().optional(),
    imageFit: z.string().optional(),
  }).strict(),
}).strict();

const UpdateOverlayPatchSchema = z.object({
  operation: z.literal('updateOverlay'),
  pageId: z.string().min(1),
  blockId: z.string().min(1),
  overlayId: z.string().min(1),
  changes: z.record(z.unknown()),
}).strict();

const AddOverlayPatchSchema = z.object({
  operation: z.literal('addOverlay'),
  pageId: z.string().min(1),
  blockId: z.string().min(1),
  overlay: z.record(z.unknown()),
}).strict();

const RemoveOverlayPatchSchema = z.object({
  operation: z.literal('removeOverlay'),
  pageId: z.string().min(1),
  blockId: z.string().min(1),
  overlayId: z.string().min(1),
  reason: z.string().min(1),
}).strict();

export const VisualDiffRepairPatchSchema = z.discriminatedUnion('operation', [
  UpdatePageBackgroundPatchSchema,
  UpdateOverlayPatchSchema,
  AddOverlayPatchSchema,
  RemoveOverlayPatchSchema,
]);

export type VisualDiffRepairPatch = z.infer<typeof VisualDiffRepairPatchSchema>;

export interface VisualDiffRepairRejection {
  index: number;
  operation: string | null;
  reason: string;
}

export interface VisualDiffRepairValidation {
  version: typeof VISUAL_DIFF_REPAIR_PATCH_VERSION;
  pageId: string;
  valid: VisualDiffRepairPatch[];
  rejected: VisualDiffRepairRejection[];
  requested: number;
}

export interface ValidateVisualDiffRepairOptions {
  pageId: string;
  maxOperations?: number;
}

function operationOf(item: unknown): string | null {
  const op = (item as { operation?: unknown } | null)?.operation;
  return typeof op === 'string' ? op : null;
}

function touchesForbiddenText(changes: Record<string, unknown>): boolean {
  return FORBIDDEN_CHANGE_FIELDS.some((field) => field in changes);
}

/**
 * Validate a raw model-authored patch array against the allowlist, scoped to a
 * single page. Never throws — invalid patches are collected with a reason so the
 * operator sees exactly what was refused.
 */
export function validateVisualDiffRepairPatches(
  raw: unknown,
  options: ValidateVisualDiffRepairOptions,
): VisualDiffRepairValidation {
  const pageId = options.pageId;
  const max = Math.max(0, options.maxOperations ?? DEFAULT_MAX_REPAIR_OPERATIONS);
  const valid: VisualDiffRepairPatch[] = [];
  const rejected: VisualDiffRepairRejection[] = [];

  if (!Array.isArray(raw)) {
    return {
      version: VISUAL_DIFF_REPAIR_PATCH_VERSION,
      pageId,
      valid,
      rejected: [{ index: -1, operation: null, reason: 'patch payload is not an array' }],
      requested: 0,
    };
  }

  raw.forEach((item, index) => {
    if (valid.length >= max) {
      rejected.push({ index, operation: operationOf(item), reason: `exceeds max ${max} operations per request` });
      return;
    }
    const parsed = VisualDiffRepairPatchSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push({ index, operation: operationOf(item), reason: 'unknown or malformed operation' });
      return;
    }
    const patch = parsed.data;
    if (patch.pageId !== pageId) {
      rejected.push({ index, operation: patch.operation, reason: `cross-page patch not allowed (${patch.pageId} != ${pageId})` });
      return;
    }
    if (patch.operation === 'updateOverlay' && touchesForbiddenText(patch.changes)) {
      rejected.push({ index, operation: patch.operation, reason: 'text-content edits are not permitted' });
      return;
    }
    if (patch.operation === 'addOverlay') {
      const type = (patch.overlay as { type?: unknown }).type;
      if (typeof type === 'string' && TEXT_OVERLAY_TYPES.has(type)) {
        rejected.push({ index, operation: patch.operation, reason: 'adding text overlays (new text content) is not permitted' });
        return;
      }
    }
    valid.push(patch);
  });

  return { version: VISUAL_DIFF_REPAIR_PATCH_VERSION, pageId, valid, rejected, requested: raw.length };
}

/**
 * Lenient shape validation for the legacy document-level repair path: keep only
 * well-formed patches (drops the unsafe `as` cast) without the single-page
 * scoping. Text-content edits and added text overlays are still refused.
 */
export function filterWellFormedRepairPatches(raw: unknown): TemplateImportPatch[] {
  if (!Array.isArray(raw)) return [];
  const out: VisualDiffRepairPatch[] = [];
  for (const item of raw) {
    const parsed = VisualDiffRepairPatchSchema.safeParse(item);
    if (!parsed.success) continue;
    const patch = parsed.data;
    if (patch.operation === 'updateOverlay' && touchesForbiddenText(patch.changes)) continue;
    if (patch.operation === 'addOverlay') {
      const type = (patch.overlay as { type?: unknown }).type;
      if (typeof type === 'string' && TEXT_OVERLAY_TYPES.has(type)) continue;
    }
    out.push(patch);
  }
  // Post-validation assertion: every element passed the Zod envelope schema, so
  // the runtime shape satisfies TemplateImportPatch (overlay bodies are further
  // validated against OverlaySchema at apply time). This is the guarded
  // replacement for the old blind `patches as TemplateImportPatch[]` cast.
  return out as unknown as TemplateImportPatch[];
}

export interface ApplyVisualDiffRepairResult {
  template: ReportTemplate;
  pageId: string;
  applied: number;
  rejected: VisualDiffRepairRejection[];
  appliedPatches: VisualDiffRepairPatch[];
  changed: boolean;
}

function validateOverlayBody(overlay: unknown): Overlay | null {
  const parsed = OverlaySchema.safeParse(overlay);
  return parsed.success ? parsed.data : null;
}

/**
 * Apply validated visual-repair patches to a SINGLE page. Only the target page
 * is ever touched — every other page keeps its identity — so an AI repair can
 * never leak into another page. Dedicated to visual repair: it does NOT reuse
 * `applyTemplateImportPlan`.
 */
export function applyVisualDiffRepairPatch(
  template: ReportTemplate,
  pageId: string,
  rawPatches: unknown,
  options: { maxOperations?: number } = {},
): ApplyVisualDiffRepairResult {
  const validation = validateVisualDiffRepairPatches(rawPatches, { pageId, maxOperations: options.maxOperations });
  const rejected = [...validation.rejected];
  const empty: ApplyVisualDiffRepairResult = {
    template, pageId, applied: 0, rejected, appliedPatches: [], changed: false,
  };
  if (validation.valid.length === 0) return empty;

  const draft = JSON.parse(JSON.stringify(template)) as { pages?: Array<Record<string, any>> };
  const pageIndex = draft.pages?.findIndex((p) => p.id === pageId) ?? -1;
  if (pageIndex < 0 || !draft.pages) {
    return { ...empty, rejected: [...rejected, { index: -1, operation: null, reason: `page ${pageId} not found` }] };
  }
  const page = draft.pages[pageIndex];
  const appliedPatches: VisualDiffRepairPatch[] = [];

  validation.valid.forEach((patch, i) => {
    if (patch.operation === 'updatePageBackground') {
      if (patch.changes.imageUrl === '') {
        rejected.push({ index: i, operation: patch.operation, reason: 'cannot remove the preserved reference background image' });
        return;
      }
      page.background = { ...(page.background ?? {}), ...patch.changes };
      appliedPatches.push(patch);
      return;
    }

    const block = page.blocks?.find((b: any) => b.id === patch.blockId);
    if (!block) {
      rejected.push({ index: i, operation: patch.operation, reason: `unknown block ${patch.blockId}` });
      return;
    }
    block.overlays = Array.isArray(block.overlays) ? block.overlays : [];

    if (patch.operation === 'addOverlay') {
      const overlay = validateOverlayBody(patch.overlay);
      if (!overlay) {
        rejected.push({ index: i, operation: patch.operation, reason: 'added overlay is not schema-valid' });
        return;
      }
      block.overlays.push(overlay);
      appliedPatches.push(patch);
      return;
    }

    const overlayIndex = block.overlays.findIndex((o: any) => o.id === patch.overlayId);
    if (overlayIndex < 0) {
      rejected.push({ index: i, operation: patch.operation, reason: `unknown overlay ${patch.overlayId}` });
      return;
    }

    if (patch.operation === 'removeOverlay') {
      block.overlays.splice(overlayIndex, 1);
      appliedPatches.push(patch);
      return;
    }

    // updateOverlay — preserve identity and every text-bearing/rendering field
    // as defense in depth; model-authored changes may only adjust visual layout.
    const current = block.overlays[overlayIndex];
    const updated = {
      ...current,
      ...patch.changes,
      id: current.id,
      type: current.type,
      content: current.content,
      runs: current.runs,
      rich: current.rich,
    };
    const overlay = validateOverlayBody(updated);
    if (!overlay) {
      rejected.push({ index: i, operation: patch.operation, reason: `updated overlay ${patch.overlayId} is not schema-valid` });
      return;
    }
    block.overlays[overlayIndex] = overlay;
    appliedPatches.push(patch);
  });

  if (appliedPatches.length === 0) {
    return { ...empty, rejected };
  }
  return { template: parseTemplate(draft), pageId, applied: appliedPatches.length, rejected, appliedPatches, changed: true };
}

export interface VisualDiffRepairAuditOperation {
  operation: string;
  blockId?: string;
  overlayId?: string;
}

export interface VisualDiffRepairAudit {
  version: typeof VISUAL_DIFF_REPAIR_PATCH_VERSION;
  pageId: string;
  requestedOperations: number;
  appliedOperations: number;
  rejectedOperations: number;
  rejected: VisualDiffRepairRejection[];
  operations: VisualDiffRepairAuditOperation[];
  decidedAt: string;
  decidedBy: 'operator';
}

/**
 * Build the persisted audit for an operator AI repair. Records operation
 * metadata (op + ids) only — never overlay content and never signed URLs.
 */
export function buildVisualDiffRepairAudit(
  result: ApplyVisualDiffRepairResult,
  options: { requestedOperations: number; decidedAt?: string } = { requestedOperations: 0 },
): VisualDiffRepairAudit {
  return {
    version: VISUAL_DIFF_REPAIR_PATCH_VERSION,
    pageId: result.pageId,
    requestedOperations: options.requestedOperations,
    appliedOperations: result.applied,
    rejectedOperations: result.rejected.length,
    rejected: result.rejected,
    operations: result.appliedPatches.map((patch) => ({
      operation: patch.operation,
      blockId: 'blockId' in patch ? patch.blockId : undefined,
      overlayId: 'overlayId' in patch ? patch.overlayId : undefined,
    })),
    decidedAt: options.decidedAt ?? new Date().toISOString(),
    decidedBy: 'operator',
  };
}
