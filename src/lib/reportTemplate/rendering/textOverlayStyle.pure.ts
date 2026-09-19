/**
 * The single source of truth for how a text overlay is styled.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * There were two independent implementations of "style a text overlay", and
 * they disagreed on almost everything that matters:
 *
 * | property           | export (`blocks/_shared.html.ts`) | editor canvas (`EditorialCanvas`) |
 * |--------------------|-----------------------------------|-----------------------------------|
 * | `white-space`      | honours `overlay.whiteSpace`      | hardcoded `pre-wrap`              |
 * | `overflow`         | only under `maxLines`             | hardcoded `hidden`                |
 * | numeric weight     | `fontWeightNumeric ?? fontWeight` | `fontWeight === 'bold' ? 700 : 400` |
 * | vertical align     | flex `justify-content`            | ignored                           |
 * | padding            | applied                           | forced to 0                       |
 *
 * The PDF importer deliberately sets `whiteSpace: 'nowrap'` on single-line text
 * because substituted fonts run wider than the original. The canvas discarded
 * that, wrapped the line, and then clipped the wrapped remainder with its
 * hardcoded `overflow: hidden` — which is the "text boxes are constricting
 * their contents" defect users reported. The export path did not clip, so it
 * spilled instead. Same overlay, two different wrong answers.
 *
 * Fixing the canvas in place would have fixed this instance. Sharing the
 * declaration builder makes the class of bug unrepresentable: both renderers
 * now derive every declaration from the same function, and a property added
 * here reaches both or neither.
 *
 * Pure: no DOM, no `ctx`, no binding resolution. Callers resolve bindables and
 * tokens first and hand in primitives, because the two call sites resolve them
 * very differently (full `ResolveContext` in export, a token map in the canvas).
 */

/** Length unit for emitted declarations. */
export type TextStyleUnit = 'pt' | 'px';

/**
 * What to do when text does not fit its box.
 *
 * `visible` (the default) matches the export renderer's long-standing
 * behaviour: the text spills and collides with whatever is below. `clip` cuts
 * it off. Neither is *good* — a box that cannot hold its text is a defect
 * either way — but they must at least be the SAME in both renderers, which is
 * what lets the quality gate detect the condition instead of the two surfaces
 * disagreeing about whether there is a problem.
 */
export type TextOverflowPolicy = 'visible' | 'clip';

export interface ResolvedTextStyle {
  /** Already token-resolved family stack. */
  fontFamily: string;
  /** Already bindable-resolved size, in points. */
  fontSizePt: number;
  /** Already resolved CSS colour. */
  color: string;
  /**
   * Real numeric weight (300, 600, ...). Preferred over `fontWeight` — a source
   * Light 300 rendered at 400 and a SemiBold 600 rendered at 700 are both
   * WIDER than the source, which pushes text out of a fixed box.
   */
  fontWeightNumeric?: number | null;
  fontWeight?: 'normal' | 'bold' | null;
  fontStyle?: string | null;
  align?: string | null;
  lineHeight?: number | null;
  letterSpacingPt?: number | null;
  paddingPt?: { top?: number; right?: number; bottom?: number; left?: number } | null;
  verticalAlign?: 'top' | 'middle' | 'bottom' | null;
  whiteSpace?: string | null;
  textDecoration?: string | null;
  textTransform?: string | null;
  textShadow?: string | null;
  hyphens?: string | null;
  columns?: number | null;
  columnGapPt?: number | null;
  kerning?: boolean | null;
  fontVariantNumeric?: string | null;
  /** Pre-composed `font-feature-settings` value, when the caller built one. */
  fontFeatureSettings?: string | null;
  fontVariationSettings?: string | null;
  maxLines?: number | null;
  overflowPolicy?: TextOverflowPolicy | null;
}

export interface TextStyleEmitOptions {
  unit: TextStyleUnit;
  /**
   * Multiplier applied to every length. The canvas passes its zoom so overlay
   * geometry and text scale together; the export passes nothing (1).
   */
  scale?: number;
  /**
   * Escape hook for the family string. Export escapes for HTML attributes; the
   * canvas builds a React style object and must NOT escape.
   */
  escapeFamily?: (value: string) => string;
}

function len(value: number, opts: TextStyleEmitOptions): string {
  const scaled = value * (opts.scale ?? 1);
  // Trim float noise: 12.000000000000002pt in a style attribute helps nobody.
  const rounded = Math.round(scaled * 1000) / 1000;
  return `${rounded}${opts.unit}`;
}

/** Resolve the CSS `justify-content` that implements vertical alignment. */
export function verticalAlignToJustify(value: ResolvedTextStyle['verticalAlign']): string {
  if (value === 'middle') return 'center';
  if (value === 'bottom') return 'flex-end';
  return 'flex-start';
}

/**
 * Build the ordered CSS declarations for a text overlay.
 *
 * Returns `prop:value` strings without a trailing semicolon, so the export can
 * `join(';')` into a style attribute and the canvas can convert to a React
 * style object. Order is stable — golden-render diffs stay readable.
 */
export function buildTextOverlayCssDecls(
  style: ResolvedTextStyle,
  opts: TextStyleEmitOptions,
): string[] {
  const escapeFamily = opts.escapeFamily ?? ((v: string) => v);
  const pad = style.paddingPt ?? {};
  const padTop = Number(pad.top ?? 0);
  const padRight = Number(pad.right ?? 0);
  const padBottom = Number(pad.bottom ?? 0);
  const padLeft = Number(pad.left ?? 0);

  const decls: string[] = [
    `color:${style.color}`,
    `font-family:${escapeFamily(style.fontFamily)}`,
    `font-size:${len(style.fontSizePt, opts)}`,
    `font-weight:${style.fontWeightNumeric ?? style.fontWeight ?? 'normal'}`,
    `font-style:${style.fontStyle ?? 'normal'}`,
    `text-align:${style.align ?? 'left'}`,
    `line-height:${style.lineHeight ?? 1.3}`,
    `letter-spacing:${len(Number(style.letterSpacingPt ?? 0), opts)}`,
    `padding:${len(padTop, opts)} ${len(padRight, opts)} ${len(padBottom, opts)} ${len(padLeft, opts)}`,
    `display:flex`,
    `flex-direction:column`,
    `justify-content:${verticalAlignToJustify(style.verticalAlign)}`,
  ];

  if (style.textDecoration) decls.push(`text-decoration:${style.textDecoration}`);
  if (style.textTransform === 'small-caps') decls.push('font-variant-caps:small-caps');
  else if (style.textTransform) decls.push(`text-transform:${style.textTransform}`);
  if (style.textShadow) decls.push(`text-shadow:${style.textShadow}`);

  // The importer sets `nowrap` on single-line source text on purpose: a
  // substituted font runs wider, and a wrapped second line collides with the
  // block below. Honouring it is the point.
  if (style.whiteSpace) decls.push(`white-space:${style.whiteSpace}`);

  if (style.hyphens) decls.push(`hyphens:${style.hyphens}`, `-webkit-hyphens:${style.hyphens}`);
  if (style.columns && style.columns > 1) {
    decls.push(`columns:${style.columns}`);
    if (style.columnGapPt != null) decls.push(`column-gap:${len(Number(style.columnGapPt), opts)}`);
  }
  if (style.kerning === false) decls.push('font-kerning:none');
  else if (style.kerning === true) decls.push('font-kerning:normal');
  if (style.fontVariantNumeric && style.fontVariantNumeric !== 'normal') {
    decls.push(`font-variant-numeric:${style.fontVariantNumeric}`);
  }
  if (style.fontFeatureSettings) decls.push(`font-feature-settings:${style.fontFeatureSettings}`);
  if (style.fontVariationSettings) decls.push(`font-variation-settings:${style.fontVariationSettings}`);

  // `maxLines` implies its own clamp-and-clip and wins over the policy, because
  // "show at most N lines" is meaningless without cutting the rest off.
  if (style.maxLines && !style.columns) {
    decls.push(
      'display:-webkit-box',
      `-webkit-line-clamp:${style.maxLines}`,
      '-webkit-box-orient:vertical',
      'overflow:hidden',
    );
  } else if (style.overflowPolicy === 'clip') {
    decls.push('overflow:hidden');
  }

  return decls;
}

/** Convert declarations to a React inline-style object for the canvas. */
export function cssDeclsToReactStyle(decls: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of decls) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    // `-webkit-line-clamp` → `WebkitLineClamp`; `font-size` → `fontSize`.
    const camel = prop.startsWith('-webkit-')
      ? `Webkit${prop.slice(8).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/^([a-z])/, (_, c: string) => c.toUpperCase())}`
      : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = value;
  }
  return out;
}
