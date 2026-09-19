/**
 * Operator "force fallback mode" for an imported template (Phase 8 review UI).
 *
 * Pure transform used by the import-review force-hybrid / force-pixel controls.
 * It only rewrites page backgrounds + overlay locks, reusing the same underlay
 * semantics the renderer honors (see `background.underlay`), so it composes
 * with `applyRepairedTemplateToRecord` to persist a new template version.
 *
 *   - hybrid        → keep the source raster as a dim, editor-only alignment
 *                     underlay behind editable overlays.
 *   - pixel-perfect → show the full-opacity source raster and lock every
 *                     overlay so the page reads exactly like the source.
 *
 * Pixel-perfect is only fully realisable when the page already carries a source
 * raster (`background.imageUrl`); pages without one keep their overlays but are
 * flagged so the caller can surface "no source raster to lock behind".
 */
import type { ReportTemplate } from '../templateSchema';

export type ForcedFidelityMode = 'hybrid' | 'pixel-perfect';

export const DEFAULT_UNDERLAY_OPACITY = 0.5;

export interface ApplyFidelityModeResult {
  template: ReportTemplate;
  pagesChanged: number;
  pagesWithoutRaster: number;
}

export function applyFidelityModeToTemplate(
  template: ReportTemplate,
  mode: ForcedFidelityMode,
): ApplyFidelityModeResult {
  let pagesChanged = 0;
  let pagesWithoutRaster = 0;

  const pages = template.pages.map((page) => {
    const background = { ...((page.background as Record<string, unknown>) ?? {}) };
    const hasRaster = Boolean(background.imageUrl);
    if (!hasRaster) pagesWithoutRaster += 1;

    if (mode === 'pixel-perfect') {
      if (hasRaster) {
        background.opacity = 1;
        background.underlay = false;
        if (!background.imageFit) background.imageFit = 'fill';
      }
      const blocks = page.blocks.map((block) => {
        const overlays = (block.overlays ?? []).map((overlay) =>
          overlay.locked ? overlay : { ...overlay, locked: true });
        return overlays === block.overlays ? block : { ...block, overlays };
      });
      pagesChanged += 1;
      return { ...page, background, blocks };
    }

    // hybrid
    if (hasRaster) {
      background.underlay = true;
      if (!background.imageFit) background.imageFit = 'fill';
      const opacity = background.opacity;
      if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity >= 1) {
        background.opacity = DEFAULT_UNDERLAY_OPACITY;
      }
      pagesChanged += 1;
    }
    return { ...page, background };
  });

  return {
    template: { ...template, pages } as ReportTemplate,
    pagesChanged,
    pagesWithoutRaster,
  };
}
