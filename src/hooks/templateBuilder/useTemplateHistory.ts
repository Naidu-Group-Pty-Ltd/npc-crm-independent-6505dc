/**
 * useTemplateHistory — façade over `templateEditorStore` exposing the editor's
 * document state machine: template + patch-based undo/redo + governance guard.
 *
 * Rehaul Phase 2 history: first extracted from TemplateBuilderEdit as a
 * self-contained useState hook, then re-pointed at the zustand store so the
 * document lives outside React and panels can subscribe to slices. The API is
 * unchanged for callers.
 *
 * Mounting this hook starts a fresh editor session (matching the old
 * component-owned state lifecycle). The app mounts one template editor at a
 * time, so the global store reset is safe.
 *
 * API notes:
 * - `setTemplate` records a history entry for every change (unless the
 *   template is governance-locked, in which case the edit is rejected with a
 *   toast).
 * - `loadTemplate` replaces the document WITHOUT recording history and clears
 *   the undo/redo stacks — use it for hydration from the server, draft
 *   restore, etc.
 * - `setGovernanceReadOnly` flips the approved-template guard.
 */
import { useState } from 'react';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import { resetTemplateEditor, useTemplateEditorStore } from '@/stores/templateEditorStore';

export interface TemplateHistoryApi {
  template: ReportTemplate;
  /** History-recording setter (rejected while governance-locked). */
  setTemplate: (updater: ReportTemplate | ((prev: ReportTemplate) => ReportTemplate)) => void;
  /** Replace the document without recording history (clears undo/redo). */
  loadTemplate: (next: ReportTemplate) => void;
  undo: () => void;
  redo: () => void;
  setGovernanceReadOnly: (locked: boolean) => void;
}

export function useTemplateHistory(initial?: ReportTemplate): TemplateHistoryApi {
  // Fresh session per mount. useState's initializer runs once per mount,
  // before any subscription below reads the store.
  useState(() => {
    resetTemplateEditor();
    if (initial) useTemplateEditorStore.getState().loadTemplate(initial);
  });

  const template = useTemplateEditorStore((s) => s.template);
  // Actions are identity-stable for the store's lifetime — reading them off
  // getState() (no subscription) is the idiomatic zustand pattern.
  const { setTemplate, loadTemplate, undo, redo, setGovernanceReadOnly } = useTemplateEditorStore.getState();

  return { template, setTemplate, loadTemplate, undo, redo, setGovernanceReadOnly };
}
