import { describe, it, expect } from 'vitest';
import { parseTemplate } from '../templateSchema';
import { renderTemplateToHtml } from '../htmlRenderer';
import { tokensToFontFaceCss } from '../cssTokens';

// R0 — the additive reconstruction primitives (vector overlay, rich-text runs,
// numeric font weight, embedded data: fonts). Existing-template fidelity is
// covered by goldenRender.spec.ts; here we prove the NEW primitives work.

function pageWith(overlay: any) {
  return parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'p1', name: 'P', size: { width: 595, height: 842 }, background: {},
      blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [overlay] }],
    }],
  });
}
const render = (tpl: any) => renderTemplateToHtml(tpl, { data: {}, editorMode: false }).html;

describe('R0 — vector overlay (editable SVG)', () => {
  it('parses a vector overlay and renders an <svg> with editable <path> geometry', () => {
    const tpl = pageWith({
      id: 'v1', type: 'vector', x: 10, y: 10, width: 40, height: 40,
      viewBox: '0 0 24 24',
      paths: [{ d: 'M4 4 L20 20', fill: '#ff0000', stroke: '#000000', strokeWidth: 2, fillRule: 'evenodd' }],
    });
    const html = render(tpl);
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('<path');
    expect(html).toContain('d="M4 4 L20 20"');
    expect(html).toContain('fill="#ff0000"');
    expect(html).toContain('stroke-width="2"');
    expect(html).toContain('fill-rule="evenodd"');
  });

  it('resolves token references in path fills', () => {
    const tpl = parseTemplate({
      version: 1,
      tokens: { colors: { brand: '#00aa00' }, fonts: {}, spacing: {} },
      pages: [{
        id: 'p1', name: 'P', size: { width: 595, height: 842 }, background: {},
        blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [
          { id: 'v2', type: 'vector', x: 0, y: 0, width: 20, height: 20, viewBox: '0 0 10 10',
            paths: [{ d: 'M0 0 H10', fill: 'token:brand' }] },
        ] }],
      }],
    });
    expect(render(tpl)).toContain('fill="#00aa00"');
  });

  it('does not allow path colours to break out of SVG attributes', () => {
    const tpl = pageWith({
      id: 'v3', type: 'vector', x: 0, y: 0, width: 20, height: 20,
      paths: [{ d: 'M0 0 H10', fill: '#"/><script id="vector-xss">alert(1)</script>' }],
    });
    const html = render(tpl);
    expect(html).not.toContain('vector-xss');
    expect(html).toContain('fill="none"');
  });
});

describe('R0 — rich-text runs (per-run colour/font/weight)', () => {
  it('renders one styled span per run', () => {
    const tpl = pageWith({
      id: 't1', type: 'text', x: 0, y: 0, width: 200, height: 30, content: 'Red Blue',
      runs: [
        { text: 'Red', color: '#ff0000', fontWeight: 700 },
        { text: 'Blue', color: '#0000ff', fontStyle: 'italic' },
      ],
    });
    const html = render(tpl);
    expect((html.match(/<span/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('color:#ff0000');
    expect(html).toContain('color:#0000ff');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('Red');
    expect(html).toContain('Blue');
  });
});

describe('R0 — numeric font weight', () => {
  it('renders the exact weight (fontWeightNumeric wins over bold/normal)', () => {
    const tpl = pageWith({ id: 't2', type: 'text', x: 0, y: 0, width: 100, height: 20, content: 'Hi', fontWeightNumeric: 600 });
    expect(render(tpl)).toContain('font-weight:600');
  });
});

describe('R0 — embedded (data:) fonts', () => {
  it('emits @font-face with the data: src and a woff2 format hint', () => {
    const css = tokensToFontFaceCss({
      colors: {}, fonts: {}, spacing: {},
      fontFaces: [{ family: 'Captured', src: 'data:font/woff2;base64,AAAA', source: 'embedded' }],
    } as any);
    expect(css).toContain("font-family: 'Captured'");
    expect(css).toContain('data:font/woff2;base64,AAAA');
    expect(css).toContain("format('woff2')");
  });

  it('R2: emits unicode-range for a coverage-scoped face and drops a malformed one', () => {
    const scoped = tokensToFontFaceCss({
      colors: {}, fonts: {}, spacing: {},
      fontFaces: [{
        family: 'Scoped', src: 'data:font/ttf;base64,AAAA', source: 'embedded',
        unicodeRange: 'U+0041-005A, U+0061',
      }],
    } as any);
    expect(scoped).toContain('unicode-range: U+0041-005A, U+0061;');

    const mangled = tokensToFontFaceCss({
      colors: {}, fonts: {}, spacing: {},
      fontFaces: [{
        family: 'Unscoped', src: 'data:font/ttf;base64,AAAA', source: 'embedded',
        unicodeRange: "U+41;}</style><script>alert(1)</script>",
      }],
    } as any);
    expect(mangled).toContain("font-family: 'Unscoped'");
    expect(mangled).not.toContain('unicode-range');
    expect(mangled).not.toContain('script');
  });

  it('R2: parseTemplate round-trips unicodeRange on a fontFace', () => {
    const tpl = parseTemplate({
      version: 1,
      tokens: {
        colors: {}, fonts: {}, spacing: {},
        fontFaces: [{ family: 'X', src: 'data:font/woff2;base64,AAAA', unicodeRange: 'U+0020-007E' }],
      },
      pages: [],
    });
    expect((tpl.tokens as any).fontFaces[0].unicodeRange).toBe('U+0020-007E');
  });

  it('parseTemplate keeps a data: fontFace (the .url() validator no longer rejects it)', () => {
    const tpl = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {}, fontFaces: [{ family: 'X', src: 'data:font/woff2;base64,AAAA' }] },
      pages: [],
    });
    expect((tpl.tokens as any).fontFaces[0].src).toBe('data:font/woff2;base64,AAAA');
  });

  it('rejects font sources that could break out of the generated style element', () => {
    const payload = `x');}</style><script id="font-xss">alert(1)</script><style>`;
    expect(() => parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {}, fontFaces: [{ family: 'X', src: payload }] },
      pages: [],
    })).toThrow();

    const css = tokensToFontFaceCss({
      colors: {}, fonts: {}, spacing: {},
      fontFaces: [{ family: `X';}</style><script>alert(1)</script>`, src: payload }],
    } as any);
    expect(css).toBe('');

    const escapedFamilyCss = tokensToFontFaceCss({
      colors: {}, fonts: {}, spacing: {},
      fontFaces: [{ family: `X';}</style><script>alert(1)</script>`, src: 'data:font/woff2;base64,AAAA' }],
    } as any);
    expect(escapedFamilyCss).not.toContain('</style>');
    expect(escapedFamilyCss).not.toContain('<script>');

    const escapedWeightCss = tokensToFontFaceCss({
      colors: {}, fonts: {}, spacing: {},
      fontFaces: [{ family: 'X', src: 'data:font/woff2;base64,AAAA', weight: '400;}</style><script>alert(1)</script>' }],
    } as any);
    expect(escapedWeightCss).not.toContain('</style>');
    expect(escapedWeightCss).toContain('font-weight: normal');
  });

  it('rejects non-HTTP stylesheet URLs', () => {
    expect(() => parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {}, fontFaces: [{ family: 'X', cssUrl: 'javascript:alert(1)' }] },
      pages: [],
    })).toThrow();
  });
});
