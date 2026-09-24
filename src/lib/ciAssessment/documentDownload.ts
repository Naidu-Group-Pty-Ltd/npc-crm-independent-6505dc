/**
 * Downloading a document an assessment has already issued.
 *
 * The file is never re-drawn: the server signs a short-lived link to the bytes
 * it stored when the document was produced, and they are saved under the name
 * the ledger recorded. That is the difference between a re-download and a
 * re-render — a second render reads today's brand and today's analysis, and
 * would not be the document the client was sent.
 *
 * The same save step `Generate report` uses, so a re-download lands exactly as
 * the first download did.
 */
import { ciAssessmentApi } from '@/hooks/useCiAssessments';
import { downloadCapacityReport } from '@/lib/reports/commercialCapacity/requestCapacityReport';
import type { IssuedDocument } from '@/lib/ciAssessment/issuedDocuments';

export async function downloadIssuedDocument(
  doc: Pick<IssuedDocument, 'ledger' | 'id' | 'assessmentId' | 'fileName'>,
  options: { viaClientId?: string | null } = {},
): Promise<void> {
  const { data, error } = await ciAssessmentApi.documentUrl({
    assessmentId: doc.assessmentId,
    ledger: doc.ledger,
    documentId: doc.id,
    clientId: options.viaClientId ?? null,
  });
  if (error || !data?.url) throw new Error(error ?? 'The document could not be fetched.');
  await downloadCapacityReport({ url: data.url, fileName: data.fileName || doc.fileName });
}
