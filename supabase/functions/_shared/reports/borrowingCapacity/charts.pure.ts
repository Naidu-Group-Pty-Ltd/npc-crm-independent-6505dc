/**
 * The three pictures this document has a use for.
 *
 * Not three that could be drawn — three that answer a question the tables answer
 * slowly. Every one takes the payload it is drawn from, so a chart cannot
 * disagree with the table beside it.
 *
 *   Utilisation   A bullet. "Is the loan they want inside what they can
 *                 borrow, and by how much?" is a comparison against a limit,
 *                 which is the one thing a bullet chart is for.
 *   Income mix    A donut. Which components carry the serviceability, after
 *                 shading — a proportion, and small in number.
 *   Headroom      Bars. Capacity, the stress-tested capacity and the proposed
 *                 loan on one axis. The reader currently does that comparison
 *                 in their head, across two pages.
 *
 * Two others were drawn and removed, which is the more useful half of this
 * module's history:
 *
 *   A **waterfall** of the monthly build-up. Its total came to ~$8,150 against
 *   the $1,840 surplus printed under it, because the engine's surplus is after
 *   tax and after property cashflow and the payload does not carry those as
 *   monthly steps. A picture that disagrees with the figure beside it is worse
 *   than no picture, and the fix is not to draw it from numbers that reconcile
 *   by construction — there are none.
 *
 *   **Bars of the scenario capacities.** The scenario table already sorts and
 *   compares exactly those three numbers; bars of them beside it are
 *   decoration, and they cost a page.
 *
 * No chart is load-bearing. Each returns `''` when its data is absent or
 * degenerate, and the section around it prints its table either way: a client
 * with one income component does not need a donut of one segment.
 */

import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import {
  chartContext,
  chartFigure,
  renderBars,
  renderBullet,
  renderDonut,
  type BarItem,
} from '../../reportDesign/charts.pure.ts';
import { formatMeasure } from '../../reportDesign/measure.pure.ts';
import type { BorrowingCapacitySnapshot } from './payload.pure.ts';

/**
 * Below this, a proportion chart is worse than the sentence it replaces.
 *
 * Two segments is a ratio and reads better as text; one is not a composition
 * at all.
 */
const MIN_DONUT_SEGMENTS = 3;

/**
 * Capacity, and the loan against it.
 *
 * The target line is the capacity and the bar is the proposed loan, so
 * over-limit reads as the bar crossing the line — the same fact the shipping
 * report draws as a red bar at 97% directly above a sentence saying the loan
 * falls *within* the limit (`BORROWING_CAPACITY.md` F6).
 */
export function utilisationChart(
  s: BorrowingCapacitySnapshot,
  palette: ResolvedReportPalette,
): string {
  const u = s.utilisation;
  if (!u || u.capacity.value <= 0) return '';

  const ctx = chartContext(palette);
  const svg = renderBullet(ctx, {
    value: u.proposedLoan.value,
    target: u.capacity.value,
    // Headroom past the limit so an over-limit bar has somewhere to go; a bar
    // pinned to the right edge cannot show by how much.
    max: Math.max(u.proposedLoan.value, u.capacity.value) * 1.1,
    label: 'Proposed loan',
    sub: formatMeasure(u.share),
  });

  // A label, not a sentence: `figcaption` is uppercase mono micro, which is a
  // caption face. The first charted render set a two-line sentence in it.
  return chartFigure(svg, 'Proposed loan against the assessed limit');
}

/**
 * How much room is left, and where it goes under a rate shock.
 *
 * Three figures the payload already carries, all `aud`, all reconciling with
 * the tables around them: what the assessment allows, what survives the stress
 * test, and what is actually being asked for.
 */
export function headroomChart(
  s: BorrowingCapacitySnapshot,
  palette: ResolvedReportPalette,
): string {
  const items: BarItem[] = [
    {
      label: 'Assessed capacity',
      value: s.headline.capacity.value,
      display: formatMeasure(s.headline.capacity),
      tone: 'accent',
    },
  ];
  if (s.headline.stressTested) {
    items.push({
      label: 'Stress tested',
      value: s.headline.stressTested.value,
      display: formatMeasure(s.headline.stressTested),
      tone: 'caution',
    });
  }
  if (s.utilisation) {
    items.push({
      label: 'Proposed loan',
      value: s.utilisation.proposedLoan.value,
      display: formatMeasure(s.utilisation.proposedLoan),
      // The proposal is only adverse when it exceeds what was assessed; inside
      // the limit it is neither good news nor bad, it is the ask.
      tone: s.utilisation.withinCapacity ? 'positive' : 'negative',
    });
  }
  // One bar is not a comparison.
  if (items.length < 2 || s.headline.capacity.value <= 0) return '';

  return chartFigure(renderBars(chartContext(palette), items), 'Capacity and headroom');
}

/**
 * What the serviceability rests on.
 *
 * Assessed amounts, not gross: a component shaded to nothing contributes
 * nothing, and a chart of gross income would show it carrying weight it does
 * not carry. Zero-value segments are dropped for the same reason.
 */
export function incomeMixChart(
  s: BorrowingCapacitySnapshot,
  palette: ResolvedReportPalette,
): string {
  const segments = s.income.rows
    .filter((r) => r.shaded.value > 0)
    .map((r) => ({ label: r.label, value: r.shaded.value }));
  if (segments.length < MIN_DONUT_SEGMENTS) return '';

  return chartFigure(
    renderDonut(chartContext(palette), segments, {
      centerLabel: formatMeasure(s.income.shaded),
      centerSub: 'Assessed',
    }),
    'Assessed income by component',
  );
}
