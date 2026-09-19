/**
 * Pure embedded-font → `@font-face` entry builder for PDF reconstruction (R3).
 *
 * Docling-era PDF reconstructs each embedded font program into an sfnt (OpenType) byte
 * buffer. This module turns that buffer (already base64-encoded by the impure
 * caller) into a `tokens.fontFaces` entry with a `data:` URL, a CSS-safe unique
 * family name, and a derived weight/style — so imported text renders in the
 * SOURCE font instead of a Helvetica substitute.
 *
 * Each embedded program gets its OWN family (unique by Docling-era PDF `loadedName`),
 * carrying exactly one face, declared at its derived weight/style. The text
 * overlay is set to the same weight/style, so the browser matches the single
 * face exactly — no synthetic bold/italic, faithful glyphs.
 *
 * Pure + unit-tested. The impure Docling-era PDF object resolution / base64 lives in
 * `extractPdfViaDocling`.
 */

export interface FontFaceEntry {
  family: string;
  src: string;                       // data: URL
  weight: number;
  style: 'normal' | 'italic';
  display: 'swap';
  source: 'embedded';
  /**
   * R2: `unicode-range` value scoping this face to the codepoints its cmap
   * actually maps. With it, browsers and WeasyPrint use the embedded face only
   * for glyphs it truly has and fall per glyph to the stack fallback for the
   * rest — a partial subset can never claim codepoints it lacks.
   */
  unicodeRange?: string;
}

export interface EmbeddedFontInput {
  loadedName: string;                // Docling-era PDF loadedName (also the commonObjs key)
  postscriptName?: string;           // font.name, e.g. "ABCDEF+Helvetica-Bold"
  base64: string;                    // base64 of the font bytes
  mimetype?: string;                 // Docling-era PDF font.mimetype
  bold?: boolean;
  italic?: boolean;
  /** R2: sidecar-enumerated cmap coverage, e.g. ["U+0041-005A", "U+0061"]. */
  coverageRanges?: string[];
}

export interface EmbeddedFontResult {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  face: FontFaceEntry;
}

/** Strip a subset tag ("ABCDEF+") and reduce to a CSS-identifier-safe token. */
export function sanitizeFamilyName(name: string): string {
  const base = (name || '').replace(/^[A-Z]{6}\+/, '').trim().replace(/[^A-Za-z0-9-]+/g, '');
  return base || 'Font';
}

/** Reduce a Docling-era PDF loadedName to an alphanumeric uniqueness suffix. */
export function sanitizeId(loadedName: string): string {
  return (loadedName || '').replace(/[^A-Za-z0-9]+/g, '') || 'x';
}

/** Map a font/PostScript name (or Docling-era PDF bold flag) to a numeric weight. */
export function deriveWeight(name: string, boldFlag?: boolean): number {
  const n = (name || '').toLowerCase();
  if (/thin|hairline/.test(n)) return 100;
  if (/extralight|ultralight/.test(n)) return 200;
  if (/semibold|demibold|demi/.test(n)) return 600;   // before "light"/"bold"
  if (/extrabold|ultrabold/.test(n)) return 800;
  if (/black|heavy/.test(n)) return 900;
  if (/light/.test(n)) return 300;
  if (/medium/.test(n)) return 500;
  if (/bold/.test(n)) return 700;
  return boldFlag ? 700 : 400;
}

export function deriveStyle(name: string, italicFlag?: boolean): 'normal' | 'italic' {
  if (/italic|oblique/i.test(name || '')) return 'italic';
  return italicFlag ? 'italic' : 'normal';
}

/** Choose a font `data:` MIME from Docling-era PDF' mimetype (defaults to sfnt/otf). */
export function dataUrlMime(mimetype?: string): string {
  const m = (mimetype || '').toLowerCase();
  if (m.includes('woff2')) return 'font/woff2';
  if (m.includes('woff')) return 'font/woff';
  if (m.includes('truetype') || m.includes('ttf')) return 'font/ttf';
  return 'font/otf';
}

// A CSS unicode-range segment: U+XXXX or U+XXXX-XXXX (1-6 hex digits each).
// Wildcard segments (U+4??) are deliberately excluded — the sidecar never
// emits them, so one appearing means corrupt data, not a broader range.
const UNICODE_RANGE_SEGMENT = /^[Uu]\+[0-9A-Fa-f]{1,6}(-[0-9A-Fa-f]{1,6})?$/;

/**
 * Validate sidecar coverage segments into one CSS `unicode-range` value.
 * Any malformed segment invalidates the whole list — a partially-trusted
 * range would mis-scope the face — and the face is emitted unscoped, which
 * is the pre-R2 behaviour.
 */
export function buildUnicodeRange(coverageRanges?: string[]): string | undefined {
  if (!Array.isArray(coverageRanges) || coverageRanges.length === 0) return undefined;
  const segments = coverageRanges.map((s) => String(s ?? '').trim());
  if (!segments.every((s) => UNICODE_RANGE_SEGMENT.test(s))) return undefined;
  return segments.join(', ');
}

/** Build a self-hosted, embedded `@font-face` entry + the family/weight to use. */
export function buildEmbeddedFontFace(input: EmbeddedFontInput): EmbeddedFontResult {
  const psName = input.postscriptName || input.loadedName;
  let family = `${sanitizeFamilyName(psName)}-${sanitizeId(input.loadedName)}`;
  if (!/^[A-Za-z]/.test(family)) family = `F${family}`;  // CSS identifiers start with a letter
  const weight = deriveWeight(psName, input.bold);
  const style = deriveStyle(psName, input.italic);
  const src = `data:${dataUrlMime(input.mimetype)};base64,${input.base64}`;
  const unicodeRange = buildUnicodeRange(input.coverageRanges);
  const face: FontFaceEntry = { family, src, weight, style, display: 'swap', source: 'embedded' };
  if (unicodeRange) face.unicodeRange = unicodeRange;
  return { family, weight, style, face };
}
