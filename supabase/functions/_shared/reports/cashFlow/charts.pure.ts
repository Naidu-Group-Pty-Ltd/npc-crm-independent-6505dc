/**
 * The two pictures this document has a use for.
 *
 * The projection table already states every figure. A chart earns its page only
 * by answering something the table answers slowly, and in a ten-by-twenty grid
 * of numbers there are exactly two such questions:
 *
 *   Equity build   Where the value goes and where the debt goes, year by year.
 *                  Reading that off the table means tracking two columns down
 *                  ten rows and subtracting each pair in your head.
 *   Cash position  Which years cost money and which years make it. The sign
 *                  changes somewhere in the middle and the table does not say
 *                  where at a glance.
 *
 * Both are drawn from the payload the tables are drawn from, so neither can
 * disagree with the page it sits on. Both return `''` when there is nothing to
 * draw, and the section prints its table either way.
 *
 * They are read TOGETHER, on one page (the owner's rule, 28 Sep 2026): the
 * equity build above, the cash position below. So they share one horizontal
 * geometry (`columnGeometry`) — year 3's column sits directly over year 3's
 * column — and one axis vocabulary: every year is labelled, and the value axis
 * steps on round figures (`niceScale`) rather than on quarters of the maximum,
 * which printed ticks such as "$799k" that name no figure anyone would say.
 *
 * The stacked column is written here rather than taken from the shared chart
 * module because the shared module has no stacked column and adding one for a
 * single caller is how a chart library grows things nobody uses. If a second
 * format wants it, that is when it moves.
 */

import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import {
  CHART_TEXT_PT,
  CHART_WIDTH,
  chartContext,
  chartFigure,
  chartPalette,
  ptToUnits,
  svgEscape,
  withAlpha,
  type ChartContext,
} from '../../reportDesign/charts.pure.ts';
import type { CashFlowProjection } from './payload.pure.ts';

/** Past this many columns the labels collide; the table is the better answer. */
const MAX_COLUMNS = 20;

/** The viewBox width both charts share, so their columns align on the page. */
const VIEW_W = CHART_WIDTH.wide;
const PAD_L = 58;
const PAD_R = 10;

/** A label, sized and placed the way the shared module sizes its own. */
function label(
  ctx: ChartContext,
  viewBox: number,
  opts: { x: number; y: number; pt: keyof typeof CHART_TEXT_PT; fill: string; anchor?: string; weight?: number },
  content: string,
): string {
  const size = ptToUnits(CHART_TEXT_PT[opts.pt], viewBox, ctx.widthMm);
  return `<text x="${opts.x.toFixed(1)}" y="${opts.y.toFixed(1)}"`
    + (opts.anchor ? ` text-anchor="${opts.anchor}"` : '')
    + ` font-size="${size}"`
    + (opts.weight ? ` font-weight="${opts.weight}"` : '')
    + ` fill="${opts.fill}"`
    + ` style="font-variant-numeric:lining-nums tabular-nums;">${content}</text>`;
}

/** One column slot per year, the same in both charts. */
function columnGeometry(count: number) {
  const plotW = VIEW_W - PAD_L - PAD_R;
  const slot = plotW / count;
  // Wide enough to carry a figure such as "-$19.1k" inside it at the
  // 7.5pt floor; the gap between columns stays a third of a column.
  const barW = Math.max(6, slot * 0.76);
  return {
    slot,
    barW,
    x: (i: number) => PAD_L + i * slot + (slot - barW) / 2,
    centre: (i: number) => PAD_L + i * slot + slot / 2,
  };
}

/**
 * Round axis steps: 1, 2, 2.5 or 5 of a power of ten, the smallest that
 * covers `max` in at most `maxSteps` steps. Exported for the spec.
 */
export function niceScale(max: number, maxSteps = 5): { step: number; top: number } {
  if (!(max > 0)) return { step: 1, top: 1 };
  const magnitude = 10 ** Math.floor(Math.log10(max / maxSteps));
  for (const m of [1, 2, 2.5, 5, 10, 20, 25, 50]) {
    const step = m * magnitude;
    const steps = Math.ceil(max / step - 1e-9);
    if (steps <= maxSteps) return { step, top: steps * step };
  }
  const step = 100 * magnitude;
  return { step, top: Math.ceil(max / step) * step };
}

/** `$1.5m`, `$500k`, `$2m`, `-$8.6k` — an axis or column figure, never a long number. */
export function compactMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const trim = (n: number, dp: number) => n.toFixed(dp).replace(/\.0+$/, '');
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000, 2).replace(/(\.\d)0$/, '$1')}m`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000, abs >= 100_000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/** The year labels under a row of columns: every year, never every other one. */
function yearTicks(
  ctx: ChartContext,
  rows: readonly { year: number }[],
  y: number,
  fill: string,
): string {
  const g = columnGeometry(rows.length);
  return rows.map((row, i) => label(ctx, VIEW_W,
    { x: g.centre(i), y, pt: 'micro', fill, anchor: 'middle' },
    svgEscape(`Yr ${row.year}`))).join('');
}

/**
 * Value split into equity and debt, one column per year.
 *
 * Stacked rather than side-by-side on purpose: the two parts sum to the
 * property's value, and a stack says "these are the same thing divided" where
 * paired bars say "these are two things compared".
 */
export function equityBuildChart(
  p: CashFlowProjection,
  palette: ResolvedReportPalette,
): string {
  const rows = p.years.slice(0, MAX_COLUMNS);
  if (rows.length < 2) return '';

  const max = Math.max(...rows.map((y) => y.propertyValue.value));
  if (!(max > 0)) return '';

  const ctx = chartContext(palette);
  const pal = chartPalette(palette);
  const g = columnGeometry(rows.length);
  const padT = 24;
  const padB = 26;
  const h = 204;
  const plotH = h - padT - padB;
  const { step, top } = niceScale(max, 4);

  // The debt segment needs to be visible against paper, not merely different
  // from it. `groundAlt` is a page tint — at column size it disappears, and the
  // first render read as plain bars growing rather than as a value being split.
  const debtFill = withAlpha(pal.ink, 0.22);
  const yOf = (v: number) => padT + plotH - (v / top) * plotH;

  const gridlines: string[] = [];
  for (let v = 0; v <= top + 1e-6; v += step) {
    const y = yOf(v);
    gridlines.push(`<line x1="${PAD_L}" x2="${VIEW_W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"`
      + ` stroke="${pal.rule}" stroke-width="${v === 0 ? 0.9 : 0.5}"/>`
      + label(ctx, VIEW_W, { x: PAD_L - 8, y: y + 3, pt: 'micro', fill: pal.inkMuted, anchor: 'end' },
        svgEscape(compactMoney(v))));
  }

  const columns = rows.map((year, i) => {
    const x = g.x(i);
    // Equity can be negative when the loan exceeds the value; clamping it to
    // zero would draw a position that is not the one in the table.
    const equity = Math.max(0, year.equity.value);
    const debt = Math.max(0, year.loanBalance.value);
    const debtY = yOf(debt);
    const equityY = yOf(debt + equity);
    return `<rect x="${x.toFixed(1)}" y="${debtY.toFixed(1)}" width="${g.barW.toFixed(1)}"`
      + ` height="${(yOf(0) - debtY).toFixed(1)}" fill="${debtFill}"/>`
      + `<rect x="${x.toFixed(1)}" y="${equityY.toFixed(1)}" width="${g.barW.toFixed(1)}"`
      + ` height="${(debtY - equityY).toFixed(1)}" fill="${pal.accent}"/>`;
  }).join('');

  const key = `<rect x="${PAD_L}" y="5" width="9" height="9" fill="${pal.accent}"/>`
    + label(ctx, VIEW_W, { x: PAD_L + 14, y: 13, pt: 'micro', fill: pal.ink }, 'Equity')
    + `<rect x="${PAD_L + 70}" y="5" width="9" height="9" fill="${debtFill}"/>`
    + label(ctx, VIEW_W, { x: PAD_L + 84, y: 13, pt: 'micro', fill: pal.ink }, 'Loan balance');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${h}"`
    + ` width="100%" preserveAspectRatio="xMidYMid meet">${key}${gridlines.join('')}${columns}`
    + yearTicks(ctx, rows, h - 8, pal.inkMuted)
    + '</svg>';

  return chartFigure(
    svg,
    `Property value split into equity and debt, year 1 to ${rows[rows.length - 1].year}.`,
  );
}

/**
 * After-tax cash flow, year by year, on the equity chart's own columns.
 *
 * The columns carry their own tone: a year that costs money is not the same
 * news as a year that makes it, and colour is the fastest way to say which is
 * which — with the figure printed at the end of each column, so the chart still
 * reads in monochrome and to a reader who cannot separate the two hues. It was
 * a list of horizontal bars on a page of its own; set on the same year axis as
 * the equity build it is read with it, and the pair fit one page.
 */
export function cashPositionChart(
  p: CashFlowProjection,
  palette: ResolvedReportPalette,
): string {
  const rows = p.years.slice(0, MAX_COLUMNS);
  if (rows.length < 2) return '';
  const values = rows.map((y) => y.afterTaxAnnual.value);
  if (values.every((v) => v === 0)) return '';

  const ctx = chartContext(palette);
  const pal = chartPalette(palette);
  const g = columnGeometry(rows.length);
  const padT = 24;
  const padB = 26;
  const h = 166;
  const plotH = h - padT - padB;

  // The domain always includes zero, so the baseline is the break-even line.
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = Math.max(hi - lo, 1);
  const { step } = niceScale(span, 4);
  const top = hi > 0 ? Math.ceil(hi / step - 1e-9) * step : 0;
  const bottom = lo < 0 ? Math.floor(lo / step + 1e-9) * step : 0;
  const range = Math.max(top - bottom, step);
  const yOf = (v: number) => padT + ((top - v) / range) * plotH;
  const zeroY = yOf(0);

  const gridlines: string[] = [];
  for (let v = bottom; v <= top + 1e-6; v += step) {
    const y = yOf(v);
    const isZero = Math.abs(v) < 1e-6;
    gridlines.push(`<line x1="${PAD_L}" x2="${VIEW_W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"`
      + ` stroke="${isZero ? pal.ink : pal.rule}" stroke-width="${isZero ? 0.9 : 0.5}"/>`
      + label(ctx, VIEW_W, { x: PAD_L - 8, y: y + 3, pt: 'micro', fill: pal.inkMuted, anchor: 'end' },
        svgEscape(compactMoney(v))));
  }

  const figurePt = ptToUnits(CHART_TEXT_PT.micro, VIEW_W, ctx.widthMm);
  const columns = rows.map((year, i) => {
    const v = year.afterTaxAnnual.value;
    const x = g.x(i);
    const y = yOf(Math.max(v, 0));
    const height = Math.abs(yOf(v) - zeroY);
    const fill = v >= 0 ? pal.positive : pal.negative;
    // The figure sits at the column's end. Inside it, in the paper colour, where
    // the column is long enough to hold it — outside, a long loss column's
    // figure landed on the year labels beneath the plot. A short column keeps
    // its figure just beyond its end, where there is room.
    const inside = height >= figurePt * 2;
    const labelY = v >= 0
      ? (inside ? y + figurePt + 3 : y - 4)
      : (inside ? zeroY + height - 5 : zeroY + height + figurePt + 2);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${g.barW.toFixed(1)}"`
      + ` height="${Math.max(height, v === 0 ? 0 : 0.8).toFixed(1)}" fill="${fill}"/>`
      + label(ctx, VIEW_W, {
        x: g.centre(i), y: labelY, pt: 'micro', fill: inside ? pal.ground : pal.ink, anchor: 'middle', weight: 600,
      }, svgEscape(compactMoney(v)));
  }).join('');

  // The key names only what is drawn: a term with no positive year has no
  // "pays the owner" swatch to explain.
  const keys = [
    values.some((v) => v < 0) ? { fill: pal.negative, text: 'Costs the owner' } : null,
    values.some((v) => v > 0) ? { fill: pal.positive, text: 'Pays the owner' } : null,
  ].filter((k): k is { fill: string; text: string } => k !== null);
  const key = keys.map((k, i) => {
    const x = PAD_L + i * 128;
    return `<rect x="${x}" y="5" width="9" height="9" fill="${k.fill}"/>`
      + label(ctx, VIEW_W, { x: x + 14, y: 13, pt: 'micro', fill: pal.ink }, k.text);
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${h}"`
    + ` width="100%" preserveAspectRatio="xMidYMid meet">${key}${gridlines.join('')}${columns}`
    + yearTicks(ctx, rows, h - 8, pal.inkMuted)
    + '</svg>';

  return chartFigure(
    svg,
    'After-tax cash flow each year. The figure on each column is that year\'s total; the baseline is break-even.',
  );
}
