/**
 * Generated Reports — Commercial & Industrial Capacity Reports.
 *
 * The one report format this library never listed (`MODULE_STRUCTURE.md` G1):
 * its documents live in two ledgers the page's investment vocabulary has no
 * slot for, so it is its own tab over its own reader rather than rows forced
 * into the investment pipeline, which would read and group them as Compass
 * reports. The documents are the caller's own assessments', the rule every
 * list in that module follows; each downloads exactly as it was issued and
 * opens the assessment it came from.
 */
import { useNavigate } from 'react-router-dom';
import { ExternalLink, FileText, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { IssuedDocumentList } from '@/components/commercial/assessment/IssuedDocumentList';
import { ReportLibraryEmptyState } from './ReportLibraryEmptyState';
import type { CommercialDocumentsLibrary } from './useCommercialDocumentsLibrary';

function clientName(row: { primary_first_name: string | null; primary_surname: string | null }): string {
  return [row.primary_first_name, row.primary_surname].filter(Boolean).join(' ').trim();
}

export function CommercialDocumentsPanel({ source }: { source: CommercialDocumentsLibrary }) {
  const navigate = useNavigate();
  const documents = source.library?.documents ?? [];
  const clients = new Map((source.library?.clients ?? []).map((row) => [row.id, clientName(row)]));
  const ready = documents.filter((doc) => doc.state === 'ready').length;

  if (source.loading && !source.library) {
    return <p className="text-sm text-muted-foreground">Reading your Commercial &amp; Industrial reports…</p>;
  }

  if (source.error && !source.library?.documents.length) {
    return (
      <DashboardThemeFrame variant="section" className="p-6">
        <p role="alert" className="text-sm text-destructive">{source.error}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={source.reload}>Try again</Button>
      </DashboardThemeFrame>
    );
  }

  if (!documents.length) {
    return (
      <ReportLibraryEmptyState
        icon={FileText}
        title="No Commercial & Industrial reports yet"
        description="Generate a Capacity Report from a completed assessment's Results step. Every report you generate is kept here to download again."
        actionLabel="Open Commercial & Industrial"
        onAction={() => navigate('/commercial')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {documents.length} report{documents.length === 1 ? '' : 's'}
          </Badge>
          {ready !== documents.length ? (
            <Badge variant="secondary" className="text-xs font-normal">{ready} ready to download</Badge>
          ) : null}
        </div>
        <Button size="sm" variant="outline" onClick={source.reload} className="gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <DashboardThemeFrame variant="section" className="p-4 md:p-5">
        <IssuedDocumentList
          documents={documents}
          describe={(doc) => {
            const client = doc.clientId ? clients.get(doc.clientId) : null;
            return [doc.assessmentTitle, doc.assessmentReference, client ? `for ${client}` : null]
              .filter(Boolean)
              .join(' · ');
          }}
          extraAction={(doc) => (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/commercial/assessments/${doc.assessmentId}?step=results`)}
              aria-label={`Open the assessment ${doc.assessmentTitle}`}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        />
      </DashboardThemeFrame>
    </div>
  );
}
