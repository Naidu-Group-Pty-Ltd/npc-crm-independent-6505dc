import { OverlaySchema, type Overlay } from '../../templateSchema';
import type { ImportWarning, PlanValidationResult, TemplateImportPlan } from './types';

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function warning(code: string, message: string, pageId?: string): ImportWarning {
  return { code, message, severity: 'warning', pageId };
}

/** Reconciliation input is untrusted and must not enable the raw-HTML renderer. */
export function validateReconciliationOverlay(overlay: unknown): Overlay | null {
  const parsed = OverlaySchema.safeParse(overlay);
  if (!parsed.success) return null;
  if (parsed.data.type === 'text' && parsed.data.rich === true) return null;
  return parsed.data;
}

export function validateTemplateImportPlan(plan: TemplateImportPlan): PlanValidationResult {
  const errors: string[] = [];
  const warnings: ImportWarning[] = [...(plan.warnings ?? [])];

  if (!plan || plan.version !== 1) errors.push('Import plan must be version 1.');
  if (!Array.isArray(plan.pages) || plan.pages.length === 0) errors.push('Import plan must contain at least one page.');
  if (!isFiniteNumber(plan.confidenceScore) || plan.confidenceScore < 0 || plan.confidenceScore > 1) {
    errors.push('Import plan confidenceScore must be between 0 and 1.');
  }

  for (const page of plan.pages ?? []) {
    if (!page.id) errors.push('Every import page must have an id.');
    if (!isFinitePositive(page.width) || !isFinitePositive(page.height)) {
      errors.push(`Page ${page.id || '(missing id)'} must have positive width and height.`);
    }
    // Semantic plans intentionally discard the source raster so omitted or
    // redacted source content cannot survive as a hidden renderable asset.
    if (plan.importSummary?.visualFidelityMode !== 'semantic' && !page.background?.imageUrl) {
      errors.push(`Page ${page.id || '(missing id)'} must preserve a reference background image.`);
    }
    if (page.background?.opacity !== undefined && (page.background.opacity < 0 || page.background.opacity > 1)) {
      errors.push(`Page ${page.id || '(missing id)'} background opacity must be between 0 and 1.`);
    }
    for (const overlay of page.overlays ?? []) {
      const o = validateReconciliationOverlay(overlay);
      if (!o) {
        errors.push(`Overlay ${(overlay as any)?.id || '(missing id)'} on page ${page.id} is not schema-valid.`);
        continue;
      }
      if (!isFiniteNumber(o.x) || !isFiniteNumber(o.y) || !isFinitePositive(o.width) || !isFinitePositive(o.height)) {
        errors.push(`Overlay ${o.id} on page ${page.id} has invalid bounds.`);
      }
      if (o.confidence !== undefined) {
        if (o.confidence < 0 || o.confidence > 1) errors.push(`Overlay ${o.id} confidence must be between 0 and 1.`);
        if (o.confidence < 0.65 && !o.locked) warnings.push(warning('low_confidence_unlocked', `Overlay ${o.id} is low confidence and should be locked.`, page.id));
      }
      const offPageMargin = Math.max(page.width, page.height) * 0.25;
      if (o.x < -offPageMargin || o.y < -offPageMargin || o.x > page.width + offPageMargin || o.y > page.height + offPageMargin) {
        warnings.push(warning('overlay_far_outside_page', `Overlay ${o.id} is far outside the page bounds.`, page.id));
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function assertValidTemplateImportPlan(plan: TemplateImportPlan): TemplateImportPlan {
  const validation = validateTemplateImportPlan(plan);
  if (!validation.ok) throw new Error(`Invalid template import plan: ${validation.errors.join(' ')}`);
  return plan;
}
