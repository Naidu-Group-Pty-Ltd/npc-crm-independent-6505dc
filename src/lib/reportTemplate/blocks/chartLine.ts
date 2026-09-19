/**
 * Line chart — jsPDF.
 *
 * The series semantics are `charts.html.ts`'s `readSeries`, deliberately: the
 * two renderers must read an authored block the same way, or the same template
 * plots different numbers depending on which engine drew it.
 *
 * Props: x, y, width, height, dataPath | data, labelKey, valueKey, title?,
 * caption?, accent?.
 *
 * The axis is laboured over because its HTML twin's header records what it
 * cost: three dashed gridlines with no label against any of them, so a reader
 * could see that equity rose and could not tell whether it rose to $100,000 or
 * to $1.1m. Ticks are labelled here for the same reason.
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { resolveDataPath, toArray, toNumber } from './_data';
import { hex } from './_shared';

/** Gridlines across the plot, and therefore ticks labelled down the axis. */
const Y_TICKS = 4;

interface Point { label: string; value: number }

/** `charts.html.ts`'s `readSeries`, so both engines read one block alike. */
function readSeries(p: Record<string, unknown>, ctx: BlockRenderContext): Point[] {
  const raw = p.dataPath ? resolveDataPath(p.dataPath, ctx) : p.data;
  const labelKey = String(p.labelKey ?? 'label');
  const valueKey = String(p.valueKey ?? 'value');
  return toArray(raw).map((it: unknown, i: number): Point => {
    if (typeof it === 'number') return { label: String(i + 1), value: it };
    const o = (it ?? {}) as Record<string, unknown>;
    return {
      label: String(o[labelKey] ?? o.name ?? i + 1),
      value: toNumber(o[valueKey] ?? o.y ?? o.count ?? 0),
    };
  });
}

/** Compact enough for an axis, and never scientific notation. */
function axisLabel(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return a >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
}

export function drawChartLineBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);
  const h = Number(p.height ?? 240);

  const ink = hex(resolveBindableColor(p.color ?? 'token:foreground', ctx, '#1A1A1A'));
  const muted = hex(resolveBindableColor(p.mutedColor ?? 'token:muted', ctx, '#666666'));
  const accent = hex(resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50'));

  let top = y;
  const title = resolveBindable(p.title, ctx);
  if (title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ink.r, ink.g, ink.b);
    doc.text(title, x, top + 2);
    top += 16;
  }

  const caption = resolveBindable(p.caption, ctx);
  const reserveBottom = caption ? 26 : 14;
  const AXIS_W = 34;
  const plotX = x + AXIS_W;
  const plotW = Math.max(10, w - AXIS_W);
  const plotH = Math.max(20, y + h - top - reserveBottom);

  const points = readSeries(p, ctx);
  if (points.length === 0) {
    // Nothing to plot is said plainly. It is NOT a placeholder panel telling a
    // client to export through some other pipeline — that sentence is for an
    // operator, and it has no business on a client's page.
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(muted.r, muted.g, muted.b);
    doc.text('No data available for this chart.', x + w / 2, top + plotH / 2, {
      align: 'center', baseline: 'middle',
    });
    return;
  }

  const values = points.map((pt) => pt.value);
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values, 0);
  const max = rawMax === rawMin ? rawMax + 1 : rawMax;
  const min = rawMin;
  const scaleY = (v: number) => top + plotH - ((v - min) / (max - min)) * plotH;

  // Gridlines, each one labelled — an unlabelled gridline is decoration.
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  for (let i = 0; i <= Y_TICKS; i += 1) {
    const v = min + ((max - min) * i) / Y_TICKS;
    const gy = scaleY(v);
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.4);
    doc.line(plotX, gy, plotX + plotW, gy);
    doc.setTextColor(muted.r, muted.g, muted.b);
    doc.text(axisLabel(v), plotX - 4, gy + 2, { align: 'right' });
  }

  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;
  const px = (i: number) => (points.length > 1 ? plotX + i * stepX : plotX + plotW / 2);

  doc.setDrawColor(accent.r, accent.g, accent.b);
  doc.setLineWidth(1.4);
  for (let i = 1; i < points.length; i += 1) {
    doc.line(px(i - 1), scaleY(points[i - 1].value), px(i), scaleY(points[i].value));
  }

  doc.setFillColor(accent.r, accent.g, accent.b);
  for (const [i, pt] of points.entries()) {
    doc.circle(px(i), scaleY(pt.value), 1.6, 'F');
  }

  // Only the ends of the x axis are labelled. Every point labelled overlaps on
  // a ten-year series at this width, and overlapping text is less readable
  // than none.
  doc.setFontSize(7);
  doc.setTextColor(muted.r, muted.g, muted.b);
  doc.text(points[0].label, plotX, top + plotH + 10);
  if (points.length > 1) {
    doc.text(points[points.length - 1].label, plotX + plotW, top + plotH + 10, { align: 'right' });
  }

  if (caption) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(muted.r, muted.g, muted.b);
    doc.text(caption, x + w / 2, y + h - 4, { align: 'center', maxWidth: w });
  }
}
