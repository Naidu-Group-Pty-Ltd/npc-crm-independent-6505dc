/**
 * Drag-and-drop "drop to place" helpers for the V2 canvas (rehaul Phase 1).
 *
 * Free-placed elements are overlays — which both renderers already position
 * absolutely — so dropping a palette item onto the canvas just creates an
 * overlay of the matching kind at the drop point. Pure + unit-tested; the
 * defaults mirror the palette in `PagesPanel.tsx`.
 */
import { BlockSchema, OverlaySchema, type Block, type Overlay } from './templateSchema';

export interface DropPoint {
  x: number;
  y: number;
}

/** Overlay kinds that can be dragged from the palette onto the canvas. */
export type DraggableOverlayKind = 'text' | 'rect' | 'image';

/** MIME-ish key used on the drag DataTransfer. */
export const OVERLAY_DRAG_MIME = 'application/x-tpl-overlay-kind';

const defaultMakeId = (): string => crypto.randomUUID();

/**
 * Convert a screen point (clientX/clientY) to page-point coordinates on the
 * canvas stage. Mirrors `EditorialCanvas.stagePoint`: page point =
 * (client - stageRect origin) / zoom. Clamped to the page origin and rounded.
 */
export function screenToPagePoint(args: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number };
  zoom: number;
}): DropPoint {
  const { clientX, clientY, rect } = args;
  const zoom = args.zoom || 1;
  return {
    x: Math.max(0, Math.round((clientX - rect.left) / zoom)),
    y: Math.max(0, Math.round((clientY - rect.top) / zoom)),
  };
}

const KIND_BY_OVERLAY_TYPE: Record<string, DraggableOverlayKind> = {
  text: 'text',
  shape: 'rect',
  image: 'image',
};

/** Map a palette overlay's `type` to a draggable kind, or null if not draggable. */
export function draggableKindForOverlayType(type: string | undefined | null): DraggableOverlayKind | null {
  if (!type) return null;
  return KIND_BY_OVERLAY_TYPE[type] ?? null;
}

// ─── Unified palette drag payload (all overlays + blocks) ────────────────────
//
// Rather than re-deriving each element's defaults (error-prone for tables/curved
// text), we retain the palette item's own `build()` output behind an opaque,
// one-time token on dragstart. This ensures only items built in this app runtime
// can be dropped. Overlays are repositioned under the cursor; blocks flow into
// the page (renderer-safe).

export const PALETTE_DRAG_MIME = 'application/x-tpl-palette';

/** The shape a palette item's `build()` returns — an overlay wrapper or a block. */
export type BuiltPaletteItem = Block | { kind: 'overlay'; overlay: Overlay };

const MAX_PENDING_PALETTE_DRAGS = 100;
const pendingPaletteDrags = new Map<string, BuiltPaletteItem>();

export function serializePaletteDrag(built: BuiltPaletteItem): string {
  const token = crypto.randomUUID();
  pendingPaletteDrags.set(token, built);

  // Drag cancellations never reach parsePaletteDrag, so keep the registry
  // bounded rather than retaining palette items for the lifetime of the app.
  while (pendingPaletteDrags.size > MAX_PENDING_PALETTE_DRAGS) {
    const oldestToken = pendingPaletteDrags.keys().next().value;
    if (!oldestToken) break;
    pendingPaletteDrags.delete(oldestToken);
  }

  return token;
}

/**
 * The token proves an item came from this runtime's palette; it does not prove
 * the item is well-formed. A malformed overlay reaching the canvas ends up in
 * saved template JSON and then in a renderer, so provenance and shape are both
 * checked before the drop is accepted.
 */
function isValidPaletteItem(built: BuiltPaletteItem): boolean {
  if ((built as { kind?: string }).kind === 'overlay') {
    return OverlaySchema.safeParse((built as { overlay: Overlay }).overlay).success;
  }
  return BlockSchema.safeParse(built).success;
}

export function parsePaletteDrag(raw: string): BuiltPaletteItem | null {
  if (!raw) return null;
  const built = pendingPaletteDrags.get(raw) ?? null;
  // Consumed either way — a rejected token must not be retryable.
  pendingPaletteDrags.delete(raw);
  if (!built || !isValidPaletteItem(built)) return null;
  return built;
}

export function isOverlayPayload(item: BuiltPaletteItem): item is { kind: 'overlay'; overlay: Overlay } {
  return !!item && (item as any).kind === 'overlay' && !!(item as any).overlay;
}

/** Reposition an overlay so it is centred on the drop point (clamped to origin). */
export function positionOverlayAtPoint(overlay: Overlay, point: DropPoint): Overlay {
  const w = Number((overlay as any).width) || 0;
  const h = Number((overlay as any).height) || 0;
  return {
    ...overlay,
    x: Math.max(0, Math.round(point.x - w / 2)),
    y: Math.max(0, Math.round(point.y - h / 2)),
  } as Overlay;
}

const DEFAULT_SIZE: Record<DraggableOverlayKind, { width: number; height: number }> = {
  text: { width: 300, height: 40 },
  rect: { width: 200, height: 120 },
  image: { width: 200, height: 140 },
};

/**
 * Build a new overlay of `kind`, centred on the drop point (so it lands "under
 * the cursor"), with the same defaults the click-to-insert palette uses.
 */
export function makeOverlayForKind(
  kind: DraggableOverlayKind,
  point: DropPoint,
  makeId: () => string = defaultMakeId,
): Overlay {
  const { width, height } = DEFAULT_SIZE[kind];
  const x = Math.max(0, Math.round(point.x - width / 2));
  const y = Math.max(0, Math.round(point.y - height / 2));
  const base = { id: makeId(), x, y, width, height, rotation: 0, opacity: 1 };

  if (kind === 'rect') {
    return { ...base, type: 'shape', shape: 'rect', fill: 'token:primary', strokeWidth: 0, borderRadius: 6 } as unknown as Overlay;
  }
  if (kind === 'image') {
    return { ...base, type: 'image', src: '{{property.imageUrl}}', fit: 'cover' } as unknown as Overlay;
  }
  return {
    ...base,
    type: 'text',
    content: 'New text',
    fontFamily: 'Helvetica',
    fontSize: 18,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#000000',
    align: 'left',
    lineHeight: 1.3,
    letterSpacing: 0,
  } as unknown as Overlay;
}
