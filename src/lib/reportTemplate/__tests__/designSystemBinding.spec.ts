/**
 * Binding an import to the design system measured from it.
 *
 * One rule carries everything: **bind only where the token's value is EXACTLY
 * what the overlay measured.** That is what makes today's render byte-identical
 * and tomorrow's restyle possible, and it is why there is no tolerance
 * parameter — a binding that snapped a colour to a nearby token would change a
 * client's document during an import that claims to reproduce it.
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalColor,
  canonicalFont,
  bindOverlayToTokens,
  bindPagesToTokens,
  mergeImportTokens,
  resolveTokenLiteral,
  DESIGN_SYSTEM_BINDING_VERSION,
} from '@/lib/reportTemplate/pdfImport/designSystemBinding.pure';

const TOKENS = {
  colors: { primary: '#251F18', bg: '#FFFFFF', text: '#251F18', muted: '#7A7A7A' },
  fonts: { heading: 'Inter, Arial, sans-serif', body: 'Helvetica' },
};

const text = (over: Record<string, unknown> = {}) => ({
  id: 'o', type: 'text', color: '#251F18', fontFamily: 'Helvetica', ...over,
});

const bind = (overlay: Record<string, unknown>) => bindOverlayToTokens(overlay, TOKENS).overlay;

describe('canonicalColor', () => {
  it('treats the same colour written differently as the same colour', () => {
    expect(canonicalColor('#ABC')).toBe('#aabbcc');
    expect(canonicalColor('#AABBCC')).toBe('#aabbcc');
    expect(canonicalColor('rgb(170, 187, 204)')).toBe('#aabbcc');
    expect(canonicalColor('rgba(170,187,204,1)')).toBe('#aabbcc');
  });

  it('keeps alpha distinct — binding a translucent value to an opaque token makes it opaque', () => {
    expect(canonicalColor('#AABBCC80')).toBe('#aabbcc80');
    expect(canonicalColor('#AABBCC80')).not.toBe(canonicalColor('#AABBCC'));
    expect(canonicalColor('rgba(170,187,204,0.5)')).toBe('#aabbcc80');
  });

  it('refuses anything it cannot compare', () => {
    for (const bad of ['rebeccapurple', 'linear-gradient(red, blue)', 'token:text', '{{brand.color}}', '', 42, null]) {
      expect(canonicalColor(bad as never), String(bad)).toBeNull();
    }
  });
});

describe('canonicalFont', () => {
  it('ignores quoting and spacing noise', () => {
    expect(canonicalFont('"Segoe UI", Inter , sans-serif')).toBe('segoe ui,inter,sans-serif');
    expect(canonicalFont("'Segoe UI',Inter,sans-serif")).toBe('segoe ui,inter,sans-serif');
  });

  it('compares the whole stack, not its members', () => {
    // Substituting `Inter` for `"Segoe UI", Inter` changes which typeface
    // actually renders whenever the first one resolves.
    expect(canonicalFont('Inter')).not.toBe(canonicalFont('"Segoe UI", Inter'));
  });

  it('refuses an existing reference or binding', () => {
    expect(canonicalFont('token:body')).toBeNull();
    expect(canonicalFont('{{brand.font}}')).toBeNull();
  });
});

describe('bindOverlayToTokens', () => {
  it('binds a value that exactly matches a token', () => {
    expect(bind(text())).toMatchObject({ color: 'token:text', fontFamily: 'token:body' });
  });

  it('leaves a value that does not match, untouched', () => {
    // The whole safety property. A near miss is a different colour.
    expect(bind(text({ color: '#251F19' })).color).toBe('#251F19');
    expect(bind(text({ fontFamily: 'Inter' })).fontFamily).toBe('Inter');
  });

  it('matches across notations, because they are the same colour', () => {
    expect(bind(text({ color: 'rgb(37, 31, 24)' })).color).toBe('token:text');
  });

  it('lets the role choose the NAME when two tokens share a value', () => {
    // `primary` and `text` are both #251F18 here. A heading should read as
    // primary and body copy as text — but only because both already match.
    expect(bind(text({ semantics: { role: 'title' } })).color).toBe('token:primary');
    expect(bind(text({ semantics: { role: 'heading' } })).color).toBe('token:primary');
    expect(bind(text({ semantics: { role: 'body' } })).color).toBe('token:text');
    expect(bind(text({ semantics: { role: 'footnote' }, color: '#7A7A7A' })).color).toBe('token:muted');
  });

  it('never lets a role cause a binding that would not otherwise happen', () => {
    // A title whose colour matches nothing stays literal, role or no role.
    expect(bind(text({ semantics: { role: 'title' }, color: '#FF0000' })).color).toBe('#FF0000');
  });

  it('prefers the heading font for a heading and the body font otherwise', () => {
    const heading = bind(text({ semantics: { role: 'heading' }, fontFamily: 'Inter, Arial, sans-serif' }));
    expect(heading.fontFamily).toBe('token:heading');
    expect(bind(text({ fontFamily: 'Helvetica' })).fontFamily).toBe('token:body');
  });

  it('binds shape fills and strokes to their own preferred names', () => {
    const shape = bind({ id: 's', type: 'shape', fill: '#FFFFFF', stroke: '#251F18' });
    expect(shape).toMatchObject({ fill: 'token:bg', stroke: 'token:primary' });
  });

  it('returns the same object when nothing bound, so a no-op is visible', () => {
    const overlay = text({ color: '#123456', fontFamily: 'Courier New' });
    expect(bindOverlayToTokens(overlay, TOKENS).overlay).toBe(overlay);
    expect(bindOverlayToTokens(overlay, TOKENS).changed).toBe(false);
  });

  it('never double-binds an existing reference', () => {
    const already = text({ color: 'token:text', fontFamily: 'token:body' });
    expect(bindOverlayToTokens(already, TOKENS).changed).toBe(false);
  });

  it('is deterministic regardless of token key order', () => {
    const reversed = { colors: Object.fromEntries(Object.entries(TOKENS.colors).reverse()), fonts: TOKENS.fonts };
    expect(bindOverlayToTokens(text({ semantics: { role: 'body' } }), reversed).overlay.color)
      .toBe('token:text');
  });
});

describe('bindPagesToTokens', () => {
  const page = () => ({
    background: { color: '#FFFFFF' },
    blocks: [{ overlays: [text({ id: 'a' }), text({ id: 'b', color: '#7A7A7A' })] }],
  });

  it('binds overlays and the page background, and counts what it did', () => {
    const result = bindPagesToTokens([page()], TOKENS);
    expect(result.changed).toBe(true);
    expect(result.version).toBe(DESIGN_SYSTEM_BINDING_VERSION);
    expect(result.counts).toMatchObject({ color: 2, fontFamily: 2, background: 1 });
    expect(result.pages[0].background!.color).toBe('token:bg');
  });

  it('returns the same page objects when nothing bound', () => {
    const original = { background: { color: '#123456' }, blocks: [{ overlays: [text({ color: '#654321', fontFamily: 'Courier' })] }] };
    const result = bindPagesToTokens([original], TOKENS);
    expect(result.changed).toBe(false);
    expect(result.pages[0]).toBe(original);
  });

  it('does nothing without tokens, rather than inventing them', () => {
    expect(bindPagesToTokens([page()], null).changed).toBe(false);
    expect(bindPagesToTokens([page()], { colors: null, fonts: null }).changed).toBe(false);
    expect(bindPagesToTokens(null, TOKENS).pages).toEqual([]);
  });

  it('tolerates the shapes a page can actually hold', () => {
    expect(() => bindPagesToTokens([{ blocks: null }, { blocks: [null, { overlays: null }] }] as never, TOKENS))
      .not.toThrow();
  });
});

describe('mergeImportTokens', () => {
  it('lets the base template win, so an import cannot restyle existing pages', () => {
    const merged = mergeImportTokens(
      { colors: { text: '#251F18', muted: '#7A7A7A' }, fonts: { body: 'Helvetica' } } as never,
      { colors: { text: '#000000' }, fonts: {} },
    );
    expect(merged.colors.text).toBe('#000000');
    // …while still contributing the names the base does not have.
    expect(merged.colors.muted).toBe('#7A7A7A');
    expect(merged.fonts.body).toBe('Helvetica');
  });

  it('is empty-safe in both directions', () => {
    expect(mergeImportTokens(null, null)).toEqual({ colors: {}, fonts: {} });
  });
});

describe('resolveTokenLiteral', () => {
  it('reads a binding back to the literal it stands for', () => {
    // Anything that MEASURES a template rather than rendering it needs this —
    // `token:primary` in a CDIR layer's colour is not a colour.
    expect(resolveTokenLiteral('token:primary', TOKENS)).toBe('#251F18');
    expect(resolveTokenLiteral('token:body', TOKENS)).toBe('Helvetica');
  });

  it('passes a literal straight through', () => {
    expect(resolveTokenLiteral('#123456', TOKENS)).toBe('#123456');
    expect(resolveTokenLiteral(undefined, TOKENS)).toBeUndefined();
  });

  it('returns the reference unchanged for an unknown key', () => {
    // A silent black would be indistinguishable from a real one downstream.
    expect(resolveTokenLiteral('token:nope', TOKENS)).toBe('token:nope');
    expect(resolveTokenLiteral('token:nope', null)).toBe('token:nope');
  });
});
