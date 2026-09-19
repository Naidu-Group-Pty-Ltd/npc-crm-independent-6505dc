/**
 * Every report format, and the template its documents come out in.
 *
 * The one place that answers the question for all of them at once. Each row is
 * a format from the adapter registry, the template currently locked in for it,
 * and one control to change that — which opens a picker, not the Template
 * Builder. Choosing a template is a choice; the Builder is an editor, and
 * sending somebody there to make a choice is how this ended up with no chooser
 * at all.
 *
 * The list is derived, never enumerated: a format appears because it has an
 * adapter, so a format added to the registry appears here the same day and a
 * preview-only one says why a choice would not change anything.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileStack, TriangleAlert } from 'lucide-react';
import { ReportTemplatePicker } from '@/components/reports/ReportTemplatePicker';
import {
  useActiveReportTemplates, useReportTemplateSelections,
} from '@/hooks/useReportTemplateSelection';
import { buildFormatTemplateState } from '@/lib/reportTemplate/templateSelection';
import { listReportFormats, type ReportFormatDescriptor } from '@/lib/reportTemplate/reportFormats';

interface RowState {
  format: ReportFormatDescriptor;
  state: ReturnType<typeof buildFormatTemplateState>;
}

function BindingRow({ format, state, onChange }: RowState & { onChange: () => void }) {
  const summary = (() => {
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
          The chosen template is no longer available — using the default until another is picked.
        </span>
      );
    }
    return (
      <span className="text-xs text-muted-foreground">
        {state.candidates.length === 0
          ? 'No active templates published for this format yet.'
          : `Choosing automatically from ${state.candidates.length} active template${state.candidates.length === 1 ? '' : 's'}.`}
      </span>
    );
  })();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{format.label}</span>
          {!format.supportsProduction && (
            <Badge variant="outline" className="text-[10px]">Preview only</Badge>
          )}
        </div>
        <div className="mt-1 min-w-0">{summary}</div>
        {!format.supportsProduction && format.previewOnlyReason && (
          <p className="mt-1 text-xs text-muted-foreground">{format.previewOnlyReason}</p>
        )}
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onChange}>
        {state.status === 'selected' ? 'Change' : 'Choose'}
      </Button>
    </div>
  );
}

export function ReportTemplateBindings() {
  const templates = useActiveReportTemplates();
  const selections = useReportTemplateSelections();
  const [picking, setPicking] = useState<ReportFormatDescriptor | null>(null);

  const rows = useMemo<RowState[]>(() => {
    if (!templates.data || !selections.data) return [];
    return listReportFormats().map((format) => ({
      format,
      state: buildFormatTemplateState({
        reportType: format.reportType,
        templates: templates.data,
        selections: selections.data,
      }),
    }));
  }, [templates.data, selections.data]);

  const loading = templates.isLoading || selections.isLoading;
  const error = (templates.error as Error | null) ?? (selections.error as Error | null) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileStack className="h-5 w-5 text-primary" aria-hidden="true" />
          Template per report format
        </CardTitle>
        <CardDescription>
          Pick the template each format is generated with. A choice is kept for every report of
          that format until it is changed here; formats with nothing chosen use the
          highest-ranked active template, as they always have.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        ) : error ? (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>We couldn’t load the template choices</AlertTitle>
            <AlertDescription>
              {error.message} Report generation is unaffected — it resolves a template the way it
              did before.
            </AlertDescription>
          </Alert>
        ) : (
          rows.map(({ format, state }) => (
            <BindingRow
              key={format.reportType}
              format={format}
              state={state}
              onChange={() => setPicking(format)}
            />
          ))
        )}
      </CardContent>

      {picking && (
        <ReportTemplatePicker
          reportType={picking.reportType}
          formatLabel={picking.label}
          open
          onOpenChange={(open) => { if (!open) setPicking(null); }}
        />
      )}
    </Card>
  );
}
