/**
 * ensureCatalogFontFaces: every catalog-known family a template references must
 * end up with a loadable @font-face (Google Fonts cssUrl) so the editor preview
 * and the WeasyPrint export render the real typeface instead of falling back.
 */
import { describe, it, expect } from 'vitest';
import { ensureCatalogFontFaces, primaryFamily } from '../fontCatalog';

const overlay = (fontFamily: string, runs?: Array<{ text: string; fontFamily?: string }>) => ({
  id: 'o1', type: 'text', x: 0, y: 0, width: 100, height: 20, content: 'Hi', fontFamily,
  ...(runs ? { runs } : {}),
});

const templateWith = (tokens: any, overlays: any[] = []) => ({
  version: 1,
  tokens,
  pages: [{ id: 'p1', name: 'P', size: { width: 595, height: 842 }, background: {}, blocks: [{ id: 'b1', type: 'free', props: {}, overlays }] }],
  slots: {},
});

describe('primaryFamily', () => {
  it('unquotes and takes the first family of a stack', () => {
    expect(primaryFamily('"Open Sans", sans-serif')).toBe('Open Sans');
    expect(primaryFamily("Inter, sans-serif")).toBe('Inter');
    expect(primaryFamily('Helvetica')).toBe('Helvetica');
  });
});

describe('ensureCatalogFontFaces', () => {
  it('adds a cssUrl face for catalog families referenced by tokens and overlays', () => {
    const t = ensureCatalogFontFaces(templateWith(
      { colors: {}, fonts: { heading: 'Playfair Display', body: 'Inter, sans-serif' }, spacing: {} },
      [overlay('Roboto, sans-serif')],
    ) as any) as any;
    const families = (t.tokens.fontFaces ?? []).map((f: any) => f.family);
    expect(families).toContain('Playfair Display');
    expect(families).toContain('Inter');
    expect(families).toContain('Roboto');
    for (const f of t.tokens.fontFaces) expect(f.cssUrl).toContain('fonts.googleapis.com');
  });

  it('collects families from rich-text runs too', () => {
    const t = ensureCatalogFontFaces(templateWith(
      { colors: {}, fonts: {}, spacing: {} },
      [overlay('Helvetica', [{ text: 'a', fontFamily: 'Lora' }])],
    ) as any) as any;
    expect((t.tokens.fontFaces ?? []).map((f: any) => f.family)).toEqual(['Lora']);
  });

  it('leaves built-ins and unknown families alone', () => {
    const input = templateWith(
      { colors: {}, fonts: { body: 'Helvetica' }, spacing: {} },
      [overlay('Some Proprietary Font')],
    ) as any;
    const t = ensureCatalogFontFaces(input) as any;
    expect(t.tokens.fontFaces ?? []).toEqual([]);
    expect(t).toBe(input); // unchanged → same reference
  });

  it('does not duplicate an existing loadable face', () => {
    const t = ensureCatalogFontFaces(templateWith(
      {
        colors: {}, fonts: { body: 'Inter' }, spacing: {},
        fontFaces: [{ family: 'Inter', src: 'data:font/woff2;base64,AAAA', source: 'embedded' }],
      },
    ) as any) as any;
    expect(t.tokens.fontFaces).toHaveLength(1);
    expect(t.tokens.fontFaces[0].src).toContain('data:');
  });

  it('upgrades a bare placeholder face (no src/cssUrl) to a loadable catalog face', () => {
    const t = ensureCatalogFontFaces(templateWith(
      { colors: {}, fonts: {}, spacing: {}, fontFaces: [{ family: 'Inter' }] },
    ) as any) as any;
    expect(t.tokens.fontFaces).toHaveLength(1);
    expect(t.tokens.fontFaces[0]).toMatchObject({ family: 'Inter' });
    expect(t.tokens.fontFaces[0].cssUrl).toContain('fonts.googleapis.com');
  });
});
