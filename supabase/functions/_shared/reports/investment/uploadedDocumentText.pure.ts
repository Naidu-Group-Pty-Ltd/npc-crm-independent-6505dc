/**
 * The words of a property document an adviser uploads, as the report is handed
 * them.
 *
 * The report form's PDF path stored `data.pdfContent` from `parse-property-pdf`
 * and sent it on to `generate-investment-report` — a field that function has
 * never returned. It reads a document's pages as IMAGES (one vision call) and
 * answers extracted FIELDS, never text. So `pdfContent` was `undefined` on every
 * report made from an uploaded PDF, the generator logged "No document content
 * available", and the one thing only the document can say — how the seller
 * describes the home, its inclusions, its features — never reached the writer,
 * while a report made from a listing link has always been handed its listing's
 * words.
 *
 * The browser now reads the document's own text layer (pdf.js, the extractor
 * every other uploader here already uses) and hands it over bounded by this
 * module. Three rules:
 *
 *   - **The front of the document, never its end.** A brochure opens on the
 *     property it is about and ends on the builder's other estates and other
 *     homes — the owner's example carries another estate on pages 5 and 6 — so
 *     the text is the first pages, cut at a paragraph. A head-and-tail cut,
 *     which is what the generator applies to a listing page, would keep exactly
 *     the part about somebody else's house.
 *   - **Smaller than a listing page.** The block is PREPENDED to every section's
 *     prompt, where each byte displaces that section's own evidence from the
 *     part the prompt trim keeps. A brochure's descriptive pages fit in 8,000
 *     characters; its fine print is not what a report is written from.
 *   - **A scan has no words, and says none.** Where the text layer is absent or
 *     garbled the document still fills the form through the vision parse, and
 *     the prompt gets no block rather than noise.
 *
 * What the block is FOR is unchanged and stated where it is used: the physical
 * attributes come from the record and never from the document, and whatever
 * the document says about the home is carried attributed to it.
 */

/** Pages read from the front of the document. */
export const UPLOADED_DOCUMENT_MAX_PAGES = 8;

/** Characters handed to the report, cut at a paragraph. */
export const UPLOADED_DOCUMENT_MAX_CHARS = 8_000;

/**
 * The server's own bound on what a browser may send, in bytes.
 *
 * Wider than the characters above so text the browser already bounded is never
 * cut again — a typographic apostrophe or an m² is more than one byte — and
 * narrow enough that a client that bounded nothing cannot put a whole brochure
 * in front of the writer.
 */
export const UPLOADED_DOCUMENT_MAX_BYTES = 12_000;

/** Where a cut may land, best first: a paragraph, a line, a sentence, a word. */
const BOUNDARIES: readonly { mark: string; keep: number }[] = [
  { mark: '\n\n', keep: 0 },
  { mark: '\n', keep: 0 },
  { mark: '. ', keep: 1 },
  { mark: ' ', keep: 0 },
];

/**
 * The document's words, bounded: the front of it, cut at the last paragraph
 * (else line, else sentence, else word) that fits. `null` where there is
 * nothing to say.
 */
export function boundUploadedDocumentText(
  text: unknown,
  maxChars: number = UPLOADED_DOCUMENT_MAX_CHARS,
): string | null {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean) return null;
  if (clean.length <= maxChars) return clean;
  const head = clean.slice(0, maxChars);
  // A boundary this far in is worth cutting at; one nearer the start would
  // throw away most of what fits.
  const floor = Math.floor(maxChars * 0.6);
  for (const { mark, keep } of BOUNDARIES) {
    const at = head.lastIndexOf(mark);
    if (at >= floor) return head.slice(0, at + keep).trimEnd();
  }
  return head.trimEnd();
}

/** What the browser's extractor answers, as far as this module reads it. */
export interface UploadedDocumentExtraction {
  text: string;
  /** The text layer is absent or garbled: the document is effectively a scan. */
  likelyNeedsOcr: boolean;
}

/** The words a report is handed from one extraction, or `null` for none. */
export function uploadedDocumentText(extraction: UploadedDocumentExtraction | null | undefined): string | null {
  if (!extraction || extraction.likelyNeedsOcr) return null;
  return boundUploadedDocumentText(extraction.text);
}
