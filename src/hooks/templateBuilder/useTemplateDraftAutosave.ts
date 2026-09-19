import { useEffect, useRef, useState } from 'react';
import { saveTemplateDraft, type TemplateDraft } from '@/lib/reportTemplate/templateDraftStore';

export interface TemplateDraftAutosaveOptions {
  templateId: string | undefined;
  /** Autosave only runs while this is true (e.g. dirty && loaded && not recovering). */
  enabled: boolean;
  /**
   * A cheap, stable string that changes whenever the persisted content changes.
   * The editor already memoizes an edit signature, so we reuse it rather than
   * re-serializing the whole template here.
   */
  changeKey: string;
  /** Lazily builds the latest draft snapshot when the debounce fires. */
  getDraft: () => Omit<TemplateDraft, 'savedAt'> | null;
  debounceMs?: number;
}

/**
 * Local-only autosave (Phase 3B). Debounces editor changes and persists a draft
 * snapshot to IndexedDB. It never touches the server — the user still saves the
 * server copy manually — so there is no conflict risk from autosaving.
 */
export function useTemplateDraftAutosave({
  templateId,
  enabled,
  changeKey,
  getDraft,
  debounceMs = 2000,
}: TemplateDraftAutosaveOptions) {
  const [lastLocalSaveAt, setLastLocalSaveAt] = useState<string | null>(null);
  const getDraftRef = useRef(getDraft);
  getDraftRef.current = getDraft;

  useEffect(() => {
    if (!enabled || !templateId) return;
    const handle = window.setTimeout(() => {
      const snapshot = getDraftRef.current();
      if (!snapshot) return;
      const savedAt = new Date().toISOString();
      void saveTemplateDraft({ ...snapshot, savedAt })
        .then(() => setLastLocalSaveAt(savedAt))
        .catch(() => {
          /* best-effort: a failed local autosave must never disrupt editing */
        });
    }, debounceMs);
    return () => window.clearTimeout(handle);
    // changeKey drives re-debouncing on every content change.
  }, [enabled, templateId, changeKey, debounceMs]);

  return { lastLocalSaveAt, setLastLocalSaveAt };
}
