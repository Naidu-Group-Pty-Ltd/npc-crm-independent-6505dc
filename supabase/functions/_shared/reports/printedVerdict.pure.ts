/**
 * The verdict the cover and the verdict page print for a stored score, or
 * null where they print none.
 *
 * `reportBindingProjection` publishes `recommendation.headline` and
 * `recommendation.action` from exactly this, and the generator hands the same
 * answer to the two sections that state a recommendation
 * (`recommendationContract` in `compassSectionContract.ts`) — so what the page
 * prints and what the prose says are one reading of one record, not two rules
 * that happen to agree. The 60 Lawley Street Compass of 25 Sep 2026 printed
 * STRONG BUY on its cover and "Proceed with caution" in its text, because the
 * sections were told to choose from a vocabulary of their own.
 *
 * An ungraded record stores the client-facing explanation where a
 * recommendation would go, and publishes no verdict at all (the owner's rule
 * of 14 Sep 2026: an absence is omitted, never worded).
 *
 * It sits here, between the two domains, because it needs a VALUE from each:
 * the investment domain's label rule and the market domain's ungraded
 * sentinel. A canonical investment module may name the market domain for its
 * types alone (`investmentSourceOfTruth.spec.ts`).
 *
 * Pure: no I/O.
 */

import { recommendationAction, splitVerdictScope } from './investment/verdictAction.pure.ts';
import { OVERALL_GRADE_UNAVAILABLE } from './market/scoringInputPolicy.pure.ts';

export function printedVerdict(score: unknown): { headline: string; action: string } | null {
  if (typeof score !== 'object' || score === null || Array.isArray(score)) return null;
  const raw = (score as Record<string, unknown>).recommendation;
  const stored = typeof raw === 'string' ? raw.trim() : '';
  if (!stored || stored === OVERALL_GRADE_UNAVAILABLE.explanation) return null;
  const headline = splitVerdictScope(stored).claim;
  const action = recommendationAction(headline);
  return headline && action ? { headline, action } : null;
}
