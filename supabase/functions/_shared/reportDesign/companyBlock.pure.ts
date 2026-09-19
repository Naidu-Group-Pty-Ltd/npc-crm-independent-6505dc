/**
 * The closing page every report shares: who issued it, how to reach them, and
 * the professional disclaimer.
 *
 * There are currently **two** implementations of this page — `drawJsPDFDisclaimerPage`
 * and `drawPdfLibDisclaimerPage` in `src/utils/pdfDisclaimerPage.ts` — which
 * agree on nothing but the gold (`#BF9B50`, itself one of eight in the repo) and
 * disagree on margins, leading, the disclaimer's vertical anchor, and whether
 * the font size setting is honoured at all (jsPDF's ignores it). This module is
 * the shape both of them, and the WeasyPrint page, now derive from.
 *
 * Only the **data shaping** lives here — sanitisation, name splitting, row
 * order, the font-size table. Painting is the renderer's job, which is why this
 * module has no colours in it and works for a vector PDF library and an HTML
 * document alike.
 */
import { paragraphsFromWrapped } from './prose.pure.ts';
import { PLATFORM_ISSUER_NAME, isNonIdentity } from '../reports/issuerIdentity.pure.ts';

/** Contact details as stored in `global_report_settings.contact_details`. */
export interface CompanyContact {
  company_name?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  abn?: string | null;
}

export type DisclaimerFontSize = 'small' | 'medium' | 'large';

export interface CompanyDisclaimer {
  is_enabled?: boolean | null;
  text?: string | null;
  font_size?: DisclaimerFontSize | string | null;
}

/** A label/value pair ready to be painted. */
export interface ContactRow {
  label: string;
  value: string;
}

/**
 * Who a report is issued by when the workspace has named nobody.
 *
 * Aurixa Systems is the reporting platform; an organisation using its
 * white-label capability supplies its own name, marks, colours and contact
 * details, and those reach a document through `global_report_settings` and
 * `whitelabel_settings` exactly as they always have. What changes here is only
 * the answer when a deployment has supplied none of it.
 *
 * It used to be the literal `'Property Consulting'`, chosen so that a tenant
 * who had filled nothing in would not have somebody else's name on their
 * client's report — which is right, and was solved the wrong way round.
 * `issuerIdentity.pure.ts` already lists `'property consulting'` among the
 * names that are *the absence of a brand rather than a brand*, and already
 * answers `Aurixa Systems`. So an unbranded document printed the platform's
 * name on its issuer line and a generic placeholder in the running foot of
 * every body page and on the closing page's lockup.
 *
 * One declaration now. `FALLBACK_COMPANY_NAME` is kept as a name rather than
 * inlined because four call sites and a second product (`intakePack/branding`)
 * read it, and a second literal is how the two came to disagree.
 */
export const FALLBACK_COMPANY_NAME = PLATFORM_ISSUER_NAME;

/**
 * The company name to PRINT, given what the settings row carries.
 *
 * A row still holding a placeholder — `dashboard`, `NPC`, `Property Consulting`
 * — is not an identity, and printing it puts a name nobody chose (or, worse,
 * another organisation's) at the foot of every page. The same set the issuer
 * line refuses is refused here, so a document cannot name two issuers.
 */
function printableCompanyName(name: string | null | undefined): string {
  const clean = sanitizeReportText(name);
  return isNonIdentity(clean) ? FALLBACK_COMPANY_NAME : clean;
}

/**
 * Strip what a PDF core font cannot set.
 *
 * jsPDF and pdf-lib both use WinAnsi-encoded standard fonts; an emoji or a
 * curly quote pasted from Word throws `WinAnsiEncoding cannot encode` mid-render
 * and loses the whole document. HTML has no such limit, but the two paths must
 * produce the same text or the golden comparison in Phase 3 is meaningless — so
 * both sanitise.
 */
export function sanitizeReportText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    // Emoji, dingbats, flags, variation selectors, keycaps, ZWJ.
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu,
      '',
    )
    // Typographer's punctuation → ASCII, rather than deleted: losing an
    // apostrophe mid-word is worse than not having a curly one.
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // Non-breaking space becomes an ordinary one: it survives the Latin-1
    // filter below but breaks word wrapping on both vector paths, which
    // measure a line word by word.
    .replace(/\u00A0/g, ' ')
    // Anything left outside Latin-1 printable + whitespace.
    .replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, '')
    .trim();
}

/**
 * The most characters the display lead may carry on one line.
 *
 * Measured off the closing page: the lead sets in the display face at the size
 * `.company-page .company-name` gives it, and the content measure holds a little
 * over sixteen uppercase characters of it before the line breaks.
 */
export const LOCKUP_LEAD_CHARS = 16;

/**
 * Split a company name into a display lead and a smaller tail.
 *
 * "NPC Property Services" sets as **NPC PROPERTY** over a lighter *SERVICES* —
 * a lockup convention both existing implementations already use, reproduced here
 * so it survives the port. A single-word name has no tail.
 *
 * ## Why this counts characters rather than words
 *
 * The rule was "everything but the last word", which is right for the
 * three-word name it was written for and wrong for a four-word one. On a real
 * tenant's closing page, `NAIDU PROPERTY CONSULTING SERVICES` set
 * `NAIDU PROPERTY CONSULTING` in gold across two display lines with `SERVICES`
 * beneath it in small letterspaced caps — which does not read as a lockup, it
 * reads as a title that ran out of room with a subtitle bolted on. It is the
 * last page of the document and it was the second thing a reader saw.
 *
 * So the lead takes as many whole words as fit on one line and the tail takes
 * the rest, however many words that is. Three-word names are unchanged, which
 * is what keeps the existing convention: `NPC PROPERTY` is 12 characters and
 * `TENANT` is 6.
 */
export function splitCompanyName(name: string | null | undefined): {
  lead: string;
  tail: string | null;
} {
  const clean = printableCompanyName(name);
  const parts = clean.toUpperCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { lead: parts[0] ?? FALLBACK_COMPANY_NAME.toUpperCase(), tail: null };

  // As many words as fit, and never fewer than one — a lead longer than the
  // measure is still better than an empty one when the first word alone is long.
  let take = 1;
  while (take < parts.length - 1
    && parts.slice(0, take + 1).join(' ').length <= LOCKUP_LEAD_CHARS) {
    take += 1;
  }
  return { lead: parts.slice(0, take).join(' '), tail: parts.slice(take).join(' ') };
}

/**
 * Contact rows, in the order they print. Empty fields are omitted rather than
 * printed as a label with nothing beside it.
 *
 * ABN last: it is the legal identifier, not the way anyone contacts anybody.
 */
export function companyContactRows(contact: CompanyContact | null | undefined): ContactRow[] {
  const c = contact ?? {};
  const candidates: Array<[string, string | null | undefined]> = [
    ['Website', c.website],
    ['Email', c.email],
    ['Phone', c.phone],
    ['Address', c.address],
    ['ABN', c.abn],
  ];
  return candidates
    .map(([label, value]) => ({ label, value: sanitizeReportText(value) }))
    .filter((row) => row.value.length > 0);
}

/**
 * Disclaimer point sizes.
 *
 * `small` is 8pt — below the product's own micro floor, and deliberately so: a
 * professional disclaimer is a legal artefact that must be present and complete,
 * not one that must be comfortable. It still clears 4.5:1, which is the part
 * that is not negotiable.
 */
export const DISCLAIMER_FONT_PT: Record<DisclaimerFontSize, number> = {
  small: 8,
  medium: 10,
  large: 12,
};

export function disclaimerFontPt(size: string | null | undefined): number {
  const key = typeof size === 'string' ? size : 'small';
  return DISCLAIMER_FONT_PT[key as DisclaimerFontSize] ?? DISCLAIMER_FONT_PT.small;
}

/**
 * The disclaimer as paragraphs, or `[]` when it is disabled or empty.
 *
 * ## Why a single newline is not a paragraph
 *
 * This split on `/\n\s*\n|\n/`, so *every* newline started a paragraph. The
 * stored text is hard-wrapped — it was typed into a textarea — and the closing
 * page printed it as a column of ragged half-lines: "…based on our", then
 * "expertise and experience in the real estate market. Please be aware…". Read
 * off a real render; it is the last thing on the last page of every report this
 * repo produces, in nine formats.
 *
 * The rule that reads that correctly is `paragraphsFromWrapped`, and it now
 * lives in `prose.pure.ts` because the converter needs the same judgement on
 * transcribed text — and needed it in the *other* direction, which is what
 * showed the rule written here was only half of one. See that module's header.
 */
export function disclaimerParagraphs(
  disclaimer: CompanyDisclaimer | null | undefined,
): string[] {
  if (!disclaimer?.is_enabled) return [];
  return paragraphsFromWrapped(sanitizeReportText(disclaimer.text));
}

/** Everything the closing page needs, resolved once. */
export interface CompanyBlock {
  name: { lead: string; tail: string | null };
  rows: ContactRow[];
  disclaimer: { paragraphs: string[]; fontPt: number };
}

export function resolveCompanyBlock(
  contact: CompanyContact | null | undefined,
  disclaimer: CompanyDisclaimer | null | undefined,
): CompanyBlock {
  return {
    name: splitCompanyName(contact?.company_name),
    rows: companyContactRows(contact),
    disclaimer: {
      paragraphs: disclaimerParagraphs(disclaimer),
      fontPt: disclaimerFontPt(disclaimer?.font_size),
    },
  };
}

/**
 * The running foot printed on every body page.
 *
 * The prototype hardcoded `"NPC · Investment Intelligence"` into the `@page`
 * rule, so a white-label tenant's report carried our name on all 40 pages.
 *
 * **The company name alone.** The `@bottom-left` margin box is one third of the
 * measure — about 55mm — and the foot is set in letterspaced uppercase mono. A
 * company name plus a document name wraps to two lines there, which is what the
 * first render of this page showed. The document name belongs on the cover, in
 * the PDF title, and in the `@top-right` running head, all of which have room.
 */
export function mastheadFor(contact: CompanyContact | null | undefined): string {
  return printableCompanyName(contact?.company_name);
}
