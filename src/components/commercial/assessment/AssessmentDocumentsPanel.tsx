/**
 * Everything this assessment has issued, and what happened to it.
 *
 * Generate report used to hand over a file and keep nothing anyone could find
 * again: the renders were recorded, but no screen read them for an assessment,
 * and a stored PDF could not be downloaded a second time
 * (`MODULE_STRUCTURE.md` G2, G3). This lists every document from both render
 * routes — failures included, with their reasons — and downloads a finished one
 * exactly as it was issued, from the bytes stored at the time.
 *
 * Beneath it, the assessment's audit trail, which nothing showed before (G8).
 * It is read when opened rather than with the page: it is the second question,
 * not the first.
 */
import { useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ciAssessmentApi, type AuditEventRow } from '@/hooks/useCiAssessments';
import { activityDetail, activityLabel } from '@/lib/ciAssessment/assessmentActivity';
import { documentWhen } from '@/lib/ciAssessment/issuedDocuments';
import { IssuedDocumentList } from './IssuedDocumentList';
import type { AssessmentDocuments } from './useAssessmentDocuments';

export function AssessmentDocumentsPanel({
  assessmentId,
  documents,
}: {
  assessmentId: string;
  documents: AssessmentDocuments;
}) {
  return (
    <section aria-labelledby="ci-documents-heading" className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="ci-documents-heading" className="text-sm font-semibold text-foreground">Documents</h3>
          <p className="text-xs text-muted-foreground">
            Every report generated from this assessment. A finished one downloads exactly as it was issued.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={documents.reload} aria-label="Refresh documents">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {documents.loading ? (
        <p className="text-sm text-muted-foreground">Reading the report ledgers…</p>
      ) : documents.error ? (
        <p role="alert" className="text-sm text-destructive">{documents.error}</p>
      ) : documents.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No report has been generated from this assessment yet. Generate report produces one, and it is kept here.
        </p>
      ) : (
        <IssuedDocumentList documents={documents.documents} />
      )}

      <AssessmentActivity assessmentId={assessmentId} />
    </section>
  );
}

interface LoadedActivity {
  forId: string;
  events: AuditEventRow[];
  error: string | null;
}

function AssessmentActivity({ assessmentId }: { assessmentId: string }) {
  const [loaded, setLoaded] = useState<LoadedActivity | null>(null);

  // Read on every opening, so a report generated since the last look is there.
  function onOpenChange(open: boolean) {
    if (!open) return;
    void ciAssessmentApi.audit(assessmentId).then(
      ({ data, error }) => setLoaded({ forId: assessmentId, events: data ?? [], error }),
      (error: unknown) => setLoaded({
        forId: assessmentId,
        events: [],
        error: error instanceof Error ? error.message : 'The activity could not be read.',
      }),
    );
  }

  const current = loaded && loaded.forId === assessmentId ? loaded : null;

  return (
    <Collapsible className="ci-advanced mt-4" onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="ci-advanced-trigger group">
        <span className="flex items-center gap-2">
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
          Activity
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="ci-advanced-content">
        {!current ? (
          <p className="text-sm text-muted-foreground">Reading the activity…</p>
        ) : current.error ? (
          <p role="alert" className="text-sm text-destructive">{current.error}</p>
        ) : current.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has been recorded for this assessment yet.</p>
        ) : (
          <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {current.events.map((event) => {
              const detail = activityDetail(event);
              return (
                <li key={event.id} className="text-sm">
                  <span className="text-foreground">{activityLabel(event)}</span>
                  {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
                  <span className="block text-xs text-muted-foreground">{documentWhen(event.created_at)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
