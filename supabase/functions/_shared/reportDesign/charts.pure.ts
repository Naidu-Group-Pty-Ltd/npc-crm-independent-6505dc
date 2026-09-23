/**
 * Server-side SVG charts.
 *
 * ## Reuse, not rebuild
 *
 * `render-investment-report-pdf/index.ts` already carried fifteen chart
 * renderers and two sparklines, written for Deno and deliberately local so a
 * render makes no network calls. They are good drawings. This is that work
 * promoted into the design system rather than replaced — the geometry is
 * ported faithfully, so a migrated report draws the same shapes.
 *
 * Three things changed, and each was a defect:
 *
 *  1. **Eleven more hardcoded colours.** `VIZ_GOLD #D4A843`, `VIZ_NAVY
 *     #0A2540`, `VIZ_GOOD #4F7A33`, `VIZ_RISK #A8401C` and seven others were a
 *     twelfth palette in this codebase, unreachable from any tenant and
 *     unaudited for contrast. Every one is now a role. The semantic three are
 *     Category B, so a tenant cannot make risk green in a chart either.
 *  2. **Chart text was too small to read in print.** Sizes were set in viewBox
 *     units, which say nothing about the printed size. A 9.5-unit label in a
 *     760-unit viewBox printed across a 174mm measure is **6.2pt** — below the
 *     product's own micro floor. Sizes here are declared in points and
 *     converted, so what the code says is what the reader gets.
 *  3. **A fixed gradient id.** Two gauges on one page both defined
 *     `id="gauge-fill"`; the second reference resolved to the first definition.
 *     Ids are now derived from the chart's own content.
 *
 * Pure: sibling `.pure` imports only, no I/O, no clock, no randomness — so the
 * same data draws the same bytes, which is what makes a golden PDF meaningful.
 */
import { contrastRatio, hexToRgb01, mixHex } from './color.pure.ts';
import type { ResolvedReportPalette } from './roles.pure.ts';
import { CONTRAST_FLOOR, PRINT_SCALE } from './tokens.pure.ts';
import { PRINT_STACK } from './typography.pure.ts';
import { contentWidthMm, spanWidthMm, type GridSpan } from './page.pure.ts';

// ── Geometry and the size problem ───────────────────────────────────────────

/**
 * viewBox widths. A chart is drawn once at these units and scaled to the
 * measure; the units are arbitrary, which is exactly why the type sizes below
 * cannot be.
 */
export const CHART_WIDTH = {
  /** Full measure — waterfall, marimekko, bars, timeline. */
  wide: 760,
  /** Two-thirds — quadrant. */
  standard: 560,
  /** Half measure or a sidebar — gauge, wheel, donut, micro-map. */
  compact: 460,
  /** A bullet row. */
  bullet: 520,
  /** Flows inside a line of text. */
  inline: 64,
  /** A margin note. */
  margin: 180,
} as const;

/** The measure a chart is printed across, unless the caller says otherwise. */
export const CHART_TARGET_WIDTH_MM = contentWidthMm('body');

const MM_PER_PT = 25.4 / 72;

/**
 * Points → viewBox units, for a chart printed across `widthMm`.
 *
 * The whole reason this module declares type in points. A number written
 * directly into `font-size` is a unit of the drawing, not of the page, and the
 * relationship between the two is the scale factor — which differs per chart.
 */
export function ptToUnits(
  pt: number,
  viewBoxWidth: number,
  widthMm: number = CHART_TARGET_WIDTH_MM,
): number {
  const unitsPerMm = viewBoxWidth / widthMm;
  return Math.round(pt * MM_PER_PT * unitsPerMm * 100) / 100;
}

/** viewBox units → printed points. The inverse, for the contrast/size checks. */
export function unitsToPt(
  units: number,
  viewBoxWidth: number,
  widthMm: number = CHART_TARGET_WIDTH_MM,
): number {
  const unitsPerMm = viewBoxWidth / widthMm;
  return Math.round((units / unitsPerMm / MM_PER_PT) * 100) / 100;
}

/**
 * Chart type sizes, in points.
 *
 * Anchored to `PRINT_SCALE` so a chart label and a table caption are the same
 * size on the page — which is the thing that makes a chart look like part of
 * the document rather than an import.
 */
export const CHART_TEXT_PT = {
  /** Axis ticks, cell values, neighbour names. The floor. */
  micro: PRINT_SCALE.micro,
  /** Series labels, legends, quadrant names. */
  caption: PRINT_SCALE.caption,
  /** Row labels and figures inside a chart. */
  label: PRINT_SCALE.body,
  /** The number a chart exists to show. */
  value: PRINT_SCALE.h3,
  /** Chart titles. */
  title: PRINT_SCALE.bodyLg,
  /** A gauge's or donut's centred figure. */
  hero: PRINT_SCALE.h2,
} as const;

// ── Palette ─────────────────────────────────────────────────────────────────

/**
 * The colours a chart may use.
 *
 * A projection of `ResolvedReportPalette`, so charts cannot reach a colour the
 * contrast audit has not seen. `series` is the categorical ramp for donuts and
 * marimekkos: brand first, then ink and semantics — deliberately *not* six
 * arbitrary hues, because a printed report is often photocopied and a
 * hue-encoded chart does not survive that.
 */
export interface ChartPalette {
  ground: string;
  groundAlt: string;
  rule: string;
  ink: string;
  inkMuted: string;
  accent: string;
  accentDeep: string;
  positive: string;
  caution: string;
  negative: string;
  informative: string;
  series: readonly string[];
}

export function chartPalette(p: ResolvedReportPalette): ChartPalette {
  return {
    ground: p.paperBright,
    groundAlt: p.paperAlt,
    rule: p.rule,
    ink: p.bodyInk,
    inkMuted: p.mutedInk,
    accent: p.accentFill,
    /** For strokes and small type on the ground — the contrast-corrected brand. */
    accentDeep: p.accentOnPaper,
    positive: p.positive,
    caution: p.caution,
    negative: p.negative,
    informative: p.informative,
    // Ordered by how far apart they read in greyscale, not by hue.
    series: [p.accentFill, p.bodyInk, p.accentOnPaper, p.mutedInk, p.informative, p.rule],
  };
}

/** Everything a renderer needs besides its data. */
export interface ChartContext {
  palette: ChartPalette;
  /** Printed width, for the point conversion. Defaults to the body measure. */
  widthMm: number;
}

export function chartContext(
  palette: ResolvedReportPalette,
  widthMm: number = CHART_TARGET_WIDTH_MM,
): ChartContext {
  return { palette: chartPalette(palette), widthMm };
}

/**
 * A context for a chart placed in a grid column.
 *
 * The reason this exists: a chart built for the full measure and dropped into a
 * 38% column prints every label at 38% of the size the code asked for. The
 * first render of a charted page showed exactly that — a waterfall whose axis
 * labels were about 4pt. Sizing is the caller's decision, so the caller is
 * given a way to state it that is shorter than getting it wrong.
 */
export function chartContextForSpan(
  palette: ResolvedReportPalette,
  span: GridSpan,
): ChartContext {
  return { palette: chartPalette(palette), widthMm: spanWidthMm(span) };
}

// ── Guards ──────────────────────────────────────────────────────────────────
//
// Report content is model-generated and, on the shared-report path,
// attacker-influenced. These caps keep the render cost of a shortcode bounded;
// they are carried over from the original module unchanged, because the reason
// for each is still true.

export const MAX_WATERFALL_ITEMS = 50;
export const MAX_HEATMAP_ROWS = 50;
export const MAX_HEATMAP_COLS = 50;
export const MAX_HEATMAP_CELLS = 400;
export const MAX_WHEEL_SCORES = 24;
export const MAX_PICTOGRAPH_UNITS = 100;
/** Beyond six the fan's legend outruns the plot and the lines stop separating. */
export const MAX_FAN_SERIES = 6;

// ── Primitives ──────────────────────────────────────────────────────────────

/** XML text escape. Attributes here are always double-quoted. */
export function svgEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `#RRGGBB` + alpha → `rgba()`, for tints inside a drawing. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb01(hex);
  const to255 = (v: number) => Math.round(v * 255);
  return `rgba(${to255(r)},${to255(g)},${to255(b)},${Math.min(1, Math.max(0, alpha)).toFixed(2)})`;
}

/**
 * A document-unique id derived from the chart's own content.
 *
 * `<defs>` ids are global to the document. The original module hardcoded
 * `id="gauge-fill"`, so a second gauge on the same page redefined it and both
 * references resolved to whichever the parser saw first. Deterministic, because
 * a random id would make every render of the same data a different file.
 */
export function stableId(prefix: string, ...parts: unknown[]): string {
  const input = parts.map((p) => String(p)).join('|');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${prefix}-${hash.toString(36)}`;
}

/**
 * Collapse whitespace inside an SVG.
 *
 * Not cosmetic: report bodies pass through `marked`, and an indented line in
 * the middle of inline SVG is parsed as a code block — which leaks raw markup
 * into the document.
 */
export function minifySvg(svg: string): string {
  return String(svg)
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n+/g, '')
    .trim();
}

export type AxisMode = 'money' | 'percent' | 'plain';

/** Compact axis labels — `$1.2m`, `4.5%`, `12k`. */
export function formatAxisValue(value: number, mode: AxisMode): string {
  if (mode === 'percent') return `${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;
  if (mode === 'money') {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
    if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
    return `$${value.toFixed(0)}`;
  }
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(0)}k` : value.toFixed(0);
}

/**
 * Base64, UTF-8 safe, in both runtimes these modules run in.
 *
 * `btoa` takes a latin1 string, and a chart label contains an em dash, a
 * non-breaking space or a currency symbol often enough that passing the SVG
 * straight in throws. Encoding to bytes first is the portable fix — no
 * `Buffer`, which the Edge Function runtime does not have.
 */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Wrap a chart into a print-ready figure.
 *
 * ## Why the chart is an `img` and not inline SVG
 *
 * It was inline, and every chart in every format was **invisible to a screen
 * reader**. WeasyPrint renders inline `<svg>` as drawing operators under a
 * `/NonStruct` node: there is no `/Figure` in the structure tree, so there is
 * nothing to attach alternative text to and nothing for assistive technology
 * to announce. `aria-label` on the `<svg>` does nothing. A `<title>` child
 * does nothing. Both were tried against the pinned engine.
 *
 * The part that makes this worth stating plainly: **the document still passes
 * PDF/UA**. veraPDF cannot require alt text for a figure that is not in the
 * tree, so a report full of unreachable charts validates clean. That is the
 * shape of a hollow conformance claim, and it is why the check that matters
 * here is not the validator.
 *
 * `<img src="data:image/svg+xml;base64,…" alt="…">` is the one form the engine
 * tags as `/Figure` with `/Alt`. Base64 rather than percent-encoded because
 * `renderResourcePolicy.pure.ts` skips exactly the base64 payload — a
 * percent-encoded SVG stays under the URL scan, where its own markup can trip
 * the scheme-relative check.
 *
 * ## The alt text
 *
 * The caption when there is one, an explicit `alt` when the caption is absent
 * or would not describe the drawing. A figure with neither is emitted inline
 * and untagged rather than as a `/Figure` with an empty `/Alt`: an untagged
 * drawing is merely silent, while a figure that declares itself described and
 * is not fails PDF/UA — and lies.
 */
/**
 * How wide the figure prints, as a share of the measure.
 *
 * `full` is the default and what every caller before this one wanted. `compact`
 * exists because a chart drawn at `CHART_WIDTH.compact` — a gauge, a donut, a
 * score wheel — is 460 units wide and up to 360 tall, and stretching that to
 * the full 174mm measure prints a single number 136mm high. Nine of those in a
 * chapter is nine sheets to say nine things.
 *
 * The fraction is the ratio the charts were drawn at: 460 of 760. A caller
 * choosing `compact` **must** also narrow its `ChartContext.widthMm` by the
 * same fraction, or every label inside the drawing is set at the wrong point
 * size — `chartContextForSpan` exists for the same reason.
 */
export type ChartFigureWidth = 'full' | 'compact';

/** `CHART_WIDTH.compact / CHART_WIDTH.wide`. */
export const COMPACT_FIGURE_FRACTION = CHART_WIDTH.compact / CHART_WIDTH.wide;

export function chartFigure(
  svg: string,
  caption = '',
  alt = '',
  width: ChartFigureWidth = 'full',
): string {
  if (!svg) return '';
  const described = (alt || caption).trim();
  const figcaption = caption ? `<figcaption>${svgEscape(caption)}</figcaption>` : '';
  const body = described
    ? `<img class="chart-img" src="data:image/svg+xml;base64,${base64Utf8(minifySvg(svg))}"`
      + ` alt="${svgEscape(described)}">`
    : minifySvg(svg);
  const cls = width === 'compact' ? 'chart-figure chart-compact' : 'chart-figure';
  return `<figure class="${cls}">${body}${figcaption}</figure>`;
}

/** Shared `<text>` builder — every label in this module routes through it. */
function text(
  ctx: ChartContext,
  vb: number,
  opts: {
    x: number; y: number; pt: keyof typeof CHART_TEXT_PT; fill: string;
    anchor?: 'start' | 'middle' | 'end';
    stack?: keyof typeof PRINT_STACK;
    weight?: number; tracking?: number; tabular?: boolean; transform?: string;
  },
  content: string,
): string {
  const size = ptToUnits(CHART_TEXT_PT[opts.pt], vb, ctx.widthMm);
  const attrs = [
    `x="${opts.x.toFixed(1)}"`,
    `y="${opts.y.toFixed(1)}"`,
    opts.anchor ? `text-anchor="${opts.anchor}"` : '',
    `font-family="${PRINT_STACK[opts.stack ?? 'body']}"`,
    `font-size="${size}"`,
    opts.weight ? `font-weight="${opts.weight}"` : '',
    opts.tracking ? `letter-spacing="${ptToUnits(opts.tracking, vb, ctx.widthMm)}"` : '',
    `fill="${opts.fill}"`,
    opts.tabular ? 'style="font-variant-numeric:lining-nums tabular-nums;"' : '',
    opts.transform ? `transform="${opts.transform}"` : '',
  ].filter(Boolean).join(' ');
  return `<text ${attrs}>${content}</text>`;
}

/**
 * Break a label into at most `maxLines` lines that fit `maxUnits`, by word.
 *
 * There is no text measurement in a pure module, so the width of a line is
 * estimated from an average advance (`unitsPerChar`), the same way
 * `renderBars` sizes its label column. What does not fit the last line is
 * cut with an ellipsis rather than allowed to run: a caption printed past
 * the viewBox is clipped mid-word by the viewer, which is what "… TOWNSHIP
 * WITH PRACTICAL GROW" was on every gauge of the reference renders (RS-3,
 * 14 Sep 2026), and a legend label printed into its own value is what
 * "Professionals & small households" did to "20%".
 */
/**
 * Break a label into the pieces a line may end on.
 *
 * Whitespace is the obvious one and used to be the only one, and that is why
 * page 9 of the Cowra Compass printed `Agriculture-dominat…` in a tile: a
 * hyphenated compound is ONE whitespace token, so it never wrapped and the
 * truncation at the end of this function cut it mid-word.
 *
 * A hyphen between two letters is a break point every typesetter uses, and
 * the hyphen stays on the first line where it is already written. A hyphen
 * with a digit on either side is not: breaking `2025-26` or `3-5y` across
 * two lines turns one range into two numbers, and a reader has no way to see
 * that it was ever one.
 *
 * The slash in `Land/Building` is the same case and breaks the same way.
 */
export function breakPoints(label: string): string[] {
  const out: string[] = [];
  for (const word of String(label ?? '').trim().split(/\s+/).filter(Boolean)) {
    // Split AFTER a hyphen or slash that sits between two letters, keeping the
    // mark with the piece before it.
    const pieces = word.split(/(?<=[A-Za-z][-/])(?=[A-Za-z])/);
    for (const piece of pieces) if (piece) out.push(piece);
  }
  return out;
}

export function fitLines(label: string, maxUnits: number, unitsPerChar: number, maxLines = 2): string[] {
  const perLine = Math.max(4, Math.floor(maxUnits / Math.max(0.1, unitsPerChar)));
  const words = breakPoints(label);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = '';
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i];
    // A piece that follows a hyphen or a slash joins the one before it with no
    // space — `Agriculture-` + `dominated` is one word broken, not two words.
    const joiner = /[-/]$/.test(line) ? '' : ' ';
    const candidate = line ? `${line}${joiner}${word}` : word;
    if (candidate.length <= perLine || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines) {
    lines.push(line);
  } else {
    // Room ran out with words left over: the last line says so.
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, Math.max(1, perLine - 1)).trimEnd()}…`;
  }
  return lines.map((l) => (l.length > perLine ? `${l.slice(0, Math.max(1, perLine - 1)).trimEnd()}…` : l));
}

/** Estimated horizontal advance of one character at a text size, in viewBox units. */
function unitsPerChar(ctx: ChartContext, vb: number, pt: keyof typeof CHART_TEXT_PT, uppercase = false): number {
  return ptToUnits(CHART_TEXT_PT[pt], vb, ctx.widthMm) * (uppercase ? 0.72 : 0.55);
}

const svgOpen = (w: number, h: number, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" `
  + `preserveAspectRatio="xMidYMid meet"${extra ? ` ${extra}` : ''}>`;

// ── Charts ──────────────────────────────────────────────────────────────────

/** Half-circle gauge — a single score against a maximum. */
export function renderGauge(
  ctx: ChartContext,
  value: number,
  opts: { max?: number; label?: string; caption?: string } = {},
): string {
  const max = opts.max ?? 100;
  const v = Math.max(0, Math.min(max, Number(value) || 0));
  const pct = max > 0 ? v / max : 0;
  // The arc is pushed down by whatever furniture sits above it.
  //
  // These were fixed at `cy = 180, h = 260` with the label at y=42 and the
  // caption at y=62, which put both *inside* the arc: its crown is at `cy - r`,
  // which was 50. A render of a gauge carrying both showed "OUT OF 100" struck
  // through by the track. Every caller before this one passed a label alone or
  // nothing, so the collision only appeared when a caller finally used the
  // parameter the signature had always offered.
  const w = CHART_WIDTH.compact;
  // The caption is set in at most two lines across the drawing, never past
  // its edge; the arc moves down by whatever the caption takes.
  const captionLines = opts.caption
    ? fitLines(opts.caption.toUpperCase(), w - 32, unitsPerChar(ctx, w, 'micro', true) + ptToUnits(0.9, w, ctx.widthMm), 2)
    : [];
  const top = 18 + (opts.label ? 22 : 0) + captionLines.length * 18;
  const cx = w / 2, r = 130;
  const cy = top + r + 10;
  const h = cy + 80;
  const polarX = (a: number) => cx + r * Math.cos(a);
  const polarY = (a: number) => cy + r * Math.sin(a);
  const endA = Math.PI + Math.PI * pct;
  // Always 0. The value arc sweeps `pct` of a half circle, so it is never more
  // than 180 degrees and the large-arc flag is never set. The original set it
  // whenever `pct > 0.5`, which drew the arc the long way round — visible in a
  // render as two disconnected segments at the ends of the track.
  const largeArc = 0;
  const gradId = stableId('gauge', v, max, opts.label ?? '');

  const trackPath = `M ${polarX(Math.PI).toFixed(1)} ${polarY(Math.PI).toFixed(1)} `
    + `A ${r} ${r} 0 1 1 ${polarX(2 * Math.PI - 0.0001).toFixed(1)} ${polarY(2 * Math.PI - 0.0001).toFixed(1)}`;
  const valuePath = pct > 0
    ? `M ${polarX(Math.PI).toFixed(1)} ${polarY(Math.PI).toFixed(1)} `
      + `A ${r} ${r} 0 ${largeArc} 1 ${polarX(endA).toFixed(1)} ${polarY(endA).toFixed(1)}`
    : '';

  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = Math.PI + (i / 10) * Math.PI;
    const x1 = cx + (r - 10) * Math.cos(a), y1 = cy + (r - 10) * Math.sin(a);
    const x2 = cx + (r + 2) * Math.cos(a), y2 = cy + (r + 2) * Math.sin(a);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" `
      + `stroke="${ctx.palette.rule}" stroke-width="${i % 5 === 0 ? 1.4 : 0.6}"/>`;
  }).join('');

  /*
   * A verdict word, on a 0-100 score and nowhere else.
   *
   * These thresholds are calibrated for a score out of a hundred, and they
   * were applied to `v / max` whatever `max` was. A SEIFA decile handed in as
   * `{{gauge: 7/10}}` therefore printed "7 / 10 · SOLID" inside the ring — a
   * grading of a customer's suburb that no record holds, minted from an
   * arbitrary denominator. An ordinal rank is not a share of anything, and the
   * caller who has one is better served by `renderBullet`.
   *
   * Where no band is drawn the rule beneath it takes the neutral accent, so
   * the drawing keeps its shape and loses only the claim.
   */
  const banded = max === 100;
  const band = !banded ? null
    : pct >= 0.8 ? 'Strong' : pct >= 0.65 ? 'Solid' : pct >= 0.5 ? 'Mixed' : 'Cautious';
  const bandColor = !banded ? ctx.palette.accent
    : pct >= 0.65 ? ctx.palette.positive
      : pct >= 0.5 ? ctx.palette.caution : ctx.palette.negative;

  return `${svgOpen(w, h)}
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${ctx.palette.accentDeep}"/>
        <stop offset="1" stop-color="${ctx.palette.accent}"/>
      </linearGradient>
    </defs>
    <path d="${trackPath}" stroke="${ctx.palette.groundAlt}" stroke-width="22" fill="none" stroke-linecap="round"/>
    ${valuePath ? `<path d="${valuePath}" stroke="url(#${gradId})" stroke-width="22" fill="none" stroke-linecap="round"/>` : ''}
    <g>${ticks}</g>
    ${text(ctx, w, { x: cx, y: cy - 6, pt: 'hero', fill: ctx.palette.ink, anchor: 'middle', stack: 'display', weight: 700, tabular: true }, String(Math.round(v)))}
    ${text(ctx, w, { x: cx, y: cy + 20, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle', tracking: 1.6 }, svgEscape((band ? `/${max}  ·  ${band}` : `/${max}`).toUpperCase()))}
    <rect x="${cx - 38}" y="${cy + 30}" width="76" height="3" fill="${bandColor}" rx="1.5"/>
    ${opts.label ? text(ctx, w, { x: cx, y: 26, pt: 'title', fill: ctx.palette.ink, anchor: 'middle', stack: 'display', weight: 700 }, svgEscape(opts.label)) : ''}
    ${captionLines.map((line, i) => text(ctx, w, { x: cx, y: (opts.label ? 46 : 26) + i * 16, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle', tracking: 0.9 }, svgEscape(line))).join('')}
  </svg>`;
}

export interface WaterfallItem { label: string; value: number; total?: boolean }

/** Waterfall — cumulative build-up, positive and negative steps. */
export function renderWaterfall(
  ctx: ChartContext,
  items: WaterfallItem[],
  opts: { mode?: AxisMode } = {},
): string {
  if (!items.length || items.length > MAX_WATERFALL_ITEMS) return '';
  const mode = opts.mode ?? 'money';
  const w = CHART_WIDTH.wide;
  const padL = 70, padR = 24, padT = 30, padB = 70;
  const plotW = w - padL - padR;
  /*
   * A category label is WRAPPED into its bar's slot, and the drawing grows for
   * the second line.
   *
   * This was `b.label.length > 16 ? b.label.slice(0, 14) + '…'` — a hard cut
   * that never wrapped and never once asked how wide the slot actually is.
   * Measured 19 Sep 2026 on the five-step shape a Compass draws: the slot is
   * 133 units and holds **19 characters a line**, so "Stamp duty and
   * transfer", "Legal and conveyancing", "Building and pest inspection" and
   * "Total acquisition cost" all set whole in two lines while the renderer
   * printed `Stamp duty and…`, `Legal and conv…`, `Building and p…` and
   * `Total acquisit…`.
   *
   * The clearest evidence is the directive's own documentation: the worked
   * example in `vizDirectives.pure.ts` is
   * `{{waterfall: Gross rent +$50,000, Non-mortgage outgoings -$13,101, …}}`,
   * and this renderer drew that example's own label as `Non-mortgage o…`.
   *
   * §4's rule is the one `fitLines` was written for and the timeline already
   * answers to: increase the component's space before shrinking its text. The
   * plot keeps its 260 units and the GROUND grows, so a second line is never
   * set past the bottom of the drawing, and a label that still cannot fit two
   * lines ends with `fitLines`' ellipsis — the rare exception rather than the
   * ordinary outcome for every label over sixteen characters.
   */
  const BASE_H = 360, LABEL_LINE = 13;
  const plotH = BASE_H - padT - padB;
  const groupW = plotW / items.length;
  const labelRows = items.map((it) => fitLines(it.label, groupW - 8, unitsPerChar(ctx, w, 'micro'), 2));
  const deepest = Math.max(1, ...labelRows.map((r) => r.length));
  const h = BASE_H + (deepest - 1) * LABEL_LINE;

  let running = 0;
  const bars = items.map((it) => {
    const start = it.total ? 0 : running;
    const end = it.total ? it.value : running + it.value;
    running = it.total ? it.value : running + it.value;
    return { ...it, start, end };
  });

  const allY = bars.flatMap((b) => [b.start, b.end, 0]);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const span = (yMax - yMin) || 1;
  const yOf = (v: number) => padT + plotH - ((v - yMin) / span) * plotH;
  const barW = Math.max(18, Math.min(58, groupW * 0.62));

  const grid = Array.from({ length: 5 }, (_, i) => {
    const t = i / 4;
    const y = padT + t * plotH;
    return `<line x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" `
      + `stroke="${ctx.palette.rule}" stroke-opacity="0.5" stroke-width="0.5"/>`
      + text(ctx, w, { x: padL - 8, y: y + 3.5, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'end', tabular: true },
        svgEscape(formatAxisValue(yMax - t * span, mode)));
  }).join('');

  let connectors = '';
  const rects = bars.map((b, i) => {
    const cx = padL + i * groupW + groupW / 2;
    const x = cx - barW / 2;
    const yTop = yOf(Math.max(b.start, b.end));
    const yBot = yOf(Math.min(b.start, b.end));
    const isUp = b.end >= b.start;
    const color = b.total ? ctx.palette.ink : isUp ? ctx.palette.positive : ctx.palette.negative;
    if (i < bars.length - 1) {
      connectors += `<line x1="${(x + barW).toFixed(1)}" y1="${yOf(b.end).toFixed(1)}" `
        + `x2="${(padL + (i + 1) * groupW + groupW / 2 - barW / 2).toFixed(1)}" y2="${yOf(bars[i + 1].start).toFixed(1)}" `
        + `stroke="${ctx.palette.rule}" stroke-dasharray="3 3" stroke-width="0.7"/>`;
    }
    return `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" `
      + `height="${Math.max(2, yBot - yTop).toFixed(1)}" fill="${color}" fill-opacity="0.92" rx="2"/>`
      + text(ctx, w, { x: cx, y: yTop - 8, pt: 'micro', fill: ctx.palette.ink, anchor: 'middle', weight: 600, tabular: true },
        svgEscape(formatAxisValue(b.end - b.start, mode)))
      + labelRows[i].map((line, k) => text(ctx, w,
        { x: cx, y: BASE_H - padB + 18 + k * LABEL_LINE, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle' },
        svgEscape(line))).join('');
  }).join('');

  return `${svgOpen(w, h)}
    <rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="${ctx.palette.ground}"/>
    <g>${grid}</g>
    <line x1="${padL}" x2="${w - padR}" y1="${yOf(0).toFixed(1)}" y2="${yOf(0).toFixed(1)}" stroke="${ctx.palette.inkMuted}" stroke-width="0.8"/>
    ${connectors}${rects}
  </svg>`;
}

/** Heatmap — an m×n grid, cells tinted by value. */
/**
 * The darkest a heatmap cell may be shaded and still carry a legible figure.
 *
 * A cell is the accent mixed over the ground at the value's own alpha, and the
 * figure on it is set in whichever of the two page colours reads better
 * against it. That picks the BETTER of two, which is not the same as picking
 * one that reads — and on a colourway whose accent is already dark, neither
 * does.
 *
 * Measured on the Investment Compass delivered for 9 Hollow Street, Golden
 * Square on 21 Sep 2026, whose colourway is `#8E6C15` on `#FAF7EF`: the better
 * of the two page colours drops below 7:1 at **alpha 0.48**, and the renderer
 * ramps to 0.90 — so **51% of the shading scale produced a cell no figure
 * could be read on**, bottoming out at 3.49:1. The 8.6 and 8.5 in that
 * document's growth grids are printed at 3.79:1.
 *
 * The ramp is therefore capped at the darkest alpha that still clears the
 * micro floor, computed from the palette rather than fixed: a light-accent
 * colourway keeps its full range (the default `#D9A520` clears it to 0.86, so
 * its drawings are unchanged), and a dark-accent one compresses. Magnitude
 * ordering is untouched — the scale is shorter, not reordered — and no colour
 * is invented, which is what keeps `charts paint only palette roles` true.
 */
export const HEATMAP_ALPHA_FLOOR = 0.08;
const HEATMAP_ALPHA_MAX = 0.90;

export function heatmapAlphaCeiling(palette: ChartPalette): number {
  const reads = (alpha: number): boolean => {
    const cell = mixHex(palette.ground, palette.accent, alpha);
    return Math.max(contrastRatio(cell, palette.ink), contrastRatio(cell, palette.ground))
      >= CONTRAST_FLOOR.micro;
  };
  if (reads(HEATMAP_ALPHA_MAX)) return HEATMAP_ALPHA_MAX;
  for (let a = HEATMAP_ALPHA_MAX; a > HEATMAP_ALPHA_FLOOR; a -= 0.01) {
    if (reads(a)) return Number(a.toFixed(2));
  }
  // Nothing in the ramp reads: the palest shade is the only honest one.
  return HEATMAP_ALPHA_FLOOR;
}

export function renderHeatmap(
  ctx: ChartContext,
  grid: number[][],
  opts: { rowLabels?: string[]; colLabels?: string[]; title?: string } = {},
): string {
  if (!grid.length || !grid[0]?.length) return '';
  const rows = grid.length, cols = grid[0].length;
  if (
    rows > MAX_HEATMAP_ROWS || cols > MAX_HEATMAP_COLS
    || rows * cols > MAX_HEATMAP_CELLS
    || grid.some((row) => row.length !== cols)
  ) return '';

  // A label beyond the grid is a promise with no figure under it: a real
  // render drew "5=High)" as a second row label below a one-row grid after
  // the directive parser split a parenthesised label. The parser is fixed;
  // the renderer still refuses to draw a label for a row or column that
  // does not exist.
  const rowLabels = (opts.rowLabels ?? []).slice(0, rows);
  const colLabels = (opts.colLabels ?? []).slice(0, cols);

  // And the converse, which is the worse one: a FIGURE with no label over it.
  //
  // Page 23 of the 9 Hollow Street Compass (20 Sep 2026) drew one row of
  // SEVEN cells — `3 3 3 4 4 4 5` — under the single column label
  // `Exposure level`, because the model wrote seven risks separated by
  // commas where this grammar wants `/`, so the grid transposed. Six of the
  // seven figures described something no reader could name, and the chart
  // read as complete because it carried a label at all.
  //
  // A PARTIAL label set is worse than none, so this is asked of a partial
  // set alone: a grid that names nothing on an axis is a grid whose caption
  // has to carry it, and several in production legitimately do.
  const rowLabelsPartial = (opts.rowLabels?.length ?? 0) > 0 && opts.rowLabels!.length < rows;
  const colLabelsPartial = (opts.colLabels?.length ?? 0) > 0 && opts.colLabels!.length < cols;
  if (rowLabelsPartial || colLabelsPartial) return '';
  const flat = grid.flat();
  const lo = Math.min(...flat), hi = Math.max(...flat);
  const span = (hi - lo) || 1;

  const maxRowLabel = rowLabels.reduce((m, l) => Math.max(m, String(l ?? '').length), 0);
  const maxColLabel = colLabels.reduce((m, l) => Math.max(m, String(l ?? '').length), 0);
  const cellText = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const maxCellLen = Math.max(...flat.map((v) => cellText(v).length), 3);

  // The label column and cells are sized from the type's own advance (0.58em
  // of micro, the measured mixed-case worst; the old 5.4-unit guess clipped a
  // 26-character row label by three characters). The advance is in viewBox
  // units, which scale with the total width, which is the sum of what the
  // labels need — a fixed point, iterated to convergence. It converges
  // whenever the labels, printed at micro size, are physically narrower than
  // the measure; when they are not, no box width fits (the type scales with
  // the box), and the chart refuses rather than clipping — the module's rule.
  const padR = 22, padB = 28;
  const advMm = CHART_TEXT_PT.micro * MM_PER_PT * 0.58;
  const inkFraction = (maxRowLabel + cols * Math.max(maxColLabel, maxCellLen)) * advMm / ctx.widthMm;
  if (inkFraction >= 0.98) return '';
  let padL = Math.max(110, maxRowLabel * 6 + 24);
  let cellW = Math.max(64, maxColLabel * 6 + 18, maxCellLen * 6 + 22);
  let w = padL + padR + cols * cellW;
  for (let i = 0; i < 40; i += 1) {
    const charU = ptToUnits(CHART_TEXT_PT.micro, w, ctx.widthMm) * 0.58;
    padL = Math.max(110, Math.ceil(maxRowLabel * charU) + 24);
    cellW = Math.max(64, Math.ceil(maxColLabel * charU) + 18, Math.ceil(maxCellLen * charU) + 22);
    const next = padL + padR + cols * cellW;
    if (Math.abs(next - w) < 0.5) { w = next; break; }
    w = next;
  }
  // The vertical metrics ride the type for the same reason: at a converged
  // width the units-per-mm grow, and the fixed header band (title at y=22,
  // padT=56) would set the title through the column labels, while a fixed
  // 38-unit cell would pinch the cell text it exists to hold.
  const microU = ptToUnits(CHART_TEXT_PT.micro, w, ctx.widthMm);
  const titleU = ptToUnits(CHART_TEXT_PT.title, w, ctx.widthMm);
  const titleY = Math.ceil(titleU + 6);
  /*
   * The title is FITTED to the grid's measure, and the header band grows for
   * the lines it needs.
   *
   * It used to be one `<text>` at `x: padL`, never measured, while `w` is
   * computed from the row labels, the column labels and the cell text alone —
   * so a title wider than the grid ran off the viewBox and was clipped. Page
   * 26 of the Investment Compass delivered for 9 Hollow Street on 21 Sep 2026
   * printed `House price growth · Golden Square vs Victoria (Valuer‑Genera`,
   * cut mid-word, over a 3×2 grid whose own labels are six and thirteen
   * characters.
   *
   * This is §8's rule, which `renderWaterfall` already answers to: **increase
   * the component's space before shrinking its text.** The grid keeps its
   * geometry exactly — `padL`, `cellW` and `w` are untouched, so a chart whose
   * title already fits is byte-identical — and only the header band grows, by
   * one line-step per extra line. Three lines, because a title is the one
   * label a reader needs whole, and a title that three lines cannot hold still
   * says it was cut rather than dropping its tail silently.
   */
  const titleLines = opts.title
    ? fitLines(opts.title, Math.max(40, w - padL - padR), titleU * 0.55, 3)
    : [];
  const titleStep = Math.ceil(titleU * 1.25);
  const titleBlock = titleLines.length ? titleY + (titleLines.length - 1) * titleStep : 0;
  const padT = Math.ceil((opts.title ? titleBlock + microU * 0.4 : 0) + (colLabels.length ? microU + 14 : microU + 8));
  const cellH = Math.max(38, Math.ceil(microU * 1.7));
  const h = padT + padB + rows * cellH;

  // Capped so the darkest cell still carries a readable figure — see
  // `heatmapAlphaCeiling`.
  const alphaCeiling = heatmapAlphaCeiling(ctx.palette);
  let cells = '';
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const v = grid[r][c];
      const x = padL + c * cellW, y = padT + r * cellH;
      const t = (v - lo) / span;
      const alpha = HEATMAP_ALPHA_FLOOR + t * (alphaCeiling - HEATMAP_ALPHA_FLOOR);
      // The value is set in whichever of the two page colours reads against
      // the cell it sits on. The cell is the accent over the ground at this
      // alpha; the ink was drawn unconditionally, and on a structure whose
      // accent is its ink (Dictionary: #312A21 on #FFFDFA) a full cell is as
      // dark as the figure printed on it — six "1"s on the medium reference
      // report read as ILLEGIBLE (RS-4, 14 Sep 2026).
      const cell = mixHex(ctx.palette.ground, ctx.palette.accent, alpha);
      const valueInk = contrastRatio(cell, ctx.palette.ink) >= contrastRatio(cell, ctx.palette.ground)
        ? ctx.palette.ink : ctx.palette.ground;
      cells += `<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" rx="1.5" `
        + `fill="${withAlpha(ctx.palette.accent, alpha)}" stroke="${ctx.palette.ground}" stroke-width="1"/>`
        + text(ctx, w, { x: x + cellW / 2, y: y + cellH / 2 + 3.5, pt: 'micro', fill: valueInk, anchor: 'middle', weight: 600, tabular: true },
          svgEscape(cellText(v)));
    }
  }

  const rowL = rowLabels.map((lbl, r) => text(ctx, w,
    { x: padL - 10, y: padT + r * cellH + cellH / 2 + 3.5, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'end' },
    svgEscape(lbl))).join('');
  const colL = colLabels.map((lbl, c) => text(ctx, w,
    { x: padL + c * cellW + cellW / 2, y: padT - 10, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle' },
    svgEscape(lbl))).join('');
  const title = titleLines
    .map((line, i) => text(
      ctx,
      w,
      { x: padL, y: titleY + i * titleStep, pt: 'title', fill: ctx.palette.ink, stack: 'display', weight: 700 },
      svgEscape(line),
    ))
    .join('');

  return `${svgOpen(w, h)}<rect width="${w}" height="${h}" rx="6" fill="${ctx.palette.ground}"/>`
    + `${title}${colL}${rowL}${cells}</svg>`;
}

/**
 * A scorecard is bars on a common baseline. It used to be a radar, and the
 * radar is gone.
 *
 * ## Why the shape changed
 *
 * The Executive Verdict drew five named dimensions — location strength,
 * infrastructure & amenity, property fit, tenant appeal, risk profile — as a
 * filled pentagon. Four things are wrong with that, and the first two are
 * wrong about the DATA rather than about taste:
 *
 *  1. **The polygon's area depends on the order of the axes.** The same five
 *     scores arranged differently enclose a different area and read as a
 *     different result. Nothing in the record says what the order should be,
 *     so the most visually dominant property of the chart carries no
 *     information at all.
 *  2. **Area scales with the square of the values.** A dimension scoring 86
 *     against one scoring 64 contributes not 1.34× but ~1.8× the area, so the
 *     picture overstates every gap it shows.
 *  3. **The space between two spokes means nothing.** There is no continuum
 *     between "tenant appeal" and "risk profile", and filling it implies one.
 *  4. **Radial labels have nowhere to go.** Comparing lengths along five
 *     spokes at five angles is measurably harder than comparing them against
 *     one baseline, and the corner labels crowd — `INFRASTRUCTURE & AMENITY`
 *     printed as `ASTRUCTURE` on a real client render. That was fixed with a
 *     label gutter and a wrap; the crowding is a property of the form.
 *
 * Bars fix all four at once: one baseline, length proportional to value,
 * nothing enclosed, and labels set horizontally in a column that sizes itself.
 *
 * ## Why one colour and not a traffic light
 *
 * `renderBars` colours by magnitude when no tone is given — above 0.66 reads
 * positive, below 0.2 negative. Over a real scorecard that is a distortion:
 * the measured spread on `6 Acer Court` is 64 to 86, and a red-to-green ramp
 * across 22 points of a 100-point scale paints an ordinary dimension as a
 * failure. The bars are one accent, and their lengths carry the comparison.
 */
export function renderScoreBars(
  ctx: ChartContext,
  scores: number[],
  opts: { labels?: string[]; max?: number } = {},
): string {
  if (scores.length < 2 || scores.length > MAX_WHEEL_SCORES) return '';
  const max = opts.max ?? 100;
  const labels = opts.labels?.length ? opts.labels : scores.map((_, i) => `D${i + 1}`);
  return renderBars(
    ctx,
    scores.map((value, i) => ({
      label: String(labels[i] ?? `D${i + 1}`).trim(),
      value: Number(value) || 0,
      display: String(Math.round(Number(value) || 0)),
      tone: 'accent' as const,
    })),
    { max },
  );
}

/** Bullet — a KPI against a target and qualitative bands. */
export function renderBullet(
  ctx: ChartContext,
  opts: { value: number; target?: number; max?: number; ranges?: number[]; label?: string; sub?: string },
): string {
  const max = opts.max ?? Math.max(opts.value, opts.target ?? 0, ...(opts.ranges ?? []), 1);
  const w = CHART_WIDTH.bullet, h = 78;
  const padL = 150, padR = 14, padT = 26, padB = 14;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xOf = (v: number) => padL + (Math.max(0, Math.min(max, v)) / max) * plotW;

  const ranges = (opts.ranges?.length ? [...opts.ranges] : [max * 0.4, max * 0.7, max]).sort((a, b) => a - b);
  const bands = ranges.map((r, i) => {
    const prev = i === 0 ? 0 : ranges[i - 1];
    const alpha = 0.18 + (i / Math.max(1, ranges.length - 1)) * 0.42;
    return `<rect x="${xOf(prev).toFixed(1)}" y="${padT}" width="${(xOf(r) - xOf(prev)).toFixed(1)}" `
      + `height="${plotH}" fill="${withAlpha(ctx.palette.accent, alpha)}"/>`;
  }).join('');

  const barH = plotH * 0.42;
  const barY = padT + (plotH - barH) / 2;
  return `${svgOpen(w, h)}
    <rect width="${w}" height="${h}" fill="${ctx.palette.ground}" rx="4"/>${bands}
    <rect x="${padL}" y="${barY.toFixed(1)}" width="${(xOf(opts.value) - padL).toFixed(1)}" height="${barH.toFixed(1)}" fill="${ctx.palette.ink}" rx="1"/>
    ${opts.target != null
      ? `<line x1="${xOf(opts.target).toFixed(1)}" x2="${xOf(opts.target).toFixed(1)}" y1="${padT + 2}" y2="${padT + plotH - 2}" stroke="${ctx.palette.negative}" stroke-width="3"/>`
      : ''}
    ${opts.label ? text(ctx, w, { x: padL - 12, y: padT + plotH / 2 - 2, pt: 'caption', fill: ctx.palette.ink, anchor: 'end', stack: 'display', weight: 700 }, svgEscape(opts.label)) : ''}
    ${opts.sub ? text(ctx, w, { x: padL - 12, y: padT + plotH / 2 + 13, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'end', tracking: 0.4 }, svgEscape(opts.sub.toUpperCase())) : ''}
  </svg>`;
}

export interface MarimekkoRow { label: string; weight: number; segments: number[] }

/** Marimekko — variable-width stacked bars: composition and magnitude at once. */
export function renderMarimekko(
  ctx: ChartContext,
  rows: MarimekkoRow[],
  opts: { segmentLabels?: string[] } = {},
): string {
  if (!rows.length) return '';
  const w = CHART_WIDTH.wide, h = 360;
  const padL = 90, padR = 20, padT = 32, padB = 50;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const totalWeight = rows.reduce((a, r) => a + (r.weight || 0), 0) || 1;
  const series = ctx.palette.series;

  let x = padL;
  const groups = rows.map((row) => {
    const colW = ((row.weight || 0) / totalWeight) * plotW;
    const sum = row.segments.reduce((a, b) => a + b, 0) || 1;
    let y = padT;
    const segs = row.segments.map((v, i) => {
      const segH = (v / sum) * plotH;
      const rect = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, colW - 1).toFixed(1)}" `
        + `height="${segH.toFixed(1)}" fill="${series[i % series.length]}" fill-opacity="0.85"/>`
        + (segH > 16
          ? text(ctx, w, { x: x + colW / 2, y: y + segH / 2 + 3.5, pt: 'micro', fill: ctx.palette.ground, anchor: 'middle', weight: 700 },
            `${Math.round((v / sum) * 100)}%`)
          : '');
      y += segH;
      return rect;
    }).join('');
    const label = text(ctx, w, { x: x + colW / 2, y: h - padB + 18, pt: 'micro', fill: ctx.palette.ink, anchor: 'middle' },
      svgEscape(row.label));
    x += colW;
    return segs + label;
  }).join('');

  const legend = (opts.segmentLabels ?? []).map((lbl, i) => {
    const lx = padL + i * 110;
    return `<rect x="${lx}" y="10" width="10" height="10" fill="${series[i % series.length]}"/>`
      + text(ctx, w, { x: lx + 14, y: 19, pt: 'micro', fill: ctx.palette.inkMuted, tracking: 0.4 }, svgEscape(lbl.toUpperCase()));
  }).join('');

  return `${svgOpen(w, h)}<rect width="${w}" height="${h}" fill="${ctx.palette.ground}" rx="6"/>${legend}${groups}</svg>`;
}

/** Micro-map — an abstract locator, not a real map. No tiles, no network. */
export function renderMicroMap(
  ctx: ChartContext,
  opts: { suburb: string; state?: string; postcode?: string; neighbours?: string[] },
): string {
  const w = CHART_WIDTH.compact, h = 320;
  const cx = w / 2, cy = h / 2 + 6;
  const rings = [120, 84, 50].map((r, i) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i === 2 ? withAlpha(ctx.palette.accent, 0.18) : 'none'}" `
    + `stroke="${ctx.palette.rule}" stroke-width="0.7" stroke-dasharray="${i === 0 ? '3 4' : '1 2'}"/>`).join('');

  const compass = [
    { x: cx, y: cy - 128, a: 'middle' as const, t: 'N' },
    { x: cx, y: cy + 138, a: 'middle' as const, t: 'S' },
    { x: cx + 132, y: cy + 4, a: 'start' as const, t: 'E' },
    { x: cx - 132, y: cy + 4, a: 'end' as const, t: 'W' },
  ].map((c) => text(ctx, w, { x: c.x, y: c.y, pt: 'micro', fill: ctx.palette.inkMuted, anchor: c.a, tracking: 1.2 }, c.t)).join('');

  const neighbours = (opts.neighbours ?? []).slice(0, 6);
  const nbDots = neighbours.map((nb, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, neighbours.length)) * Math.PI * 2;
    const nx = cx + 100 * Math.cos(a), ny = cy + 100 * Math.sin(a);
    const anchor = Math.cos(a) > 0.1 ? 'start' as const : Math.cos(a) < -0.1 ? 'end' as const : 'middle' as const;
    return `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="3" fill="${ctx.palette.inkMuted}"/>`
      + text(ctx, w, { x: nx + (Math.cos(a) > 0 ? 6 : -6), y: ny + 3.5, pt: 'micro', fill: ctx.palette.inkMuted, anchor }, svgEscape(nb));
  }).join('');

  const pin = `<path d="M ${cx} ${cy - 18} C ${cx - 14} ${cy - 18} ${cx - 14} ${cy + 2} ${cx} ${cy + 14} `
    + `C ${cx + 14} ${cy + 2} ${cx + 14} ${cy - 18} ${cx} ${cy - 18} Z" fill="${ctx.palette.accent}" stroke="${ctx.palette.ink}" stroke-width="1.2"/>`
    + `<circle cx="${cx}" cy="${cy - 8}" r="4.5" fill="${ctx.palette.ground}"/>`;

  const title = text(ctx, w, { x: cx, y: 28, pt: 'title', fill: ctx.palette.ink, anchor: 'middle', stack: 'display', weight: 700 }, svgEscape(opts.suburb))
    + text(ctx, w, { x: cx, y: 46, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle', tracking: 1.5 },
      svgEscape([opts.state, opts.postcode].filter(Boolean).join(' · ').toUpperCase()));

  return `${svgOpen(w, h)}<rect width="${w}" height="${h}" fill="${ctx.palette.ground}" rx="6"/>`
    + `${title}${rings}${compass}${nbDots}${pin}</svg>`;
}

/** Calendar heatmap — a twelve-cell year, or any run of periods. */
export function renderCalendarHeatmap(
  ctx: ChartContext,
  values: number[],
  opts: { title?: string; periodLabels?: string[] } = {},
): string {
  if (!values.length) return '';
  const months = opts.periodLabels?.length === values.length
    ? opts.periodLabels
    : ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].slice(0, values.length);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = (hi - lo) || 1;
  const cellW = 44, cellH = 44, gap = 4;
  const cols = Math.min(12, values.length);
  const rows = Math.ceil(values.length / cols);
  const padL = 16, padT = opts.title ? 40 : 18, padR = 16, padB = 22;
  const w = padL + padR + cols * (cellW + gap) - gap;
  const h = padT + padB + rows * (cellH + gap) - gap;

  const cells = values.map((v, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = padL + c * (cellW + gap), y = padT + r * (cellH + gap);
    const t = (v - lo) / span;
    return `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="3" `
      + `fill="${withAlpha(ctx.palette.accent, 0.12 + t * 0.78)}" stroke="${ctx.palette.rule}" stroke-width="0.4"/>`
      + text(ctx, w, { x: x + cellW / 2, y: y + 16, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle', tracking: 0.4 },
        svgEscape(months[i] ?? ''))
      + text(ctx, w, { x: x + cellW / 2, y: y + cellH - 10, pt: 'caption', fill: ctx.palette.ink, anchor: 'middle', stack: 'display', weight: 700, tabular: true },
        svgEscape(Number.isInteger(v) ? String(v) : v.toFixed(1)));
  }).join('');

  const title = opts.title
    ? text(ctx, w, { x: padL, y: 22, pt: 'title', fill: ctx.palette.ink, stack: 'display', weight: 700 }, svgEscape(opts.title))
    : '';
  return `${svgOpen(w, h)}<rect width="${w}" height="${h}" fill="${ctx.palette.ground}" rx="6"/>${title}${cells}</svg>`;
}

export interface BarItem { label: string; value: number; display?: string; tone?: 'positive' | 'caution' | 'negative' | 'accent' }

/** Horizontal comparator bars — label, bar, figure. */
export function renderBars(
  ctx: ChartContext,
  items: BarItem[],
  opts: { title?: string; max?: number; unit?: string } = {},
): string {
  if (!items.length) return '';
  const w = CHART_WIDTH.wide;
  const BASE_ROW_H = 28;
  const padT = opts.title ? 36 : 14;
  const padB = 14;
  // The label column sizes to the longest label, the heatmap's own treatment.
  // Fixed at 180 it clipped at the SVG's left edge: "Property-specific
  // verification need" lost its first letters on a real render, which in a
  // right-anchored column is the START of the words — the worst place. The
  // per-character advance is derived from the type's own size in units
  // (0.58em: the measured mixed-case worst was 0.55, digits included), so it
  // stays honest whatever width the chart prints across. Capped at 45% of
  // the measure so the bars keep room to differ.
  const charU = ptToUnits(CHART_TEXT_PT.micro, w, ctx.widthMm) * 0.58;
  const longestLabel = items.reduce((m, it) => Math.max(m, String(it.label ?? '').length), 0);
  const labelW = Math.min(Math.max(180, Math.ceil(longestLabel * charU) + 8), Math.floor(w * 0.45));
  /*
   * A label too long for the capped column is WRAPPED, and the row grows.
   *
   * The comment above records that a fixed 180-unit column "clipped at the
   * SVG's left edge: 'Property-specific verification need' lost its first
   * letters on a real render, which in a right-anchored column is the START of
   * the words — the worst place." Sizing the column to the longest label fixed
   * the case it was measured on, and the 45% cap on the next line silently
   * reintroduced the same failure for anything longer.
   *
   * Measured 22 Sep 2026: the cap is 342 units and holds **51 characters**.
   * The ABS approvals register's own wording for a dwelling class —
   * `other residential dwellings (townhouses, units and apartments)`, sixty-two
   * characters — is drawn from x = **-73.7** in a `0 0 760 134` viewBox, so
   * eleven characters are set outside the viewport and clipped. That register
   * entered the Compass's reach with the Supply section (W2.2), and `{{bars:}}`
   * is the most-used directive in the document at ~107 a report.
   *
   * The rule is `fitLines`' own and the one `renderWaterfall` was repaired
   * under: **increase the component's space before shrinking its text.** The
   * column keeps its cap — the bars need room to differ — and the ROW grows a
   * line-step per extra line. `LABEL_LINE` is the waterfall's measured micro
   * leading, named here rather than re-derived.
   *
   * A chart whose labels all fit one line is byte-identical: `fitLines`
   * returns a single line, `deepest` is 1, `rowH` is the 28 it always was, and
   * the bar and figure sit where they always sat.
   */
  const LABEL_LINE = 13;
  const labelRows = items.map((it) => fitLines(String(it.label ?? ''), labelW - 8, charU, 2));
  const deepest = Math.max(1, ...labelRows.map((r) => r.length));
  const rowH = BASE_ROW_H + (deepest - 1) * LABEL_LINE;
  const valueW = 76;
  const barX = labelW + 12;
  const barW = w - barX - valueW - 16;
  const h = padT + items.length * rowH + padB;
  const max = (opts.max ?? Math.max(...items.map((i) => Math.abs(i.value)))) || 1;

  /*
   * Colour is chosen, never derived from size.
   *
   * This used to read `pct >= 0.66 ? positive : pct >= 0.4 ? accent : pct >=
   * 0.2 ? caution : negative` under the comment "magnitude reads as strength",
   * and on a distance chart that is exactly inverted. Measured on page 12 of
   * the Cowra Compass (`max=3`, kilometres): the primary school at 0.7 km —
   * the NEAREST amenity — was drawn amber as a warning, and the hospital at
   * 2.0 km, the furthest, was drawn green as a success. The same default
   * painted the risk wheel, where 75 ("Transport reliance", the worst of six)
   * read as the good news.
   *
   * There is no reading of a bar's length that tells a renderer whether long
   * is good. A caller that knows says so with `tone`; a caller that does not
   * gets one accent for every bar, which is what a comparison of like things
   * should look like anyway — the differing lengths already carry the
   * comparison, and spending four hues on it adds a meaning the data has not
   * got. Colour then stops being the only channel, which is the other half of
   * the same rule.
   */
  const toneColour = (tone: BarItem['tone']) => {
    if (tone === 'positive') return ctx.palette.positive;
    if (tone === 'caution') return ctx.palette.caution;
    if (tone === 'negative') return ctx.palette.negative;
    return ctx.palette.accent;
  };

  const rows = items.map((it, i) => {
    const y = padT + i * rowH;
    const pct = Math.max(0, Math.min(1, Math.abs(it.value) / max));
    const bw = Math.max(2, pct * barW);
    const display = it.display
      ?? `${Number.isInteger(it.value) ? String(it.value) : it.value.toFixed(1)}${opts.unit ?? ''}`;
    // The label's lines are centred on the row, and the bar and the figure sit
    // on the row's own centre — which for a one-line row is the y + 8 / y + 17
    // they have always been.
    const lines = labelRows[i];
    const labelTop = y + 17 - ((lines.length - 1) * LABEL_LINE) / 2;
    const barY = y + (rowH - 12) / 2;
    const figureY = y + rowH / 2 + 3;
    return lines.map((line, k) => text(ctx, w,
      { x: labelW, y: labelTop + k * LABEL_LINE, pt: 'micro', fill: ctx.palette.ink, anchor: 'end' },
      svgEscape(line))).join('')
      + `<rect x="${barX}" y="${barY}" width="${barW}" height="12" fill="${ctx.palette.groundAlt}" rx="2"/>`
      + `<rect x="${barX}" y="${barY}" width="${bw.toFixed(1)}" height="12" fill="${toneColour(it.tone)}" rx="2"/>`
      + text(ctx, w, { x: barX + barW + 10, y: figureY, pt: 'micro', fill: ctx.palette.ink, weight: 700, tabular: true }, svgEscape(display));
  }).join('');

  const title = opts.title
    ? text(ctx, w, { x: 0, y: 22, pt: 'title', fill: ctx.palette.ink, stack: 'display', weight: 700 }, svgEscape(opts.title))
      + `<line x1="0" x2="${w}" y1="30" y2="30" stroke="${ctx.palette.rule}" stroke-width="0.6"/>`
    : '';
  return `${svgOpen(w, h)}${title}${rows}</svg>`;
}

export interface QuadrantPoint { x: number; y: number; label: string; highlight?: boolean }

/**
 * Roughly how wide a micro-size, letter-spaced caption runs, per character.
 *
 * There is no text measurement available to a pure module that emits SVG for a
 * renderer it never talks to, so this is a conservative average advance for the
 * uppercase captions these charts draw. It is used only to decide whether two
 * labels would collide — over-estimating drops a label, which is safe; the
 * alternative is two captions printed on top of one another.
 */
const MICRO_ADVANCE = 6.1;

/**
 * Past this fraction of the plot, a dot's label is written to its left.
 *
 * A label anchored at `cx + 10` on a point near `xMax` runs outside the SVG
 * viewport and is clipped — which is how a chart silently stops naming its
 * rightmost holdings. Measured against the longest label a caller may pass:
 * ~22 characters at micro size is a shade over a quarter of the standard chart
 * width, so the flip has to happen well before the edge.
 */
const QUADRANT_LABEL_FLIP = 0.72;

/** 2×2 matrix — risk against return, growth against yield. */
export function renderQuadrant(
  ctx: ChartContext,
  points: QuadrantPoint[],
  opts: {
    xLabel?: string; yLabel?: string; xMax?: number; yMax?: number; title?: string;
    /**
     * Where the dividing lines fall, in data units rather than geometry.
     *
     * Default is the geometric middle, which means "half of the largest value
     * plotted" — a divider that moves when a new holding is added and stands for
     * nothing. A caller with a real threshold (a portfolio's own average, an
     * LMI line) passes it here so the four corners mean what their captions say.
     */
    xMid?: number; yMid?: number;
    q1?: string; q2?: string; q3?: string; q4?: string;
  } = {},
): string {
  const w = CHART_WIDTH.standard, h = 420;
  const padT = opts.title ? 50 : 24, padB = 56, padL = 60, padR = 20;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xMax = opts.xMax ?? Math.max(...points.map((p) => p.x), 10);
  const yMax = opts.yMax ?? Math.max(...points.map((p) => p.y), 10);
  const xOf = (v: number) => padL + (v / xMax) * plotW;
  const yOf = (v: number) => padT + plotH - (v / yMax) * plotH;
  // Clamped into the plot: a divider outside the drawn box would leave one
  // quadrant with no area and the other three mislabelled.
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const midX = opts.xMid === undefined
    ? padL + plotW / 2
    : clamp(xOf(opts.xMid), padL, padL + plotW);
  const midY = opts.yMid === undefined
    ? padT + plotH / 2
    : clamp(yOf(opts.yMid), padT, padT + plotH);

  // Anchored to the corners of the box rather than centred in each region.
  // Centring only works while the divider is in the middle; with a divider at a
  // real threshold one region can be a sliver, and a caption centred in it
  // either overflows its own quadrant or has to be dropped. At the corners the
  // captions need no room from the region at all — only from each other.
  const advance = (t: string) => t.length * MICRO_ADVANCE;
  const rowFits = (a?: string, b?: string) =>
    advance(a ?? '') + advance(b ?? '') + 24 <= plotW;
  const topFits = rowFits(opts.q1, opts.q2);
  const bottomFits = rowFits(opts.q3, opts.q4);
  const quadLabels = [
    { x: padL + plotW - 8, end: true, y: padT + 16, t: topFits ? opts.q1 : undefined },
    { x: padL + 8, end: false, y: padT + 16, t: topFits ? opts.q2 : undefined },
    { x: padL + 8, end: false, y: padT + plotH - 8, t: bottomFits ? opts.q3 : undefined },
    { x: padL + plotW - 8, end: true, y: padT + plotH - 8, t: bottomFits ? opts.q4 : undefined },
  ].filter((q) => q.t).map((q) => text(ctx, w,
    {
      x: q.x,
      y: q.y,
      pt: 'micro',
      fill: ctx.palette.inkMuted,
      anchor: q.end ? 'end' : 'start',
      weight: 700,
      tracking: 1.2,
    },
    svgEscape(q.t!.toUpperCase()))).join('');

  const flipAt = padL + plotW * QUADRANT_LABEL_FLIP;
  const dots = points.map((p) => {
    const cx = xOf(p.x), cy = yOf(p.y);
    const flip = cx > flipAt;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${p.highlight ? 7.5 : 5}" `
      + `fill="${p.highlight ? ctx.palette.accent : ctx.palette.ink}" stroke="${ctx.palette.ground}" stroke-width="2"/>`
      + text(ctx, w, {
        x: flip ? cx - 10 : cx + 10,
        y: cy + 4,
        pt: 'micro',
        fill: ctx.palette.ink,
        weight: p.highlight ? 700 : 500,
        anchor: flip ? 'end' : 'start',
      }, svgEscape(p.label));
  }).join('');

  return `${svgOpen(w, h)}
    ${opts.title ? text(ctx, w, { x: padL, y: 24, pt: 'title', fill: ctx.palette.ink, stack: 'display', weight: 700 }, svgEscape(opts.title)) : ''}
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="${ctx.palette.ground}" stroke="${ctx.palette.rule}" stroke-width="0.5"/>
    <line x1="${midX}" x2="${midX}" y1="${padT}" y2="${padT + plotH}" stroke="${ctx.palette.rule}" stroke-dasharray="3 3" stroke-width="0.6"/>
    <line x1="${padL}" x2="${padL + plotW}" y1="${midY}" y2="${midY}" stroke="${ctx.palette.rule}" stroke-dasharray="3 3" stroke-width="0.6"/>
    ${quadLabels}${dots}
    ${text(ctx, w, { x: padL + plotW / 2, y: h - 18, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle', tracking: 1.2 }, `${svgEscape((opts.xLabel ?? '').toUpperCase())} →`)}
    ${text(ctx, w, { x: 20, y: padT + plotH / 2, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle', tracking: 1.2, transform: `rotate(-90 20 ${(padT + plotH / 2).toFixed(1)})` }, `${svgEscape((opts.yLabel ?? '').toUpperCase())} →`)}
  </svg>`;
}

/** Pictograph — an icon array, first K filled. */
export function renderPictograph(
  ctx: ChartContext,
  filled: number,
  total: number,
  opts: { icon?: 'person' | 'house' | 'dollar'; label?: string; sub?: string; cols?: number } = {},
): string {
  const t = Math.max(1, Math.min(MAX_PICTOGRAPH_UNITS, Math.floor(total)));
  const f = Math.max(0, Math.min(t, Math.floor(filled)));
  const cols = Math.min(opts.cols ?? Math.min(t, 10), 20);
  const rows = Math.ceil(t / cols);
  const cell = 38;
  const w = cols * cell + 24;
  // The title shares its line with the count, which is anchored to the right
  // edge — so the title's measure is what is left of the width once the count
  // and a gap are taken out, and it wraps to a second line rather than
  // running under the figure. Read off a render: "Approximate share of core
  // family houses in Cowra" set straight through "7 / 10" (RS-3c, 14 Sep 2026).
  const countText = `${f} / ${t}`;
  const countUnits = countText.length * unitsPerChar(ctx, w, 'caption');
  const titleLines = opts.label ? fitLines(opts.label, w - 24 - countUnits - 10, unitsPerChar(ctx, w, 'title'), 2) : [];
  const titleStep = ptToUnits(CHART_TEXT_PT.title * 1.25, w, ctx.widthMm);
  const padT = titleLines.length ? 22 + (titleLines.length - 1) * titleStep + 18 : 14;
  const subLines = opts.sub ? fitLines(opts.sub, w - 24, unitsPerChar(ctx, w, 'micro'), 2) : [];
  const subStep = 12;
  const padB = subLines.length ? 26 + (subLines.length - 1) * subStep : 12;
  const h = padT + rows * cell + padB;

  const glyphs: Record<string, string> = {
    person: '<path d="M14 6 a4 4 0 1 1 0 8 a4 4 0 1 1 0 -8 z M6 26 q0 -8 8 -8 q8 0 8 8 z"/>',
    house: '<path d="M14 4 L25 13 L25 26 L17 26 L17 19 L11 19 L11 26 L3 26 L3 13 z"/>',
    dollar: '<path d="M14 4 L14 26 M19 9 q-1 -3 -5 -3 q-5 0 -5 4 q0 4 5 4 q5 0 5 4 q0 4 -5 4 q-4 0 -5 -3" '
      + 'stroke-width="2.5" stroke-linecap="round" fill="none" stroke="currentColor"/>',
  };
  const icon = opts.icon ?? 'house';
  const isStroke = icon === 'dollar';
  const tiles = Array.from({ length: t }, (_, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = 12 + c * cell, y = padT + r * cell;
    const color = i < f ? ctx.palette.accent : ctx.palette.rule;
    return `<g transform="translate(${x} ${y})" ${isStroke ? `stroke="${color}"` : `fill="${color}"`} color="${color}">${glyphs[icon]}</g>`;
  }).join('');

  const label = titleLines.length
    ? titleLines.map((line, k) => text(ctx, w,
      { x: 12, y: 22 + k * titleStep, pt: 'title', fill: ctx.palette.ink, stack: 'display', weight: 700 }, svgEscape(line))).join('')
      + text(ctx, w, { x: w - 12, y: 22, pt: 'caption', fill: ctx.palette.accentDeep, anchor: 'end', weight: 700, tabular: true }, countText)
    : '';
  const subTop = padT + rows * cell + 18;
  const sub = subLines.map((line, k) => text(ctx, w,
    { x: 12, y: subTop + k * subStep, pt: 'micro', fill: ctx.palette.inkMuted, tracking: 0.4 }, svgEscape(line))).join('');
  return `${svgOpen(w, h)}${label}${tiles}${sub}</svg>`;
}

/** Sparkline that flows inside a line of text. */
export function renderInlineSpark(ctx: ChartContext, values: number[]): string {
  if (values.length < 2) return '';
  const w = CHART_WIDTH.inline, h = 16;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = (hi - lo) || 1;
  const pts = values.map((v, i) =>
    `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  const lastY = h - 2 - ((last - lo) / span) * (h - 4);
  const trend = last >= values[0] ? ctx.palette.positive : ctx.palette.negative;
  return `<svg class="spark-inline" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" `
    + `width="${w}" height="${h}" style="vertical-align:-2px;margin:0 2px;">`
    + `<polyline points="${pts}" fill="none" stroke="${trend}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${(w - 2).toFixed(1)}" cy="${lastY.toFixed(1)}" r="1.6" fill="${trend}"/></svg>`;
}

/** Sparkline sized for a margin note. */
export function renderMarginSpark(ctx: ChartContext, values: number[]): string {
  if (values.length < 2) return '';
  const w = CHART_WIDTH.margin, h = 38;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = (hi - lo) || 1;
  const pts = values.map((v, i) =>
    `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 4 - ((v - lo) / span) * (h - 8)).toFixed(1)}`).join(' ');
  const trend = values[values.length - 1] >= values[0] ? ctx.palette.positive : ctx.palette.negative;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="none">`
    + `<polygon points="${pts} ${(w - 2).toFixed(1)},${h - 2} 2,${h - 2}" fill="${trend}" fill-opacity="0.12"/>`
    + `<polyline points="${pts}" fill="none" stroke="${trend}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

export interface DonutSegment { label: string; value: number }

export type DonutLayout = 'side' | 'stacked';

/**
 * Below this printed width the legend moves beneath the ring.
 *
 * A legend row is a swatch, a label and a percentage — around 30mm of type at
 * the sizes this module enforces. Beside a ring, that needs a measure this
 * chart does not have in a narrow column.
 */
export const DONUT_STACK_BELOW_MM = 90;

/**
 * Donut — a composition with a headline figure in the hole.
 *
 * The legend sits beside the ring at full measure and beneath it in a narrow
 * column. Not a flourish: at the printed sizes this module enforces, a legend
 * row is around 30mm of type, and a 66mm column has no room for both. The first
 * charted render showed the label running straight through the percentage.
 */
export function renderDonut(
  ctx: ChartContext,
  segments: DonutSegment[],
  opts: { title?: string; centerLabel?: string; centerSub?: string; layout?: DonutLayout } = {},
): string {
  if (!segments.length) return '';
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  const series = ctx.palette.series;
  const layout: DonutLayout = opts.layout
    ?? (ctx.widthMm < DONUT_STACK_BELOW_MM ? 'stacked' : 'side');

  const stacked = layout === 'stacked';
  const w = CHART_WIDTH.compact;
  const R = stacked ? 74 : 92, r = stacked ? 44 : 56;
  const cx = stacked ? w / 2 : 120;
  const titleX = stacked ? 16 : 250;
  const titleLines = opts.title ? fitLines(opts.title, w - 12 - titleX, unitsPerChar(ctx, w, 'title'), 2) : [];
  const ringTop = opts.title ? 40 + (titleLines.length - 1) * 20 : 12;
  const cy = ringTop + R;
  const rowH = 26;
  const baseH = stacked
    ? cy + R + 14 + segments.length * rowH
    : 240;
  const TAU = Math.PI * 2;

  let a0 = -Math.PI / 2;
  const arcs = segments.map((s, i) => {
    const frac = Math.max(0, s.value) / total;
    if (frac <= 0) return '';
    const a1 = a0 + frac * TAU;
    const large = frac > 0.5 ? 1 : 0;
    const p = (radius: number, a: number) =>
      `${(cx + radius * Math.cos(a)).toFixed(1)} ${(cy + radius * Math.sin(a)).toFixed(1)}`;
    const d = `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${series[i % series.length]}" stroke="${ctx.palette.ground}" stroke-width="1.2"/>`;
  }).join('');

  const legendX = stacked ? 16 : 250;
  // Stacked, the ring already sits below the whole title (`cy` grew with it).
  const legendTop = stacked ? cy + R + 26 : 48 + (titleLines.length - 1) * 20;
  // A label runs to the value column and no further: two lines at most, the
  // row grows with it, and the value keeps its own column.
  const valueColumn = 44;
  const labelUnits = (w - 12) - (legendX + 16) - valueColumn;
  const microChar = unitsPerChar(ctx, w, 'micro');
  const legendRows = segments.map((s) => fitLines(s.label, labelUnits, microChar, 2));
  const rowPitch = stacked ? rowH : 22;
  const lineStep = 13;
  let legendY = legendTop;
  const legend = segments.map((s, i) => {
    const pct = Math.round((Math.max(0, s.value) / total) * 100);
    const lines = legendRows[i].length ? legendRows[i] : [''];
    const y = legendY;
    legendY += rowPitch + (lines.length - 1) * lineStep;
    return `<rect x="${legendX}" y="${y - 9}" width="10" height="10" rx="2" fill="${series[i % series.length]}"/>`
      + lines.map((line, j) => text(ctx, w, { x: legendX + 16, y: y + j * lineStep, pt: 'micro', fill: ctx.palette.ink }, svgEscape(line))).join('')
      + text(ctx, w, { x: w - 12, y, pt: 'micro', fill: ctx.palette.ink, anchor: 'end', weight: 700, tabular: true }, `${pct}%`);
  }).join('');
  const legendBottom = legendY - rowPitch + 14;

  const titleRule = 32 + (titleLines.length - 1) * 20;
  const title = titleLines.length
    ? titleLines.map((line, i) => text(ctx, w, { x: titleX, y: 26 + i * 20, pt: 'title', fill: ctx.palette.ink, stack: 'display', weight: 700 }, svgEscape(line))).join('')
      + `<line x1="${titleX}" x2="${w - 12}" y1="${titleRule}" y2="${titleRule}" stroke="${ctx.palette.rule}" stroke-width="0.5"/>`
    : '';

  const centerVal = opts.centerLabel ?? `${Math.round(((segments[0]?.value ?? 0) / total) * 100)}%`;
  // The sub-label only fits inside the hole at full size; in the stacked
  // layout the ring is smaller and it would overlap the figure. It is fitted
  // to the hole's width, on up to two lines, rather than drawn through the ring.
  /*
   * The hole's label is drawn WHOLE or not at all.
   *
   * `fitLines` ends an overlong run with an ellipsis, which inside a ring is
   * the worst place for one: the Cowra Compass printed "FAMILY HOUSEHOL…" on
   * page 19 and "OFFICIAL STATISTI…" on page 30, each directly beside a
   * legend row carrying the same words in full. §7 asks for truncated labels
   * to be eliminated, and here the elimination costs nothing — the reader
   * loses a restatement, not a fact.
   *
   * A wider ring is not the answer either: the hole is sized by the drawing,
   * and growing it to fit an arbitrary label shrinks the ring the segments
   * are read from.
   */
  const fitted = stacked ? [] : fitLines(
    (opts.centerSub ?? segments[0]?.label ?? '').toUpperCase(),
    2 * r - 12,
    unitsPerChar(ctx, w, 'micro', true) + ptToUnits(1, w, ctx.widthMm),
    2,
  );
  const subLines = fitted.some((l) => l.endsWith('…')) ? [] : fitted;
  const centerSub = subLines.map((line, i) => text(ctx, w,
    { x: cx, y: cy + 20 + i * 13, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle', tracking: 1 },
    svgEscape(line))).join('');

  // The legend may have grown past the ring (wrapped labels, many segments):
  // the drawing is as tall as whichever is lower.
  const grown = stacked ? baseH : baseH + (titleLines.length - 1) * 20;
  const h = Math.max(grown, legendBottom);
  return `${svgOpen(w, h)}${title}${arcs}
    ${text(ctx, w, { x: cx, y: cy + (stacked ? 6 : -2), pt: 'hero', fill: ctx.palette.ink, anchor: 'middle', stack: 'display', weight: 700, tabular: true }, svgEscape(centerVal))}
    ${centerSub}${legend}</svg>`;
}

export interface SeriesLine { label: string; values: readonly number[] }

/**
 * Several series over a shared x axis — a scenario fan.
 *
 * Added for the investment report, which is the first format in the programme
 * whose payload carries more than one series of the same measure: its
 * `projections` column holds conservative, moderate and optimistic ten-year
 * arrays, and every renderer before this one could only draw the middle case.
 * Printing one line out of three throws away the range, and the range is the
 * whole point of a projection.
 *
 * The band between the lowest and highest series is filled, which is what makes
 * this a fan rather than three unrelated lines: the reader is meant to see the
 * spread first and the individual paths second. With a single series it degrades
 * to a plain line, and that is deliberate — a caller with one scenario should
 * not have to reach for a different function.
 *
 * Series are drawn in the order given, and the **last** one is drawn heaviest,
 * because the caller orders them worst-to-best and the case a reader anchors on
 * is whichever the caller put last.
 */
export function renderSeriesFan(
  ctx: ChartContext,
  series: readonly SeriesLine[],
  opts: { title?: string; xLabels?: readonly string[]; mode?: AxisMode; zeroLine?: boolean } = {},
): string {
  const clean = series.filter((s) => s.values.length >= 2).slice(0, MAX_FAN_SERIES);
  if (!clean.length) return '';

  const w = CHART_WIDTH.wide;
  const h = 340;
  const padT = opts.title ? 44 : 18;
  const padB = 46, padL = 74, padR = 16;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const points = clean.length ? Math.max(...clean.map((s) => s.values.length)) : 0;
  const all = clean.flatMap((s) => [...s.values]);
  let lo = Math.min(...all), hi = Math.max(...all);
  // A zero baseline is included whenever the data straddles it or the caller
  // asks, so a cumulative cash-flow fan that is negative throughout still shows
  // the reader where break-even sits rather than floating above an implied one.
  if (opts.zeroLine || (lo < 0 && hi > 0)) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;

  const px = (i: number) => padL + (points <= 1 ? 0 : (i / (points - 1)) * plotW);
  const py = (v: number) => padT + plotH - ((v - lo) / span) * plotH;

  // ── Grid and the y axis ──
  const TICKS = 4;
  const gridLines: string[] = [];
  for (let t = 0; t <= TICKS; t++) {
    const v = lo + (span * t) / TICKS;
    const y = py(v);
    gridLines.push(
      `<line x1="${padL}" x2="${padL + plotW}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" `
      + `stroke="${ctx.palette.rule}" stroke-width="0.5"/>`
      + text(ctx, w, { x: padL - 10, y: y + 4, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'end', tabular: true },
        svgEscape(formatAxisValue(v, opts.mode ?? 'plain'))),
    );
  }

  const zero = (lo <= 0 && hi >= 0)
    ? `<line x1="${padL}" x2="${padL + plotW}" y1="${py(0).toFixed(1)}" y2="${py(0).toFixed(1)}" `
      + `stroke="${ctx.palette.ink}" stroke-width="1" stroke-dasharray="4 3"/>`
    : '';

  // ── The band between the extremes ──
  //
  // Built from the per-x min and max across every series rather than from the
  // first and last series, because "lowest" is not guaranteed to be one series
  // throughout — an optimistic rent case can cross a conservative value case.
  let band = '';
  if (clean.length >= 2) {
    const top: string[] = [], bottom: string[] = [];
    for (let i = 0; i < points; i++) {
      const col = clean.map((s) => s.values[Math.min(i, s.values.length - 1)]);
      top.push(`${px(i).toFixed(1)},${py(Math.max(...col)).toFixed(1)}`);
      bottom.unshift(`${px(i).toFixed(1)},${py(Math.min(...col)).toFixed(1)}`);
    }
    band = `<polygon points="${top.join(' ')} ${bottom.join(' ')}" fill="${withAlpha(ctx.palette.accent, 0.14)}"/>`;
  }

  const lines = clean.map((s, si) => {
    const last = si === clean.length - 1;
    const colour = ctx.palette.series[si % ctx.palette.series.length];
    const pts = s.values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${colour}" `
      + `stroke-width="${last ? 2.6 : 1.6}" stroke-linecap="round" stroke-linejoin="round"`
      + `${last ? '' : ' stroke-dasharray="5 3"'}/>`
      // The end point is marked so a reader can tell which line finished where
      // without tracing it back to the legend.
      + `<circle cx="${px(s.values.length - 1).toFixed(1)}" cy="${py(s.values[s.values.length - 1]).toFixed(1)}" `
      + `r="${last ? 4 : 3}" fill="${colour}"/>`;
  }).join('');

  // ── x labels, thinned so they cannot collide ──
  const labels = opts.xLabels ?? Array.from({ length: points }, (_, i) => String(i + 1));
  const widest = Math.max(...labels.map((l) => l.length)) * MICRO_ADVANCE;
  const every = Math.max(1, Math.ceil((points * widest) / Math.max(1, plotW)));
  const xLabels = labels.slice(0, points).map((l, i) =>
    (i % every === 0 || i === points - 1)
      ? text(ctx, w, { x: px(i), y: h - padB + 22, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle' }, svgEscape(l))
      : '').join('');

  // ── Legend ──
  const legend = clean.length > 1
    ? clean.map((s, si) => {
      const colour = ctx.palette.series[si % ctx.palette.series.length];
      const x = padL + si * Math.min(160, plotW / clean.length);
      return `<line x1="${x}" x2="${x + 18}" y1="${h - 12}" y2="${h - 12}" stroke="${colour}" stroke-width="2.4"/>`
        + text(ctx, w, { x: x + 24, y: h - 8, pt: 'micro', fill: ctx.palette.inkMuted }, svgEscape(s.label));
    }).join('')
    : '';

  const title = opts.title
    ? text(ctx, w, { x: 0, y: 24, pt: 'title', fill: ctx.palette.ink, stack: 'display', weight: 700 }, svgEscape(opts.title))
      + `<line x1="0" x2="${w}" y1="34" y2="34" stroke="${ctx.palette.rule}" stroke-width="0.6"/>`
    : '';

  return `${svgOpen(w, h)}${title}<g>${gridLines.join('')}</g>${band}${zero}${lines}${xLabels}${legend}</svg>`;
}

export interface TileItem { label: string; value: string; sub?: string; intensity?: number }

/** Tiles — small multiples that read like a faux-choropleth. */
/**
 * Where a tile's own label is carrying its figure, the figure is moved into
 * the slot that promised it.
 *
 * Page 8 of the Investment Compass delivered for 9 Hollow Street on
 * 21 Sep 2026 drew four amenity tiles. Three read `SHOPPING CENTRES` over
 * `10`, `PARKS & RECREATION` over `9`, `RESTAURANTS & CAFÉS` over `10`. The
 * first read `HEALTHCARE 10 FACILITIES` over **nothing at all** — an empty
 * `<text>` between a label and a sub-caption — because the model wrote
 * `Healthcare 10 facilities` where the grammar wants `Label Value`, so the
 * parser found no value and the figure stayed in the label. It becomes
 * `HEALTHCARE` over `10 facilities`, which is what its three siblings look
 * like, and no character is composed: the split is at the label's first
 * number. Same repair `chartQuantity.cutSentenceRow` makes for a bar whose
 * value the parser took out of a sentence.
 *
 * ## What it deliberately does NOT do, and why
 *
 * A first version also DROPPED a tile left with nothing to show, on
 * `renderKpiGridHtml`'s rule that a tile whose bound value resolved to nothing
 * is not drawn. That was wrong, and CI caught it: the tiles parser fills
 * `value` only from a trailing NUMBER, so `{{tiles: Economic Moderate int=0.8,
 * Tenant Moderate int=0.7}}` parses to `label: "Economic Moderate", value: ""`
 * — a perfectly good qualitative tile, shaded by its intensity, which that
 * rule deleted along with the whole figure.
 *
 * The two are not the same thing. `renderKpiGridHtml` drops a BINDING that
 * resolved to nothing, which is a fact about the record; this is a directive
 * that never had a separate value, which is a fact about the grammar. So the
 * repair fires only where a figure is demonstrably stranded — an empty value
 * slot AND a number in the label — and every other tile is drawn exactly as it
 * was.
 */
export function tileWithItsFigure(tile: TileItem): TileItem {
  const value = String(tile?.value ?? '').trim();
  if (value) return tile;
  const label = String(tile?.label ?? '').trim();
  const at = label.search(/\d/u);
  if (at <= 0) return tile;
  const head = label.slice(0, at).replace(/[\s:·•,-]+$/u, '').trim();
  const tail = label.slice(at).trim();
  return head && tail ? { ...tile, label: head, value: tail } : tile;
}

export function renderTiles(
  ctx: ChartContext,
  tiles: TileItem[],
  opts: { title?: string; cols?: number } = {},
): string {
  if (!tiles.length) return '';
  const cols = Math.min(opts.cols ?? Math.min(tiles.length, 4), 6);
  const cellW = 130, gap = 8;
  const padL = 12, padT = opts.title ? 38 : 12, padB = 12;
  const w = padL * 2 + cols * cellW + (cols - 1) * gap;
  const inner = cellW - 24;
  const rows = Math.ceil(tiles.length / cols);

  // Every line of text is fitted to the cell — a label, a value or a sub-line
  // that ran past its tile ran into the next tile's ("Regional service hub"
  // printed through "Regional city" on the reference render). A value the
  // models write as a phrase rather than a figure is set at the label size,
  // on up to two lines; the cell height is what the tallest tile needs.
  const labelChar = unitsPerChar(ctx, w, 'micro', true) + ptToUnits(0.9, w, ctx.widthMm);
  const microChar = unitsPerChar(ctx, w, 'micro');
  const drawn = tiles.map(tileWithItsFigure);
  const fitted = drawn.map((t) => {
    const label = fitLines((t.label ?? '').toUpperCase(), inner, labelChar, 2);
    const valueText = String(t.value ?? '');
    const asFigure = valueText.length <= Math.floor(inner / unitsPerChar(ctx, w, 'value'));
    const value = asFigure ? [valueText] : fitLines(valueText, inner, unitsPerChar(ctx, w, 'label'), 2);
    const sub = t.sub ? fitLines(t.sub, inner, microChar, 2) : [];
    return { label, value, asFigure, sub };
  });
  const labelStep = 12, valueStep = 18, subStep = 12;
  const cellH = Math.max(88, ...fitted.map((f) =>
    20 + (f.label.length - 1) * labelStep + 14 + (f.asFigure ? 22 : f.value.length * valueStep) + 8 + f.sub.length * subStep + 12));
  const h = padT + rows * cellH + (rows - 1) * gap + padB;

  const cells = drawn.map((t, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = padL + c * (cellW + gap), y = padT + r * (cellH + gap);
    const f = fitted[i];
    const alpha = 0.08 + Math.max(0, Math.min(1, t.intensity ?? 0.5)) * 0.42;
    const valueTop = y + 20 + (f.label.length - 1) * labelStep + 14;
    const valueBottom = valueTop + (f.asFigure ? 22 : f.value.length * valueStep);
    return `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="4" `
      + `fill="${withAlpha(ctx.palette.accent, alpha)}" stroke="${ctx.palette.rule}" stroke-width="0.6"/>`
      + f.label.map((line, j) => text(ctx, w, { x: x + 12, y: y + 20 + j * labelStep, pt: 'micro', fill: ctx.palette.inkMuted, tracking: 0.9 }, svgEscape(line))).join('')
      + (f.asFigure
        ? text(ctx, w, { x: x + 12, y: valueTop + 18, pt: 'value', fill: ctx.palette.ink, stack: 'display', weight: 700, tabular: true }, svgEscape(f.value[0] ?? ''))
        : f.value.map((line, j) => text(ctx, w, { x: x + 12, y: valueTop + 14 + j * valueStep, pt: 'label', fill: ctx.palette.ink, stack: 'display', weight: 700 }, svgEscape(line))).join(''))
      + f.sub.map((line, j) => text(ctx, w, { x: x + 12, y: valueBottom + 10 + j * subStep, pt: 'micro', fill: ctx.palette.inkMuted }, svgEscape(line))).join('');
  }).join('');

  const title = opts.title
    ? text(ctx, w, { x: padL, y: 24, pt: 'title', fill: ctx.palette.ink, stack: 'display', weight: 700 }, svgEscape(opts.title))
      + `<line x1="${padL}" x2="${w - padL}" y1="30" y2="30" stroke="${ctx.palette.rule}" stroke-width="0.5"/>`
    : '';
  return `${svgOpen(w, h)}${title}${cells}</svg>`;
}

export interface TimelineItem { phase: string; label: string }

/** Infrastructure ribbon — Existing → 0-2y → 3-5y → 5y+. */
export function renderTimelineRibbon(
  ctx: ChartContext,
  items: TimelineItem[],
  opts: { title?: string } = {},
): string {
  const phases = ['Existing', '0-2y', '3-5y', '5y+'];
  const w = CHART_WIDTH.wide, axisY = 86;
  // The markers sit where every one of them gets the same measure for its
  // labels: an interior label is centred and may reach halfway to either
  // neighbour, an end label is anchored to the edge and may reach halfway to
  // its one neighbour. With the stops at 44 the end measures were 136 units
  // against the interior 208, and with no fitting at all "Further road and
  // transport…" (centred on the 3-5Y stop) set straight through "Ongoing
  // renewal of communit…" (anchored to the right edge) on the reference
  // render (RS-3c, 14 Sep 2026).
  const padX = 98, edge = 12, gap = 8, lineStep = 15;
  const step = (w - padX * 2) / (phases.length - 1);
  const labelUnits = step - gap * 2;
  const labelChar = unitsPerChar(ctx, w, 'micro');

  /*
   * Which stop an item belongs to — or none, which is not the same as 5y+.
   *
   * Two faults, both measured on the Cowra Compass's second timeline. The
   * range separators were `-?`, a plain hyphen, so `0–2y` and `3–5y` written
   * with EN-DASHES matched neither branch; and the function ended
   * `return '5y+'`, so both fell through to it. The rendered page put
   * "Ongoing park & sportsfield maintenance" — the model's NEXT TWO YEARS —
   * under "5Y+", and stacked a second item on top of it.
   *
   * Placing an unrecognised phase at the far end of an axis is inventing a
   * horizon, which is exactly what §3 forbids: unknown timing stays unknown.
   * So the separator now admits every dash a model writes, and anything still
   * unrecognised returns null and the ribbon refuses — the caller tabulates
   * the model's own phase words instead, which is the only honest reading.
   */
  const DASH = '[-–—]';
  const phaseOf = (p: string): string | null => {
    const t = p.toLowerCase().trim();
    if (/existing|now|current|today|in\s+place/.test(t)) return 'Existing';
    if (new RegExp(`0\\s*(?:${DASH}|to)?\\s*2|short(?:[-\\s]?term)?`).test(t)) return '0-2y';
    if (new RegExp(`3\\s*(?:${DASH}|to)?\\s*5|medium(?:[-\\s]?term)?`).test(t)) return '3-5y';
    if (/\b5\s*(?:y|yr|year)?s?\s*\+|beyond|long(?:[-\s]?term)?/.test(t)) return '5y+';
    return null;
  };
  const grouped = new Map<string, TimelineItem[]>(phases.map((p) => [p, []]));
  for (const it of items) {
    const phase = phaseOf(it.phase);
    // One unreadable phase and the whole ribbon declines: drawing the rest
    // would print a pipeline missing a stage with nothing to say so.
    if (phase === null) return '';
    grouped.get(phase)?.push(it);
  }
  // A stop draws two items. A third would be dropped silently, and a dropped
  // milestone leaves no mark on the page — the defect this whole pass is
  // about.
  for (const list of grouped.values()) if (list.length > 2) return '';

  const markers = phases.map((phase, i) => {
    const x = padX + i * step;
    const list = (grouped.get(phase) ?? []).slice(0, 2);
    // The end labels align to the edge; only the interior ones centre.
    //
    // Centring all four put the first label's midpoint at `padX` — 44 units
    // into a 760-unit viewBox — so a 28-character micro label spanned roughly
    // −16 to 104 and the SVG clipped its first glyph. Read off a render:
    // "Rail within 900m" printed as "ail within 900m" under the Existing dot,
    // on every timeline in the corpus. The last marker overflowed the right
    // edge by the same amount.
    const last = phases.length - 1;
    const anchor = i === 0 ? 'start' : i === last ? 'end' : 'middle';
    const labelX = i === 0 ? edge : i === last ? w - edge : x;
    /*
     * A milestone gets the lines it needs, and the drawing grows for them.
     *
     * Two lines cut five labels on the Cowra Compass — "Redfern St,
     * hospital,…", "sportsfield maintenance,…", "community facility…",
     * "community and civic…", "transport improvements…" — so the reader was
     * told a pipeline stage exists and not what it is. §4's rule is to
     * increase the component's space before shrinking its text, and the space
     * is already elastic: `deepest` below sizes the drawing to the tallest
     * stack, so more lines cost height rather than legibility.
     *
     * Four, not unbounded. A marker whose measure is a quarter of the width
     * cannot absorb a sentence, and a stop that needed more than four lines
     * would push the ribbon past a page on its own; `fitLines` still ends the
     * last line with an ellipsis in that case, which is now the rare
     * exception rather than the ordinary outcome. Where BOTH items at a stop
     * are long the pair shares the budget, so two of four each.
     */
    const linesPerItem = list.length > 1 ? 2 : 4;
    const rows = list.flatMap((it, j) => fitLines(it.label, labelUnits, labelChar, linesPerItem).map((line) => ({ line, weight: j === 0 ? 700 : 500 })));
    const labels = rows.map((row, k) => text(ctx, w,
      { x: labelX, y: axisY + 36 + k * lineStep, pt: 'micro', fill: ctx.palette.ink, anchor, weight: row.weight },
      svgEscape(row.line))).join('');
    return { rows: rows.length, svg: `<circle cx="${x.toFixed(1)}" cy="${axisY}" r="8" fill="${i === 0 ? ctx.palette.ink : ctx.palette.accent}" stroke="${ctx.palette.ground}" stroke-width="2"/>`
      + text(ctx, w, { x, y: axisY - 24, pt: 'micro', fill: ctx.palette.inkMuted, anchor: 'middle', weight: 700, tracking: 1 }, svgEscape(phase.toUpperCase()))
      + labels };
  });
  const deepest = Math.max(2, ...markers.map((m) => m.rows));
  // The drawing grows with the deepest label stack, so a fourth line is never
  // set past the bottom of the ground.
  const h = axisY + 36 + (deepest - 1) * lineStep + 30;

  const ribbon = `M ${padX} ${axisY} C ${padX + step * 0.5} ${axisY - 18}, ${padX + step * 0.5} ${axisY + 18}, ${padX + step} ${axisY} `
    + `S ${padX + step * 1.5} ${axisY + 18}, ${padX + step * 2} ${axisY} `
    + `S ${padX + step * 2.5} ${axisY - 18}, ${padX + step * 3} ${axisY}`;

  return `${svgOpen(w, h)}
    <rect width="${w}" height="${h}" rx="6" fill="${ctx.palette.ground}"/>
    ${text(ctx, w, { x: 24, y: 26, pt: 'title', fill: ctx.palette.ink, stack: 'display', weight: 700 }, svgEscape(opts.title ?? 'Infrastructure pipeline'))}
    <path d="${ribbon}" fill="none" stroke="${ctx.palette.rule}" stroke-width="8" stroke-linecap="round"/>
    <path d="${ribbon}" fill="none" stroke="${ctx.palette.accent}" stroke-width="3" stroke-linecap="round"/>
    ${markers.map((m) => m.svg).join('')}
  </svg>`;
}
