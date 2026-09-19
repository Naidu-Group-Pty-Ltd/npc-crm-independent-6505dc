import { describe, it, expect } from 'vitest';
import {
  sanitizeFamilyName,
  sanitizeId,
  deriveWeight,
  deriveStyle,
  dataUrlMime,
  buildEmbeddedFontFace,
  buildUnicodeRange,
} from '../fontFaceBuilder';

describe('sanitizeFamilyName', () => {
  it('strips the subset prefix and unsafe characters', () => {
    expect(sanitizeFamilyName('ABCDEF+Playfair Display-Bold')).toBe('PlayfairDisplay-Bold');
    expect(sanitizeFamilyName('Helvetica')).toBe('Helvetica');
  });
  it('falls back to "Font" for an empty/garbage name', () => {
    expect(sanitizeFamilyName('+++')).toBe('Font');
    expect(sanitizeFamilyName('')).toBe('Font');
  });
});

describe('deriveWeight', () => {
  it('maps weight words, preferring the more specific match', () => {
    expect(deriveWeight('Helvetica')).toBe(400);
    expect(deriveWeight('Helvetica-Bold')).toBe(700);
    expect(deriveWeight('Roboto-Light')).toBe(300);
    expect(deriveWeight('Inter SemiBold')).toBe(600);   // not 700
    expect(deriveWeight('Montserrat-ExtraBold')).toBe(800); // not 700
    expect(deriveWeight('Archivo Black')).toBe(900);
    expect(deriveWeight('Foo', true)).toBe(700);        // pdf.js bold flag
  });
});

describe('deriveStyle', () => {
  it('detects italic from the name or the flag', () => {
    expect(deriveStyle('Helvetica-Oblique')).toBe('italic');
    expect(deriveStyle('Times-Italic')).toBe('italic');
    expect(deriveStyle('Times')).toBe('normal');
    expect(deriveStyle('Times', true)).toBe('italic');
  });
});

describe('dataUrlMime', () => {
  it('defaults to sfnt/otf and recognises woff/woff2/ttf', () => {
    expect(dataUrlMime(undefined)).toBe('font/otf');
    expect(dataUrlMime('font/opentype')).toBe('font/otf');
    expect(dataUrlMime('application/font-woff2')).toBe('font/woff2');
    expect(dataUrlMime('font/woff')).toBe('font/woff');
    expect(dataUrlMime('font/truetype')).toBe('font/ttf');
  });
});

describe('buildEmbeddedFontFace', () => {
  it('produces a unique family, data: src, and a matching face entry', () => {
    const r = buildEmbeddedFontFace({
      loadedName: 'g_d0_f1',
      postscriptName: 'ABCDEF+Helvetica-Bold',
      base64: 'AAAA',
      mimetype: 'font/opentype',
      bold: true,
    });
    expect(r.family).toBe('Helvetica-Bold-gd0f1');
    expect(r.weight).toBe(700);
    expect(r.style).toBe('normal');
    expect(r.face).toEqual({
      family: 'Helvetica-Bold-gd0f1',
      src: 'data:font/otf;base64,AAAA',
      weight: 700,
      style: 'normal',
      display: 'swap',
      source: 'embedded',
    });
  });

  it('keeps families distinct per loadedName even for the same base font', () => {
    const a = buildEmbeddedFontFace({ loadedName: 'g_d0_f1', postscriptName: 'Helvetica', base64: 'AA' });
    const b = buildEmbeddedFontFace({ loadedName: 'g_d0_f2', postscriptName: 'Helvetica', base64: 'BB' });
    expect(a.family).not.toBe(b.family);
  });

  it('emits a format hint cssTokens can detect for the data: src', () => {
    const r = buildEmbeddedFontFace({ loadedName: 'f1', base64: 'AA', mimetype: 'application/font-woff2' });
    expect(r.face.src.startsWith('data:font/woff2;base64,')).toBe(true);
  });

  it('prefixes a leading non-letter family so it stays a valid CSS identifier', () => {
    const r = buildEmbeddedFontFace({ loadedName: '123', postscriptName: '999', base64: 'AA' });
    expect(/^[A-Za-z]/.test(r.family)).toBe(true);
  });

  it('R2: carries sidecar coverage as a unicodeRange on the face', () => {
    const r = buildEmbeddedFontFace({
      loadedName: 'f1', base64: 'AA',
      coverageRanges: ['U+0041-005A', 'U+0061'],
    });
    expect(r.face.unicodeRange).toBe('U+0041-005A, U+0061');
  });

  it('R2: omits unicodeRange entirely when coverage is absent', () => {
    const r = buildEmbeddedFontFace({ loadedName: 'f1', base64: 'AA' });
    expect('unicodeRange' in r.face).toBe(false);
  });
});

describe('buildUnicodeRange (R2)', () => {
  it('joins valid segments', () => {
    expect(buildUnicodeRange(['U+0020-007E', 'U+00A0'])).toBe('U+0020-007E, U+00A0');
    expect(buildUnicodeRange(['u+41'])).toBe('u+41');   // lowercase + short hex are valid CSS
  });

  it('rejects the WHOLE list on any malformed segment — no partial trust', () => {
    expect(buildUnicodeRange(['U+0041-005A', 'garbage'])).toBeUndefined();
    expect(buildUnicodeRange(["U+41;}</style><script>"])).toBeUndefined();
    expect(buildUnicodeRange(['U+4??'])).toBeUndefined();  // wildcards: sidecar never emits them
    expect(buildUnicodeRange(['U+1234567'])).toBeUndefined();  // >6 hex digits
  });

  it('returns undefined for empty/absent input', () => {
    expect(buildUnicodeRange(undefined)).toBeUndefined();
    expect(buildUnicodeRange([])).toBeUndefined();
    expect(buildUnicodeRange('U+41' as never)).toBeUndefined();
  });
});
