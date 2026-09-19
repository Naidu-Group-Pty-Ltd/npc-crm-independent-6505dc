/**
 * Getting a blank template into somebody's hands.
 *
 * ## The document is the author's, not ours
 *
 * This used to build the Word file in the browser from the locked content
 * modules. It no longer does. The platform ships the two documents their
 * author maintains and hands them over unchanged — see
 * `_shared/agreements/templateFiles.pure.ts` for why re-typesetting a legal
 * instrument on every download was the wrong shape, and for the check that
 * proves the shipped file still carries the reviewed wording.
 *
 * ## What is still true about a download
 *
 * Both portals fetch the SAME static path and save the SAME bytes. No API
 * call is made, no function is invoked, nothing is written: there is no
 * application record that a template was taken, by whom, or for which partner.
 * The platform cannot report on something it never observed.
 *
 * What it is not, and this is worth stating precisely rather than
 * over-claiming: fetching a static file is a request to the origin, the same
 * as loading an image on the page. It carries no user identity in the
 * application's own record and produces no row anywhere. "Nothing is recorded
 * about who took a template" is the honest form of the guarantee.
 *
 * There is also no branding step. The supplied cover is built around a
 * `<<COMPANY NAME>>` placeholder — its author's intent is that whoever uses it
 * puts their own name in, in Word. Stamping one side's mark on a neutral
 * template both fights that design and makes it read as that side's prepared
 * offer rather than a starting point.
 */
import {
  agreementTemplateFile,
  agreementTemplateUrl,
  type AgreementTemplateKey,
} from '@/lib/agreements';

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * The template as its author supplied it.
 *
 * Fetched rather than linked so a stale service worker cache or a missing
 * file surfaces as a message on the page instead of a browser error page with
 * the portal's chrome gone — and so the saved file carries the name below
 * rather than whatever the URL happens to end in.
 */
export async function downloadAgreementTemplateDocx(
  templateKey: AgreementTemplateKey,
): Promise<void> {
  const file = agreementTemplateFile(templateKey);
  const response = await fetch(agreementTemplateUrl(templateKey), { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error('That template could not be reached. Please try again in a moment.');
  }
  const blob = await response.blob();
  // A zero-length or HTML body means the SPA fallback answered instead of the
  // file — handing that to somebody as a `.docx` gives them a document Word
  // refuses to open, with no clue why.
  if (blob.size === 0 || blob.type.startsWith('text/html')) {
    throw new Error('That template could not be reached. Please try again in a moment.');
  }
  saveBlob(blob, file.fileName);
}
