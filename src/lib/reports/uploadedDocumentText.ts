/**
 * Read an uploaded property document's words in the browser.
 *
 * `parse-property-pdf` reads a document's pages as images and answers fields,
 * never text, so the report form reads the text layer itself and hands the
 * generator what `uploadedDocumentText.pure.ts` bounds. See that module for the
 * three rules.
 *
 * Nothing here can fail the upload: an image, a scan, an encrypted file or an
 * extractor that throws all answer `null`, and the report is written exactly as
 * it would have been with no words from the document at all.
 */
import { extractPdfTextClientSide } from '@/lib/pdfClientExtractor';
import {
  UPLOADED_DOCUMENT_MAX_PAGES,
  uploadedDocumentText,
} from '@/lib/reports/investment/uploadedDocumentText.pure';

export async function readUploadedDocumentText(file: File | Blob): Promise<string | null> {
  try {
    const extraction = await extractPdfTextClientSide(file, undefined, {
      maxPages: UPLOADED_DOCUMENT_MAX_PAGES,
    });
    return uploadedDocumentText(extraction);
  } catch (error) {
    console.warn('[uploadedDocumentText] the document text could not be read', error);
    return null;
  }
}
