/**
 * The verdict heading fits the block that draws it.
 *
 * ## What the 42 Patya Circuit report printed, 19 September 2026
 *
 * Page 3, the executive dashboard. The verdict heading read:
 *
 *     HOLD - Average investment with mixed indicators, monitor market
 *     conditions. Assessed on 4 of 5 dimensions: capital growth, location,
 *     rental yield and demand.
 *
 * 156 characters. The masters position every block at an absolute `y`, so an
 * overlong heading does not push the page down and does not overflow it — it
 * prints ON TOP of whatever is beneath. `$1,975,000` and `$850` in the KPI
 * band were struck through by the heading's last two lines.
 *
 * ## Why it is fixed at the source and not at the sink
 *
 * `RECOMMENDATION_BY_GRADE` is eight sentences of 59 to 89 characters, which
 * set in two lines at the verdict page's size — the declared heights
 * (`callout(…, 72)`, `decision(…, 104)`, and the Compass `verdict` block) were
 * measured against exactly that. `qualifyRecommendation` then began appending
 * a SECOND sentence naming the dimensions, and nothing measured the result.
 *
 * Truncating at the block would destroy the sentence. Shortening the
 * vocabulary would change eight documents' worth of wording for a reason that
 * has nothing to do with the words. So the appended sentence is SPLIT OFF at
 * the boundary the appender itself creates and published under its own name:
 * the claim goes to `headline`, which is what every selectable master binds,
 * and the scope goes to `scopeNote`, which a master may set at body size.
 *
 * The report already states the same fact one line below — `gradedLine` names
 * the dimensions in the body of the very same block — so nothing a reader
 * needs leaves the page.
 *
 * ## The bound is 99, not 89, and that is the finding
 *
 * The first version of this file asserted the claim stayed inside the 89 of
 * the unqualified vocabulary. It does not, and executing it is what showed
 * why: `qualifyRecommendation` does not only APPEND a sentence, it REWRITES
 * the base one — "across all metrics" becomes "across the metrics assessed",
 * "in most areas" becomes "in most of the areas assessed" — because a
 * coverage caveat beside "across all metrics" contradicts itself in one line.
 * That narrowing is right, and it takes the A+ claim from 89 to 99.
 *
 * So reading `RECOMMENDATION_BY_GRADE` is not enough to know what the page
 * receives, and a block sized against that table is sized against a string the
 * product no longer prints. The masters are fitted to the QUALIFIED forms —
 * `verdictVocabulary.ts` walks them and `verdictHeadingFits.spec.ts` measures
 * every master against every one.
 *
 * ## What this pins
 *
 * That the split is exact and lossless, that it touches nothing else, and that
 * the longest thing the projection can publish is the number the template
 * library sizes for. A test pinned to today's string would pass the day
 * somebody appends the next sentence, which is precisely what happened.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  projectInvestmentReport,
  splitVerdictScope,
} from '../../../../supabase/functions/_shared/reportBindingProjection.pure.ts';
import {
  RECOMMENDATION_BY_GRADE,
  qualifyRecommendation,
} from '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure.ts';
import {
  VERDICT_HEADLINE_CHARS,
} from '../../../../scripts/template-library/investmentCompass/verdictVocabulary';

/**
 * The longest UNQUALIFIED sentence — what the verdict block's two-line
 * allowance was written against, and not what the page receives.
 */
const LONGEST_UNQUALIFIED = Math.max(
  ...Object.values(RECOMMENDATION_BY_GRADE).map((s) => s.length),
);

/** Every dimension key `qualifyRecommendation` knows, in the engine's order. */
const DIMENSIONS = ['growth', 'yield', 'demand', 'location', 'risk'] as const;

describe('the verdict claim fits the slot, whatever the coverage', () => {
  it('measures the vocabulary the block heights were sized against', () => {
    // 89 is the A+ sentence. If this ever changes, the numbers in the doc
    // comments above and in `splitVerdictScope` are stale and so is the
    // geometry — which is the whole point of reading it rather than typing it.
    expect(LONGEST_UNQUALIFIED).toBe(89);
    expect(Object.keys(RECOMMENDATION_BY_GRADE)).toHaveLength(8);
  });

  /*
   * Every grade against every coverage the engine can produce: 1 through 4 of
   * 5 measured dimensions (5 of 5 is not qualified at all, by design) over
   * every subset of that size. That is the complete space of headings this
   * product can print, not a sample of it.
   */
  const subsets = <T,>(items: readonly T[], size: number): T[][] => {
    if (size === 0) return [[]];
    if (items.length < size) return [];
    const [head, ...rest] = items;
    return [
      ...subsets(rest, size - 1).map((s) => [head, ...s]),
      ...subsets(rest, size),
    ];
  };

  /** The longest claim over the whole space: 8 grades × 31 coverages. */
  function longestClaim(): number {
    let longest = 0;
    let checked = 0;
    for (const grade of Object.keys(RECOMMENDATION_BY_GRADE)) {
      for (let size = 1; size <= DIMENSIONS.length; size += 1) {
        for (const measured of subsets(DIMENSIONS, size)) {
          const { claim } = splitVerdictScope(
            qualifyRecommendation(grade, measured, DIMENSIONS.length),
          );
          checked += 1;
          longest = Math.max(longest, (claim ?? '').length);
        }
      }
    }
    // 8 grades × 31 non-empty subsets of 5. The whole space, not a sample.
    expect(checked).toBe(248);
    return longest;
  }

  it('is bounded — and the bound exceeds the unqualified vocabulary', () => {
    // 99 against 89: `qualifyRecommendation` rewrites "across all metrics" to
    // "across the metrics assessed" before appending anything, so the claim
    // this product prints is LONGER than any sentence in the table it comes
    // from. Which is why the masters are fitted to this number, not to that.
    expect(longestClaim()).toBe(99);
    expect(longestClaim()).toBeGreaterThan(LONGEST_UNQUALIFIED);
  });

  it('is the number the template library sizes the verdict block for', () => {
    // Two enumerations of one vocabulary is how the two come to disagree, so
    // the sizing constant is checked against this walk rather than trusted.
    expect(VERDICT_HEADLINE_CHARS).toBe(longestClaim());
  });

  it('loses nothing: claim and scope reconstruct the sentence', () => {
    const qualified = qualifyRecommendation('C', ['growth', 'location', 'yield', 'demand'], 5);
    const { claim, scope } = splitVerdictScope(qualified);
    expect(`${claim} ${scope}`).toBe(qualified);
    expect(scope).toBe(
      'Assessed on 4 of 5 dimensions: capital growth, location, rental yield and demand.',
    );
    expect(claim).toBe(
      'HOLD - Average investment with mixed indicators, monitor market conditions.',
    );
  });

  it('returns an unqualified verdict whole, with no scope note', () => {
    for (const sentence of Object.values(RECOMMENDATION_BY_GRADE)) {
      const full = qualifyRecommendation(
        Object.keys(RECOMMENDATION_BY_GRADE).find((g) => RECOMMENDATION_BY_GRADE[g] === sentence)!,
        [...DIMENSIONS],
        DIMENSIONS.length,
      );
      expect(full).toBe(sentence);
      const { claim, scope } = splitVerdictScope(full);
      expect(claim).toBe(sentence);
      expect(scope).toBeUndefined();
    }
  });

  it('touches nothing that is not the appended sentence', () => {
    // An operator-written verdict, a legacy row, a sentence that merely
    // mentions dimensions — all pass through unchanged. The split matches the
    // appender's own output anchored at the end, and nothing else.
    for (const other of [
      'Proceed to offer at or below $1.29m',
      'HOLD - Average investment with mixed indicators, monitor market conditions.',
      'Assessed on 4 of 5 dimensions: capital growth, location, rental yield and demand.',
      'BUY. Assessed on 4 of 5 dimensions: capital growth, location, rental yield and demand. Reviewed by the analyst.',
    ]) {
      expect(splitVerdictScope(other)).toEqual({ claim: other, scope: undefined });
    }
    expect(splitVerdictScope(undefined)).toEqual({ claim: undefined, scope: undefined });
  });
});

describe('the projection publishes them apart', () => {
  const qualified = qualifyRecommendation('C', ['growth', 'location', 'yield', 'demand'], 5);

  const project = (recommendation: string) => projectInvestmentReport({
    id: 'r1',
    property_address: '42 Patya Circuit, Kellyville NSW 2155',
    investment_score: {
      grade: 'C',
      totalScore: 40,
      recommendation,
      breakdown: {
        growthScore: { score: 56, weight: 57, hasData: true, excluded: false },
        yieldScore: { score: 23, weight: 21, hasData: true, excluded: false },
        demandScore: { score: 13, weight: 21, hasData: true, excluded: false },
        locationScore: { score: 0, weight: 0, hasData: false, excluded: true },
        riskScore: { score: 0, weight: 0, hasData: false, excluded: true },
      },
    },
  } as never).recommendation as Record<string, unknown>;

  it('binds the claim alone to headline, and the coverage nowhere', () => {
    /*
     * RENEGOTIATED 20 September 2026. The claim half is unchanged and is the
     * whole point of the split: the coverage sentence must not reach the
     * heading, which is what struck `$1,975,000` and `$850` through on
     * 42 Patya Circuit.
     *
     * The other half asserted the coverage was published as `scopeNote` "so a
     * master may set it at body size". No master ever did — across
     * `scripts/template-library/` the only `{{recommendation.*}}` paths any
     * master binds are action, grade, gradedDetailLine, gradedLine, headline
     * and rationale — and `gradedLine` already names the same dimensions one
     * line below, drawn on pages 3 and 5 of every delivered Compass. A second
     * copy for a master to draw would put the coverage on the page twice, so
     * the binding is gone and the split still does its job.
     */
    const r = project(qualified);
    expect(r.headline).toBe(
      'HOLD - Average investment with mixed indicators, monitor market conditions.',
    );
    expect(String(r.headline).length).toBeLessThanOrEqual(LONGEST_UNQUALIFIED);
    expect(r.scopeNote, 'a binding no master draws is not published').toBeUndefined();
    // The coverage the split removed is still on the page, one line below:
    // `gradedLine` names the dimensions that carried the grade. (Its "N of the
    // 5 assessment dimensions" clause is appended only where the record states
    // the count, so the assertion is on what it always names.)
    expect(String(r.gradedLine)).toMatch(/weighted across .+/);
  });

  it('no master binds a recommendation path the projection does not publish', () => {
    /*
     * The general form of the same defect, checked rather than promised: the
     * catalogue's masters and the projection are two halves of one contract,
     * and an unresolved binding renders as the empty string rather than as a
     * visible `{{…}}`.
     */
    const bound = new Set<string>();
    for (const file of [
      'scripts/template-library/templates.ts',
      'scripts/template-library/templatesExtended.ts',
      'scripts/template-library/investmentCompass/templates.ts',
    ]) {
      let text: string;
      try { text = readFileSync(resolve(__dirname, '../../../../', file), 'utf8'); } catch { continue; }
      for (const m of text.matchAll(/\{\{recommendation\.([a-zA-Z]+)/g)) bound.add(m[1]);
    }
    expect(bound.size, 'no master binds recommendation at all?').toBeGreaterThan(0);
    const published = new Set(Object.keys(project(qualified)));
    expect([...bound].filter((k) => !published.has(k))).toEqual([]);
  });

  it('keeps the action word, which is read off the claim', () => {
    // `recommendationAction` matches `ACTION - sentence`. It read the whole
    // 156-character string before this, and the action is what the cover's
    // Verdict cell draws.
    expect(project(qualified).action).toBe('HOLD');
  });

  it('publishes no scope note where the verdict carries none', () => {
    const r = project(RECOMMENDATION_BY_GRADE['C']);
    expect(r.headline).toBe(RECOMMENDATION_BY_GRADE['C']);
    expect(r.scopeNote).toBeUndefined();
  });

  it('still publishes no verdict at all on an ungraded record', () => {
    // The rule this must not disturb: an ungraded record publishes NO verdict
    // — not a placeholder, not a confession.
    const r = projectInvestmentReport({
      id: 'r2',
      property_address: 'x',
      investment_score: { grade: 'N/A' },
    } as never).recommendation as Record<string, unknown>;
    expect(r.headline).toBeUndefined();
    expect(r.scopeNote).toBeUndefined();
    expect(r.action).toBeUndefined();
  });
});
