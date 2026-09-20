/**
 * How long the Compass verdict heading can actually be.
 *
 * `{{recommendation.headline}}` is not free text. `reportBindingProjection`
 * publishes it from a CLOSED vocabulary — the eight sentences of
 * `RECOMMENDATION_BY_GRADE`, narrowed by `qualifyRecommendation` where the run
 * measured fewer than all five dimensions, with the coverage sentence split
 * off by `splitVerdictScope`. So the longest string that can reach the page is
 * knowable exactly, at build time, and the master can be sized for it.
 *
 * It is DERIVED rather than typed, for the reason the whole defect exists:
 * the number was 89 when the verdict block's two-line allowance was written,
 * `qualifyRecommendation` was added afterwards, and nothing re-measured. A
 * constant somebody has to remember to update is a constant that goes stale.
 * This one re-derives on every seed build, and `verdictHeadingFits.spec.ts`
 * re-derives it again and fails if any master can no longer set it.
 *
 * `qualifyRecommendation` also REWRITES the base sentence where it qualifies
 * it ("across all metrics" → "across the metrics assessed"), which makes the
 * A+ claim 99 characters against the 89 of its unqualified form. That is why
 * this walks the qualified forms rather than measuring the raw vocabulary: the
 * raw table is not what the page receives.
 *
 * This module lives in the template library rather than beside the projection
 * so that `reportBindingProjection.pure.ts` — which the frontend imports —
 * does not acquire the scoring engine's whole dependency graph for the sake of
 * one build-time number.
 */
import {
  RECOMMENDATION_BY_GRADE,
  qualifyRecommendation,
} from '../../../supabase/functions/_shared/reports/market/scoringV2Production.pure';
import { splitVerdictScope } from '../../../supabase/functions/_shared/reportBindingProjection.pure';

/** The engine's five dimensions, in the order `qualifyRecommendation` lists them. */
const DIMENSIONS = ['growth', 'yield', 'demand', 'location', 'risk'] as const;

/** Every non-empty subset, so the walk is the whole space rather than a sample. */
function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]])
    .filter((s) => s.length > 0);
}

/**
 * Every headline `recommendation.headline` can resolve to, qualified and not.
 *
 * Exported so the spec walks the same list the sizing does — two
 * enumerations of one vocabulary is how the two come to disagree.
 */
export function publishableVerdictHeadlines(): string[] {
  const out = new Set<string>();
  for (const grade of Object.keys(RECOMMENDATION_BY_GRADE)) {
    for (const measured of subsets(DIMENSIONS)) {
      const claim = splitVerdictScope(
        qualifyRecommendation(grade, measured, DIMENSIONS.length),
      ).claim;
      if (claim) out.add(claim);
    }
  }
  return [...out];
}

/** The longest of them, which is what the verdict block is sized for. */
export const VERDICT_HEADLINE_CHARS = Math.max(
  ...publishableVerdictHeadlines().map((s) => s.length),
);
