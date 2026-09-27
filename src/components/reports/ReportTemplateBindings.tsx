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
import { isTemplateDeliveryHeld } from '../../../supabase/functions/_shared/reports/templateParity.pure.ts';
import {
  borrowedDesignNote,
  designLenderFor,
  drawnDocumentsNote,
} from '../../../supabase/functions/_shared/reports/templateDesignRoute.pure.ts';

interface RowState {
  format: ReportFormatDescriptor;
  state: ReturnType<typeof buildFormatTemplateState>;
  /**
   * The format whose chosen design this one wears, when it has no templates of
   * its own (`DESIGN_BORROWED_FROM`). Its row shows that choice and changes it.
   */
  designLender: ReportFormatDescriptor | null;
}

function BindingRow({ format, state, designLender, onChange }: RowState & { onChange: () => void }) {
  // A production format drawn by its own route, in the chosen template's
  // design (`templateParity.pure.ts`). A preview-only format that borrows a
  // design says whose; any other preview-only one already says why a choice
  // changes nothing, so it is not told twice.
  const held = format.supportsProduction && isTemplateDeliveryHeld(format.reportType);
  const designed = held || designLender !== null;
  const drawnNote = drawnDocumentsNote(format.reportType);
  const borrowedNote = borrowedDesignNote(format.reportType);
  const summary = (() => {
    if (state.status === 'selected') {
      return (
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{state.template?.name}</span>
          {/* A design is read from a template's tokens alone, so the engine
              that would have drawn its pages says nothing about a held type. */}
          {!state.rendersThroughDesignSystem && !designed && (
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
          {designed
            ? 'The chosen template is no longer available — using the standard design until another is picked.'
            : 'The chosen template is no longer available — using the default until another is picked.'}
        </span>
      );
    }
    return (
      <span className="text-xs text-muted-foreground">
        {state.candidates.length === 0
          ? 'No active templates published for this format yet.'
          : designed
            ? 'Standard design until a template is chosen.'
            : `Choosing automatically from ${state.candidates.length} active template${state.candidates.length === 1 ? '' : 's'}.`}
      </span>
    );
  })();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{format.label}</span>
          {!format.supportsProduction && !designLender && (
            <Badge variant="outline" className="text-[10px]">Preview only</Badge>
          )}
          {designed && (
            <Badge variant="outline" className="text-[10px]" data-testid="template-design-badge">Design</Badge>
          )}
        </div>
        <div className="mt-1 min-w-0">{summary}</div>
        {!format.supportsProduction && !designLender && format.previewOnlyReason && (
          <p className="mt-1 text-xs text-muted-foreground">{format.previewOnlyReason}</p>
        )}
        {held && (
          <p className="mt-1 text-xs text-muted-foreground">
            Keeps its own pages, with everything the standard document prints. The template you
            choose sets its typefaces, colours, cover and table style.
          </p>
        )}
        {designLender && (
          <p className="mt-1 text-xs text-muted-foreground">
            Drawn in the design chosen for the {designLender.label}, the report it is made from.
          </p>
        )}
        {drawnNote && (
          // The documents drawn without a template of their own that wear this
          // choice (`DRAWN_DOCUMENTS`), named where the choice is made.
          <p className="mt-1 text-xs text-muted-foreground" data-testid="template-drawn-documents">
            {drawnNote}
          </p>
        )}
        {borrowedNote && (
          // The report types that wear this choice as their own design
          // (`DESIGN_BORROWED_FROM`), named on the row that lends it.
          <p className="mt-1 text-xs text-muted-foreground" data-testid="template-borrowed-design">
            {borrowedNote}
          </p>
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
    const formats = listReportFormats();
    return formats.map((format) => {
      const lenderKey = designLenderFor(format.reportType);
      const designLender = lenderKey ? formats.find((f) => f.reportType === lenderKey) ?? null : null;
      return {
        format,
        designLender,
        // A format that borrows its design shows the choice it wears.
        state: buildFormatTemplateState({
          reportType: designLender?.reportType ?? format.reportType,
          templates: templates.data,
          selections: selections.data,
        }),
      };
    });
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
          that format until it is changed here. With nothing chosen, Investment reports use the
          highest-ranked active template, as they always have, and every other report uses its
          own standard design.
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
              {error.message} Reports can still be generated: each one reads its template choice
              when it is made.
            </AlertDescription>
          </Alert>
        ) : (
          rows.map(({ format, state, designLender }) => (
            <BindingRow
              key={format.reportType}
              format={format}
              state={state}
              designLender={designLender}
              // Changing a borrowed design changes it where it is chosen.
              onChange={() => setPicking(designLender ?? format)}
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
