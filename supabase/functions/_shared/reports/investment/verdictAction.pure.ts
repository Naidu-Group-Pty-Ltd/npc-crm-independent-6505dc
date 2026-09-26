/**
 * The verdict a report issues, in the two forms the document prints it.
 *
 * Moved here from `reportBindingProjection.pure.ts` (25 Sep 2026) so that the
 * verdict page and the generator's instructions read ONE rule. The 60 Lawley
 * Street Compass of that day printed STRONG BUY on its cover and verdict page
 * and "Proceed with caution" in its Executive Verdict and Final
 * Recommendation: the page took its label from the stored recommendation
 * through `recommendationAction`, and the sections were told to choose from a
 * different vocabulary altogether. A document states one recommendation, so
 * the writer is now handed the label the page prints, from the same function.
 *
 * Pure: no imports, no I/O. What the page prints for a whole stored score —
 * including the ungraded record, which prints nothing — is
 * `printedVerdict` in `../printedVerdict.pure.ts`.
 */

/**
 * The verdict as a figure: `HOLD`, not the sentence that explains it.
 *
 * `investment_score.recommendation` is one string carrying both — "HOLD -
 * Above average investment with some positive indicators, monitor closely",
 * 69 characters on average and 78 at its longest. A KPI cell is a quarter of
 * the cover's measure, about 28mm, and a sentence that long needs five lines
 * in it: rendered through WeasyPrint the cover's VERDICT cell ran past the
 * band's bottom rule, which struck through its last line.
 *
 * The split is exact rather than a guess. Every one of the 988 scored reports
 * is either `ACTION - sentence` or the bare action, and the vocabulary is four
 * words:
 *
 * | action | with a sentence | bare |
 * | --- | ---: | ---: |
 * | `HOLD` | 799 | 56 |
 * | `CAUTION` | 98 | 1 |
 * | `HOLD/BUY` | 24 | 9 |
 * | `BUY` | 1 | 0 |
 *
 * The longest action is eight characters. A string that does not match the
 * pattern is returned whole — the caller gets the same thing `headline` would
 * have given it, which is what it printed before this existed.
 */
export function recommendationAction(headline: string | undefined): string | undefined {
  if (!headline) return undefined;
  const match = /^([A-Z][A-Za-z/ ]{1,20}?)\s+-\s+\S/.exec(headline);
  return match ? match[1].trim() : headline;
}

/**
 * The verdict CLAIM, separated from the coverage sentence appended after it.
 *
 * This paragraph used to end "`headline` is untouched, and the page-3 verdict
 * block still sets the whole sentence, where there is a full measure to set it
 * in." That was true when it was written and measured — the vocabulary in
 * `RECOMMENDATION_BY_GRADE` runs 59 to **89** characters, which sets in two
 * lines at the verdict page's 27pt.
 *
 * `qualifyRecommendation` then began appending a second sentence whenever the
 * run measured fewer than all five dimensions:
 *
 *     HOLD - Average investment with mixed indicators, monitor market
 *     conditions. Assessed on 4 of 5 dimensions: capital growth, location,
 *     rental yield and demand.
 *
 * **156 characters**, measured on the 42 Patya Circuit report of 19 Sep 2026.
 * That needs five lines where the block declares two, and the masters position
 * every block at an absolute `y` — so it did not overflow the page, it printed
 * ON TOP of the KPI band beneath it. `$1,975,000` and `$850` were struck
 * through by the heading's last two lines, and the strapline under them was
 * unreadable. `callout(…, 72)` and `decision(…, 104)` are the declared heights
 * it broke.
 *
 * Nothing is dropped and nothing is truncated. The appended sentence is split
 * off at the boundary `qualifyRecommendation` itself creates, and the CLAIM
 * alone binds the heading.
 *
 * The scope sentence is not published. It was, as `scopeNote`, "so a master
 * may set it at body size where it belongs" — and no master ever did: across
 * `scripts/template-library/`, the six `{{recommendation.*}}` paths any master
 * binds are `action`, `grade`, `gradedDetailLine`, `gradedLine`, `headline`
 * and `rationale`. Nothing is lost by dropping it, for the reason the sentence
 * above already gave: `gradedLine` names the same dimensions one line below,
 * and it IS drawn — the 9 Hollow Street Compass of 20 Sep 2026 prints
 * "Graded B+ at 65 out of 100, weighted across yield, growth and location —
 * 3 of the 5 assessment dimensions" on pages 3 and 5. Publishing a second copy
 * for a master to draw would put the coverage on the page twice.
 *
 * `splitVerdictScope` still returns the scope: the split is what keeps it out
 * of the heading, and a caller that wants it has it.
 *
 * The split is exact rather than a guess: it matches only the sentence that
 * appender writes, anchored at the end. Anything else is returned whole, which
 * is what every caller had before this existed.
 */
export function splitVerdictScope(
  headline: string | undefined,
): { claim: string | undefined; scope: string | undefined } {
  if (!headline) return { claim: undefined, scope: undefined };
  const match = /^(.*?)\.\s+(Assessed on \d+ of \d+ dimensions:[^.]*\.)\s*$/s.exec(headline.trim());
  if (!match) return { claim: headline, scope: undefined };
  return { claim: `${match[1].trim()}.`, scope: match[2].trim() };
}
