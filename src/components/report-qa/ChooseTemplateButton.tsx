/**
 * "Choose template" — the one decision beside the button that makes the PDF.
 *
 * The Hub's export dialogs used to offer two PDF buttons: "Typeset PDF", which
 * drew the answer through the design system in whatever template had been
 * chosen, and "Export PDF", which ignored the choice and drew the old
 * in-browser layout. Two buttons that each make a PDF, only one of which
 * honours the template, is how a person chooses a template and receives the
 * legacy document.
 *
 * So the choice and the act are separate controls now: this one only chooses —
 * it opens the same picker the Template Library uses and names what is chosen —
 * and Export PDF is the only thing that makes a file, in the choice made here.
 * The picker says before anything is chosen that a template dresses this
 * document rather than re-paging it (`TEMPLATE_DESIGN_NOTICE`), which is how
 * every report type but Investment honours a template.
 */
import { useState } from 'react';
import { FileStack, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ReportTemplatePicker } from '@/components/reports/ReportTemplatePicker';
import { useReportTemplateSelection } from '@/hooks/useReportTemplateSelection';
import { HUB_DOCUMENT_NAME } from '@/lib/reports/reportQa/documentIdentity.pure';

export interface ChooseTemplateButtonProps {
  disabled?: boolean;
  className?: string;
}

/** What the button says the export will come out in, for its accessible name and tooltip. */
export function chosenTemplateLine(state: ReturnType<typeof useReportTemplateSelection>['state']): string {
  if (!state) return 'Choose which template the PDF comes out in';
  if (state.status === 'selected') return `Template: ${state.template?.name ?? 'chosen template'}`;
  if (state.status === 'unavailable') return 'Your chosen template is no longer available — the standard design is used';
  return 'No template chosen — the standard design is used';
}

export function ChooseTemplateButton({ disabled, className }: ChooseTemplateButtonProps) {
  const [open, setOpen] = useState(false);
  const { state } = useReportTemplateSelection('qa');
  const line = chosenTemplateLine(state);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
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
        reportType="qa"
        formatLabel={HUB_DOCUMENT_NAME}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
