/**
 * A list of issued Capacity Reports, and the one action a finished one has.
 *
 * Shared by the assessment's Documents panel, the client's Commercial /
 * Industrial tab and Generated Reports, so a document reads — and downloads —
 * the same wherever it is found. A failed render is listed with its reason
 * rather than hidden: "the report never arrived" is the question it answers.
 */
import { useState, type ReactNode } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { downloadIssuedDocument } from '@/lib/ciAssessment/documentDownload';
import {
  DOCUMENT_STATE_LABEL,
  documentFacts,
  documentRouteLabel,
  documentWhen,
  type DocumentState,
  type IssuedDocument,
} from '@/lib/ciAssessment/issuedDocuments';

const STATE_VARIANT: Record<DocumentState, 'secondary' | 'outline' | 'destructive'> = {
  ready: 'secondary',
  in_progress: 'outline',
  failed: 'destructive',
  did_not_finish: 'outline',
};

export interface IssuedDocumentListProps<T extends IssuedDocument> {
  documents: readonly T[];
  /**
   * The client the list was reached through. Sent with a download so somebody
   * who does not own the assessment can read what was issued to that client.
   */
  viaClientId?: string | null;
  /** A line under each document's name, before the facts — e.g. which assessment. */
  describe?: (doc: T) => string | null;
  /** One more control beside Download, for a list that spans assessments — e.g. opening one. */
  extraAction?: (doc: T) => ReactNode;
}

export function IssuedDocumentList<T extends IssuedDocument>({
  documents, viaClientId = null, describe, extraAction,
}: IssuedDocumentListProps<T>) {
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(doc: T) {
    const key = `${doc.ledger}:${doc.id}`;
    setDownloading(key);
    try {
      await downloadIssuedDocument(doc, { viaClientId });
    } catch (error) {
      toast({
        title: 'Could not download the report',
        description: error instanceof Error ? error.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setDownloading((current) => (current === key ? null : current));
    }
  }

  return (
    <ul className="divide-y divide-border">
      {documents.map((doc) => {
        const key = `${doc.ledger}:${doc.id}`;
        const context = describe?.(doc) ?? null;
        const facts = documentFacts(doc);
        return (
          <li key={key} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1 basis-64">
              <p className="break-all text-sm font-medium text-foreground">{doc.fileName}</p>
              {context ? <p className="text-xs text-foreground">{context}</p> : null}
              <p className="text-xs text-muted-foreground">
                {[documentWhen(doc.createdAt), documentRouteLabel(doc), facts].filter(Boolean).join(' · ')}
              </p>
              {doc.error ? <p className="mt-1 text-xs text-destructive">{doc.error}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={STATE_VARIANT[doc.state]}>{DOCUMENT_STATE_LABEL[doc.state]}</Badge>
              {doc.downloadable ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void download(doc)}
                  disabled={downloading === key}
                  aria-label={`Download ${doc.fileName}`}
                >
                  {downloading === key
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  Download
                </Button>
              ) : null}
              {extraAction?.(doc)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
