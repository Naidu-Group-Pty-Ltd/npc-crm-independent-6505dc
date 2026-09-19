/**
 * The two pictures this document has a use for.
 *
 * A comparison is a ranking, not a composition and not a projection, so most of
 * the shared chart vocabulary has nothing to say about it. Two questions survive
 * the test of "answers something the table answers slowly":
 *
 *   How far apart are they?   The table gives the order. What decides whether the
 *                             ranking *means* anything is the gap — whether the
 *                             top two are a real choice or a coin toss — and
 *                             three numbers in a column answer that slowly.
 *   A sweep, or a split?      Ten superlatives are scattered across three
 *                             sections. Whether one property took them all or
 *                             they split four ways is visible nowhere.
 *
 * ## What was rejected, which is the more useful half
 *
 * A **risk-against-rank quadrant** — *is the best one also the riskiest?* — is
 * the most decision-relevant question the format leaves unanswered, and it is
 * still not drawn here. `riskLevel` is free text with ten distinct values in the
 * record (`Low-Moderate`, `Moderate`, `Moderate-Low`, `Moderate-High`, `Moderate
 * to High`, `High`, `High (Undetermined)`, `Very High`, `Critical`, `Extreme`),
 * three of them spellings of one idea and one meaning "unknown, assume the worst"
 * rather than a level at all. Putting that on a numeric axis manufactures
 * precision the source does not have. The question is answered instead by a
 * *column*: the risk band sits beside the rank in the verdict table, which states
 * the relationship directly and invents nothing.
 *
 * A **score wheel over the properties** — a radar's spokes must be dimensions of
 * one subject; one spoke per property makes the enclosed area an artefact of the
 * order the properties were selected in.
 *
 * A **score wheel over the criteria** (yield, growth, location, demand, risk) is
 * the right shape and the data is not here: `property_comparisons` stores no
 * per-dimension breakdown, only `finalScore`.
 *
 * A **gauge** on the top score — already the largest thing on the page in the KPI
 * strip, and a 0–100 dial is a lie on the six comparisons scored out of ten.
 *
 * A **heatmap** of property against category — the scorecard is binary, exactly
 * one winner per category, so it would be one hot cell per column: a scatter plot
 * drawn as a grid, and unable to carry the winner's reason.
 *
 * A **waterfall** — nothing in a comparison accumulates. A **bullet** — needs a
 * target, and no property here is measured against a threshold, only against the
 * others.
 *
 * Neither chart is load-bearing: each returns `''` when its data is absent or
 * degenerate, and the section prints its table either way.
 */
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import {
  chartContext,
  chartFigure,
  renderBars,
  renderDonut,
  type BarItem,
  type DonutSegment,
} from '../../reportDesign/charts.pure.ts';
import type { PropertyComparison } from './payload.pure.ts';

/** One bar is not a comparison, and two properties read better as a sentence. */
const MIN_SCORE_BARS = 2;

/**
 * Below this a proportion chart is worse than the sentence it replaces.
 *
 * The Portfolio's reasoning, unchanged: two segments is a ratio, and "Property 1
 * won nine of the thirteen categories" says it better than a picture.
 */
const MIN_DONUT_SEGMENTS = 3;

/**
 * How far apart the ranked properties are.
 *
 * The axis is the **detected denominator**, never 100 and never the maximum of
 * the data. Scaling to the data would make three scores of 41, 44 and 47 look
 * like a rout; scaling to 100 would misdraw the comparisons recorded out of ten.
 */
export function rankingChart(
  p: PropertyComparison,
  palette: ResolvedReportPalette,
): string {
  const scored = p.ranked.filter((r) => r.score !== null);
  if (scored.length < MIN_SCORE_BARS) return '';

  const outOf = scored[0].score!.outOf;
  const values = scored.map((r) => r.score!.value.value);
  if (values.every((v) => v <= 0)) return '';

  // A bar past its own axis is a drawing that lies. The admin rescale
  // (`migrate-comparison-scores`) multiplies any individual score below 15 by
  // ten, so a 0–100 comparison holding a low score would come back above its own
  // denominator. No row is in that state today; this is what stops a re-run of
  // that migration producing a chart nobody can read.
  if (values.some((v) => v > outOf)) return '';

  const items: BarItem[] = scored.map((r, i) => ({
    label: r.property.shortAddress,
    value: r.score!.value.value,
    display: `${r.score!.value.value} / ${outOf}`,
    tone: i === 0 ? 'accent' : undefined,
  }));

  const spread = Math.max(...values) - Math.min(...values);
  const caption = spread <= outOf * 0.05
    ? `The ranked properties score within ${spread.toFixed(1)} of each other — on this measure they are close to a tie.`
    : `First and last are ${spread.toFixed(1)} apart, out of ${outOf}.`;

  return chartFigure(
    renderBars(chartContext(palette), items, {
      title: 'Where they ranked',
      max: outOf,
    }),
    caption,
  );
}

/**
 * How the category wins split.
 *
 * Axes that named nobody are their own segment rather than being dropped: "no
 * clear winner" is what the analysis concluded on 18 of 92 pointers, and a chart
 * that omitted them would overstate how decisive the comparison was.
 */
export function categoryWinsChart(
  p: PropertyComparison,
  palette: ResolvedReportPalette,
): string {
  if (p.properties.length < MIN_DONUT_SEGMENTS) return '';

  const winners = p.axes.flatMap((g) => g.winners);
  if (!winners.length) return '';

  const wins = new Map<number, number>();
  let undecided = 0;
  for (const w of winners) {
    if (!w.property) undecided += 1;
    else wins.set(w.property.number, (wins.get(w.property.number) ?? 0) + 1);
  }

  const segments: DonutSegment[] = p.properties
    .filter((prop) => (wins.get(prop.number) ?? 0) > 0)
    .map((prop) => ({
      // The street line, not "Property 3": a segment that names a number tells a
      // reader nothing about which house it is.
      label: prop.shortAddress.slice(0, 28),
      value: wins.get(prop.number) ?? 0,
    }));

  // Every category undecided is a real and important answer, but it is a
  // sentence, not a doughnut with one segment.
  if (!segments.length) return '';
  if (undecided) segments.push({ label: 'No clear winner', value: undecided });
  if (segments.length < MIN_DONUT_SEGMENTS) return '';

  const total = winners.length;
  const leader = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];
  const leadProperty = p.properties.find((prop) => prop.number === leader?.[0]);
  const share = leader ? Math.round((leader[1] / total) * 100) : 0;

  const caption = leadProperty
    ? `${leadProperty.shortAddress} takes ${leader[1]} of ${total} categories`
      + (undecided ? `; ${undecided} had no clear winner.` : '.')
    : `${total} categories compared.`;

  return chartFigure(
    renderDonut(chartContext(palette), segments, {
      title: 'Category wins',
      centerLabel: `${share}%`,
      centerSub: 'to the leader',
    }),
    caption,
  );
}
