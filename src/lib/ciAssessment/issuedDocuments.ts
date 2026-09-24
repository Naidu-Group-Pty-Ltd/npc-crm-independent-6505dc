/**
 * Bridge — the issued-documents reader lives with the Edge Function that serves it.
 *
 * `manage-ci-assessments` reads both report ledgers through
 * `_shared/ciAssessments/documents.pure.ts` and returns the projection; the app
 * renders what it returns. The words on the page are here, beside it.
 */
import type { DocumentState, IssuedDocument } from '../../../supabase/functions/_shared/ciAssessments/documents.pure.ts';

export * from '../../../supabase/functions/_shared/ciAssessments/documents.pure.ts';

export const DOCUMENT_STATE_LABEL: Readonly<Record<DocumentState, string>> = {
  ready: 'Ready',
  in_progress: 'Generating',
  failed: 'Failed',
  did_not_finish: 'Did not finish',
};

/** Which route drew it, in the words the report picker uses. */
export function documentRouteLabel(doc: Pick<IssuedDocument, 'ledger' | 'templateName'>): string {
  if (doc.ledger === 'template') return doc.templateName ? `Template · ${doc.templateName}` : 'Report template';
  return 'Standard layout';
}

/** When a document was drawn, in the house style — never the reader's machine's. */
export function documentWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

/** A one-line description of what is in the file, or null when nothing is known. */
export function documentFacts(doc: Pick<IssuedDocument, 'pageCount' | 'hasAnalysis' | 'ledger'>): string | null {
  const parts: string[] = [];
  if (doc.pageCount) parts.push(`${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}`);
  // Only the standard route records whether the analysis was included; the
  // template route draws whatever the template binds, so saying nothing is the
  // truthful answer there.
  if (doc.ledger === 'capacity_report' && doc.hasAnalysis === false) parts.push('without the analysis');
  return parts.length ? parts.join(' · ') : null;
}
