/**
 * Shared helpers for the HTML block renderers.
 * Mirrors the jsPDF `_shared.ts` contract but emits HTML strings.
 */
import type { Block, Overlay } from '../templateSchema';
import {
  type ResolveContext,
  resolveBindable,
  resolveBindableColor,
  resolveBindableNumber,
  resolveTokenReference,
} from '../bindingResolver';
import { shouldRenderOverlay } from '../renderVisibility';
import { buildTextOverlayCssDecls } from '../rendering/textOverlayStyle.pure';
import { headingTagFor, type SemanticAnnotation } from '../pdfImport/semanticRole.pure';

export interface HtmlBlockContext extends ResolveContext {
  page: { width: number; height: number };
  pageIndex: number;
  pages?: Array<{ id: string; name: string; tocContinues?: boolean }>;
  slots?: Record<string, Block>;
}

export type HtmlBlockRenderer = (block: Block, ctx: HtmlBlockContext) => string;

/**
 * Late-bound lookup for the chart renderers, registered by `blocks/index.ts`.
 *
 * `charts.html.ts` imports this module, so this module cannot import it back.
 * Rather than duplicate chart drawing code to dodge the cycle — which would put
 * imported charts and authored charts on separate renderers that drift — the
 * chart overlay case resolves its renderer at call time from a registry that
 * `blocks/index.ts` populates, since that module already imports both sides.
 */
type ChartOverlayRendererLookup = (kind: string) => HtmlBlockRenderer | null;
let chartOverlayRendererLookup: ChartOverlayRendererLookup | null = null;

export function registerChartOverlayRenderers(lookup: ChartOverlayRendererLookup): void {
  chartOverlayRendererLookup = lookup;
}

function getChartOverlayRenderer(kind: string): HtmlBlockRenderer | null {
  return chartOverlayRendererLookup ? chartOverlayRendererLookup(kind) : null;
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolve a `*Font` block prop to a CSS `font-family` value.
 *
 * ## Why this returns a variable rather than the font name
 *
 * A `token:heading` prop could be resolved through `resolveBindable` and
 * emitted verbatim — and that would put a template-controlled string inside a
 * quoted style attribute, which is a new injection surface for a value that
 * already has a safe representation. `tokensToCssVariables` emits every font
 * token as `--font-<key>` and runs it through `safeTokenValue` first, so
 * pointing at the variable reuses that guarantee instead of re-earning it.
 *
 * A literal (`"Inter, sans-serif"`) is still accepted for templates that name a
 * face directly, but only through a conservative allow-list: letters, digits,
 * spaces, commas, hyphens, dots and quotes. Anything else — a semicolon, a
 * `url(`, a brace — drops the whole declaration rather than emitting a
 * sanitised guess at what the author meant.
 *
 * Returns `null` when the prop is absent, so callers keep whatever default
 * they had before this existed. That is what makes every `*Font` prop additive.
 */
/**
 * Every picture this renderer draws, with the alternative text it must carry.
 *
 * ## Why this is the only place an `<img>` is written
 *
 * The render routes ask WeasyPrint for `pdf_variant: 'pdf/ua-1'`, and PDF/UA-1
 * clause 7.3 requires every `/Figure` to carry `/Alt` or `/ActualText`. Nine
 * emitters across this tree wrote their own `<img>`; two of them passed
 * `alt=""` in the belief that an empty string marks a picture decorative, and
 * the other seven passed nothing.
 *
 * **Measured on WeasyPrint 69.0, the pinned engine, both are the same file.**
 * An `<img alt="">` and an `<img>` with no attribute at all produce a byte-
 * identical PDF (7,167 bytes each on a one-image probe), and in both the
 * figure is tagged `/Figure` with **no** `/Alt`. There is no "mark it
 * decorative" escape on this engine: the only conforming image is a described
 * one. veraPDF 1.30.2 confirms it — `7.3 test 1` failed twice on the 36-page
 * Templates render, once for the cover mark and once for the closing mark,
 * both of which were carrying `alt=""`.
 *
 * ## What the text may say
 *
 * `alt` describes what the picture IS, never what it shows. The renderer has
 * no way to see a photograph, and a description it invented would be the same
 * fabrication this programme's report rules forbid everywhere else. So a
 * caller passes the author's own `alt` where the template carries one, the
 * caption where the block already prints one, or a true statement of the
 * picture's role — "Naidu Property Consulting Services logo" for a brand mark.
 * `MISSING_ALT` is the last resort and is deliberately conspicuous rather than
 * plausible, because a picture nobody described is a gap, and a gap that reads
 * as a description is worse than one that reads as a gap.
 */
export const MISSING_ALT = 'Image — no description recorded';

export function imgTag(src: string, opts: { alt?: unknown; style: string; attrs?: string }): string {
  const alt = String(opts.alt ?? '').trim() || MISSING_ALT;
  const attrs = opts.attrs ? `${opts.attrs} ` : '';
  return `<img ${attrs}src="${esc(src)}" alt="${esc(alt)}" style="${opts.style}"/>`;
}

export function fontFamilyValue(value: unknown, fallback?: string): string | null {
  if (value == null || value === '') return fallback ?? null;
  const raw = String(value).trim();
  if (raw.startsWith('token:')) {
    const key = raw.slice(6).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!key) return fallback ?? null;
    return fallback ? `var(--font-${key}, ${fallback})` : `var(--font-${key})`;
  }
  if (!/^[a-zA-Z0-9\s,'"._-]+$/.test(raw)) return fallback ?? null;
  return raw;
}

/**
 * A `font-family:` declaration, or an empty string when there is no font to set.
 *
 * Blocks compose this into their inline styles so an unset prop emits nothing
 * at all and the element keeps inheriting, exactly as it did before.
 */
export function fontFamilyDecl(value: unknown, fallback?: string): string {
  const family = fontFamilyValue(value, fallback);
  return family ? `font-family:${family};` : '';
}

/**
 * A `letter-spacing:` declaration in em, clamped to a sane typographic range.
 *
 * The brand's signature is the wide uppercase eyebrow — `--tracking-eyebrow` is
 * 0.18em and the Private Banking cover goes to 0.34em — so tracking has to be
 * settable per element rather than baked at 0.18em in the renderer. Clamped
 * because a value outside this range is a mistake rather than a design, and an
 * unbounded one can push a label off the page.
 */
export function trackingDecl(value: unknown, fallback?: number): string {
  const n = value == null || value === '' ? fallback : Number(value);
  if (n == null || !Number.isFinite(n)) return '';
  return `letter-spacing:${Math.max(-0.1, Math.min(1, n))}em;`;
}

/** Render the absolute-positioning wrapper for blocks that use x/y/width/height. */
export function absBoxStyle(
  p: Record<string, unknown>,
  fallback: { x?: number; y?: number; w?: number; h?: number } = {},
  pageHeight?: number,
): string {
  const x = Number(p.x ?? fallback.x ?? 0);
  const y = Number(p.y ?? fallback.y ?? 0);
  const w = p.width != null ? `width:${Number(p.width)}pt;` : fallback.w != null ? `width:${fallback.w}pt;` : '';
  const h = p.height != null ? `height:${Number(p.height)}pt;` : fallback.h != null ? `height:${fallback.h}pt;` : '';
  /**
   * Pin the block's BOTTOM to a y coordinate and let it grow upward.
   *
   * Every block here is `top`-anchored, which is right for anything that flows:
   * `flow()` stacks the next block at `y + height`, so a block growing downward
   * is what the arithmetic describes. It is wrong for a block whose height the
   * data decides and whose *baseline* is the fixed thing — a cover title above
   * a rule.
   *
   * That title reserved two lines (`coverTitle * 1.12 * 2`) and grew down into
   * whatever followed. Addresses run to 84 characters in production, which at
   * Private Banking's 41pt display over a 414pt measure is four lines and at
   * Swiss Minimal's 52pt is six — so the third line printed over the gold rule
   * and the fourth over the standfirst beneath it. Reserving for the longest
   * address instead would leave the median 19-character one floating a hundred
   * points above its own rule.
   *
   * Anchored at the bottom, a one-line title sits on the rule and a four-line
   * one grows up into the empty half of the cover. The overflow cannot happen
   * rather than being budgeted for, which is the only version of this that
   * stays true when somebody buys a longer street.
   */
  if (p.anchorBottom != null && Number.isFinite(Number(p.anchorBottom)) && pageHeight != null) {
    const bottom = Math.max(0, pageHeight - Number(p.anchorBottom));
    return `position:absolute;left:${x}pt;bottom:${bottom}pt;${w}${h}`;
  }
  return `position:absolute;left:${x}pt;top:${y}pt;${w}${h}`;
}

/** Compose font-feature-settings from individual options. */
function buildFontFeatures(o: any): string {
  const explicit = String(o.fontFeatureSettings ?? '').trim();
  if (explicit) return explicit;
  const parts: string[] = [];
  if (o.ligatures && o.ligatures !== 'none') {
    if (o.ligatures === 'common' || o.ligatures === 'all') parts.push(`"liga" 1`, `"clig" 1`);
    if (o.ligatures === 'discretionary' || o.ligatures === 'all') parts.push(`"dlig" 1`);
    if (o.ligatures === 'historical' || o.ligatures === 'all') parts.push(`"hlig" 1`);
    if (o.ligatures === 'contextual' || o.ligatures === 'all') parts.push(`"calt" 1`);
  } else if (o.ligatures === 'none') {
    parts.push(`"liga" 0`, `"clig" 0`, `"dlig" 0`);
  }
  return parts.join(', ');
}

/** Resolve a paragraph style (with `basedOn` inheritance, max depth 4). */
function resolveParagraphStyle(ctx: ResolveContext, ref?: string): Record<string, any> {
  if (!ref) return {};
  const tokens: any = (ctx as any).tokens ?? {};
  const styles: Record<string, any> = tokens.paragraphStyles ?? {};
  const seen = new Set<string>();
  const acc: Record<string, any> = {};
  let cur: any = styles[ref];
  let depth = 0;
  while (cur && depth < 4 && !seen.has(cur.id ?? '')) {
    seen.add(cur.id ?? '');
    for (const [k, v] of Object.entries(cur)) {
      if (acc[k] === undefined && v !== undefined && k !== 'id' && k !== 'name' && k !== 'basedOn') acc[k] = v;
    }
    cur = cur.basedOn ? styles[cur.basedOn] : null;
    depth += 1;
  }
  return acc;
}

function fmtCell(value: any, format?: string): string {
  if (value == null) return '';
  switch (format) {
    case 'currency': {
      const n = Number(value); if (!Number.isFinite(n)) return String(value);
      return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
    }
    case 'number': { const n = Number(value); return Number.isFinite(n) ? new Intl.NumberFormat('en-AU').format(n) : String(value); }
    // Magnitude, not sign — see the note on `formatCell` in `_data.ts`. This
    // spelling is the same heuristic inverted, and it had the same defect:
    // -2.9 is `<= 1`, so a negative return printed a hundred times too large.
    case 'percent': { const n = Number(value); return Number.isFinite(n) ? `${(n * (Math.abs(n) <= 1 ? 100 : 1)).toFixed(1)}%` : String(value); }
    case 'date': {
      const d = new Date(value); return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-AU');
    }
    default: return String(value);
  }
}

/**
 * Compose CSS for overlay-level effects (shadow / filter / blend / outline).
 *
 * Every value that reaches the output is either coerced through `Number` or
 * passed through `esc` here, so the returned string is already safe to embed in
 * a quoted style attribute. It must not be escaped again by the caller: doing so
 * turned an encoded quote into `&amp;quot;`, which renders as literal text
 * instead of closing nothing, and made the encoding untestable.
 */
function buildEffectStyle(o: any): string {
  const e = o?.effects;
  if (!e) return '';
  const parts: string[] = [];
  const filters: string[] = [];
  if (e.blur != null && Number(e.blur) > 0) filters.push(`blur(${Number(e.blur)}px)`);
  if (e.brightness != null && Number(e.brightness) !== 1) filters.push(`brightness(${Number(e.brightness)})`);
  if (e.contrast != null && Number(e.contrast) !== 1) filters.push(`contrast(${Number(e.contrast)})`);
  if (e.saturate != null && Number(e.saturate) !== 1) filters.push(`saturate(${Number(e.saturate)})`);
  if (e.grayscale != null && Number(e.grayscale) > 0) filters.push(`grayscale(${Number(e.grayscale)})`);
  if (filters.length) parts.push(`filter:${filters.join(' ')}`);
  if (e.shadow) {
    const s = e.shadow;
    const inset = s.inset ? 'inset ' : '';
    parts.push(`box-shadow:${inset}${Number(s.x ?? 0)}pt ${Number(s.y ?? 2)}pt ${Number(s.blur ?? 8)}pt ${Number(s.spread ?? 0)}pt ${esc(s.color ?? 'rgba(0,0,0,0.25)')}`);
  }
  if (e.blendMode && e.blendMode !== 'normal') parts.push(`mix-blend-mode:${esc(e.blendMode)}`);
  if (e.outline && Number(e.outline.width ?? 0) > 0) {
    parts.push(`outline:${Number(e.outline.width)}pt ${esc(e.outline.style ?? 'solid')} ${esc(e.outline.color ?? '#BF9B50')}`);
    parts.push(`outline-offset:${Number(e.outline.offset ?? 0)}pt`);
  }
  return parts.length ? parts.join(';') + ';' : '';
}


function cascadeAttrs(node: { anchors?: any[]; id?: string }, ctx: ResolveContext): string {
  const anchors = Array.isArray(node?.anchors) ? node.anchors : [];
  if (!anchors.length) return '';
  const primary = anchors[0] ?? {};
  const enabled = Boolean((ctx as any)._cascadeMetadata || (ctx as any)._cascadeDebug || (ctx as any)._editorMode);
  if (!enabled) return '';
  return [
    `data-cascade-anchor-id="${esc(primary.id || '')}"`,
    primary.kind ? `data-cascade-kind="${esc(primary.kind)}"` : '',
    primary.sectionId ? `data-cascade-section-id="${esc(primary.sectionId)}"` : '',
    primary.fieldPath ? `data-cascade-field-path="${esc(primary.fieldPath)}"` : '',
    primary.bindingPath ? `data-cascade-binding-path="${esc(primary.bindingPath)}"` : '',
    primary.qaStatus ? `data-cascade-qa-status="${esc(primary.qaStatus)}"` : '',
    primary.qaOwner ? `data-cascade-qa-owner="${esc(primary.qaOwner)}"` : '',
    `data-cascade-anchor-count="${anchors.length}"`,
  ].filter(Boolean).join(' ');
}

function cascadeDebugBadge(node: { anchors?: any[] }, ctx: ResolveContext): string {
  if (!(ctx as any)._cascadeDebug) return '';
  const anchors = Array.isArray(node?.anchors) ? node.anchors : [];
  if (!anchors.length) return '';
  const label = anchors[0]?.label || anchors[0]?.fieldPath || anchors[0]?.sectionId || anchors[0]?.id || 'cascade anchor';
  return `<span style="position:absolute;left:0;top:-12pt;z-index:999999;background:#0f172a;color:#f8fafc;border:0.5pt solid #fbbf24;border-radius:3pt;padding:1pt 3pt;font:7pt ui-monospace,monospace;line-height:1;white-space:nowrap;max-width:220pt;overflow:hidden;text-overflow:ellipsis;">§ ${esc(label)}</span>`;
}

function withCascadeWrapper(html: string, node: { anchors?: any[]; id?: string }, ctx: ResolveContext): string {
  const attrs = cascadeAttrs(node, ctx);
  const badge = cascadeDebugBadge(node, ctx);
  if (!attrs && !badge) return html;
  return `<span ${attrs} style="display:contents">${badge}${html}</span>`;
}

/** Render an overlay (text / image / shape / textOnPath / table) as an absolute-positioned HTML element. */
export function renderOverlay(overlay: Overlay, ctx: ResolveContext): string {
  const html = renderOverlayContent(overlay, ctx);
  if (!html) return '';
  // R3 + W0 — stamp the overlay id on the rendered root. The editorial canvas
  // uses it to mirror live drag geometry straight onto the iframe DOM (no
  // srcDoc rebuild per pointermove), and the V2 DOM-evidence walker queries
  // exactly this selector ([data-overlay-id]) — until now nothing emitted it.
  // Non-visual: WeasyPrint ignores data attributes.
  const id = String((overlay as { id?: unknown }).id ?? '');
  if (!id) return html;
  return html.replace(/^<([a-zA-Z][a-zA-Z0-9-]*)/, `<$1 data-overlay-id="${esc(id)}"`);
}

function renderOverlayContent(overlay: Overlay, ctx: ResolveContext): string {
  if (!shouldRenderOverlay(overlay, ctx)) return '';
  // Effects originate in saved template JSON and are embedded in quoted style
  // attributes below. buildEffectStyle encodes each value as it composes them,
  // so a CSS value cannot terminate the attribute and inject HTML.
  const fx = buildEffectStyle(overlay as any);
  const z = Number.isFinite(Number((overlay as any).zIndex)) ? `z-index:${Number((overlay as any).zIndex)};` : '';
  const opacity = Number.isFinite(Number(overlay.opacity)) ? Number(overlay.opacity) : 1;
  const rotation = Number.isFinite(Number(overlay.rotation)) ? Number(overlay.rotation) : 0;
  const base = `position:absolute;left:${overlay.x}pt;top:${overlay.y}pt;width:${overlay.width}pt;height:${overlay.height}pt;opacity:${opacity};transform:rotate(${rotation}deg);transform-origin:top left;${z}${fx}`;
  switch (overlay.type) {
    case 'text': {
      const raw = overlay as any;
      const ps = resolveParagraphStyle(ctx, raw.styleRef);
      // Overlay-level wins on conflict; paragraph style fills the gap.
      const o: any = { ...ps, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== null && v !== '')) };
      // Always restore base fields the editor sets even when ps had a value
      for (const k of ['type','id','x','y','width','height','rotation','opacity','content']) o[k] = raw[k];
      // Rich markup is template-authored, but resolved report values are not.
      // Escape substitutions before inserting them into the trusted markup so
      // bound data cannot introduce active HTML or renderer fetches.
      const text = resolveBindable(o.content, ctx, o.rich ? esc : undefined);
      if (!text && !o.rich && !(Array.isArray(o.runs) && o.runs.length)) return '';
      const size = resolveBindableNumber(o.fontSize, ctx, 12);
      const color = resolveBindableColor(o.color, ctx, '#000000');
      const family = resolveTokenReference(o.fontFamily, ctx) || 'Helvetica';
      const pt = Number(o.paddingTop ?? 0);
      const pr = Number(o.paddingRight ?? 0);
      const pb = Number(o.paddingBottom ?? 0);
      const pl = Number(o.paddingLeft ?? 0);
      const features = buildFontFeatures(o);
      // Shared with the editor canvas — see rendering/textOverlayStyle.pure.ts.
      // The two surfaces used to build this list independently and disagreed on
      // white-space, overflow, numeric weight, vertical align and padding.
      const decls = buildTextOverlayCssDecls({
        fontFamily: family,
        fontSizePt: Number(size),
        color,
        fontWeightNumeric: o.fontWeightNumeric,
        fontWeight: o.fontWeight,
        fontStyle: o.fontStyle,
        align: o.align,
        lineHeight: o.lineHeight,
        letterSpacingPt: o.letterSpacing,
        paddingPt: { top: pt, right: pr, bottom: pb, left: pl },
        verticalAlign: o.verticalAlign,
        whiteSpace: o.whiteSpace,
        textDecoration: o.textDecoration,
        textTransform: o.textTransform,
        textShadow: o.textShadow,
        hyphens: o.hyphens,
        columns: o.columns,
        columnGapPt: o.columnGap,
        kerning: o.kerning,
        fontVariantNumeric: o.fontVariantNumeric,
        fontFeatureSettings: features || null,
        fontVariationSettings: o.fontVariationSettings,
        maxLines: o.maxLines,
        overflowPolicy: o.overflowPolicy,
      }, { unit: 'pt', escapeFamily: esc });
      const style = `${base}${decls.join(';')};`;
      // Drop cap — render the first non-whitespace character as a floated span.
      const dc = o.dropCap;
      const renderWithDropCap = (s: string): string => {
        if (!dc?.enabled) return esc(s).replace(/\n/g, '<br/>');
        const match = /^(\s*)(\S)([\s\S]*)$/.exec(s);
        if (!match) return esc(s).replace(/\n/g, '<br/>');
        const lines = Math.max(2, Math.min(8, Number(dc.lines ?? 3)));
        const dcSize = Number(size) * lines * 0.95;
        const dcColor = dc.color ? resolveBindableColor(dc.color, ctx, color) : color;
        const dcFamily = dc.fontFamily ? esc(dc.fontFamily) : esc(family);
        const dcWeight = dc.fontWeight ?? 'bold';
        const dcMr = Number(dc.marginRight ?? 6);
        const dcStyle = `float:left;font-size:${dcSize}pt;line-height:${lines * 0.95};font-family:${dcFamily};font-weight:${dcWeight};color:${dcColor};padding-right:${dcMr}pt;margin-top:-2pt;`;
        return `${esc(match[1])}<span style="${dcStyle}">${esc(match[2])}</span>${esc(match[3]).replace(/\n/g,'<br/>')}`;
      };
      let inner: string;
      if (Array.isArray(o.runs) && o.runs.length) {
        // R0 — rich-text runs: per-span colour/font/weight captured from a source.
        inner = o.runs.map((run: any) => {
          const rc = run.color ? resolveBindableColor(run.color, ctx, color) : color;
          const rf = run.fontFamily ? (resolveTokenReference(run.fontFamily, ctx) || run.fontFamily) : '';
          const rdecls = [
            rf ? `font-family:${esc(rf)}` : '',
            run.fontSize != null ? `font-size:${run.fontSize}pt` : '',
            run.fontWeight != null ? `font-weight:${run.fontWeight}` : '',
            run.fontStyle ? `font-style:${run.fontStyle}` : '',
            `color:${rc}`,
            run.letterSpacing != null ? `letter-spacing:${run.letterSpacing}pt` : '',
          ].filter(Boolean).join(';');
          return `<span style="${rdecls}">${esc(String(run.text ?? '')).replace(/\n/g, '<br/>')}</span>`;
        }).join('');
      } else if (o.rich) {
        // Literal rich markup remains available; bound values were escaped at
        // resolution time above.
        inner = String(text ?? '');
      } else {
        const paras = String(text).split(/\n{2,}/);
        if (paras.length > 1 || o.paragraphIndent || o.paragraphSpacing) {
          const gap = Number(o.paragraphSpacing ?? 0);
          const indent = Number(o.paragraphIndent ?? 0);
          inner = paras.map((p, i) => {
            const mt = i === 0 ? 0 : gap;
            const body = i === 0 ? renderWithDropCap(p) : esc(p).replace(/\n/g,'<br/>');
            return `<p style="margin:${mt}pt 0 0 0;text-indent:${indent}pt;">${body}</p>`;
          }).join('');
        } else {
          inner = renderWithDropCap(String(text));
        }
      }
      // A heading is emitted as a heading. WeasyPrint builds the tagged PDF's
      // structure tree from the ELEMENT NAME, so a `<div>` tags as `/Div` and an
      // `<h2>` tags as `/H2` — measured, and the only reason an imported page
      // rendered at `pdf/ua-1` had a flat structure tree with no headings in it.
      //
      // Purely a tag change. The inline declarations already set every property
      // the UA stylesheet would otherwise apply to h1–h6 (font-size always,
      // font-weight always — see textOverlayStyle.pure.ts) EXCEPT margin, and an
      // absolutely-positioned box with a margin does move. Hence the reset.
      //
      // Never when the body was split into paragraphs: `<p>` inside a heading is
      // invalid, and a parser recovering from it would close the heading early
      // and leave the rest of the copy outside the structure element.
      const headingTag = headingTagFor((o as { semantics?: SemanticAnnotation }).semantics);
      const tag = headingTag && !inner.includes('<p') ? headingTag : 'div';
      const reset = tag === 'div' ? '' : 'margin:0;';
      // The span is not decoration. Vertical alignment makes this box a flex
      // container, and WeasyPrint emits a structure element for the anonymous
      // flex item it then has to create — which inherits the tag and yields a
      // heading nested inside an identical heading. Giving the flex container a
      // real child costs nothing (verified pixel-identical at 300 DPI) and
      // produces one `/H2` over a `/Span` instead of `/H2` over `/H2`.
      const body = tag === 'div' ? inner : `<span>${inner}</span>`;
      return withCascadeWrapper(`<${tag} style="${style}${reset}">${body}</${tag}>`, overlay as any, ctx);
    }
    case 'image': {
      const src = resolveBindable(overlay.src, ctx);
      if (!src) return '';
      const fit = overlay.fit === 'fill' ? 'fill' : overlay.fit;
      // Alternative text. WeasyPrint writes it straight into the tagged PDF as
      // the figure's `/Alt`, and a `/Figure` without one is a hard PDF/UA
      // failure — which every imported picture was, while the source's own
      // description sat unused in the Layers-panel name.
      const alt = typeof (overlay as { alt?: unknown }).alt === 'string'
        ? (overlay as { alt?: string }).alt!.trim()
        : '';
      // Conditionally emitting the attribute leaves an undescribed overlay as a
      // `/Figure` with no `/Alt`, which is the same PDF/UA failure as writing
      // none — so this goes through `imgTag` like every other picture.
      return withCascadeWrapper(
        imgTag(src, { alt, style: `${base}object-fit:${fit};` }),
        overlay as any,
        ctx,
      );
    }
    case 'shape': {
      // Gradient fills (captured from PDF shading ops / DOM computed styles)
      // pass through verbatim — resolveBindableColor would reject them.
      const isGradientFill = typeof overlay.fill === 'string' && /(?:linear|radial|conic)-gradient\(/i.test(overlay.fill);
      const fill = isGradientFill
        ? String(overlay.fill)
        : overlay.fill ? resolveBindableColor(overlay.fill, ctx, 'transparent') : 'transparent';
      const stroke = overlay.stroke ? resolveBindableColor(overlay.stroke, ctx, 'transparent') : 'transparent';
      const sw = overlay.strokeWidth || 0;
      const radius = overlay.shape === 'ellipse' ? '50%' : `${overlay.borderRadius || 0}pt`;
      if (overlay.shape === 'line') {
        return withCascadeWrapper(`<div style="${base}border-top:${sw}pt solid ${stroke};"></div>`, overlay as any, ctx);
      }
      return withCascadeWrapper(`<div style="${base}background:${esc(fill)};border:${sw}pt solid ${stroke};border-radius:${radius};"></div>`, overlay as any, ctx);
    }
    case 'chart': {
      // W3 — a reconstructed chart, rendered by DELEGATING to the eleven
      // data-bound chart renderers that already exist as blocks. They take
      // `(block, ctx)` and read `block.props`, and `readSeries` falls back to
      // `props.data` with `label`/`value` keys — exactly the shape a chart
      // overlay carries — so no chart drawing code is duplicated here.
      //
      // Rendering the SAME function the block path uses is the point: an
      // imported chart and an authored chart are the same pixels, and a fix to
      // either reaches both.
      const o: any = overlay;
      const renderer = getChartOverlayRenderer(String(o.chartKind ?? 'bar'));
      if (!renderer) return '';
      const synthetic = {
        id: overlay.id,
        type: `chart-${o.chartKind ?? 'bar'}`,
        props: {
          // Inline series from the source document. `dataPath` wins when
          // present, for a chart someone has since rebound to report data.
          data: Array.isArray(o.series) ? o.series : [],
          ...(o.dataPath ? { dataPath: o.dataPath } : {}),
          ...(o.labelKey ? { labelKey: o.labelKey } : {}),
          ...(o.valueKey ? { valueKey: o.valueKey } : {}),
          ...(o.title ? { title: o.title } : {}),
          ...(o.caption ? { caption: o.caption } : {}),
          ...(o.accent ? { accent: o.accent } : {}),
          ...(o.palette ? { palette: o.palette } : {}),
          ...(o.orientation ? { orientation: o.orientation } : {}),
          x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height,
        },
      } as unknown as Block;
      const svg = renderer(synthetic, ctx as HtmlBlockContext);
      // The block renderers position themselves absolutely from props.x/y, so
      // the overlay wrapper carries only transform/opacity/effects — width and
      // height are already expressed inside.
      return withCascadeWrapper(
        `<div style="position:absolute;left:0;top:0;opacity:${opacity};transform:rotate(${rotation}deg);transform-origin:top left;${z}${fx}">${svg}</div>`,
        overlay as any,
        ctx,
      );
    }
    case 'vector': {
      // R0 — editable vector geometry (icons/logos captured as SVG paths).
      const o: any = overlay;
      const paths = Array.isArray(o.paths) ? o.paths : [];
      const inner = paths.map((p: any) => {
        const pFill = p.fill ? resolveBindableColor(p.fill, ctx, 'none') : 'none';
        const pStroke = p.stroke ? resolveBindableColor(p.stroke, ctx, 'none') : 'none';
        const attrs = [
          `d="${esc(String(p.d ?? ''))}"`,
          `fill="${pFill}"`,
          `stroke="${pStroke}"`,
          p.strokeWidth != null ? `stroke-width="${p.strokeWidth}"` : '',
          p.fillRule ? `fill-rule="${p.fillRule}"` : '',
          // Phase 6E — stroke styling (dashed rules, rounded caps/joins).
          p.strokeDasharray ? `stroke-dasharray="${esc(String(p.strokeDasharray))}"` : '',
          p.strokeLinecap ? `stroke-linecap="${esc(String(p.strokeLinecap))}"` : '',
          p.strokeLinejoin ? `stroke-linejoin="${esc(String(p.strokeLinejoin))}"` : '',
          p.opacity != null ? `opacity="${p.opacity}"` : '',
        ].filter(Boolean).join(' ');
        return `<path ${attrs}/>`;
      }).join('');
      const par = esc(String(o.preserveAspectRatio ?? 'xMidYMid meet'));
      return withCascadeWrapper(`<svg viewBox="${esc(String(o.viewBox ?? '0 0 100 100'))}" preserveAspectRatio="${par}" style="${base}">${inner}</svg>`, overlay as any, ctx);
    }
    case 'textOnPath': {
      const o: any = overlay;
      const text = resolveBindable(o.content, ctx);
      if (!text) return '';
      const size = resolveBindableNumber(o.fontSize, ctx, 18);
      const color = resolveBindableColor(o.color, ctx, '#000000');
      const family = resolveTokenReference(o.fontFamily, ctx) || 'Helvetica';
      const w = overlay.width, h = overlay.height;
      const curvature = Math.max(-1, Math.min(1, Number(o.curvature ?? 0.5)));
      let d = '';
      switch (o.curve) {
        case 'circle': {
          const r = Math.min(w, h) / 2 - 1;
          const cx = w / 2, cy = h / 2;
          // Closed circle path (sweep clockwise)
          d = `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
          break;
        }
        case 'wave': {
          const amp = (h / 4) * Math.abs(curvature || 0.5) * (curvature < 0 ? -1 : 1);
          d = `M 0 ${h / 2} Q ${w / 4} ${h / 2 - amp} ${w / 2} ${h / 2} T ${w} ${h / 2}`;
          break;
        }
        case 'arc-down': {
          const sag = (h * Math.abs(curvature)) || h * 0.5;
          d = `M 0 ${h / 2 - sag / 2} Q ${w / 2} ${h / 2 + sag} ${w} ${h / 2 - sag / 2}`;
          break;
        }
        case 'arc-up':
        default: {
          const sag = (h * Math.abs(curvature)) || h * 0.5;
          d = `M 0 ${h / 2 + sag / 2} Q ${w / 2} ${h / 2 - sag} ${w} ${h / 2 + sag / 2}`;
          break;
        }
      }
      const pathId = `txp-${overlay.id}`;
      const offset = Math.max(0, Math.min(100, Number(o.startOffset ?? 0)));
      const escapedPathId = esc(pathId);
      return withCascadeWrapper(`<svg xmlns="http://www.w3.org/2000/svg" style="${esc(`${base}overflow:visible;`)}" viewBox="0 0 ${w} ${h}" width="${w}pt" height="${h}pt"><defs><path id="${escapedPathId}" d="${esc(d)}" fill="none"/></defs><text fill="${esc(color)}" font-family="${esc(family)}" font-size="${size}" font-weight="${esc(o.fontWeight ?? 'normal')}" letter-spacing="${esc(o.letterSpacing ?? 0)}"><textPath href="#${escapedPathId}" startOffset="${offset}%">${esc(text)}</textPath></text></svg>`, overlay as any, ctx);
    }
    case 'table': {
      const o: any = overlay;
      const cols: Array<any> = Array.isArray(o.columns) ? o.columns : [];
      // Resolve data binding → array of objects, otherwise fall back to static rows.
      let rows: Array<Record<string, any>> = [];
      if (o.data) {
        const arr = String(o.data).split('.').reduce((acc: any, k: string) => acc?.[k.trim()], ctx.data);
        if (Array.isArray(arr)) {
          rows = arr.map((r: any) => (r && typeof r === 'object' ? r : { value: r }));
        }
      } else if (Array.isArray(o.rows)) {
        rows = o.rows.map((r: any[]) => Object.fromEntries(cols.map((c, i) => [c.key || `col${i}`, r?.[i] ?? ''])));
      }
      if (o.maxRows) rows = rows.slice(0, o.maxRows);
      const family = o.fontFamily ? resolveTokenReference(o.fontFamily, ctx) || 'Helvetica' : 'inherit';
      const headerBg = o.headerBg ? resolveBindableColor(o.headerBg, ctx, '#111') : '#111';
      const headerColor = o.headerColor ? resolveBindableColor(o.headerColor, ctx, '#fff') : '#fff';
      const rowBg = o.rowBg ? resolveBindableColor(o.rowBg, ctx, 'transparent') : 'transparent';
      const altRowBg = o.altRowBg ? resolveBindableColor(o.altRowBg, ctx, '') : '';
      const rowColor = o.rowColor ? resolveBindableColor(o.rowColor, ctx, '#111') : '#111';
      const borderColor = o.borderColor ? resolveBindableColor(o.borderColor, ctx, '#ddd') : '#ddd';
      const bw = Number(o.borderWidth ?? 0.5);
      const cp = Number(o.cellPadding ?? 6);
      const cellStyles: Array<any> = Array.isArray(o.cellStyles) ? o.cellStyles : [];
      const styleFor = (row: number, col: number) =>
        cellStyles.find((s) => Number(s.row) === row && Number(s.col) === col) ?? {};
      // Phase 17 — conditional cell rules: first-match wins per cell, optional row scope.
      const cellRules: Array<any> = Array.isArray(o.cellRules) ? o.cellRules : [];
      const matchRule = (row: Record<string, any>, colKey: string): any | null => {
        for (const r of cellRules) {
          if (r.scope !== 'row' && r.column !== colKey) continue;
          const v: any = row?.[r.column];
          const target = r.value;
          let hit = false;
          switch (r.op) {
            case 'empty': hit = v == null || v === ''; break;
            case 'nonempty': hit = v != null && v !== ''; break;
            case 'contains': hit = String(v ?? '').toLowerCase().includes(String(target ?? '').toLowerCase()); break;
            case '==': hit = String(v) === String(target); break;
            case '!=': hit = String(v) !== String(target); break;
            default: {
              const a = Number(v); const b = Number(target);
              if (!Number.isFinite(a) || !Number.isFinite(b)) break;
              if (r.op === '>') hit = a > b;
              if (r.op === '>=') hit = a >= b;
              if (r.op === '<') hit = a < b;
              if (r.op === '<=') hit = a <= b;
            }
          }
          if (hit) return r;
        }
        return null;
      };
      const iconGlyph = (k?: string) =>
        k === 'up' ? '▲' : k === 'down' ? '▼' : k === 'flag' ? '⚑' : k === 'star' ? '★' : k === 'dot' ? '●' : '';
      const colGroup = cols.map((c) => c.width != null ? `<col style="width:${Number(c.width)}pt"/>` : `<col/>`).join('');
      const spans: Array<any> = Array.isArray(o.cellSpans) ? o.cellSpans : [];
      const spanFor = (row: number, col: number) => spans.find((s) => Number(s.row) === row && Number(s.col) === col);
      const covered = new Set<string>();
      const markCovered = (row: number, col: number, rowSpan: number, colSpan: number) => {
        for (let r = row; r < row + rowSpan; r++) {
          for (let c = col; c < col + colSpan; c++) {
            if (r !== row || c !== col) covered.add(`${r}:${c}`);
          }
        }
      };
      const spanAttrs = (row: number, col: number) => {
        const span = spanFor(row, col);
        if (!span) return '';
        const rowSpan = Math.max(1, Number(span.rowSpan ?? 1));
        const colSpan = Math.max(1, Number(span.colSpan ?? 1));
        markCovered(row, col, rowSpan, colSpan);
        return `${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''}${colSpan > 1 ? ` colspan="${colSpan}"` : ''}`;
      };
      const headerCells = cols.map((c, i) => {
        if (covered.has(`-1:${i}`)) return '';
        const s = styleFor(-1, i);
        const align = s.align ?? c.align ?? 'left';
        const bg = s.bg ?? headerBg;
        const fg = s.color ?? headerColor;
        const fw = s.fontWeight ?? o.headerFontWeight ?? 'bold';
        const style = `padding:${cp}pt;text-align:${align};background:${bg};color:${fg};font-weight:${fw};border:${bw}pt solid ${borderColor};height:${Number(o.headerHeight ?? 22)}pt`;
        return `<th${spanAttrs(-1, i)} style="${esc(style)}">${esc(c.label ?? c.key)}</th>`;
      }).join('');
      const bodyRows = rows.map((r, ri) => {
        const baseRowBg = altRowBg && ri % 2 === 1 ? altRowBg : rowBg;
        // Pre-scan for row-scope rule
        const rowRule = cellRules.find((rl) => rl.scope === 'row' && matchRule(r, rl.column) === rl);
        const tds = cols.map((c, ci) => {
          if (covered.has(`${ri}:${ci}`)) return '';
          const s = styleFor(ri, ci);
          const cellRule = matchRule(r, c.key);
          const applied = rowRule ?? cellRule;
          const align = s.align ?? c.align ?? 'left';
          const bg = applied?.bg != null && s.bg == null
            ? resolveBindableColor(applied.bg, ctx, baseRowBg)
            : s.bg ?? baseRowBg;
          const fg = applied?.color != null && s.color == null
            ? resolveBindableColor(applied.color, ctx, rowColor)
            : s.color ?? rowColor;
          const fw = s.fontWeight ?? (applied?.fontWeight) ?? 'normal';
          let raw: any = r[c.key];
          if (typeof raw === 'string') raw = resolveBindable(raw, ctx);
          const val = fmtCell(raw, c.format);
          const icon = cellRule?.icon && cellRule.icon !== 'none' ? `<span style="margin-right:4pt;opacity:0.85">${iconGlyph(cellRule.icon)}</span>` : '';
          const style = `padding:${cp}pt;text-align:${align};background:${bg};color:${fg};font-weight:${fw};border:${bw}pt solid ${borderColor};height:${Number(o.rowHeight ?? 20)}pt`;
          return `<td${spanAttrs(ri, ci)} style="${esc(style)}">${icon}${esc(val)}</td>`;
        }).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      const tableStyle = `width:100%;border-collapse:collapse;font-family:${family};font-size:${Number(o.fontSize ?? 10)}pt;table-layout:fixed;`;
      return withCascadeWrapper(`<div style="${esc(`${base}overflow:hidden;`)}"><table style="${esc(tableStyle)}">${colGroup ? `<colgroup>${colGroup}</colgroup>` : ''}${o.showHeader !== false ? `<thead><tr>${headerCells}</tr></thead>` : ''}<tbody>${bodyRows}</tbody></table></div>`, overlay as any, ctx);
    }
  }
  return '';
}
