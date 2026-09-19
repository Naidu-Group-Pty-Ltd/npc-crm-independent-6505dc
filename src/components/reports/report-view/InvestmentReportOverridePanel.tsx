import { ChevronDown, PenLine, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { OverriddenField } from './types';

interface Props {
  overriddenFields: OverriddenField[];
  showOverrides: boolean;
  onShowOverridesChange: (open: boolean) => void;
}

export function InvestmentReportOverridePanel({ overriddenFields, showOverrides, onShowOverridesChange }: Props) {
  const editedFieldCount = overriddenFields.length;

  return (
    <Collapsible open={showOverrides} onOpenChange={onShowOverridesChange}>
      <Card className="overflow-hidden border-border/80 bg-card shadow-sm">
        <CollapsibleTrigger className="w-full text-left">
          <CardHeader className="bg-gradient-to-br from-background via-background to-brand-50/40 pb-4 dark:to-brand-950/10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-2 text-brand-700 shadow-sm dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-300">
                  <SlidersHorizontal className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base text-foreground">Data Adjustments</CardTitle>
                    <Badge variant="outline" className="bg-background/70 text-xs">
                      {editedFieldCount} edited field{editedFieldCount !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Reviewed manual fields applied to this report.</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="text-sm font-medium text-muted-foreground">
                  {showOverrides ? 'Hide details' : 'Show details'}
                </span>
                <div className="rounded-full border bg-background p-1 shadow-sm">
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showOverrides ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 border-t bg-muted/10 p-4 sm:p-5">
            <p className="text-sm text-muted-foreground">
              These fields were manually reviewed and override the generated source data for this report view and its exports.
            </p>
            <div className="flex flex-wrap gap-2">
              {overriddenFields.map((field) => (
                <Badge
                  key={field.key}
                  variant="secondary"
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm"
                >
                  <PenLine className="h-3 w-3 mr-1.5 text-brand-600 dark:text-brand-400" />
                  {field.displayName}
                </Badge>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
