/**
 * The report's own account of what informed it — and what did not.
 *
 * Generation records every source it attempted in `data_sources` (present
 * with provenance, or null) and any prose-vs-record contradictions in
 * `validation_flags` (`type: 'fact'`). Nothing surfaced either, so a report
 * missing three of its sources looked identical to a complete one.
 *
 * A badge must mean something is unmet: this renders ONLY when a source is
 * missing or a fact check flagged — a complete, clean report shows nothing.
 * Wording is for a reader outside the industry; the flag's own message is
 * already written that way by the generator.
 */
import { Database, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const SOURCE_LABELS: Record<string, string> = {
  demographics: 'Local demographics',
  financials: 'Financial modelling',
  marketData: 'Market data',
  locationIntelligence: 'Location intelligence',
  economics: 'Economic indicators',
  seifa: 'Socio-economic index',
  crimeStatistics: 'Crime statistics',
  employment: 'Employment data',
  climate: 'Climate data',
  riskAssessment: 'Risk assessment',
  investmentScore: 'Investment scoring',
};

const labelFor = (key: string): string =>
  SOURCE_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

interface FactFlag {
  type?: string;
  message?: string;
  field?: string;
}

interface Props {
  dataSources?: Record<string, unknown> | null;
  validationFlags?: unknown[] | null;
}

export function InvestmentReportCoverageNote({ dataSources, validationFlags }: Props) {
  const sourceEntries = dataSources && typeof dataSources === 'object'
    ? Object.entries(dataSources).filter(([key]) => !key.startsWith('_'))
    : [];
  const missing = sourceEntries.filter(([, value]) => value === null || value === undefined).map(([key]) => key);
  const present = sourceEntries.length - missing.length;

  const factFlags = (Array.isArray(validationFlags) ? validationFlags : [])
    .filter((f): f is FactFlag => !!f && typeof f === 'object' && (f as FactFlag).type === 'fact');

  if (missing.length === 0 && factFlags.length === 0) return null;

  return (
    <Card className="overflow-hidden border-border/80 bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-2 text-warning shadow-sm">
            <Database className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base text-foreground">Data Coverage</CardTitle>
              {sourceEntries.length > 0 && (
                <Badge variant="outline" className="bg-background/70 text-xs">
                  {present} of {sourceEntries.length} sources
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              What informed this report — and what was unavailable when it was written.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 border-t bg-muted/10 p-4 sm:p-5">
        {missing.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              These sources returned nothing, so the report was written without them:
            </p>
            <div className="flex flex-wrap gap-2">
              {missing.map((key) => (
                <Badge
                  key={key}
                  variant="secondary"
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm"
                >
                  {labelFor(key)}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {factFlags.length > 0 && (
          <ul className="space-y-2">
            {factFlags.map((flag, i) => (
              <li key={`${flag.field ?? 'fact'}-${i}`} className="flex items-start gap-2 text-sm text-foreground">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{flag.message ?? 'The written analysis disagrees with the property record.'}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
