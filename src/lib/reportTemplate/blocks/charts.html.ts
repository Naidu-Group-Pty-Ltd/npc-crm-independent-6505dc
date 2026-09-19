/**
 * Phase 6 — native SVG charts. Every chart renders inline SVG so WeasyPrint
 * produces vector output without external services. Inputs accept either a
 * raw data array or a `dataPath` that resolves against the bound report data.
 *
 * Chart types: bar, stacked-bar, line, area, pie, donut, scatter, radar,
 * sparkline (already exists in extras), heatmap, kpi-strip, legend.
 */
import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { absBoxStyle, esc, type HtmlBlockContext } from './_shared.html';
import { resolveDataPath, toArray, toNumber, formatCell, colorFromPalette } from './_data';
// One spelling of an axis figure across the programme. `reportDesign/charts.pure.ts`
// is the canonical module the flowing render routes draw with; `src/lib/reportDesign`
// is its bridge (see `designSystemSourceOfTruth.spec.ts`).
import { formatAxisValue, type AxisMode } from '../../reportDesign/charts.pure';

type Series = { label: string; value: number; color?: string };

function safeChartColor(input: unknown, ctx: HtmlBlockContext, fallback = '#BF9B50'): string {
  return resolveBindableColor(input, ctx, fallback);
}

/**
 * The ink a chart's furniture is drawn in — titles, tick labels, captions,
 * grid rules — read from the template's own tokens.
 *
 * These were literal (`#1A1A1A` titles, `#666` ticks, `#EAE3CB` grid), which
 * is the ink of a light page. On the Midnight structure every chart title
 * and every axis figure printed near-black on an obsidian ground: "Projected
 * equity position" and its `Equity` axis title read as ILLEGIBLE on the
 * long reference report (RS-3, 14 Sep 2026). The fallbacks are the old
 * literals, so a template without the tokens draws exactly as before.
 */
function chartInk(ctx: HtmlBlockContext): { ink: string; muted: string; line: string; onField: string } {
  return {
    ink: resolveBindableColor('token:ink', ctx, '#1A1A1A'),
    muted: resolveBindableColor('token:muted', ctx, '#666666'),
    line: resolveBindableColor('token:line', ctx, '#EAE3CB'),
    onField: resolveBindableColor('token:onPrimary', ctx, '#FFFFFF'),
  };
}

function readSeries(p: Record<string, unknown>, ctx: HtmlBlockContext): Series[] {
  const raw = p.dataPath ? resolveDataPath(p.dataPath, ctx) : p.data;
  const items = toArray(raw);
  const labelKey = String(p.labelKey ?? 'label');
  const valueKey = String(p.valueKey ?? 'value');
  // Absent is never zero. A series whose every value is missing is no series,
  // and a chart drawn from it is an axis with nothing on it — measured on a
  // record with no financials (RS-3, 14 Sep 2026): the ten-year equity chart
  // drew a `$1 / $0 / $-1` scale around an empty plot. Every renderer below
  // draws nothing for an empty series rather than a frame.
  const carriesValue = (it: any): boolean => {
    if (typeof it === 'number') return Number.isFinite(it);
    if (it == null || typeof it !== 'object') return false;
    const v = it[valueKey] ?? it.y ?? it.count;
    return v !== null && v !== undefined && v !== '';
  };
  if (!items.some(carriesValue)) return [];
  return items.map((it: any, i: number): Series => {
    if (typeof it === 'number') return { label: String(i + 1), value: it };
    return {
      label: String(it?.[labelKey] ?? it?.name ?? i + 1),
      value: toNumber(it?.[valueKey] ?? it?.y ?? it?.count ?? 0),
      color: it?.color,
    };
  });
}

function chartBox(p: Record<string, unknown>, ctx: HtmlBlockContext) {
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? ctx.page.width - 48);
  const h = Number(p.height ?? 220);
  return { x, y, w, h, style: absBoxStyle(p, { x, y, w, h }) };
}

function titleAndCaption(p: Record<string, unknown>, ctx: HtmlBlockContext): { titleHtml: string; captionHtml: string; reserveTop: number; reserveBottom: number } {
  const c = chartInk(ctx);
  const title = resolveBindable(p.title, ctx);
  const caption = resolveBindable(p.caption, ctx);
  const titleHtml = title
    ? `<div style="font-size:11pt;font-weight:600;margin-bottom:4pt;color:${c.ink};">${esc(title)}</div>`
    : '';
  const captionHtml = caption
    ? `<div style="text-align:center;font-style:italic;font-size:8pt;color:${c.muted};margin-top:4pt;">${esc(caption)}</div>`
    : '';
  return { titleHtml, captionHtml, reserveTop: title ? 18 : 0, reserveBottom: caption ? 14 : 0 };
}

// ─── Bar chart ───────────────────────────────────────────────────────────────
export function renderBarChartHtml(block: Block, ctx: HtmlBlockContext): string {
  const c = chartInk(ctx);
  const p = block.props as Record<string, unknown>;
  const series = readSeries(p, ctx);
  if (!series.length) return '';
  const box = chartBox(p, ctx);
  const meta = titleAndCaption(p, ctx);
  const palette = (p.palette as string[]) ?? undefined;
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const innerH = box.h - meta.reserveTop - meta.reserveBottom - 28;
  const innerW = box.w;
  const barGap = 6;
  const barW = series.length ? (innerW - barGap * (series.length + 1)) / series.length : 0;
  const horizontal = (p.orientation ?? 'vertical') === 'horizontal';

  /**
   * The domain always contains zero, and bars are measured from it.
   *
   * This used to be `max = Math.max(1, ...values)` with every bar drawn as
   * `value / max` of the plot height. On an all-negative series — which is what
   * a cash-flow projection is: 4,856 of the 4,860 stored elements are negative —
   * `max` fell back to 1, so a −$35,909 bar asked for a rect 35,909pt tall at a
   * negative height, which is invalid SVG and renders as nothing. A reader got
   * an empty plot frame where the chart should be, on a page whose whole subject
   * is the figure that is missing.
   *
   * Zero-based is also the only honest baseline for a chart carrying both signs:
   * scaling to the range alone would draw the least-bad year as a full-height
   * bar. The axis is drawn wherever zero falls, which is the top of the plot for
   * an all-negative series and the bottom for an all-positive one — so the
   * common case is unchanged, to the pixel.
   */
  const values = series.map((s) => s.value);
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  /**
   * Head room for the value printed above the tallest bar.
   *
   * A bar chart carries no axis because every bar is labelled with its own
   * figure — which makes a clipped label the same defect an unlabelled axis is.
   * The tallest bar reaches the top of the plot and its value was set at
   * `y - 3`, three points ABOVE the `viewBox`: on the Investment Compass's
   * ten-year projection drawn by Signal (`mf-01`), year ten's $1,116,298 — the
   * one figure the page exists to state — was the only bar with no number over
   * it. One 7pt line of head room, taken off the plot rather than added to the
   * figure, so the declared block height is unchanged.
   */
  const padT = !horizontal && hi > 0 ? 9 : 0;
  const plotH = Math.max(1, innerH - padT);
  /** Where zero sits, measured down from the top of the plot. */
  const zeroY = padT + (hi / span) * plotH;
  const zeroX = 60 + (-lo / span) * (innerW - 60);

  const bars = series.map((s, i) => {
    const color = safeChartColor(s.color ?? colorFromPalette(i, palette), ctx, accent);
    // A caller that declares an axis unit gets it here too, so the bar and the
    // line variants of one series are worded the same way. Absent, the previous
    // `formatCell` behaviour is unchanged.
    const label = esc(p.axis
      ? formatAxisValue(s.value, axisMode(p.axis))
      : formatCell(s.value, (p.format as any) ?? 'auto'));
    if (horizontal) {
      const rowH = innerH / series.length;
      const yPos = i * rowH + 4;
      const len = (Math.abs(s.value) / span) * (innerW - 60);
      const xStart = s.value < 0 ? zeroX - len : zeroX;
      return `<g>
        <text x="0" y="${yPos + rowH / 2 + 3}" font-size="8" fill="${c.ink}">${esc(s.label)}</text>
        <rect x="${xStart.toFixed(1)}" y="${yPos}" width="${len.toFixed(1)}" height="${rowH - 8}" fill="${color}" rx="2"/>
        <text x="${(xStart + len + 4).toFixed(1)}" y="${yPos + rowH / 2 + 3}" font-size="8" fill="${c.ink}">${label}</text>
      </g>`;
    }
    const xPos = barGap + i * (barW + barGap);
    const height = (Math.abs(s.value) / span) * plotH;
    const yPos = s.value < 0 ? zeroY : zeroY - height;
    // The value sits outside the bar on whichever side the bar grew.
    const valueY = s.value < 0 ? yPos + height + 9 : yPos - 3;
    return `<g>
      <rect x="${xPos}" y="${yPos.toFixed(1)}" width="${barW}" height="${height.toFixed(1)}" fill="${color}" rx="2"/>
      <text x="${xPos + barW / 2}" y="${innerH + 12}" font-size="7" fill="${c.muted}" text-anchor="middle">${esc(s.label)}</text>
      <text x="${xPos + barW / 2}" y="${valueY.toFixed(1)}" font-size="7" fill="${c.ink}" text-anchor="middle">${label}</text>
    </g>`;
  }).join('');

  // Only where zero is inside the plot rather than on its edge, which is the
  // case a reader cannot infer from the bars alone.
  const zeroRule = !horizontal && lo < 0 && hi > 0
    ? `<line x1="0" x2="${innerW}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="${c.muted}" stroke-width="0.75"/>`
    : '';

  return `<div style="${box.style}">${meta.titleHtml}
    <svg viewBox="0 0 ${innerW} ${innerH + 16}" style="width:100%;height:${innerH + 16}pt;display:block;">
      ${zeroRule}
      ${bars}
    </svg>
    ${meta.captionHtml}
  </div>`;
}

// ─── Line / area chart ────────────────────────────────────────────────────────

/**
 * The value domain a line or area chart is drawn in.
 *
 * Zero is always in it, which is the pre-existing behaviour and is what keeps
 * this change from restating every chart in the catalogue at a new baseline —
 * the growth on a plot the reader has already seen must not appear to change
 * because an axis was added beside it.
 *
 * `Math.max(1, …)` is what this replaces, and it was the same defect the bar
 * chart records: on an all-negative series the top of the plot was pinned to a
 * value of **1** that is in no series and means nothing. Nobody could see it
 * while the axis was unlabelled; with tick labels it would have printed `$1`
 * over a chart of losses.
 */
function chartDomain(series: Series[]): { lo: number; hi: number } {
  const values = series.map((s) => s.value);
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (lo === hi) { lo -= 1; hi += 1; }
  return { lo, hi };
}

/** How the y-axis ticks are worded. `plain` is the safe default: it invents no unit. */
function axisMode(value: unknown): AxisMode {
  return value === 'money' || value === 'percent' || value === 'plain' ? value : 'plain';
}

export function renderLineChartHtml(block: Block, ctx: HtmlBlockContext): string {
  return renderLineOrAreaHtml(block, ctx, false);
}
export function renderAreaChartHtml(block: Block, ctx: HtmlBlockContext): string {
  return renderLineOrAreaHtml(block, ctx, true);
}

/** Gridlines drawn across the plot, and therefore ticks labelled down the axis. */
const Y_TICKS = 4;

/**
 * A line or area chart, with an axis a reader can actually read off.
 *
 * ## What was wrong
 *
 * Measured on the Investment Compass's ten-year projection page, rendered
 * against the stored report `1be16c4a` (93 Bimbadeen Avenue): the chart drew
 * three dashed gridlines at 25%, 50% and 75% of the plot with **no label
 * against any of them**, no axis, and no value anywhere on the figure. A
 * reader could see that equity rose and could not tell whether it rose to
 * $100,000 or to $10,000,000. It is $1.1m.
 *
 * Two more defects the same render showed, both at the ends of the x axis:
 * every label was `text-anchor:middle` and the first and last points sat at
 * x=0 and x=w, so "Yr 1" printed as "1" with its "Yr" off the left edge and
 * "Yr 10" printed as "Yr" with its "10" off the right. This is the defect
 * `renderTimelineRibbon` already carries the fix for — the end labels anchor
 * to the edge and only the interior ones centre — arrived at independently in
 * a second chart implementation, which is what a shared axis helper is for.
 *
 * The tick wording comes from `formatAxisValue` in
 * `reportDesign/charts.pure.ts`, the module the flowing render routes draw
 * their own fan chart with, so `$1.1m` is spelled one way in this programme.
 */
function renderLineOrAreaHtml(block: Block, ctx: HtmlBlockContext, fill: boolean): string {
  const c = chartInk(ctx);
  const p = block.props as Record<string, unknown>;
  const series = readSeries(p, ctx);
  if (!series.length) return '';
  const box = chartBox(p, ctx);
  const meta = titleAndCaption(p, ctx);
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const innerH = box.h - meta.reserveTop - meta.reserveBottom - 28;
  const innerW = box.w;

  const mode = axisMode(p.axis);
  const { lo, hi } = chartDomain(series);
  const span = hi - lo;
  const ticks = Array.from({ length: Y_TICKS + 1 }, (_, t) => lo + (span * t) / Y_TICKS);
  const tickText = ticks.map((v) => formatAxisValue(v, mode));

  /**
   * The gutter the tick labels are set in.
   *
   * Measured from the longest label rather than fixed, because `$1.1m` and
   * `1,116,298` are not the same width and a gutter that is too narrow sets the
   * label off the left edge of the figure — which is the defect being fixed,
   * moved eight points to the left.
   */
  const axisTitle = resolveBindable(p.yAxisLabel, ctx);
  const labelW = Math.max(...tickText.map((t) => t.length)) * 3.9 + 6;
  const padL = Math.min(innerW * 0.28, labelW + (axisTitle ? 14 : 0));
  /** The last dot is centred on the plot's right edge; this keeps its radius inside. */
  const padR = 4;
  const plotW = Math.max(1, innerW - padL - padR);
  /**
   * Head room for the topmost tick label.
   *
   * Its text is centred on the gridline, so a plot that starts at y=0 sets the
   * top label's upper half outside the `viewBox` — where it is clipped, and
   * printed into the chart's own title. Seen on the first render of this fix:
   * `$1.1m` sheared through "Projected equity position".
   */
  const padT = 5;
  const plotH = Math.max(1, innerH - padT);

  const px = (i: number) => padL + (series.length > 1 ? (i / (series.length - 1)) * plotW : plotW / 2);
  const py = (v: number) => padT + plotH - ((v - lo) / span) * plotH;

  const points = series.map((s, i) => ({ x: px(i), y: py(s.value), s }));
  const line = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
  const baseline = py(Math.max(lo, Math.min(hi, 0))).toFixed(1);
  const area = points.length
    ? `${line} L${points[points.length - 1].x.toFixed(1)},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`
    : '';

  const grid = ticks.map((v, t) => {
    const y = py(v);
    return `<line x1="${padL}" x2="${(padL + plotW).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${c.line}"${t === 0 ? '' : ' stroke-dasharray="2 3"'}/>`
      + `<text x="${(padL - 4).toFixed(1)}" y="${(y + 2.5).toFixed(1)}" text-anchor="end" font-size="6.5" fill="${c.muted}">${esc(tickText[t])}</text>`;
  }).join('');

  // The axis itself, so the labels read as a scale rather than as loose figures.
  const axisRule = `<line x1="${padL}" x2="${padL}" y1="${padT}" y2="${innerH}" stroke="${c.line}"/>`;

  const axisTitleSvg = axisTitle
    ? `<text transform="translate(6,${(padT + plotH / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="6.5" fill="${c.muted}" letter-spacing="0.39">${esc(String(axisTitle).toUpperCase())}</text>`
    : '';

  // End labels anchor to the edge; only the interior ones centre. See the note
  // above — a centred label at either end of the plot is set half outside it.
  const labels = points.map((pt, i) => {
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    return `<text x="${pt.x.toFixed(1)}" y="${innerH + 12}" text-anchor="${anchor}" font-size="7" fill="${c.muted}">${esc(pt.s.label)}</text>`;
  }).join('');
  const dots = points.map((pt) => `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="2.5" fill="${accent}"/>`).join('');

  return `<div style="${box.style}">${meta.titleHtml}
    <svg viewBox="0 0 ${innerW} ${innerH + 16}" style="width:100%;height:${innerH + 16}pt;display:block;">
      ${grid}
      ${axisRule}
      ${axisTitleSvg}
      ${fill ? `<path d="${area}" fill="${accent}" fill-opacity="0.16"/>` : ''}
      <path d="${line}" fill="none" stroke="${accent}" stroke-width="1.6"/>
      ${dots}
      ${labels}
    </svg>
    ${meta.captionHtml}
  </div>`;
}

// ─── Pie / donut ─────────────────────────────────────────────────────────────
export function renderPieChartHtml(block: Block, ctx: HtmlBlockContext): string {
  return renderPieOrDonutHtml(block, ctx, 0);
}
export function renderDonutChartHtml(block: Block, ctx: HtmlBlockContext): string {
  return renderPieOrDonutHtml(block, ctx, 0.55);
}

function renderPieOrDonutHtml(block: Block, ctx: HtmlBlockContext, innerRatio: number): string {
  const c = chartInk(ctx);
  const p = block.props as Record<string, unknown>;
  const series = readSeries(p, ctx);
  if (!series.length) return '';
  const box = chartBox(p, ctx);
  const meta = titleAndCaption(p, ctx);
  const palette = (p.palette as string[]) ?? undefined;
  const total = Math.max(1e-9, series.reduce((a, b) => a + b.value, 0));
  const innerH = box.h - meta.reserveTop - meta.reserveBottom - 8;
  const size = Math.min(innerH, box.w * 0.6);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const ri = r * innerRatio;

  let acc = 0;
  const slices = series.map((s, i) => {
    const frac = s.value / total;
    const a0 = acc * Math.PI * 2 - Math.PI / 2;
    const a1 = (acc + frac) * Math.PI * 2 - Math.PI / 2;
    acc += frac;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const color = safeChartColor(s.color ?? colorFromPalette(i, palette), ctx);
    if (innerRatio > 0) {
      const ix0 = cx + ri * Math.cos(a0);
      const iy0 = cy + ri * Math.sin(a0);
      const ix1 = cx + ri * Math.cos(a1);
      const iy1 = cy + ri * Math.sin(a1);
      return `<path d="M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${ix1},${iy1} A${ri},${ri} 0 ${large} 0 ${ix0},${iy0} Z" fill="${color}"/>`;
    }
    return `<path d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z" fill="${color}"/>`;
  }).join('');

  const legend = series.map((s, i) => {
    const color = safeChartColor(s.color ?? colorFromPalette(i, palette), ctx);
    const pct = ((s.value / total) * 100).toFixed(1);
    return `<div style="display:flex;align-items:center;gap:6pt;font-size:8pt;color:${c.ink};">
      <span style="width:9pt;height:9pt;background:${color};border-radius:2pt;display:inline-block;"></span>
      <span style="flex:1;">${esc(s.label)}</span>
      <span style="font-variant-numeric:tabular-nums;color:${c.muted};">${pct}%</span>
    </div>`;
  }).join('');

  return `<div style="${box.style}">${meta.titleHtml}
    <div style="display:flex;gap:14pt;align-items:center;">
      <svg viewBox="0 0 ${size} ${size}" style="width:${size}pt;height:${size}pt;flex-shrink:0;">${slices}</svg>
      <div style="flex:1;display:flex;flex-direction:column;gap:4pt;">${legend}</div>
    </div>
    ${meta.captionHtml}
  </div>`;
}

// ─── Scatter ─────────────────────────────────────────────────────────────────
export function renderScatterChartHtml(block: Block, ctx: HtmlBlockContext): string {
  const c = chartInk(ctx);
  const p = block.props as Record<string, unknown>;
  const raw = p.dataPath ? resolveDataPath(p.dataPath, ctx) : p.data;
  const items = toArray(raw);
  const xKey = String(p.xKey ?? 'x');
  const yKey = String(p.yKey ?? 'y');
  const points = items.map((it: any) => ({ x: toNumber(it?.[xKey]), y: toNumber(it?.[yKey]), label: it?.label }));
  const box = chartBox(p, ctx);
  const meta = titleAndCaption(p, ctx);
  const innerH = box.h - meta.reserveTop - meta.reserveBottom - 28;
  const innerW = box.w;
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(0, ...xs), xMax = Math.max(1, ...xs);
  const yMin = Math.min(0, ...ys), yMax = Math.max(1, ...ys);
  const sx = (x: number) => ((x - xMin) / (xMax - xMin || 1)) * innerW;
  const sy = (y: number) => innerH - ((y - yMin) / (yMax - yMin || 1)) * innerH;
  const dots = points.map((pt) => `<circle cx="${sx(pt.x).toFixed(1)}" cy="${sy(pt.y).toFixed(1)}" r="3" fill="${accent}" fill-opacity="0.7"/>`).join('');
  const grid = [0.25, 0.5, 0.75].map((g) => `<line x1="0" x2="${innerW}" y1="${innerH * g}" y2="${innerH * g}" stroke="${c.line}" stroke-dasharray="2 3"/>`).join('');

  return `<div style="${box.style}">${meta.titleHtml}
    <svg viewBox="0 0 ${innerW} ${innerH + 16}" style="width:100%;height:${innerH + 16}pt;display:block;">
      ${grid}
      <line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="${c.muted}"/>
      <line x1="0" y1="0" x2="0" y2="${innerH}" stroke="${c.muted}"/>
      ${dots}
    </svg>
    ${meta.captionHtml}
  </div>`;
}

// ─── Radar ───────────────────────────────────────────────────────────────────
export function renderRadarChartHtml(block: Block, ctx: HtmlBlockContext): string {
  const c = chartInk(ctx);
  const p = block.props as Record<string, unknown>;
  const series = readSeries(p, ctx);
  if (!series.length) return '';
  const box = chartBox(p, ctx);
  const meta = titleAndCaption(p, ctx);
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const innerH = box.h - meta.reserveTop - meta.reserveBottom - 8;
  const size = Math.min(innerH, box.w);
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 28;
  const n = Math.max(3, series.length);
  const max = Math.max(1, ...series.map((s) => s.value));

  const angleAt = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const ringPath = (frac: number) => Array.from({ length: n }, (_, i) => {
    const a = angleAt(i);
    const x = cx + r * frac * Math.cos(a);
    const y = cy + r * frac * Math.sin(a);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ') + ' Z';

  const rings = [0.25, 0.5, 0.75, 1].map((f) => `<path d="${ringPath(f)}" fill="none" stroke="${c.line}" stroke-width="0.5"/>`).join('');
  const axes = Array.from({ length: n }, (_, i) => {
    const a = angleAt(i);
    return `<line x1="${cx}" y1="${cy}" x2="${(cx + r * Math.cos(a)).toFixed(1)}" y2="${(cy + r * Math.sin(a)).toFixed(1)}" stroke="${c.line}" stroke-width="0.5"/>`;
  }).join('');
  const points = series.map((s, i) => {
    const a = angleAt(i);
    const f = s.value / max;
    return `${cx + r * f * Math.cos(a)},${cy + r * f * Math.sin(a)}`;
  }).join(' ');
  const labels = series.map((s, i) => {
    const a = angleAt(i);
    const lx = cx + (r + 14) * Math.cos(a);
    const ly = cy + (r + 14) * Math.sin(a);
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="7" fill="${c.ink}">${esc(s.label)}</text>`;
  }).join('');

  return `<div style="${box.style}">${meta.titleHtml}
    <svg viewBox="0 0 ${size} ${size}" style="width:${size}pt;height:${size}pt;display:block;margin:0 auto;">
      ${rings}${axes}
      <polygon points="${points}" fill="${accent}" fill-opacity="0.25" stroke="${accent}" stroke-width="1.5"/>
      ${labels}
    </svg>
    ${meta.captionHtml}
  </div>`;
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────
export function renderHeatmapHtml(block: Block, ctx: HtmlBlockContext): string {
  const c = chartInk(ctx);
  const p = block.props as Record<string, unknown>;
  const raw = p.dataPath ? resolveDataPath(p.dataPath, ctx) : p.data;
  let matrix: number[][] = [];
  if (Array.isArray(raw) && Array.isArray(raw[0])) matrix = raw as number[][];
  else if (Array.isArray(raw)) matrix = [raw.map((v: any) => toNumber(v))];
  if (!matrix.length || !matrix.some((r) => r.length)) return '';
  const rowLabels = Array.isArray(p.rowLabels) ? (p.rowLabels as string[]) : matrix.map((_, i) => String(i + 1));
  const colLabels = Array.isArray(p.colLabels) ? (p.colLabels as string[]) : (matrix[0] ?? []).map((_, i) => String(i + 1));
  const box = chartBox(p, ctx);
  const meta = titleAndCaption(p, ctx);
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const innerH = box.h - meta.reserveTop - meta.reserveBottom - 28;
  const cellW = (box.w - 40) / Math.max(1, colLabels.length);
  const cellH = (innerH - 14) / Math.max(1, rowLabels.length);
  const flat = matrix.flat();
  const max = Math.max(1, ...flat);
  const min = Math.min(0, ...flat);

  const cells: string[] = [];
  matrix.forEach((row, ri) => {
    row.forEach((v, ci) => {
      const t = (v - min) / (max - min || 1);
      cells.push(`<rect x="${40 + ci * cellW}" y="${14 + ri * cellH}" width="${cellW - 1}" height="${cellH - 1}" fill="${accent}" fill-opacity="${Math.max(0.05, t).toFixed(2)}"/>
        <text x="${40 + ci * cellW + cellW / 2}" y="${14 + ri * cellH + cellH / 2 + 3}" text-anchor="middle" font-size="6" fill="${t > 0.55 ? c.onField : c.ink}">${esc(String(v))}</text>`);
    });
  });
  const colHeads = colLabels.map((l, i) => `<text x="${40 + i * cellW + cellW / 2}" y="10" text-anchor="middle" font-size="7" fill="${c.muted}">${esc(l)}</text>`).join('');
  const rowHeads = rowLabels.map((l, i) => `<text x="36" y="${14 + i * cellH + cellH / 2 + 3}" text-anchor="end" font-size="7" fill="${c.muted}">${esc(l)}</text>`).join('');

  return `<div style="${box.style}">${meta.titleHtml}
    <svg viewBox="0 0 ${box.w} ${innerH}" style="width:100%;height:${innerH}pt;display:block;">
      ${colHeads}${rowHeads}${cells.join('')}
    </svg>
    ${meta.captionHtml}
  </div>`;
}

// ─── KPI strip ───────────────────────────────────────────────────────────────
export function renderKpiStripHtml(block: Block, ctx: HtmlBlockContext): string {
  const c = chartInk(ctx);
  const p = block.props as Record<string, unknown>;
  const raw = p.dataPath ? resolveDataPath(p.dataPath, ctx) : p.items;
  const items = toArray(raw);
  const box = chartBox(p, ctx);
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const tileBg = resolveBindableColor(p.tileBg ?? '#FAF6EB', ctx, '#FAF6EB');
  const tiles = items.map((it: any, i: number) => {
    const label = String(it?.label ?? it?.name ?? '');
    const value = formatCell(it?.value, (it?.format as any) ?? (p.format as any) ?? 'auto');
    const delta = it?.delta;
    const dir = toNumber(delta) >= 0 ? '▲' : '▼';
    const deltaColor = toNumber(delta) >= 0 ? '#1F8A4C' : '#C0392B';
    return `<div style="flex:1;background:${tileBg};border-left:2pt solid ${accent};padding:8pt 10pt;border-radius:4pt;">
      <div style="font-size:8pt;color:${c.muted};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${esc(label)}</div>
      <div style="font-size:16pt;font-weight:700;color:${c.ink};margin-top:2pt;font-variant-numeric:tabular-nums;">${esc(value)}</div>
      ${delta != null ? `<div style="font-size:8pt;color:${deltaColor};margin-top:1pt;">${dir} ${esc(formatCell(Math.abs(toNumber(delta)), 'auto'))}</div>` : ''}
    </div>`;
  }).join('');
  return `<div style="${box.style};display:flex;gap:${Number(p.gap ?? 8)}pt;">${tiles}</div>`;
}

// ─── Legend ──────────────────────────────────────────────────────────────────
export function renderLegendHtml(block: Block, ctx: HtmlBlockContext): string {
  const c = chartInk(ctx);
  const p = block.props as Record<string, unknown>;
  const items = toArray(p.items);
  const palette = (p.palette as string[]) ?? undefined;
  const box = chartBox(p, ctx);
  const dir = p.direction === 'vertical' ? 'column' : 'row';
  const swatches = items.map((it: any, i: number) => {
    const color = safeChartColor(it?.color ?? colorFromPalette(i, palette), ctx);
    return `<div style="display:flex;align-items:center;gap:6pt;font-size:8pt;color:${c.ink};">
      <span style="width:10pt;height:10pt;background:${color};border-radius:2pt;display:inline-block;"></span>
      <span>${esc(it?.label ?? it)}</span>
    </div>`;
  }).join('');
  return `<div style="${box.style};display:flex;flex-direction:${dir};gap:8pt;flex-wrap:wrap;align-items:center;">${swatches}</div>`;
}

// ─── Stacked bar ─────────────────────────────────────────────────────────────
export function renderStackedBarChartHtml(block: Block, ctx: HtmlBlockContext): string {
  const c = chartInk(ctx);
  const p = block.props as Record<string, unknown>;
  const raw = p.dataPath ? resolveDataPath(p.dataPath, ctx) : p.data;
  const rows = toArray(raw);
  if (!rows.length) return '';
  const stackKeys = Array.isArray(p.stackKeys) ? (p.stackKeys as string[]) : [];
  const labelKey = String(p.labelKey ?? 'label');
  const palette = (p.palette as string[]) ?? undefined;
  const box = chartBox(p, ctx);
  const meta = titleAndCaption(p, ctx);
  const innerH = box.h - meta.reserveTop - meta.reserveBottom - 28;
  const innerW = box.w;
  const totals = rows.map((r: any) => stackKeys.reduce((a, k) => a + toNumber(r?.[k]), 0));
  const max = Math.max(1, ...totals);
  const gap = 6;
  const bw = rows.length ? (innerW - gap * (rows.length + 1)) / rows.length : 0;

  const bars = rows.map((row: any, i: number) => {
    const xPos = gap + i * (bw + gap);
    let yAcc = innerH;
    const segs = stackKeys.map((k, si) => {
      const v = toNumber(row?.[k]);
      const h = (v / max) * innerH;
      yAcc -= h;
      const color = safeChartColor(colorFromPalette(si, palette), ctx);
      return `<rect x="${xPos}" y="${yAcc}" width="${bw}" height="${h}" fill="${color}"/>`;
    }).join('');
    return `<g>
      ${segs}
      <text x="${xPos + bw / 2}" y="${innerH + 12}" text-anchor="middle" font-size="7" fill="${c.muted}">${esc(String(row?.[labelKey] ?? ''))}</text>
    </g>`;
  }).join('');
  const legend = stackKeys.map((k, si) => `<div style="display:flex;align-items:center;gap:4pt;font-size:8pt;"><span style="width:8pt;height:8pt;background:${safeChartColor(colorFromPalette(si, palette), ctx)};border-radius:1pt;"></span>${esc(k)}</div>`).join('');

  return `<div style="${box.style}">${meta.titleHtml}
    <svg viewBox="0 0 ${innerW} ${innerH + 16}" style="width:100%;height:${innerH + 16}pt;display:block;">${bars}</svg>
    <div style="display:flex;gap:12pt;justify-content:center;margin-top:4pt;">${legend}</div>
    ${meta.captionHtml}
  </div>`;
}
