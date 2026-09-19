/**
 * Ground the PDF reconstruction path in what the file states — pure.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * Every reference kind the importer accepts grounds the model against measured
 * evidence before asking it to rebuild anything:
 *
 *     image      groundOcrWords      → GroundedReference
 *     code / URL groundDomBoxTree    → box tree
 *     Figma      figmaNodesToBoxTree → box tree
 *     PDF        — nothing —
 *
 * The PDF path handed Claude the raw file and a prompt saying "transcribe text
 * EXACTLY at its real positions", with no measurements to transcribe FROM. It was
 * the only ungrounded path, and it is the one where the evidence is best: a PDF
 * states each run's baseline and advance width exactly, where OCR infers a box
 * from pixels.
 *
 * `GroundedReference` is the contract the design agent already consumes and
 * already treats as authoritative ("These are AUTHORITATIVE for text, position,
 * and any style fields present"), so this fills a channel that exists rather than
 * inventing one.
 *
 * WHY SELECTION, NOT TRUNCATION
 * -----------------------------
 * The prompt bounds each page's block at a fixed count. Cutting with
 * `.slice(0, cap)` drops whatever is last in reading order — reliably the footer
 * and the page furniture. Losing the last elements silently is the difference
 * between "the model was told about the whole page" and "the model was told about
 * the top of it".
 *
 * When the cap bites, this keeps the most INFORMATIVE elements and then restores
 * reading order, so the model still sees a coherent document rather than a ranked
 * list — and it reports how many it dropped, because a bound nobody is told about
 * reads as full coverage.
 */

import type { GroundedElement, GroundedReference } from '../imageGrounding';
import type { PlacedTextFragment } from './pdfjsTextGeometry.pure';

/** Most elements one page's grounding block may carry. The agent slices at this too. */
export const DEFAULT_GROUNDED_ELEMENT_CAP = 160;

export interface BuildGroundedReferenceOptions {
  /** Most elements to include for this page. */
  maxElements?: number;
}

export interface GroundedPageBuild {
  reference: GroundedReference;
  /** Elements the cap excluded. Reported so the prompt can say so out loud. */
  dropped: number;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * How much of the page's meaning this element carries.
 *
 * Character count times type size: a 28pt title and a long paragraph both score
 * highly, a one-word 6pt label scores low. It is a ranking heuristic and only
 * ever decides what survives a cap — it never changes an element's content or
 * geometry, and with no cap in play it has no effect at all.
 */
function informationScore(element: GroundedElement): number {
  const chars = element.text.trim().length;
  const size = element.fontSize > 0 ? element.fontSize : 1;
  return chars * size;
}

function elementFromLine(line: PlacedTextFragment, index: number): GroundedElement | null {
  const text = typeof line?.text === 'string' ? line.text.trim() : '';
  if (!text) return null;
  const x = finite(line.x);
  const y = finite(line.y);
  const width = finite(line.width);
  const height = finite(line.height);
  const fontSize = finite(line.fontSizePt);
  if (x == null || y == null || width == null || height == null) return null;
  if (!(width > 0) || !(height > 0)) return null;

  return {
    id: `t${index + 1}`,
    text,
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    fontSize: fontSize != null && fontSize > 0 ? round(fontSize) : 11,
    ...(line.fontFamily ? { fontFamily: line.fontFamily } : {}),
  };
}

/**
 * Build one page's measured ground truth from its merged text lines.
 *
 * Returns null when the page yields no usable text — an empty grounding block
 * would tell the model "this page has no text", which on a scanned page is a lie
 * it would then reproduce. Absent grounding correctly means "no measurements
 * available, read the document yourself".
 */
export function buildGroundedReferenceFromLines(
  lines: readonly PlacedTextFragment[] | null | undefined,
  pageSize: { width?: unknown; height?: unknown } | null | undefined,
  options: BuildGroundedReferenceOptions = {},
): GroundedPageBuild | null {
  const pageWidth = finite(pageSize?.width);
  const pageHeight = finite(pageSize?.height);
  if (pageWidth == null || pageHeight == null || !(pageWidth > 0) || !(pageHeight > 0)) return null;
  if (!Array.isArray(lines) || !lines.length) return null;

  const all: GroundedElement[] = [];
  for (const line of lines) {
    const element = elementFromLine(line, all.length);
    if (element) all.push(element);
  }
  if (!all.length) return null;

  const requested = finite(options.maxElements);
  const cap = Math.max(1, Math.floor(requested != null ? requested : DEFAULT_GROUNDED_ELEMENT_CAP));
  let elements = all;
  if (all.length > cap) {
    const ranked = all
      .map((element, order) => ({ element, order, score: informationScore(element) }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, cap);
    // Reading order restored: the model is reconstructing a document, and a list
    // sorted by prominence reads as a different document.
    elements = ranked.sort((a, b) => a.order - b.order).map((entry) => entry.element);
  }

  return {
    dropped: all.length - elements.length,
    reference: {
      pageWidth: round(pageWidth),
      pageHeight: round(pageHeight),
      // The measurements are already in page points, so there is no raster to
      // scale from. Reporting the page as the image keeps `scale` at 1 for any
      // consumer that derives one.
      imageWidth: round(pageWidth),
      imageHeight: round(pageHeight),
      elements,
    },
  };
}
