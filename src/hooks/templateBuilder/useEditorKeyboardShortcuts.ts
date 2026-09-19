/**
 * useEditorKeyboardShortcuts — global keyboard shortcuts for the template
 * editor (save/undo/redo, clipboard, duplicate, text styling, z-order,
 * palette, refresh).
 *
 * Uses the "latest ref" pattern: the window listener is attached exactly once
 * and dispatches through a ref refreshed after every render, so handlers are
 * never stale and the listener never re-binds. Callers pass a fresh bindings
 * object on each render — no memoization needed.
 */
import { useEffect, useRef } from 'react';
import type { Overlay } from '@/lib/reportTemplate/templateSchema';

export interface EditorShortcutBindings {
  // ── State read by the dispatcher ─────────────────────────────────────────
  selectedOverlayId: string | null;
  selectedBlockId: string | null;
  selectedOverlay: Overlay | null;
  multiOverlayIds: Set<string>;
  hasStyleClipboard: boolean;
  /**
   * Read at keydown time (getter, not value): the overlay clipboard lives in
   * a ref, so copying does not re-render the editor and a snapshotted boolean
   * would go stale.
   */
  hasOverlayClipboard: () => boolean;
  // ── Actions ──────────────────────────────────────────────────────────────
  togglePalette: () => void;
  openShortcuts: () => void;
  save: () => void;
  undo: () => void;
  redo: () => void;
  selectAllOverlays: () => void;
  addPage: () => void;
  copyOverlayStyle: (o: Overlay | null) => void;
  copyBlock: (bid: string) => void;
  pasteOverlayStyleToIds: (ids: string[]) => void;
  pasteBlock: () => void;
  copySelectedOverlays: () => boolean;
  cutSelectedOverlays: () => void;
  pasteOverlays: () => void;
  duplicateSelectedOverlays: () => void;
  duplicateBlock: (bid: string) => void;
  toggleTextStyle: (prop: 'fontWeight' | 'fontStyle' | 'textDecoration') => void;
  shiftZOrder: (dir: 'forward' | 'backward' | 'front' | 'back') => void;
  refreshPreview: () => void;
}

export function useEditorKeyboardShortcuts(bindings: EditorShortcutBindings): void {
  const bindingsRef = useRef(bindings);
  // Refresh on every render so the dispatcher always sees the latest closures.
  bindingsRef.current = bindings;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const b = bindingsRef.current;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const hasOverlaySel = !!b.selectedOverlayId || b.multiOverlayIds.size > 0;

      // ⌘K opens palette from anywhere (including fields)
      if (meta && k === 'k') { e.preventDefault(); b.togglePalette(); return; }
      // `?` shows shortcut cheat sheet (outside fields)
      if (!meta && !isField && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault(); b.openShortcuts(); return;
      }
      if (!meta) return;

      // ── File / history ────────────────────────────────────────────────
      if (k === 's') { e.preventDefault(); b.save(); return; }
      if (k === 'z' && !e.shiftKey) { if (isField) return; e.preventDefault(); b.undo(); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { if (isField) return; e.preventDefault(); b.redo(); return; }

      // ── Selection ─────────────────────────────────────────────────────
      if (k === 'a' && !isField) { e.preventDefault(); b.selectAllOverlays(); return; }

      // ── Page management ───────────────────────────────────────────────
      if (k === 'n' && !isField) { e.preventDefault(); b.addPage(); return; }

      // ── Style clipboard (Alt+C / Alt+V) ───────────────────────────────
      if (e.altKey && k === 'c' && !isField) {
        e.preventDefault();
        if (b.selectedOverlay) b.copyOverlayStyle(b.selectedOverlay);
        else if (b.selectedBlockId) b.copyBlock(b.selectedBlockId);
        return;
      }
      if (e.altKey && k === 'v' && !isField) {
        e.preventDefault();
        const ids = b.multiOverlayIds.size > 0
          ? Array.from(b.multiOverlayIds)
          : b.selectedOverlayId ? [b.selectedOverlayId] : [];
        if (b.hasStyleClipboard && ids.length > 0) b.pasteOverlayStyleToIds(ids);
        else b.pasteBlock();
        return;
      }

      // ── Overlay clipboard: Ctrl/⌘ + C / X / V ─────────────────────────
      if (k === 'c' && !isField) {
        if (hasOverlaySel) { e.preventDefault(); b.copySelectedOverlays(); return; }
        if (b.selectedBlockId) { e.preventDefault(); b.copyBlock(b.selectedBlockId); return; }
      }
      if (k === 'x' && !isField) {
        if (hasOverlaySel) { e.preventDefault(); b.cutSelectedOverlays(); return; }
      }
      if (k === 'v' && !isField) {
        e.preventDefault();
        if (b.hasOverlayClipboard()) b.pasteOverlays();
        else b.pasteBlock();
        return;
      }

      // ── Duplicate ─────────────────────────────────────────────────────
      if (k === 'd' && !isField) {
        e.preventDefault();
        if (hasOverlaySel) b.duplicateSelectedOverlays();
        else if (b.selectedBlockId) b.duplicateBlock(b.selectedBlockId);
        return;
      }

      // ── Text styling (only meaningful for text overlays) ──────────────
      if (k === 'b' && !isField && hasOverlaySel) { e.preventDefault(); b.toggleTextStyle('fontWeight'); return; }
      if (k === 'i' && !isField && hasOverlaySel) { e.preventDefault(); b.toggleTextStyle('fontStyle'); return; }
      if (k === 'u' && !isField && hasOverlaySel) { e.preventDefault(); b.toggleTextStyle('textDecoration'); return; }

      // ── Z-order: Ctrl+] / Ctrl+[ (Shift = front/back) ─────────────────
      if (e.key === ']' && hasOverlaySel && !isField) {
        e.preventDefault(); b.shiftZOrder(e.shiftKey ? 'front' : 'forward'); return;
      }
      if (e.key === '[' && hasOverlaySel && !isField) {
        e.preventDefault(); b.shiftZOrder(e.shiftKey ? 'back' : 'backward'); return;
      }

      // ── R: refresh / reload preview (don't fall through to browser reload) ─
      if (k === 'r' && !isField) {
        e.preventDefault();
        b.refreshPreview();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
