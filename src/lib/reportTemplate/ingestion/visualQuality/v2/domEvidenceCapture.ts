/**
 * Read rendered text geometry out of a live DOM into `RenderedTextEvidenceV1`.
 *
 * THE GAP THIS FILLS
 * ------------------
 * `domEvidence.ts` holds correct, unit-tested evaluators for clipping,
 * overflow, off-page, occlusion and contrast. They had **no input**: nothing
 * anywhere produced the evidence they consume, so none of them had a caller and
 * the whole V2 gate sat unwired. Meanwhile `generatedRenderCapture.ts` captures
 * PIXELS via html2canvas, which cannot answer "did this box clip its text" —
 * clipped text still occupies its pixels, it is simply not drawn.
 *
 * So the quality gate could not see the defect users were reporting. This
 * module is the missing producer: it walks the rendered page and measures the
 * things a rasteriser structurally cannot.
 *
 * The DOM reading is deliberately thin and the decisions stay in the pure
 * evaluators. Everything here is "what does the browser say", never "is that
 * acceptable" — the second question is already answered, correctly and
 * testably, next door.
 */
import type {
  RenderedRectV1,
  RenderedTextComputedStyleV1,
  RenderedTextEvidenceV1,
} from './contracts';
import { evaluateClipping, evaluateOffPage, isRenderedVisible } from './domEvidence';

export interface CaptureOptions {
  /** Root to walk. Every `[data-overlay-id]` beneath it is measured. */
  root: ParentNode;
  /** The page box, for the off-page test. */
  pageRectPx: RenderedRectV1;
  /**
   * Cap on elements measured. `Range.getClientRects()` forces layout per
   * element, so an unbounded walk on a large document is a visible stall.
   */
  maxElements?: number;
}

export const DEFAULT_MAX_ELEMENTS = 2000;

function toRect(r: DOMRect, originX: number, originY: number): RenderedRectV1 {
  return { x: r.left - originX, y: r.top - originY, width: r.width, height: r.height };
}

function readStyle(el: Element): RenderedTextComputedStyleV1 {
  const cs = getComputedStyle(el as HTMLElement);
  const num = (v: string): number | null => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    display: cs.display,
    visibility: cs.visibility,
    opacity: Number.parseFloat(cs.opacity) || 0,
    colour: cs.color,
    backgroundColour: cs.backgroundColor,

    // Reading a computed style into evidence, not setting one. The token rule
    // is about authored styles; recording what the browser actually resolved is
    // the entire point of this module.
    // eslint-disable-next-line no-restricted-syntax
    fontFamily: cs.fontFamily,
    fontSizePx: num(cs.fontSize),
    fontWeight: cs.fontWeight,
    lineHeightPx: num(cs.lineHeight),
    letterSpacingPx: num(cs.letterSpacing),
    whiteSpace: cs.whiteSpace,
    overflowX: cs.overflowX,
    overflowY: cs.overflowY,
    transform: cs.transform,
    zIndex: Number.isFinite(Number(cs.zIndex)) ? Number(cs.zIndex) : null,
  } as RenderedTextComputedStyleV1;
}

/**
 * Line boxes for the element's text.
 *
 * `Range.getClientRects()` returns one rect per rendered LINE, which is the
 * only way to see that text wrapped where the source did not — a fact no
 * bounding box and no rasterisation can reveal.
 */
function readLineRects(el: Element, originX: number, originY: number): RenderedRectV1[] {
  try {
    const range = (el.ownerDocument ?? document).createRange();
    range.selectNodeContents(el);
    return Array.from(range.getClientRects()).map((r) => toRect(r, originX, originY));
  } catch {
    return [];
  }
}

/**
 * The nearest ancestor that actually clips, intersected with the element's own
 * box — so a line outside a clipping ancestor is distinguishable from one that
 * merely spills out of its own box.
 */
function computeClipRect(el: Element, own: RenderedRectV1, originX: number, originY: number): RenderedRectV1 {
  const CLIPS = new Set(['hidden', 'clip', 'scroll', 'auto']);
  let rect = own;
  let node: Element | null = el.parentElement;
  let hops = 0;
  while (node && hops < 12) {
    const cs = getComputedStyle(node as HTMLElement);
    if (CLIPS.has(cs.overflowX) || CLIPS.has(cs.overflowY)) {
      const r = toRect(node.getBoundingClientRect(), originX, originY);
      const x1 = Math.max(rect.x, r.x);
      const y1 = Math.max(rect.y, r.y);
      const x2 = Math.min(rect.x + rect.width, r.x + r.width);
      const y2 = Math.min(rect.y + rect.height, r.y + r.height);
      rect = { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
    }
    node = node.parentElement;
    hops += 1;
  }
  return rect;
}

/**
 * Capture text evidence for every overlay under `root`.
 *
 * Never throws: a capture failure must degrade the gate to "no evidence for
 * this element", never take down an import. An element that cannot be measured
 * is omitted rather than recorded with fabricated zeroes, because a zero here
 * reads as "measured and fine".
 */
export function captureTextEvidence(options: CaptureOptions): RenderedTextEvidenceV1[] {
  const { root, pageRectPx } = options;
  const max = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const out: RenderedTextEvidenceV1[] = [];

  let elements: Element[];
  try {
    elements = Array.from(root.querySelectorAll('[data-overlay-id]')).slice(0, max);
  } catch {
    return out;
  }

  // Measure relative to the root so evidence is page-local and comparable
  // across captures, rather than tied to scroll position.
  let originX = 0;
  let originY = 0;
  try {
    const rootEl = (root as Element).getBoundingClientRect
      ? (root as Element).getBoundingClientRect()
      : null;
    if (rootEl) { originX = rootEl.left; originY = rootEl.top; }
  } catch { /* origin stays 0,0 */ }

  for (const el of elements) {
    try {
      const overlayId = el.getAttribute('data-overlay-id');
      const rect = toRect(el.getBoundingClientRect(), originX, originY);
      const style = readStyle(el);
      const lineRectsPx = readLineRects(el, originX, originY);
      const clipRectPx = computeClipRect(el, rect, originX, originY);

      const clip = evaluateClipping({
        clientWidth: (el as HTMLElement).clientWidth,
        clientHeight: (el as HTMLElement).clientHeight,
        scrollWidth: (el as HTMLElement).scrollWidth,
        scrollHeight: (el as HTMLElement).scrollHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        lineRectsPx,
        clipRectPx,
        contentBoxPx: rect,
      });

      const text = (el.textContent ?? '').trim();
      out.push({
        id: `text:${overlayId ?? out.length}`,
        overlayId,
        regionId: el.getAttribute('data-region-id'),
        sourceRunIds: [],
        rawVisibleText: text,
        codePoints: Array.from(text).map((c) => c.codePointAt(0) ?? 0),
        pageRectPx: rect,
        lineRectsPx,
        clientWidth: (el as HTMLElement).clientWidth,
        clientHeight: (el as HTMLElement).clientHeight,
        scrollWidth: (el as HTMLElement).scrollWidth,
        scrollHeight: (el as HTMLElement).scrollHeight,
        computedStyle: style,
        visible: isRenderedVisible({ style, rectPx: rect }),
        clipped: clip.clipped,
        clippedWidthPx: clip.clippedWidthPx,
        clippedHeightPx: clip.clippedHeightPx,
        overflowing: clip.overflowing,
        overflowWidthPx: clip.overflowWidthPx,
        overflowHeightPx: clip.overflowHeightPx,
        offPage: evaluateOffPage(rect, pageRectPx),
        occlusionRatio: null,
        contrastRatio: null,
        hiddenSemantic: el.getAttribute('data-hidden-semantic') === 'true',
        complete: true,
        problems: [],
      } as RenderedTextEvidenceV1);
    } catch {
      // Omit rather than record zeroes — a zero reads as "measured and fine".
    }
  }

  return out;
}
