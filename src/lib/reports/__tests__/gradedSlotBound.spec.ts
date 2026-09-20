/**
 * The two BODY slots the render gate had never measured.
 *
 * ## What was missing
 *
 * `verdictSlotBound.spec.ts` closed the heading half of this: the fixture
 * carried a 35-character operator verdict while the product publishes 59 to
 * 99, so `templates:compass:qa` — a real 510-render Chromium overlap measure —
 * passed while the shipped verdict printed through the KPI band.
 *
 * The same blocks bind a body, and the fixture carried neither field:
 *
 *   - `verdict()`        sets `{{recommendation.gradedLine}}` under the claim
 *   - `recommendation()` sets `{{recommendation.gradedDetailLine}}` under its own
 *
 * `renderTextBlockHtml` draws nothing at all for a bound part that resolved to
 * nothing, so every one of those 510 renders measured a two-element block
 * where a client's page carries three. The measurement was not wrong about
 * what it looked at; it was looking at a shorter document than the one the
 * product makes. Measured 19 September 2026: `gradedLine` runs to 115
 * characters and `gradedDetailLine` to 193, and the fixture stated 0 of both.
 *
 * ## Why these are derived rather than typed
 *
 * The heading's bound went stale exactly this way — 89 was measured before
 * `qualifyRecommendation` existed and nothing re-measured. So this walks the
 * grade x coverage x measured-dimension space `gradedLine` can be called with
 * and asserts the fixture carries the longest string that walk produces. A
 * fixture pinned to today's wording passes the day somebody lengthens the
 * sentence, which is the failure this file exists to prevent.
 *
 * The longest form is the A+ / 100 / four-of-five one, and it is worth saying
 * why it is not the five-of-five one: `assessedOfTotal` returns null once
 * every dimension is scored, so the coverage qualifier and the longest
 * weighting clause are longest TOGETHER one dimension short of complete.
 */

import { describe, expect, it } from 'vitest';
import {
  gradedDetailLine,
  gradedLine,
} from '../../../../supabase/functions/_shared/reports/investment/scoreSections.pure';
import { RECOMMENDATION_BY_GRADE } from '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure';
import { SAMPLE_REPORT_DATA } from '../../templateLibrary/sampleReportData';

/** The composite engine's five dimension keys, as `breakdownEntries` reads them. */
const KEYS = ['growthScore', 'locationScore', 'yieldScore', 'demandScore', 'riskScore'] as const;

function subsets<T>(items: readonly T[]): T[][] {
  return items
    .reduce<T[][]>((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]])
    .filter((s) => s.length > 0);
}

/**
 * Every `(gradedLine, gradedDetailLine)` pair the projection can publish for a
 * composite score, over every grade, every measured subset and both coverage
 * readings (partial, and complete — which suppresses the qualifier).
 */
function publishableGradedLines(): Array<{ line: string; detail: string }> {
  const out: Array<{ line: string; detail: string }> = [];
  for (const grade of Object.keys(RECOMMENDATION_BY_GRADE)) {
    // `Math.round(total)` is what reaches the string, so the widest is 100.
    for (const totalScore of [0, 58, 92, 100]) {
      for (const measured of subsets(KEYS)) {
        const breakdown: Record<string, unknown> = {};
        for (const key of measured) breakdown[key] = { weight: 20, score: 70, details: 'x' };
        for (const dimensionsScored of [measured.length, KEYS.length]) {
          const score = {
            grade,
            totalScore,
            breakdown,
            coverage: { dimensionsScored, totalDimensions: KEYS.length },
          };
          const line = gradedLine(score);
          const detail = gradedDetailLine(score);
          if (line && detail) out.push({ line, detail });
        }
      }
    }
  }
  return out;
}

const PUBLISHABLE = publishableGradedLines();
const LONGEST_LINE = PUBLISHABLE.reduce((a, b) => (b.line.length > a.line.length ? b : a)).line;
const LONGEST_DETAIL = PUBLISHABLE.reduce((a, b) => (b.detail.length > a.detail.length ? b : a)).detail;

const fixture = (SAMPLE_REPORT_DATA as Record<string, unknown>).recommendation as {
  gradedLine?: string;
  gradedDetailLine?: string;
};

describe('the graded body slots are bounded, and the fixture states the bound', () => {
  it('walks a space large enough to be a measurement rather than a sample', () => {
    // 8 grades x 4 totals x 31 subsets x 2 coverage readings.
    expect(PUBLISHABLE.length).toBe(Object.keys(RECOMMENDATION_BY_GRADE).length * 4 * 31 * 2);
  });

  it('the longest graded line is the A+ / 100 / four-of-five form', () => {
    expect(LONGEST_LINE).toBe(
      'Graded A+ at 100 out of 100, weighted across growth, location, yield '
      + 'and demand — 4 of the 5 assessment dimensions.',
    );
    expect(LONGEST_LINE.length).toBe(115);
  });

  it('the detail line is the graded line plus one fixed sentence', () => {
    expect(LONGEST_DETAIL.startsWith(LONGEST_LINE)).toBe(true);
    expect(LONGEST_DETAIL.length).toBe(193);
    for (const { line, detail } of PUBLISHABLE) {
      expect(detail.length).toBe(line.length + LONGEST_DETAIL.length - LONGEST_LINE.length);
    }
  });

  it('the coverage qualifier and the longest weighting clause are longest one short of complete', () => {
    const complete = PUBLISHABLE.filter((p) => !p.line.includes('assessment dimensions'));
    const partial = PUBLISHABLE.filter((p) => p.line.includes('assessment dimensions'));
    expect(complete.length).toBeGreaterThan(0);
    expect(partial.length).toBeGreaterThan(0);
    const longestComplete = Math.max(...complete.map((p) => p.line.length));
    expect(LONGEST_LINE.length).toBeGreaterThan(longestComplete);
  });

  /*
   * The point of the whole file. A gate measuring an absent body is measuring
   * the fixture, and a block the fixture leaves empty is a block nothing has
   * ever sized.
   */
  it('the render fixture carries both slots, at the length the product publishes', () => {
    expect(fixture.gradedLine).toBe(LONGEST_LINE);
    expect(fixture.gradedDetailLine).toBe(LONGEST_DETAIL);
  });

  it('a score that cannot state a grade publishes neither slot', () => {
    expect(gradedLine({ grade: 'N/A', totalScore: 40, policy: { gradeIssued: false } })).toBeUndefined();
    expect(gradedDetailLine({ grade: 'B', totalScore: undefined })).toBeUndefined();
    expect(gradedDetailLine(null)).toBeUndefined();
  });
});
