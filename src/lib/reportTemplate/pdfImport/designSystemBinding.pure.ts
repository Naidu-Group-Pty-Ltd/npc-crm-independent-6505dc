/**
 * Bind an imported page to the design system measured from it — pure.
 *
 * WHAT AN IMPORT SHIPPED
 * ----------------------
 * Measured by running a Docling document through the real production path
 * (`mapDoclingToPagePlan` → `applyTemplateImportPlan` → `parseTemplate`):
 *
 *     tokens                { colors: {}, fonts: {}, spacing: {} }
 *     overlays with a colour token          0 of 5
 *     overlays with a font token            0 of 5
 *
 * Empty tokens, and every overlay carrying a literal `#251F18` and a literal
 * font stack. So an imported template is not a design — it is a photograph made
 * of absolutely-positioned boxes. Change the brand colour and nothing moves;
 * there is no way to restyle an import at all, and any token-driven block added
 * to an imported page uses defaults with no relationship to the document.
 *
 * The palette was never the hard part. `tokenDerivation.pure` already reads it
 * correctly — on the same document it returns `primary #251F18`, `bg #FFFFFF`,
 * `text #251F18`, `muted #7A7A7A`, `heading "Inter, Arial, sans-serif"`,
 * `body Helvetica`. It just ran only on the CDIR→template direction, which the
 * Docling import never takes, and nothing would have referenced the result.
 *
 * THE RULE THAT MAKES THIS SAFE
 * -----------------------------
 * **Bind only where the token's value is EXACTLY what the overlay measured.**
 *
 * That single constraint gives two properties at once:
 *
 *   - today's render is byte-identical, because every binding resolves back to
 *     the literal it replaced;
 *   - changing a token afterwards restyles exactly the elements that shared
 *     that value in the source, and nothing else.
 *
 * A binding that "improves" a colour by snapping it to a nearby token would
 * change a client's document during an import that claims to reproduce it. This
 * module never does that, and there is no tolerance parameter to make it.
 *
 * Roles (see `semanticRole.pure.ts`) only ever DISAMBIGUATE: when several token
 * keys hold the same value, the role decides which name the binding uses. They
 * never make a non-matching value bind.
 *
 * Pure and deterministic: no DOM, no fetch, no clock.
 */

import type { DerivedTokens } from './tokenDerivation';

export const DESIGN_SYSTEM_BINDING_VERSION = 'import-design-system-v1';

/** The token map a binding resolves against. Only these two groups can bind. */
export interface BindableTokens {
  colors?: Record<string, string> | null;
  fonts?: Record<string, string> | null;
}

/**
 * Preference order per role. First key whose value MATCHES wins; a role never
 * causes a binding that would not otherwise have happened.
 */
const COLOR_PREFERENCE: Readonly<Record<string, readonly string[]>> = {
  title: ['primary', 'text', 'muted', 'bg'],
  heading: ['primary', 'text', 'muted', 'bg'],
  caption: ['muted', 'text', 'primary', 'bg'],
  footnote: ['muted', 'text', 'primary', 'bg'],
  pageHeader: ['muted', 'text', 'primary', 'bg'],
  pageFooter: ['muted', 'text', 'primary', 'bg'],
};
const DEFAULT_COLOR_PREFERENCE: readonly string[] = ['text', 'primary', 'muted', 'bg'];
/** A large flat fill is nearly always the page ground; a stroke nearly always is not. */
const FILL_PREFERENCE: readonly string[] = ['bg', 'primary', 'muted', 'text'];
const STROKE_PREFERENCE: readonly string[] = ['primary', 'muted', 'text', 'bg'];

const HEADING_FONT_PREFERENCE: readonly string[] = ['heading', 'body'];
const BODY_FONT_PREFERENCE: readonly string[] = ['body', 'heading'];

/**
 * Canonical form for comparing two colours.
 *
 * `#abc` and `#AABBCC` are the same colour and must match. `#AABBCCDD` is NOT
 * the same as `#AABBCC` — it carries alpha, and binding it to an opaque token
 * would make the element opaque. Anything this cannot parse (a CSS name, a
 * gradient, an existing binding) returns null and never binds.
 */
export function canonicalColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.startsWith('token:') || raw.includes('{{')) return null;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const long = /^#([0-9a-f]{6})$/i.exec(raw);
  if (long) return `#${long[1]}`.toLowerCase();
  const withAlpha = /^#([0-9a-f]{8})$/i.exec(raw);
  if (withAlpha) return `#${withAlpha[1]}`.toLowerCase();
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i.exec(raw);
  if (rgb) {
    const hex = [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('');
    const alpha = rgb[4] === undefined ? '' : Math.round(Math.max(0, Math.min(1, Number(rgb[4]))) * 255)
      .toString(16).padStart(2, '0');
    return `#${hex}${alpha === 'ff' ? '' : alpha}`.toLowerCase();
  }
  return null;
}

/**
 * Canonical form for comparing two font declarations.
 *
 * A stack is compared as a whole: `"Segoe UI", Inter, sans-serif` and `Inter`
 * are different declarations even though they overlap, and substituting one for
 * the other changes which typeface renders. Quotes and spacing are noise.
 */
export function canonicalFont(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.startsWith('token:') || raw.includes('{{')) return null;
  return raw
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean)
    .join(',');
}

function matchKey(
  value: unknown,
  map: Record<string, string> | null | undefined,
  preference: readonly string[],
  canonical: (v: unknown) => string | null,
): string | null {
  const target = canonical(value);
  if (!target || !map) return null;
  // Preferred names first, then every remaining key in a stable order, so the
  // binding is deterministic regardless of object key order.
  const keys = [...preference, ...Object.keys(map).filter((k) => !preference.includes(k)).sort()];
  for (const key of keys) {
    if (canonical(map[key]) === target) return key;
  }
  return null;
}

/**
 * Read a binding back to the literal it stands for.
 *
 * Anything that MEASURES a template rather than rendering it needs this. CDIR is
 * a canonical document representation whose whole purpose is to be diffed
 * against a source, and `token:primary` in a layer's colour is not a colour — it
 * derives a palette of `token:heading` and compares nothing. Binding created
 * these references, so this module owns reading them.
 *
 * An unknown key returns the input unchanged rather than a fallback colour: a
 * silent black is indistinguishable from a real one downstream.
 */
export function resolveTokenLiteral(value: unknown, tokens: BindableTokens | null | undefined): unknown {
  if (typeof value !== 'string' || !value.startsWith('token:')) return value;
  const key = value.slice(6);
  return tokens?.colors?.[key] ?? tokens?.fonts?.[key] ?? value;
}

/** Structural shape of an overlay this binder reads and rewrites. */
export interface BindableOverlay {
  type?: unknown;
  color?: unknown;
  fill?: unknown;
  stroke?: unknown;
  fontFamily?: unknown;
  semantics?: { role?: unknown } | null;
  [key: string]: unknown;
}

export interface BindingCounts {
  color: number;
  fill: number;
  stroke: number;
  fontFamily: number;
  background: number;
}

export interface BindOverlayResult {
  overlay: BindableOverlay;
  changed: boolean;
  counts: BindingCounts;
}

function emptyCounts(): BindingCounts {
  return { color: 0, fill: 0, stroke: 0, fontFamily: 0, background: 0 };
}

function addCounts(into: BindingCounts, from: BindingCounts): void {
  into.color += from.color;
  into.fill += from.fill;
  into.stroke += from.stroke;
  into.fontFamily += from.fontFamily;
  into.background += from.background;
}

export function bindOverlayToTokens(
  overlay: BindableOverlay,
  tokens: BindableTokens,
): BindOverlayResult {
  const counts = emptyCounts();
  if (!overlay || typeof overlay !== 'object') return { overlay, changed: false, counts };
  const role = typeof overlay.semantics?.role === 'string' ? overlay.semantics.role : '';
  const colors = tokens.colors ?? null;
  const fonts = tokens.fonts ?? null;
  const patch: Record<string, string> = {};

  const colorKey = matchKey(
    overlay.color, colors, COLOR_PREFERENCE[role] ?? DEFAULT_COLOR_PREFERENCE, canonicalColor,
  );
  if (colorKey) { patch.color = `token:${colorKey}`; counts.color += 1; }

  const fillKey = matchKey(overlay.fill, colors, FILL_PREFERENCE, canonicalColor);
  if (fillKey) { patch.fill = `token:${fillKey}`; counts.fill += 1; }

  const strokeKey = matchKey(overlay.stroke, colors, STROKE_PREFERENCE, canonicalColor);
  if (strokeKey) { patch.stroke = `token:${strokeKey}`; counts.stroke += 1; }

  const fontKey = matchKey(
    overlay.fontFamily, fonts,
    role === 'title' || role === 'heading' ? HEADING_FONT_PREFERENCE : BODY_FONT_PREFERENCE,
    canonicalFont,
  );
  if (fontKey) { patch.fontFamily = `token:${fontKey}`; counts.fontFamily += 1; }

  const changed = Object.keys(patch).length > 0;
  return { overlay: changed ? { ...overlay, ...patch } : overlay, changed, counts };
}

/** Structural shape of a page this binder reads. */
export interface BindablePage {
  background?: { color?: unknown; [key: string]: unknown } | null;
  blocks?: ReadonlyArray<{ overlays?: readonly BindableOverlay[] | null; [key: string]: unknown } | null> | null;
  [key: string]: unknown;
}

export interface BindPagesResult<T> {
  pages: T[];
  changed: boolean;
  counts: BindingCounts;
  version: typeof DESIGN_SYSTEM_BINDING_VERSION;
}

/**
 * Rewrite every literal that exactly equals a token into a reference to it.
 *
 * Returns the SAME page objects when nothing bound, so a caller can tell that
 * an import gained no design system rather than re-persisting an identical
 * template.
 *
 * Vector overlays are deliberately untouched below their own `fill`/`stroke`:
 * their `paths[]` carry per-path fills, and rewriting those would need the
 * renderer to resolve tokens inside path data, which it does not. Stated here
 * rather than left as a silent gap — a page's backdrop vector therefore keeps a
 * literal, and changing `bg` does not repaint it.
 */
export function bindPagesToTokens<T extends BindablePage>(
  pages: readonly T[] | null | undefined,
  tokens: BindableTokens | null | undefined,
): BindPagesResult<T> {
  const counts = emptyCounts();
  const list = Array.isArray(pages) ? pages : [];
  if (!tokens || (!tokens.colors && !tokens.fonts)) {
    return { pages: [...list], changed: false, counts, version: DESIGN_SYSTEM_BINDING_VERSION };
  }

  let anyChanged = false;
  const bound = list.map((page) => {
    if (!page || typeof page !== 'object') return page;
    let pageChanged = false;

    const backgroundKey = matchKey(page.background?.color, tokens.colors ?? null, FILL_PREFERENCE, canonicalColor);
    const background = backgroundKey
      ? { ...(page.background ?? {}), color: `token:${backgroundKey}` }
      : page.background;
    if (backgroundKey) { counts.background += 1; pageChanged = true; }

    const blocks = (page.blocks ?? []).map((block) => {
      if (!block || !Array.isArray(block.overlays) || !block.overlays.length) return block;
      let blockChanged = false;
      const overlays = block.overlays.map((overlay) => {
        const result = bindOverlayToTokens(overlay, tokens);
        if (result.changed) { blockChanged = true; addCounts(counts, result.counts); }
        return result.overlay;
      });
      if (!blockChanged) return block;
      pageChanged = true;
      return { ...block, overlays };
    });

    if (!pageChanged) return page;
    anyChanged = true;
    return { ...page, ...(backgroundKey ? { background } : {}), blocks } as T;
  });

  return {
    pages: bound as T[],
    changed: anyChanged,
    counts,
    version: DESIGN_SYSTEM_BINDING_VERSION,
  };
}

/**
 * The tokens a binding will actually resolve against.
 *
 * An import into an EXISTING template must not restyle the pages already in it,
 * so the base template's tokens win every conflict and the derived ones only
 * fill names it does not have. Binding then happens against this merged map,
 * which is why pixel identity survives both cases: a derived `text #251F18`
 * against a base that already defines `text #000000` simply does not match the
 * overlay, and the literal stays.
 */
export function mergeImportTokens(
  derived: DerivedTokens | null | undefined,
  base: BindableTokens | null | undefined,
): { colors: Record<string, string>; fonts: Record<string, string> } {
  const colors: Record<string, string> = { ...(derived?.colors ?? {}) };
  const fonts: Record<string, string> = { ...(derived?.fonts ?? {}) };
  for (const [key, value] of Object.entries(base?.colors ?? {})) {
    if (typeof value === 'string' && value) colors[key] = value;
  }
  for (const [key, value] of Object.entries(base?.fonts ?? {})) {
    if (typeof value === 'string' && value) fonts[key] = value;
  }
  return { colors, fonts };
}
