/**
 * useTemplateMutators — façade over `templateEditorStore` exposing every
 * page/block/overlay mutator and the selection handlers.
 *
 * Rehaul Phase 2 history: first extracted from TemplateBuilderEdit as a
 * useCallback hook, then re-pointed at the zustand store. Store actions read
 * fresh state via `get()`, so every handler is **permanently identity-stable**
 * — page-scoped mutators no longer change identity when the active page's
 * object changes, which is what lets the memoized editor surfaces skip
 * re-renders during typing/dragging.
 */
import { useTemplateEditorStore } from '@/stores/templateEditorStore';

export function useTemplateMutators() {
  // Actions never change identity; no subscription needed.
  const s = useTemplateEditorStore.getState();
  return {
    updatePage: s.updatePage,
    setActivePageOverlays: s.setActivePageOverlays,
    updateOverlay: s.updateOverlay,
    deleteOverlay: s.deleteOverlay,
    duplicateOverlay: s.duplicateOverlay,
    addOverlayToActivePage: s.addOverlayToActivePage,
    addBlockToActivePage: s.addBlockToActivePage,
    updateBlock: s.updateBlock,
    deleteBlock: s.deleteBlock,
    duplicateBlock: s.duplicateBlock,
    moveBlock: s.moveBlock,
    reorderBlocks: s.reorderBlocks,
    addPage: s.addPage,
    duplicatePage: s.duplicatePage,
    deletePage: s.deletePage,
    movePage: s.movePage,
    selectPage: s.selectPage,
    selectBlockClearOverlay: s.selectBlockClearOverlay,
    handlePreviewSelect: s.handlePreviewSelect,
    handleCanvasSelectOverlay: s.handleCanvasSelectOverlay,
    handleOverlaysBulkPatch: s.handleOverlaysBulkPatch,
    handlePaletteDrop: s.handlePaletteDrop,
  };
}
