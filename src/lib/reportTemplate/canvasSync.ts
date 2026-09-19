/**
 * canvasSync — bidirectional translation between template Overlays and tldraw shapes.
 *
 * Source of truth = the template JSON. tldraw is just a visual surface.
 * On load: Overlay[] → TLShape[] (createShapes).
 * On change: TLShape edits → Overlay[] (writeShapesBack).
 *
 * We store the original overlay id inside `shape.meta.overlayId` so we can
 * round-trip without losing identity.
 */
import type { Editor, TLShape, TLShapeId, TLShapePartial } from 'tldraw';
import { createShapeId } from 'tldraw';
import type { Overlay } from './templateSchema';

const OVERLAY_META_KEY = 'overlayId';

function shapeIdForOverlay(overlayId: string): TLShapeId {
  // tldraw shape ids must start with 'shape:'
  return createShapeId(`ovl-${overlayId.replace(/[^a-zA-Z0-9_-]/g, '')}`);
}

/** Convert one Overlay → tldraw shape partial. */
function overlayToShape(o: Overlay): TLShapePartial {
  const id = shapeIdForOverlay(o.id);
  const meta = { [OVERLAY_META_KEY]: o.id };

  if (o.type === 'text') {
    return {
      id,
      type: 'text',
      x: o.x,
      y: o.y,
      rotation: ((o.rotation || 0) * Math.PI) / 180,
      opacity: o.opacity ?? 1,
      meta,
      props: {
        // tldraw text props
        richText: undefined as any,
        text: String(o.content ?? ''),
        size: pickTextSize(Number(o.fontSize) || 12),
        textAlign: o.align as any,
        autoSize: false,
        w: o.width,
        color: 'black',
        font: 'sans',
      } as any,
    };
  }

  if (o.type === 'image') {
    return {
      id,
      type: 'geo',
      x: o.x,
      y: o.y,
      rotation: ((o.rotation || 0) * Math.PI) / 180,
      opacity: o.opacity ?? 1,
      meta,
      props: {
        geo: 'rectangle',
        w: o.width,
        h: o.height,
        color: 'grey',
        fill: 'pattern',
        dash: 'dashed',
        text: '🖼  image',
      } as any,
    };
  }

  // textOnPath / table — represent as a placeholder rectangle on the tldraw canvas.
  if (o.type === 'textOnPath' || o.type === 'table') {
    return {
      id,
      type: 'geo',
      x: o.x,
      y: o.y,
      rotation: ((o.rotation || 0) * Math.PI) / 180,
      opacity: o.opacity ?? 1,
      meta,
      props: {
        geo: 'rectangle',
        w: o.width,
        h: o.height,
        color: 'grey',
        fill: 'pattern',
        dash: 'dotted',
        text: o.type === 'table' ? '▦ table' : '✎ text on path',
      } as any,
    };
  }

  // shape / path
  const s = o as any;
  return {
    id,
    type: 'geo',
    x: o.x,
    y: o.y,
    rotation: ((o.rotation || 0) * Math.PI) / 180,
    opacity: o.opacity ?? 1,
    meta,
    props: {
      geo: s.shape === 'ellipse' ? 'ellipse' : s.shape === 'line' ? 'rectangle' : 'rectangle',
      w: o.width,
      h: o.height,
      color: s.fill && typeof s.fill === 'string' && s.fill.startsWith('#') ? mapHexToTldrawColor(s.fill) : 'black',
      fill: s.fill ? 'solid' : 'none',
      dash: 'solid',
    } as any,
  };
}

function pickTextSize(pt: number): 's' | 'm' | 'l' | 'xl' {
  if (pt <= 12) return 's';
  if (pt <= 18) return 'm';
  if (pt <= 28) return 'l';
  return 'xl';
}

function mapHexToTldrawColor(_hex: string): string {
  // tldraw uses palette names; default to 'black'. Visual fidelity comes from PDF preview.
  return 'black';
}

/** Push a fresh set of overlays into the editor for the given page size. */
export function syncOverlaysToEditor(
  editor: Editor,
  overlays: Overlay[],
  pageSize: { width: number; height: number },
) {
  // Wipe existing overlay-tagged shapes
  const existing = editor.getCurrentPageShapes()
    .filter((s) => s.meta && (s.meta as any)[OVERLAY_META_KEY]);
  if (existing.length) {
    editor.deleteShapes(existing.map((s) => s.id));
  }

  // Page background frame so the user sees the page bounds
  const frameId = createShapeId('page-frame');
  if (!editor.getShape(frameId)) {
    editor.createShape({
      id: frameId,
      type: 'geo',
      x: 0,
      y: 0,
      isLocked: true,
      meta: { pageFrame: true },
      props: {
        geo: 'rectangle',
        w: pageSize.width,
        h: pageSize.height,
        color: 'grey',
        fill: 'none',
        dash: 'dashed',
      } as any,
    });
  }

  if (overlays.length) {
    editor.createShapes(overlays.map(overlayToShape));
  }
}

/** Read tldraw shapes back into overlays, merging with the original list (preserves block ordering & non-shape fields). */
export function readShapesBackToOverlays(editor: Editor, originalOverlays: Overlay[]): Overlay[] {
  const shapes = editor.getCurrentPageShapes()
    .filter((s) => s.meta && (s.meta as any)[OVERLAY_META_KEY]);

  const byOverlayId = new Map<string, TLShape>();
  for (const s of shapes) {
    const oid = (s.meta as any)[OVERLAY_META_KEY] as string;
    byOverlayId.set(oid, s);
  }

  return originalOverlays.map((o) => {
    const s = byOverlayId.get(o.id);
    if (!s) return o;
    const props: any = s.props || {};
    const updated: any = {
      ...o,
      x: Math.round(s.x),
      y: Math.round(s.y),
      width: Math.round(props.w ?? o.width),
      height: Math.round(props.h ?? o.height),
      rotation: Math.round(((s.rotation || 0) * 180) / Math.PI),
      opacity: s.opacity ?? o.opacity ?? 1,
    };
    if (o.type === 'text' && typeof props.text === 'string') {
      updated.content = props.text;
    }
    return updated as Overlay;
  });
}

export function getSelectedOverlayId(editor: Editor): string | null {
  const ids = editor.getSelectedShapeIds();
  if (!ids.length) return null;
  const shape = editor.getShape(ids[0]);
  if (!shape || !shape.meta) return null;
  return ((shape.meta as any)[OVERLAY_META_KEY] as string) ?? null;
}
