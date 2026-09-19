/**
 * "Which template does this come out in?" — asked where the document is
 * produced, not on a settings page.
 *
 * ## Why this exists
 *
 * Choosing a template was possible in exactly two places: the Template Library
 * list, and one export panel. Every other format's download control offered no
 * way to see or change it, so the answer to "which template is this going to
 * use?" lived a page away from the button that used it. A person downloading a
 * Client Details report had to know that a Library page existed, that it had a
 * per-format list on it, and that the list governed the button they were
 * already looking at.
 *
 * Most of those controls are split buttons with a dropdown of destinations, so
 * this is shaped for that: a labelled section at the foot of the menu that
 * states the current template and opens the picker. Surfaces with room for a
 * line of their own use `ReportTemplateSelector` instead — same hook, same
 * picker, same selection.
 *
 * ## Two nodes, because a dialog cannot live inside a menu
 *
 * Radix unmounts `DropdownMenuContent` when the menu closes, which would take
 * a dialog rendered inside it with it — the picker would open and vanish in the
 * same frame. So the hook hands back the menu section *and* the dialog
 * separately, and the caller puts the dialog outside the menu. Returning both
 * from one call is what keeps the two halves from drifting apart across eight
 * surfaces.
 */
import { useState, type ReactNode } from 'react';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { FileStack, TriangleAlert } from 'lucide-react';
import { ReportTemplatePicker } from '@/components/reports/ReportTemplatePicker';
import { useReportTemplateSelection } from '@/hooks/useReportTemplateSelection';
import { findReportFormat } from '@/lib/reportTemplate/reportFormats';

export interface ReportTemplateMenu {
  /** The section to drop at the foot of a `DropdownMenuContent`. */
  section: ReactNode;
  /** The picker dialog. Render it *outside* the menu. */
  dialog: ReactNode;
}

export interface ReportTemplateMenuOptions {
  /**
   * What to call the format on screen.
   *
   * Optional: the adapter registry already names every format, and a caller
   * that passes nothing gets the name the Library page uses, which is the
   * point of having one registry.
   */
  formatLabel?: string;
  /**
   * Whether to rule off from the items above. Default true.
   *
   * False for a menu this section is the *whole* of — a separator as the first
   * thing in a menu rules off from nothing and reads as a missing item.
   */
  separator?: boolean;
}

export function useReportTemplateMenu(
  reportType: string,
  options?: ReportTemplateMenuOptions,
): ReportTemplateMenu {
  const [pickerOpen, setPickerOpen] = useState(false);
  const format = findReportFormat(reportType);
  const label = options?.formatLabel ?? format?.label ?? 'this format';
  const { state, isLoading, error } = useReportTemplateSelection(reportType);

  // A format a choice cannot change must not offer one. The preview-only
  // formats say why on the Library page; a menu item here would be a control
  // that does nothing.
  if (!format?.supportsProduction) return { section: null, dialog: null };

  const detail = (() => {
    if (isLoading) return 'Checking…';
    // A failed read is not "nothing chosen" — saying so would invite somebody
    // to re-pick a template they had already picked.
    // The consequence, not just the fault: a person who reads only that the
    // check failed has no way to know whether their download still works.
    if (error || !state) return 'We couldn’t check which template is set. Generation is unaffected.';
    if (state.status === 'selected') {
      return state.rendersThroughDesignSystem
        ? 'Used for every report of this format.'
        : 'Chosen, and it produces the standard layout.';
    }
    if (state.status === 'unavailable') {
      return 'Your chosen template is no longer available — using the default.';
    }
    return `No template chosen — using the default for ${label}.`;
  })();

  const title = state?.status === 'selected'
    ? state.template?.name ?? 'Chosen template'
    : 'Choose a template';

  const section = (
    <>
      {options?.separator !== false && <DropdownMenuSeparator />}
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        Which template this comes out in
      </DropdownMenuLabel>
      <DropdownMenuItem
        onSelect={(e) => { e.preventDefault(); setPickerOpen(true); }}
        className="cursor-pointer"
      >
        {state?.status === 'unavailable'
          ? <TriangleAlert className="mr-2 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          : <FileStack className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <div className="flex min-w-0 flex-col">
          {/* Template names are user-authored and run long — the row truncates
              rather than widening the menu. */}
          <span className="truncate">{title}</span>
          {/* Announced when it settles: the menu can be open while the query
              resolves, and the line goes from "Checking…" to the answer
              without anything else on screen moving. */}
          <span className="text-xs text-muted-foreground" aria-live="polite">{detail}</span>
        </div>
      </DropdownMenuItem>
    </>
  );

  const dialog = (
    <ReportTemplatePicker
      reportType={reportType}
      formatLabel={label}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
    />
  );

  return { section, dialog };
}
