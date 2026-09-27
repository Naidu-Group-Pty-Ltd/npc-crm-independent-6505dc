/**
 * Preparing a blank intake pack document for download.
 *
 * On the prime with no design chosen this is the approved file, handed over
 * exactly as before: the anchor points at the inlined source and nothing is
 * read, rebuilt or re-zipped. Anywhere else the pack is presented for this
 * deployment first (`packPresentation.ts`) — named for a clone's business,
 * drawn in a chosen design — and handed over under the approved file name.
 *
 * Two failures, answered differently on purpose:
 *
 *  - **a clone's pack that cannot be prepared is not handed over.** The
 *    approved file names another business, in the consent clause among other
 *    places, and handing it to a clone's client would be worse than asking
 *    the adviser to try again;
 *  - **a design that cannot be applied costs only the design.** The pack is
 *    the approved file as supplied, and the person is told, in the words every
 *    other document uses when a chosen template is not honoured.
 */
import { drawnDesignFor } from '@/lib/reports/drawnDocumentDesign';
import { loadCloneIssuerName } from '@/lib/reports/legacyDocumentBrand';
import { fetchGlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { DESIGN_NOT_USED_TITLE } from '@/lib/reportTemplate/standardDesign';
import {
  handsOverApprovedFile,
  presentPackDocument,
  type PackPresentation,
} from './packPresentation';
import {
  packSourceDocument,
  readSourceDocument,
  type PackDocumentKind,
  type PackSourceDocument,
} from './sourceDocuments';

/** Said when a design could not be applied to the pack. */
export const PACK_DESIGN_NOT_APPLIED_TEXT =
  'The pack could not be drawn in it, so this is the approved pack as supplied.';

/** Said when a clone's pack could not be prepared, and so was not handed over. */
export const PACK_NOT_PREPARED_TEXT =
  'The pack could not be prepared with your business details, so it was not downloaded. Try again.';

export interface PackDownload {
  /** The approved file's data URL, or an object URL of the prepared copy. */
  href: string;
  /** Always the approved file name. */
  fileName: string;
  /** Call once the download has started. */
  release: () => void;
}

export interface PackDownloadDeps {
  source: (kind: PackDocumentKind) => PackSourceDocument;
  read: (source: PackSourceDocument) => Promise<ArrayBuffer>;
  presentation: () => Promise<PackPresentation>;
  present: typeof presentPackDocument;
  objectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  notify: (title: string, description: string) => void;
}

/** This deployment's presentation: the design chosen for the pack, and a clone's business. */
export async function loadPackPresentation(): Promise<PackPresentation> {
  const [design, issuerName] = await Promise.all([
    drawnDesignFor('commercial_intake_pack'),
    loadCloneIssuerName(async () => (await fetchGlobalReportSettings())?.contactDetails?.company_name ?? null),
  ]);
  return issuerName === undefined ? { design } : { issuerName, design };
}

export const DEFAULT_PACK_DOWNLOAD_DEPS: PackDownloadDeps = {
  source: (kind) => packSourceDocument(kind, 'blank'),
  read: readSourceDocument,
  presentation: loadPackPresentation,
  present: presentPackDocument,
  objectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  notify: () => {},
};

/**
 * The blank document of this kind, ready for the anchor.
 *
 * Throws only where nothing may be handed over — a clone's pack that could
 * not be prepared — and says so in words a person can act on.
 */
export async function preparePackDownload(
  kind: PackDocumentKind,
  deps: PackDownloadDeps = DEFAULT_PACK_DOWNLOAD_DEPS,
): Promise<PackDownload> {
  const source = deps.source(kind);
  const approved: PackDownload = { href: source.url, fileName: source.fileName, release: () => {} };
  const presentation = await deps.presentation();
  if (handsOverApprovedFile(presentation)) return approved;

  const clone = presentation.issuerName !== undefined;
  let bytes: Uint8Array | null;
  try {
    bytes = await deps.present(await deps.read(source), kind, presentation);
  } catch (error) {
    console.warn('[intake pack] could not present the pack', error);
    if (clone) throw new Error(PACK_NOT_PREPARED_TEXT, { cause: error });
    deps.notify(DESIGN_NOT_USED_TITLE, PACK_DESIGN_NOT_APPLIED_TEXT);
    return approved;
  }
  if (!bytes) return approved;

  const href = deps.objectUrl(new Blob([bytes as BlobPart], { type: source.mimeType }));
  return { href, fileName: source.fileName, release: () => deps.revokeObjectUrl(href) };
}
