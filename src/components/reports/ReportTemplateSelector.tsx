/**
 * The locked-in template, shown where a report is generated.
 *
 * One line before the generate button that answers the question nobody could
 * previously ask: which template is this document going to come out in? Once a
 * template has been chosen it stays chosen — this states it and offers one way
 * to change it, which opens a picker rather than the Template Builder.
 *
 * It never blocks generation. A format with nothing chosen resolves exactly as
 * it always has (highest-ranked active template, then the legacy generator),
 * and this says so instead of demanding a decision before the button works.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileStack, TriangleAlert } from 'lucide-react';
import { ReportTemplatePicker } from '@/components/reports/ReportTemplatePicker';
import { useReportTemplateSelection } from '@/hooks/useReportTemplateSelection';

interface Props {
  /** Any spelling of the format; normalised before anything is stored. */
  reportType: string;
  /** What to call the format on screen. */
  formatLabel: string;
  className?: string;
}

export function ReportTemplateSelector({ reportType, formatLabel, className }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { state, isLoading, error } = useReportTemplateSelection(reportType);

  const body = (() => {
    if (isLoading) return <Skeleton className="h-4 w-40" />;
    // A failed read is not "nothing chosen". Saying so would invite somebody to
    // re-pick a template they had already picked.
    if (error || !state) {
      return (
        <span className="text-xs text-muted-foreground">
          We couldn’t check which template is set. Generation is unaffected.
        </span>
      );
    }
    if (state.status === 'selected') {
      return (
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{state.template?.name}</span>
          {!state.rendersThroughDesignSystem && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <TriangleAlert className="h-3 w-3 text-warning" aria-hidden="true" />
              Standard generator
            </Badge>
          )}
        </span>
      );
    }
    if (state.status === 'unavailable') {
      return (
        <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
          Your chosen template is no longer available — using the default until you pick another.
        </span>
      );
    }
    return (
      <span className="text-xs text-muted-foreground">
        No template chosen — using the default for {formatLabel}.
      </span>
    );
  })();

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/70 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileStack className="h-3.5 w-3.5" aria-hidden="true" />
            Template
          </div>
          <div className="mt-1 min-w-0">{body}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 bg-background/70"
          onClick={() => setPickerOpen(true)}
        >
          {state?.status === 'selected' ? 'Change template' : 'Choose template'}
        </Button>
      </div>

      <ReportTemplatePicker
        reportType={reportType}
        formatLabel={formatLabel}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      />
    </div>
  );
}
