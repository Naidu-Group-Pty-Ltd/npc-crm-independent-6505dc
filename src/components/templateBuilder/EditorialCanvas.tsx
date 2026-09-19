/**
 * EditorialCanvas — Canva/Adobe-style WYSIWYG editor.
 *
 * R3 — SINGLE RENDERER. The sandboxed iframe renders the ENTIRE page — blocks
 * AND overlays — through the same `renderTemplateToHtml` the preview and the
 * WeasyPrint export use. The React layer above it paints no overlay pixels at
 * all: it is transparent hit-targets, selection chrome, guides and the inline
 * text editor. The editor therefore cannot disagree with the export about
 * fonts, letter-spacing, runs, weights or wrapping — the two used to be
 * separate renderers, and every one of those disagreed.
 *
 *  - Live drag/resize never rebuilds the iframe: geometry is mirrored straight
 *    onto the iframe DOM via the renderer's `data-overlay-id` stamp.
 *  - Committed changes re-render the srcDoc through a DOUBLE-BUFFERED iframe
 *    pair — the old page stays visible until the new one has loaded, so the
 *    canvas never flashes white mid-edit.
 *  - Click selects. Shift/Cmd-click toggles multi-select.
 *  - Drag any handle box to move. 8 corner/edge handles to resize.
 *    Top rotation grip to rotate. Alt-drag to clone.
 *  - Double-click a text overlay to inline-edit (textarea, styled through the
 *    same shared declaration builder as the export path).
 *  - Arrow keys nudge (1pt; +Shift = 10pt). Delete removes.
 *  - Smart alignment guides snap to other overlays' edges/centres (4pt threshold).
 *  - Optional snap-to-grid driven by template.canvas.snapToGrid + gridSize.
 *  - Pinch / ctrl-wheel zoom (25% – 400%). Spacebar + drag pans.
 *
 * Template JSON remains the single source of truth; this surface only mutates
 * overlay x/y/width/height/rotation/content via the supplied callbacks.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { makeCanvasRenderKey } from '@/lib/reportTemplate/previewCache';
import { tokensToFontFaceCss } from '@/lib/reportTemplate/cssTokens';
import { normalizePageSize } from '@/lib/reportTemplate/rendering/pageGeometry';
import { PT_TO_PX } from '@/lib/templateLibrary/pageGeometry';
import { overlayPaintOrder } from '@/lib/reportTemplate/paintOrder';
import { buildTextOverlayCssDecls, cssDeclsToReactStyle } from '@/lib/reportTemplate/rendering/textOverlayStyle.pure';
import { screenToPagePoint, PALETTE_DRAG_MIME, parsePaletteDrag } from '@/lib/reportTemplate/overlayDropFactory';
import type { Overlay, Page, ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import { templateEditorActions, useEditorTemplate, useTemplateEditorStore } from '@/stores/templateEditorStore';
import { Button } from '@/components/ui/button';
import { FloatingTextToolbar } from '@/components/templateBuilder/FloatingTextToolbar';
import { ZoomIn, ZoomOut, Maximize2, MousePointer2, Move, Image as ImageIcon, ImageOff } from 'lucide-react';

type HandleKind =
  | 'move'
  | 'rotate'
  | 'n' | 's' | 'e' | 'w'
  | 'ne' | 'nw' | 'se' | 'sw';

interface FlatOverlay {
  overlay: Overlay;
  blockId: string;
}

interface CommentAnchor {
  id: string;
  pageId?: string | null;
  blockId?: string | null;
  overlayId?: string | null;
  resolved?: boolean;
}

// Template, selection, and mutators come straight from templateEditorStore
// (slice subscriptions, rehaul Phase 2). The page stays a prop: the parent
// guarantees it is non-null and keys the canvas by page id for clean remounts.
interface Props {
  page: Page;
  sampleData: Record<string, any>;
  customCss?: string;
  /** V2 drop-to-place: allow palette items (overlay or block) to be dropped. */
  enablePaletteDrop?: boolean;
  /** V2: show a floating quick-style toolbar above a selected text overlay. */
  enableTextToolbar?: boolean;
  commentAnchors?: CommentAnchor[];
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const SNAP_THRESHOLD = 4; // pt

function EditorialCanvasImpl({
  page,
  sampleData,
  customCss,
  enablePaletteDrop = false,
  enableTextToolbar = false,
  commentAnchors = [],
}: Props) {
  const template = useEditorTemplate();
  const selectedOverlayId = useTemplateEditorStore((s) => s.selectedOverlayId);
  const multiOverlayIds = useTemplateEditorStore((s) => s.multiOverlayIds);
  const {
    handleCanvasSelectOverlay: onSelectOverlay,
    updateOverlay: onUpdateOverlay,
    handleOverlaysBulkPatch: onUpdateOverlaysBulk,
    deleteOverlay: onDeleteOverlay,
    duplicateOverlay: onDuplicateOverlay,
    setSelectedBlockId: onSelectBlock,
    handlePaletteDrop,
  } = templateEditorActions();
  const onPaletteDrop = enablePaletteDrop ? handlePaletteDrop : undefined;
  // Phase 7D — shared, defensive page-size read. Identical to the previous
  // `page.size.width || 595` for valid sizes; also rejects negative/partial-invalid
  // sizes, always falling back to the A4 default pair. Editor-display only; the
  // export path reads page.size directly and is unaffected.
  const { width: pageW, height: pageH } = normalizePageSize(page.size, { width: 595, height: 842 });
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  // Phase 6B — reference-underlay opacity override (canvas view only; does NOT
  // mutate the template, so the export is unaffected). null = use the page's own
  // stored background opacity. A faint raster aids alignment; 0 hides it so the
  // pure reconstruction leads.
  const [underlayOpacity, setUnderlayOpacity] = useState<number | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [transientOverlayPatches, setTransientOverlayPatches] = useState<Record<string, Partial<Overlay>>>({});
  const [isDropTarget, setIsDropTarget] = useState(false);

  // Flatten overlays with their parent block id (in render order).
  const sourceOverlays = useMemo<FlatOverlay[]>(() => {
    const out: FlatOverlay[] = [];
    for (const b of page.blocks) {
      for (const o of b.overlays) out.push({ overlay: o, blockId: b.id });
    }
    return out
      .map((entry, index) => ({ entry, order: overlayPaintOrder(entry.overlay, index) }))
      .sort((a, b) => a.order - b.order)
      .map(({ entry }) => entry);
  }, [page]);

  // Apply in-flight drag/resize patches so the canvas reflects live state
  // without committing back to the template until pointer-up.
  const overlays = useMemo<FlatOverlay[]>(() => {
    if (Object.keys(transientOverlayPatches).length === 0) return sourceOverlays;
    return sourceOverlays.map((f) => {
      const patch = transientOverlayPatches[f.overlay.id];
      return patch ? { ...f, overlay: { ...f.overlay, ...patch } as Overlay } : f;
    });
  }, [sourceOverlays, transientOverlayPatches]);

  // Comment badge counts derived from anchors for the current page.
  const overlayCommentCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of commentAnchors) {
      if (a.resolved) continue;
      if (a.pageId && a.pageId !== page.id) continue;
      if (!a.overlayId) continue;
      m.set(a.overlayId, (m.get(a.overlayId) ?? 0) + 1);
    }
    return m;
  }, [commentAnchors, page.id]);

  const unresolvedPageCommentCount = useMemo(() => {
    let n = 0;
    for (const a of commentAnchors) {
      if (a.resolved) continue;
      if (a.pageId && a.pageId !== page.id) continue;
      if (!a.overlayId && !a.blockId) n += 1;
    }
    return n;
  }, [commentAnchors, page.id]);


  // Single-page HTML for the iframe. The canvas hides overlays and draws its own
  // handles, so the rendered background doesn't depend on overlay geometry — key
  // the render on a signature that excludes overlays so dragging/resizing an
  // overlay never rebuilds the iframe srcDoc (the dominant drag-jank source).
  // The raster underlay (page.background.imageUrl) and its effective opacity for
  // the canvas view. The slider/toggle overrides the stored opacity without
  // mutating the template; viewPage carries the override into the iframe render.
  const hasUnderlay = Boolean((page.background as any)?.imageUrl);
  const storedUnderlayOpacity = typeof page.background?.opacity === 'number' ? page.background.opacity : 1;
  const effectiveUnderlay = underlayOpacity ?? storedUnderlayOpacity;
  const viewPage = useMemo(
    () => (underlayOpacity == null
      ? page
      : { ...page, background: { ...(page.background ?? { color: '#FFFFFF' }), opacity: underlayOpacity } }),
    [page, underlayOpacity],
  );
  const renderKey = useMemo(
    () => makeCanvasRenderKey(template, viewPage, sampleData, customCss),
    [template, viewPage, sampleData, customCss],
  );
  const html = useMemo(() => {
    try {
      // R3 — the iframe renders the FULL page, overlays included: one renderer
      // for editor, preview and export. The React layer above draws no pixels.
      const visible: ReportTemplate = { ...template, pages: [viewPage] };
      const r = renderTemplateToHtml(visible, {
        data: sampleData,
        customCss,
        editorMode: false, // we draw our own selection chrome
        // The canvas is the ONE surface that shows PDF-import reference
        // underlays (dim source raster) so overlays can be aligned to the
        // original; every preview/print/export path renders without them.
        showReferenceUnderlay: true,
        // On a RASTER-ONLY page final output is the source raster and native
        // layers are suppressed — but the canvas exists to EDIT those layers,
        // and its raster URL is resolved only at export time. Without this
        // opt-in every raster-only page rendered as nothing at all (the
        // post-merge "no text on any page but the cover" outage).
        showReconstructedLayers: true,
      });
      // Inject CSS so the page lays out without the editor's drop-shadow chrome.
      return r.html.replace(
        '</head>',
        `<style>
          html,body{margin:0!important;padding:0!important;background:transparent!important}
          .tpl-doc,.tpl-pages,.tpl-page-wrap{margin:0!important;padding:0!important;background:transparent!important;box-shadow:none!important}
          .tpl-page{box-shadow:none!important;margin:0!important;outline:none!important;border:0!important;background:transparent!important}
          a{pointer-events:none}
        </style></head>`,
      );
    } catch (e: any) {
      return `<!doctype html><body style="font:13px sans-serif;color:#b91c1c;padding:24px">Preview error: ${String(e?.message ?? e)}</body>`;
    }
    // template/page/sampleData/customCss (overlays INCLUDED) are encoded in
    // renderKey; depend on it alone to reuse the cached HTML.

  }, [renderKey]);

  // ── R3: double-buffered srcDoc ────────────────────────────────────────────
  // A committed overlay change produces new html. Swapping srcDoc on a single
  // iframe blanks the document while the new one parses and refetches images —
  // a white flash on every commit. Instead the new document loads into the
  // HIDDEN buffer and becomes visible only when its load event fires.
  const iframeARef = useRef<HTMLIFrameElement | null>(null);
  const iframeBRef = useRef<HTMLIFrameElement | null>(null);
  const [buf, setBuf] = useState<{ a: string; b: string; front: 'a' | 'b' }>(() => ({ a: html, b: '', front: 'a' }));

  useEffect(() => {
    setBuf((s) => {
      const frontHtml = s.front === 'a' ? s.a : s.b;
      if (frontHtml === html) return s;
      const backHtml = s.front === 'a' ? s.b : s.a;
      if (backHtml === html) return s; // already loading it
      return s.front === 'a' ? { ...s, b: html } : { ...s, a: html };
    });
  }, [html]);

  // Counts iframe load events so the geometry-sync effect re-runs when a fresh
  // document appears even without a buffer swap (e.g. the very first load).
  const [loadTick, setLoadTick] = useState(0);
  const handleBufferLoad = useCallback((which: 'a' | 'b') => {
    setBuf((s) => {
      const backWhich = s.front === 'a' ? 'b' : 'a';
      if (which !== backWhich) return s;              // front (re)loaded — no swap
      const backHtml = backWhich === 'a' ? s.a : s.b;
      if (!backHtml) return s;                        // the empty initial buffer
      return { ...s, front: backWhich };
    });
    setLoadTick((t) => t + 1);
  }, []);

  // ── R3: live geometry mirroring ───────────────────────────────────────────
  // During a drag the template is untouched (transient patches only), so the
  // srcDoc cannot know the new geometry. Mirror it straight onto the rendered
  // overlay elements — both buffers, so a mid-drag swap can't show stale
  // positions. Chart overlays translate as a whole (their wrapper sits at 0,0
  // and the SVG positions itself); everything else moves box-for-box.
  const syncOverlaysToIframes = useCallback(() => {
    for (const ref of [iframeARef, iframeBRef]) {
      const doc = ref.current?.contentDocument;
      if (!doc) continue;
      for (const f of overlays) {
        const o = f.overlay as Overlay & { opacity?: number };
        const src = sourceOverlays.find((s) => s.overlay.id === o.id)?.overlay;
        const id = String(o.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const el = doc.querySelector<HTMLElement>(`[data-overlay-id="${id}"]`);
        if (!el) continue;
        const rotate = `rotate(${o.rotation || 0}deg)`;
        if (o.type === 'chart') {
          const dx = src ? o.x - src.x : 0;
          const dy = src ? o.y - src.y : 0;
          el.style.transform = dx || dy ? `translate(${dx}pt, ${dy}pt) ${rotate}` : rotate;
        } else {
          el.style.left = `${o.x}pt`;
          el.style.top = `${o.y}pt`;
          el.style.width = `${o.width}pt`;
          el.style.height = `${o.height}pt`;
          el.style.transform = rotate;
        }
        el.style.opacity = String(o.opacity ?? 1);
        // The inline editor replaces the rendered text while it is open.
        el.style.visibility = editingId === o.id ? 'hidden' : '';
      }
    }
  }, [overlays, sourceOverlays, editingId]);

  useEffect(() => { syncOverlaysToIframes(); }, [syncOverlaysToIframes, buf.front, loadTick]);

  // ── R3: parent-document fonts ─────────────────────────────────────────────
  // The inline-edit textarea is the one piece of text living OUTSIDE the
  // iframe, so give the parent document the template's @font-face rules
  // (embedded data: fonts included) — otherwise editing swaps the real font
  // for a substitute mid-edit.
  const fontFaceCss = useMemo(
    () => tokensToFontFaceCss((template.tokens ?? {}) as Parameters<typeof tokensToFontFaceCss>[0]),
    [template.tokens],
  );
  useEffect(() => {
    if (!fontFaceCss) return;
    const el = document.createElement('style');
    el.setAttribute('data-editorial-canvas-fonts', '');
    el.textContent = fontFaceCss;
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, [fontFaceCss]);

  // ── Zoom controls ─────────────────────────────────────────────────────────
  const fitToViewport = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const pad = 48;
    const z = Math.min(
      (el.clientWidth - pad) / pageW,
      (el.clientHeight - pad) / pageH,
    );
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)));
  }, [pageW, pageH]);

  useEffect(() => { fitToViewport(); }, [fitToViewport, page.id]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * (1 + delta))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Spacebar pan ──────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.code === 'Space') { setSpaceDown(true); e.preventDefault(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedOverlayId || multiOverlayIds.size > 0)) {
        e.preventDefault();
        const ids = multiOverlayIds.size > 0 ? Array.from(multiOverlayIds) : [selectedOverlayId!];
        ids.forEach((id) => onDeleteOverlay(id));
      }
      if (e.key === 'Escape') onSelectOverlay(null, false);
      // Nudge
      const arrow = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key);
      if (arrow && (selectedOverlayId || multiOverlayIds.size > 0)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const ids = multiOverlayIds.size > 0 ? Array.from(multiOverlayIds) : [selectedOverlayId!];
        onUpdateOverlaysBulk(ids.map((id) => {
          const o = overlays.find((x) => x.overlay.id === id)?.overlay;
          if (!o) return { id, patch: {} };
          return { id, patch: { x: Math.round(o.x + dx), y: Math.round(o.y + dy) } as any };
        }));
      }
      // Duplicate with ⌘D
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && selectedOverlayId) {
        e.preventDefault();
        onDuplicateOverlay(selectedOverlayId);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [selectedOverlayId, multiOverlayIds, onDeleteOverlay, onSelectOverlay, onUpdateOverlaysBulk, onDuplicateOverlay, overlays]);

  // ── Hit testing / interaction ─────────────────────────────────────────────
  const stagePoint = useCallback((e: React.PointerEvent | PointerEvent) => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
  }, [zoom]);

  // Snap helpers — collect other overlays' edges/centres for guide rendering.
  const computeSnap = useCallback((moving: Overlay[], dx: number, dy: number) => {
    const snapGrid = template.canvas?.snapToGrid ? (template.canvas.gridSize ?? 8) : 0;
    const others: Overlay[] = [];
    const movingIds = new Set(moving.map((o) => o.id));
    for (const f of overlays) if (!movingIds.has(f.overlay.id)) others.push(f.overlay);
    // Candidate snap lines
    const vTargets: number[] = [0, pageW / 2, pageW];
    const hTargets: number[] = [0, pageH / 2, pageH];
    for (const o of others) {
      vTargets.push(o.x, o.x + o.width / 2, o.x + o.width);
      hTargets.push(o.y, o.y + o.height / 2, o.y + o.height);
    }
    const usedV = new Set<number>();
    const usedH = new Set<number>();
    let bestDx = dx;
    let bestDy = dy;
    let bestVD = Infinity;
    let bestHD = Infinity;
    for (const o of moving) {
      const candidatesX = [o.x + dx, o.x + dx + o.width / 2, o.x + dx + o.width];
      const candidatesY = [o.y + dy, o.y + dy + o.height / 2, o.y + dy + o.height];
      candidatesX.forEach((c, i) => {
        for (const t of vTargets) {
          const d = t - c;
          if (Math.abs(d) < SNAP_THRESHOLD && Math.abs(d) < bestVD) {
            bestVD = Math.abs(d);
            bestDx = dx + d;
            usedV.clear(); usedV.add(t);
          }
        }
      });
      candidatesY.forEach((c, i) => {
        for (const t of hTargets) {
          const d = t - c;
          if (Math.abs(d) < SNAP_THRESHOLD && Math.abs(d) < bestHD) {
            bestHD = Math.abs(d);
            bestDy = dy + d;
            usedH.clear(); usedH.add(t);
          }
        }
      });
    }
    if (snapGrid > 0) {
      // Snap moving[0]'s top-left to grid if no other guide grabbed it
      if (bestVD === Infinity) {
        const target = Math.round((moving[0].x + dx) / snapGrid) * snapGrid;
        bestDx = target - moving[0].x;
      }
      if (bestHD === Infinity) {
        const target = Math.round((moving[0].y + dy) / snapGrid) * snapGrid;
        bestDy = target - moving[0].y;
      }
    }
    return {
      dx: bestDx,
      dy: bestDy,
      guides: { v: Array.from(usedV), h: Array.from(usedH) },
    };
  }, [overlays, pageW, pageH, template.canvas]);

  const beginInteraction = useCallback((e: React.PointerEvent, ov: Overlay, kind: HandleKind) => {
    e.preventDefault();
    e.stopPropagation();
    if (spaceDown) return;
    const startPt = stagePoint(e);
    const ids = multiOverlayIds.has(ov.id) && multiOverlayIds.size > 0
      ? Array.from(multiOverlayIds)
      : [ov.id];
    if (!multiOverlayIds.has(ov.id) && kind === 'move') {
      onSelectOverlay(ov.id, e.shiftKey || e.metaKey || e.ctrlKey);
    }
    const starts = new Map<string, Overlay>();
    for (const f of overlays) if (ids.includes(f.overlay.id)) starts.set(f.overlay.id, { ...f.overlay });
    const altClone = e.altKey && kind === 'move';
    let cloned = false;
    let latestPatches: Array<{ id: string; patch: Partial<Overlay> }> = [];

    const applyTransientPatches = (patches: Array<{ id: string; patch: Partial<Overlay> }>) => {
      latestPatches = patches;
      setTransientOverlayPatches((prev) => {
        const next = { ...prev };
        patches.forEach(({ id, patch }) => { next[id] = patch; });
        return next;
      });
    };

    const onMove = (ev: PointerEvent) => {
      const pt = stagePoint(ev);
      const rawDx = pt.x - startPt.x;
      const rawDy = pt.y - startPt.y;

      if (altClone && !cloned) {
        cloned = true;
        ids.forEach((id) => onDuplicateOverlay(id));
        // The duplicated overlays receive a fresh id; we just drag the originals.
      }

      if (kind === 'move') {
        const moving = ids.map((id) => starts.get(id)!).filter(Boolean);
        const { dx, dy, guides: g } = computeSnap(moving, rawDx, rawDy);
        setGuides(g);
        applyTransientPatches(ids.map((id) => {
          const s = starts.get(id)!;
          return { id, patch: { x: Math.round(s.x + dx), y: Math.round(s.y + dy) } as Partial<Overlay> };
        }));
        return;
      }
      if (kind === 'rotate') {
        const s = starts.get(ov.id)!;
        const cx = s.x + s.width / 2;
        const cy = s.y + s.height / 2;
        const ang = Math.atan2(pt.y - cy, pt.x - cx) * 180 / Math.PI + 90;
        const snap = ev.shiftKey ? 15 : 1;
        const rot = Math.round(ang / snap) * snap;
        applyTransientPatches([{ id: ov.id, patch: { rotation: rot } as Partial<Overlay> }]);
        return;
      }
      // Resize handles
      const s = starts.get(ov.id)!;
      let { x, y, width, height } = s;
      if (kind.includes('e')) width = Math.max(8, s.width + rawDx);
      if (kind.includes('s')) height = Math.max(8, s.height + rawDy);
      if (kind.includes('w')) { width = Math.max(8, s.width - rawDx); x = s.x + (s.width - width); }
      if (kind.includes('n')) { height = Math.max(8, s.height - rawDy); y = s.y + (s.height - height); }
      // Aspect lock on shift
      if (ev.shiftKey && (kind === 'ne' || kind === 'nw' || kind === 'se' || kind === 'sw')) {
        const ratio = s.width / s.height;
        if (Math.abs(width - s.width) > Math.abs(height - s.height) * ratio) {
          height = width / ratio;
          if (kind.includes('n')) y = s.y + (s.height - height);
        } else {
          width = height * ratio;
          if (kind.includes('w')) x = s.x + (s.width - width);
        }
      }
      applyTransientPatches([{ id: ov.id, patch: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) } as Partial<Overlay> }]);
    };
    let finished = false;
    const finishInteraction = (commit: boolean) => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setGuides({ v: [], h: [] });
      if (commit && latestPatches.length > 0) {
        if (latestPatches.length === 1) {
          const id = latestPatches[0].id;
          const start = starts.get(id);
          if (start) onUpdateOverlay({ ...start, ...latestPatches[0].patch } as Overlay);
        } else {
          onUpdateOverlaysBulk(latestPatches);
        }
      }
      setTransientOverlayPatches((prev) => {
        const next = { ...prev };
        ids.forEach((id) => { delete next[id]; });
        return next;
      });
    };
    const onUp = () => finishInteraction(true);
    const onCancel = () => finishInteraction(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [stagePoint, multiOverlayIds, overlays, onSelectOverlay, onUpdateOverlay, onUpdateOverlaysBulk, onDuplicateOverlay, computeSnap, spaceDown]);

  // Marquee selection on the empty page background.
  const beginMarquee = useCallback((e: React.PointerEvent) => {
    if (spaceDown || e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    onSelectOverlay(null, false);
    const start = stagePoint(e);
    setMarquee({ x: start.x, y: start.y, w: 0, h: 0 });
    const onMove = (ev: PointerEvent) => {
      const pt = stagePoint(ev);
      setMarquee({
        x: Math.min(start.x, pt.x),
        y: Math.min(start.y, pt.y),
        w: Math.abs(pt.x - start.x),
        h: Math.abs(pt.y - start.y),
      });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const pt = stagePoint(ev);
      const r = {
        x: Math.min(start.x, pt.x),
        y: Math.min(start.y, pt.y),
        w: Math.abs(pt.x - start.x),
        h: Math.abs(pt.y - start.y),
      };
      setMarquee(null);
      if (r.w < 4 && r.h < 4) return;
      const hits = overlays.filter((f) => {
        const o = f.overlay;
        return o.x < r.x + r.w && o.x + o.width > r.x && o.y < r.y + r.h && o.y + o.height > r.y;
      });
      if (hits.length === 0) return;
      onSelectOverlay(hits[0].overlay.id, false);
      hits.slice(1).forEach((h) => onSelectOverlay(h.overlay.id, true));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [spaceDown, stagePoint, overlays, onSelectOverlay]);

  // ── Inline text edit ──────────────────────────────────────────────────────
  const finishInlineEdit = useCallback((ov: Overlay, value: string) => {
    if (ov.type !== 'text') return;
    onUpdateOverlay({ ...ov, content: value } as Overlay);
    setEditingId(null);
  }, [onUpdateOverlay]);

  // Helpers
  const isSelected = (id: string) =>
    selectedOverlayId === id || multiOverlayIds.has(id);

  return (
    <div className="absolute inset-0 flex flex-col bg-muted/40">
      <div className="px-3 py-1.5 border-b flex items-center gap-2 text-xs bg-background">
        <MousePointer2 className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Editor</span>
        {unresolvedPageCommentCount > 0 && (
          <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] text-brand-700">
            {unresolvedPageCommentCount} page comment{unresolvedPageCommentCount === 1 ? '' : 's'}
          </span>
        )}
        <span className="text-muted-foreground hidden md:inline">·</span>
        <span className="text-muted-foreground hidden md:inline truncate">
          Click to select · Shift-click multi · Dbl-click text to edit
        </span>
        <div className="ml-auto flex items-center gap-1">
          {hasUnderlay && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setUnderlayOpacity(effectiveUnderlay > 0 ? 0 : (storedUnderlayOpacity > 0 ? storedUnderlayOpacity : 0.5))}
                title={effectiveUnderlay > 0 ? 'Hide source reference (raster underlay)' : 'Show source reference (raster underlay)'}
              >
                {effectiveUnderlay > 0 ? <ImageIcon className="h-3.5 w-3.5" /> : <ImageOff className="h-3.5 w-3.5" />}
              </Button>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(effectiveUnderlay * 100)}
                onChange={(e) => setUnderlayOpacity(Number(e.target.value) / 100)}
                className="w-16 accent-primary cursor-pointer"
                title={`Reference underlay opacity ${Math.round(effectiveUnderlay * 100)}%`}
                aria-label="Reference underlay opacity"
              />
              <span className="text-muted-foreground/60 hidden lg:inline">·</span>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.1))} title="Zoom out (⌘/Ctrl-wheel)">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-[10px] tabular-nums w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.1))} title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fitToViewport} title="Fit page (space-drag to pan)">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="flex-1 min-h-0 overflow-auto"
        style={{ cursor: spaceDown ? 'grab' : 'default' }}
      >
        <div className="min-h-full min-w-full flex items-start justify-center p-6">
          <div
            ref={stageRef}
            onPointerDown={beginMarquee}
            onDragOver={onPaletteDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDropTarget(true); } : undefined}
            onDragLeave={onPaletteDrop ? () => setIsDropTarget(false) : undefined}
            onDrop={onPaletteDrop ? (e) => {
              setIsDropTarget(false);
              const item = parsePaletteDrag(e.dataTransfer.getData(PALETTE_DRAG_MIME));
              if (!item) return;
              e.preventDefault();
              const el = stageRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              onPaletteDrop(item, screenToPagePoint({ clientX: e.clientX, clientY: e.clientY, rect, zoom }));
            } : undefined}
            className={`relative bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)] ${isDropTarget ? 'outline-dashed outline-2 outline-primary outline-offset-2' : ''}`}
            style={{
              width: pageW * zoom,
              height: pageH * zoom,
            }}
          >
            {/* R3 — double-buffered iframes with the rendered page (visual only,
                pointer-events disabled). The hidden buffer receives each new
                srcDoc and is promoted on load, so commits never flash white.

                The stage is sized in POINTS × zoom, but the document inside the
                iframe lays out at `${size.width}pt`, and CSS fixes 1pt at 4/3 px.
                Sized at `w-full h-full` the document was therefore 1.333× wider
                than its viewport — overflowing, cut off, and permanently
                misaligned with the overlay handles, which position at 1 CSS px
                per point. Worse, the iframe content did not respond to `zoom` at
                all, so the mismatch was constant at every zoom level.

                Give each iframe its NATURAL pixel size and scale it back down by
                zoom/PT_TO_PX, so one point on the handle layer is one point in
                the document. Same pattern as TemplateDocumentPreview and
                LiveHtmlPreview, which both got this right. */}
            {(['a', 'b'] as const).map((which) => (
              <iframe
                key={which}
                ref={which === 'a' ? iframeARef : iframeBRef}
                title={`Editor page (buffer ${which})`}
                srcDoc={which === 'a' ? buf.a : buf.b}
                sandbox="allow-same-origin"
                onLoad={() => handleBufferLoad(which)}
                className="absolute left-0 top-0 border-0 pointer-events-none origin-top-left"
                style={{
                  width: pageW * PT_TO_PX,
                  height: pageH * PT_TO_PX,
                  transform: `scale(${zoom / PT_TO_PX})`,
                  visibility: buf.front === which ? 'visible' : 'hidden',
                }}
              />
            ))}

            {/* Alignment guides — magenta lines with a coordinate pill so
                designers see exactly where the snap landed (pt). */}
            {guides.v.map((v, i) => (
              <div key={`v${i}`} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: v * zoom, width: 1, background: 'hsl(330 90% 55%)' }}>
                <span
                  className="absolute -translate-x-1/2 rounded bg-[hsl(330_90%_55%)] px-1 py-0.5 text-[9px] font-medium text-foreground dark:text-white shadow"
                  style={{ left: 0, top: 4 }}
                >
                  x {Math.round(v)}
                </span>
              </div>
            ))}
            {guides.h.map((h, i) => (
              <div key={`h${i}`} className="absolute left-0 right-0 pointer-events-none" style={{ top: h * zoom, height: 1, background: 'hsl(330 90% 55%)' }}>
                <span
                  className="absolute -translate-y-1/2 rounded bg-[hsl(330_90%_55%)] px-1 py-0.5 text-[9px] font-medium text-foreground dark:text-white shadow"
                  style={{ top: 0, left: 4 }}
                >
                  y {Math.round(h)}
                </span>
              </div>
            ))}

            {/* Marquee */}
            {marquee && (
              <div
                className="absolute pointer-events-none border border-primary/60 bg-primary/10"
                style={{
                  left: marquee.x * zoom,
                  top: marquee.y * zoom,
                  width: marquee.w * zoom,
                  height: marquee.h * zoom,
                }}
              />
            )}

            {/* Overlay handles layer */}
            {overlays.map(({ overlay: o, blockId }) => {
              const sel = isSelected(o.id);
              const editing = editingId === o.id && o.type === 'text';
              return (
                <div
                  key={o.id}
                  onPointerDown={(e) => beginInteraction(e, o, 'move')}
                  onDoubleClick={(e) => {
                    if (o.type === 'text') { e.stopPropagation(); setEditingId(o.id); }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onSelectOverlay(o.id, false);
                    onSelectBlock(blockId);
                  }}
                  className="absolute group"
                  style={{
                    left: o.x * zoom,
                    top: o.y * zoom,
                    width: o.width * zoom,
                    height: o.height * zoom,
                    transform: `rotate(${o.rotation || 0}deg)`,
                    transformOrigin: 'center center',
                    cursor: spaceDown ? 'grab' : sel ? 'move' : 'pointer',
                    outline: sel
                      ? '1.5px solid hsl(45 95% 50%)'
                      : '1px dashed transparent',
                    outlineOffset: 0,
                    background: sel ? 'hsl(45 95% 50% / 0.04)' : 'transparent',
                    zIndex: Number.isFinite(Number((o as any).zIndex)) ? Number((o as any).zIndex) : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (!sel) (e.currentTarget as HTMLElement).style.outline = '1px dashed hsl(45 80% 50% / 0.7)';
                  }}
                  onMouseLeave={(e) => {
                    if (!sel) (e.currentTarget as HTMLElement).style.outline = '1px dashed transparent';
                  }}
                >
                  {overlayCommentCounts.has(o.id) && (
                    <div
                      className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-foreground dark:text-white shadow"
                      title={`${overlayCommentCounts.get(o.id)} unresolved comment${overlayCommentCounts.get(o.id) === 1 ? '' : 's'}`}
                    >
                      {overlayCommentCounts.get(o.id)}
                    </div>
                  )}

                  {/* R3 — no pixels here: the iframe below paints the overlay.
                      This layer contributes only the inline text editor, an
                      empty-text affordance and review badges. */}
                  <OverlayEditLayer
                    overlay={o}
                    zoom={zoom}
                    editing={editing}
                    tokenColors={(template.tokens?.colors ?? {}) as Record<string, string>}
                    tokenFonts={(template.tokens?.fonts ?? {}) as Record<string, string>}
                    onCommit={(v) => finishInlineEdit(o, v)}
                  />

                  {/* Selection chrome */}
                  {sel && !editing && (
                    <>
                      {(['nw','n','ne','e','se','s','sw','w'] as const).map((k) => (
                        <div
                          key={k}
                          onPointerDown={(e) => beginInteraction(e, o, k)}
                          className="absolute bg-white border border-[hsl(45_95%_45%)] shadow-sm"
                          style={{
                            width: 9, height: 9,
                            left: k.includes('w') ? -5 : k.includes('e') ? '100%' : '50%',
                            top: k.includes('n') ? -5 : k.includes('s') ? '100%' : '50%',
                            marginLeft: k === 'n' || k === 's' ? -4 : k.includes('e') ? -5 : 0,
                            marginTop: k === 'e' || k === 'w' ? -4 : k.includes('s') ? -5 : 0,
                            cursor:
                              k === 'n' || k === 's' ? 'ns-resize'
                              : k === 'e' || k === 'w' ? 'ew-resize'
                              : k === 'ne' || k === 'sw' ? 'nesw-resize'
                              : 'nwse-resize',
                          }}
                        />
                      ))}
                      {/* Rotation handle */}
                      <div
                        onPointerDown={(e) => beginInteraction(e, o, 'rotate')}
                        className="absolute bg-[hsl(45_95%_50%)] rounded-full border border-white shadow"
                        style={{
                          width: 11, height: 11,
                          left: '50%', top: -22,
                          marginLeft: -6,
                          cursor: 'grab',
                        }}
                        title="Rotate"
                      />
                      <div
                        className="absolute bg-[hsl(45_95%_45%)]"
                        style={{ left: '50%', top: -12, width: 1, height: 12, marginLeft: -0.5 }}
                      />
                      {/* Size pill */}
                      <div
                        className="absolute -bottom-5 left-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[hsl(45_95%_45%)] text-black"
                        style={{ pointerEvents: 'none' }}
                      >
                        {Math.round(o.width)} × {Math.round(o.height)}
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Floating text toolbar (V2) — quick styling above one selected text overlay */}
            {(() => {
              if (!enableTextToolbar || multiOverlayIds.size > 1 || !selectedOverlayId || editingId === selectedOverlayId) return null;
              const to = overlays.find((x) => x.overlay.id === selectedOverlayId)?.overlay;
              if (!to || to.type !== 'text') return null;
              return (
                <div
                  className="absolute z-20"
                  style={{ left: to.x * zoom, top: Math.max(2, to.y * zoom - 42) }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <FloatingTextToolbar overlay={to} onChange={(patch) => onUpdateOverlay({ ...to, ...patch } as Overlay)} />
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="px-3 py-1 border-t bg-background text-[10px] text-muted-foreground flex items-center gap-3">
        <span>{overlays.length} element{overlays.length === 1 ? '' : 's'}</span>
        <span>·</span>
        <span>Page {pageW} × {pageH} pt</span>
        {multiOverlayIds.size > 0 && <><span>·</span><span>{multiOverlayIds.size} selected</span></>}
        <span className="ml-auto inline-flex items-center gap-1">
          <Move className="h-3 w-3" /> Arrow keys nudge · Shift+Arrows 10pt · Alt-drag clones
        </span>
      </div>
    </div>
  );
}

/**
 * R3 — the iframe paints every overlay; this layer paints NOTHING that the
 * document already shows. It contributes exactly three things:
 *  - the inline text editor (a textarea styled through the SAME declaration
 *    builder as the export renderer, so editing keeps the rendered metrics);
 *  - a faint affordance for an EMPTY text overlay, which renders no pixels in
 *    the document and would otherwise be unfindable;
 *  - the chart needs-review badge.
 * Painting overlays here as well was the two-renderers bug: the copies
 * disagreed on fonts, wrapping and weight, and only this one loaded no
 * embedded @font-face at all.
 */
function OverlayEditLayer({
  overlay: o,
  zoom,
  editing,
  onCommit,
  tokenColors,
  tokenFonts,
}: { overlay: Overlay; zoom: number; editing: boolean; tokenColors: Record<string, string>; tokenFonts: Record<string, string>; onCommit: (v: string) => void }) {
  if (o.type === 'text') {
    const t: any = o;
    const isEmpty = !String(t.content ?? '').trim()
      && !t.rich
      && !(Array.isArray(t.runs) && t.runs.length);
    if (!editing) {
      if (!isEmpty) return null;
      return (
        <div
          style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px dashed rgba(113,113,122,0.5)',
            color: 'rgba(113,113,122,0.8)',
            fontSize: Math.max(9, 10 * zoom), fontFamily: 'sans-serif',
            pointerEvents: 'none',
          }}
        >
          text
        </div>
      );
    }
    const color = previewCssColor(t.color, tokenColors, '#111111');
    const shared = cssDeclsToReactStyle(buildTextOverlayCssDecls({
      // An imported overlay now carries `token:heading` here (Stage 4). Passing
      // that through as a literal family would set the editing caret in a font
      // that does not exist, while the iframe beneath it renders the resolved
      // one — the editor/export divergence R3 exists to prevent.
      fontFamily: previewCssFont(t.fontFamily, tokenFonts, 'inherit'),
      fontSizePt: Number(t.fontSize) || 12,
      color,
      fontWeightNumeric: t.fontWeightNumeric,
      fontWeight: t.fontWeight,
      fontStyle: t.fontStyle,
      align: t.align,
      lineHeight: t.lineHeight,
      letterSpacingPt: t.letterSpacing,
      paddingPt: {
        top: t.paddingTop, right: t.paddingRight,
        bottom: t.paddingBottom, left: t.paddingLeft,
      },
      verticalAlign: t.verticalAlign,
      whiteSpace: t.whiteSpace,
      textDecoration: t.textDecoration,
      textTransform: t.textTransform,
      hyphens: t.hyphens,
      columns: t.columns,
      columnGapPt: t.columnGap,
      fontVariantNumeric: t.fontVariantNumeric,
      maxLines: t.maxLines,
      overflowPolicy: t.overflowPolicy,
    }, { unit: 'px', scale: zoom }));
    return (
      <textarea
        autoFocus
        defaultValue={String(t.content ?? '')}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: '100%', height: '100%',
          margin: 0,
          ...(shared as React.CSSProperties),
          wordBreak: 'break-word',
          opacity: o.opacity ?? 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
        }}
      />
    );
  }
  if (o.type === 'chart') {
    // W3 — marker for a reconstruction not corroborated against printed labels.
    const preservation = (o as any).chartPreservation as
      | { manualReviewRequired?: boolean; renderMode?: string } | undefined;
    return (
      <div
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        title={preservation?.renderMode ? `Chart · ${preservation.renderMode}` : 'Chart'}
      >
        {preservation?.manualReviewRequired ? (
          <div
            aria-label="Chart values need review"
            className="absolute right-0 top-0 rounded-full bg-warning"
            style={{ width: 8 * zoom, height: 8 * zoom }}
          />
        ) : null}
      </div>
    );
  }
  return null;
}


function previewCssFont(value: unknown, tokenFonts: Record<string, string>, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return fallback;
  if (raw.startsWith('token:')) return tokenFonts[raw.slice(6)] || fallback;
  if (raw.includes('{{')) return fallback;
  return raw;
}

function previewCssColor(value: unknown, tokenColors: Record<string, string>, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return fallback;
  if (raw.startsWith('token:')) return tokenColors[raw.slice(6)] || fallback;
  if (/^\{\{/.test(raw)) return fallback;
  return raw;
}

/**
 * Memoized: the canvas hosts an iframe + O(overlays) handle layer; memo keeps
 * unrelated editor state changes (dialogs, presence, save status, …) from
 * re-rendering it. Callers must pass useCallback-stable handlers.
 */
export const EditorialCanvas = memo(EditorialCanvasImpl);
