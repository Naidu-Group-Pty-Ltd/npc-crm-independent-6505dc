import type { Overlay } from '../../templateSchema';
import type { ImportAsset, ImportWarning, RawImportBlock, RawImportManifest, TemplateImportPlan } from './types';
import { stableImportId } from './ids';
import { buildBackgroundFirstImportPlan } from './planBuilder';
import { resolveTextWrapping } from '../../pdfImport/resolveTextWrapping.pure';

export interface HybridPlanOptions {
  importId?: string;
  minEditableConfidence?: number;
  unlockConfidence?: number;
  maxEditableElementsPerPage?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normaliseFontWeight(value: unknown): 'normal' | 'bold' {
  if (value === 'bold') return 'bold';
  if (value === 'normal') return 'normal';
  const n = Number(value);
  return Number.isFinite(n) && n >= 600 ? 'bold' : 'normal';
}

function rawTextBlockToOverlay(block: RawImportBlock, unlockConfidence: number): Overlay | null {
  const content = block.text?.trim();
  if (!content) return null;
  const confidence = clamp01(block.confidence);
  const fontSize = finiteOr(block.style?.fontSize, Math.max(8, Math.min(72, block.bbox.height * 0.72)));
  const lineHeight = block.style?.lineHeight ?? 1.2;
  // Same decision as the Docling mapper, from the same module: text the source
  // set on one line must not gain a second, and text the source set on two must
  // not be forced onto one. This path has no width measurer, so it decides on
  // the source's line count when one was recorded and on box geometry when not.
  const wrapping = resolveTextWrapping({
    text: content,
    boxWidthPt: Math.max(1, finiteOr(block.bbox.width, 1)),
    boxHeightPt: finiteOr(block.bbox.height, fontSize * 1.3),
    fontSizePt: fontSize,
    lineHeight,
    letterSpacingPt: block.style?.letterSpacing ?? 0,
    fontFamily: block.style?.fontFamily ?? 'Inter',
    sourceLineCount: block.meta?.sourceLineCount ?? null,
    sourceBaselineCount: block.meta?.sourceBaselineCount ?? null,
    sourceAlign: block.style?.textAlign ?? null,
  });
  return {
    id: stableImportId('text', block.id),
    type: 'text',
    x: finiteOr(block.bbox.x, 0),
    y: finiteOr(block.bbox.y, 0),
    width: Math.max(1, finiteOr(block.bbox.width, 1)),
    height: Math.max(1, finiteOr(block.bbox.height, fontSize * 1.3)),
    rotation: 0,
    opacity: 1,
    content,
    fontFamily: block.style?.fontFamily ?? 'Inter',
    fontSize,
    fontWeight: normaliseFontWeight(block.style?.fontWeight),
    fontStyle: 'normal',
    color: block.style?.color ?? '#111111',
    align: block.style?.textAlign ?? 'left',
    // Phase 2: prefer real leading/tracking from the extractor when present.
    lineHeight,
    letterSpacing: block.style?.letterSpacing ?? 0,
    ...(wrapping.nowrap ? { whiteSpace: 'nowrap' as const } : {}),
    locked: confidence < unlockConfidence,
    confidence,
    name: `Imported text · ${block.source}`,
  };
}

function pageWarningsForSkippedBlocks(pageId: string, skippedLowConfidence: number, capped: number): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  if (skippedLowConfidence > 0) {
    warnings.push({
      code: 'low_confidence_text_skipped',
      severity: 'warning',
      pageId,
      message: `${skippedLowConfidence} low-confidence text block(s) were kept in the locked background instead of becoming editable overlays.`,
    });
  }
  if (capped > 0) {
    warnings.push({
      code: 'editable_element_cap_reached',
      severity: 'warning',
      pageId,
      message: `${capped} text block(s) were not converted because the page editable-element cap was reached.`,
    });
  }
  return warnings;
}

/**
 * Build a hybrid plan: deterministic reference background plus editable text
 * overlays only when raw extraction confidence is high enough. This is the
 * non-creative first reconciliation pass before any external AI provider runs.
 */
export function buildHybridImportPlanFromManifests(
  asset: ImportAsset,
  manifests: RawImportManifest[],
  options: HybridPlanOptions = {},
): TemplateImportPlan {
  // Phase 4: lowered (0.65 → 0.6 / 0.85 → 0.75) now that reconstruction is faithful.
  // Lower minEditableConfidence keeps fewer blocks in the locked raster background
  // (higher native coverage); lower unlockConfidence makes more overlays editable.
  const minEditableConfidence = options.minEditableConfidence ?? 0.6;
  const unlockConfidence = options.unlockConfidence ?? 0.75;
  const maxEditableElementsPerPage = options.maxEditableElementsPerPage ?? 150;
  const plan = buildBackgroundFirstImportPlan(asset, {
    importId: options.importId ?? asset.fileId,
    confidenceScore: manifests.length ? 0.82 : 1,
  });

  let editableElementsCreated = 0;
  const allWarnings: ImportWarning[] = [...plan.warnings];

  for (const page of plan.pages) {
    const manifest = manifests.find((m) => m.page.id === page.sourcePageId || m.page.pageIndex === asset.pages.find((p) => p.id === page.sourcePageId)?.pageIndex);
    if (!manifest) continue;

    let skippedLowConfidence = 0;
    let capped = 0;
    const overlays: Overlay[] = [];
    for (const block of manifest.rawBlocks) {
      if (block.type !== 'text') continue;
      if (block.confidence < minEditableConfidence) {
        skippedLowConfidence += 1;
        continue;
      }
      if (overlays.length >= maxEditableElementsPerPage) {
        capped += 1;
        continue;
      }
      const overlay = rawTextBlockToOverlay(block, unlockConfidence);
      if (overlay) overlays.push(overlay);
    }

    page.overlays = overlays;
    page.warnings = [...page.warnings, ...pageWarningsForSkippedBlocks(page.id, skippedLowConfidence, capped)];
    allWarnings.push(...page.warnings);
    editableElementsCreated += overlays.length;
  }

  return {
    ...plan,
    warnings: allWarnings,
    confidenceScore: editableElementsCreated > 0 ? 0.86 : plan.confidenceScore,
    importSummary: {
      visualFidelityMode: 'hybrid',
      editableElementsCreated,
      manualReviewRequired: allWarnings.length > 0,
      repairPassesApplied: 0,
    },
  };
}
