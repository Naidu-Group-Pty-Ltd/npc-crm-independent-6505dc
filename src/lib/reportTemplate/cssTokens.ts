/**
 * Token → CSS variables compiler.
 *
 * Compiles `template.tokens.*` into a `:root { … }` block so HTML/CSS-rendered
 * templates (WeasyPrint preview + final PDF) reference them as:
 *   var(--color-primary), var(--font-heading), var(--space-gutter),
 *   var(--radius-md), var(--shadow-card), var(--gradient-hero), var(--text-base)
 *
 * Phase 1 extends the original 3 categories (colors/fonts/spacing) with
 * radii, shadows, gradients, and a numeric type-scale. All emit safely
 * even if absent.
 */
import type { Tokens } from './templateSchema';

function safeKey(k: string): string {
  return k.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Keep template-controlled custom-property values inside their declaration and
 * prevent PDF renderers from treating them as resource-bearing CSS. Backslash
 * escapes are rejected as well so forbidden syntax cannot be obfuscated.
 */
function safeTokenValue(value: unknown): string | null {
  const candidate = String(value);
  if (
    /[\\;{}<>\u0000-\u001f\u007f]/.test(candidate)
    || /(?:url|image-set|src)\s*\(/i.test(candidate)
    || /@import|(?:https?|file):|\/\//i.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function tokenCssDeclaration(prefix: string, key: string, value: unknown, suffix = ''): string | null {
  const safeValue = safeTokenValue(value);
  return safeValue === null ? null : `  --${prefix}-${safeKey(key)}: ${safeValue}${suffix};`;
}

function escapeCssString(value: unknown): string {
  return String(value).replace(/[\\'\n\r\f<>]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `);
}

function isRemoteFontUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isFontSource(value: string): boolean {
  return isRemoteFontUrl(value)
    || /^data:font\/(?:woff2?|ttf|otf|opentype);base64,[a-z0-9+/]+={0,2}$/i.test(value);
}

function safeFontWeight(value: unknown): string {
  const weight = String(value ?? 'normal');
  return /^(?:normal|bold|bolder|lighter|[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?$/.test(weight)
    ? weight
    : 'normal';
}

/**
 * R2 — validate a stored `unicodeRange` before emission. Format-checked rather
 * than escaped: a value that is not strictly `U+hex[-hex]` segments is dropped,
 * leaving the face unscoped (the pre-R2 behaviour), never emitted mangled.
 */
function safeUnicodeRange(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const segments = value.split(',').map((s) => s.trim());
  const ok = segments.length > 0
    && segments.every((s) => /^[Uu]\+[0-9A-Fa-f]{1,6}(-[0-9A-Fa-f]{1,6})?$/.test(s));
  return ok ? segments.join(', ') : null;
}

export function tokensToCssVariables(tokens: Tokens): string {
  const lines: string[] = [':root {'];
  const push = (prefix: string, values: Record<string, unknown>, suffix = '') => {
    for (const [key, value] of Object.entries(values || {})) {
      const declaration = tokenCssDeclaration(prefix, key, value, suffix);
      if (declaration) lines.push(declaration);
    }
  };
  push('color', tokens.colors);
  push('font', tokens.fonts);
  push('space', tokens.spacing, 'px');
  push('radius', tokens.radii, 'px');
  push('shadow', tokens.shadows);
  push('gradient', tokens.gradients);
  push('text', tokens.typeScale, 'pt');
  lines.push('}');
  return lines.join('\n');
}

export interface FontFaceCssOptions {
  /**
   * May this document reach the network for a font stylesheet?
   *
   * `true` (the default) is the browser preview, where a Google Fonts `@import`
   * is how a template names a webfont and has always worked.
   *
   * `false` is **every render bound for WeasyPrint**, and it is not an
   * optimisation. `render-template-pdf` runs `assertSafeRenderResources` over
   * the HTML before invoking the engine, and that gate admits only `data:`
   * payloads and this project's own storage objects — so a single `@import` of
   * a remote stylesheet fails the whole document, silently, before anything is
   * written to the render ledger. Every one of the 500 seeded masters carries
   * one. See `printFontPolicy.pure.ts`; the container is the font source for
   * print, and `substitutePrintTokenFonts` has already rewritten any family it
   * does not have.
   */
  remoteStylesheets?: boolean;
}

/**
 * Phase 5 — emit @import / @font-face declarations from tokens.fontFaces so
 * the renderer can use custom or Google Fonts without manual setup.
 */
export function tokensToFontFaceCss(tokens: Tokens, options: FontFaceCssOptions = {}): string {
  const faces = (tokens as any).fontFaces as Array<any> | undefined;
  if (!faces || !faces.length) return '';
  const allowRemote = options.remoteStylesheets !== false;
  const imports: string[] = [];
  const declarations: string[] = [];
  for (const f of faces) {
    if (f?.cssUrl) {
      const cssUrl = String(f.cssUrl);
      if (allowRemote && isRemoteFontUrl(cssUrl)) {
        imports.push(`@import url('${escapeCssString(cssUrl)}');`);
      }
      continue;
    }
    if (f?.src && f?.family) {
      // Match both file extensions (.woff2) and data: MIME types (data:font/woff2)
      // so embedded/captured fonts (R0, data: src) get the right format() hint.
      const src = String(f.src);
      if (!isFontSource(src)) continue;
      // Same boundary as the `@import` above, for the same reason: a `src`
      // pointing at another host is a network fetch, and the render gate
      // rejects the whole document rather than the one face. A `data:` src —
      // the captured/embedded fonts an import produces — travels with the
      // HTML and is admitted, so those still reach the printed page.
      if (!allowRemote && /^(?:https?:)?\/\//i.test(src)) continue;
      const fmt = /woff2/i.test(src) ? 'woff2'
        : /woff/i.test(src) ? 'woff'
        : /(otf|opentype)/i.test(src) ? 'opentype'
        : /(ttf|truetype)/i.test(src) ? 'truetype' : '';
      // R2 — a face carrying its cmap coverage is scoped to exactly those
      // codepoints; browsers and WeasyPrint fall per glyph to the rest of the
      // stack for anything else, so a subset never renders wrong glyphs.
      const unicodeRange = safeUnicodeRange(f.unicodeRange);
      declarations.push(`@font-face {
  font-family: '${escapeCssString(f.family)}';
  src: url('${escapeCssString(src)}')${fmt ? ` format('${fmt}')` : ''};
  font-weight: ${safeFontWeight(f.weight)};
  font-style: ${f.style ?? 'normal'};
  font-display: ${f.display ?? 'swap'};${unicodeRange ? `\n  unicode-range: ${unicodeRange};` : ''}
}`);
    }
  }
  return [imports.join('\n'), declarations.join('\n')].filter(Boolean).join('\n');
}
