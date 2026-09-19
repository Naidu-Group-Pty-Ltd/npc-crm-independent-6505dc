/**
 * The three pictures this document has a use for.
 *
 * Two landscape matrices already state every figure. A chart earns its page only
 * by answering something a matrix answers slowly, and across five properties and
 * ten years there are exactly three such questions:
 *
 *   How far apart?   The ranking gives an order. Whether first place is a
 *                    decision or a coin toss is a gap, and five numbers in a
 *                    column do not show a gap.
 *   Sweep or split?  Eight categories are won by somebody. Whether one property
 *                    took most of them or they split four ways is visible
 *                    nowhere in a table of winners.
 *   When does it     The matrix carries the cumulative row, but finding where
 *   stop costing?    each property's sign flips means scanning fifty cells for
 *                    a minus sign — and whether two curves cross is invisible
 *                    in a grid.
 *
 * All three are drawn from the payload the tables are drawn from, so none can
 * disagree with the page it sits on. All three return `''` when there is nothing
 * to draw, and every section prints its table either way.
 *
 * The multi-line chart is written here rather than taken from the shared module
 * because the shared module has no multi-series line and adding one for a single
 * caller is how a chart library grows things nobody uses — the rule
 * `cashFlow/charts.pure.ts` states for its stacked column. If a second format
 * wants it, that is when it moves.
 *
 * ## Two charts the shared module offers and this format cannot use
 *
 * **`renderQuadrant`** was the obvious candidate — growth against yield, the
 * classic two axes — and it is wrong here twice over. It maps values with
 * `xOf(v) = padL + (v / xMax) * plotW` (`charts.pure.ts:794`), so a negative
 * point is drawn left of the plot rectangle; and both candidate axes go
 * negative in normal use, because `netYield` is
 * `((annualRent - totalExpenses) / propertyValue) * 100`
 * (`CashFlowAnalysisModal.tsx:636`) and `capitalGrowthRate` is a per-year field
 * an adviser stress-testing a downturn types a minus sign into. The dividers
 * would be wrong too: CPI and the interest rate are per-property here, so one
 * property's assumption would have to become everyone's threshold, and picking
 * the primary's privileges the primary in a document whose whole posture is
 * equal peers.
 *
 * **`renderHeatmap`** would put cash flow on a property × year grid, which is
 * the right shape. But it prints raw numbers — `Number.isInteger(v) ? String(v)
 * : v.toFixed(1)` (`:456`), so `-8432.17` reaches a client's page as `-8432.2`,
 * with no currency and no separator — and it ramps one hue linearly from the
 * grid minimum, so a year at −$8,000 and a year at +$400 differ only in alpha
 * and the sign change is invisible. Making it fit means a formatter hook *and* a
 * diverging ramp, and at the end of that the banded matrix on the facing page
 * still says it better: `renderBandedMatrix` passes `signedKeys`, so negatives
 * take the negative tone through `renderDataTable` and every figure is a number
 * a reader can quote.
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
  renderDonut,
  svgEscape,
  type BarItem,
  type ChartContext,
  type DonutSegment,
} from '../../reportDesign/charts.pure.ts';
import { formatMeasure } from '../../reportDesign/measure.pure.ts';
import type { CashFlowComparison, ComparedProperty } from './payload.pure.ts';

/**
 * Below three properties a composition is a ratio, and a ratio reads better as
 * a sentence. The Portfolio's donut holds the same floor for the same reason.
 */
export const MIN_DONUT_SEGMENTS = 3;

/** Past this many columns the year labels collide and the matrix is the answer. */
const MAX_COLUMNS = 20;

/** Longest a key label runs before it is clipped. Five of these share a row. */
const KEY_LABEL_CHARS = 22;
/** A conservative average advance at micro size, in view-box units. */
const KEY_ADVANCE = 6.4;
/** Swatch, gap and the space after an entry. */
const KEY_LEAD = 30;
const KEY_ROW_H = 16;

/**
 * Dash patterns, so five lines are separable without relying on colour.
 *
 * The series palette is ordered by greyscale separation, which is enough for
 * fills but not for 1.8-unit strokes: the first render put five lines on one
 * plot and three of them read as the same grey. Colour is never the only
 * channel in this design system, and a stroke has only one other.
 */
const SERIES_DASH = ['', '5 3', '1.5 3', '9 3', '5 3 1.5 3', '2 2'];

const clip = (label: string): string =>
  label.length > KEY_LABEL_CHARS ? `${label.slice(0, KEY_LABEL_CHARS - 1).trimEnd()}…` : label;

/** Pack key entries into rows no wider than the plot. */
function layOutKey(labels: readonly string[], maxWidth: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let width = 0;
  for (const label of labels) {
    const entry = KEY_LEAD + label.length * KEY_ADVANCE;
    if (row.length && width + entry > maxWidth) {
      rows.push(row);
      row = [];
      width = 0;
    }
    row.push(label);
    width += entry;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** A label, sized and placed the way the shared module sizes its own. */
function label(
  ctx: ChartContext,
  viewBox: number,
  opts: {
    x: number;
    y: number;
    pt: keyof typeof CHART_TEXT_PT;
    fill: string;
    anchor?: string;
    weight?: number;
  },
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
 * Total return, ranked.
 *
 * Ranked on the same axis the scoreboard ranks on, deliberately: a chart whose
 * bars run in a different order from the table beside them is a chart that
 * contradicts its own page.
 *
 * **`tone` is passed explicitly and that is load-bearing.** `renderBars` colours
 * by `|value| / max` when no tone is given (`charts.pure.ts:717-726`), so a
 * property that lost the most money would take `pct = 1.0` and be drawn as the
 * longest, greenest bar in the chart. The figure is printed beside each bar too,
 * so the chart still reads in monochrome.
 */
export function rankedReturnChart(
  p: CashFlowComparison,
  palette: ResolvedReportPalette,
): string {
  const byNumber = new Map(p.properties.map((x) => [x.number, x]));
  const ranked = p.scoreboard.order
    .map((n) => byNumber.get(n))
    .filter((x): x is ComparedProperty => Boolean(x));
  if (ranked.length < 2) return '';
  if (ranked.every((x) => x.outcome.totalReturn.value === 0)) return '';

  const items: BarItem[] = ranked.map((x) => ({
    label: x.shortAddress,
    value: x.outcome.totalReturn.value,
    display: formatMeasure(x.outcome.totalReturn),
    tone: x.outcome.totalReturn.value >= 0 ? 'positive' : 'negative',
  }));

  return chartFigure(
    renderBars(chartContext(palette), items, {
      title: `Total return over ${p.meta.termYears} years`,
    }),
    'Capital growth plus cumulative after-tax cash flow. Bar length is the size of '
    + 'the figure; the colour and the sign say its direction.',
  );
}

/**
 * How the eight category wins split.
 *
 * Every property gets a segment, including one that won nothing. `renderDonut`
 * draws no wedge for a zero value (`charts.pure.ts:980`) but still lists it in
 * the legend at 0%, which is the honest reading: a property that led on nothing
 * competed and lost, and dropping it from the key would imply a smaller field
 * than the one compared.
 *
 * Categories nobody won — a tie, which `winnerOf` reports as `property: null` —
 * are counted in the caption rather than given a slice, because "nobody" is not
 * a competitor.
 */
export function categoryWinsChart(
  p: CashFlowComparison,
  palette: ResolvedReportPalette,
): string {
  if (p.properties.length < MIN_DONUT_SEGMENTS) return '';

  const decided = p.scoreboard.winners.filter((w) => w.property !== null);
  if (!decided.length) return '';

  const counts = new Map<number, number>(p.properties.map((x) => [x.number, 0]));
  for (const win of decided) {
    counts.set(win.property as number, (counts.get(win.property as number) ?? 0) + 1);
  }

  const segments: DonutSegment[] = p.properties.map((x) => ({
    label: x.shortAddress,
    value: counts.get(x.number) ?? 0,
  }));

  const leader = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const leaderProperty = p.properties.find((x) => x.number === leader[0]);
  const undecided = p.scoreboard.winners.length - decided.length;
  const tied = undecided === 1 ? '1 was tied' : `${undecided} were tied`;

  return chartFigure(
    renderDonut(chartContext(palette), segments, {
      title: 'Who leads on what',
      // Both stated rather than defaulted. `renderDonut`'s own default centre is
      // the *first* segment's share (`charts.pure.ts:1005`) — whichever property
      // the adviser happened to add first — and its default sub-label is that
      // segment's name, which is an address. An address does not fit inside the
      // ring's hole: the first render printed "WHISTLESONG COURT GYMPIE" straight
      // through the ring on both sides. The leader is named in the caption
      // instead, where there is room for it.
      // Out of *all* the measures, not out of the decided ones. The centre and
      // the caption then say the same thing, where "5/5" beside a caption
      // mentioning eight measures reads as two different claims.
      centerLabel: `${leader[1]}/${p.scoreboard.winners.length}`,
      centerSub: 'MEASURES LED',
    }),
    `${leaderProperty ? `${leaderProperty.shortAddress} leads on ${leader[1]} of the ` : 'Of the '}`
    + `${p.scoreboard.winners.length} measures compared`
    + `${undecided ? `; ${tied}` : ''}.`,
  );
}

/**
 * Cumulative after-tax cash flow, one line per property.
 *
 * The chart this format exists for. It answers *when does each property stop
 * costing money, and do the curves cross?* — and the crossing is the part no
 * table shows, because two properties can rank in one order at year three and
 * the other order at year ten.
 *
 * The zero line is drawn as a real threshold rather than an axis boundary: the
 * y-range spans the actual minimum and maximum, so on a set that never turns
 * positive the line sits at the top of the plot and the picture says so.
 */
export function cumulativeCashFlowChart(
  p: CashFlowComparison,
  palette: ResolvedReportPalette,
): string {
  const term = p.meta.termYears;
  if (p.properties.length < 2 || term < 2 || term > MAX_COLUMNS) return '';

  // One running total per property, in the order the properties are numbered so
  // the series colours match the tables.
  const series = p.properties.map((property) => {
    let running = 0;
    return {
      label: property.shortAddress,
      points: property.projection.years.map((year) => {
        running += year.afterTaxAnnual.value;
        return running;
      }),
    };
  });

  const flat = series.flatMap((s) => s.points);
  if (!flat.length || flat.every((v) => v === 0)) return '';

  // Zero is always inside the range, so the threshold is always drawable.
  const lo = Math.min(0, ...flat);
  const hi = Math.max(0, ...flat);
  const span = hi - lo || 1;

  const ctx = chartContext(palette);
  const pal = chartPalette(palette);
  const w = CHART_WIDTH.wide;
  const padT = 22;
  const padL = 62;
  const padR = 12;
  const plotW = w - padL - padR;

  // The key is laid out first, because how many rows it needs decides how tall
  // the chart is. The first render put all five entries on one row: they ran off
  // the right edge and the last three printed on top of one another. There is no
  // text measurement available to a pure module, so `KEY_ADVANCE` is a
  // deliberately generous average advance — over-estimating spaces the key out,
  // which is safe, where under-estimating overlaps two property names.
  const keyRows = layOutKey(series.map((s) => clip(s.label)), plotW);
  const padB = 34 + keyRows.length * KEY_ROW_H;
  const h = 300 + keyRows.length * KEY_ROW_H;
  const plotH = h - padT - padB;

  const xOf = (i: number) => padL + (term === 1 ? plotW / 2 : (i / (term - 1)) * plotW);
  const yOf = (v: number) => padT + plotH - ((v - lo) / span) * plotH;

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const value = lo + f * span;
    const y = yOf(value);
    return `<line x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"`
      + ` stroke="${pal.rule}" stroke-width="0.5"/>`
      + label(ctx, w, { x: padL - 8, y: y + 3, pt: 'micro', fill: pal.inkMuted, anchor: 'end' },
        svgEscape(formatAxisValue(value, 'money')));
  }).join('');

  const zeroY = yOf(0);
  const zeroLine = `<line x1="${padL}" x2="${w - padR}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"`
    + ` stroke="${pal.ink}" stroke-width="1.1" stroke-dasharray="4 3"/>`
    + label(ctx, w, { x: w - padR, y: zeroY - 5, pt: 'micro', fill: pal.inkMuted, anchor: 'end' },
      'Breaks even');

  const lines = series.map((s, i) => {
    const stroke = pal.series[i % pal.series.length];
    const dash = SERIES_DASH[i % SERIES_DASH.length];
    const d = s.points.map((v, j) => `${j === 0 ? 'M' : 'L'} ${xOf(j).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');
    const dots = s.points.map((v, j) =>
      `<circle cx="${xOf(j).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="2.4" fill="${stroke}"/>`).join('');
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.8"`
      + (dash ? ` stroke-dasharray="${dash}"` : '')
      + ' stroke-linejoin="round" stroke-linecap="round"/>' + dots;
  }).join('');

  const tickY = padT + plotH + 16;
  const ticks = p.properties[0].projection.years.map((year, i) =>
    (i === 0 || (i + 1) % 2 === 0 || i === term - 1)
      ? label(ctx, w, { x: xOf(i), y: tickY, pt: 'micro', fill: pal.inkMuted, anchor: 'middle' },
        svgEscape(String(year.year)))
      : '').join('');

  // The key runs along the foot, wrapped to as many rows as it needs. Every
  // series is also a row in the matrices two sections back, under the same name,
  // so the key is a cross-reference rather than the only way to read the chart.
  let seriesIndex = 0;
  const key = keyRows.map((row, rowIndex) => {
    const y = padT + plotH + 30 + rowIndex * KEY_ROW_H;
    let x = padL;
    return row.map((text) => {
      const stroke = pal.series[seriesIndex % pal.series.length];
      const dash = SERIES_DASH[seriesIndex % SERIES_DASH.length];
      seriesIndex += 1;
      const swatch = `<line x1="${x}" x2="${x + 14}" y1="${(y - 4).toFixed(1)}" y2="${(y - 4).toFixed(1)}"`
        + ` stroke="${stroke}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
        + label(ctx, w, { x: x + 19, y, pt: 'micro', fill: pal.inkMuted }, svgEscape(text));
      x += KEY_LEAD + text.length * KEY_ADVANCE;
      return swatch;
    }).join('');
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"`
    + ` width="100%" preserveAspectRatio="xMidYMid meet">`
    + `${gridlines}${zeroLine}${lines}${ticks}${key}</svg>`;

  return chartFigure(
    svg,
    'Every after-tax year added to the ones before it. A line crossing the dashed '
    + 'threshold is the year that property has repaid what it cost to hold.',
  );
}
