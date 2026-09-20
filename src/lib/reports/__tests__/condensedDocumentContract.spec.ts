/**
 * What the two CONDENSED documents must contain — the Executive Briefing and
 * the Snapshot.
 *
 * These are the two tiers made by condensing a Compass rather than splitting
 * one. Drawn and read on 20 Sep 2026, their SHAPE held up: 12 of 12 and 9 of 9
 * declared sections, in the registry's own order, with the composed sections
 * placed where it declares them. What did not hold up was what judged them.
 *
 * **The Briefing was post-processed as the Compass.**
 * `condense-investment-report` called `postProcessReportMarkdown(content,
 * 'compass-40')` — the same literal, at the same call site, that
 * `runQAValidation` beside it was fixed for and this line was not. Measured on
 * a twelve-section briefing: **0 of its 12 headings are Compass titles**, but
 * three ALIAS onto Compass sections, so three were trimmed at the Compass's
 * caps (450 words on an "Executive Summary" the guide asks for in "4-6
 * sentences") and the other nine were capped at nothing. The page-pressure
 * trim measured a tier declared at 12 pages against the Compass's band of 38,
 * so it could not fire however long the document ran — a briefing estimating
 * 28 pages passed with `trimsApplied: []`.
 *
 * The rule was already written in the post-processor itself, on
 * `stripEditorialLabelsFromMarkdown`, and it already named the Snapshot:
 * *their own section lists are not the Compass registry's, so the full
 * post-processor's word caps and page-pressure trims must not touch them.*
 * The Snapshot obeyed it. The Briefing is the same kind of document and did
 * not.
 *
 * **And the frontend mirror had drifted.** `src/lib/reports/compassPostProcessor.ts`
 * was a hand-maintained copy missing Phase 7 entirely — `scrubBlocks`, which
 * drops a stat card stating nothing and a chart already drawn — so the two
 * specs importing it were asserting against a module production does not run.
 * It is an `export *` bridge now, which is the remedy
 * `compassRegistryParity.spec.ts` names for exactly this pair of files.
 */
import { describe, expect, it } from 'vitest';

import {
  composeCondensedDocument, CONDENSED_PAGE_CEILING,
} from '../../../../supabase/functions/_shared/reports/investment/condenseCompose.pure';
import {
  estimatePages, postProcessReportMarkdown,
} from '../../../../supabase/functions/_shared/compassPostProcessor';
import {
  COMPASS_40_SECTIONS, COMPASS_PAGE_BAND, FINANCIAL_ANALYSIS_SECTIONS,
} from '../../../../supabase/functions/_shared/compassSectionRegistry';
import {
  markdownHeadingsForTier, sectionsForTier,
} from '../../../../supabase/functions/_shared/reports/investment/sectionRegistry.pure';

const INVESTMENT_SCORE = {
  totalScore: 61,
  grade: 'B',
  breakdown: {
    capitalGrowth: { score: 56, weight: 57, details: 'Open-data median series', hasData: true, excluded: false },
    location: { score: 64, weight: 21, details: 'Amenity distance and commute', hasData: true, excluded: false },
    rentalYield: { score: 32, weight: 21, details: 'Gross 3.47% against a 4.36% corpus median', hasData: true, excluded: false },
  },
  strengths: ['Strong corridor infrastructure'],
  weaknesses: ['Yield below the corpus median'],
  opportunities: ['Rezoning under review'],
  risks: ['Supply pipeline at 241 dwellings'],
};

const FINANCIALS = {
  keyMetrics: { grossRentalYield: 3.47, netRentalYield: 2.1, weeklyNet: -420, annualNet: -21_840, lvr: 80, totalInvestment: 480_000 },
  income: { weeklyRent: 850 },
  annualCosts: { totalAnnual: 18_500 },
  loanDetails: { loanAmount: 1_580_000, interestRate: 6.1 },
  assumptions: { capitalGrowth: 4.5 },
  initialCosts: { propertyValue: 1_975_000 },
};

/**
 * What the model is ASKED for, written to each guide's structure.
 *
 * Taken as the declared headings the guide asks a model to author — the
 * composed ones are ours and are placed afterwards, so including them would
 * make "did the model follow the guide" answer itself.
 */
const authored = (tier: 'briefing' | 'snapshot') =>
  sectionsForTier(tier as never)
    .filter((s) => s.surface === 'markdown' && s.placement.producer?.kind === 'authored')
    .map((s) => s.label);

const modelOutput = (tier: 'briefing' | 'snapshot', words = 40) =>
  authored(tier)
    .map((h) => `## ${h}\n\n${`Prose for ${h}. `.repeat(words)}\n`)
    .join('\n');

const draw = (tier: 'briefing' | 'snapshot', markdown?: string) => composeCondensedDocument({
  tier,
  modelMarkdown: markdown ?? modelOutput(tier),
  investmentScore: INVESTMENT_SCORE,
  financialCalculations: FINANCIALS,
});

const headings = (md: string): string[] =>
  [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);

describe('the document a condensed tier declares is the document it draws', () => {
  it.each(['briefing', 'snapshot'] as const)('%s: every declared section is present, in the declared order', (tier) => {
    const declared = markdownHeadingsForTier(tier as never);
    const drawn = headings(draw(tier).markdown);
    expect(drawn).toEqual(declared);
  });

  it.each(['briefing', 'snapshot'] as const)('%s: the guide and the composers together cover exactly what is declared', (tier) => {
    const declared = new Set(markdownHeadingsForTier(tier as never));
    const composed = sectionsForTier(tier as never)
      .filter((s) => s.surface === 'markdown' && s.placement.producer?.kind === 'composed')
      .map((s) => s.label);
    for (const label of [...authored(tier), ...composed]) {
      expect(declared.has(label), `"${label}" is produced but not declared`).toBe(true);
    }
    expect(authored(tier).length + composed.length).toBe(declared.size);
  });
});

describe('a tier is not judged by another tier\'s rules', () => {
  /**
   * The three briefing headings that ALIAS a Compass section, and the cap each
   * was being cut at. Derived from the registry rather than typed, so the day
   * a Compass alias changes this test still describes the real collision.
   */
  const ALIASED = (() => {
    const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return authored('briefing').flatMap((h) => {
      const def = COMPASS_40_SECTIONS.find((s) => norm(s.name) === norm(h)
        || s.sourceHeadings.some((sh: string) => norm(sh) === norm(h)));
      return def?.maxWordCount ? [{ heading: h, cap: def.maxWordCount }] : [];
    });
  })();

  it('the briefing really does collide with the Compass registry', () => {
    // If this were empty the two assertions below would pass for the wrong
    // reason for ever — which is how the first version of this spec passed
    // against the defect it was written for.
    expect(ALIASED.length).toBeGreaterThan(0);
  });

  it('does not cut a briefing section at the Compass\'s cap for it', () => {
    /*
     * Driven through `composeCondensedDocument`, because that is where the
     * literal `'compass-40'` was: calling the post-processor with `'briefing'`
     * directly cannot see the defect, since the old fallback handed a
     * non-Compass tier the FINANCIAL registry, which the briefing's headings
     * alias not at all.
     */
    const out = draw('briefing', modelOutput('briefing', 900));
    for (const { heading, cap } of ALIASED) {
      const body = out.markdown.split(/^##\s+/m).find((s) => s.startsWith(heading)) ?? '';
      const words = body.split(/\s+/).filter(Boolean).length;
      expect(words, `"${heading}" was cut at the Compass's ${cap}-word cap`)
        .toBeGreaterThan(cap);
    }
  });

  it('runs no page-pressure trim for a tier that declares no band', () => {
    const long = modelOutput('briefing', 900);
    const out = postProcessReportMarkdown(long, 'briefing');
    // Far past the Compass's own band, and still not trimmed by it.
    expect(out.report.initialEstimatedPages).toBeGreaterThan(COMPASS_PAGE_BAND.max);
    expect(out.report.trimsApplied).toEqual([]);
  });

  it('does not hand an unknown tier the Financial Analysis registry', () => {
    /*
     * The expression was `tier === 'compass-40' ? COMPASS : FINANCIAL`, so
     * everything that was not the Compass silently got the other tier's
     * section list — the same trap `compassQAValidator` already closed. The
     * document is written in FINANCIAL headings on purpose: that is the only
     * shape in which the fallback is visible.
     */
    const capped = FINANCIAL_ANALYSIS_SECTIONS.filter((s) => s.maxWordCount);
    expect(capped.length).toBeGreaterThan(0);
    const doc = capped.map((s) => `## ${s.name}\n\n${'Prose. '.repeat(900)}\n`).join('\n');
    for (const tier of ['briefing', 'snapshot', 'strategic'] as const) {
      expect(postProcessReportMarkdown(doc, tier).report.sectionsTrimmed, tier).toEqual([]);
    }
    // …and the tier that DOES declare that registry is still trimmed by it.
    expect(postProcessReportMarkdown(doc, 'financial-analysis').report.sectionsTrimmed.length)
      .toBeGreaterThan(0);
  });

  it('still judges the Compass by the Compass, so this narrowed nothing else', () => {
    const compassHeads = COMPASS_40_SECTIONS.map((s) => s.name);
    const doc = compassHeads.map((h) => `## ${h}\n\n${'Prose. '.repeat(900)}\n`).join('\n');
    const out = postProcessReportMarkdown(doc, 'compass-40');
    expect(out.report.sectionsTrimmed.length).toBeGreaterThan(0);
    expect(out.markdown.length).toBeLessThan(doc.length);
  });

  it('still strips the editorial blocks it is called for', () => {
    const withLabel = `## Executive Summary\n\n**What This Means:** a commentary block.\n\nThe verdict.\n`;
    const out = postProcessReportMarkdown(withLabel, 'briefing');
    expect(out.report.editorialBlocksRemoved).toBeGreaterThan(0);
    expect(out.markdown).not.toContain('What This Means');
  });
});

describe('how long it came out is measured against what the tier claims', () => {
  it.each(['briefing', 'snapshot'] as const)('%s: reports its own pages and its own ceiling', (tier) => {
    const out = draw(tier);
    expect(out.hygiene.declared_page_ceiling).toBe(CONDENSED_PAGE_CEILING[tier]);
    expect(out.hygiene.estimated_pages).toBe(estimatePages(out.markdown));
    // A document inside its ceiling records no overrun at all.
    expect(out.hygiene.over_declared_pages).toBeUndefined();
  });

  it('names the overrun when there is one, and still cuts nothing', () => {
    /*
     * Reported, never trimmed. `PAGE_PRESSURE_TRIM_ORDER` is written in
     * Compass section ids and has no meaning on these documents, so a cut
     * here would have to choose what to lose and nothing has measured that
     * for these two formats. What was wrong before was not the absence of a
     * cut — it was that the Briefing was measured against 38 pages and the
     * Snapshot against nothing.
     */
    const out = draw('snapshot', modelOutput('snapshot', 600));
    const pages = out.hygiene.estimated_pages as number;
    expect(pages).toBeGreaterThan(CONDENSED_PAGE_CEILING.snapshot);
    expect(out.hygiene.over_declared_pages).toBe(pages - CONDENSED_PAGE_CEILING.snapshot);
    // The prose is still there: this is a reading, not a trim.
    expect(out.markdown).toContain('Prose for Top 3 Opportunities');
  });

  it('the two ceilings are the ones the tiers declare', () => {
    // Named in one module so the prompt's "~12 pages" and this check cannot
    // drift; `condense-investment-report`'s TIER_CONFIG is the other end.
    expect(CONDENSED_PAGE_CEILING.briefing).toBe(12);
    expect(CONDENSED_PAGE_CEILING.snapshot).toBe(5);
  });
});

describe('the Briefing carries no modelling', () => {
  /*
   * `tierContent.briefing` declares `financialModelling: false` and the
   * document's cover says the financial position is in the Financial Analysis
   * Report. The five financial chapters were removed from this tier in
   * S5/S6 §4; this is the guard that keeps them out.
   *
   * A yield figure inside the SCORE breakdown is not modelling and is
   * deliberately not listed: it is the Yield dimension's own evidence for the
   * grade, which the Compass carries under the same policy.
   */
  const MODELLING: Array<[string, RegExp]> = [
    ['the loan amount', /1,580,000/],
    ['the interest rate', /6\.10%/],
    ['the weekly repayment', /repayment/i],
    ['the ten-year series', /Year 10|10-year cashflow/i],
    ['the upfront total', /480,000/],
  ];

  it('prints none of the figures that belong to the Financial Analysis Report', () => {
    const md = draw('briefing').markdown;
    for (const [what, pattern] of MODELLING) {
      expect(pattern.test(md), `${what} reached the Briefing`).toBe(false);
    }
  });

  it('and the Snapshot may carry them, because its tier declares it may', () => {
    // `tierContent.snapshot.financialModelling` is true — its whole purpose is
    // the figures. The Financial Snapshot section is composed from the record.
    expect(headings(draw('snapshot').markdown)).toContain('Financial Snapshot');
  });
});
