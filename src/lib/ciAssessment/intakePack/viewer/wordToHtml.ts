/**
 * Render a .docx as HTML pages, faithfully.
 *
 * Uses `docx-preview`, which is purpose-built for exactly this: it lays a Word
 * document out as pages with its real styles, tables, numbering, fonts and
 * spacing, entirely in the browser. The alternatives were worse — `mammoth`
 * produces semantic HTML and deliberately discards layout, and an embedded
 * Office viewer would send the document to a third party.
 *
 * ## Why it renders offscreen and then moves
 *
 * `docx-preview` needs a live element to render into, and the result has to end
 * up inside a sandboxed iframe so the document's typography and the dashboard's
 * design system cannot reach into each other. So the document is rendered into
 * a detached, laid-out container first — which is also the only moment page
 * heights can be measured — and the resulting markup is then handed to the
 * iframe as a static string.
 *
 * The measurement matters: page navigation scrolls the *outer* container by
 * real offsets, so the iframe never needs to run a script. It is sandboxed with
 * none allowed.
 */

import { measureDocument } from './measureFrame';

export interface RenderedWordDocument {
  /** Complete HTML document for the iframe. */
  html: string;
  /** Offset of each page from the top of the document, in CSS pixels. */
  pageOffsets: number[];
  /** Full rendered height, so the iframe can be sized to its content. */
  height: number;
  /** Rendered width of a page, for fitting the viewport. */
  width: number;
  /**
   * Whether the height came from laying the frame's own document out. False
   * means the padded staging-area estimate — the viewer re-measures it.
   */
  measured: boolean;
}

const RENDER_OPTIONS = {
  className: 'docx',
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  breakPages: true,
  /**
   * Ignore Word's cached page-break hints. This must stay `true`.
   *
   * `w:lastRenderedPageBreak` records where Word *happened* to break the text
   * the last time it laid the file out, with whatever fonts and printer driver
   * were installed then. It is a stale hint, not an authored break. Honouring
   * it alongside the document's 13 real breaks produced 31 break points and
   * 27 pages, most of the extras empty — which is exactly the symptom that was
   * reported. Ignoring them gives the 14 pages the document actually has.
   */
  ignoreLastRenderedPageBreak: true,
  experimental: false,
  trimXmlDeclaration: true,
  useBase64URL: true,
  renderChanges: false,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  debug: false,
} as const;

/**
 * A container that is laid out but invisible.
 *
 * `display:none` would give every element a zero height and make the page
 * offsets meaningless, so this is moved off-screen instead — the standard trick
 * for measuring something the user must not see mid-render.
 */
function createStage(): HTMLDivElement {
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;'
    + 'visibility:hidden;pointer-events:none;';
  document.body.appendChild(stage);
  return stage;
}

function documentShell(styles: string, body: string): string {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<style>
        :root { color-scheme: light; }
        html, body { margin:0; padding:0; background:#f1f1f4; }
        .docx-wrapper { padding:0 !important; background:transparent !important; }
        section.docx {
          margin:0 auto 18px auto !important;
          box-shadow:0 1px 4px rgba(0,0,0,0.18);
          background:#ffffff;
        }
      </style>${styles}</head><body>${body}</body></html>`;
}

/**
 * Drop pages with no body content.
 *
 * Ignoring the stale break hints removes almost all of them, but a document can
 * still end on a break and leave a genuinely empty final page. Word would not
 * show that page either, and a blank sheet in a reference document reads as
 * something having failed to load.
 *
 * Headers and footers repeat on every page, so they are not content — a page
 * carrying only those is empty. Exported so it can be tested against a built
 * DOM rather than only through a full render.
 */
export function removeEmptyPages(container: HTMLElement): number {
  let removed = 0;
  Array.from(container.querySelectorAll<HTMLElement>('section.docx')).forEach((page) => {
    const body = Array.from(page.children).filter(
      (child) => !child.className.includes('header') && !child.className.includes('footer'),
    );
    const hasText = body.some((child) => (child.textContent ?? '').trim().length > 0);
    const hasGraphics = body.some((child) => child.querySelector('img, svg, table') != null);
    if (!hasText && !hasGraphics) {
      page.remove();
      removed += 1;
    }
  });
  return removed;
}

/**
 * Render the document and measure its pages.
 *
 * Returns markup rather than a live node so the caller can put it in an iframe
 * without carrying a detached DOM tree around.
 */
export async function renderWordToHtml(data: ArrayBuffer): Promise<RenderedWordDocument> {
  const { renderAsync } = await import('docx-preview');

  const stage = createStage();
  try {
    await renderAsync(new Blob([data]), stage, undefined, RENDER_OPTIONS);

    removeEmptyPages(stage);

    const pages = Array.from(stage.querySelectorAll<HTMLElement>('section.docx'));
    if (!pages.length) throw new Error('The document produced no pages.');

    const wrapper = stage.querySelector<HTMLElement>('.docx-wrapper') ?? stage;
    const wrapperTop = wrapper.getBoundingClientRect().top;
    const pageOffsets = pages.map(
      (page) => Math.max(0, Math.round(page.getBoundingClientRect().top - wrapperTop)),
    );

    const last = pages[pages.length - 1];
    const height = Math.round(
      last.getBoundingClientRect().bottom - wrapperTop,
    );
    const width = Math.round(pages[0].getBoundingClientRect().width);

    // `docx-preview` writes its stylesheets into the container alongside the
    // content, so taking the whole innerHTML keeps the document self-contained.
    const styleNodes = Array.from(stage.querySelectorAll('style'))
      .map((node) => node.outerHTML)
      .join('');
    const content = Array.from(stage.children)
      .filter((child) => child.tagName.toLowerCase() !== 'style')
      .map((child) => child.outerHTML)
      .join('');

    const html = documentShell(styleNodes, content);

    // Measure the finished document rather than trusting the staging area.
    // The stage lives in the app's own DOM, where our design system's type and
    // spacing rules apply to `p`, `td` and `span` — so a paragraph can occupy a
    // different number of lines there than it does inside the frame. The frame
    // is what the user sees, so the frame is what gets measured.
    const measured = await measureDocument({
      html,
      selector: '.docx-wrapper',
      offsetSelector: 'section.docx',
      fallback: { width: Math.max(width, 1), height: Math.max(height, 1) },
    });

    return {
      html,
      pageOffsets: measured.offsets?.length ? measured.offsets : pageOffsets,
      // Unmeasured means the height came from the staging area, where the
      // app's own type rules reached in and may have wrapped lines differently
      // from the frame. Pad it: extra grey below the last page is visible and
      // harmless, a short frame silently cuts the document off.
      height: measured.measured ? measured.height : Math.round(measured.height * 1.1) + 200,
      width: Math.max(width, 1),
      measured: measured.measured,
    };
  } finally {
    stage.remove();
  }
}
