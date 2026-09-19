/**
 * Photographs before floor plans, everywhere imagery is ordered.
 *
 * Agency pages usually emit their gallery in DOM order, and a large share of
 * them lead with the floor plan — it is the first asset the agent uploads.
 * Carried through unchanged, that ordering made the marketplace's hero slots
 * open on architectural line drawings: accurate, but the opposite of what
 * makes someone stop scrolling. A buyer's first glance should be the property;
 * the plan is reference material and belongs at the end of the carousel, not
 * the front.
 *
 * This module is the cheap, URL-based half of that judgement, shared by the
 * scraper (Deno) and the browser. It is deliberately conservative: a URL that
 * merely *might* be a plan is left alone, because demoting a photograph is a
 * worse error than leading with a plan. The browser adds a second, visual
 * classifier for the URLs that carry no hint at all (hashed CDN paths); see
 * `src/lib/imageKind.ts`.
 *
 * Pure: no Deno, no DOM, no imports.
 */

/**
 * URL smells that say "this is a plan, not a photograph".
 *
 * Matched against the whole URL, case-insensitively:
 * - floorplan / floor-plan / floor_plan / floorplans
 * - siteplan / site-plan, titleplan / title-plan, lotplan / lot-plan
 * - a /plan/ or /plans/ path segment
 * - a filename that is exactly fp<digits> (agentbox's floor-plan asset naming)
 */
const FLOORPLAN_TOKENS =
  /floor[-_]?plans?|site[-_]?plan|title[-_]?plan|lot[-_]?plan|\/plans?\/|\/fp\d+\.(?:png|jpe?g|webp|gif)(?:$|\?)/i;

export function looksLikeFloorplanUrl(url: string): boolean {
  return FLOORPLAN_TOKENS.test(url);
}

/**
 * Stable partition: everything that does not look like a plan keeps its order
 * at the front; everything that does keeps its order at the back.
 */
export function orderImagesPhotosFirst<T>(items: readonly T[], urlOf: (item: T) => string): T[] {
  const photos: T[] = [];
  const plans: T[] = [];
  for (const item of items) {
    (looksLikeFloorplanUrl(urlOf(item)) ? plans : photos).push(item);
  }
  return photos.concat(plans);
}
