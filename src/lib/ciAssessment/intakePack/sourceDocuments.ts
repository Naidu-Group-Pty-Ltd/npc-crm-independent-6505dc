/**
 * The intake pack's source documents.
 *
 * These four files are supplied, approved artefacts. They are shipped verbatim
 * and are never regenerated, converted, re-saved or rewritten — what a user
 * downloads is byte-for-byte the file that was approved. `sourceDocuments.test`
 * asserts that with a SHA-256 of each one, so an accidental re-save shows up as
 * a failing build rather than as a subtly different document in a client's
 * inbox.
 *
 * ## Why they are inlined rather than served as files
 *
 * `?inline` turns each import into a base64 `data:` URL through the Vite plugin
 * in `vite-inline-xlsx.ts`. Two reasons, one inherited and one specific:
 *
 *  - deployments that prune unreferenced assets have broken plain `/assets/`
 *    template downloads here before; and
 *  - a document with no URL of its own cannot be linked to or fetched. The
 *    worked examples must reach the browser to be rendered, but they are
 *    deliberately not offered as downloads, and inlining means there is no
 *    address to hand around.
 *
 * The cost is bundle weight, so everything here is behind a dynamic import and
 * only loads when somebody opens the intake pack step.
 *
 * ## What this changed
 *
 * The pack used to be generated per organisation, which meant it carried that
 * organisation's logo, brand colour and contact details. A fixed file cannot:
 * these documents look the same for everybody. That is the deliberate trade the
 * approved-artefact requirement makes — fidelity to the approved document over
 * per-tenant branding.
 */

import blankWorkbookUrl from '@/assets/intakePack/CommercialIndustrialFinanceIntakeWorkbook.xlsx?inline';
import blankGuideUrl from '@/assets/intakePack/CommercialIndustrialFinanceIntakePack.docx?inline';
import exampleWorkbookUrl from '@/assets/intakePack/CommercialIndustrialFinanceIntakeWorkbookMOCKDATA.xlsx?inline';
import exampleGuideUrl from '@/assets/intakePack/CommercialIndustrialFinanceIntakePackMOCKDATA.docx?inline';

export type PackDocumentKind = 'workbook' | 'guide';
export type PackDocumentVariant = 'blank' | 'example';

export interface PackSourceDocument {
  id: string;
  kind: PackDocumentKind;
  variant: PackDocumentVariant;
  /** The approved file name. Downloads use it exactly. */
  fileName: string;
  /** Base64 data URL of the untouched file. */
  url: string;
  mimeType: string;
  /** Shown in the viewer's title bar. */
  title: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const PACK_SOURCE_DOCUMENTS: readonly PackSourceDocument[] = [
  {
    id: 'workbook-blank',
    kind: 'workbook',
    variant: 'blank',
    fileName: 'CommercialIndustrialFinanceIntakeWorkbook.xlsx',
    url: blankWorkbookUrl,
    mimeType: XLSX_MIME,
    title: 'Commercial & Industrial Finance Intake Workbook',
  },
  {
    id: 'workbook-example',
    kind: 'workbook',
    variant: 'example',
    fileName: 'CommercialIndustrialFinanceIntakeWorkbookMOCKDATA.xlsx',
    url: exampleWorkbookUrl,
    mimeType: XLSX_MIME,
    title: 'Completed example — workbook',
  },
  {
    id: 'guide-blank',
    kind: 'guide',
    variant: 'blank',
    fileName: 'CommercialIndustrialFinanceIntakePack.docx',
    url: blankGuideUrl,
    mimeType: DOCX_MIME,
    title: 'Commercial & Industrial Finance Intake Pack',
  },
  {
    id: 'guide-example',
    kind: 'guide',
    variant: 'example',
    fileName: 'CommercialIndustrialFinanceIntakePackMOCKDATA.docx',
    url: exampleGuideUrl,
    mimeType: DOCX_MIME,
    title: 'Completed example — interview guide',
  },
];

export function packSourceDocument(
  kind: PackDocumentKind, variant: PackDocumentVariant,
): PackSourceDocument {
  const found = PACK_SOURCE_DOCUMENTS.find(
    (document) => document.kind === kind && document.variant === variant,
  );
  if (!found) throw new Error(`No ${variant} ${kind} source document`);
  return found;
}

/**
 * Read a source document's bytes.
 *
 * `fetch` on a `data:` URL is local — no network, no CSP fetch-src concern, and
 * nothing leaves the browser.
 */
export async function readSourceDocument(document: PackSourceDocument): Promise<ArrayBuffer> {
  const response = await fetch(document.url);
  if (!response.ok) throw new Error(`Could not read ${document.fileName}`);
  return response.arrayBuffer();
}
