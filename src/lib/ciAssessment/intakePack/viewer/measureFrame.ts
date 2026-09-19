/**
 * Measure a rendered document by laying it out, not by adding it up.
 *
 * ## Why this exists
 *
 * The viewer puts each document in a sandboxed, script-free iframe. An iframe
 * does not size itself to its content, so something has to tell it how tall and
 * wide to be — and because the frame cannot run a script, it cannot report that
 * itself.
 *
 * The first two attempts computed the size arithmetically: sum the column
 * widths from the spreadsheet, sum the row heights, add the padding. That is
 * wrong in a way that is easy to miss and impossible to fix by adjusting the
 * numbers, because the heights stored in an .xlsx are the heights *Excel* laid
 * the file out with, using Excel's fonts and Excel's wrapping. A browser wraps
 * a long answer across two lines where Excel used one, and the row grows. Every
 * sheet in the pack came out between 53px and 358px short, and the shortfall
 * was silently clipped.
 *
 * So: render the exact same HTML in a hidden, same-origin iframe first and read
 * the size back. It is the same document, laid out by the same engine, so the
 * answer is exact rather than an estimate that happens to be close.
 *
 * ## Why it polls instead of listening for `load`
 *
 * The third attempt listened for the frame's `load` event and read the layout
 * then. That shipped, verified — and clipped anyway, because an iframe fires
 * `load` **twice**: once for the initial `about:blank` document it is born
 * with, and once for the `srcdoc` document that replaces it. Chromium delivers
 * the `about:blank` event first, deterministically. The handler looked at that
 * empty document, found nothing matching the selector, and settled on the
 * arithmetic fallback — so every sheet quietly shipped the exact shortfalls
 * this module exists to kill, while the measuring machinery sat unread one
 * event later.
 *
 * The lesson is baked in here: **never conclude anything from a document
 * without first proving it is the srcdoc document** (`about:blank` is the
 * newborn placeholder, not a failure), and never trust event order across
 * browsers. So this polls: wait until the frame's document is no longer
 * `about:blank`, is fully loaded, has its fonts (a .docx can embed its own),
 * and has laid out to a stable size — and only then read it. `load` is kept
 * only as a hint to poll sooner.
 *
 * The measuring frame is deliberately *not* sandboxed — same-origin is what
 * makes `contentDocument` readable — but it is also never shown, never
 * navigated, and carries only our own generated markup, which contains no
 * script (`documentViewer.test.ts` asserts that).
 */

export interface MeasuredSize {
  width: number;
  height: number;
}

/**
 * Viewport for the measuring frame.
 *
 * Wide enough that a document is never forced to wrap more than it would at its
 * natural width — the widest sheet in the pack is ~2,400px. Cell wrapping is
 * governed by the fixed column widths rather than the viewport, so a generous
 * viewport does not change the measured height.
 */
const MEASURE_VIEWPORT_PX = 3200;

/**
 * A frame that never produces a readable document must not hang the viewer
 * behind its spinner forever. Generous on purpose: with the polling above, the
 * only way to spend this budget is an environment that genuinely cannot load
 * srcdoc, and a slow answer that is right beats a fast one that clips.
 */
const MEASURE_TIMEOUT_MS = 8000;

/** How often to look at the frame while waiting for it to become readable. */
const POLL_INTERVAL_MS = 50;

/**
 * Breathing room on the measured size.
 *
 * Sub-pixel layout, a collapsed outer border and the browser's own rounding all
 * land within a pixel or two. Rather than chase them, the box is given a couple
 * of pixels it does not need — invisible against the page, and the difference
 * between "exact" and "clipped by one line of text".
 */
const SAFETY_PX = 4;

interface MeasureRequest {
  html: string;
  /**
   * What to measure. The element that defines the content's true extent — the
   * table on a worksheet, the page wrapper on a Word document — because the
   * body itself stretches to the measuring viewport and would over-report.
   */
  selector: string;
  /** Used when measurement is unavailable, and as a floor under the result. */
  fallback: MeasuredSize;
  /** Optional: offsets of these elements from the top, for page navigation. */
  offsetSelector?: string;
}

export interface MeasureResult extends MeasuredSize {
  /** Present when `offsetSelector` was given. */
  offsets?: number[];
  /**
   * False when the environment could not lay the document out. A caller
   * showing an unmeasured document must size it with room to spare — the
   * fallback is a floor known to run short, not an estimate that is close.
   */
  measured: boolean;
}

/**
 * Whether this environment lays documents out at all.
 *
 * jsdom parses HTML but gives every element a zero rect, so waiting on it to
 * produce a nonzero layout would only spend the timeout. The root element of a
 * real browser always has a width; a zero here means there is no layout engine
 * to ask.
 */
function hasLayoutEngine(): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  return document.documentElement.getBoundingClientRect().width > 0;
}

function createFrame(html: string): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('title', 'Measuring');
  // No scrollbars, to match the display frame exactly: a classic (non-overlay)
  // scrollbar consumes layout space, and the display frame — `scrolling="no"`,
  // sized to its content — never has one.
  frame.setAttribute('scrolling', 'no');
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;visibility:hidden;'
    + `width:${MEASURE_VIEWPORT_PX}px;height:800px;pointer-events:none;`;
  // Set before the frame enters the DOM, so the srcdoc navigation starts
  // immediately rather than after an about:blank commit.
  frame.srcdoc = html;
  return frame;
}

/**
 * Measure one document.
 *
 * Resolves with the fallback rather than rejecting when there is no layout to
 * read — jsdom under test, or a frame whose document never becomes readable. A
 * viewer that showed an approximately sized document is far better than one
 * that showed an error because it could not measure it.
 */
export function measureDocument(request: MeasureRequest): Promise<MeasureResult> {
  const unmeasured: MeasureResult = { ...request.fallback, measured: false };
  if (!hasLayoutEngine()) return Promise.resolve(unmeasured);

  return new Promise<MeasureResult>((resolve) => {
    const frame = createFrame(request.html);
    let settled = false;
    /** Height seen on the previous look, for the stability requirement. */
    let lastHeight = -1;

    const finish = (result: MeasureResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(poller);
      frame.remove();
      resolve(result);
    };

    const timer = window.setTimeout(() => finish(unmeasured), MEASURE_TIMEOUT_MS);

    const inspect = () => {
      if (settled) return;
      try {
        const inner = frame.contentDocument;
        // `about:blank` is the placeholder document every iframe is born
        // with, and it can fire its own `load` event before the srcdoc
        // commits. It is not our document and proves nothing — keep waiting.
        if (!inner || inner.URL === 'about:blank' || inner.readyState !== 'complete') return;

        const target = inner.querySelector(request.selector);
        // The srcdoc document really is loaded and really has no target:
        // nothing to measure, ever. (An empty worksheet renders no table.)
        if (!target) { finish(unmeasured); return; }

        // Embedded fonts (a .docx carries its own as data URLs) can finish
        // after `load` and re-wrap every line. Wait until they are in.
        const fonts = (inner as Document & { fonts?: FontFaceSet }).fonts;
        if (fonts && fonts.status === 'loading') return;

        const rect = target.getBoundingClientRect();
        // A document that lays out to nothing means the frame never really
        // rendered; trust the estimate instead of sizing the box to zero.
        if (rect.width < 1 || rect.height < 1) { finish(unmeasured); return; }

        // Require the same height on two consecutive looks. Static markup
        // settles instantly; anything still moving — late images, a font swap
        // the FontFaceSet missed — gets another poll instead of a wrong answer.
        if (rect.height !== lastHeight) { lastHeight = rect.height; return; }

        // Padding on the container the target sits in is part of the document.
        const container = target.parentElement;
        const style = container ? inner.defaultView?.getComputedStyle(container) : null;
        const padX = style
          ? parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0') : 0;
        const padY = style
          ? parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0') : 0;

        const offsets = request.offsetSelector
          ? Array.from(inner.querySelectorAll(request.offsetSelector)).map(
            (node) => Math.max(0, Math.round(node.getBoundingClientRect().top + inner.documentElement.scrollTop)),
          )
          : undefined;

        finish({
          width: Math.max(Math.ceil(rect.width + padX) + SAFETY_PX, request.fallback.width),
          height: Math.max(Math.ceil(rect.height + padY) + SAFETY_PX, request.fallback.height),
          offsets,
          measured: true,
        });
      } catch {
        // Cross-origin or a document that refused to lay out. Estimate it is.
        finish(unmeasured);
      }
    };

    const poller = window.setInterval(inspect, POLL_INTERVAL_MS);
    // `load` fires for the srcdoc document too (after about:blank's, where
    // that one comes at all) — a hint to look sooner than the next poll tick.
    frame.addEventListener('load', inspect);
    document.body.appendChild(frame);
  });
}

/** Measure several documents in sequence, reusing nothing but the main thread. */
export async function measureDocuments(
  requests: MeasureRequest[],
): Promise<MeasureResult[]> {
  const results: MeasureResult[] = [];
  for (const request of requests) {
    // Sequential on purpose: a dozen frames laying out at once is slower than
    // one at a time, and the whole batch runs behind the viewer's spinner.
    results.push(await measureDocument(request));
  }
  return results;
}
