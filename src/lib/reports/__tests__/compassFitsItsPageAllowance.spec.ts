/**
 * The document the registry declares fits the pages the master sets aside.
 *
 * ## Why this exists
 *
 * `compassSectionRegistry` declares how long a Compass may be — sixteen
 * sections and 8,950 words of narrative, before ~107 chart directives and the
 * appended registers. `investmentCompass/templates.ts` declares how many pages
 * the master reserves to draw it — `NARRATIVE_PAGES`, forty continuation
 * pages, each conditional on `narrative.pages > n`, with a "Not the whole
 * report" page past the last one.
 *
 * **Nothing connected the two.** A section added to the registry could push
 * the body past the allowance and the only symptom would be a client's
 * document ending on *"This document carries the first part"* instead of
 * Sources and methodology. That is `markdownPaging`'s own rule one layer out —
 * *a master makes page N conditional on a published page count while the block
 * decides what page N holds, and one line of drift prints a blank page or
 * loses the end of a section* — applied to the budget rather than the bucket.
 *
 * ## The instrument, which is the part that was got wrong first
 *
 * Measured 22 Sep 2026 with `packMarkdownPages` on the default charge model,
 * the v4.1 ceiling read **40 pages against a 40-page allowance** and adding
 * one register tipped it to 41 — an alarm, and a false one. The projection
 * does not use that path: it resolves the calibrated narrative profile and
 * packs with `packNarrativePages`, and the calibrated model measures the real
 * measure at **95 characters a line where the legacy model assumes 65**. On
 * the path production actually takes the same document is 18 pages, and 19
 * with the register.
 *
 * So the first assertion here is about the INSTRUMENT: the profile must
 * resolve. A test that silently fell back to the legacy model would be the
 * same wrong measurement wearing a passing tick — *an instrument that can fail
 * the way its subject fails is not an instrument*.
 *
 * ## What it measured
 *
 * | source                              | packed pages | allowance |
 * | ----------------------------------- | ------------ | --------- |
 * | v4.0 ceiling (14 sections, 8,350w)  | 17           | 40        |
 * | v4.1 ceiling (16 sections, 8,950w)  | 18           | 40        |
 * | v4.1 ceiling + a real register block| 19           | 40        |
 * | the renderer's own `maxChars` limit | 35           | 40        |
 *
 * The last row is the true worst case: `REPORT_BODY_LIMITS.maxChars` is the
 * most the renderer will ever draw, so a body that large is the largest
 * document the master can be asked for. It fits, with five pages in hand.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compassSections } from '@/lib/reports/compassSectionRegistry';
import { renderMarkdown, REPORT_BODY_LIMITS }
  from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { packNarrativePages, resolveNarrativeProfile }
  from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';

const REPO = resolve(__dirname, '../../../..');
const TEMPLATES = 'scripts/template-library/investmentCompass/templates.ts';

/** The master's declared allowance, read from the source that declares it. */
function narrativePages(): number {
  const src = readFileSync(resolve(REPO, TEMPLATES), 'utf8');
  const m = /const NARRATIVE_PAGES = (\d+);/.exec(src);
  expect(m, `${TEMPLATES} no longer declares NARRATIVE_PAGES`).toBeTruthy();
  return Number(m![1]);
}

/**
 * A Compass written to its declared CEILING — every section at its word cap,
 * with the measured ~107 chart directives spread through it.
 *
 * The ceiling and not a median, because the registry's caps are what the
 * prompt permits and §5's rule is that a fixture shorter than the product
 * turns a measurement into a statement about the fixture.
 */
function ceilingBody(): string {
  const sections = compassSections();
  const figuresEach = Math.ceil(107 / sections.length);
  return sections.map((s) => {
    const out = [`## ${s.name}`, ''];
    let left = s.maxWordCount;
    let paragraphs = 0;
    let figures = figuresEach;
    while (left > 0) {
      const n = Math.min(left, 80);   // COMPASS_WORD_CAPS.standardParagraph max
      out.push(`${'suburb '.repeat(n).trim()}.`, '');
      left -= n;
      paragraphs += 1;
      if (paragraphs % 3 === 0 && figures > 0) {
        out.push('{{bars: Measured series | Alpha 42 | Beta 31 | Gamma 27}}', '');
        figures -= 1;
      }
    }
    while (figures-- > 0) out.push('{{bars: Measured series | Alpha 42 | Beta 31}}', '');
    return out.join('\n');
  }).join('\n');
}

/** EXACTLY what `reportBindingProjection` does to count `narrative.pages`. */
function packedPages(source: string): number {
  const profile = resolveNarrativeProfile('investment');
  expect(profile, 'the investment narrative profile no longer resolves — this '
    + 'test would silently fall back to the legacy charge model and measure '
    + 'the wrong thing').toBeTruthy();
  const { blocks } = renderMarkdown(source, {
    ...REPORT_BODY_LIMITS,
    charging: (profile as { charging?: 'legacy' | 'measured' }).charging,
  });
  return packNarrativePages(blocks, profile!, 34).length;
}

describe('the Compass fits the pages its master sets aside for it', () => {
  it('resolves the calibrated profile the projection resolves', () => {
    const profile = resolveNarrativeProfile('investment');
    expect(profile).toBeTruthy();
    // The legacy model assumes 65 characters a line; the calibrated one
    // measured 95 through the real master on the pinned engine. Packing on the
    // wrong one over-counts by about a third, which is how a false alarm gets
    // raised about a document that fits.
    expect((profile as { charging?: string }).charging).toBe('measured');
  });

  it('packs the DECLARED CEILING inside the allowance, with room to spare', () => {
    const allowance = narrativePages();
    const pages = packedPages(ceilingBody());
    expect(pages).toBeLessThan(allowance);
    // Not merely "fits": a document that only just fits is one section away
    // from the "Not the whole report" page. A quarter of the allowance is the
    // margin this is asserted at.
    expect(pages, `the Compass ceiling packs to ${pages} of ${allowance} pages`)
      .toBeLessThanOrEqual(Math.floor(allowance * 0.75));
  });

  it('packs the RENDERER\'S OWN MAXIMUM inside the allowance', () => {
    /*
     * The true worst case, and the one the registry cannot bound: whatever the
     * registry declares, `REPORT_BODY_LIMITS.maxChars` is the most the
     * renderer will ever draw, so a body that size is the largest document the
     * master can be handed. Pure prose is the CHEAPEST content per character,
     * so this is a floor on the page count rather than a ceiling — and it
     * still fits.
     */
    const paragraph = `${'suburb '.repeat(78).trim()}.\n\n`;
    const atLimit = paragraph
      .repeat(Math.ceil(REPORT_BODY_LIMITS.maxChars / paragraph.length))
      .slice(0, REPORT_BODY_LIMITS.maxChars);
    expect(packedPages(atLimit)).toBeLessThan(narrativePages());
  });

  it('states the allowance in one place, which this reads rather than restates', () => {
    // A second copy of `40` here is how the two come to disagree — the rule
    // `AML_COMMAND_REFRESH_EVENT`, `riskRegisterInstruction` and
    // `PROTECTED_SECTION_IDS` have each paid for.
    const src = readFileSync(resolve(REPO, TEMPLATES), 'utf8');
    expect((src.match(/const NARRATIVE_PAGES = \d+;/g) ?? []).length).toBe(1);
    expect(narrativePages()).toBeGreaterThan(0);
  });
});
