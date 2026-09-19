/**
 * The three pictures this document has a use for.
 *
 * The holdings matrix states every figure. A chart earns its page only by
 * answering something that matrix answers slowly, and in a table of twenty
 * columns there are three such questions:
 *
 *   Where the money is   Is this portfolio concentrated? The risk section
 *                        asserts an answer to that in prose and nothing on the
 *                        page shows it; finding out from the table means
 *                        ranking every holding by eye.
 *   Yield against LVR    Which properties are the problem, and are they the
 *                        problem for the *same* reason? The rankings list them
 *                        1…n with prose, but neither the list nor the matrix
 *                        shows that two low-ranked holdings are both high-LVR
 *                        and low-yield — one problem, one action — while a
 *                        third is low-LVR and low-yield, which is different.
 *   Capacity headroom    How much room is left? A comparison against a limit,
 *                        which is what a bullet chart is for.
 *
 * Four were drawn or considered and left out, which is the more useful half of
 * this module's history:
 *
 *   A **waterfall** from portfolio value to equity, or from today's value to
 *   the projection. The Borrowing Capacity format deleted its waterfall after
 *   it totalled ~$8,150 against the $1,840 printed beneath it. Here it would be
 *   worse: the projection is *model-written*, arriving as finished numbers with
 *   no intermediate steps, so a waterfall would have to invent the steps that
 *   reconcile them.
 *
 *   A **score wheel** over the review's five scores. The data begs for it and
 *   the axes are not independent — the review wizard derives growth potential
 *   from the health score and copies the health score into cash flow for
 *   owner-occupied holdings. A radar over numbers computed from one another
 *   draws a shape that is an artefact of the formula.
 *
 *   **Bars of per-property cash flow.** That is the matrix's cash-flow column
 *   drawn a second time.
 *
 *   A **gauge** on the headline health score, which is already the largest
 *   thing on the page in the KPI strip.
 *
 * No chart is load-bearing. Each returns `''` when its data is absent or
 * degenerate, and the section prints its table either way.
 */

import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import {
  chartContext,
  chartFigure,
  renderBullet,
  renderDonut,
  renderQuadrant,
  type DonutSegment,
  type QuadrantPoint,
} from '../../reportDesign/charts.pure.ts';
import { formatMeasure } from '../../reportDesign/measure.pure.ts';
import type { PortfolioReview } from './payload.pure.ts';

/**
 * Below this, a proportion chart is worse than the sentence it replaces.
 *
 * Two holdings is a ratio and reads better as text; one is not a composition.
 */
const MIN_DONUT_SEGMENTS = 3;

/**
 * Six is the cap because the shared series palette is six colours ordered by
 * greyscale separation rather than by hue — a printed report gets photocopied.
 */
const MAX_DONUT_SEGMENTS = 6;

/** Fewer than this and the quadrant is a scatter of two points. */
const MIN_QUADRANT_POINTS = 3;

/**
 * The loan-to-value at which Australian lenders begin requiring mortgage
 * insurance, and the only threshold on either axis that is not this
 * portfolio's own arithmetic.
 */
const LMI_LVR = 80;

/**
 * Where the money is.
 *
 * The largest holdings by value, with the remainder gathered into one segment
 * so the whole is the portfolio and the parts sum to it.
 */
export function compositionChart(
  p: PortfolioReview,
  palette: ResolvedReportPalette,
): string {
  const valued = p.holdings
    .filter((h) => h.value.unit !== 'none' && h.value.value > 0)
    .sort((a, b) => b.value.value - a.value.value);
  if (valued.length < MIN_DONUT_SEGMENTS) return '';

  const shown = valued.slice(0, MAX_DONUT_SEGMENTS - 1);
  const rest = valued.slice(MAX_DONUT_SEGMENTS - 1);

  const segments: DonutSegment[] = shown.map((h) => ({
    // The address, not the type: two "investment" segments tell a reader
    // nothing about which holding carries the portfolio.
    label: h.address.split(',')[0].slice(0, 28),
    value: h.value.value,
  }));
  if (rest.length) {
    segments.push({
      label: `${rest.length} more ${rest.length === 1 ? 'property' : 'properties'}`,
      value: rest.reduce((sum, h) => sum + h.value.value, 0),
    });
  }

  const total = valued.reduce((sum, h) => sum + h.value.value, 0);
  const largestShare = total > 0 ? (valued[0].value.value / total) * 100 : 0;

  return chartFigure(
    renderDonut(chartContext(palette), segments, {
      title: 'Portfolio value by holding',
      centerLabel: `${largestShare.toFixed(0)}%`,
      centerSub: 'largest holding',
    }),
    `The largest holding is ${largestShare.toFixed(0)}% of ${formatMeasure(p.totals.value)}.`,
  );
}

/**
 * Yield against leverage.
 *
 * Owner-occupied holdings have no yield to plot — the producer stores `'N/A'`
 * and the normaliser reads that as absent rather than as zero — so they are
 * excluded and the caption says how many, because a chart that silently drops
 * a client's own home is a chart that lies about the portfolio's size.
 */
export function yieldAgainstLeverageChart(
  p: PortfolioReview,
  palette: ResolvedReportPalette,
): string {
  const plottable = p.holdings.filter(
    (h) => h.grossYield.unit !== 'none' && h.lvr.unit !== 'none',
  );
  if (plottable.length < MIN_QUADRANT_POINTS) return '';

  // Which holdings the analysis called out, so the chart agrees with the
  // ranking beside it rather than deciding for itself what "poor" means.
  const flagged = new Set(
    p.verdicts
      .filter((v) => /under|poor|weak|concern/i.test(v.rating))
      .map((v) => v.address.toLowerCase().replace(/[^a-z0-9]/g, '')),
  );

  const points: QuadrantPoint[] = plottable.map((h) => ({
    x: h.lvr.value,
    y: h.grossYield.value,
    label: h.address.split(',')[0].slice(0, 22),
    highlight: flagged.has(h.address.toLowerCase().replace(/[^a-z0-9]/g, '')),
  }));

  // The dividers are thresholds, not the geometric middle — which is half of
  // the largest value plotted, a line that moves whenever a property is added
  // and stands for nothing.
  //
  // On the leverage axis the threshold is 80%, the loan-to-value above which
  // Australian lenders price mortgage insurance. It is not this module's
  // invention and it does not move with the data, so "higher debt" means the
  // same thing on every client's report. On the yield axis there is no
  // equivalent — yield expectations differ by market — so the divider is this
  // portfolio's own average, and the caption says which is which.
  const yMid = p.totals.averageYield.unit === 'none'
    ? plottable.reduce((sum, h) => sum + h.grossYield.value, 0) / plottable.length
    : p.totals.averageYield.value;

  const dropped = p.holdings.length - plottable.length;
  const caption = `Each dot is one holding. The vertical line is ${LMI_LVR}% loan to value, `
    + 'where lenders begin pricing mortgage insurance; the horizontal line is this '
    + `portfolio’s average gross yield of ${yMid.toFixed(2)}%. `
    + (dropped
      ? `${dropped} ${dropped === 1 ? 'holding is' : 'holdings are'} not plotted: an owner-occupied property earns no rent, so it has no yield.`
      : '');

  return chartFigure(
    renderQuadrant(chartContext(palette), points, {
      title: 'Yield against leverage',
      xLabel: 'Loan to value',
      yLabel: 'Gross yield',
      // Headroom past the largest value so the rightmost and topmost dots sit
      // inside the box rather than on its edge, where their labels were clipped.
      xMax: Math.max(...points.map((q) => q.x), LMI_LVR) * 1.08,
      yMax: Math.max(...points.map((q) => q.y), yMid) * 1.12,
      xMid: LMI_LVR,
      yMid,
      q1: 'Higher yield, higher debt',
      q2: 'Higher yield, lower debt',
      q3: 'Lower yield, lower debt',
      q4: 'Lower yield, higher debt',
    }),
    caption.trim(),
  );
}

/**
 * Capacity headroom.
 *
 * The bar is debt deployed and the line is the assessed capacity, so being over
 * the limit reads as the bar crossing the line. The legacy draws the same fact
 * as a progress bar that turns red at 80% — colour carrying the meaning, beside
 * prose that may say the position is comfortable.
 */
export function capacityHeadroomChart(
  p: PortfolioReview,
  palette: ResolvedReportPalette,
): string {
  const c = p.capacity;
  if (!c) return '';
  if (c.estimatedCapacity.unit === 'none' || c.estimatedCapacity.value <= 0) return '';
  if (c.totalDebtDeployed.unit === 'none') return '';

  return chartFigure(
    renderBullet(chartContext(palette), {
      value: c.totalDebtDeployed.value,
      target: c.estimatedCapacity.value,
      // Headroom past the limit so an over-limit bar has somewhere to go; a bar
      // pinned to the right edge cannot show by how much.
      max: Math.max(c.totalDebtDeployed.value, c.estimatedCapacity.value) * 1.1,
      label: 'Debt deployed',
      sub: formatMeasure(c.utilisation),
    }),
    `Deployed against an assessed capacity of ${formatMeasure(c.estimatedCapacity)}.`,
  );
}
