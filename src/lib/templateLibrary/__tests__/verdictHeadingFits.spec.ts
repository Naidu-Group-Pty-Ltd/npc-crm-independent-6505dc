/**
 * The verdict heading fits the two lines the block declares — on every master.
 *
 * ## What shipped, and for how long
 *
 * `verdict()` reserved `scale.verdict * 2.2` at a leading of 1.1, which is
 * exactly TWO lines, and the reservation was never measured against the
 * sentence that fills it. Measured across all fifty Compass masters on
 * 19 September 2026, at the catalogue's own 0.52 display advance:
 *
 * | what `{{recommendation.headline}}` resolves to | masters set past 2 lines |
 * | --- | ---: |
 * | `RECOMMENDATION_BY_GRADE`, unqualified (59-89 chars) | **27 of 50** |
 * | the same, qualified by coverage (142-181 chars) | **50 of 50** |
 *
 * So the block was wrong from the day the masters shipped; the coverage
 * sentence `qualifyRecommendation` appends only made it universal. On
 * 42 Patya Circuit it printed the heading's last two lines THROUGH the KPI
 * band below it — `$1,975,000` and `$850` struck out — because `flow()` fixes
 * the next block's `y` from the DECLARED height and the renderer positions
 * absolutely. An overlong block does not push the page down and does not
 * overflow it. It lays over what comes next, and every arithmetic check in the
 * build passes.
 *
 * ## Why the type moves and the box does not
 *
 * The dashboard page carries 15pt of slack above the footer on 49 of the 50
 * masters. Growing the block would push the KPI band and the footer off the
 * page on every one of them, so the block keeps its footprint exactly and the
 * heading is fitted to it.
 *
 * ## What this pins
 *
 * The property, at the vocabulary that fills the slot: **every headline the
 * projection can publish sets in two lines on every seeded master.** Not
 * today's longest string — the whole closed space, re-derived on every run
 * from `RECOMMENDATION_BY_GRADE` through `qualifyRecommendation` and
 * `splitVerdictScope`. A test pinned to a number is a test that passes the day
 * somebody appends the next sentence, which is exactly what happened.
 */
import { describe, expect, it } from 'vitest';
import {
  INVESTMENT_COMPASS_TEMPLATES,
} from '../../../../scripts/template-library/investmentCompass/templates';
import {
  BORROWING_CAPACITY_TEMPLATES,
} from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import {
  VERDICT_HEADING_LINES, displayLines, fitToLines,
} from '../../../../scripts/template-library/investmentCompass/blocks';
import {
  VERDICT_HEADLINE_CHARS, publishableVerdictHeadlines,
} from '../../../../scripts/template-library/investmentCompass/verdictVocabulary';
import {
  DESIGN_FAMILIES, familyByKey, resolveManifest, scaleFor,
} from '../../../../scripts/template-library/investmentCompass/family';

interface Slot { template: string; size: number; width: number }

/** Every `verdict()` block in a built master set, with what it will draw. */
function verdictSlots(set: readonly unknown[]): Slot[] {
  const out: Slot[] = [];
  for (const t of set as Record<string, any>[]) {
    const schema = t.schema ?? t.page_schema ?? t;
    for (const page of (schema.pages ?? []) as Record<string, any>[]) {
      for (const b of (page.blocks ?? []) as Record<string, any>[]) {
        if (b.name !== 'Verdict') continue;
        const slot = {
          template: String(t.name ?? t.key ?? '(unnamed)'),
          size: b.props.headingSize,
          width: b.props.width,
        };
        // Since seed v20 a master draws its verdict on whichever front matter
        // the tier takes — the dashboard or the summary — from ONE definition,
        // so the two blocks are the same slot. A second, different slot on one
        // master would still be counted, and fail the length below.
        if (out.some((o) => o.template === slot.template && o.size === slot.size && o.width === slot.width)) continue;
        out.push(slot);
      }
    }
  }
  return out;
}

const compass = verdictSlots(INVESTMENT_COMPASS_TEMPLATES);
const borrowing = verdictSlots(BORROWING_CAPACITY_TEMPLATES);

describe('the Compass verdict heading fits every master', () => {
  it('finds one verdict slot on each of the fifty masters', () => {
    expect(compass).toHaveLength(50);
  });

  it('sets every publishable headline in two lines, on every master', () => {
    const headlines = publishableVerdictHeadlines();
    // 8 grades × the coverages that qualify, de-duplicated.
    expect(headlines.length).toBeGreaterThanOrEqual(8);
    const over: string[] = [];
    for (const h of headlines) {
      for (const slot of compass) {
        const drawn = displayLines(h.length, slot.size, slot.width);
        if (drawn > VERDICT_HEADING_LINES) {
          over.push(`${slot.template} (${slot.size}pt / ${slot.width}pt): ${drawn} lines — ${h}`);
        }
      }
    }
    expect(
      over,
      `${over.length} of ${headlines.length * compass.length} headline×master pairs `
      + `set past ${VERDICT_HEADING_LINES} lines:\n${over.slice(0, 10).join('\n')}`,
    ).toEqual([]);
  });

  it('is sized for the longest one, which is derived and not typed', () => {
    // 99: the A+ claim, AFTER `qualifyRecommendation`'s narrowing rewrite
    // ("across all metrics" → "across the metrics assessed") and after
    // `splitVerdictScope` removes the coverage sentence. The unqualified A+
    // sentence is 89 — which is the number the two-line allowance was written
    // against, and the reason reading the raw table is not enough.
    expect(VERDICT_HEADLINE_CHARS).toBe(99);
    expect(VERDICT_HEADLINE_CHARS).toBe(
      Math.max(...publishableVerdictHeadlines().map((s) => s.length)),
    );
  });
});

describe('fitting moves the type and never the box', () => {
  it('never sets a verdict larger than its family designed', () => {
    const bigger: string[] = [];
    let matched = 0;
    for (const family of DESIGN_FAMILIES) {
      for (const variant of family.variants) {
        const manifest = resolveManifest(family, variant);
        const designed = scaleFor(family.key, manifest.density as never).verdict;
        // A master is named for its VARIANT ("Chancery"), not its family
        // ("Private Banking"). Getting that wrong makes the loop match nothing
        // and the assertion below trivially true, so the match is counted.
        const slot = compass.find((s) => s.template === variant.name);
        if (!slot) continue;
        matched += 1;
        if (slot.size > designed) bigger.push(`${slot.template}: ${slot.size} > ${designed}`);
      }
    }
    expect(matched, 'every master was matched to its family scale').toBe(compass.length);
    expect(bigger).toEqual([]);
    // Belt held by the primitive itself, whatever the master lookup above
    // matched: a slot that already fits is returned at its designed size.
    expect(fitToLines(10, 34.25, 447, 2)).toBe(34.25);
    expect(fitToLines(0, 29, 481, 2)).toBe(29);
  });

  it('leaves a short binding alone — Borrowing Capacity is untouched', () => {
    // Its verdict heading is `{{capacity.borrowing | currency}}`, an
    // 11-character figure, so nothing there was ever at risk and nothing there
    // may change. 34.25pt is `sovereign_folio`'s designed size.
    expect(borrowing).toHaveLength(50);
    expect(Math.max(...borrowing.map((s) => s.size))).toBe(34.25);
    const over = borrowing.filter((s) => displayLines(11, s.size, s.width) > VERDICT_HEADING_LINES);
    expect(over).toEqual([]);
  });

  it('refuses rather than obliging when a sentence cannot be set at all', () => {
    // The floor is the catalogue's own smallest section heading (10.25pt,
    // `institutional_research` at compact). Below it a "verdict" has stopped
    // being the page's statement, so the primitive stops shrinking and the
    // spec above fails — which is a louder, earlier signal than a document
    // that prints its verdict smaller than its body copy.
    const absurd = fitToLines(4000, 34.25, 447, 2);
    expect(absurd).toBe(10.25);
    expect(displayLines(4000, absurd, 447)).toBeGreaterThan(VERDICT_HEADING_LINES);
  });
});

describe('a bound heading may not be sized from its own source text', () => {
  it('names the rule when a length is missing', async () => {
    const blocks = await import('../../../../scripts/template-library/investmentCompass/blocks');
    const family = familyByKey('private_banking')!;
    const variant = family.variants[0];
    blocks.beginCompassTemplate(family, variant, resolveManifest(family, variant));
    expect(() => blocks.verdict({
      eyebrow: 'The verdict',
      heading: '{{recommendation.headline}}',
      body: '{{recommendation.gradedLine}}',
    })).toThrow(/verdict: `heading` is bound/);
  });
});
