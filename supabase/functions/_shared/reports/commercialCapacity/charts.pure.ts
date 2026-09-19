/**
 * The three pictures this document has a use for.
 *
 * Every one is drawn from the payload the tables are drawn from, so a chart
 * cannot disagree with the figures beside it — the rule
 * `borrowingCapacity/charts.pure.ts` records, and the reason a waterfall was
 * drawn and removed there.
 *
 *   Utilisation   A bullet. The request against the assessed capacity: a
 *                 comparison to a limit, which is what a bullet is for. Over-
 *                 limit reads as the bar crossing the line rather than as a
 *                 colour somebody has to interpret.
 *   Constraints   Bars. What each capacity test permits, on one axis. This
 *                 is the chart the format exists for — the binding constraint
 *                 is simply the shortest bar, and a reader sees *by how much*
 *                 without doing arithmetic across a table.
 *   Income mix    A donut. What carries the serviceability, after shading.
 *
 * No chart is load-bearing. Each returns `''` when its data is absent or
 * degenerate, and the section prints its table either way.
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
import { formatMeasure, rate } from '../../reportDesign/measure.pure.ts';
import type { CommercialCapacitySnapshot } from './payload.pure.ts';

/** Below three segments a donut is worse than the sentence it replaces. */
const MIN_DONUT_SEGMENTS = 3;

/**
 * The request against what the assessment allows.
 *
 * The target line is the capacity; the bar is the request. The `max` carries
 * ten per cent past whichever is larger, so an over-limit bar has somewhere to
 * go — a bar pinned to the right edge cannot show by how much it overshot,
 * which is the only thing the reader wanted to know.
 */
export function utilisationChart(
  s: CommercialCapacitySnapshot,
  palette: ResolvedReportPalette,
): string {
  const capacity = s.headline.maximumCapacity.value;
  const requested = s.headline.requestedLoan.value;
  if (capacity <= 0 || requested <= 0) return '';

  const svg = renderBullet(chartContext(palette), {
    value: requested,
    target: capacity,
    max: Math.max(requested, capacity) * 1.1,
    label: 'Requested facility',
    // The bar's own share of the limit, not the limit's value. The first
    // render put the capacity here, under a label reading "Requested
    // facility" — a chart contradicting itself in its own caption.
    sub: `${formatMeasure(rate(requested / capacity))} of capacity`,
  });

  return chartFigure(svg, 'Requested facility against the assessed capacity');
}

/**
 * What each test permits.
 *
 * The binding constraint is drawn `caution` and every other applied test
 * `accent`, because the binding one is the answer to the question the section
 * asks — not because it is bad news. A test the assessment could not run is
 * omitted rather than drawn at zero: a zero-length bar reads as "this test
 * permits nothing", which is the opposite of "this test did not apply".
 */
export function constraintChart(
  s: CommercialCapacitySnapshot,
  palette: ResolvedReportPalette,
): string {
  const applied = s.constraints.filter((c) => c.applied && c.cap.value > 0);
  const binding = applied.reduce(
    (lowest, c) => Math.min(lowest, c.cap.value),
    Number.POSITIVE_INFINITY,
  );

  /**
   * How far above the binding cap a test can sit and still be worth drawing.
   *
   * The first render made the case for this: the global servicing surplus
   * permitted $14.1m where every other test sat between $3.0m and $4.6m, so a
   * single bar took three quarters of the width and the difference between the
   * binding test and the next one — which is the only thing the chart is for —
   * became invisible. The tests that were compressed out are the ones a reader
   * is comparing.
   */
  const READABLE_MULTIPLE = 3;
  const ceiling = binding * READABLE_MULTIPLE;
  const drawn = applied.filter((c) => c.cap.value <= ceiling);
  const omitted = applied.length - drawn.length;

  const items: BarItem[] = drawn
    // Ascending, so the binding test is first and the eye runs from tightest to
    // loosest rather than in whatever order the engine emitted them.
    .slice()
    .sort((a, b) => a.cap.value - b.cap.value)
    .map((c) => ({
      label: c.label,
      value: c.cap.value,
      display: formatMeasure(c.cap),
      tone: c.binding ? ('caution' as const) : ('accent' as const),
    }));

  // One bar is not a comparison, and this chart is entirely a comparison.
  if (items.length < 2) return '';

  if (s.headline.requestedLoan.value > 0) {
    items.push({
      label: 'Requested facility',
      value: s.headline.requestedLoan.value,
      display: formatMeasure(s.headline.requestedLoan),
      // The request is only adverse where it exceeds what was assessed. Inside
      // the capacity it is neither good news nor bad — it is the ask.
      tone: s.headline.difference.value >= 0 ? 'positive' : 'negative',
    });
  }

  // A dropped bar is said, not hidden. A chart that quietly omits a test reads
  // as a chart of every test.
  const caption = omitted
    ? `The tests nearest binding — ${omitted} permitting far more `
      + `${omitted === 1 ? 'is' : 'are'} in the table below`
    : 'What each test permits, and what is being asked for';

  return chartFigure(renderBars(chartContext(palette), items), caption);
}

/**
 * What the serviceability rests on.
 *
 * Assessed amounts, after shading — a rental stream the policy counts at 80%
 * carries 80% of the servicing, and a chart of gross income would show it
 * carrying weight it does not carry. Negative and zero rows are dropped: the
 * ledger's deductions belong in the ledger, and a donut of a mixture of
 * contributions and deductions is not a composition of anything.
 */
export function incomeMixChart(
  s: CommercialCapacitySnapshot,
  palette: ResolvedReportPalette,
): string {
  const segments = s.serviceability.rows
    .filter((r) => r.emphasis === 'normal' && r.direction === 'favourable' && r.amount.value > 0)
    .map((r) => ({ label: r.label, value: r.amount.value }));
  if (segments.length < MIN_DONUT_SEGMENTS) return '';

  // No `centerLabel`, deliberately. The hole is set at display size and holds
  // about six glyphs; `$2,060,191 pa` overflowed it on both sides on the first
  // render. The primitive's default — the largest segment's share — is short,
  // is the fact a proportion chart is answering, and the total is printed in
  // the ledger immediately below.
  return chartFigure(
    renderDonut(chartContext(palette), segments, { centerSub: 'Largest source' }),
    'Assessable income by source',
  );
}
