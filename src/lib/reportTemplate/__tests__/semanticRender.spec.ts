/**
 * What the semantic annotation changes in the rendered document.
 *
 * `render-template-pdf` asks WeasyPrint for `pdf/ua-1` with `tagged: true`, and
 * WeasyPrint builds the structure tree from the ELEMENT NAME. Verified against
 * WeasyPrint 69 on the pages this suite describes:
 *
 *     before   /Document → [ /Div /Div /Figure /Div … ]        (flat, no headings)
 *     after    /Document → [ /H1 /H2 /Div /H3 /Figure(/Alt) …]
 *     pixels   identical, SHA-256 of the 300 DPI raster
 *
 * The pixel result is the constraint, not a bonus: this stage may add meaning
 * and must not move a single point.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { SEMANTIC_ANNOTATION_VERSION } from '@/lib/reportTemplate/pdfImport/semanticRole.pure';
import { MISSING_ALT } from '../blocks/_shared.html';

const W = 595;
const H = 842;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const text = (over: Record<string, unknown> = {}) => ({
  id: 'ov', type: 'text', x: 48, y: 96, width: 400, height: 24, rotation: 0, opacity: 1,
  content: 'Executive Summary', fontFamily: 'Helvetica', fontSize: 14, fontWeight: 'bold',
  fontStyle: 'normal', color: '#111111', align: 'left', lineHeight: 1.3, letterSpacing: 0,
  ...over,
});

const semantics = (role: string, headingLevel?: number) => ({
  semantics: { version: SEMANTIC_ANNOTATION_VERSION, role, ...(headingLevel ? { headingLevel } : {}) },
});

/**
 * The drawn page, without the document's own title heading.
 *
 * `renderTemplateToHtml` emits the report's title as an `<h1>` before the first
 * page and off the visual surface, because PDF/UA-1 clause 7.4.2 requires the
 * first heading in a file to be level 1 and the catalogue's masters set their
 * cover title as positioned display type, which carries no heading role. That
 * heading is a property of the document; these assertions are about what an
 * OVERLAY becomes, so they read the page.
 */
function page(html: string): string {
  const i = html.indexOf('<section');
  return i < 0 ? html : html.slice(i);
}

function render(overlays: unknown[]): string {
  return renderTemplateToHtml({
    id: 't', name: 'semantics', version: 1,
    page: { width: W, height: H, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    theme: { colors: { background: '#FFFFFF', text: '#111111' } },
    pages: [{
      id: 'p1', name: 'Page 1', size: { width: W, height: H }, background: { color: '#FFFFFF' },
      blocks: [{ id: 'free-1', type: 'free', overlays }],
    }],
  } as never, {}).html;
}

describe('a heading is emitted as a heading', () => {
  it('renders a title as h1 and a section header at its own level', () => {
    expect(render([text({ ...semantics('title', 1) })])).toContain('<h1 ');
    expect(render([text({ ...semantics('heading', 2) })])).toContain('<h2 ');
    expect(render([text({ ...semantics('heading', 5) })])).toContain('<h5 ');
  });

  it('leaves every other role as a div', () => {
    for (const role of ['body', 'caption', 'footnote', 'pageHeader', 'pageFooter', 'listItem', 'code']) {
      const html = render([text(semantics(role))]);
      expect(page(html), role).not.toMatch(/<h[1-6][ >]/);
      expect(html, role).toContain('<div ');
    }
  });

  it('changes nothing for an overlay with no annotation', () => {
    // Every template that predates this stage, and every import path that emits
    // no labels, must render byte-identically.
    expect(render([text()])).toBe(render([text()]));
    expect(page(render([text()]))).not.toMatch(/<h[1-6][ >]/);
  });

  it('zeroes the margin the heading element would otherwise inherit', () => {
    // The box is absolutely positioned, so a UA-stylesheet margin moves it.
    // Everything else h1–h6 sets — font-size, font-weight — is already written
    // inline by the shared declaration builder.
    const html = render([text({ ...semantics('title', 1) })]);
    expect(html).toMatch(/<h1 [^>]*style="[^"]*margin:0;"/);
  });

  it('gives the flex container a real child instead of an anonymous one', () => {
    // Vertical alignment makes this box a flex container; WeasyPrint emits a
    // structure element for the anonymous flex item it then creates, and that
    // element inherits the tag — producing /H1 nested inside /H1. An explicit
    // span costs nothing and is pixel-identical.
    expect(render([text({ ...semantics('title', 1) })]))
      .toMatch(/<h1 [^>]*><span>Executive Summary<\/span><\/h1>/);
  });

  it('refuses the heading element when the copy was split into paragraphs', () => {
    // `<p>` inside a heading is invalid, and a parser recovering from it closes
    // the heading early and leaves the rest of the copy outside the element.
    const html = render([text({ content: 'First para.\n\nSecond para.', ...semantics('heading', 2) })]);
    expect(html).not.toMatch(/<h2[ >]/);
    expect(html).toContain('<p style=');
  });

  it('keeps the overlay id on the element the editor queries', () => {
    // `[data-overlay-id]` is how the canvas mirrors live drag geometry and how
    // the V2 DOM-evidence walker finds a box. The id must survive the tag swap.
    expect(render([text({ ...semantics('title', 1) })])).toContain('<h1 data-overlay-id="ov"');
  });
});

describe('a figure carries its alternative text', () => {
  const image = (over: Record<string, unknown> = {}) => ({
    id: 'fig', type: 'image', x: 48, y: 200, width: 200, height: 120,
    rotation: 0, opacity: 1, src: PNG, fit: 'contain', ...over,
  });

  it('emits alt, which WeasyPrint writes as the figure\'s /Alt', () => {
    // A /Figure with no /Alt is a hard PDF/UA failure, and every imported
    // picture was one.
    expect(render([image({ alt: 'Bar chart of income by source' })]))
      .toContain('alt="Bar chart of income by source"');
  });

  it('names an absent description rather than omitting the attribute', () => {
    // This asserted the opposite — no description, no attribute — on the
    // reasoning that an empty `alt` marks a picture decorative. **Measured on
    // WeasyPrint 69.0, the pinned engine, it does not.** `<img alt="">` and
    // `<img>` with no attribute produce a byte-identical PDF (7,167 bytes each
    // on a one-image probe) and in both the figure is tagged `/Figure` with no
    // `/Alt`, which veraPDF 1.30.2 fails under clause 7.3. There is no
    // "decorative" escape on this engine, so an undescribed picture cannot be
    // made conformant by saying less about it; `MISSING_ALT` says the
    // description is missing, which is true and which a reader can act on.
    for (const nothing of [{}, { alt: '   ' }]) {
      const html = render([image(nothing)]);
      const emitted = /<img[^>]*\salt="([^"]*)"/.exec(html);
      expect(emitted, `no img with an alt for ${JSON.stringify(nothing)}`).not.toBeNull();
      expect(emitted![1]).toBe(MISSING_ALT);
      expect(html).not.toContain(' alt=""');
    }
  });

  it('is refused by the schema when it is not a string at all', () => {
    // This case used to sit in the loop above, asserting `not.toContain(' alt=')`
    // on `{ alt: 42 }`, and it passed for a reason that had nothing to do with
    // alternative text: `OverlaySchema.alt` is `z.string().optional()`, so a
    // number fails the parse, the template is rejected whole and the document
    // renders EMPTY. An empty document contains no `alt=` and also no picture,
    // no page and no text. Asserted here for what it is, so that the loop above
    // is left testing the renderer.
    const html = render([image({ alt: 42 })]);
    expect(html).not.toContain('<img');
  });

  it('escapes alternative text like any other untrusted string', () => {
    const html = render([image({ alt: '"><script>alert(1)</script>' })]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
  });
});
