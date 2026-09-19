/**
 * paintOrder — single source of truth for content stacking heuristics.
 *
 * The editor canvas (`EditorialCanvas`), the production HTML/WeasyPrint
 * renderer (`htmlRenderer`) and the legacy jsPDF renderer (`pdfRenderer`)
 * must stack overlays and blocks identically, otherwise what you see in the
 * editor is not what exports. These heuristics used to be copy-pasted into
 * each surface; keep them here and import — never re-implement.
 *
 * Stacking rules (bottom → top) when no explicit `zIndex` is set:
 *   backdrop shapes AND backdrop vectors (area > 120k pt², no stroke)
 *   < other shapes < images < unknown types < tables < text / textOnPath
 *
 * An explicit `zIndex` always wins, and the original array index acts as a
 * stable tie-breaker so equal-priority items keep their authored order.
 *
 * BACKDROP VECTORS: a PDF import reconstructs the page's background fill as a
 * `vector` overlay — a single full-page path, not a CSS background. `vector`
 * had no case here, so it fell through to the unranked band (`index`) and
 * painted ABOVE images, which sit at −10k. A page-covering backdrop therefore
 * covered every image on its page: in the BC Snapshot render the brand
 * monogram was embedded, correctly placed, and then buried under an opaque
 * #251F18 fill emitted after it. Text survived only because text ranks higher
 * still, which is what made the defect look like "the logo is missing" rather
 * than "the page paints in the wrong order".
 *
 * Only page-covering, fill-only vectors move. Ornament vectors — rules,
 * diamonds, the border frame's smaller siblings — keep their authored
 * position, so nothing that currently paints over an image stops doing so.
 */

/** Minimal structural shape needed to rank an overlay. */
export interface PaintableOverlay {
  type?: string;
  zIndex?: number | null;
  width?: number | null;
  height?: number | null;
  strokeWidth?: number | null;
}

/** Minimal structural shape needed to rank a block. */
export interface PaintableBlock {
  type?: string;
  style?: { zIndex?: number | null } | null;
  overlays?: PaintableOverlay[] | null;
}

/** Area (pt²) at or above which a fill-only shape/vector counts as a backdrop. */
export const BACKDROP_AREA_PT2 = 120_000;

/** Sort key for one overlay within its block (lower paints first). */
export function overlayPaintOrder(overlay: PaintableOverlay, index: number): number {
  const z = Number(overlay?.zIndex);
  if (Number.isFinite(z)) return z * 1000 + index;
  const area = Math.max(0, Number(overlay?.width) || 0) * Math.max(0, Number(overlay?.height) || 0);
  // A `vector` backdrop is the same thing as a `shape` backdrop — the importer
  // just reconstructs page fills as paths. Rank them together.
  const isBackdrop = (overlay?.type === 'shape' || overlay?.type === 'vector')
    && area > BACKDROP_AREA_PT2
    && !overlay?.strokeWidth;
  if (isBackdrop) return -1_000_000 + index;
  if (overlay?.type === 'shape') return -100_000 + index;
  if (overlay?.type === 'image') return -10_000 + index;
  if (overlay?.type === 'table') return 100_000 + index;
  if (overlay?.type === 'text' || overlay?.type === 'textOnPath') return 200_000 + index;
  return index;
}

/** Stable-sorts overlays into paint order (bottom first). */
export function sortOverlaysForPaint<T extends PaintableOverlay>(overlays: T[] = []): T[] {
  return overlays
    .map((overlay, index) => ({ overlay, order: overlayPaintOrder(overlay, index) }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.overlay);
}

/** Sort key for one block within its page (lower paints first). */
export function blockPaintOrder(block: PaintableBlock, index: number): number {
  const z = Number(block?.style?.zIndex);
  if (Number.isFinite(z)) return z * 1_000_000 + index;
  const overlays = Array.isArray(block?.overlays) ? block.overlays : [];
  if (block?.type === 'free' && overlays.length) {
    return Math.min(...overlays.map((overlay, overlayIndex) => overlayPaintOrder(overlay, overlayIndex))) + index / 10_000;
  }
  return index;
}

/** Stable-sorts blocks into paint order (bottom first). */
export function sortBlocksForPaint<T extends PaintableBlock>(blocks: T[] = []): T[] {
  return blocks
    .map((block, index) => ({ block, order: blockPaintOrder(block, index) }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.block);
}
