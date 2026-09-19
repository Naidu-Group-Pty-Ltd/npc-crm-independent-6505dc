import type { ImportAsset, TemplateImportPlan } from './types';
import { stableImportId } from './ids';

export interface BackgroundFirstPlanOptions {
  importId?: string;
  pageNamePrefix?: string;
  confidenceScore?: number;
}

/**
 * Deterministic baseline import plan: preserve every imported page as the page
 * background and create no editable overlays. This is the safe fallback for all
 * AI/OCR failures and the first pass for hybrid reconciliation.
 */
export function buildBackgroundFirstImportPlan(
  asset: ImportAsset,
  options: BackgroundFirstPlanOptions = {},
): TemplateImportPlan {
  const importId = options.importId ?? asset.fileId;
  const pages = asset.pages.map((page) => ({
    id: stableImportId('page', page.id || page.pageIndex),
    name: `${options.pageNamePrefix ?? 'Imported page'} ${page.pageIndex + 1}`,
    width: page.width,
    height: page.height,
    background: {
      color: page.backgroundColor,
      imageUrl: page.referenceImageUrl,
      opacity: 1,
      // Full-page source raster must fill the exact page box, never crop/stretch.
      ...(page.referenceImageUrl ? { imageFit: 'fill' as const } : {}),
    },
    overlays: [],
    sourcePageId: page.id,
    warnings: [],
  }));

  const warnings = pages.length
    ? []
    : [{ code: 'no_import_pages', message: 'Import asset did not contain any renderable pages.', severity: 'error' as const }];

  return {
    version: 1,
    importId,
    pages,
    warnings,
    confidenceScore: options.confidenceScore ?? (pages.length ? 1 : 0),
    importSummary: {
      visualFidelityMode: 'background-first',
      editableElementsCreated: 0,
      manualReviewRequired: warnings.length > 0,
      repairPassesApplied: 0,
    },
  };
}
