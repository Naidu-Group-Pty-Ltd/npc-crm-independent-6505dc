/**
 * templateEditorStore — the Template Builder's document state machine as a
 * zustand store (rehaul Phase 2 / state refactor, step 2).
 *
 * Owns:
 * - the template document (single source of truth while editing)
 * - patch-based undo/redo history (non-reactive, capped) + governance guard
 * - editor selection (active page, selected block/overlay, multi-select)
 * - every document mutator and selection handler
 *
 * Why a store instead of component state:
 * - Actions are **permanently identity-stable** and read fresh state via
 *   `get()`, so memoized panels never re-render because a handler closed over
 *   a stale `activePage` and changed identity.
 * - Panels subscribe to **slices** (e.g. `s.template.pages`, the derived
 *   active page) instead of receiving the whole template through props, so
 *   they only re-render when their slice actually changes.
 * - The document state machine is testable without mounting the 3,000-line
 *   editor page.
 *
 * Single-instance assumption: the app mounts one template editor at a time
 * (route `/admin/template-builder/:id`). `resetTemplateEditor()` starts a
 * fresh session; the editor page calls it on mount.
 *
 * Toasts are intentionally part of the actions — they are the editor's UX
 * contract (delete-undo affordances, governance rejections), kept identical
 * to the previous hook implementation.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import * as editorActions from '@/lib/reportTemplate/editorActions';
import {
  applyTemplatePatches,
  diffTemplateValues,
  invertTemplatePatches,
  type TemplatePatch,
} from '@/lib/reportTemplate/templateHistory';
import {
  makeBlankTemplate,
  type Block,
  type Overlay,
  type Page,
  type ReportTemplate,
} from '@/lib/reportTemplate/templateSchema';
import {
  isOverlayPayload,
  positionOverlayAtPoint,
  type BuiltPaletteItem,
} from '@/lib/reportTemplate/overlayDropFactory';

const MAX_HISTORY_ENTRIES = 80;

type Updater<T> = T | ((prev: T) => T);
function resolveUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
}

export interface TemplateEditorState {
  // ── Reactive state ─────────────────────────────────────────────────────────
  template: ReportTemplate;
  activePageId: string | null;
  selectedBlockId: string | null;
  selectedOverlayId: string | null;
  multiOverlayIds: Set<string>;

  // ── Document + history ─────────────────────────────────────────────────────
  /** History-recording setter (rejected with a toast while governance-locked). */
  setTemplate: (updater: Updater<ReportTemplate>) => void;
  /**
   * Replace the document without recording history and clear the undo/redo
   * stacks — for hydration from the server, draft restore, etc. (Undoing
   * across a document replacement would apply stale patches.)
   */
  loadTemplate: (next: ReportTemplate) => void;
  undo: () => void;
  redo: () => void;
  setGovernanceReadOnly: (locked: boolean) => void;
  /** Start a fresh editor session (blank doc, empty history, no selection). */
  reset: () => void;

  // ── Selection ──────────────────────────────────────────────────────────────
  setActivePageId: (updater: Updater<string | null>) => void;
  setSelectedBlockId: (updater: Updater<string | null>) => void;
  setSelectedOverlayId: (updater: Updater<string | null>) => void;
  setMultiOverlayIds: (updater: Updater<Set<string>>) => void;
  toggleMultiOverlay: (oid: string) => void;
  clearMultiSelect: () => void;
  /** Select a page and clear block/overlay selection. */
  selectPage: (pid: string) => void;
  /** Select a block (clearing overlay selection when non-null). */
  selectBlockClearOverlay: (bid: string | null) => void;
  /** Selection callback for the HTML preview iframe. */
  handlePreviewSelect: (payload: { blockId: string | null; pageId: string | null }) => void;
  /** Canvas overlay selection (supports additive multi-select). */
  handleCanvasSelectOverlay: (oid: string | null, additive: boolean) => void;

  // ── Document mutators (active-page scoped ones read the page via get()) ────
  updatePage: (next: Page) => void;
  setActivePageOverlays: (overlays: Overlay[]) => void;
  updateOverlay: (next: Overlay) => void;
  deleteOverlay: (oid: string) => void;
  duplicateOverlay: (oid: string) => void;
  addOverlayToActivePage: (overlay: Overlay) => void;
  addBlockToActivePage: (block: Block) => void;
  updateBlock: (next: Block) => void;
  deleteBlock: (bid: string) => void;
  duplicateBlock: (bid: string) => void;
  moveBlock: (bid: string, dir: -1 | 1) => void;
  reorderBlocks: (from: number, to: number) => void;
  addPage: () => void;
  duplicatePage: (pid: string) => void;
  deletePage: (pid: string) => void;
  movePage: (pid: string, dir: -1 | 1) => void;
  handleOverlaysBulkPatch: (patches: Array<{ id: string; patch: Partial<Overlay> }>) => void;
  handlePaletteDrop: (item: BuiltPaletteItem, point: { x: number; y: number }) => void;
}

export const useTemplateEditorStore = create<TemplateEditorState>()((set, get) => {
  // Non-reactive bookkeeping: history and the governance flag never drive
  // renders on their own, so they live in the creator closure, not in state.
  let past: Array<{ undo: TemplatePatch[]; redo: TemplatePatch[] }> = [];
  let future: Array<{ undo: TemplatePatch[]; redo: TemplatePatch[] }> = [];
  let governanceReadOnly = false;

  const activePageOf = (s: TemplateEditorState): Page | null =>
    s.template.pages.find((p) => p.id === s.activePageId) ?? null;

  const setTemplate = (updater: Updater<ReportTemplate>) => {
    if (governanceReadOnly) {
      toast.error('Approved templates are read-only. Create a branch before editing.');
      return;
    }
    const prev = get().template;
    const next = resolveUpdater(updater, prev);
    if (next === prev) return;
    const redoPatches = diffTemplateValues(prev, next);
    if (redoPatches.length > 0) {
      past.push({ undo: invertTemplatePatches(redoPatches), redo: redoPatches });
      if (past.length > MAX_HISTORY_ENTRIES) past.shift();
      future = [];
    }
    set({ template: next });
  };

  const updatePage = (next: Page) => {
    setTemplate((t) => editorActions.replacePage(t, next));
  };

  return {
    template: makeBlankTemplate(),
    activePageId: null,
    selectedBlockId: null,
    selectedOverlayId: null,
    multiOverlayIds: new Set<string>(),

    // ── Document + history ────────────────────────────────────────────────
    setTemplate,

    loadTemplate: (next) => {
      past = [];
      future = [];
      set({ template: next });
    },

    undo: () => {
      const entry = past.pop();
      if (!entry) { toast('Nothing to undo'); return; }
      future.push(entry);
      set({ template: applyTemplatePatches(get().template, entry.undo) });
    },

    redo: () => {
      const entry = future.pop();
      if (!entry) { toast('Nothing to redo'); return; }
      past.push(entry);
      set({ template: applyTemplatePatches(get().template, entry.redo) });
    },

    setGovernanceReadOnly: (locked) => { governanceReadOnly = locked; },

    reset: () => {
      past = [];
      future = [];
      governanceReadOnly = false;
      set({
        template: makeBlankTemplate(),
        activePageId: null,
        selectedBlockId: null,
        selectedOverlayId: null,
        multiOverlayIds: new Set<string>(),
      });
    },

    // ── Selection ─────────────────────────────────────────────────────────
    setActivePageId: (updater) => {
      const next = resolveUpdater(updater, get().activePageId);
      if (next !== get().activePageId) set({ activePageId: next });
    },
    setSelectedBlockId: (updater) => {
      const next = resolveUpdater(updater, get().selectedBlockId);
      if (next !== get().selectedBlockId) set({ selectedBlockId: next });
    },
    setSelectedOverlayId: (updater) => {
      const next = resolveUpdater(updater, get().selectedOverlayId);
      if (next !== get().selectedOverlayId) set({ selectedOverlayId: next });
    },
    setMultiOverlayIds: (updater) => {
      set({ multiOverlayIds: resolveUpdater(updater, get().multiOverlayIds) });
    },
    toggleMultiOverlay: (oid) => {
      const n = new Set(get().multiOverlayIds);
      if (n.has(oid)) n.delete(oid); else n.add(oid);
      set({ multiOverlayIds: n });
    },
    clearMultiSelect: () => {
      if (get().multiOverlayIds.size > 0) set({ multiOverlayIds: new Set<string>() });
    },
    selectPage: (pid) => {
      set({ activePageId: pid, selectedOverlayId: null, selectedBlockId: null });
    },
    selectBlockClearOverlay: (bid) => {
      set(bid ? { selectedBlockId: bid, selectedOverlayId: null } : { selectedBlockId: bid });
    },
    handlePreviewSelect: ({ blockId, pageId }) => {
      if (pageId && pageId !== get().activePageId) set({ activePageId: pageId });
      if (blockId) set({ selectedBlockId: blockId, selectedOverlayId: null });
    },
    handleCanvasSelectOverlay: (oid, additive) => {
      if (!oid) {
        set({ selectedOverlayId: null, multiOverlayIds: new Set<string>() });
        return;
      }
      if (additive) {
        const n = new Set(get().multiOverlayIds);
        if (n.has(oid)) n.delete(oid); else n.add(oid);
        set({ selectedOverlayId: oid, selectedBlockId: null, multiOverlayIds: n });
      } else {
        set({ selectedOverlayId: oid, selectedBlockId: null, multiOverlayIds: new Set<string>() });
      }
    },

    // ── Document mutators ─────────────────────────────────────────────────
    updatePage,

    setActivePageOverlays: (overlays) => {
      const page = activePageOf(get());
      if (!page) return;
      updatePage(editorActions.distributeOverlays(page, overlays));
    },

    updateOverlay: (next) => {
      const page = activePageOf(get());
      if (!page) return;
      updatePage(editorActions.updateOverlay(page, next));
    },

    deleteOverlay: (oid) => {
      const page = activePageOf(get());
      if (!page) return;
      // Snapshot the page so the user can undo within a few seconds.
      const pageSnapshot: Page = JSON.parse(JSON.stringify(page));
      updatePage(editorActions.removeOverlay(page, oid));
      set({ selectedOverlayId: null });
      toast('Overlay deleted', {
        description: 'You can restore it within 8 seconds.',
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: () => {
            setTemplate((t) => editorActions.replacePage(t, pageSnapshot));
            set({ selectedOverlayId: oid });
            toast.success('Overlay restored');
          },
        },
      });
    },

    duplicateOverlay: (oid) => {
      const current = activePageOf(get());
      if (!current) return;
      const { page, newOverlayId } = editorActions.duplicateOverlay(current, oid);
      updatePage(page);
      if (newOverlayId) set({ selectedOverlayId: newOverlayId });
    },

    addOverlayToActivePage: (overlay) => {
      const page = activePageOf(get());
      if (!page) return;
      updatePage(editorActions.addOverlay(page, overlay));
      set({ selectedOverlayId: overlay.id });
    },

    addBlockToActivePage: (block) => {
      const page = activePageOf(get());
      if (!page) return;
      updatePage(editorActions.appendBlock(page, block));
      set({ selectedBlockId: block.id, selectedOverlayId: null });
    },

    updateBlock: (next) => {
      const page = activePageOf(get());
      if (!page) return;
      updatePage(editorActions.updateBlock(page, next));
    },

    deleteBlock: (bid) => {
      const page = activePageOf(get());
      if (!page) return;
      const snapshot: Page = JSON.parse(JSON.stringify(page));
      updatePage(editorActions.removeBlock(page, bid));
      if (get().selectedBlockId === bid) set({ selectedBlockId: null });
      toast('Block deleted', {
        description: 'You can restore it within 8 seconds.',
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: () => {
            setTemplate((t) => editorActions.replacePage(t, snapshot));
            toast.success('Block restored');
          },
        },
      });
    },

    duplicateBlock: (bid) => {
      const page = activePageOf(get());
      if (!page) return;
      const result = editorActions.duplicateBlock(page, bid);
      if (!result) return;
      updatePage(result.page);
      set({ selectedBlockId: result.newBlockId });
    },

    moveBlock: (bid, dir) => {
      const page = activePageOf(get());
      if (!page) return;
      const next = editorActions.moveBlock(page, bid, dir);
      if (next !== page) updatePage(next);
    },

    reorderBlocks: (from, to) => {
      const page = activePageOf(get());
      if (!page) return;
      const next = editorActions.reorderBlocks(page, from, to);
      if (next !== page) updatePage(next);
    },

    addPage: () => {
      const page = editorActions.makeNewPage(get().template.pages.length);
      setTemplate((t) => editorActions.appendPage(t, page));
      set({ activePageId: page.id });
    },

    duplicatePage: (pid) => {
      const result = editorActions.duplicatePage(get().template, pid);
      if (!result) return;
      setTemplate((t) => ({ ...t, pages: result.pages }));
      set({ activePageId: result.newPageId });
    },

    deletePage: (pid) => {
      const wasActive = get().activePageId === pid;
      setTemplate((t) => editorActions.removePage(t, pid));
      if (wasActive) {
        set({ activePageId: get().template.pages[0]?.id ?? null });
      }
    },

    movePage: (pid, dir) => {
      setTemplate((t) => editorActions.movePage(t, pid, dir));
    },

    handleOverlaysBulkPatch: (patches) => {
      const page = activePageOf(get());
      if (!page) return;
      const map = new Map(patches.map((p) => [p.id, p.patch]));
      updatePage({
        ...page,
        blocks: page.blocks.map((b) => ({
          ...b,
          overlays: b.overlays.map((o) =>
            map.has(o.id) ? ({ ...o, ...map.get(o.id) } as Overlay) : o,
          ),
        })),
      });
    },

    handlePaletteDrop: (item, point) => {
      if (isOverlayPayload(item)) get().addOverlayToActivePage(positionOverlayAtPoint(item.overlay, point));
      else get().addBlockToActivePage(item as Block);
    },
  };
});

/** Start a fresh editor session. The editor page calls this on mount. */
export function resetTemplateEditor(): void {
  useTemplateEditorStore.getState().reset();
}

// ─── Slice hooks ───────────────────────────────────────────────────────────────
// Selector results below are reference-stable (direct state fields or `find`
// over stored arrays), so subscribers only re-render when their slice changes.

/** The whole document — for consumers that legitimately need all of it. */
export function useEditorTemplate(): ReportTemplate {
  return useTemplateEditorStore((s) => s.template);
}

/** Just the pages array — unaffected by tokens/slots/canvas-settings edits. */
export function useEditorPages(): Page[] {
  return useTemplateEditorStore((s) => s.template.pages);
}

/** The derived active page (reference-stable while the page is unchanged). */
export function useActivePage(): Page | null {
  return useTemplateEditorStore((s) => s.template.pages.find((p) => p.id === s.activePageId) ?? null);
}

/** The derived selected overlay on the active page. */
export function useSelectedOverlay(): Overlay | null {
  return useTemplateEditorStore((s) => {
    if (!s.selectedOverlayId) return null;
    const page = s.template.pages.find((p) => p.id === s.activePageId);
    if (!page) return null;
    for (const b of page.blocks) {
      const found = b.overlays.find((o) => o.id === s.selectedOverlayId);
      if (found) return found;
    }
    return null;
  });
}

/**
 * Stable action bundle — safe to destructure anywhere without subscribing
 * (action identities never change). Do NOT read data fields off this: they
 * are a snapshot, not reactive.
 */
export function templateEditorActions(): TemplateEditorState {
  return useTemplateEditorStore.getState();
}
