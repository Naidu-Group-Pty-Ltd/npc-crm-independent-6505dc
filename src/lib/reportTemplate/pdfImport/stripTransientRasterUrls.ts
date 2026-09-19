import type { ReportTemplate } from '../templateSchema';

/**
 * Removes render-time raster URLs from pages that carry a durable Storage
 * reference. Persisted schemas must rely on sourceRasterRef so each render can
 * mint a fresh, caller-scoped URL instead of retaining an expiring signed URL.
 */
export function stripTransientRasterUrls(template: ReportTemplate): ReportTemplate {
  let changed = false;
  const pages = template.pages.map((page) => {
    const rasterPath = (page.meta as { sourceRasterRef?: { path?: unknown } } | undefined)
      ?.sourceRasterRef?.path;
    if (typeof rasterPath !== 'string' || !rasterPath || !page.background?.imageUrl) {
      return page;
    }

    changed = true;
    const { imageUrl: _transientImageUrl, ...background } = page.background;
    return { ...page, background };
  });

  return changed ? { ...template, pages } : template;
}
