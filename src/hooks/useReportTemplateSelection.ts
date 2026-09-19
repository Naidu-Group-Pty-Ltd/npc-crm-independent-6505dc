/**
 * "Which template does this report format come out in?" — read, choose, clear.
 *
 * Two queries and two mutations, shared by every surface that asks: the control
 * beside a generate button, the per-format list, and the generation path
 * itself. They are separate queries because the answer has two halves that
 * change at different rates — the catalogue of active templates (rarely, and by
 * somebody else) and this user's choices (only when they choose) — and because
 * a stale selection is only detectable by holding both.
 *
 * Nothing here navigates. Choosing a template is a choice, not an edit, and it
 * used to require opening the Template Builder to make.
 */
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  buildFormatTemplateState,
  clearTemplateSelection,
  fetchActiveReportTemplates,
  fetchTemplateSelections,
  saveTemplateSelection,
  type FormatTemplateState,
  type ReportTemplateSelectionRow,
  type SelectableTemplateRow,
} from '@/lib/reportTemplate/templateSelection';

const TEMPLATES_KEY = ['report-template-selection', 'templates'] as const;
const SELECTIONS_KEY = ['report-template-selection', 'selections'] as const;

/** The catalogue: every active template, across all formats. */
export function useActiveReportTemplates() {
  return useQuery<SelectableTemplateRow[]>({
    queryKey: TEMPLATES_KEY,
    queryFn: fetchActiveReportTemplates,
    // Templates change when somebody approves and activates one, which is rare
    // and never mid-generation.
    staleTime: 5 * 60_000,
  });
}

/** This user's choices, every format at once. */
export function useReportTemplateSelections() {
  return useQuery<ReportTemplateSelectionRow[]>({
    queryKey: SELECTIONS_KEY,
    queryFn: fetchTemplateSelections,
    staleTime: 60_000,
  });
}

export interface UseReportTemplateSelectionResult {
  /** Null until both halves have loaded — a half-answer is not an answer. */
  state: FormatTemplateState | null;
  isLoading: boolean;
  /** The read failed. Generation still works; it just resolves as it always did. */
  error: Error | null;
  isSaving: boolean;
  select: (templateId: string) => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * One format's answer.
 *
 * `state` is null while loading and stays null on error, so a caller cannot
 * mistake "we could not read your choice" for "you have not chosen" — the
 * first must not be shown as a settled state, and neither may block a
 * generation that would otherwise have worked.
 */
export function useReportTemplateSelection(
  reportType: string | null | undefined,
): UseReportTemplateSelectionResult {
  const queryClient = useQueryClient();
  const templates = useActiveReportTemplates();
  const selections = useReportTemplateSelections();

  const state = useMemo<FormatTemplateState | null>(() => {
    if (!reportType) return null;
    if (!templates.data || !selections.data) return null;
    return buildFormatTemplateState({
      reportType,
      templates: templates.data,
      selections: selections.data,
    });
  }, [reportType, templates.data, selections.data]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SELECTIONS_KEY });
  }, [queryClient]);

  const selectMutation = useMutation({
    mutationFn: (templateId: string) => saveTemplateSelection(reportType ?? '', templateId),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? 'Could not save the template choice.'),
  });

  const clearMutation = useMutation({
    mutationFn: (selectionId: string) => clearTemplateSelection(selectionId),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? 'Could not clear the template choice.'),
  });

  const select = useCallback(async (templateId: string) => {
    await selectMutation.mutateAsync(templateId);
  }, [selectMutation]);

  const clear = useCallback(async () => {
    const selectionId = state?.selectionId;
    if (!selectionId) return;
    await clearMutation.mutateAsync(selectionId);
  }, [clearMutation, state?.selectionId]);

  return {
    state,
    isLoading: templates.isLoading || selections.isLoading,
    error: (templates.error as Error | null) ?? (selections.error as Error | null) ?? null,
    isSaving: selectMutation.isPending || clearMutation.isPending,
    select,
    clear,
  };
}
