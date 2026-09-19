/**
 * Is this PDF scanned, and what should happen to it — decided before the import.
 *
 * WHY THIS DECISION HAS TO EXIST
 * ------------------------------
 * Template Builder has two PDF engines and only one of them can read a scan:
 *
 *   deterministic (Docling sidecar)   reads the text layer
 *   Claude (`pdf_document` mode)      reads the page
 *
 * A scanned PDF has no text layer, so the deterministic path cannot produce a
 * word of text from it — it produces a picture of each page and reports success.
 * The user picks a file, waits, and gets a template they cannot edit, with
 * nothing anywhere saying why.
 *
 * The obvious answer is OCR, and OCR is not available. Measured on the
 * production ledger: **84 jobs, 23 documents, 1,164 pages, 0 OCR pages ever.**
 * `GLOBAL_CAPABILITIES.ocr` is a hard ceiling and defaults false, so the
 * `ocr_scanned` lane is inert even when the planner selects it — and the only
 * document that ever triggered `ocr_hint` was a false positive that yields 1,885
 * characters of perfectly good embedded text.
 *
 * Turning OCR on is a deploy and cost decision on a manually-promoted container.
 * Routing to the engine that can already read the page is a client-side one, and
 * this module makes it.
 *
 * WHAT MAKES IT CHEAP
 * -------------------
 * Nothing new has to be measured. The grounding stage already walks the attached
 * PDF with PDF.js in the browser before anything is sent, so the character count
 * per page is in hand before an import starts — no upload, no sidecar, no cost.
 *
 * Pure and deterministic: no DOM, no fetch, no clock.
 */

export const SCANNED_DOCUMENT_POLICY_VERSION = 'scanned-document-policy-v1';

/** Per-page text evidence, as the PDF.js probe measures it. */
export interface PageTextEvidence {
  pageNumber: number;
  /** Non-whitespace characters the page's text layer yields. */
  characters: number;
}

/**
 * Characters below which a page counts as having no usable text layer.
 *
 * Not zero. A scanned page routinely carries a few stray characters — a stamp,
 * a form field, a producer watermark — and calling such a page "native" on the
 * strength of four characters is how a scanned document gets imported as a
 * picture with nobody told.
 */
export const MIN_PAGE_TEXT_CHARACTERS = 24;

/** Share of pages that must lack text before the document is called scanned. */
export const SCANNED_PAGE_SHARE = 0.8;

/** Share below which a mixed document is still worth the deterministic path. */
export const PARTIAL_PAGE_SHARE = 0.2;

export type TextLayerVerdict =
  /** Enough text everywhere: the deterministic importer is the right engine. */
  | 'native'
  /** Some pages have no text layer; the rest do. */
  | 'partial'
  /** Effectively no text layer: the deterministic importer will produce pictures. */
  | 'scanned'
  /** Nothing could be measured — the probe failed, or the file could not be read. */
  | 'unknown';

export interface TextLayerAssessment {
  version: typeof SCANNED_DOCUMENT_POLICY_VERSION;
  verdict: TextLayerVerdict;
  pagesMeasured: number;
  /** Pages carrying at least `MIN_PAGE_TEXT_CHARACTERS`. */
  pagesWithText: number;
  pagesWithoutText: number;
  /** Total non-whitespace characters across every measured page. */
  characters: number;
  /** Page numbers with no usable text layer, in order, bounded for a message. */
  pagesWithoutTextNumbers: number[];
}

/** Most page numbers to name in a human-facing message. */
export const MAX_LISTED_PAGES = 8;

export function assessTextLayer(
  pages: readonly PageTextEvidence[] | null | undefined,
  totalPages?: number,
): TextLayerAssessment {
  const measured = (Array.isArray(pages) ? pages : []).filter(
    (p) => p && Number.isFinite(Number(p.pageNumber)) && Number.isFinite(Number(p.characters)),
  );

  // A document whose pages could not be measured is `unknown`, never `scanned`.
  // Recommending a different engine off a failed probe is a worse error than
  // saying nothing: the probe fails on an encrypted or malformed file, and those
  // are not scans.
  const expected = Number.isFinite(Number(totalPages)) && Number(totalPages) > 0
    ? Math.floor(Number(totalPages))
    : measured.length;
  if (!measured.length || !expected) {
    return {
      version: SCANNED_DOCUMENT_POLICY_VERSION,
      verdict: 'unknown',
      pagesMeasured: 0, pagesWithText: 0, pagesWithoutText: 0,
      characters: 0, pagesWithoutTextNumbers: [],
    };
  }

  // Pages the probe never reached count as having no text: a page missing from
  // the walk is a page PDF.js found nothing on.
  const seen = new Set(measured.map((p) => Math.round(Number(p.pageNumber))));
  const withoutText: number[] = [];
  let characters = 0;
  let withText = 0;
  for (const page of measured) {
    const count = Math.max(0, Math.round(Number(page.characters)));
    characters += count;
    if (count >= MIN_PAGE_TEXT_CHARACTERS) withText += 1;
    else withoutText.push(Math.round(Number(page.pageNumber)));
  }
  for (let pageNumber = 1; pageNumber <= expected; pageNumber += 1) {
    if (!seen.has(pageNumber)) withoutText.push(pageNumber);
  }
  withoutText.sort((a, b) => a - b);

  const share = withoutText.length / expected;
  const verdict: TextLayerVerdict = share >= SCANNED_PAGE_SHARE
    ? 'scanned'
    : share > PARTIAL_PAGE_SHARE ? 'partial' : 'native';

  return {
    version: SCANNED_DOCUMENT_POLICY_VERSION,
    verdict,
    pagesMeasured: expected,
    pagesWithText: withText,
    pagesWithoutText: withoutText.length,
    characters,
    pagesWithoutTextNumbers: withoutText.slice(0, MAX_LISTED_PAGES),
  };
}

export interface ScannedRouting {
  /** Whether the Claude engine should be preferred for this document. */
  preferClaude: boolean;
  /** Whether to say anything at all. A native document needs no notice. */
  notify: boolean;
  /** One sentence, in the user's terms. Empty when there is nothing to say. */
  message: string;
}

function listPages(assessment: TextLayerAssessment): string {
  const shown = assessment.pagesWithoutTextNumbers;
  if (!shown.length) return '';
  const more = assessment.pagesWithoutText - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * What to do about it, and what to say.
 *
 * Says what the OTHER engine will do rather than what this one cannot: "the
 * deterministic importer will produce a picture of each page" is the fact the
 * user needs, and it is true whether or not they take the recommendation.
 *
 * Never claims OCR. OCR is off at the capability ceiling, and offering it would
 * send someone to a setting that changes nothing.
 */
export function describeScannedRouting(assessment: TextLayerAssessment): ScannedRouting {
  switch (assessment.verdict) {
    case 'scanned':
      return {
        preferClaude: true,
        notify: true,
        message: `This PDF has no text layer${
          assessment.pagesMeasured > 1 ? ` on ${assessment.pagesWithoutText} of its ${assessment.pagesMeasured} pages` : ''
        }. The standard importer would produce a picture of each page; reading it with Claude recovers the text.`,
      };
    case 'partial':
      return {
        // A document that is mostly readable is still best served by the
        // deterministic path — it measures real glyph geometry where there is
        // any, which no amount of reading a picture can match.
        preferClaude: false,
        notify: true,
        message: `Pages ${listPages(assessment)} have no text layer and will import as pictures. The rest of the document imports normally; tick "read with Claude" if you need those pages editable.`,
      };
    case 'native':
    case 'unknown':
    default:
      return { preferClaude: false, notify: false, message: '' };
  }
}
