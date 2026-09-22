/**
 * The fallback section count must equal the list the generator generates.
 *
 * ## What reached the screen
 *
 * The 97 Poole Road regeneration of 20 Sep 2026 wrote all fourteen of its
 * sections, drew `14/14 sections · 100%` in the progress widget, and was then
 * recorded as **Failed**. The card beside it read `12/15` at the same moment
 * the widget read `Section 12 of 14` — two counters, one screen, two answers.
 *
 * One off-by-one caused all of it. `sectionCountForTier` returned
 * `COMPASS_40_SECTIONS.length` — the RAW array — while the generator loops
 * `compassSections()`, the array FILTERED on `includeInCompass`. They agreed
 * until `compass.cover` was excluded in 2026-09, and from that day the
 * client's fallback said 15 where the server wrote 14:
 *
 *   * the hook resolves its total ONCE at kickoff, so the card held 15 all run;
 *   * the loop ran a fifteenth iteration against a server that has fourteen;
 *   * and `last_completed_section >= totalSections` was `14 >= 15`, so a
 *     complete run threw "Report regeneration incomplete" and stamped the row
 *     `failed`.
 *
 * The document was never damaged. Only the verdict was wrong.
 *
 * These tests are the two halves of the guarantee: the count is derived from
 * the generated list rather than restated, and no tier may declare a different
 * number from the one it produces.
 */
import { describe, it, expect } from 'vitest';
import {
  COMPASS_40_SECTIONS,
  sectionCountForTier,
  compassSections,
  financialSections,
} from '@/lib/reports/compassSectionRegistry';

describe('the fallback count is the generated count', () => {
  it('counts the Compass sections that are actually generated', () => {
    expect(sectionCountForTier('compass-40')).toBe(compassSections().length);
  });

  it('counts the Financial sections that are actually generated', () => {
    expect(sectionCountForTier('financial-analysis')).toBe(financialSections().length);
  });

  it.each([
    ['compass', 'compass'],
    ['Compass-40', 'compass'],
    ['an unknown spelling', 'not-a-tier'],
    ['nothing at all', undefined],
    ['null', null],
  ])('agrees with the generated list for %s', (_name, raw) => {
    expect(sectionCountForTier(raw)).toBe(compassSections().length);
  });
});

describe('a section the Compass excludes is not counted', () => {
  it('leaves the model-written cover out of the generated list', () => {
    // Excluded in 2026-09: it printed as a SECOND cover inside the body.
    expect(compassSections().map((s) => s.id)).not.toContain('compass.cover');
  });

  it('is the exclusion that made the two counters disagree', () => {
    // The raw array still carries it — which is the whole point. The count must
    // come from the filter, not from the array's length.
    //
    // Stated as a RELATION rather than a literal, because a literal here is the
    // defect the file is named for: `15` was the array's length when this was
    // written, so the assertion silently became "16 < 15" the day W2.2 added
    // two sections — a spec restating a number the product derives, which is
    // how `sectionCountForTier` and `compassSections()` came to disagree in
    // the first place.
    expect(compassSections().length).toBeLessThan(COMPASS_40_SECTIONS.length);
    expect(sectionCountForTier('compass-40')).toBe(compassSections().length);
  });
});

describe('no tier may declare a number it does not produce', () => {
  it.each([
    ['compass-40', () => compassSections()],
    ['financial-analysis', () => financialSections()],
  ])('%s', (tier, list) => {
    const produced = list();
    expect(sectionCountForTier(tier)).toBe(produced.length);
    // Every section the count admits is one the generator will be asked for.
    expect(produced.every((s) => s.id && s.ordinal > 0)).toBe(true);
  });
});
