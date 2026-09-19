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
  formatAxisValue,
  ptToUnits,
  renderBars,
  svgEscape,
  withAlpha,
  type BarItem,
  type ChartContext,
} from '../../reportDesign/charts.pure.ts';
import { formatMeasure } from '../../reportDesign/measure.pure.ts';
import type { CashFlowProjection } from './payload.pure.ts';

/** Past this many columns the labels collide; the table is the better answer. */
const MAX_COLUMNS = 20;

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
  const w = CHART_WIDTH.wide;
  const padT = 20;
  const padB = 34;
  const padL = 54;
  const padR = 8;
  const h = 300;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const slot = plotW / rows.length;
  const barW = Math.max(6, slot * 0.62);

  // The debt segment needs to be visible against paper, not merely different
  // from it. `groundAlt` is a page tint — at column size it disappears, and the
  // first render read as plain bars growing rather than as a value being split.
  const debtFill = withAlpha(pal.ink, 0.22);

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + plotH - f * plotH;
    return `<line x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"`
      + ` stroke="${pal.rule}" stroke-width="0.5"/>`
      + label(ctx, w, { x: padL - 8, y: y + 3, pt: 'micro', fill: pal.inkMuted, anchor: 'end' },
        svgEscape(formatAxisValue(max * f, 'money')));
  }).join('');

  const columns = rows.map((year, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    // Equity can be negative when the loan exceeds the value; clamping it to
    // zero would draw a position that is not the one in the table.
    const equity = Math.max(0, year.equity.value);
    const debt = Math.max(0, year.loanBalance.value);
    const debtH = (debt / max) * plotH;
    const equityH = (equity / max) * plotH;
    const debtY = padT + plotH - debtH;
    const equityY = debtY - equityH;

    const tick = (i === 0 || (i + 1) % 2 === 0 || i === rows.length - 1)
      ? label(ctx, w, { x: x + barW / 2, y: h - 12, pt: 'micro', fill: pal.inkMuted, anchor: 'middle' },
        svgEscape(String(year.year)))
      : '';

    return `<rect x="${x.toFixed(1)}" y="${debtY.toFixed(1)}" width="${barW.toFixed(1)}"`
      + ` height="${debtH.toFixed(1)}" fill="${debtFill}"/>`
      + `<rect x="${x.toFixed(1)}" y="${equityY.toFixed(1)}" width="${barW.toFixed(1)}"`
      + ` height="${equityH.toFixed(1)}" fill="${pal.accent}"/>`
      + tick;
  }).join('');

  const key = label(ctx, w, { x: padL, y: 12, pt: 'micro', fill: pal.inkMuted }, 'Equity')
    + `<rect x="${padL - 12}" y="6" width="8" height="8" fill="${pal.accent}"/>`
    + label(ctx, w, { x: padL + 58, y: 12, pt: 'micro', fill: pal.inkMuted }, 'Loan balance')
    + `<rect x="${padL + 46}" y="6" width="8" height="8" fill="${debtFill}"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"`
    + ` width="100%" preserveAspectRatio="xMidYMid meet">${key}${gridlines}${columns}</svg>`;

  return chartFigure(
    svg,
    `Property value split into equity and debt, year 1 to ${rows[rows.length - 1].year}.`,
  );
}

/**
 * After-tax cash flow, year by year.
 *
 * The bars carry their own tone: a year that costs money is not the same news
 * as a year that makes it, and colour is the fastest way to say which is which
 * — with the figure printed beside each bar, so the chart still reads in
 * monochrome and to a reader who cannot separate the two hues.
 */
export function cashPositionChart(
  p: CashFlowProjection,
  palette: ResolvedReportPalette,
): string {
  const rows = p.years.slice(0, MAX_COLUMNS);
  if (rows.length < 2) return '';
  if (rows.every((y) => y.afterTaxAnnual.value === 0)) return '';

  const items: BarItem[] = rows.map((y) => ({
    label: `Year ${y.year}`,
    value: y.afterTaxAnnual.value,
    display: formatMeasure(y.afterTaxAnnual),
    tone: y.afterTaxAnnual.value >= 0 ? 'positive' : 'negative',
  }));

  return chartFigure(
    renderBars(chartContext(palette), items, { title: 'After-tax cash flow by year' }),
    'Bar length is the size of the figure; the colour and the sign say its direction.',
  );
}
