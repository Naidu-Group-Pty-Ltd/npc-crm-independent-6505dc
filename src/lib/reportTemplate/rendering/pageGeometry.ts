/**
 * pageGeometry — pure helpers for reasoning about page size and rectangles.
 *
 * Phase 7D fidelity hardening. The editor canvas, the HTML/WeasyPrint renderer,
 * and the Visual QA capture surface all need to agree on the page box and how
 * content rectangles map into it. These helpers are intentionally dependency-free
 * and side-effect-free so every surface can share one definition of "the page".
 *
 * Units are PDF points (pt), matching `PageSizeSchema` in templateSchema.
 */

export interface PageSize {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * US Letter at 72 dpi. A generic fallback only — the real page size always comes
 * from `page.size`. (The editor's own default is A4 595×842; this constant is a
 * last-resort guard for malformed input, not a document default.)
 */
export const DEFAULT_PAGE_SIZE: PageSize = {
  width: 612,
  height: 792,
};

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Coerce arbitrary input into a valid `PageSize`. Width and height must both be
 * finite positive numbers; anything else returns `fallback`.
 */
export function normalizePageSize(size: unknown, fallback: PageSize = DEFAULT_PAGE_SIZE): PageSize {
  if (!size || typeof size !== 'object') return { ...fallback };
  const candidate = size as { width?: unknown; height?: unknown };
  if (isFinitePositive(candidate.width) && isFinitePositive(candidate.height)) {
    return { width: candidate.width, height: candidate.height };
  }
  return { ...fallback };
}

/** Aspect ratio = width / height. Assumes a normalized (positive) size. */
export function getPageAspectRatio(size: PageSize): number {
  const normalized = normalizePageSize(size);
  return normalized.width / normalized.height;
}

/** The page's own bounding rect: origin at (0,0), full width/height. */
export function pageBounds(size: PageSize): Rect {
  const normalized = normalizePageSize(size);
  return { x: 0, y: 0, width: normalized.width, height: normalized.height };
}

/** Multiply every component of a rect by `scale` (uniform scale about the origin). */
export function scaleRect(rect: Rect, scale: number): Rect {
  const factor = Number.isFinite(scale) ? scale : 1;
  return {
    x: rect.x * factor,
    y: rect.y * factor,
    width: rect.width * factor,
    height: rect.height * factor,
  };
}

/**
 * Clamp a rect so it lies fully inside the page bounds. Never produces negative
 * width/height: a rect entirely outside the page collapses to a zero-area rect
 * on the nearest edge rather than inverting.
 */
export function fitRectToPage(rect: Rect, page: PageSize): Rect {
  const bounds = pageBounds(page);

  // Normalise any negative width/height on the input first.
  const left = Math.min(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);
  const right = Math.max(rect.x, rect.x + rect.width);
  const bottom = Math.max(rect.y, rect.y + rect.height);

  const clampedLeft = Math.max(bounds.x, Math.min(left, bounds.width));
  const clampedTop = Math.max(bounds.y, Math.min(top, bounds.height));
  const clampedRight = Math.max(bounds.x, Math.min(right, bounds.width));
  const clampedBottom = Math.max(bounds.y, Math.min(bottom, bounds.height));

  return {
    x: clampedLeft,
    y: clampedTop,
    width: Math.max(0, clampedRight - clampedLeft),
    height: Math.max(0, clampedBottom - clampedTop),
  };
}
