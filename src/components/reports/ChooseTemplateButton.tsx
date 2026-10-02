/**
 * "Choose template" — the one decision beside the button that makes the PDF.
 *
 * The export surfaces used to offer two PDF buttons: one that drew the document
 * in the chosen template, and one that ignored the choice and drew the old
 * in-browser layout. Two buttons that each make a PDF, only one of which
 * honours the template, is how a person chooses a template and receives the
 * legacy document — which is what the owner reported from the Intelligence Hub
 * on 28 Sep 2026.
 *
 * So the choice and the act are separate controls: this one only chooses — it
 * opens the same picker the Template Library uses and names what is chosen —
 * and the Export PDF beside it is the one thing that makes a file, in the
 * choice made here. The picker says before anything is chosen that a template
 * dresses these documents rather than re-paging them (`TEMPLATE_DESIGN_NOTICE`),
 * which is how every report type but Investment honours a template.
 *
 * Used beside every report's Export PDF: the Intelligence Hub's two editors,
 * the Portfolio Performance Review (its saved-report control and the dialog
 * that shows a freshly generated analysis), the Borrowing Capacity Snapshot and
 * the Strategy Rationale Brief, the Client Details Form, the five Investment
 * documents, the 10 Year Cash Flow (in its header, beside the export menu) and
 * both comparisons. `templateRouteEnforcement.spec.ts` holds the list, and
 * `legacyPathStays.spec.ts` the analysis dialog.
 */
import { useState } from 'react';
import { FileStack, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ReportTemplatePicker } from '@/components/reports/ReportTemplatePicker';
import { useReportTemplateSelection } from '@/hooks/useReportTemplateSelection';

export interface ChooseTemplateButtonProps {
  /** The format whose choice this is — `qa`, `comparison`, `cashflow`. */
  reportType: string;
  /** What the picker calls the format. */
  formatLabel: string;
  /**
   * Said in the tooltip before the current choice, where the choice is another
   * format's: the Cash Flow Comparison is drawn in the Cash Flow's template.
   */
  note?: string;
  disabled?: boolean;
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
}

/** What the button says the export will come out in, for its accessible name and tooltip. */
export function chosenTemplateLine(state: ReturnType<typeof useReportTemplateSelection>['state']): string {
  if (!state) return 'Choose which template the PDF comes out in';
  if (state.status === 'selected') return `Template: ${state.template?.name ?? 'chosen template'}`;
  if (state.status === 'unavailable') return 'Your chosen template is no longer available — the standard design is used';
  return 'No template chosen — the standard design is used';
}

export function ChooseTemplateButton({
  reportType,
  formatLabel,
  note,
  disabled,
  className,
  size = 'sm',
  variant = 'outline',
}: ChooseTemplateButtonProps) {
  const [open, setOpen] = useState(false);
  const { state } = useReportTemplateSelection(reportType);
  const line = note ? `${note} ${chosenTemplateLine(state)}` : chosenTemplateLine(state);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={line}
        aria-label={`Choose template. ${line}`}
      >
        {state?.status === 'unavailable'
          ? <TriangleAlert className="mr-1 h-3 w-3 text-warning" aria-hidden="true" />
          : <FileStack className="mr-1 h-3 w-3" aria-hidden="true" />}
        Choose template
      </Button>
      <ReportTemplatePicker
        reportType={reportType}
        formatLabel={formatLabel}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
