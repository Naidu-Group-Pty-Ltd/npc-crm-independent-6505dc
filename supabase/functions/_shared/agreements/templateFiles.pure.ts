/**
 * Which document file is each template, and how do we know it is that file.
 *
 * ## Why the platform hands over a file instead of drawing one
 *
 * These two agreements existed in this repository THREE times: as Python
 * builders writing `public/templates/finance-portal/*.docx`, as a browser
 * renderer (`src/lib/agreements/docx.ts`) drawing the content modules into
 * Word, and as the documents their author actually maintains. Three
 * presentations of one legal instrument, and no way for a reader to tell which
 * one a download would give them — which is exactly how "the template keeps
 * reverting to the old version" happens, over and over.
 *
 * So the artefact is now the author's own file, shipped unchanged, and the
 * platform's job is to hand it over. Re-typesetting a legal instrument is not
 * something a codebase should be doing on every download: a presentation
 * choice made here is a change to a document two businesses are going to sign,
 * and the person who owns that document has already made those choices.
 *
 * ## What still holds the wording to account
 *
 * The locked content modules (`contentStrategicReferral.pure.ts`,
 * `contentFinanceReferral.pure.ts`) did not become decoration — they became
 * the SPECIFICATION. `agreementTemplateFiles.spec.ts` opens each shipped file
 * and asserts that every subclause, section heading, note and responsibility
 * bullet those modules define is present in it, verbatim, with each
 * `{{field}}` resolved to the bracket text the template prints unfilled.
 *
 * That is a stronger guarantee than rendering was. A renderer can only be as
 * right as its own content; this checks the artefact a partner will actually
 * open, and it fails if a replacement file quietly drops a clause.
 *
 * ## Replacing a document
 *
 * Drop the new file in over the old one, then update `byteLength` and
 * `sha256` here (`sha256sum public/templates/finance-portal/<file>`). The spec
 * will tell you if the new file lost any of the reviewed wording, and the
 * hash means a file that changed without anyone saying so cannot pass.
 *
 * PURE. No Deno APIs, no network, no clock — the browser reaches it through
 * the `src/lib/agreements/` bridge re-export.
 */

import type { AgreementTemplateKey } from './types.pure.ts';

/** Where the pack is served from. One directory, both portals. */
export const AGREEMENT_TEMPLATE_DIR = '/templates/finance-portal';

export interface AgreementTemplateFile {
  key: AgreementTemplateKey;
  /** The file on disk, and the name the download is saved under. */
  fileName: string;
  /** Exact size in bytes of the shipped file. */
  byteLength: number;
  /** SHA-256 of the shipped file, lowercase hex. */
  sha256: string;
  /** When this copy was supplied by the document owner (ISO date). */
  suppliedOn: string;
  /** The document's own version marker, as printed in its running header. */
  documentVersion: string;
}

export const AGREEMENT_TEMPLATE_FILES: readonly AgreementTemplateFile[] = [
  {
    key: 'strategic_property_referral',
    fileName: 'Strategic_Property_Referral_Agreement.docx',
    byteLength: 194_983,
    sha256: '800fcd810ba148dd40bcfd7bce338bfe12e93ebce53b7578aa6c795e1585f584',
    suppliedOn: '2026-08-18',
    documentVersion: '2.0',
  },
  {
    key: 'finance_referral_commission',
    fileName: 'Finance_Referral_and_Commission_Agreement.docx',
    byteLength: 283_386,
    sha256: '95e57b71be61a9f47954349b714821df7d488df1d47312966cb7b6f7fb4e5080',
    suppliedOn: '2026-08-18',
    documentVersion: '2.0',
  },
];

export function agreementTemplateFile(key: AgreementTemplateKey): AgreementTemplateFile {
  const found = AGREEMENT_TEMPLATE_FILES.find((file) => file.key === key);
  // Throwing rather than returning null: a template with no document is a
  // build mistake, and a download button that resolves to nothing is worse
  // than a page that fails to compile.
  if (!found) throw new Error(`No agreement template document for "${key}"`);
  return found;
}

/** The URL both portals fetch. Same path, same bytes, either side. */
export function agreementTemplateUrl(key: AgreementTemplateKey): string {
  return `${AGREEMENT_TEMPLATE_DIR}/${agreementTemplateFile(key).fileName}`;
}

/** "190 KB" — shown on the card so a download has no surprises. */
export function formatTemplateFileSize(bytes: number): string {
  return `${Math.round(bytes / 1024).toLocaleString('en-AU')} KB`;
}
