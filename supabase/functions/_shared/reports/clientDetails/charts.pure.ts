/**
 * The three pictures this record has a use for.
 *
 * Every figure is already in a table, so a chart earns its page only by
 * answering something the table answers slowly. Across a client record there are
 * three such questions:
 *
 *   Can they carry it?   Income against everything committed against it. The
 *                        one number an adviser and a broker both look for, and
 *                        it lives in three different tables.
 *   Where does it go?    Expenses are the densest thing this record holds — 506
 *                        rows across the book — and no document has ever
 *                        summarised them.
 *   What is really       Value beside debt, per property. The legacy draws a
 *   theirs?              per-property equity bar; this says it for the whole
 *                        portfolio in one place.
 *
 * All three return `''` when their data is absent, which for this format is the
 * ordinary case rather than the exception, and every section prints its table
 * either way.
 *
 * ## The bullet, at last
 *
 * Four formats have rejected `renderBullet` with the same sentence — it needs a
 * value against a target, and nothing in those documents was measured against a
 * threshold. Here something is. Household income is the value and monthly
 * commitments are the target, both computed by `finance.pure.ts` from rows this
 * document also prints. This is what the primitive was built for.
 */

import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import {
  chartContext,
  chartFigure,
  renderBars,
  renderBullet,
  renderDonut,
  type BarItem,
  type DonutSegment,
} from '../../reportDesign/charts.pure.ts';
import { formatMeasure } from '../../reportDesign/measure.pure.ts';
import type { ClientDetails } from './payload.pure.ts';

/**
 * Below three categories a composition is a ratio, and a ratio reads better as a
 * sentence. The same floor the Portfolio and the Cash Flow Comparison hold.
 */
export const MIN_DONUT_SEGMENTS = 3;

/** Past this, the legend runs longer than the ring and the table is the answer. */
export const MAX_DONUT_SEGMENTS = 8;

/**
 * Income against what is committed against it.
 *
 * The bands are the two thresholds a lender would read: comfortable below 70% of
 * income committed, tight to 90%, over-committed beyond. They are drawn from the
 * income itself rather than from an absolute figure, because a household earning
 * $6,000 a month and one earning $30,000 are not comparable in dollars.
 */
export function incomeAgainstCommitmentsChart(
  p: ClientDetails,
  palette: ResolvedReportPalette,
): string {
  const income = p.position.incomeMonthly.value;
  const commitments = p.position.commitmentsMonthly.value;
  // Both sides required. A bullet with no target is a bar, and a bullet with no
  // value is nothing at all.
  if (!(income > 0) || !(commitments > 0)) return '';

  return chartFigure(
    renderBullet(chartContext(palette), {
      value: income,
      target: commitments,
      max: Math.max(income, commitments) * 1.15,
      ranges: [commitments * 0.7, commitments * 0.9, commitments],
      // Both kept short. `renderBullet` right-aligns the label and sub into a
      // 138-unit gutter and clips whatever does not fit — the first render put
      // "AGAINST $54,739/MO COMMITTED" half off the left edge of the page. The
      // figure belongs in the caption, where there is room for it.
      label: 'Income',
      sub: 'per month',
    }),
    `The bar is recorded monthly income of ${formatMeasure(p.position.incomeMonthly)}. `
    + `The marker is ${formatMeasure(p.position.commitmentsMonthly)} of commitments — `
    + 'liability servicing, property outgoings and household expenses.',
  );
}

/**
 * Where the money goes.
 *
 * Categories rather than individual lines: a client with forty expense rows has
 * a legend nobody reads, and the table two inches above already names every one.
 * Categories past the eighth are gathered rather than dropped, so the ring still
 * sums to what the client spends.
 */
export function expenseCompositionChart(
  p: ClientDetails,
  palette: ResolvedReportPalette,
): string {
  const byCategory = new Map<string, number>();
  for (const row of p.expenses) {
    if (row.monthly.value <= 0) continue;
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.monthly.value);
  }
  if (byCategory.size < MIN_DONUT_SEGMENTS) return '';

  const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const head = ranked.slice(0, MAX_DONUT_SEGMENTS - 1);
  const tail = ranked.slice(MAX_DONUT_SEGMENTS - 1);
  const segments: DonutSegment[] = head.map(([label, value]) => ({ label, value }));
  if (tail.length) {
    segments.push({
      label: `${tail.length} other categories`,
      value: tail.reduce((s, [, v]) => s + v, 0),
    });
  }

  const total = ranked.reduce((s, [, v]) => s + v, 0);
  const [topLabel, topValue] = ranked[0];

  return chartFigure(
    renderDonut(chartContext(palette), segments, {
      title: 'Where the money goes',
      // Stated, never defaulted: the default centre is the first segment's share
      // and the default sub-label is its name, which is a category not a total.
      centerLabel: `${Math.round((topValue / total) * 100)}%`,
      centerSub: 'LARGEST',
    }),
    // The ring's own total, not the position's. An earlier caption said "of
    // $54,739/mo in recorded monthly commitments" beside a ring that summed only
    // household expenses — commitments also carry liability servicing and
    // property outgoings, so the sentence named a figure the chart above it did
    // not show. Caught by reading the rendered page.
    `${topLabel} is the largest of ${byCategory.size} expense categories, `
    + `totalling ${formatMeasure({ value: total, unit: 'aud/month' })}.`,
  );
}

/**
 * Value against debt, per property.
 *
 * Two bars a property — what it is worth, and what is owed on it — so the gap
 * between them is the equity, read off directly rather than subtracted in the
 * reader's head. The home is included here even though it has its own section,
 * because "what is really theirs" is a question about everything they hold.
 *
 * **`tone` is passed explicitly and that is load-bearing.** `renderBars` colours
 * by `|value| / max` when none is given, so the largest debt in the set would be
 * drawn as the strongest, greenest bar in the chart — the defect the Cash Flow
 * Comparison recorded.
 */
export function valueAgainstDebtChart(
  p: ClientDetails,
  palette: ResolvedReportPalette,
): string {
  const holdings = [
    ...(p.ownerOccupied ? [p.ownerOccupied] : []),
    ...p.properties,
  ].filter((x) => x.value.value > 0);
  if (!holdings.length) return '';

  const items: BarItem[] = holdings.flatMap((x) => {
    const label = x.shortAddress;
    return [
      {
        label: `${label} — value`,
        value: x.value.value,
        display: formatMeasure(x.value),
        tone: 'positive' as const,
      },
      {
        label: `${label} — owing`,
        value: x.loanRemaining.value,
        display: formatMeasure(x.loanRemaining),
        tone: 'negative' as const,
      },
    ];
  });

  return chartFigure(
    renderBars(chartContext(palette), items, {
      title: 'Value against what is owed',
      // One scale across every property, so two holdings of different size are
      // actually comparable. Per-bar scaling would draw a $400k property and a
      // $2m one the same length.
      max: Math.max(...holdings.map((x) => x.value.value)),
    }),
    'Each property twice: what it is worth, then what is owed on it. The gap '
    + 'between the pair is the equity held.',
  );
}
